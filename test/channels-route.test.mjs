import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { installChannelsRoute } from '../lib/routes/channels-route.js';
import { createConnectDiagnostics } from '../lib/util/connect-diagnostics.js';

const channel = { machineId: 'mac-b', mode: 'managed', tunnelId: 'fixture.jpe1', remotePort: 22, state: 'ready', endpoint: { host: '127.0.0.1', port: 53162 }, since: 1760000000000, generation: 'g1', refs: 1 };
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

const runtime = {
  channelSnapshot: () => ({ enabled: true, activeManaged: 1, channels: [channel], supervisor }),
  stopManagedChannel: async machineId => {
    if (machineId === 'missing') throw Object.assign(new Error('CHANNEL_NOT_FOUND'), { code: 'CHANNEL_NOT_FOUND' });
    return { machineId, mode: 'managed', tunnelId: 'fixture.jpe1', remotePort: 22 };
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
  assert.equal(result.data.recent.length, 1);
  assert.equal(result.data.recent[0].code, 'CONNECT_READY');
});

test('POST stops exactly one machine after strict validation', async () => {
  const result = await fixture({ runtime }).request('POST', { action: 'stop', machineId: 'mac-b', confirmed: true });
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.stopped, { machineId: 'mac-b', mode: 'managed', tunnelId: 'fixture.jpe1', remotePort: 22 });
  const notFound = await fixture({ runtime }).request('POST', { action: 'stop', machineId: 'missing', confirmed: true });
  assert.equal(notFound.status, 404);
  assert.deepEqual(notFound.data, { ok: false, error: 'CHANNEL_NOT_FOUND' });
  for (const bad of [
    { action: 'stop', machineId: 'mac-b' },
    { action: 'stop', machineId: 'mac-b', confirmed: false },
    { action: 'stop', machineId: 'mac-b', confirmed: true, extra: 1 },
    { action: 'restart', machineId: 'mac-b', confirmed: true },
    { action: 'stop', machineId: '../etc', confirmed: true },
    { action: 'stop', machineId: 'a'.repeat(200), confirmed: true },
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
    stopManagedChannel: async () => { throw new Error('raw adapter secret'); },
  };
  const failed = await fixture({ runtime: broken }).request('POST', { action: 'stop', machineId: 'mac-b', confirmed: true });
  assert.equal(failed.status, 503);
  assert.deepEqual(failed.data, { ok: false, error: 'CHANNELS_UNAVAILABLE' });
  assert.doesNotMatch(JSON.stringify(failed.data), /raw adapter secret/u);
});
