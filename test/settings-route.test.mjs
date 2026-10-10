import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { installSettingsRoute, installDiagnosticsRoute } from '../lib/settings-route.js';
import { createConnectDiagnostics } from '../lib/connect-diagnostics.js';

const snapshot = { settings: { cliExecutable: '/opt/devtunnel', managedEnabled: true }, revision: 1, source: 'settings', activeManaged: 2, available: true };
const body = { cliExecutable: '/opt/devtunnel', managedEnabled: true, confirmed: true, disconnectActive: false, revision: 1 };
function fixture(runtime = { snapshot: async () => snapshot, update: async () => snapshot }) {
  let route, disposer, disposed = false;
  const server = { register(value) { route = value; return () => { disposed = true; }; } };
  const ctx = { inject(names, callback) {
    assert.deepEqual(names, ['webServer']);
    callback({ get(name) { assert.equal(name, 'webServer'); return server; }, effect(factory) { disposer = factory(); } });
  } };
  installSettingsRoute(ctx, { runtime });
  assert.equal(route.kind, 'exact');
  assert.equal(route.path, '/dsh-devtunnel-ssh/settings');
  return {
    dispose() { disposer(); assert.equal(disposed, true); },
    async request(method, content = '', chunks) {
      const req = Readable.from(chunks ?? [content]);
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

test('exact host route GET awaits snapshot, public runtime metadata preserved, private data stripped', async () => {
  let called = false;
  const f = fixture({ snapshot: async () => { called = true; await Promise.resolve(); return { ...snapshot, token: 'secret', settings: { ...snapshot.settings, privateKey: 'secret' } }; }, update() { assert.fail(); } });
  const result = await f.request('GET');
  assert.equal(called, true);
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, { ok: true, ...snapshot });
  assert.equal(JSON.stringify(result.data).includes('secret'), false);
  f.dispose();
});

test('POST strictly validated, awaits runtime update and returns snapshot', async () => {
  let received;
  const f = fixture({ snapshot() { assert.fail(); }, async update(value) { received = value; await Promise.resolve(); return snapshot; } });
  assert.deepEqual((await f.request('POST', JSON.stringify(body))).data, { ok: true, ...snapshot });
  assert.deepEqual(received, body);
  const config = { settings: { cliExecutable: '', managedEnabled: false }, revision: 0, source: 'config' };
  const initial = fixture({ snapshot: async () => config, update: async value => ({ ...config, revision: value.revision + 1, source: 'settings' }) });
  assert.equal((await initial.request('POST', JSON.stringify({ ...body, cliExecutable: '', managedEnabled: false, revision: 0 }))).status, 200);
});

test('POST rejects malformed, oversized, unknown or secret keys before runtime', async () => {
  let calls = 0;
  const f = fixture({ snapshot: async () => snapshot, update: async () => { calls++; return snapshot; } });
  const invalid = ['{', 'null', '[]', JSON.stringify({ ...body, token: 'secret' }), JSON.stringify({ ...body, confirmed: false }), JSON.stringify({ ...body, revision: '1' }), JSON.stringify({ ...body, revision: -1 }), JSON.stringify({ ...body, revision: 1.5 }), JSON.stringify({ ...body, disconnectActive: 1 }), JSON.stringify({ ...body, cliExecutable: 'relative' }), JSON.stringify({ ...body, cliExecutable: '/bad\npath' }), JSON.stringify({ cliExecutable: '/tool', managedEnabled: false })];
  for (const text of invalid) {
    assert.deepEqual((await f.request('POST', text)).data, { ok: false, error: 'SETTINGS_REJECTED' });
  }
  const oversized = await f.request('POST', '', [Buffer.alloc(4096, ' '), Buffer.alloc(4097, ' ')]);
  assert.equal(oversized.status, 400);
  assert.equal(calls, 0);
  const utf8 = await f.request('POST', '', [Buffer.from([0xff])]);
  assert.equal(utf8.status, 400);
  // The limit is bytes, not string characters.
  assert.equal((await f.request('POST', JSON.stringify({ ...body, cliExecutable: '/' + 'é'.repeat(4095) }))).status, 400);
  const exact = JSON.stringify(body).padEnd(8192, ' ');
  assert.equal((await f.request('POST', exact)).status, 200);
  assert.equal(calls, 1);
});

test('empty override permits managed authorization and returns safe PATH detection',async()=>{
 const cli={status:'found',source:'path',resolvedExecutable:'/opt/bin/devtunnel'};
 const f=fixture({snapshot:async()=>({...snapshot,cli:{...cli,token:'secret'}}),update:async value=>({...snapshot,settings:{cliExecutable:value.cliExecutable,managedEnabled:value.managedEnabled},cli})});
 assert.deepEqual((await f.request('GET')).data.cli,cli);
 const saved=await f.request('POST',JSON.stringify({...body,cliExecutable:''}));assert.equal(saved.status,200);assert.equal(saved.data.settings.managedEnabled,true);
});
test('method 405, safe allowlist statuses, raw error details never leak', async () => {
  const method = await fixture().request('DELETE');
  assert.equal(method.status, 405);
  assert.equal(method.headers.Allow, 'GET, POST');
  for (const [code, status] of [['SETTINGS_REJECTED', 400], ['SETTINGS_CONFIRM_REQUIRED', 400], ['SETTINGS_REVISION_CONFLICT', 409], ['SETTINGS_BUSY', 409], ['SETTINGS_ACTIVE_CONFIRM_REQUIRED', 409], ['SETTINGS_UNAVAILABLE', 503], ['SETTINGS_CLEANUP_FAILED', 503], ['ENOENT', 503]]) {
    const error = Object.assign(new Error('/private/path token=secret'), { code, path: '/private/path' });
    const runtime = { snapshot: async () => { throw error; }, update: async () => { throw error; } };
    for (const method of ['GET', 'POST']) {
      const result = await fixture(runtime).request(method, JSON.stringify(body));
      assert.equal(result.status, status);
      assert.deepEqual(result.data, { ok: false, error: code === 'ENOENT' ? 'SETTINGS_UNAVAILABLE' : code });
      assert.equal(JSON.stringify(result.data).includes('/private'), false);
    }
  }
});

test('invalid runtime result and unavailable service fail safely; optional webServer supported', async () => {
  for (const value of [null, { ...snapshot, revision: 0 }, { ...snapshot, source: 'private' }, { ...snapshot, activeManaged: -1 }, { ...snapshot, available: 'yes' }]) {
    assert.equal((await fixture({ snapshot: async () => value, update: async () => value }).request('GET')).status, 503);
  }
  assert.equal((await fixture(null).request('GET')).status, 503);
  installSettingsRoute({}, {});
  installSettingsRoute({ inject(names, callback) { callback({ get: () => null }); } }, {});
});

function diagnosticsFixture(diagnostics) {
  let route, disposed = false;
  const server = { register(value) { route = value; return () => { disposed = true; }; } };
  const ctx = { inject(names, callback) {
    assert.deepEqual(names, ['webServer']);
    callback({ get(name) { assert.equal(name, 'webServer'); return server; }, effect(factory) { factory(); } });
  } };
  installDiagnosticsRoute(ctx, { diagnostics });
  assert.equal(route.kind, 'exact');
  assert.equal(route.path, '/dsh-devtunnel-ssh/diagnostics');
  return {
    dispose() { route = route; assert.equal(typeof disposed, 'boolean'); },
    async request(method) {
      const req = Readable.from([]);
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

test('diagnostics route is read-only and serves only masked, bounded entries', async () => {
  const diagnostics = createConnectDiagnostics({});
  diagnostics.record({
    code: 'CONNECT_OUTPUT_REJECTED', reason: 'UNSUPPORTED_FORWARDING', stream: 'stderr', lines: 3, bytes: 120,
    sawForwarding: true, remotePort: 22, tunnelId: 'fixture.euw', executable: '/opt/devtunnel',
    sample: ['Visit https://github.com/login/device?user_code=ABCD-1234', 'token: abcdefghijklmnopqrstuvwxyz012345'],
  });
  const f = diagnosticsFixture(diagnostics);
  const result = await f.request('GET');
  assert.equal(result.status, 200);
  assert.equal(result.data.ok, true);
  assert.equal(result.data.revision, 1);
  assert.equal(result.data.entries.length, 1);
  const [entry] = result.data.entries;
  assert.equal(entry.code, 'CONNECT_OUTPUT_REJECTED');
  assert.equal(entry.reason, 'UNSUPPORTED_FORWARDING');
  assert.deepEqual(entry.sample, ['Visit https://github.com/login/device?<redacted>', 'token <redacted>']);
  assert.doesNotMatch(JSON.stringify(result.data), /user_code=ABCD|abcdefghijklmnopqrstuvwxyz012345/u);
  const denied = await f.request('POST');
  assert.equal(denied.status, 405);
  assert.equal(denied.headers.Allow, 'GET');
  assert.deepEqual(denied.data, { ok: false, error: 'METHOD_NOT_ALLOWED' });
});

test('diagnostics route fails closed when the sink is unavailable', async () => {
  for (const value of [undefined, null, {}, { snapshot() {} }]) {
    const f = diagnosticsFixture(value);
    const result = await f.request('GET');
    assert.equal(result.status, 503, JSON.stringify(value));
    assert.deepEqual(result.data, { ok: false, error: 'DIAGNOSTICS_UNAVAILABLE' });
  }
});
