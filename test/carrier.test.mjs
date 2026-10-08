import test from 'node:test';import assert from 'node:assert/strict';
import {createCarrier,validateConnector} from '../lib/carrier.js';
import {startManagedConnect} from '../lib/managed-connect.js';
import {EventEmitter} from 'node:events';
const config=port=>({kind:'devtunnel',tunnelId:'fixture.jpe1',remotePort:22,endpoint:{host:'127.0.0.1',port}});
test('external defaults manual; dynamic port is not logical identity; release never kills CLI',async()=>{
 const c=createCarrier();const a=await c.acquire({machineId:'mac1',connector:config(64894)});
 const identity=a.targetIdentity,generation=a.generation;assert.equal(a.dialPort,64894);await a.release();assert.throws(()=>a.dialPort,/STALE/);
 const b=await c.acquire({machineId:'mac1',connector:config(50736)});assert.equal(b.targetIdentity,identity);assert.notEqual(b.generation,generation);await b.release();await c.dispose();
});
test('machine isolation, active configuration change refusal and abort',async()=>{
 const c=createCarrier(),controller=new AbortController();const a=await c.acquire({machineId:'mac1',connector:config(1234),signal:controller.signal});
 const b=await c.acquire({machineId:'mac2',connector:config(1234)});assert.notEqual(a.targetIdentity,b.targetIdentity);
 await assert.rejects(c.acquire({machineId:'mac1',connector:config(1235)}));controller.abort();await a.closed;assert.throws(()=>a.dialPort);await b.release();await c.dispose();
});
test('managed singleflight refcount and owns only injected start',async()=>{
 let starts=0,closes=0;const c=createCarrier({startManaged:async()=>{starts++;return{endpoint:{host:'127.0.0.1',port:3456},closed:new Promise(()=>{}),close:async()=>{closes++;}};}});
 const connector={kind:'devtunnel',mode:'managed',tunnelId:'fixture',remotePort:22};const [a,b]=await Promise.all([c.acquire({machineId:'mac',connector}),c.acquire({machineId:'mac',connector})]);
 assert.equal(starts,1);await a.release();assert.equal(closes,0);await b.release();assert.equal(closes,1);await c.dispose();
});
test('managed invalid endpoint cleans owned handle; cleanup failure blocks subsequent starts',async()=>{
 let closed=0;const c=createCarrier({startManaged:async()=>({endpoint:{host:'0.0.0.0',port:3456},closed:new Promise(()=>{}),close:async()=>{closed++;}})});
 await assert.rejects(c.acquire({machineId:'mac',connector:{kind:'devtunnel',mode:'managed',tunnelId:'fixture',remotePort:22}}));assert.equal(closed,1);await c.dispose();
 const bad=createCarrier({startManaged:async()=>({endpoint:{host:'127.0.0.1',port:3456},closed:new Promise(()=>{}),close:async()=>{throw Error('private');}})});
 const a=await bad.acquire({machineId:'mac',connector:{kind:'devtunnel',mode:'managed',tunnelId:'fixture',remotePort:22}});
 await assert.rejects(a.release(),/CLEANUP_FAILED/);await assert.rejects(bad.acquire({machineId:'mac',connector:{kind:'devtunnel',mode:'managed',tunnelId:'fixture',remotePort:22}}),/CLEANUP_FAILED/);
});
test('managed process adapter composes with proposed carrier lease contract',async()=>{
 const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.pid=999999;let kills=0;
 child.kill=()=>{kills++;queueMicrotask(()=>child.emit('exit',0));return true;};
 const spawn=()=>{queueMicrotask(()=>child.stdout.emit('data',Buffer.from('SSH: Forwarding from 127.0.0.1:50736 to host port 22\n')));return child;};
 const c=createCarrier({startManaged:opts=>startManagedConnect({...opts,executable:'/fixture/devtunnel',spawn,graceMs:10,killMs:10})});
 const a=await c.acquire({machineId:'mac',connector:{kind:'devtunnel',mode:'managed',tunnelId:'fixture.jpe1',remotePort:22}});
 assert.equal(a.dialPort,50736);await a.release();assert.equal(kills,1);await c.dispose();
});
test('one cancelled concurrent acquire does not abort another owners shared startup',async()=>{
 let complete,sharedSignal,closes=0;const c=createCarrier({startManaged:({signal})=>{sharedSignal=signal;return new Promise(r=>{complete=r;});}});
 const connector={kind:'devtunnel',mode:'managed',tunnelId:'fixture',remotePort:22},controller=new AbortController();
 const cancelled=c.acquire({machineId:'mac',connector,signal:controller.signal});
 const rejected=assert.rejects(cancelled,/ABORTED/);
 const survivor=c.acquire({machineId:'mac',connector});await Promise.resolve();controller.abort();await rejected;
 assert.equal(sharedSignal.aborted,false);
 complete({endpoint:{host:'127.0.0.1',port:3456},closed:new Promise(()=>{}),close:async()=>{closes++;}});
 const lease=await survivor;assert.equal(lease.dialPort,3456);await lease.release();assert.equal(closes,1);await c.dispose();
});
test('dispose during managed startup cleans late handle and does not hand out stale lease',async()=>{
 let complete,closes=0;const c=createCarrier({startManaged:()=>new Promise(r=>{complete=r;})});
 const acquisition=c.acquire({machineId:'mac',connector:{kind:'devtunnel',mode:'managed',tunnelId:'fixture',remotePort:22}});
 const rejected=assert.rejects(acquisition);await Promise.resolve();const disposed=c.dispose();
 complete({endpoint:{host:'127.0.0.1',port:3456},closed:new Promise(()=>{}),close:async()=>{closes++;}});
 await rejected;await disposed;assert.equal(closes,1);await assert.rejects(c.acquire({machineId:'mac',connector:config(1234)}),/DISPOSED/);
});
test('strict connector denies secrets, anonymous, wildcard, and managed endpoint',()=>{
 for(const c of [{...config(1234),token:'secret'},{...config(1234),endpoint:{host:'0.0.0.0',port:1234}},{...config(1234),mode:'managed'}])assert.throws(()=>validateConnector(c),/INVALID_CONNECTOR/);
});
