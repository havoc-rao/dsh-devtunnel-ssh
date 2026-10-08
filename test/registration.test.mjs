import test from 'node:test';import assert from 'node:assert/strict';
import {applyWithLoader,loadCarrierApi} from '../lib/index.js';
test('optional API unavailable leaves host intact',async()=>{
 assert.equal(await loadCarrierApi(async()=>{throw Error('private');}),undefined);
 await applyWithLoader({get:()=>undefined},async()=>{assert.fail('no lifecycle');});
});
test('independent entry safely registers diagnostic and carrier with owned disposers',async()=>{
 let def,removed=0,carrier,cleanups=[],defs=new Map();
 await applyWithLoader({get:key=>{assert.equal(key,'commands');return {register(value){defs.set(value.name,value);if(value.name==='devtunnel-ssh-status')def=value;return()=>removed++;}};},effect(fn){cleanups.push(fn());}},async()=>({registerSshCarrier(value){carrier=value;return()=>removed++;}}));
 assert.equal(carrier.id,'devtunnel');assert.match(def.name,/^[a-z][a-z0-9_-]*$/u);
 assert.match((await def.handler()).text,/ordinaryWorkspaceReady=false/);
 for(const cleanup of cleanups.reverse())await cleanup();assert.equal(removed,3);
 const help=defs.get('devtunnel-ssh-help');assert.match(help.name,/^[a-z][a-z0-9_-]*$/u);assert.match((await help.handler()).text,/authenticated API/);assert.match((await help.handler()).text,/Managed CLI is not enabled/);
});
test('loader unload invalidates active external leases using collected disposer',async()=>{
 const api=await import('../../dsh-remote/lib/ssh-carrier.js');const cleanups=[];
 await applyWithLoader({get:()=>undefined,effect(setup){cleanups.push(setup());}},async()=>api);
 const carrier=api.sshCarrierOf('devtunnel');const lease=await carrier.acquire({machineId:'loader-mac',connector:{kind:'devtunnel',tunnelId:'fixture.jpe1',remotePort:22,endpoint:{host:'127.0.0.1',port:50736}}});
 assert.equal(lease.dialPort,50736);assert.equal(cleanups.length,1);
 await cleanups[0]();await lease.closed;assert.equal(api.sshCarrierOf('devtunnel'),undefined);assert.throws(()=>lease.dialPort,/STALE_LEASE/);await cleanups[0]();
});
test('host public Loader resolves carrier in exact returned namespace and disposes registration',async()=>{
 const registry=new Map(),cleanups=[],calls=[];
 const api={registerSshCarrier(def){registry.set(def.id,def);return()=>registry.delete(def.id);}};
 const loader={async import(specifier){assert.equal(this,loader);calls.push(specifier);return api;}};
 await applyWithLoader({get:name=>name==='loader'?loader:undefined,effect(setup){cleanups.push(setup());}});
 assert.deepEqual(calls,['dsh-remote/lib/ssh-carrier.js']);assert.ok(registry.has('devtunnel'));
 for(const cleanup of cleanups)await cleanup();assert.equal(registry.size,0);
});
test('explicit resolver wins over host Loader and import failure stays fail closed',async()=>{
 let registered=0;const cleanup=[];
 const ctx={get:name=>name==='loader'?{import(){assert.fail('explicit resolver wins');}}:undefined,effect:setup=>cleanup.push(setup())};
 await applyWithLoader(ctx,async()=>({registerSshCarrier(){registered++;return()=>registered--;}}));assert.equal(registered,1);for(const fn of cleanup)await fn();assert.equal(registered,0);
 await applyWithLoader({get:name=>name==='loader'?{async import(){throw Error('private');}}:undefined,effect:setup=>setup()});
});
test('missing public export reports capability gate not ready',async()=>{
 let def,cleanups=[];
 await applyWithLoader({get:()=>({register(value){if(value.name==='devtunnel-ssh-status')def=value;return()=>{};}}),effect(fn){cleanups.push(fn());}},async()=>{throw Error('ERR_PACKAGE_PATH_NOT_EXPORTED');});
 assert.match((await def.handler()).text,/ssh-api-required/);
 for(const cleanup of cleanups)await cleanup();
});
