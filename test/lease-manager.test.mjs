import test from 'node:test';
import assert from 'node:assert/strict';
import { createLeaseManager } from '../lib/lease-manager.js';

// In-memory fixtures only. PASS is NOT SSH Step0 approval; real SSH: NOT RUN.
const target = Object.freeze({ machineId: 'machine-A', tunnelId: 'tunnel-A.region', username: 'alice', sshPort: 22 });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function resource(endpoint = { host: '127.0.0.1', port: 43127 }, closeGate) {
  const signal = deferred();
  let closes = 0;
  return {
    handle: { endpoint, closed: signal.promise, async close() { closes++; await closeGate; signal.resolve(); } },
    signal,
    get closes() { return closes; },
  };
}
const code = (expected) => (error) => error.code === expected && error.message === expected;
const turn = () => new Promise((resolve) => setImmediate(resolve));

test('concurrent acquire starts once, snapshots target, refcounts and idempotent release', async () => {
  const gate = deferred();
  const r = resource();
  let starts = 0;
  const manager = createLeaseManager({ async start(received) {
    starts++;
    assert.deepEqual(received, target);
    assert.ok(Object.isFrozen(received));
    await gate.promise;
    return r.handle;
  } });
  const mutable = { ...target };
  const tasks = [manager.acquire(mutable), manager.acquire(target), manager.acquire({ ...target })];
  mutable.tunnelId = 'mutated';
  await turn();
  assert.equal(starts, 1);
  assert.equal(manager.status().leases, 3);
  gate.resolve();
  const leases = await Promise.all(tasks);
  assert.equal(leases[0].endpoint.port, 43127);
  assert.ok(Object.isFrozen(leases[0].endpoint));
  const release = leases[0].release();
  assert.equal(leases[0].release(), release);
  await release;
  assert.equal(leases[0].usable, false);
  assert.equal(leases[1].usable, true);
  await leases[1].release();
  assert.equal(r.closes, 0);
  await leases[2].release();
  assert.equal(r.closes, 1);
  assert.equal(manager.status().leases, 0);
  await manager.dispose();
  assert.equal(r.closes, 1);
});

test('release/dispose race closes exactly once and waits for owned cleanup', async () => {
  const gate = deferred();
  const r = resource(undefined, gate.promise);
  const manager = createLeaseManager({ start: async () => r.handle });
  const lease = await manager.acquire(target);
  const releasing = lease.release();
  const disposing = manager.dispose();
  assert.equal(manager.dispose(), disposing);
  assert.equal(lease.usable, false);
  assert.throws(() => lease.endpoint, code('STALE_LEASE'));
  let finished = false;
  disposing.then(() => { finished = true; });
  await turn();
  assert.equal(r.closes, 1);
  assert.equal(finished, false);
  gate.resolve();
  await Promise.all([releasing, disposing, lease.release()]);
  assert.equal(r.closes, 1);
  await assert.rejects(manager.acquire(target), code('DISPOSED'));
});

test('dispose invalidates all references, without touching another manager', async () => {
  const a = resource();
  const b = resource();
  const manager = createLeaseManager({ start: async () => a.handle });
  const other = createLeaseManager({ start: async () => b.handle });
  const leases = await Promise.all([manager.acquire(target), manager.acquire(target)]);
  const otherLease = await other.acquire(target);
  const disposing = manager.dispose();
  assert.ok(leases.every((lease) => !lease.usable));
  await Promise.all([disposing, ...leases.map((lease) => lease.release())]);
  assert.equal(a.closes, 1);
  assert.equal(b.closes, 0);
  assert.equal(otherLease.usable, true);
  await other.dispose();
});

test('dispose during inflight start closes the late result and rejects every pending lease', async () => {
  const gate = deferred();
  const r = resource();
  let starts = 0;
  const manager = createLeaseManager({ async start() { starts++; return gate.promise; } });
  const pending = [manager.acquire(target), manager.acquire(target)];
  const checked = pending.map((p) => assert.rejects(p, code('DISPOSED')));
  await turn();
  const disposing = manager.dispose();
  gate.resolve(r.handle);
  await Promise.all([...checked, disposing]);
  assert.equal(starts, 1);
  assert.equal(r.closes, 1);
  assert.equal(manager.status().leases, 0);
});

test('dispose before start scheduling prevents any allocation', async () => {
  let starts = 0;
  const manager = createLeaseManager({ async start() { starts++; return resource().handle; } });
  const checked = assert.rejects(manager.acquire(target), code('DISPOSED'));
  await Promise.all([checked, manager.dispose()]);
  assert.equal(starts, 0);
});

test('invalid endpoint rejects and cleans up each returned resource', async () => {
  for (const endpoint of [
    { host: '0.0.0.0', port: 22 }, { host: '192.0.2.1', port: 22 },
    { host: 'localhost', port: 22 }, { host: '127.0.0.1.evil', port: 22 },
    { host: '127.0.0.1', port: '22' }, { host: '127.0.0.1', port: 0 },
    { host: '127.0.0.1', port: 65536 }, { host: '::', port: 22 },
    { host: '127.0.0.1', port: 22, token: 'secret' },
  ]) {
    const r = resource(endpoint);
    const manager = createLeaseManager({ start: async () => r.handle });
    await assert.rejects(manager.acquire(target), code('INVALID_ENDPOINT'));
    assert.equal(r.closes, 1);
    await manager.dispose();
    assert.equal(r.closes, 1);
  }
});

test('acquire while last-release cleanup is pending fails closed, then explicit acquire starts fresh', async () => {
  const gate = deferred();
  const resources = [resource(undefined, gate.promise), resource()];
  let starts = 0;
  const manager = createLeaseManager({ start: async () => resources[starts++].handle });
  const old = await manager.acquire(target);
  const releasing = old.release();
  await assert.rejects(manager.acquire(target), code('CONNECTION_CLOSED'));
  assert.equal(starts, 1);
  gate.resolve();
  await releasing;
  const fresh = await manager.acquire(target);
  assert.equal(starts, 2);
  assert.equal(old.usable, false);
  assert.equal(fresh.usable, true);
  await manager.dispose();
  assert.ok(resources.every((r) => r.closes === 1));
});

test('literal IPv6 loopback is accepted', async () => {
  const r = resource({ host: '::1', port: 65535 });
  const manager = createLeaseManager({ start: async () => r.handle });
  const lease = await manager.acquire(target);
  assert.equal(lease.endpoint.host, '::1');
  await lease.release();
  await manager.dispose();
});

test('start failure is sanitized, shared, retryable explicitly, and never automatically retried', async () => {
  const r = resource();
  let starts = 0;
  const manager = createLeaseManager({ async start() {
    starts++;
    if (starts === 1) throw new Error('SECRET=private raw failure');
    return r.handle;
  } });
  await Promise.all([1, 2].map(() => assert.rejects(manager.acquire(target), code('START_FAILED'))));
  await turn();
  assert.equal(starts, 1);
  assert.equal(JSON.stringify(manager.status()).includes('SECRET'), false);
  const lease = await manager.acquire(target);
  assert.equal(starts, 2);
  assert.equal(lease.usable, true);
  await manager.dispose();
});

test('resolved or rejected closed signal permanently invalidates old leases without replay', async () => {
  for (const reject of [false, true]) {
    const resources = [resource(), resource()];
    let starts = 0;
    const manager = createLeaseManager({ start: async () => resources[starts++].handle });
    const old = await manager.acquire(target);
    if (reject) resources[0].signal.reject(new Error('SECRET transport failure'));
    else resources[0].signal.resolve();
    await turn();
    assert.equal(old.usable, false);
    assert.throws(() => old.endpoint, code('STALE_LEASE'));
    assert.throws(() => old.assertUsable(), code('STALE_LEASE'));
    assert.equal(starts, 1);
    assert.equal(resources[0].closes, 1);
    assert.equal(manager.status().automaticReconnects, 0);
    const fresh = await manager.acquire(target);
    await old.release();
    assert.equal(fresh.usable, true);
    assert.equal(resources[1].closes, 0);
    assert.equal('exec' in fresh || 'write' in fresh || 'openPty' in fresh, false);
    await fresh.release();
    await manager.dispose();
  }
});

test('already closed start result never produces a usable lease', async () => {
  const r = resource();
  r.signal.resolve();
  const manager = createLeaseManager({ start: async () => r.handle });
  await assert.rejects(manager.acquire(target), code('CONNECTION_CLOSED'));
  await manager.dispose();
  assert.equal(r.closes, 1);
});

test('identity isolation, changed-target refusal persists after release and failed start', async () => {
  const resources = [];
  const manager = createLeaseManager({ async start() {
    const r = resource(); resources.push(r); return r.handle;
  } });
  const a = await manager.acquire(target);
  const b = await manager.acquire({ ...target, machineId: 'machine-B' });
  assert.equal(resources.length, 2);
  for (const change of [{ tunnelId: 'other' }, { username: 'bob' }, { sshPort: 2222 }]) {
    await assert.rejects(manager.acquire({ ...target, ...change }), code('TARGET_CHANGED_REQUIRES_NEW_TRUST'));
  }
  await a.release();
  assert.equal(b.usable, true);
  await assert.rejects(manager.acquire({ ...target, tunnelId: 'other' }), code('TARGET_CHANGED_REQUIRES_NEW_TRUST'));
  await manager.dispose();
  assert.ok(resources.every((r) => r.closes === 1));
  const failed = createLeaseManager({ async start() { throw new Error('no'); } });
  await assert.rejects(failed.acquire(target), code('START_FAILED'));
  await assert.rejects(failed.acquire({ ...target, sshPort: 2222 }), code('TARGET_CHANGED_REQUIRES_NEW_TRUST'));
  await failed.dispose();
});

test('strict target validation rejects missing, extra, coercible and accessor values before start', async () => {
  let starts = 0;
  const manager = createLeaseManager({ async start() { starts++; return resource().handle; } });
  for (const input of [null, [], {}, { ...target, machineId: '' }, { ...target, machineId: '../x' },
    { ...target, tunnelId: '-flag' }, { ...target, tunnelId: 'a\nb' },
    { ...target, machineId: 'machine-A\n' }, { ...target, tunnelId: 'tunnel-A\r' },
    { ...target, username: 'alice\n' },
    { ...target, username: 'alice@host' }, { ...target, username: 12 },
    { ...target, sshPort: '22' }, { ...target, sshPort: NaN }, { ...target, sshPort: 22.5 },
    { ...target, sshPort: -1 }, { ...target, sshPort: 65536 },
    { ...target, token: 'secret' }, { ...target, [Symbol('secret')]: 'secret' },
    { ...target, get username() { throw new Error('must not run'); } },
  ]) await assert.rejects(manager.acquire(input), code('INVALID_TARGET'));
  assert.equal(starts, 0);
  assert.deepEqual(Object.keys(manager.status()).sort(),
    ['automaticReconnects', 'cleanupFailed', 'leases', 'ready', 'starting', 'state']);
  await manager.dispose();
});

test('malformed readiness and throwing endpoint getter still clean up owned resources', async () => {
  for (const broken of ['closed', 'endpoint']) {
    const r = resource();
    if (broken === 'closed') r.handle.closed = {};
    else Object.defineProperty(r.handle, 'endpoint', { get() { throw new Error('SECRET'); } });
    const manager = createLeaseManager({ start: async () => r.handle });
    await assert.rejects(manager.acquire(target), code('INVALID_RESOURCE'));
    assert.equal(r.closes, 1);
    await manager.dispose();
  }
});

test('cleanup failure is explicit and sanitized, close is not retried', async () => {
  let closes = 0;
  const manager = createLeaseManager({ start: async () => ({
    endpoint: { host: '127.0.0.1', port: 22 }, closed: deferred().promise,
    close() { closes++; throw new Error('SECRET cleanup'); },
  }) });
  const lease = await manager.acquire(target);
  await assert.rejects(lease.release(), code('CLEANUP_FAILED'));
  await assert.rejects(manager.acquire(target), code('CLEANUP_FAILED'));
  await assert.rejects(manager.dispose(), code('CLEANUP_FAILED'));
  assert.equal(closes, 1);
  assert.equal(manager.status().cleanupFailed, true);
  assert.equal(JSON.stringify(manager.status()).includes('SECRET'), false);
});
