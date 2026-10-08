import test from 'node:test';import assert from 'node:assert/strict';
import {registerCarrierWhenAvailable} from '../lib/registration.js';
test('missing or rejecting public carrier API does not break host',async()=>{
 const a=registerCarrierWhenAvailable({});assert.equal(a.status,'ssh-api-required');await a.dispose();
 const b=registerCarrierWhenAvailable({registerSshCarrier(){throw Error('private');}});assert.equal(b.status,'registration-unavailable');await b.dispose();
});
test('throwing optional API getter fails closed with an explicit workspace gate',async()=>{
 const api={get registerSshCarrier(){throw Error('private detail');}};
 const status=registerCarrierWhenAvailable(api);assert.equal(status.status,'ssh-api-required');assert.equal(status.ordinaryWorkspaceReady,false);await status.dispose();
 const rejected=registerCarrierWhenAvailable({registerSshCarrier(){throw Error('private');}});assert.equal(rejected.ordinaryWorkspaceReady,false);await rejected.dispose();
});
test('explicit proposed API registration and lifetime disposal',async()=>{
 let definition,removed=0;const a=registerCarrierWhenAvailable({registerSshCarrier(def){definition=def;return()=>{removed++;};}});
 assert.equal(a.ordinaryWorkspaceReady,false);assert.equal(definition.id,'devtunnel');assert.equal(definition.apiVersion,1);
 const lease=await definition.acquire({machineId:'mac',connector:{kind:'devtunnel',tunnelId:'fixture.jpe1',remotePort:22,endpoint:{host:'127.0.0.1',port:50736}}});
 const task=a.dispose();assert.equal(task,a.dispose());await task;assert.equal(removed,1);assert.throws(()=>lease.dialPort,/STALE_LEASE/);
});
