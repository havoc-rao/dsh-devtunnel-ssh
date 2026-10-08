// Read-only integration against the actual parent registry source. No SSH/network.
import test from 'node:test';import assert from 'node:assert/strict';
import * as api from '../../dsh-remote/lib/ssh-carrier.js';
import {registerCarrierWhenAvailable} from '../lib/registration.js';
const machine=()=>({id:'mac-contract',transport:'ssh',expectedHostFingerprint:'SHA256:fixture-only',connector:{kind:'devtunnel',tunnelId:'fixture.jpe1',remotePort:22,endpoint:{host:'127.0.0.1',port:50736}}});
test('actual parent registry validates independent external lease and preserves SSH machine fields',async()=>{
 const registration=registerCarrierWhenAvailable(api);
 try{
  assert.equal(registration.status,'registered-experimental');assert.ok(api.sshCarrierIds().includes('devtunnel'));
  const m=machine();const lease=await api.acquireSshCarrier(m);
  assert.equal(lease.dialPort,50736);assert.equal(typeof lease.targetIdentity,'string');assert.ok(lease.closed instanceof Promise);
  assert.equal(m.transport,'ssh');assert.equal(m.expectedHostFingerprint,'SHA256:fixture-only');assert.equal('expectedHostFingerprint' in api.sshCarrierOf('devtunnel').sanitizeConnector(m.connector),false);
  await lease.release();
 }finally{await registration.dispose();}
 assert.equal(api.sshCarrierOf('devtunnel'),undefined);
});
test('actual registry rejects mixed config, wrong transport and unknown connector fields',async()=>{
 const registration=registerCarrierWhenAvailable(api);
 try{
  for(const extra of [{useSshConfig:true},{proxy:{host:'fixture'}},{transport:'vscode-tunnel'},{id:''}]) await assert.rejects(api.acquireSshCarrier({...machine(),...extra}));
  for(const extra of [{id:'devtunnel'},{kind:'other'},{expectedHostFingerprint:'secret'},{token:'secret'}]) await assert.rejects(api.acquireSshCarrier({...machine(),connector:{...machine().connector,...extra}}));
 }finally{await registration.dispose();}
});
