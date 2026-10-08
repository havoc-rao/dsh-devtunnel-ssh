import test from 'node:test';
import assert from 'node:assert/strict';
import { connectCommand, publicStatus } from '../lib/cli-policy.js';

test('CLI argv uses exact explicit target, no shell, no guessed remap', () => {
  const result = connectCommand({ executable: '/approved path/devtunnel', tunnelId: 'test-only.jpe1' });
  assert.deepEqual(result.args, ['connect', 'test-only.jpe1']);
  assert.equal(result.shell, false);
  assert.ok(Object.isFrozen(result.args));
});
test('reject tokens, anonymous switches, remap and implicit target', () => {
  for (const tunnelId of ['', undefined, '-a', 'x;pwd', 'x\ny', 'https://x', 'x y']) {
    assert.throws(() => connectCommand({ executable: '/bin/devtunnel', tunnelId }), /INVALID_CONNECT_CONFIG/);
  }
  for (const extra of [{ token: 'never-log' }, { localPort: 2222 }, { allowAnonymous: true }]) {
    assert.throws(() => connectCommand({ executable: '/bin/devtunnel', tunnelId: 'fixture', ...extra }));
  }
  assert.throws(() => connectCommand({ executable: 'devtunnel', tunnelId: 'fixture' }));
});
test('reject trailing line terminators rather than accepting dollar-anchor suffix', () => {
  for (const suffix of ['\n', '\r', '\r\n', '\u2028', '\u2029']) {
    assert.throws(() => connectCommand({ executable: '/bin/devtunnel', tunnelId: `fixture${suffix}` }), /INVALID_CONNECT_CONFIG/);
  }
});
test('reject malformed configs without invoking accessors or exposing raw failures', () => {
  let reads = 0;
  const accessor = { executable: '/bin/devtunnel', get tunnelId() { reads++; throw Error('secret'); } };
  const proxy = new Proxy({}, { getPrototypeOf() { throw Error('secret'); } });
  const unknownSymbol = { executable: '/bin/devtunnel', tunnelId: 'fixture', [Symbol('token')]: 'secret' };
  for (const config of [null, undefined, [], 'text', accessor, proxy, unknownSymbol, Object.create({ executable: '/bin/devtunnel', tunnelId: 'fixture' })]) {
    assert.throws(() => connectCommand(config), error => error.message === 'INVALID_CONNECT_CONFIG');
  }
  assert.equal(reads, 0);
});
test('public status cannot contain CLI errors or claim trusted SSH readiness', () => {
  assert.deepEqual(publicStatus('secret example'), { state: 'unavailable', productionReady: false });
  assert.equal(publicStatus('ready').state, 'unavailable');
});
