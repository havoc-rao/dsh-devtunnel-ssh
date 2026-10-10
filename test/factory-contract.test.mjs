import test from 'node:test';import assert from 'node:assert/strict';
import * as api from '../../dsh-remote/lib/ssh-carrier.js';
import {createCarrierSshPool} from '../../dsh-remote/lib/ssh-carrier-pool.js';
import {registerCarrierWhenAvailable} from '../lib/core/registration.js';
const machine={id:'factory-fixture',transport:'ssh',username:'tester',expectedHostFingerprint:'SHA256:'+'A'.repeat(43),connector:{kind:'devtunnel',tunnelId:'fixture.jpe1',remotePort:22,endpoint:{host:'127.0.0.1',port:50736}}};
test('actual factory forces pin/logical trust and closes pool before adapter lease release',async()=>{
 const reg=registerCarrierWhenAvailable(api);let conf,closeCount=0,order=[];
 const carrier=api.sshCarrierOf('devtunnel');const acquire=carrier.acquire;
 carrier.acquire=async opts=>{const lease=await acquire(opts);return {...lease,release:async()=>{order.push('release');await lease.release();}};};
 class FakePool {constructor(config){conf=config;}connect(){return Promise.resolve();}close(){closeCount++;order.push('close-pty-and-pool');}}
 try{
 const pool=await createCarrierSshPool(machine,{hostKeyMode:'off',host:'malicious',port:22,proxy:{host:'fixture'}},{Pool:FakePool});
 assert.equal(conf.host,'127.0.0.1');assert.equal(conf.port,50736);assert.equal(conf.hostKeyMode,'verify');assert.equal(conf.expectedHostFingerprint,machine.expectedHostFingerprint);assert.equal(conf.proxy,undefined);
 assert.deepEqual(JSON.parse(conf.hostKeyIdentity),['ssh-carrier',machine.id,pool.carrier.targetIdentity]);
 const task=pool.close();await task;assert.equal(pool.close(),task);assert.equal(closeCount,1);assert.deepEqual(order,['close-pty-and-pool','release']);await assert.rejects(pool.connect());
 }finally{await reg.dispose();}
});
test('actual acquisition releases a lease whose dial getter became stale',async()=>{
 const reg=registerCarrierWhenAvailable(api);let releases=0;
 const def=api.sshCarrierOf('devtunnel'),original=def.acquire;
 def.acquire=async opts=>{const lease=await original(opts);await lease.release();return {get dialHost(){return lease.dialHost;},release:async()=>{releases++;await lease.release();}};};
 try{await assert.rejects(api.acquireSshCarrier(machine),/invalid lease/);assert.equal(releases,1);}finally{await reg.dispose();}
});
test('external abort closes factory despite external CLI lifetime being unobserved',async()=>{
 const reg=registerCarrierWhenAvailable(api),controller=new AbortController();let closed=0;
 class FakePool{connect(){return Promise.resolve();}close(){closed++;}}
 try{const pool=await createCarrierSshPool(machine,{},{Pool:FakePool,signal:controller.signal});controller.abort();await Promise.resolve();await pool.close();assert.equal(closed,1);await assert.rejects(pool.connect());}finally{await reg.dispose();}
});
test('factory awaits asynchronous pool cleanup before releasing independent adapter lease',async()=>{
 const reg=registerCarrierWhenAvailable(api);let complete,releases=0;
 const def=api.sshCarrierOf('devtunnel'),original=def.acquire;
 def.acquire=async opts=>{const lease=await original(opts);return {...lease,release:async()=>{releases++;await lease.release();}};};
 class FakePool{connect(){return Promise.resolve();}close(){return new Promise(resolve=>{complete=resolve;});}}
 try{const pool=await createCarrierSshPool(machine,{},{Pool:FakePool});const cleanup=pool.close();await Promise.resolve();assert.equal(releases,0);complete();await cleanup;assert.equal(releases,1);await assert.rejects(pool.connect());}finally{await reg.dispose();}
});
test('throwing underlying pool close still releases carrier and rejects reuse',async()=>{
 const reg=registerCarrierWhenAvailable(api);let releases=0;
 const def=api.sshCarrierOf('devtunnel'),original=def.acquire;
 def.acquire=async opts=>{const lease=await original(opts);return {...lease,release:async()=>{releases++;await lease.release();}};};
 class FakePool{connect(){return Promise.resolve();}close(){throw Error('fixture-close');}}
 try{const pool=await createCarrierSshPool(machine,{},{Pool:FakePool});await assert.rejects(pool.close(),/fixture-close/);assert.equal(releases,1);await assert.rejects(pool.connect());}finally{await reg.dispose();}
});
test('factory pin required and disposed carrier invalidates pool without resurrecting endpoint',async()=>{
 const reg=registerCarrierWhenAvailable(api);let closed=0;
 class FakePool {connect(){return Promise.resolve();}close(){closed++;}}
 try{
 await assert.rejects(createCarrierSshPool({...machine,expectedHostFingerprint:''},{},{Pool:FakePool}));
 const pool=await createCarrierSshPool(machine,{},{Pool:FakePool});await reg.dispose();await Promise.resolve();assert.equal(closed,1);await assert.rejects(pool.connect());await pool.close();
 }finally{await reg.dispose();}
});
