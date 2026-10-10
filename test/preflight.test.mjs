import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {Readable} from 'node:stream';
import {preflight,createPreflightRunner} from '../lib/util/preflight-runner.js';import {installPreflightRoute} from '../lib/routes/preflight-route.js';
function spawnFixture(calls){return(path,args,options)=>{calls.push({path,args,options});const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.kill=()=>{queueMicrotask(()=>c.emit('close',1));return true;};queueMicrotask(()=>{c.stdout.emit('data',Buffer.from(args[0]==='--version'?'Tunnel CLI version: 1.0.2086+fixture\n':'{"token":"private","user":"private"}'));c.emit('close',0);});return c;};}
test('host-local fixed runner defaults no login and JSON remains unknown/redacted',async()=>{const calls=[];const spawn=spawnFixture(calls);const first=await preflight({executable:'/fixture/devtunnel',spawn});assert.equal(first.version,'1.0.2086');assert.equal(calls.length,1);const second=await preflight({executable:'/fixture/devtunnel',spawn,checkLogin:true});assert.equal(second.login.loggedIn,null);assert.equal(JSON.stringify(second).includes('private'),false);assert.deepEqual(calls.at(-1).args,['user','show','--json']);assert.equal(calls[0].options.shell,false);await assert.rejects(createPreflightRunner({executable:'/fixture/devtunnel',spawn})(['login']));});
test('output cap terminates owned child and does not expose partial output',async()=>{
 const signals=[];const spawn=()=>{const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.kill=s=>{signals.push(s);queueMicrotask(()=>c.emit('close',1));};queueMicrotask(()=>c.stdout.emit('data',Buffer.alloc(65537,120)));return c;};
 const result=await createPreflightRunner({executable:'/fixture/devtunnel',spawn})(['--version']);assert.equal(result.code,null);assert.equal(result.stdout,'');assert.deepEqual(signals,['SIGTERM']);
});
test('absent configured path returns safe guidance without spawning',async()=>{
 let route;const inner={get:()=>({register:def=>{route=def;return()=>{};}}),effect:fn=>fn()};
 installPreflightRoute({inject(_names,fn){fn(inner);}});
 let data;const res={statusCode:0,setHeader(){},end(text){data=JSON.parse(text);}};await route.handler({method:'POST'},res);assert.equal(res.statusCode,409);assert.equal(data.error,'HOST_CLI_PATH_NOT_CONFIGURED');
});
test('preflight dynamically uses saved settings, never request executable',async()=>{
 let route;const calls=[];let saved='/fixture/first';
 const inner={get:()=>({register:def=>{route=def;return()=>{};}}),effect:fn=>fn()};
 installPreflightRoute({inject(_names,fn){fn(inner);}},{runtime:{withExecutable:fn=>fn(saved)},spawn:spawnFixture(calls)});
 const call=async(body)=>{let data;const res={statusCode:0,setHeader(){},end(text){data=JSON.parse(text);}};await route.handler(Object.assign(Readable.from([JSON.stringify(body)]),{method:'POST'}),res);return data;};
 await call({confirmed:true,checkLogin:false});saved='/fixture/second';await call({confirmed:true,checkLogin:false});
 assert.deepEqual(calls.map(c=>c.path),['/fixture/first','/fixture/second']);
 assert.equal((await call({confirmed:true,checkLogin:false,executable:'/fixture/untrusted'})).ok,false);assert.equal(calls.length,2);
});
test('reactive route requires explicit confirmation and denies browser executable',async()=>{
 let route,removed=0;const calls=[];const inner={get:()=>({register:def=>{route=def;return()=>removed++;}}),effect:fn=>{inner.cleanup=fn();}};
 installPreflightRoute({inject(names,fn){assert.deepEqual(names,['webServer']);fn(inner);}},{executable:'/fixture/devtunnel',spawn:spawnFixture(calls)});
 async function call(body){let data;const req=Object.assign(Readable.from([JSON.stringify(body)]),{method:'POST'});const res={statusCode:0,setHeader(){},end(value){data=JSON.parse(value);}};await route.handler(req,res);return{status:res.statusCode,data};}
 assert.equal((await call({confirmed:false,checkLogin:false})).status,400);assert.equal((await call({confirmed:true,checkLogin:false,executable:'/other'})).status,400);assert.equal(calls.length,0);assert.equal((await call({confirmed:true,checkLogin:false})).data.installed,true);inner.cleanup();assert.equal(removed,1);
});
