import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { startManagedConnect } from '../lib/managed-connect.js';
const config = { executable: '/fixture/devtunnel', tunnelId: 'fixture.euw', remotePort: 22, startupTimeoutMs: 30, graceMs: 5, killMs: 5 };
function fixture(action, killExit = 'SIGTERM') {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = 42;
  const signals = [], calls = [];
  child.kill = signal => { signals.push(signal); if (signal === killExit) child.emit('exit', 0); return true; };
  const spawn = (...args) => { calls.push(args); queueMicrotask(() => action?.(child)); return child; };
  return { child, signals, calls, spawn };
}
const line = (port = 22) => `SSH: Forwarding from 127.0.0.1:64894 to host port ${port}\n`;
test('spawn is explicit and safe; first forwarding endpoint closes once', async () => {
  const f = fixture(c => { c.stdout.emit('data', line()); c.stderr.emit('data', 'SSH: Forwarding from [::1]:64894 to host port 22\n'); });
  const session = await startManagedConnect({ ...config, spawn: f.spawn });
  assert.deepEqual(f.calls, [['/fixture/devtunnel', ['connect', 'fixture.euw'], { shell: false, stdio: ['ignore', 'pipe', 'pipe'], detached: false }]]);
  assert.deepEqual(session.endpoint, { host: '127.0.0.1', port: 64894 });
  const a = session.close(); assert.equal(a, session.close()); await a;
  assert.equal(session.endpoint, null); assert.deepEqual(await session.closed, { reason: 'CONNECT_CLOSED' });
  assert.deepEqual(f.signals, ['SIGTERM']);
});
test('abort before spawn and asynchronous abort are fail closed', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(startManagedConnect({ ...config, signal: controller.signal, spawn() { assert.fail(); } }), /CONNECT_ABORTED/);
  const controller2 = new AbortController(), f = fixture(() => controller2.abort());
  await assert.rejects(startManagedConnect({ ...config, signal: controller2.signal, spawn: f.spawn }), /CONNECT_ABORTED/);
  assert.deepEqual(f.signals, ['SIGTERM']);
});
test('ready is invalidated after abort and process exit', async () => {
  const controller = new AbortController(), f = fixture(c => c.stdout.emit('data', line()));
  const session = await startManagedConnect({ ...config, signal: controller.signal, spawn: f.spawn });
  controller.abort(); await session.closed; await session.close(); assert.equal(session.endpoint, null);
  const g = fixture(c => c.stdout.emit('data', line()));
  const s = await startManagedConnect({ ...config, spawn: g.spawn }); g.child.emit('exit', 1);
  await s.closed; assert.equal(s.endpoint, null); assert.deepEqual(g.signals, []);
});
test('output immediately followed by exit cannot resolve stale ready', async () => {
  const f = fixture(c => { c.stdout.emit('data', line()); c.emit('exit', 1); });
  await assert.rejects(startManagedConnect({ ...config, spawn: f.spawn }), /CONNECT_EXITED/);
  assert.deepEqual(f.signals, []);
});
test('wrong remote port times out; bounded TERM/KILL cleanup with no retry', async () => {
  const f = fixture(c => c.stdout.emit('data', line(23)), 'SIGKILL');
  await assert.rejects(startManagedConnect({ ...config, spawn: f.spawn }), /CONNECT_STARTUP_TIMEOUT/);
  assert.deepEqual(f.signals, ['SIGTERM', 'SIGKILL']); assert.equal(f.calls.length, 1);
});
test('unconfirmed exit reports bounded cleanup failure', async () => {
  const f = fixture(null, 'never');
  await assert.rejects(startManagedConnect({ ...config, startupTimeoutMs: 5, spawn: f.spawn }), /CONNECT_CLEANUP_FAILED/);
  assert.deepEqual(f.signals, ['SIGTERM', 'SIGKILL']);
});
test('close after ready rejects unconfirmed cleanup, without exposing raw errors', async () => {
  const f = fixture(c => c.stdout.emit('data', line()), 'never');
  const session = await startManagedConnect({ ...config, spawn: f.spawn });
  await assert.rejects(session.close(), e => e.message === 'CONNECT_CLEANUP_FAILED');
  assert.equal(session.endpoint, null);
  assert.deepEqual(f.signals, ['SIGTERM', 'SIGKILL']);
});
test('spawn errors are redacted including thrown secrets', async () => {
  await assert.rejects(startManagedConnect({ ...config, spawn() { throw Error('private-token'); } }), e => e.message === 'CONNECT_SPAWN_FAILED');
  const f = fixture(c => { delete c.pid; c.emit('error', Error('private-token')); });
  await assert.rejects(startManagedConnect({ ...config, spawn: f.spawn }), e => e.message === 'CONNECT_SPAWN_FAILED');
  assert.deepEqual(f.signals, []);
});
test('split streams never assemble readiness; oversized output cleans child', async () => {
  const f = fixture(c => { c.stdout.emit('data', 'SSH: Forwarding from '); c.stderr.emit('data', '127.0.0.1:64894 to host port 22\n'); });
  await assert.rejects(startManagedConnect({ ...config, spawn: f.spawn }), /CONNECT_STARTUP_TIMEOUT/);
  const g = fixture(c => c.stdout.emit('data', 'private-token'.repeat(30000)));
  await assert.rejects(startManagedConnect({ ...config, spawn: g.spawn }), e => e.message === 'CONNECT_OUTPUT_REJECTED');
  assert.deepEqual(g.signals, ['SIGTERM']);
});
test('tail finish can report ready, and invalid options never spawn', async () => {
  const f = fixture(c => { c.stdout.emit('data', line().trim()); c.stdout.emit('end'); });
  const s = await startManagedConnect({ ...config, spawn: f.spawn }); await s.close();
  for (const extra of [{ executable: 'devtunnel' }, { remotePort: 0 }, { tunnelId: '--token' }, { startupTimeoutMs: Infinity }, { signal: {} }]) {
    await assert.rejects(startManagedConnect({ ...config, ...extra, spawn() { assert.fail(); } }), /INVALID_MANAGED_CONFIG/);
  }
});
