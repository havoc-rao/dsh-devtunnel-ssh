import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { apply } from '../lib/index.js';

test('actual entry Settings API updates registry capabilities and survives reload without CLI',async()=>{
 const previous=process.env.DSH_HOME;
 process.env.DSH_HOME=mkdtempSync(path.join(tmpdir(),'devtunnel-settings-entry-'));
 const executable=path.join(process.env.DSH_HOME,'fake-devtunnel');writeFileSync(executable,'fixture-not-executed',{mode:0o700});
 const boot=async(config={})=>{
   const routes=new Map(),cleanup=[];let carrier;
   const ctx={inject(_names,fn){fn(ctx);},effect:fn=>cleanup.push(fn()),get:name=>name==='webServer'?{register:def=>{routes.set(def.path,def.handler);return()=>routes.delete(def.path);}}:name==='loader'?{import:async()=>({registerSshCarrier:def=>{carrier={...def};return()=>{};}})}:undefined};
   await apply(ctx,config);
   const call=async(method,body)=>{let result;const res={statusCode:0,setHeader(){},end(text){result=JSON.parse(text);}};
     await routes.get('/dsh-devtunnel-ssh/settings')(Object.assign(Readable.from(body?[JSON.stringify(body)]:[]),{method}),res);return {status:res.statusCode,...result};};
   return {carrier,call,close:async()=>{for(const fn of cleanup.reverse())await fn();},diagnostics:async method=>{let result;const res={statusCode:0,setHeader(){},end(text){result=JSON.parse(text);}};
     await routes.get('/dsh-devtunnel-ssh/diagnostics')(Object.assign(Readable.from([]),{method}),res);return {status:res.statusCode,...result};}};
 };
 try {
   const first=await boot();const initial=await first.call('GET');assert.equal(initial.revision,0);assert.equal(first.carrier.capabilities.managedConnect,false);
   const saved=await first.call('POST',{cliExecutable:executable,managedEnabled:true,residentTunnelId:'',residentRemotePort:0,residentMode:'off',revision:0,confirmed:true,disconnectActive:false});
     assert.equal(saved.status,200);assert.equal(saved.source,'settings');assert.equal(saved.revision,1);assert.equal(first.carrier.capabilities.managedConnect,true);
     assert.equal((await first.call('POST',{cliExecutable:'/fixture/other',managedEnabled:true,residentTunnelId:'',residentRemotePort:0,residentMode:'off',revision:0,confirmed:true,disconnectActive:false})).error,'SETTINGS_REVISION_CONFLICT');
   await first.close();assert.equal(first.carrier.capabilities.managedConnect,false);
   const second=await boot({cliExecutable:'/fixture/config',managedEnabled:false});
   const persisted=await second.call('GET');assert.equal(persisted.settings.cliExecutable,executable);assert.equal(persisted.settings.managedEnabled,true);
   assert.equal(second.carrier.capabilities.managedConnect,true);await second.close();
 }finally {if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;}
});

test('actual entry installs the read-only diagnostics route before any connect happens',async()=>{
 const previous=process.env.DSH_HOME;
 process.env.DSH_HOME=mkdtempSync(path.join(tmpdir(),'devtunnel-diagnostics-entry-'));
 try {
   const routes=new Map(),cleanup=[];
   const ctx={inject(_names,fn){fn(ctx);},effect:fn=>cleanup.push(fn()),get:name=>name==='webServer'?{register:def=>{routes.set(def.path,def.handler);return()=>routes.delete(def.path);}}:name==='loader'?{import:async()=>({registerSshCarrier:()=>()=>{}})}:undefined};
   await apply(ctx,{});
   assert.ok(routes.has('/dsh-devtunnel-ssh/diagnostics'),'diagnostics route installed alongside settings');
   assert.ok(routes.has('/dsh-devtunnel-ssh/channels'),'channel management route installed alongside settings');
   const channels=async method=>{let result;const res={statusCode:0,setHeader(){},end(text){result=JSON.parse(text);}};
     await routes.get('/dsh-devtunnel-ssh/channels')(Object.assign(Readable.from([]),{method}),res);return {status:res.statusCode,...result};};
   const listed=await channels('GET');assert.equal(listed.status,200);assert.equal(listed.ok,true);
     assert.equal(listed.enabled,false);assert.equal(listed.activeManaged,0);assert.deepEqual(listed.channels,[]);assert.deepEqual(listed.supervisor,[]);assert.deepEqual(listed.recent,[]);
     assert.deepEqual(listed.resident,{enabled:false,mode:'off'});
   const stopped=await channels('POST');assert.equal(stopped.status,400);assert.equal(stopped.error,'CHANNELS_REJECTED');
   const get=async method=>{let result;const res={statusCode:0,setHeader(){},end(text){result=JSON.parse(text);}};
     await routes.get('/dsh-devtunnel-ssh/diagnostics')(Object.assign(Readable.from([]),{method}),res);return {status:res.statusCode,...result};};
   const empty=await get('GET');assert.equal(empty.status,200);assert.equal(empty.ok,true);assert.equal(empty.revision,0);assert.deepEqual(empty.entries,[]);
   const denied=await get('POST');assert.equal(denied.status,405);assert.equal(denied.error,'METHOD_NOT_ALLOWED');
   for(const fn of cleanup.reverse())await fn();
   assert.equal(routes.size,0,'routes are removed with the plugin effect');
 }finally {if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;}
});
