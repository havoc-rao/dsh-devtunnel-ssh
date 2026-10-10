import test from 'node:test';
import assert from 'node:assert/strict';
import { createForwardingParser } from '../lib/output-parser.js';
test('dynamic local port is selected by remote port across arbitrary chunks', () => {
  const values=[]; const p=createForwardingParser({remotePort:22,onForwarding:v=>values.push(v)});
  const input='informational text\nSSH: Forwarding from 127.0.0.1:43127 to host port 43127\nSSH: Forwarding from 127.0.0.1:64894 to host port 22\r\n';
  for (const byte of Buffer.from(input)) p.push(Buffer.from([byte]));
  p.finish();p.finish(); assert.deepEqual(values,[{host:'127.0.0.1',port:64894,remotePort:22}]);
});
test('IPv6 and changed automatic local mapping are supported', () => {
  const values=[];const p=createForwardingParser({remotePort:22,onForwarding:v=>values.push(v)});
  p.push('SSH: Forwarding from [::1]:50736 to host port 22');p.finish();
  assert.deepEqual(values,[{host:'::1',port:50736,remotePort:22}]);
});
test('wildcard, invalid ports, unknown forwarding grammar and huge lines fail closed', () => {
  for(const value of ['SSH: Forwarding from 0.0.0.0:1234 to host port 22','SSH: Forwarding from 127.0.0.1:0 to host port 22','SSH: Forwarding from 127.0.0.1:65536 to host port 22','Forwarding from localhost:22','x'.repeat(4097)]) {
    const p=createForwardingParser({remotePort:22,onForwarding:()=>assert.fail()});
    assert.throws(()=>{p.push(value);p.finish();},/INVALID_FORWARDING_OUTPUT/);
  }
});
test('cumulative output bound, no raw secret in errors', () => {
  const p=createForwardingParser({remotePort:22,onForwarding:()=>{}});
  assert.throws(()=>p.push('private'.repeat(40000)),e=>e.message==='INVALID_FORWARDING_OUTPUT');
});
test('observations name the failure reason without leaking CLI text through the error', () => {
  const seen = [];
  const observe = event => seen.push(event);

  const info = createForwardingParser({ remotePort: 22, onForwarding: () => {}, observe });
  info.push('informational text\n'); info.finish();
  assert.deepEqual(seen.map(event => event.kind), ['info']);
  assert.equal(seen[0].text, 'informational text');

  const unsupported = createForwardingParser({ remotePort: 22, onForwarding: () => assert.fail(), observe });
  assert.throws(() => unsupported.push('SSH: Forwarding from 0.0.0.0:1234 to host port 22\n'),
    error => error.message === 'INVALID_FORWARDING_OUTPUT' && error.reason === 'UNSUPPORTED_FORWARDING');
  assert.equal(seen.at(-1).kind, 'unsupported');

  const mismatch = createForwardingParser({ remotePort: 22, onForwarding: () => assert.fail(), observe });
  mismatch.push('SSH: Forwarding from 127.0.0.1:64894 to host port 23\n');
  assert.equal(seen.at(-1).kind, 'other-port');
  assert.equal(seen.at(-1).reason, 'REMOTE_PORT_MISMATCH');

  assert.throws(() => createForwardingParser({ remotePort: 22, onForwarding: () => {} }).push('x'.repeat(300000)),
    error => error.message === 'INVALID_FORWARDING_OUTPUT' && error.reason === 'BYTE_QUOTA');
  assert.throws(() => createForwardingParser({ remotePort: 22, onForwarding: () => {}, observe }).push('y'.repeat(4097)),
    error => error.reason === 'PENDING_OVERFLOW');
});

test('a throwing observer never changes parsing behaviour', () => {
  const values = [];
  const parser = createForwardingParser({ remotePort: 22, onForwarding: value => values.push(value), observe() { throw new Error('observer down'); } });
  parser.push('SSH: Forwarding from 127.0.0.1:64894 to host port 22\n'); parser.finish();
  assert.deepEqual(values, [{ host: '127.0.0.1', port: 64894, remotePort: 22 }]);
});
test('the sentence-final period the current CLI prints is accepted, nothing looser', () => {
  const values = [];
  const parser = createForwardingParser({ remotePort: 22, onForwarding: value => values.push(value) });
  parser.push('Connection to client tunnel relay restored.\n');
  parser.push('Connected to tunnel: interesting-pond-7vcxn8k.jpe1\n');
  parser.push('SSH: Forwarding from 127.0.0.1:62608 to host port 22.\n');
  parser.finish();
  assert.deepEqual(values, [{ host: '127.0.0.1', port: 62608, remotePort: 22 }]);

  const ipv6 = [];
  const six = createForwardingParser({ remotePort: 22, onForwarding: value => ipv6.push(value) });
  six.push('SSH: Forwarding from [::1]:50736 to host port 22.\r\n'); six.finish();
  assert.deepEqual(ipv6, [{ host: '::1', port: 50736, remotePort: 22 }]);

  // Still fail closed: extra tokens, a second period or a trailing word.
  for (const text of [
    'SSH: Forwarding from 127.0.0.1:62608 to host port 22.5',
    'SSH: Forwarding from 127.0.0.1:62608 to host port 22..',
    'SSH: Forwarding from 127.0.0.1:62608 to host port 22. done',
    'SSH: Forwarding from 0.0.0.0:62608 to host port 22.',
  ]) {
    const strict = createForwardingParser({ remotePort: 22, onForwarding: () => assert.fail() });
    assert.throws(() => { strict.push(text); strict.finish(); }, error => error.reason === 'UNSUPPORTED_FORWARDING', text);
  }
});
