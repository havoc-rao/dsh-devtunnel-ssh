import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { installChannelsRoute } from '../lib/routes/channels-route.js';
import { createConnectDiagnostics } from '../lib/util/connect-diagnostics.js';

const channel = { channelId: 'channel-b', name: 'Mac B', mode: 'managed', tunnelId: 'fixture.jpe1', remotePort: 22, state: 'ready', endpoint: { host: '127.0.0.1', port: 53162 }, since: 1760000000000, generation: 'g1', refs: 1 };
const supervisor = [{ tunnelId: 'other.jpe1', remotePort: 22, active: false, pending: false, failures: 2, blocked: null, cooldownUntil: 1760000005000 }];

function fixture({ runtime, diagnostics } = {}) {
  let route, disposed = false;
  const server = { register(value) { route = value; return () => { disposed = true; }; } };
  const ctx = { inject(names, callback) {
    assert.deepEqual(names, ['webServer']);
    callback({ get: () => server, effect(factory) { factory(); } });
  } };
  installChannelsRoute(ctx, { runtime, diagnostics });
  assert.equal(route.kind, 'exact');
  assert.equal(route.path, '/dsh-devtunnel-ssh/channels');
  return {
    dispose() { assert.equal(typeof disposed, 'boolean'); },
    async request(method, body) {
      const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
      req.method = method;
      const headers = {};
      let response;
      const res = { setHeader(name, value) { headers[name] = value; }, end(text) { response = JSON.parse(text); } };
      await route.handler(req, res);
      assert.equal(headers['Content-Type'], 'application/json');
      assert.equal(headers['Cache-Control'], 'no-store');
      return { status: res.statusCode, data: response, headers };
    },
  };
}

const resident = { enabled: true, mode: 'immediate', tunnelId: 'fixture.jpe1', remotePort: 22, state: 'ready', endpoint: { host: '127.0.0.1', port: 53162 }, since: 1760000000000, generation: 1, users: 1, blocked: null, exhausted: false, lastCode: null };
const runtime = {
  channelSnapshot: () => ({ enabled: true, activeManaged: 1, channels: [channel], supervisor, resident }),
  channelCommand: async ({ channelId }) => {
    if (channelId === 'missing') throw Object.assign(new Error('CHANNEL_NOT_FOUND'), { code: 'CHANNEL_NOT_FOUND' });
    return channelId;
  },
};

test('GET serves the channel snapshot plus the diagnostics tail', async () => {
  const diagnostics = createConnectDiagnostics({});
  diagnostics.record({ code: 'CONNECT_READY', reason: 'FORWARDING_MATCHED', endpoint: { host: '127.0.0.1', port: 53162 } });
  const result = await fixture({ runtime, diagnostics }).request('GET');
  assert.equal(result.status, 200);
  assert.equal(result.data.ok, true);
  assert.equal(result.data.revision, 1);
  assert.equal(result.data.enabled, true);
  assert.equal(result.data.activeManaged, 1);
  assert.deepEqual(result.data.channels, [channel]);
  assert.deepEqual(result.data.supervisor, supervisor);
  assert.deepEqual(result.data.resident, resident);
  assert.equal(result.data.recent.length, 1);
  assert.equal(result.data.recent[0].code, 'CONNECT_READY');
});

test('POST stops exactly one channel after strict validation', async () => {
  const result = await fixture({ runtime }).request('POST', { action: 'stop', channelId: 'channel-b', revision: 0, confirmed: true });
  assert.equal(result.status, 200);
  assert.equal(result.data.channelId, 'channel-b');
  const notFound = await fixture({ runtime }).request('POST', { action: 'stop', channelId: 'missing', revision: 0, confirmed: true });
  assert.equal(notFound.status, 404);
  assert.deepEqual(notFound.data, { ok: false, error: 'CHANNEL_NOT_FOUND' });
  for (const bad of [
    { action: 'stop', channelId: 'channel-b', revision: 0 },
    { action: 'stop', channelId: 'channel-b', revision: 0, confirmed: false },
    { action: 'stop', channelId: 'channel-b', revision: 0, confirmed: true, extra: 1 },
    { action: 'unknown', channelId: 'channel-b', revision: 0, confirmed: true },
    { action: 'stop', channelId: '../etc', revision: 0, confirmed: true },
    { action: 'stop', channelId: 'a'.repeat(200), revision: 0, confirmed: true },
  ]) {
    const denied = await fixture({ runtime }).request('POST', bad);
    assert.equal(denied.status, 400, JSON.stringify(bad));
    assert.deepEqual(denied.data, { ok: false, error: 'CHANNELS_REJECTED' });
  }
});

test('method and availability fail closed without leaking adapter detail', async () => {
  const method = await fixture({ runtime }).request('DELETE');
  assert.equal(method.status, 405);
  assert.equal(method.headers.Allow, 'GET, POST');
  for (const value of [undefined, {}, { channelSnapshot: () => ({ enabled: true, activeManaged: 0, channels: {}, supervisor: [] }) }]) {
    const result = await fixture({ runtime: value }).request('GET');
    assert.equal(result.status, 503, JSON.stringify(value));
    assert.deepEqual(result.data, { ok: false, error: 'CHANNELS_UNAVAILABLE' });
  }
  const broken = {
    channelSnapshot: () => ({ enabled: true, activeManaged: 0, channels: [], supervisor: [] }),
    channelCommand: async () => { throw new Error('raw adapter secret'); },
  };
  const failed = await fixture({ runtime: broken }).request('POST', { action: 'stop', channelId: 'channel-b', revision: 0, confirmed: true });
  assert.equal(failed.status, 503);
  assert.deepEqual(failed.data, { ok: false, error: 'CHANNELS_UNAVAILABLE' });
  assert.doesNotMatch(JSON.stringify(failed.data), /raw adapter secret/u);
});

test('all catalog actions pass the explicit id and revision; unknown properties and missing confirmation reject', async () => {
  const calls = [];
  const f = fixture({ runtime: { ...runtime, channelCommand: async body => { calls.push(body); return body.channelId || 'generated'; } } });
  for (const action of ['create', 'update', 'delete', 'start', 'stop', 'restart']) {
    const body = { action, channelId: action === 'create' ? '' : 'channel-b', revision: 4, confirmed: true,
      ...(['create', 'update'].includes(action) ? { channel: { name: 'B', mode: 'managed', tunnelId: 'fixture.jpe1', remotePort: 22 } } : {}) };
    assert.equal((await f.request('POST', body)).status, 200);
    assert.deepEqual(calls.at(-1), body);
    assert.equal((await f.request('POST', { ...body, confirmed: false })).status, 400);
    assert.equal((await f.request('POST', { ...body, executable: '/caller/override' })).status, 400);
  }
  assert.equal(calls.length, 6);
});
