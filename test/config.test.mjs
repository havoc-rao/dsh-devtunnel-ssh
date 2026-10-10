import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {Config} from '../lib/index.js';
const require=createRequire(new URL('../../dsh-remote/package.json',import.meta.url));
const {Context,resolveConfig}=require('@deepseek-ai/cordis');
test('real installed Cordis standard schema defaults and rejects nonabsolute paths',()=>{
 assert.equal(resolveConfig({Config},undefined).cliExecutable,'');
 assert.equal(resolveConfig({Config},undefined).managedEnabled,false);
 assert.equal(resolveConfig({Config},{managedEnabled:true}).managedEnabled,true);
 assert.throws(()=>resolveConfig({Config},{managedEnabled:'yes'}));
 assert.equal(resolveConfig({Config},{cliExecutable:null}).cliExecutable,'','Schemastery null uses safe disabled default');
 assert.equal(resolveConfig({Config},{cliExecutable:'/Users/fixture/bin/devtunnel'}).cliExecutable,'/Users/fixture/bin/devtunnel');
 for(const cliExecutable of ['devtunnel','~/bin/devtunnel','relative/path','/bin/devtunnel\n',123])assert.throws(()=>resolveConfig({Config},{cliExecutable}));
});
test('actual Context plugin receives schema default without executing CLI',async()=>{
 const ctx=new Context();let seen;const plugin={name:'schema-fixture',Config,apply(_ctx,config){seen=config;}};
 const fiber=ctx.plugin(plugin);await new Promise(r=>setImmediate(r));assert.equal(seen.cliExecutable,'');await fiber.dispose();
});
