import test from 'node:test';import assert from 'node:assert/strict';
import {targetIdentity,createCarrier} from '../lib/core/carrier.js';
const connector={kind:'devtunnel',tunnelId:'fixture.jpe1',remotePort:22,endpoint:{host:'127.0.0.1',port:50736}};
test('pure canonical descriptor excludes transient endpoint and managed mode',()=>{
 const identity=targetIdentity(connector);
 assert.equal(identity,targetIdentity({...connector,endpoint:{host:'::1',port:64894}}));
 assert.equal(identity,targetIdentity({kind:'devtunnel',mode:'managed',tunnelId:'fixture.jpe1',remotePort:22}));
 assert.notEqual(identity,targetIdentity({...connector,tunnelId:'fixture.use1'}));
 assert.notEqual(identity,targetIdentity({...connector,remotePort:23}));
 assert.throws(()=>targetIdentity({...connector,targetIdentity:identity}));
 assert.equal(createCarrier().targetIdentity(connector),identity);
 assert.equal(identity,targetIdentity({...connector,channelId:'catalog-a'}));
 assert.equal(identity,targetIdentity({...connector,channelId:'catalog-b'}));
});

test('hostless managed record keeps canonical identity across lease endpoint generations',async t=>{
 const managed={kind:'devtunnel',mode:'managed',tunnelId:'fixture.jpe1',remotePort:22,channelId:'catalog-a'};
 const machine={id:'hostless-machine',transport:'ssh',connector:managed};
 const before=JSON.stringify(machine),canonical=targetIdentity(managed);
 let starts=0;
 const carrier=createCarrier({startManaged:async()=>({
  endpoint:{host:starts++===0?'127.0.0.1':'::1',port:51000+starts},
  closed:new Promise(()=>{}),close:async()=>{},
 })});
 t.after(()=>carrier.dispose());
 const first=await carrier.acquire({machineId:machine.id,connector:machine.connector});
 assert.equal(first.dialHost,'127.0.0.1');assert.equal(first.dialPort,51001);
 const identity=first.targetIdentity,generation=first.generation;
 await first.release();await first.closed;
 assert.throws(()=>first.dialHost,/STALE_LEASE/);
 assert.throws(()=>first.dialPort,/STALE_LEASE/);
 const next=await carrier.acquire({machineId:machine.id,connector:machine.connector});
 assert.equal(next.dialHost,'::1');assert.equal(next.dialPort,51002);
 assert.notEqual(next.generation,generation);assert.equal(next.targetIdentity,identity);
 assert.equal(targetIdentity(machine.connector),canonical);
 assert.equal(JSON.stringify(machine),before);
 for(const field of ['host','port','generation','endpoint'])assert.equal(Object.hasOwn(machine,field),false);
 assert.equal(Object.hasOwn(machine.connector,'endpoint'),false);
 await next.release();
});
