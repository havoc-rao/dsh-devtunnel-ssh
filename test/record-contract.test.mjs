// Source-only gate: record module is not a public package export or CRUD API.
import test from 'node:test';import assert from 'node:assert/strict';
import * as api from '../../dsh-remote/lib/ssh-carrier.js';
import {normalizeCarrierMachine} from '../../dsh-remote/lib/ssh-carrier-record.js';
import {registerCarrierWhenAvailable} from '../lib/registration.js';
const input=()=>({id:'record-fixture',transport:'ssh',username:'tester',expectedHostFingerprint:'SHA256:'+'A'.repeat(43),connector:{kind:'devtunnel',tunnelId:'fixture.jpe1',remotePort:22,endpoint:{host:'127.0.0.1',port:50736}}});
test('normalizer accepts endpoint and mode changes with same canonical descriptor',async()=>{
 const reg=registerCarrierWhenAvailable(api);
 try{
 const saved=normalizeCarrierMachine(input());const id=api.sshConnectorTargetIdentity(saved.connector);
 const changed=normalizeCarrierMachine({connector:{...saved.connector,endpoint:{host:'::1',port:64894}}},saved);assert.equal(api.sshConnectorTargetIdentity(changed.connector),id);
 const managed=normalizeCarrierMachine({connector:{kind:'devtunnel',mode:'managed',tunnelId:'fixture.jpe1',remotePort:22}},changed);assert.equal(api.sshConnectorTargetIdentity(managed.connector),id);
 assert.equal(managed.id,saved.id);assert.equal(managed.hostKeyMode,'verify');
 }finally{await reg.dispose();}
});
test('normalizer rejects target/pin replacement and connector identity or secrets',async()=>{
 const reg=registerCarrierWhenAvailable(api);
 try{
 const saved=normalizeCarrierMachine(input());
 for(const connector of [{...saved.connector,tunnelId:'other.jpe1'},{...saved.connector,remotePort:23}])assert.throws(()=>normalizeCarrierMachine({connector},saved),/target cannot change/);
 assert.throws(()=>normalizeCarrierMachine({expectedHostFingerprint:'SHA256:'+'B'.repeat(42)+'A'},saved),/fingerprint cannot change/);
 for(const extra of [{targetIdentity:'forged'},{token:'fake-secret'},{password:'fake-secret'}])assert.throws(()=>normalizeCarrierMachine({...input(),connector:{...input().connector,...extra}}),/INVALID_CONNECTOR/);
 }finally{await reg.dispose();}
});
test('whitelist excludes top-level routing/trust forgeries but keeps auth outside connector',async()=>{
 const reg=registerCarrierWhenAvailable(api);
 try{
 const saved=normalizeCarrierMachine({...input(),host:'other',port:1,generation:'fake',connectorTargetIdentity:'forged',schemaVersion:3,password:'fixture-password',passphrase:'fixture-passphrase',privateKeyPath:'/fixture/no-key-read',useAgent:true});
 for(const field of ['host','port','generation','connectorTargetIdentity','schemaVersion'])assert.equal(Object.hasOwn(saved,field),false);
 assert.equal(saved.password,'fixture-password');assert.equal(saved.useAgent,true);assert.equal('password' in saved.connector,false);assert.equal('passphrase' in saved.connector,false);
 assert.equal(api.sshConnectorTargetIdentity(saved.connector),JSON.stringify(['devtunnel-target-v1','devtunnel','fixture.jpe1',22]));
 assert.throws(()=>normalizeCarrierMachine({...input(),useSshConfig:true}));assert.throws(()=>normalizeCarrierMachine({...input(),proxy:{host:'fixture'}}));
 }finally{await reg.dispose();}
});
