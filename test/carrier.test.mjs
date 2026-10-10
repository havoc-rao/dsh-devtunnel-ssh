import test from 'node:test';import assert from 'node:assert/strict';
import {createCarrier,validateConnector} from '../lib/core/carrier.js';
import {startManagedConnect} from '../lib/core/managed-connect.js';
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
test('closed managed generation waits for cleanup then discovers a new port and generation',async()=>{
  let markClosed,finishCleanup,starts=0;
  const c=createCarrier({startManaged:async()=>{
    starts++;
    return {endpoint:{host:'127.0.0.1',port:5000+starts},
      closed:starts===1?new Promise(r=>{markClosed=r;}):new Promise(()=>{}),
      close:starts===1?()=>new Promise(r=>{finishCleanup=r;}):async()=>{}};
  }});
  const connector={kind:'devtunnel',mode:'managed',tunnelId:'fixture',remotePort:22};
  const first=await c.acquire({machineId:'mac',connector});
  markClosed(); await first.closed; assert.throws(()=>first.dialPort,/STALE_LEASE/);
  const next=c.acquire({machineId:'mac',connector});
  await new Promise(r=>setImmediate(r)); assert.equal(starts,1);
  finishCleanup(); const second=await next;
  assert.equal(second.dialPort,5002); assert.notEqual(second.generation,first.generation);
  assert.equal(second.targetIdentity,first.targetIdentity);
  await first.release(); await second.release(); await c.dispose();
});
test('managed acquisition preserves only safe diagnostics and releases failed entries',async()=>{
  const connector={kind:'devtunnel',mode:'managed',tunnelId:'fixture',remotePort:22};
  const unavailable=createCarrier();
  await assert.rejects(unavailable.acquire({machineId:'mac',connector}),{code:'MANAGED_UNAVAILABLE',message:'MANAGED_UNAVAILABLE'});
  await unavailable.dispose();
  for(const code of ['INVALID_MANAGED_CONFIG','CONNECT_ABORTED','CONNECT_CLOSED','CONNECT_SPAWN_FAILED',
    'CONNECT_EXITED','CONNECT_STARTUP_TIMEOUT','CONNECT_OUTPUT_REJECTED','CONNECT_ADAPTER_FAILED',
    'CONNECT_CLEANUP_FAILED','CONNECT_TARGET_BUSY','CONNECT_RETRY_EXHAUSTED','PRIVATE_TOKEN_VALUE',undefined]) {
    let starts=0;
    const c=createCarrier({startManaged:async()=>{starts++;throw Object.assign(new Error('private CLI output'),{code});}});
    const expected=code && code!=='PRIVATE_TOKEN_VALUE'?code:'ACQUIRE_FAILED';
    for(let attempt=0;attempt<2;attempt++) {
      await assert.rejects(c.acquire({machineId:'mac',connector}),error=>{
        assert.equal(error.code,expected);assert.equal(error.message,expected);
        assert.equal(error.cause,undefined);return true;
      });
      assert.equal(c.activeManaged,0);
    }
    assert.equal(starts,2);await c.dispose();
  }
});
test('managed cleanup failure remains visible even during caller cancellation',async()=>{
  let rejectStart;const controller=new AbortController();
  const c=createCarrier({startManaged:()=>new Promise((_,reject)=>{rejectStart=reject;})});
  const acquisition=c.acquire({machineId:'mac',connector:{kind:'devtunnel',mode:'managed',tunnelId:'fixture',remotePort:22},signal:controller.signal});
  const rejected=assert.rejects(acquisition,{code:'CONNECT_CLEANUP_FAILED'});
  await Promise.resolve();
  rejectStart(Object.assign(new Error('private'),{code:'CONNECT_CLEANUP_FAILED'}));
  queueMicrotask(()=>controller.abort());
  await rejected;await c.dispose();
});
test('strict connector denies secrets, anonymous, wildcard, and managed endpoint',()=>{
 for(const c of [{...config(1234),token:'secret'},{...config(1234),endpoint:{host:'0.0.0.0',port:1234}},{...config(1234),mode:'managed'}])assert.throws(()=>validateConnector(c),/INVALID_CONNECTOR/);
});
test('snapshot lists live channel identity and stopManaged owns the cleanup',async()=>{
  let closes=0;
  const c=createCarrier({startManaged:async()=>({endpoint:{host:'127.0.0.1',port:53162},closed:new Promise(()=>{}),close:async()=>{closes++;}})});
  const ext=await c.acquire({machineId:'mac-ext',connector:config(64894)});
  const managed=await c.acquire({machineId:'mac-managed',connector:{kind:'devtunnel',mode:'managed',tunnelId:'fixture.jpe1',remotePort:22}});
  const snapshot=c.snapshot();
  assert.deepEqual(snapshot.map(entry=>[entry.machineId,entry.mode,entry.tunnelId,entry.remotePort,entry.state,entry.endpoint]),
    [['mac-ext','external','fixture.jpe1',22,'ready',{host:'127.0.0.1',port:64894}],
     ['mac-managed','managed','fixture.jpe1',22,'ready',{host:'127.0.0.1',port:53162}]]);
  assert.ok(Number.isSafeInteger(snapshot[0].since)&&snapshot[0].since>0);
  assert.equal(typeof snapshot[0].generation,'string');
  assert.equal(c.activeManaged,1);

  const stopped=await c.stopManaged('mac-managed');
  assert.deepEqual(stopped,{machineId:'mac-managed',mode:'managed',tunnelId:'fixture.jpe1',remotePort:22});
  assert.equal(closes,1);
  assert.deepEqual(c.snapshot().map(entry=>entry.machineId),['mac-ext']);
  await assert.rejects(c.stopManaged('mac-managed'),/CHANNEL_NOT_FOUND/);
  for(const bad of ['','../etc','a'.repeat(200),42])await assert.rejects(c.stopManaged(bad),/INVALID_MACHINE_ID/);
  await ext.release();await managed.release().catch(()=>{});await c.dispose();
  assert.deepEqual(c.snapshot(),[]);
});
test('lease handoff events make the SSH layer use of a channel visible',async()=>{
  const events=[];const diagnostics={record:entry=>events.push(entry)};
  const c=createCarrier({diagnostics,startManaged:async()=>({endpoint:{host:'127.0.0.1',port:53162},closed:new Promise(()=>{}),close:async()=>{}})});
  const lease=await c.acquire({machineId:'mac-mini',connector:{kind:'devtunnel',mode:'managed',tunnelId:'interesting-pond-7vcxn8k.jpe1',remotePort:22}});
  assert.deepEqual(events.map(event=>event.code),['CHANNEL_LEASED']);
  assert.deepEqual(events[0],{code:'CHANNEL_LEASED',machineId:'mac-mini',mode:'managed',tunnelId:'interesting-pond-7vcxn8k.jpe1',remotePort:22,endpoint:{host:'127.0.0.1',port:53162},generation:lease.generation,stream:'ssh'});
  await lease.release();
  assert.deepEqual(events.map(event=>event.code),['CHANNEL_LEASED','CHANNEL_RELEASED']);
  assert.equal(events[1].endpoint,undefined);

  // Two holders share one channel: only the last release is a handoff end.
  const shared=await c.acquire({machineId:'mac-mini',connector:{kind:'devtunnel',mode:'managed',tunnelId:'interesting-pond-7vcxn8k.jpe1',remotePort:22}});
  const second=await c.acquire({machineId:'mac-mini',connector:{kind:'devtunnel',mode:'managed',tunnelId:'interesting-pond-7vcxn8k.jpe1',remotePort:22}});
  await shared.release();
  assert.equal(events.filter(event=>event.code==='CHANNEL_RELEASED').length,1);
  await second.release();
  assert.equal(events.filter(event=>event.code==='CHANNEL_RELEASED').length,2);

  const third=await c.acquire({machineId:'mac-mini',connector:{kind:'devtunnel',mode:'managed',tunnelId:'interesting-pond-7vcxn8k.jpe1',remotePort:22}});
  await c.stopManaged('mac-mini');
  assert.equal(events.at(-1).code,'CHANNEL_STOPPED');
  assert.match(events.map(event=>event.code).join(','),/CHANNEL_LEASED,CHANNEL_RELEASED,CHANNEL_LEASED,CHANNEL_LEASED,CHANNEL_RELEASED,CHANNEL_LEASED,CHANNEL_STOPPED/u);
  await third.release().catch(()=>{});
  await c.dispose();
});

test('a throwing diagnostics sink never affects acquisition or release',async()=>{
  const c=createCarrier({diagnostics:{record(){throw new Error('sink down');}},startManaged:async()=>({endpoint:{host:'127.0.0.1',port:1},closed:new Promise(()=>{}),close:async()=>{}})});
  const lease=await c.acquire({machineId:'mac',connector:{kind:'devtunnel',mode:'managed',tunnelId:'fixture',remotePort:22}});
  assert.equal(lease.dialPort,1);
  await lease.release();await c.dispose();
});
