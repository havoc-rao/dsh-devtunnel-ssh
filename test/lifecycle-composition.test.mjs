import test from 'node:test';
import assert from 'node:assert/strict';
import { createLeaseManager } from '../lib/lease-manager.js';
import { ownProcess } from '../lib/owned-process.js';
const target = { machineId: 'fixture-mac', tunnelId: 'fixture.jpe1', username: 'tester', sshPort: 22 };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('composed process ownership waits until last lease and confirms exit', async () => {
  const d = deferred(), signals = [];
  const manager = createLeaseManager({ start: async () => {
    const child = ownProcess({ done: d.promise, terminate(signal) { signals.push(signal); d.resolve(); } }, { graceMs: 5, killMs: 5 });
    return { endpoint: { host: '127.0.0.1', port: 2222 }, closed: d.promise, close: () => child.close() };
  } });
  const [a,b] = await Promise.all([manager.acquire(target), manager.acquire(target)]);
  await a.release(); assert.deepEqual(signals, []); assert.equal(b.usable, true);
  await b.release(); assert.deepEqual(signals, ['SIGTERM']); assert.equal(b.usable, false);
  await manager.dispose(); assert.deepEqual(signals, ['SIGTERM']);
});

test('unconfirmed process exit poisons manager instead of reopening a possibly occupied endpoint', async () => {
  let starts = 0;
  const manager = createLeaseManager({ start: async () => {
    starts++;
    const done = new Promise(() => {});
    const child = ownProcess({ done, terminate() {} }, { graceMs: 5, killMs: 5 });
    return { endpoint: { host: '127.0.0.1', port: 2222 }, closed: done, close: () => child.close() };
  } });
  const lease = await manager.acquire(target);
  await assert.rejects(lease.release(), /CLEANUP_FAILED/);
  await assert.rejects(manager.acquire(target), /CLEANUP_FAILED/);
  assert.equal(starts, 1);
  await assert.rejects(manager.dispose(), /CLEANUP_FAILED/);
});
