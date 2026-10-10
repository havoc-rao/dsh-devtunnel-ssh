import test from 'node:test';
import assert from 'node:assert/strict';
import { redactLine, formatDiagnostic, createConnectDiagnostics } from '../lib/util/connect-diagnostics.js';

test('redaction masks URLs, secret-looking keys, bearer tokens and long runs', () => {
  assert.equal(redactLine('SSH: Forwarding from 127.0.0.1:55981 to host port 22'), 'SSH: Forwarding from 127.0.0.1:55981 to host port 22');
  assert.equal(redactLine('Visit https://github.com/login/device?user_code=ABCD-1234 to sign in'), 'Visit https://github.com/login/device?<redacted> to sign in');
  assert.equal(redactLine('access token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'), 'access token <redacted>');
  assert.equal(redactLine('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'), 'Authorization <redacted>');
  assert.equal(redactLine('secret=supercalifragilisticexpialidocious'), 'secret <redacted>');
  // Host paths stay readable: the long-run rule deliberately excludes '/'.
  assert.equal(redactLine('/Users/havoc/bin/devtunnel connect fixture.euw'), '/Users/havoc/bin/devtunnel connect fixture.euw');
});

test('redaction bounds length, masks huge runs and strips control characters', () => {
  assert.equal(redactLine('x'.repeat(400)), '<redacted>');
  const long = redactLine('word '.repeat(60).trim());
  assert.ok(long.length <= 241, String(long.length));
  assert.match(long, /…$/u);
  assert.equal(redactLine('a\u0000b\u001fc\u007f'), 'a b c');
});

test('formatDiagnostic renders one bounded line with the sample', () => {
  const text = formatDiagnostic({
    code: 'CONNECT_OUTPUT_REJECTED', reason: 'UNSUPPORTED_FORWARDING', stream: 'stderr',
    lines: 7, bytes: 412, sawForwarding: true, remotePort: 22, tunnelId: 'fixture.euw',
    executable: '/opt/devtunnel', sample: ['SSH: Forwarding from 0.0.0.0:1234 to host port 22'],
  });
  assert.equal(text, 'code=CONNECT_OUTPUT_REJECTED reason=UNSUPPORTED_FORWARDING stream=stderr lines=7 bytes=412 remotePort=22 sawForwarding=true tunnelId=fixture.euw executable=/opt/devtunnel line1="SSH: Forwarding from 0.0.0.0:1234 to host port 22"');
  assert.equal(formatDiagnostic({}), 'code=UNKNOWN');
});

test('the sink receives masked, bounded entries and the ring buffer stays bounded', () => {
  const seen = [];
  const diagnostics = createConnectDiagnostics({ sink: entry => seen.push(entry), maxEntries: 3 });
  const entry = diagnostics.record({
    code: 'CONNECT_OUTPUT_REJECTED', reason: 'UNSUPPORTED_FORWARDING', stream: 'stderr', lines: 2, bytes: 90,
    sawForwarding: true, remotePort: 22, tunnelId: 'fixture.euw', executable: '/opt/devtunnel',
    sample: ['Visit https://github.com/login/device?user_code=ABCD to sign in', 'token: abcdefghijklmnopqrstuvwxyz012345'],
  });
  assert.equal(entry.seq, 1);
  assert.equal(entry.reason, 'UNSUPPORTED_FORWARDING');
  assert.deepEqual(entry.sample, ['Visit https://github.com/login/device?<redacted> to sign in', 'token <redacted>']);
  assert.doesNotMatch(JSON.stringify(seen), /user_code=ABCD|abcdefghijklmnopqrstuvwxyz012345/u);
  for (let i = 0; i < 5; i++) diagnostics.record({ code: 'CONNECT_ATTEMPT_FAILED', reason: 'CONNECT_EXITED', attempt: i + 2 });
  assert.equal(diagnostics.revision, 6);
  assert.equal(diagnostics.snapshot().length, 3);
  assert.deepEqual(diagnostics.snapshot().map(item => item.seq), [4, 5, 6]);
});

test('a hostile or throwing sink never breaks recording and never leaks raw text', () => {
  const diagnostics = createConnectDiagnostics({ sink() { throw new Error('sink down'); } });
  const entry = diagnostics.record({ code: 'CONNECT_READY', endpoint: { host: '127.0.0.1', port: 55981 }, sample: ['ok'] });
  assert.equal(entry.code, 'CONNECT_READY');
  assert.deepEqual(entry.endpoint, { host: '127.0.0.1', port: 55981 });
  // Unknown code shapes are normalized rather than streamed through.
  assert.equal(diagnostics.record({ code: 'lower case with spaces' }).code, 'UNKNOWN');
  assert.equal(diagnostics.record({ code: 'A'.repeat(200) }).code, 'UNKNOWN');
});

test('config values are validated rather than masked, so a diagnostic stays actionable', () => {
  const diagnostics = createConnectDiagnostics({});
  const entry = diagnostics.record({
    code: 'CONNECT_READY', endpoint: { host: '127.0.0.1', port: 62608 },
    tunnelId: 'interesting-pond-7vcxn8k.jpe1', executable: '/opt/homebrew/bin/devtunnel',
  });
  assert.equal(entry.tunnelId, 'interesting-pond-7vcxn8k.jpe1');
  assert.equal(entry.executable, '/opt/homebrew/bin/devtunnel');
  assert.equal(formatDiagnostic(entry), 'code=CONNECT_READY endpoint=127.0.0.1:62608 tunnelId=interesting-pond-7vcxn8k.jpe1 executable=/opt/homebrew/bin/devtunnel');

  // Anything that is not the validated shape is dropped instead of echoed.
  for (const tunnelId of ['Bad/Id', 'UPPER.CASE', 'a'.repeat(200), '--flag', 'x'.repeat(102), '']) {
    assert.equal(diagnostics.record({ code: 'CONNECT_ATTEMPT_FAILED', tunnelId }).tunnelId, undefined, tunnelId);
  }
  for (const executable of ['devtunnel', 'C:\\Tools\\devtunnel.exe', '/opt/a\u0000b', '/x'.repeat(3000)]) {
    assert.equal(diagnostics.record({ code: 'CONNECT_ATTEMPT_FAILED', executable }).executable, undefined, executable);
  }
});

test('a machine id is validated like other config values and survives masking', () => {
  const diagnostics = createConnectDiagnostics({});
  const entry = diagnostics.record({
    code: 'CHANNEL_LEASED', machineId: 'mac-mini', mode: 'managed', tunnelId: 'interesting-pond-7vcxn8k.jpe1',
    remotePort: 22, endpoint: { host: '127.0.0.1', port: 62771 }, stream: 'ssh',
  });
  assert.equal(entry.machineId, 'mac-mini');
  assert.match(formatDiagnostic(entry), /machineId=mac-mini/u);
  for (const machineId of ['bad id', '../etc', '', 'a'.repeat(200), 42]) {
    assert.equal(diagnostics.record({ code: 'CHANNEL_RELEASED', machineId }).machineId, undefined, String(machineId));
  }
});
