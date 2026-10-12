import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, symlink, mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSettingsStore, validateSettings } from '../lib/util/settings-store.js';

const defaults = { cliExecutable: '/usr/local/bin/devtunnel', managedEnabled: true, residentTunnelId: '', residentRemotePort: 0, residentMode: 'off' };
async function fixture(t, config = defaults) {
  const root = await mkdtemp(join(tmpdir(), 'devtunnel-settings-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'settings');
  return { root, directory, file: join(directory, 'devtunnel-settings.json'), store: createSettingsStore({ directory, defaults: config }) };
}
const isCode = code => error => error.code === code && error.message === code;

test('missing file uses copied config; atomic persist has schema, increasing revision and 0600', async t => {
  const config = { ...defaults };
  const { store, directory, file } = await fixture(t, config);
  config.cliExecutable = '/changed';
  const initial = await store.snapshot();
  assert.deepEqual(initial, { settings: defaults, revision: 0, source: 'config' });
  initial.settings.managedEnabled = false;
  assert.equal((await store.snapshot()).settings.managedEnabled, true);
  const settings = { cliExecutable: '/opt/devtunnel', managedEnabled: false, residentTunnelId: '', residentRemotePort: 0, residentMode: 'off' };
  assert.deepEqual(await store.save(settings, { expectedRevision: 0 }), { settings, revision: 1, source: 'settings' });
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { schemaVersion: 1, revision: 1, settings });
  assert.deepEqual(await readdir(directory), ['devtunnel-settings.json']);
  const restarted = createSettingsStore({ directory, defaults });
  assert.deepEqual(await restarted.snapshot(), { settings, revision: 1, source: 'settings' });
  assert.equal((await restarted.update({ ...settings, revision: 1 })).revision, 2);
});

test('strict path, boolean, enabled path and secret validation', async t => {
  const { store } = await fixture(t);
  const invalid = [
    { cliExecutable: 'devtunnel', managedEnabled: false },
    { cliExecutable: 'C:\\bin\\devtunnel', managedEnabled: false },
    { cliExecutable: '/tmp/\ncli', managedEnabled: false },
    { cliExecutable: '/tmp/\u007fcli', managedEnabled: false },
    { cliExecutable: '/' + 'a'.repeat(4096), managedEnabled: false },
    { cliExecutable: '/bin/tool', managedEnabled: 'false' },
    { ...defaults, token: 'do-not-store' }, null, [],
  ];
  for (const value of invalid) {
    assert.throws(() => validateSettings(value), isCode('SETTINGS_REJECTED'));
    await assert.rejects(store.save(value, { expectedRevision: 0 }), isCode('SETTINGS_REJECTED'));
  }
  assert.ok(Object.isFrozen(validateSettings(defaults)));
  assert.deepEqual(validateSettings({ cliExecutable: '', managedEnabled: false }),
    { cliExecutable: '', managedEnabled: false, residentTunnelId: '', residentRemotePort: 0, residentMode: 'off' });
  assert.equal(validateSettings({ cliExecutable: '/' + 'a'.repeat(4095), managedEnabled: false }).cliExecutable.length, 4096);
  for (const revision of [-1, NaN, Infinity, 0.5, '0', undefined]) {
    await assert.rejects(store.save(defaults, { expectedRevision: revision }), isCode('SETTINGS_REJECTED'));
  }
});

test('optimistic checks serialize writers; stale save never changes persisted settings', async t => {
  const { store, file, directory } = await fixture(t);
  const a = { cliExecutable: '/a', managedEnabled: false, residentTunnelId: '', residentRemotePort: 0, residentMode: 'off' };
  const b = { cliExecutable: '/b', managedEnabled: true, residentTunnelId: 'r.jpe1', residentRemotePort: 22, residentMode: 'immediate' };
  const results = await Promise.allSettled([store.save(a, 0), store.save(b, 0)]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].reason.code, 'SETTINGS_REVISION_CONFLICT');
  assert.deepEqual((await store.snapshot()).settings, a);
  const other = createSettingsStore({ directory, defaults });
  const raced = await Promise.allSettled([other.save(b, 1), store.save(a, 1)]);
  assert.equal(raced[0].status, 'fulfilled');
  assert.equal(raced[1].reason.code, 'SETTINGS_REVISION_CONFLICT');
  await assert.rejects(store.save(a, 1), isCode('SETTINGS_REVISION_CONFLICT'));
  assert.deepEqual((await store.snapshot()).settings, b);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).revision, 2);
});

test('corrupt, oversized, invalid schema and secret files fail closed despite enabled defaults', async t => {
  const { store, directory, file } = await fixture(t);
  await mkdir(directory);
  const record = { schemaVersion: 1, revision: 1, settings: defaults };
  for (const text of [
    'not-json', 'x'.repeat(8193), JSON.stringify({ ...record, schemaVersion: 2 }),
    JSON.stringify({ ...record, revision: 0 }), JSON.stringify({ ...record, revision: 1.5 }),
    JSON.stringify({ ...record, revision: Number.MAX_SAFE_INTEGER + 1 }),
    JSON.stringify({ ...record, token: 'secret' }),
    JSON.stringify({ ...record, settings: { ...defaults, privateKey: 'secret' } }),
    JSON.stringify({ ...record, settings: { cliExecutable: '', managedEnabled: 'true' } }),
  ]) {
    await writeFile(file, text);
    await assert.rejects(store.snapshot(), isCode('SETTINGS_UNAVAILABLE'));
    await assert.rejects(store.save({ cliExecutable: '/safe', managedEnabled: false }, 0), isCode('SETTINGS_UNAVAILABLE'));
    assert.equal(await readFile(file, 'utf8'), text);
  }
  await writeFile(file, Buffer.from([0xff]));
  await assert.rejects(store.snapshot(), isCode('SETTINGS_UNAVAILABLE'));
});

test('symlink and nonregular file/directory refused with safe errors and no target writes', async t => {
  const { store, root, directory, file } = await fixture(t);
  await mkdir(directory);
  const target = join(root, 'target');
  await writeFile(target, 'untouched');
  await symlink(target, file);
  await assert.rejects(store.snapshot(), isCode('SETTINGS_UNAVAILABLE'));
  await assert.rejects(store.save(defaults, 0), isCode('SETTINGS_UNAVAILABLE'));
  assert.equal(await readFile(target, 'utf8'), 'untouched');
  await rm(file);
  await mkdir(file);
  await assert.rejects(store.snapshot(), isCode('SETTINGS_UNAVAILABLE'));
  await rm(file, { recursive: true });
  await rm(directory, { recursive: true });
  await mkdir(join(root, 'actual'));
  await symlink(join(root, 'actual'), directory);
  await assert.rejects(store.snapshot(), isCode('SETTINGS_UNAVAILABLE'));
  await assert.rejects(store.save(defaults, 0), isCode('SETTINGS_UNAVAILABLE'));
  assert.deepEqual(await readdir(join(root, 'actual')), []);
});

test('failed write never updates memory or creates settings; raw filesystem path not leaked', async t => {
  const { store, root, directory } = await fixture(t);
  // Parent is a regular file: deterministic failure, even when tests run as root.
  const blocker = join(root, 'blocker');
  await writeFile(blocker, 'not-directory');
  const broken = createSettingsStore({ directory: join(blocker, 'child'), defaults });
  await assert.rejects(broken.save(defaults, 0), isCode('SETTINGS_UNAVAILABLE'));
  assert.deepEqual(await store.snapshot(), { settings: defaults, revision: 0, source: 'config' });
  assert.deepEqual((await store.save({ cliExecutable: '', managedEnabled: false }, 0)).settings,
    { cliExecutable: '', managedEnabled: false, residentTunnelId: '', residentRemotePort: 0, residentMode: 'off' });
  assert.equal((await createSettingsStore({ directory, defaults }).snapshot()).revision, 1);
});
