// Proposed service shape only; not wired into entry until base publishes contract.
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {registerCarrierWhenAvailable} from '../lib/core/registration.js';
const require=createRequire(new URL('../../dsh-remote/package.json',import.meta.url));const {Context}=require('@deepseek-ai/cordis');
const tick=()=>new Promise(r=>setImmediate(r));
test('actual Cordis reactive injection follows late provider and replacement namespace',async()=>{
 const ctx=new Context();let count=0;const service='dshRemoteSshCarriers';
 const consumer=ctx.inject([service],inner=>{const registration=registerCarrierWhenAvailable(inner.get(service));inner.effect(()=>()=>registration.dispose());});
 await tick();assert.equal(count,0);
 function provider(){return ctx.plugin({name:'proposed-provider',apply(inner){inner.provide(service,{registerSshCarrier(def){assert.equal(def.id,'devtunnel');count++;return()=>{count--;};}});}});}
 const first=provider();await tick();await tick();assert.equal(count,1);
 await first.dispose();await tick();assert.equal(count,0);
 const second=provider();await tick();await tick();assert.equal(count,1);
 await consumer.dispose();await tick();assert.equal(count,0);await second.dispose();
});
