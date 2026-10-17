import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createChannelStore } from '../lib/util/channel-store.js';
import { createSettingsRuntime } from '../lib/core/settings-runtime.js';
import { createCarrier, targetIdentity } from '../lib/core/carrier.js';
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const config = { name: 'Mac', mode: 'managed', tunnelId: 'fixture.jpe1', remotePort: 22 };
function settingsStore(extra = {}) {
  let value = { settings: { cliExecutable: '/fixture/devtunnel', managedEnabled: true, residentTunnelId: '', residentRemotePort: 0, residentMode: 'off', ...extra }, revision: 0, source: 'config' };
  return { snapshot: async () => value, save: async (settings, { expectedRevision }) => {
    assert.equal(expectedRevision, value.revision); return value = { settings, revision: value.revision + 1, source: 'settings' };
  } };
}
async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'channel-manager-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const handles = [], events = [];
  const store = settingsStore(options.settings);
  const runtime = await createSettingsRuntime({ store, channelStore: createChannelStore({ directory }),
    resolveCli: async () => ({ status: 'found', source: 'override', resolvedExecutable: '/fixture/devtunnel' }),
    channelRecovery: options.recovery || { exitDelaysMs: [1, 2, 5], stableResetMs: 60000, heartbeatMs: 20, resumeGapMs: 5000 },
    makeStarter: options.makeStarter || (() => async ({ signal }) => {
      let ended;
      const handle = { endpoint: { host: '127.0.0.1', port: 51000 + handles.length },
        closed: new Promise(r => { ended = r; }), end: () => ended({ reason: 'CONNECT_EXITED' }),
        close: async () => { if (!handle.stopped) { handle.stopped = true; events.push('close'); ended(); } } };
      handles.push(handle); events.push('spawn'); return handle;
    }) });
  const carrier = createCarrier({ capabilities: runtime.capabilities, getChannelEntry: runtime.getChannelEntry, onCarrier: runtime.attachCarrier });
  t.after(async () => { await carrier.dispose(); await runtime.dispose().catch(() => {}); });
  const command = (action, channelId = '', channel) => runtime.channelCommand({ action, channelId,
    revision: runtime.channelSnapshot().catalogRevision, confirmed: true, ...(channel ? { channel } : {}) });
  const connector = channelId => ({ kind: 'devtunnel', mode: 'managed', channelId, tunnelId: config.tunnelId, remotePort: 22 });
  return { runtime, carrier, handles, events, directory, store, command, connector };
}
test('catalog persists without spawning; SSH cannot start or restart and release never stops connect', async t => {
  const f = await fixture(t);
  const id = await f.command('create', '', config);
  assert.equal(f.runtime.channelSnapshot().channels[0].state, 'stopped');
  assert.equal(f.events.length, 0);
  const borrow = machineId => f.carrier.acquire({ machineId, connector: f.connector(id) });
  await assert.rejects(borrow('a'), /CHANNEL_NOT_READY/);
  await f.command('start', id); await tick();
  const a = await borrow('a'), b = await borrow('b');
  const firstPort = a.dialPort;
  assert.equal(a.generation, b.generation);
  assert.equal(f.runtime.channelSnapshot().channels[0].refs, 2);
  await a.release(); await b.release();
  assert.deepEqual(f.events, ['spawn']);
  const old = await borrow('c');
  await f.command('stop', id); await old.closed;
  assert.throws(() => old.dialPort, /STALE_LEASE/);
  for (let i = 0; i < 3; i++) await assert.rejects(borrow('background-git'), /CHANNEL_NOT_READY/);
  assert.deepEqual(f.events, ['spawn', 'close']);
  await old.release();
  await f.command('restart', id); await tick();
  const next = await borrow('a');
  assert.notEqual(next.generation, old.generation); assert.notEqual(next.dialPort, firstPort);
  await next.release();
  const reloaded = await createChannelStore({ directory: f.directory }).snapshot();
  assert.equal(reloaded.settings.channels[0].channelId, id);
  assert.equal(Object.hasOwn(reloaded.settings.channels[0], 'generation'), false);
});
test('passive status polling never starts stopped channels, borrows leases or arms wake recovery', async t => {
  let clock = 1000;
  const f = await fixture(t, { recovery: { exitDelaysMs: [1], stableResetMs: 60000, heartbeatMs: 5, resumeGapMs: 20, now: () => clock } });
  const id = await f.command('create', '', config);
  for (let i = 0; i < 10; i++) {
    assert.equal((await f.runtime.snapshot({ refresh: false })).activeManaged, 0);
    const row = f.runtime.channelSnapshot().channels[0];
    assert.equal(row.state, 'stopped');
    assert.equal(row.refs, 0);
    assert.equal(row.generation, null);
    assert.deepEqual(f.carrier.snapshot(), []);
  }
  clock += 20;
  await delay(25);
  assert.deepEqual(f.events, [], 'polling and a wake heartbeat cannot create demand');
  assert.equal(f.runtime.channelSnapshot().channels[0].state, 'stopped');
  await assert.rejects(f.carrier.acquire({ machineId: 'idle', connector: f.connector(id) }), /CHANNEL_NOT_READY/);
  assert.deepEqual(f.events, [], 'even a mistaken acquire cannot auto-start a catalog channel');
});
test('passive reads and releasing an idle workspace preserve another workspace shared channel lease', async t => {
  const f = await fixture(t);
  const id = await f.command('create', '', config);
  await f.command('start', id); await tick();
  const idle = await f.carrier.acquire({ machineId: 'idle', connector: f.connector(id) });
  const active = await f.carrier.acquire({ machineId: 'active', connector: f.connector(id) });
  const generation = active.generation, port = active.dialPort;
  await idle.release();
  for (let i = 0; i < 10; i++) {
    await f.runtime.snapshot({ refresh: false });
    const row = f.runtime.channelSnapshot().channels[0];
    assert.equal(row.refs, 1, 'observations cannot retain or release another workspace lease');
    assert.equal(row.generation, generation);
    assert.equal(row.state, 'ready');
    assert.deepEqual(f.carrier.snapshot(), []);
  }
  assert.equal(active.dialPort, port);
  assert.deepEqual(f.events, ['spawn'], 'no restart or stop while another workspace is using the channel');
  await active.release();
  assert.equal(f.runtime.channelSnapshot().channels[0].refs, 0);
  assert.deepEqual(f.events, ['spawn'], 'explicit independent-channel intent survives final SSH release');
});
test('legacy managed machines match a saved target; edits cannot redirect trusted machines', async t => {
  const f = await fixture(t);
  const id = await f.command('create', '', config);
  const { channelId, ...legacy } = f.connector(id);
  assert.equal(targetIdentity(legacy), targetIdentity(f.connector(id)), 'mirror identity stays stable');
  await f.command('start', id); await tick();
  const lease = await f.carrier.acquire({ machineId: 'legacy', connector: legacy });
  await f.command('update', id, { ...config, tunnelId: 'other.jpe1' });
  await lease.closed; await lease.release();
  await assert.rejects(f.carrier.acquire({ machineId: 'legacy', connector: f.connector(id) }), /CHANNEL_TARGET_CHANGED/);
  await assert.rejects(f.carrier.acquire({ machineId: 'legacy', connector: legacy }), /CHANNEL_NOT_FOUND/);
});
test('catalog has strict CRUD, revision conflicts, unique targets and persisted deletion', async t => {
  const f = await fixture(t);
  const id = await f.command('create', '', config);
  await assert.rejects(f.command('create', '', config), /CHANNEL_TARGET_EXISTS/);
  await assert.rejects(f.runtime.channelCommand({ action: 'delete', channelId: id, revision: 0, confirmed: true }), /SETTINGS_REVISION_CONFLICT/);
  await assert.rejects(f.command('update', id, { ...config, token: 'not-allowed' }), /CHANNELS_REJECTED/);
  await f.command('delete', id);
  assert.deepEqual((await createChannelStore({ directory: f.directory }).snapshot()).settings.channels, []);
  await assert.rejects(f.carrier.acquire({ machineId: 'a', connector: f.connector(id) }), /CHANNEL_NOT_FOUND/);
});
test('external entries are registered only and no process action is accepted', async t => {
  const f = await fixture(t);
  const channel = { ...config, mode: 'external', endpoint: { host: '::1', port: 54321 } };
  const id = await f.command('create', '', channel);
  for (const action of ['start', 'stop', 'restart']) await assert.rejects(f.command(action, id), /CHANNEL_EXTERNAL/);
  const lease = await f.carrier.acquire({ machineId: 'a', connector: { ...f.connector(id), mode: 'external', endpoint: channel.endpoint } });
  assert.equal(lease.dialPort, 54321);
  await lease.release(); await f.command('delete', id);
  assert.deepEqual(f.events, []);
});
test('unexpected runtime exit auto-restarts with a bounded budget and invalidates old leases', async t => {
  const f = await fixture(t); const id = await f.command('create', '', config);
  await f.command('start', id); await tick();
  const lease = await f.carrier.acquire({ machineId: 'a', connector: f.connector(id) });
  const firstPort = lease.dialPort;
  f.handles[0].end(); await tick();
  assert.equal(f.runtime.channelSnapshot().channels[0].state, 'recovering');
  await lease.closed;
  await assert.rejects(f.carrier.acquire({ machineId: 'a', connector: f.connector(id) }), /CHANNEL_NOT_READY/);
  await delay(10);
  assert.equal(f.handles.length, 2, 'auto-restart spawned a fresh generation');
  assert.equal(f.runtime.channelSnapshot().channels[0].state, 'ready');
  assert.notEqual(f.runtime.channelSnapshot().channels[0].endpoint.port, firstPort);
  const next = await f.carrier.acquire({ machineId: 'a', connector: f.connector(id) });
  assert.notEqual(next.generation, lease.generation);
  await next.release(); await lease.release();
});
test('recovery budget exhausts into a manual error state and never restarts beyond it', async t => {
  const f = await fixture(t); const id = await f.command('create', '', config);
  await f.command('start', id); await tick();
  // Three auto restarts are allowed; the fourth unexpected exit exhausts.
  for (let exit = 0; exit < 4; exit++) {
    f.handles[exit].end();
    await delay(10);
  }
  const row = f.runtime.channelSnapshot().channels[0];
  assert.equal(row.state, 'error');
  assert.equal(row.error, 'CONNECT_RETRY_EXHAUSTED');
  const count = f.handles.length;
  assert.equal(count, 4, 'initial generation plus three auto restarts');
  await delay(40);
  assert.equal(f.handles.length, count, 'no restart after exhaustion');
  // Explicit user restart starts a fresh epoch.
  await f.command('restart', id); await tick();
  assert.equal(f.handles.length, count + 1);
  assert.equal(f.runtime.channelSnapshot().channels[0].state, 'ready');
});
test('a generation that stays ready long enough resets the recovery epoch', async t => {
  const f = await fixture(t, { recovery: { exitDelaysMs: [1], stableResetMs: 25, heartbeatMs: 20, resumeGapMs: 5000 } });
  const id = await f.command('create', '', config);
  await f.command('start', id); await tick(); // gen1
  f.handles[0].end(); await delay(10);          // recovery 1 → gen2
  assert.equal(f.handles.length, 2);
  await delay(40);                              // gen2 stays ready beyond stableResetMs
  assert.equal(f.runtime.channelSnapshot().channels[0].state, 'ready');
  const before = f.handles.length;
  f.handles[1].end(); await delay(10);          // stable exit resets budget → recovery again
  assert.equal(f.handles.length, before + 1, 'stable lifetime reset the failure budget');
  assert.equal(f.runtime.channelSnapshot().channels[0].state, 'ready');
});
test('deliberate stop cancels a pending auto-restart and restart keeps one fresh generation', async t => {
  const f = await fixture(t); const id = await f.command('create', '', config);
  await f.command('start', id); await tick();
  f.handles[0].end(); await tick();
  assert.equal(f.runtime.channelSnapshot().channels[0].state, 'recovering');
  await f.command('stop', id);
  assert.equal(f.runtime.channelSnapshot().channels[0].state, 'stopped');
  await delay(20);
  assert.equal(f.handles.length, 1, 'stopped channel never restarts');
  await f.command('start', id); await tick();
  f.handles[1].end(); await tick();
  assert.equal(f.runtime.channelSnapshot().channels[0].state, 'recovering');
  await f.command('restart', id); await tick();
  assert.equal(f.handles.length, 3, 'explicit restart wins over the pending recovery');
  assert.equal(f.runtime.channelSnapshot().channels[0].state, 'ready');
});
test('delete drops the pending recovery and the record, and poison never auto-restarts', async t => {
  const f = await fixture(t); const id = await f.command('create', '', config);
  await f.command('start', id); await tick();
  f.handles[0].end(); await tick();
  await f.command('delete', id);
  await delay(20);
  assert.equal(f.handles.length, 1, 'deleting a recovering channel spawns nothing');
});
test('wake recovery also invalidates on-demand managed generations so the next acquire is fresh', async t => {
  let clock = 1000;
  const f = await fixture(t, { recovery: { exitDelaysMs: [1], stableResetMs: 60000, heartbeatMs: 5, resumeGapMs: 20, now: () => clock } });
  // Catalog-less embedding: a carrier owned by our own runtime, started by the
  // supervised starter so wakeRecover has real on-demand generations to drop.
  const carrier = createCarrier({ startManaged: f.runtime.getStarter(), capabilities: f.runtime.capabilities,
    onCarrier: f.runtime.attachCarrier });
  t.after(() => carrier.dispose());
  const connector = { kind: 'devtunnel', mode: 'managed', tunnelId: 'on-demand.jpe1', remotePort: 22 };
  const lease = await carrier.acquire({ machineId: 'od-a', connector });
  const firstPort = lease.dialPort;
  assert.equal(f.handles.length, 1);
  clock += 20;
  await delay(25);                       // sleep gap ends: watchdog → wakeRecover
  await lease.closed;
  assert.throws(() => lease.dialPort, /STALE_LEASE/);
  await delay(40);                       // steady state: no second invalidation
  assert.equal(f.handles.length, 1, 'on-demand channel is torn down, not restarted');
  const next = await carrier.acquire({ machineId: 'od-a', connector });
  assert.notEqual(next.generation, lease.generation);
  assert.notEqual(next.dialPort, firstPort);
  await next.release(); await lease.release();
});
test('cleanup-failure poison blocks auto-restart after an unexpected exit', async t => {
  let starts = 0, current;
  const f = await fixture(t, { makeStarter: () => async () => {
    starts++; let ended;
    const handle = { endpoint: { host: '127.0.0.1', port: 5000 }, closed: new Promise(r => { ended = r; }),
      end: () => ended({ reason: 'CONNECT_EXITED' }),
      close: async () => { throw Error('private raw failure'); } };
    current = handle; return handle;
  } });
  const id = await f.command('create', '', config); await f.command('start', id); await tick();
  current.end(); await tick();
  await delay(20);
  assert.equal(starts, 1, 'poisoned cleanup never triggers another start');
  assert.equal(f.runtime.channelSnapshot().channels[0].error, 'CONNECT_CLEANUP_FAILED');
});
test('sleep watchdog restarts READY managed channels once per wake, never stopped or external ones', async t => {
  let clock = 1000;
  const f = await fixture(t, { recovery: { exitDelaysMs: [1], stableResetMs: 60000, heartbeatMs: 5, resumeGapMs: 20, now: () => clock } });
  const managed = await f.command('create', '', config);
  const external = await f.command('create', '', { ...config, name: 'Ext', tunnelId: 'external.jpe1', mode: 'external', endpoint: { host: '127.0.0.1', port: 54321 } });
  const stopped = await f.command('create', '', { ...config, name: 'Stopped', tunnelId: 'stopped.jpe1' });
  await f.command('start', managed); await tick();
  const lease = await f.carrier.acquire({ machineId: 'a', connector: f.connector(managed) });
  const oldGeneration = lease.generation;
  clock += 20; // jump ≥ resumeGapMs: a long suspend ends here
  await delay(25);
  assert.equal(f.handles.length, 2, 'ready managed channel restarted once on resume');
  await lease.closed;
  const rows = Object.fromEntries(f.runtime.channelSnapshot().channels.map(c => [c.name, c.state]));
  assert.deepEqual(rows, { Mac: 'ready', Ext: 'external', Stopped: 'stopped' });
  assert.notEqual(f.runtime.channelSnapshot().channels[0].generation, oldGeneration);
  const again = f.handles.length;
  await delay(40); // steady heartbeats must not fire a second resume
  assert.equal(f.handles.length, again);
  assert.equal(f.runtime.channelSnapshot().channels[0].state, 'ready');
});
test('stop during startup aborts and waits for late handle cleanup; no leaked process', async t => {
  let resolveStart, signal, closed = 0;
  const f = await fixture(t, { makeStarter: () => opts => { signal = opts.signal; return new Promise(r => { resolveStart = r; }); } });
  const id = await f.command('create', '', config); await f.command('start', id); await tick();
  const stop = f.command('stop', id); await tick();
  assert.equal(signal.aborted, true);
  resolveStart({ endpoint: { host: '127.0.0.1', port: 5000 }, closed: new Promise(() => {}), close: async () => { closed++; } });
  await stop;
  assert.ok(closed >= 1); assert.equal(f.runtime.channelSnapshot().channels[0].state, 'stopped');
});
test('cleanup failure poisons the channel and cannot be cleared by stop, restart or edit', async t => {
  let starts = 0;
  const f = await fixture(t, { makeStarter: () => async () => { starts++; return {
    endpoint: { host: '127.0.0.1', port: 5000 }, closed: new Promise(() => {}), close: async () => { throw Error('private raw failure'); },
  }; } });
  const id = await f.command('create', '', config); await f.command('start', id); await tick();
  await assert.rejects(f.command('stop', id), /CONNECT_CLEANUP_FAILED/);
  for (const action of ['start', 'restart', 'delete']) await assert.rejects(f.command(action, id), /CONNECT_CLEANUP_FAILED/);
  await assert.rejects(f.command('update', id, { ...config, name: 'renamed' }), /CONNECT_CLEANUP_FAILED/);
  assert.equal(starts, 1);
});
test('legacy resident loads as stopped migration preview, with no automatic write or spawn', async t => {
  const f = await fixture(t, { settings: { residentTunnelId: config.tunnelId, residentRemotePort: 22, residentMode: 'immediate' } });
  const row = f.runtime.channelSnapshot().channels[0];
  assert.equal(row.channelId, 'legacy-resident'); assert.equal(row.state, 'stopped');
  assert.equal(f.runtime.channelSnapshot().catalogRevision, 0); assert.deepEqual(f.events, []);
  assert.equal((await createChannelStore({ directory: f.directory }).snapshot()).source, 'config');
  await f.command('update', row.channelId, config);
  assert.equal((await createChannelStore({ directory: f.directory }).snapshot()).source, 'settings');
});
test('global settings require confirmation to stop channels even with no SSH references', async t => {
  const f = await fixture(t); const id = await f.command('create', '', config);
  await f.command('start', id); await tick();
  const body = { ...(await f.store.snapshot()).settings, managedEnabled: false, revision: 0, confirmed: true, disconnectActive: false };
  await assert.rejects(f.runtime.update(body), /SETTINGS_ACTIVE_CONFIRM_REQUIRED/);
  await f.runtime.update({ ...body, disconnectActive: true });
  assert.equal(f.runtime.channelSnapshot().channels[0].state, 'stopped');
  await assert.rejects(f.command('start', id), /MANAGED_UNAVAILABLE/);
});
test('plugin reload reads saved channels as stopped and never reconnects on SSH demand', async t => {
  const f = await fixture(t); const id = await f.command('create', '', config);
  await f.command('start', id); await tick(); await f.runtime.dispose();
  const reloaded = await createSettingsRuntime({ store: f.store, channelStore: createChannelStore({ directory: f.directory }),
    resolveCli: async () => ({ status: 'found', source: 'path', resolvedExecutable: '/fixture/devtunnel' }),
    makeStarter: () => () => assert.fail('reload or acquire started CLI'),
  });
  t.after(() => reloaded.dispose());
  assert.equal(reloaded.channelSnapshot().channels[0].state, 'stopped');
  assert.throws(() => reloaded.getChannelEntry(f.connector(id)), /CHANNEL_NOT_READY/);
});

import { generateKeyPairSync, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { registerSshCarrier } from '../../dsh-remote/lib/ssh-carrier.js';
import { createCarrierPoolCache } from '../../dsh-remote/lib/ssh-carrier-cache.js';
const ssh2 = createRequire(new URL('../../dsh-remote/package.json', import.meta.url))('ssh2');
test('independent channel with real SSH wire: shared process, pool close retains it, stop kills PTY and cache renews', { timeout: 10000 }, async t => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const key = ssh2.utils.parseKey(privateKey);
  const pin = 'SHA256:' + createHash('sha256').update(key.getPublicSSH()).digest('base64').replace(/=+$/, '');
  const clients = new Set();
  const server = new ssh2.Server({ hostKeys: [privateKey] }, client => {
    clients.add(client); client.on('error', () => {}); client.on('close', () => clients.delete(client));
    client.on('authentication', ctx => ctx.method === 'password' && ctx.password === 'fixture' ? ctx.accept() : ctx.reject());
    client.on('ready', () => client.on('session', accept => {
      const session = accept(); session.on('pty', accept => accept());
      session.on('shell', accept => { const ch = accept(); ch.on('error', () => {}); });
    }));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  let starts = 0, stops = 0;
  const f = await fixture(t, { makeStarter: () => async () => {
    starts++; let ended, stopped = false;
    return { endpoint: { host: '127.0.0.1', port: server.address().port }, closed: new Promise(r => { ended = r; }),
      close: async () => { if (!stopped) { stopped = true; stops++; ended(); } } };
  } });
  const unregister = registerSshCarrier(f.carrier), cache = createCarrierPoolCache();
  t.after(async () => { await cache.close(); unregister(); for (const client of clients) client.end(); await new Promise(r => server.close(r)); });
  const id = await f.command('create', '', config);
  const machine = { id: 'wire-a', connector: f.connector(id), username: 'fixture', password: 'fixture', expectedHostFingerprint: pin };
  await assert.rejects(cache.get(machine, {}), /CHANNEL_NOT_READY/);
  await f.command('start', id); await tick();
  const [a, same] = await Promise.all([cache.get(machine, { connectTimeoutMs: 2000 }), cache.get(machine, { connectTimeoutMs: 2000 })]);
  assert.equal(a, same); await a.connect(); a.platform = 'posix';
  await a.openPty(); assert.equal(a._ptyClients.size, 1);
  const b = await cache.get({ ...machine, id: 'wire-b' }, { connectTimeoutMs: 2000 }); await b.connect();
  assert.equal(starts, 1); await b.close(); assert.equal(stops, 0);
  await f.command('stop', id); await tick();
  assert.equal(a.carrierClosed, true); assert.equal(a._ptyClients.size, 0);
  await assert.rejects(cache.get(machine, { connectTimeoutMs: 2000 }), /CHANNEL_NOT_READY/);
  assert.equal(starts, 1);
  await f.command('start', id); await tick();
  const next = await cache.get(machine, { connectTimeoutMs: 2000 }); await next.connect();
  assert.notEqual(next.carrier.generation, a.carrier.generation); assert.equal(starts, 2);
});
