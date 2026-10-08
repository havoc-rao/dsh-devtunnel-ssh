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
