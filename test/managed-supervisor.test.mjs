import test from 'node:test';
import assert from 'node:assert/strict';
import { createManagedStarter } from '../lib/managed-supervisor.js';
import { createCarrier } from '../lib/carrier.js';
import { registerSshCarrier } from '../../dsh-remote/lib/ssh-carrier.js';
import { createCarrierSshPool } from '../../dsh-remote/lib/ssh-carrier-pool.js';
import { createCarrierPoolCache } from '../../dsh-remote/lib/ssh-carrier-cache.js';

const opts = { tunnelId: 'fixture-tunnel', remotePort: 22 };
const error = code => Object.assign(new Error('fake'), { code });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function resource(port = 3001, cleanup = async () => {}) {
  const ended = deferred();
  let closes = 0;
  return { handle: { endpoint: { host: '127.0.0.1', port }, closed: ended.promise,
    close() { closes++; return cleanup(); } }, ended, get closes() { return closes; } };
}
function factory(start, extra = {}) {
  return createManagedStarter({ executable: '/fake/devtunnel', start, ...extra });
}
function clock(t) { t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 }); }

test('startup retry uses bounded backoff, then delivers new port and unchanged closed', async t => {
  clock(t);
  const ready = resource(4102); const times = [];
  const start = factory(async value => {
    times.push(Date.now()); assert.equal(value.executable, '/fake/devtunnel');
    if (times.length === 1) throw error('CONNECT_EXITED');
    if (times.length === 2) throw error('CONNECT_STARTUP_TIMEOUT');
    return ready.handle;
  });
  const pending = start(opts); await flush();
  assert.deepEqual(times, [1000]);
  t.mock.timers.tick(499); await flush(); assert.equal(times.length, 1);
  t.mock.timers.tick(1); await flush(); assert.deepEqual(times, [1000, 1500]);
  t.mock.timers.tick(1499); await flush(); assert.equal(times.length, 2);
  t.mock.timers.tick(1); const handle = await pending;
  assert.equal(handle.endpoint.port, 4102); assert.equal(handle.closed, ready.handle.closed);
  await handle.close(); assert.equal(ready.closes, 1);
});

test('abort cancels each backoff without spending another attempt or spawning', async t => {
  clock(t);
  let calls = 0;
  const ready = resource();
  const start = factory(async () => { if (++calls <= 3) throw error('CONNECT_EXITED'); return ready.handle; });
  for (const delay of [500, 1500, 4000]) {
    const controller = new AbortController();
    const pending = start({ ...opts, signal: controller.signal });
    const rejected = assert.rejects(pending, { code: 'CONNECT_ABORTED' });
    await flush(); controller.abort(); await rejected;
    t.mock.timers.tick(delay); await flush();
  }
  assert.equal(calls, 3);
  const handle = await start(opts); assert.equal(calls, 4); await handle.close();
});

test('initial plus three attempts is the shared lifetime unstable budget', async t => {
  clock(t);
  let calls = 0; const start = factory(async () => { calls++; throw error('CONNECT_EXITED'); });
  const pending = start(opts); const exhausted = assert.rejects(pending, { code: 'CONNECT_RETRY_EXHAUSTED' });
  await flush();
  for (const delay of [500, 1500, 4000]) { t.mock.timers.tick(delay); await flush(); }
  await exhausted; assert.equal(calls, 4);
  await assert.rejects(start(opts), { code: 'CONNECT_RETRY_EXHAUSTED' });
  await assert.rejects(start({ ...opts, machineId: 'other-machine' }), { code: 'CONNECT_RETRY_EXHAUSTED' });
  assert.equal(calls, 4);
});

test('post-ready exits share cooldown and budget across later acquisitions; no keepalive', async t => {
  clock(t);
  const resources = []; const start = factory(async () => {
    const item = resource(4200 + resources.length); resources.push(item); return item.handle;
  });
  for (let i = 0; i < 4; i++) {
    const pending = start(opts); await flush();
    if (i) { t.mock.timers.tick([500, 1500, 4000][i - 1] - 1); await flush(); assert.equal(resources.length, i); t.mock.timers.tick(1); }
    const handle = await pending; assert.equal(handle.endpoint.port, 4200 + i);
    resources[i].ended.resolve({ reason: 'CONNECT_EXITED' }); await flush();
    assert.equal(handle.endpoint, null); assert.equal(resources.length, i + 1);
  }
  await assert.rejects(start(opts), { code: 'CONNECT_RETRY_EXHAUSTED' });
});

test('dangerous startup errors never retry, even after another acquire', async t => {
  clock(t);
  for (const code of ['CONNECT_OUTPUT_REJECTED', 'INVALID_MANAGED_CONFIG', 'CONNECT_CLEANUP_FAILED',
    'CONNECT_SPAWN_FAILED', 'CONNECT_ADAPTER_FAILED', 'SECURITY_REJECTED']) {
    let calls = 0; const start = factory(async () => { calls++; throw error(code); });
    await assert.rejects(start(opts), { code });
    t.mock.timers.tick(10000);
    await assert.rejects(start(opts), { code }); assert.equal(calls, 1);
  }
});

test('stable lifetime resets budget lazily at 30 seconds without background restart', async t => {
  clock(t);
  const items = []; const start = factory(async () => { const item = resource(); items.push(item); return item.handle; });
  const first = await start(opts); items[0].ended.resolve({ reason: 'CONNECT_EXITED' }); await flush();
  const pending = start(opts); await flush(); t.mock.timers.tick(500); const stable = await pending;
  t.mock.timers.tick(30000); assert.equal(items.length, 2);
  items[1].ended.resolve({ reason: 'CONNECT_EXITED' }); await flush();
  const next = start(opts); await flush();
  t.mock.timers.tick(499); await flush(); assert.equal(items.length, 2);
  t.mock.timers.tick(1); await (await next).close();
  assert.equal(first.endpoint, null); assert.equal(stable.endpoint, null);
});

test('explicit close and ready abort do not count as unstable failures', async t => {
  clock(t);
  let calls = 0;
  const start = factory(async () => { calls++; return resource().handle; });
  for (let i = 0; i < 6; i++) { const handle = await start(opts); await handle.close(); }
  const controller = new AbortController(); const handle = await start({ ...opts, signal: controller.signal });
  controller.abort(); await handle.close();
  await (await start(opts)).close(); assert.equal(calls, 8);
});

test('same target cannot overlap startup, live child, or actual cleanup', async t => {
  clock(t);
  const startup = deferred(), cleanup = deferred(); const item = resource(5001, () => cleanup.promise);
  let calls = 0; const start = factory(async () => { calls++; return calls === 1 ? startup.promise : resource().handle; });
  const pending = start(opts); await flush();
  await assert.rejects(start(opts), { code: 'CONNECT_TARGET_BUSY' });
  startup.resolve(item.handle); const handle = await pending;
  await assert.rejects(start(opts), { code: 'CONNECT_TARGET_BUSY' });
  let closed = false; const closing = handle.close().then(() => { closed = true; });
  const next = start(opts); await flush(); assert.equal(calls, 1); assert.equal(closed, false);
  await assert.rejects(start(opts), { code: 'CONNECT_TARGET_BUSY' });
  cleanup.resolve(); await closing; await (await next).close(); assert.equal(calls, 2);
});

test('cleanup failure after unexpected exit poisons target and prevents leaked replacements', async t => {
  clock(t);
  const cleanup = deferred(); const item = resource(5001, () => cleanup.promise);
  let calls = 0; const start = factory(async () => { calls++; return item.handle; });
  const handle = await start(opts);
  item.ended.resolve({ reason: 'CONNECT_EXITED' }); await flush();
  const pending = start(opts); const failed = assert.rejects(pending, { code: 'CONNECT_CLEANUP_FAILED' });
  await flush(); assert.equal(calls, 1);
  cleanup.reject(error('PROCESS_EXIT_TIMEOUT')); await failed;
  await assert.rejects(handle.close(), { code: 'CONNECT_CLEANUP_FAILED' });
  await assert.rejects(start(opts), { code: 'CONNECT_CLEANUP_FAILED' }); assert.equal(calls, 1);
});

test('late successful start after abort is cleaned before rejecting', async () => {
  const startup = deferred(), cleanup = deferred(); const item = resource(5001, () => cleanup.promise);
  const controller = new AbortController(); let calls = 0;
  const start = factory(async () => { calls++; return startup.promise; });
  const pending = start({ ...opts, signal: controller.signal });
  const rejected = assert.rejects(pending, { code: 'CONNECT_ABORTED' });
  await flush(); controller.abort(); startup.resolve(item.handle); await flush();
  assert.equal(item.closes, 1);
  await assert.rejects(start(opts), { code: 'CONNECT_TARGET_BUSY' });
  cleanup.resolve(); await rejected; assert.equal(calls, 1);
});

test('malformed returned endpoint cleans once and blocks target; late close waits for cleanup', async () => {
  const cleanup = deferred(); const item = resource(7001, () => cleanup.promise);
  item.handle.endpoint.host = '0.0.0.0';
  let calls = 0; const start = factory(async () => { calls++; return item.handle; });
  const pending = start(opts); const rejected = assert.rejects(pending, { code: 'CONNECT_ADAPTER_FAILED' });
  await flush(); assert.equal(item.closes, 1);
  await assert.rejects(start(opts), { code: 'CONNECT_TARGET_BUSY' });
  cleanup.resolve(); await rejected;
  await assert.rejects(start(opts), { code: 'CONNECT_ADAPTER_FAILED' }); assert.equal(calls, 1);
});

test('budget identity is tunnel plus remote port, not unrelated targets', async () => {
  let calls = 0;
  const start = factory(async () => { calls++; throw error('CONNECT_EXITED'); }, { retryDelaysMs: [] });
  await assert.rejects(start(opts), { code: 'CONNECT_RETRY_EXHAUSTED' });
  await assert.rejects(start({ ...opts, remotePort: 23 }), { code: 'CONNECT_RETRY_EXHAUSTED' });
  await assert.rejects(start({ ...opts, tunnelId: 'second-tunnel' }), { code: 'CONNECT_RETRY_EXHAUSTED' });
  await assert.rejects(start(opts), { code: 'CONNECT_RETRY_EXHAUSTED' }); assert.equal(calls, 3);
});

test('invalid config and pre-aborted input allocate no resources', async () => {
  let calls = 0; const start = factory(async () => { calls++; return resource().handle; });
  for (const input of [null, {}, { ...opts, remotePort: 0 }, { ...opts, signal: {} },
    { ...opts, tunnelId: '--unsafe' }]) await assert.rejects(start(input), { code: 'INVALID_MANAGED_CONFIG' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(start({ ...opts, signal: controller.signal }), { code: 'CONNECT_ABORTED' });
  for (const extra of [{ retryDelaysMs: [1, 2, 3, 4] }, { retryDelaysMs: Array(3) },
    { retryDelaysMs: [-1] }, { stableMs: 0 }]) {
    assert.throws(() => factory(async () => resource().handle, extra), { code: 'INVALID_MANAGED_CONFIG' });
  }
  assert.equal(calls, 0);
});

test('actual parent pool/cache recovery keeps pin and identity, changes generation, never replays exec', async t => {
  clock(t);
  const items = [], pools = [], operations = [];
  const start = factory(async () => { const item = resource(6100 + items.length); items.push(item); return item.handle; });
  const carrier = createCarrier({ startManaged: start });
  const unregister = registerSshCarrier(carrier);
  class FakePool {
    constructor(config) { this.config = config; this.closed = false; pools.push(this); }
    connect() { return Promise.resolve(); }
    async exec(command) {
      await this.connect(); // Same guard path real SSH operations use.
      operations.push(command);
      items[0].ended.resolve({ reason: 'CONNECT_EXITED' });
      throw error('SSH_CONNECTION_LOST');
    }
    close() { this.closed = true; }
  }
  const cache = createCarrierPoolCache({ createPool: (machine, config, options) =>
    createCarrierSshPool(machine, config, { ...options, Pool: FakePool }) });
  const machine = { id: 'actual-cache-fixture', transport: 'ssh', username: 'tester',
    expectedHostFingerprint: 'SHA256:' + 'A'.repeat(43),
    connector: { kind: 'devtunnel', mode: 'managed', ...opts } };
  try {
    const old = await cache.get(machine, {});
    assert.equal(await cache.get(machine, {}), old);
    assert.equal(old.config.port, 6100);
    await assert.rejects(old.exec('one-business-operation'), { code: 'SSH_CONNECTION_LOST' });
    await flush(); assert.equal(old.carrierClosed, true); assert.equal(old.closed, true);
    await assert.rejects(old.connect(), /lease closed/);
    await assert.rejects(old.exec('must-not-run'), /lease closed/);
    assert.deepEqual(operations, ['one-business-operation']); assert.equal(items.length, 1);
    const pending = cache.get(machine, {}); await flush();
    t.mock.timers.tick(499); await flush(); assert.equal(items.length, 1);
    t.mock.timers.tick(1); const fresh = await pending;
    assert.notEqual(fresh, old); assert.equal(fresh.config.port, 6101);
    assert.notEqual(fresh.carrier.generation, old.carrier.generation);
    assert.equal(fresh.carrier.targetIdentity, old.carrier.targetIdentity);
    assert.equal(fresh.config.hostKeyIdentity, old.config.hostKeyIdentity);
    assert.equal(fresh.config.hostKeyMode, 'verify');
    assert.equal(fresh.config.expectedHostFingerprint, machine.expectedHostFingerprint);
    assert.equal(fresh.config.expectedHostFingerprint, old.config.expectedHostFingerprint);
    assert.equal(await cache.get(machine, {}), fresh);
    assert.deepEqual(operations, ['one-business-operation']); assert.equal(pools.length, 2);
    await fresh.connect(); await assert.rejects(old.connect(), /lease closed/);
  } finally { await cache.close(); await carrier.dispose(); unregister(); }
});

test('old carrier SSH lease becomes stale; subsequent acquire gets new endpoint only', async t => {
  clock(t);
  const items = []; const start = factory(async () => { const item = resource(6000 + items.length); items.push(item); return item.handle; });
  const carrier = createCarrier({ startManaged: start });
  const request = { machineId: 'fake-machine', connector: { kind: 'devtunnel', mode: 'managed', ...opts } };
  const old = await carrier.acquire(request); assert.equal(old.dialPort, 6000);
  items[0].ended.resolve({ reason: 'CONNECT_EXITED' }); await old.closed; await flush();
  assert.throws(() => old.dialPort, { code: 'STALE_LEASE' }); assert.equal(items.length, 1);
  const pending = carrier.acquire(request); await flush(); t.mock.timers.tick(500);
  const fresh = await pending; assert.equal(fresh.dialPort, 6001); assert.notEqual(fresh.generation, old.generation);
  assert.throws(() => old.dialPort, { code: 'STALE_LEASE' }); await fresh.release(); await carrier.dispose();
});

test('the starter exposes supervisor retry/blocked state for the channel panel', async () => {
  const attempts = [];
  const starter = createManagedStarter({
    executable: '/fixture/devtunnel',
    retryDelaysMs: [1, 1, 1],
    start: ({ tunnelId, remotePort }) => {
      attempts.push([tunnelId, remotePort]);
      return Promise.reject(Object.assign(new Error('CONNECT_OUTPUT_REJECTED'), { code: 'CONNECT_OUTPUT_REJECTED' }));
    },
  });
  assert.equal(typeof starter.list, 'function');
  assert.deepEqual(starter.list(), [], 'no target is known before the first attempt');
  await assert.rejects(starter({ tunnelId: 'fixture.jpe1', remotePort: 22 }), /CONNECT_OUTPUT_REJECTED/);
  const [entry] = starter.list();
  assert.deepEqual({ tunnelId: entry.tunnelId, remotePort: entry.remotePort, active: entry.active, pending: entry.pending, blocked: entry.blocked },
    { tunnelId: 'fixture.jpe1', remotePort: 22, active: false, pending: false, blocked: 'CONNECT_OUTPUT_REJECTED' });
  assert.equal(attempts.length, 1, 'a non-retryable code blocks immediately');
  // A retryable code stays retryable and surfaces its failure count/cooldown.
  const retrying = createManagedStarter({
    executable: '/fixture/devtunnel', retryDelaysMs: [5],
    start: () => new Promise(() => {}),
  });
  const started = retrying({ tunnelId: 'other.jpe1', remotePort: 22 });
  const [row] = retrying.list();
  assert.equal(row.pending, true);
  started.catch(() => {});
});
