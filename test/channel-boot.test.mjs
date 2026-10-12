import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import * as plugin from '../lib/index.js';
import * as api from '../../dsh-remote/lib/ssh-carrier.js';
const require = createRequire(new URL('../../dsh-remote/package.json', import.meta.url));
const { Context } = await import(require.resolve('@deepseek-ai/cordis'));

test('actual Cordis loads channel routes, persists independent catalog and unloads leases in isolated DSH_HOME', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'channel-cordis-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  const root = new Context(), routes = new Map();
  let services, fiber;
  try {
    services = await root.plugin({ name: 'channel-fixture-services', apply(ctx) {
      ctx.provide('loader', { import: async specifier => { assert.equal(specifier, 'dsh-remote/lib/ssh-carrier.js'); return api; } });
      ctx.provide('webServer', { register(def) { routes.set(def.path, def.handler); return () => routes.delete(def.path); } });
    } });
    fiber = await root.plugin(plugin, { managedEnabled: false, cliExecutable: '' });
    const call = async (method, body) => {
      let data;
      const req = Object.assign(Readable.from(body ? [JSON.stringify(body)] : []), { method });
      const res = { setHeader() {}, end(text) { data = JSON.parse(text); } };
      await routes.get('/dsh-devtunnel-ssh/channels')(req, res);
      assert.equal(res.statusCode, 200, JSON.stringify(data)); return data;
    };
    assert.equal((await call('GET')).channels.length, 0);
    const connector = { kind: 'devtunnel', mode: 'external', tunnelId: 'fixture.jpe1', remotePort: 22, endpoint: { host: '127.0.0.1', port: 55000 } };
    const { kind, ...channel } = connector;
    const created = await call('POST', { action: 'create', channelId: '', revision: 0, confirmed: true, channel: { name: 'Independent', ...channel } });
    const lease = await api.sshCarrierOf('devtunnel').acquire({ machineId: 'ssh-a', connector: { ...connector, channelId: created.channelId } });
    assert.equal(lease.dialPort, 55000);
    await fiber.dispose(); fiber = null; await lease.closed;
    assert.throws(() => lease.dialPort, /STALE_LEASE/); await lease.release();
    assert.equal(api.sshCarrierOf('devtunnel'), undefined); assert.equal(routes.size, 0);
    fiber = await root.plugin(plugin, { managedEnabled: false, cliExecutable: '' });
    const loaded = await call('GET');
    assert.equal(loaded.catalogRevision, 1); assert.equal(loaded.channels[0].channelId, created.channelId);
  } finally {
    await fiber?.dispose(); await services?.dispose();
    if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
});
