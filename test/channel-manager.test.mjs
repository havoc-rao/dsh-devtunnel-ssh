import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createChannelStore } from '../lib/util/channel-store.js';
import { createSettingsRuntime } from '../lib/core/settings-runtime.js';
import { createCarrier, targetIdentity } from '../lib/core/carrier.js';
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
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
test('process exit invalidates all leases and stays failed without background reconnect', async t => {
  const f = await fixture(t); const id = await f.command('create', '', config);
  await f.command('start', id); await tick();
  const lease = await f.carrier.acquire({ machineId: 'a', connector: f.connector(id) });
  f.handles[0].end(); await tick(); await lease.closed;
  assert.equal(f.runtime.channelSnapshot().channels[0].state, 'error');
  await assert.rejects(f.carrier.acquire({ machineId: 'a', connector: f.connector(id) }), /CHANNEL_NOT_READY/);
  assert.equal(f.handles.length, 1);
  await f.command('restart', id); await tick();
  assert.equal(f.handles.length, 2); await lease.release();
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
