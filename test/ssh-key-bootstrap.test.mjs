import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile, mkdir, lstat, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { bootstrapCarrierKey } from '../../dsh-remote/lib/ssh-key-bootstrap.js';
import { spawnSync } from 'node:child_process';

const fingerprint = `SHA256:${Buffer.alloc(32, 7).toString('base64').replace(/=+$/, '')}`;
const publicBlob = Buffer.concat([Buffer.from([0, 0, 0, 11]), Buffer.from('ssh-ed25519'), Buffer.from([0, 0, 0, 32]), Buffer.alloc(32, 5)]).toString('base64');
const secret = 'do-not-leak-password';
async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'bootstrap-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [], pools = [];
  const machine = { id: 'carrier-one', username: 'alice', connector: { type: 'test', targetIdentity: 'mac-target' }, expectedHostFingerprint: fingerprint, password: 'stale-secret', privateKeyPath: '/do/not/read', passphrase: 'stale-phrase', useAgent: true, keyboardInteractive: true, backend: 'openssh', useSshConfig: true, hostKeyMode: 'off' };
  const createPool = async (record, config, opts) => {
    const index = pools.length;
    calls.push({ record, config, opts });
    if (options.acquireError) throw new Error(secret);
    const pool = {
      closed: 0, commands: [], connects: 0, sftpCalls: 0,
      async connect() { this.connects++; if (options.connectError === index) throw new Error(secret); },
      async _execRaw(command, opts) {
        this.commands.push({ command, opts });
        if (options.rawError && command.startsWith('#!/bin/sh')) throw new Error(`disconnect ${secret}`);
        if (command === 'uname -s') return { code: 0, stdout: options.platform || 'Darwin\n' };
        if (command.startsWith('/usr/bin/dscl')) return { code: 0, stdout: '/Users/alice\n' };
        if (options.installTimeout) return { code: -1, signal: 'TIMEOUT', stderr: secret };
        if (options.installFailure) return { code: 1, stderr: secret };
        return { code: 0, stdout: 'ok' };
      },
      async sftp() { this.sftpCalls++; if (options.sftpError) throw new Error(secret); return { stat: async p => { assert.equal(p, '/Users/alice'); return { isDirectory: () => true }; } }; },
      async close() { this.closed++; if (options.closeError) throw new Error(secret); },
    };
    pools.push(pool);
    return pool;
  };
  const generateKey = async ({ privateKeyPath, publicKeyPath }) => {
    if (options.generateError) throw new Error(secret);
    await writeFile(privateKeyPath, 'private-test-material', { mode: 0o600 });
    await writeFile(publicKeyPath, `ssh-ed25519 ${publicBlob} test\n`, { mode: 0o600 });
  };
  return { root, machine, pools, calls, args: { machine, password: secret, config: { connectTimeoutMs: 100, commandTimeoutMs: 100, privateKeyPath: '/config-key', password: 'config-secret', useAgent: true, keyboardInteractive: true, hostKeyMode: 'off' }, knownHostsFile: '/test/known-hosts', keyRoot: path.join(root, 'keys'), createPool, generateKey } };
}

test('pinned password-only bootstrap, independent strict key-only verification and private storage', async t => {
  const f = await fixture(t);
  const result = await bootstrapCarrierKey(f.args);
  assert.equal(result.remoteMayBeAuthorized, true);
  assert.equal((await lstat(path.dirname(result.privateKeyPath))).mode & 0o777, 0o700);
  assert.equal((await lstat(result.privateKeyPath)).mode & 0o777, 0o600);
  assert.equal(JSON.stringify(result).includes('private-test-material'), false);
  assert.equal(f.calls.length, 2);
  for (const c of f.calls) {
    assert.equal(c.record.id, f.machine.id);
    assert.deepEqual(c.record.connector, f.machine.connector);
    assert.equal(c.record.expectedHostFingerprint, fingerprint);
    assert.equal(c.config.expectedHostFingerprint, fingerprint);
    assert.equal(c.opts.knownHostsFile, '/test/known-hosts');
    for (const object of [c.record, c.config]) {
      assert.equal(object.password, ''); assert.equal(object.passphrase, '');
      assert.equal(object.useAgent, false); assert.equal(object.keyboardInteractive, false);
      assert.equal(object.hostKeyMode, 'verify'); assert.equal(object.backend, 'native');
      assert.equal(object.useSshConfig, false); assert.equal(object.proxy, undefined);
    }
  }
  assert.equal(f.calls[0].record.privateKeyPath, '');
  assert.equal(f.calls[0].config.privateKeyPath, '');
  assert.equal(await f.calls[0].opts.credentialResolver(), secret);
  assert.equal(f.calls[1].record.privateKeyPath, result.privateKeyPath);
  assert.equal(f.calls[1].config.privateKeyPath, result.privateKeyPath);
  assert.equal(await f.calls[1].opts.credentialResolver(), '');
  assert.equal(f.machine.password, 'stale-secret');
  for (const p of f.pools) {
    assert.equal(p.connects, 1); assert.equal(p.closed, 1);
    assert.ok(p.commands.every(c => c.opts.passive === true && c.opts.signal));
  }
  assert.equal(f.pools[1].sftpCalls, 1);
  const script = f.pools[0].commands.find(c => c.command.startsWith('#!/bin/sh')).command;
  for (const fragment of ['assert_no_symlink', 'authorizedkeyscommand', 'validate_apple_crypto', 'cmp -s', 'backup', '/bin/mv -f', '/bin/chmod 600', '/bin/chmod 700']) assert.ok(script.includes(fragment));
  assert.equal(script.includes(secret), false);
  assert.equal(spawnSync('/bin/sh', ['-n'], { input: script, encoding: 'utf8' }).status, 0);
});

for (const platform of ['Linux', 'Windows_NT', '']) test(`fail closed for non-Darwin ${platform || 'empty'}`, async t => {
  const f = await fixture(t, { platform: platform || '\n' });
  await assert.rejects(bootstrapCarrierKey(f.args), e => e.phase === 'platform' && !e.remoteMayBeAuthorized && !e.privateKeyPath);
  assert.equal(f.calls.length, 1); assert.equal(f.pools[0].closed, 1);
});

for (const option of ['installFailure', 'installTimeout', 'rawError', 'sftpError', 'closeError', 'generateError']) test(`${option} sanitized, keys retained, pools closed without install replay`, async t => {
  const f = await fixture(t, { [option]: true });
  await assert.rejects(bootstrapCarrierKey(f.args), asyncError => {
    assert.equal(asyncError.code, 'SSH_KEY_BOOTSTRAP_FAILED');
    assert.equal(JSON.stringify(asyncError).includes(secret), false);
    assert.equal(asyncError.message.includes(secret), false);
    assert.ok(asyncError.privateKeyPath);
    assert.equal(asyncError.remoteMayBeAuthorized, option !== 'generateError');
    return true;
  });
  assert.ok(f.pools.every(p => p.closed === 1));
  assert.ok(f.pools[0].commands.filter(c => c.command.startsWith('#!/bin/sh')).length <= 1);
  if (['installFailure', 'installTimeout', 'rawError'].includes(option)) assert.equal(f.calls.length, 1);
});

test('key auth connection failure never falls back to password', async t => {
  const f = await fixture(t, { connectError: 1 });
  await assert.rejects(bootstrapCarrierKey(f.args), e => e.phase === 'key-connect' && e.remoteMayBeAuthorized);
  assert.equal(f.calls.length, 2);
  assert.equal(await f.calls[1].opts.credentialResolver(), '');
  assert.ok(f.pools.every(p => p.closed === 1));
});

test('bad/missing host fingerprint rejected before acquiring a pool', async t => {
  const f = await fixture(t);
  delete f.machine.expectedHostFingerprint;
  await assert.rejects(bootstrapCarrierKey(f.args), e => e.phase === 'validate');
  assert.equal(f.calls.length, 0);
});

test('unsafe local key root rejected before authorization', async t => {
  const f = await fixture(t);
  await mkdir(f.args.keyRoot, { mode: 0o755 });
  await assert.rejects(bootstrapCarrierKey(f.args), e => e.phase === 'generate-key' && !e.remoteMayBeAuthorized);
  assert.equal(f.pools[0].closed, 1);
});

test('symlink local key root rejected before authorization', async t => {
  const f = await fixture(t);
  await symlink(f.root, f.args.keyRoot);
  await assert.rejects(bootstrapCarrierKey(f.args), e => e.phase === 'generate-key' && !e.remoteMayBeAuthorized);
});

test('bounded connect timeout closes pool and never authorizes', async t => {
  const f = await fixture(t);
  const create = f.args.createPool;
  f.args.config.connectTimeoutMs = 10;
  f.args.createPool = async (...args) => { const p = await create(...args); p.connect = () => new Promise(() => {}); return p; };
  await assert.rejects(bootstrapCarrierKey(f.args), e => e.phase === 'password-connect' && !e.remoteMayBeAuthorized);
  assert.equal(f.pools[0].closed, 1);
  assert.equal(f.pools[0].commands.length, 0);
});

test('default generator writes real OpenSSH Ed25519 pair locally', async t => {
  const f = await fixture(t);
  delete f.args.generateKey;
  const result = await bootstrapCarrierKey(f.args);
  assert.match(await readFile(result.privateKeyPath, 'utf8'), /^-----BEGIN OPENSSH PRIVATE KEY-----/);
  assert.match(await readFile(`${result.privateKeyPath}.pub`, 'utf8'), /^ssh-ed25519 /);
});
