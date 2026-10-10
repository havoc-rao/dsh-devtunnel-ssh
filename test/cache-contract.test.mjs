// Internal source test only; cache is not a runtime plugin import or public API claim.
import test from 'node:test';import assert from 'node:assert/strict';
import * as api from '../../dsh-remote/lib/ssh-carrier.js';
import {createCarrierSshPool} from '../../dsh-remote/lib/ssh-carrier-pool.js';
import {createCarrierPoolCache} from '../../dsh-remote/lib/ssh-carrier-cache.js';
import {registerCarrierWhenAvailable} from '../lib/core/registration.js';
const machine={id:'cache-fixture',transport:'ssh',username:'tester',expectedHostFingerprint:'SHA256:'+'A'.repeat(43),connector:{kind:'devtunnel',tunnelId:'fixture.jpe1',remotePort:22,endpoint:{host:'127.0.0.1',port:50736}}};
test('actual cache shares pool, revises auth and endpoint, explicit invalidate cleans',async()=>{
 const reg=registerCarrierWhenAvailable(api);let created=0,closed=0;
 class FakePool{constructor(){created++;}connect(){return Promise.resolve();}close(){closed++;}}
 const cache=createCarrierPoolCache({createPool:(m,c,o)=>createCarrierSshPool(m,c,{...o,Pool:FakePool})});
 try{
 const [a,b]=await Promise.all([cache.get(machine,{}),cache.get(machine,{})]);assert.equal(a,b);assert.equal(created,1);
 const changed={...machine,password:'fixture-only'};const c=await cache.get(changed,{});assert.notEqual(c,a);assert.equal(closed,1);
 const d=await cache.get({...changed,connector:{...changed.connector,endpoint:{host:'127.0.0.1',port:64894}}},{});assert.notEqual(d,c);assert.equal(closed,2);
 await cache.invalidate(machine.id);assert.equal(closed,3);
 }finally{await cache.close();await reg.dispose();}
});
test('closed factory triggers cache rebuild rather than stale reuse',async()=>{
 const reg=registerCarrierWhenAvailable(api);let created=0;
 class FakePool{constructor(){created++;}connect(){return Promise.resolve();}close(){}}
 const cache=createCarrierPoolCache({createPool:(m,c,o)=>createCarrierSshPool(m,c,{...o,Pool:FakePool})});
 try{const a=await cache.get(machine,{});await a.close();const b=await cache.get(machine,{});assert.notEqual(a,b);assert.equal(created,2);}finally{await cache.close();await reg.dispose();}
});
