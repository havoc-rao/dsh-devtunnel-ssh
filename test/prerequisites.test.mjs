import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPrerequisites, parsePrerequisiteResult } from '../lib/prerequisites.js';
const installed = { code: 0, stdout: '1.0.2086+eb5ddeb517\n', stderr: '' };
const help = { code: 0, stdout: 'Usage: devtunnel user show [options]\n', stderr: '' };
const config = { executable: '/fixture/devtunnel', timeoutMs: 20 };
test('default only requests version and help, never login or installation', async () => {
  const calls = [];
  const value = await checkPrerequisites({ ...config, run: async (...args) => { calls.push(args); return calls.length === 1 ? installed : help; } });
  assert.deepEqual(value, { status: 'installed', version: '1.0.2086', login: 'unknown', loginCheckSupported: true });
  assert.deepEqual(calls.map(call => call.slice(0, 2)), [['/fixture/devtunnel', ['--version']], ['/fixture/devtunnel', ['user', 'show', '--help']]]);
  for (const call of calls) assert.deepEqual(call[2], { shell: false, stdio: ['ignore', 'pipe', 'pipe'], timeoutMs: 20, maxOutputBytes: 65536 });
});
test('login requires explicit boolean opt-in and never exposes identity', async () => {
  const calls = [];
  const value = await checkPrerequisites({ ...config, checkLogin: true, run: async (executable, args) => {
    calls.push(args); return calls.length === 1 ? installed : calls.length === 2 ? help : { code: 0, stdout: 'Logged in as private-account\n' };
  } });
  assert.equal(value.login, 'logged-in'); assert.equal(JSON.stringify(value).includes('private-account'), false);
  assert.deepEqual(calls[2], ['user', 'show']);
});
test('missing CLI, raw runner failures and unsupported output are sanitized', async () => {
  let calls = 0;
  assert.deepEqual(await checkPrerequisites({ ...config, run: async () => { calls++; throw Object.assign(Error('private-token'), { code: 'ENOENT' }); } }), { status: 'not-installed', login: 'unknown' });
  assert.equal(calls, 1);
  assert.deepEqual(await checkPrerequisites({ ...config, run: async () => { throw Error('private-token'); } }), { status: 'unknown', login: 'unknown' });
  assert.deepEqual(parsePrerequisiteResult('version', { code: 0, stdout: 'private-token' }), { status: 'unknown' });
});
test('unknown help cannot authorize user show; no timeout retries', async () => {
  const calls = [];
  const value = await checkPrerequisites({ ...config, checkLogin: true, run: async (_, args) => { calls.push(args); return calls.length === 1 ? installed : { code: 0, stdout: 'unknown' }; } });
  assert.equal(value.login, 'unknown'); assert.equal(calls.length, 2);
  let count = 0;
  assert.deepEqual(await checkPrerequisites({ ...config, timeoutMs: 5, run: () => { count++; return new Promise(() => {}); } }), { status: 'unknown', login: 'unknown' });
  assert.equal(count, 1);
});
test('official multiline version extracts one numeric version and discards service output', () => {
  const stdout = 'Tunnel CLI version: 1.0.2086+eb5ddeb517\n\nTunnel service URI: https://example.invalid/\nTunnel service update: fixture-only\n';
  assert.deepEqual(parsePrerequisiteResult('version', { code: 0, stdout }), { status: 'installed', version: '1.0.2086' });
  for (const suffix of ['Tunnel CLI version: 1.0.2086+eb5ddeb517\n', 'Tunnel CLI version: 2.0.0\n', 'Tunnel CLI version: private-token\n']) {
    assert.deepEqual(parsePrerequisiteResult('version', { code: 0, stdout: stdout + suffix }), { status: 'unknown' });
  }
});
test('parser is bounded, strict and only returns allowlisted statuses', () => {
  assert.deepEqual(parsePrerequisiteResult('login', { code: 0, stdout: 'Not logged in\n' }), { status: 'not-logged-in' });
  for (const value of [{ code: 1, stdout: 'Logged in as account' }, { code: 0, stdout: 'Logged in as a\nprivate-token\n' }, { code: 0, stdout: 'x'.repeat(65537) }, { code: 0, get stdout() { throw Error('private-token'); } }]) {
    assert.deepEqual(parsePrerequisiteResult('login', value), { status: 'unknown' });
  }
});
test('invalid inputs never invoke runner and there is no default real runner', async () => {
  for (const extra of [{ executable: 'devtunnel' }, { executable: '/bin/devtunnel\n' }, { checkLogin: 'true' }, { timeoutMs: Infinity }]) {
    await assert.rejects(checkPrerequisites({ ...config, ...extra, run() { assert.fail(); } }), /INVALID_PREREQUISITE_CONFIG/);
  }
  await assert.rejects(checkPrerequisites(config), /INVALID_PREREQUISITE_CONFIG/);
});
