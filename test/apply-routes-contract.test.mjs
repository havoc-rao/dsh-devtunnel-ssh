// Actual parent apply/CRUD/mirror with isolated DSH_HOME and fake SFTP only.
import test from 'node:test';import assert from 'node:assert/strict';
import {Readable} from 'node:stream';import {mkdtempSync,mkdirSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';
import * as api from '../../dsh-remote/lib/ssh-carrier.js';
import {SshPool} from '../../dsh-remote/lib/pool.js';
import {registerCarrierWhenAvailable} from '../lib/core/registration.js';
import {detectCapabilities} from '../lib/contracts/capabilities.js';
const CONFIG={host:'',port:22,username:'',password:'',privateKeyPath:'',passphrase:'',workspace:'',shell:'',commandTimeoutMs:5000,connectTimeoutMs:2000,maxOutputChars:10000,maxFileBytes:100000,hostKeyMode:'off',useAgent:false,keyboardInteractive:false,autoPush:false,auditLog:false,encoding:'utf-8',updateMode:'off',updateCheckIntervalMs:0};
async function call(route,body,url='/dsh-remote/machines'){
 let output;const req=Object.assign(Readable.from([JSON.stringify(body)]),{method:'POST',url});const res={statusCode:0,setHeader(){},end(s){output=JSON.parse(s);}};await route(req,res);return{status:res.statusCode,body:output};
}
test('real adapter and opt-in parent CRUD/mirror routes remain hostless and fail closed',async()=>{
 const home=mkdtempSync(path.join(tmpdir(),'dsh-adapter-route-'));mkdirSync(path.join(home,'remote-workspaces'));
 const previous=process.env.DSH_HOME;process.env.DSH_HOME=home;
 const routes=new Map(),cleanups=[];
 const ctx={inject(names,fn){if(names.every(n=>this.get(n)))fn(this);},effect(setup,label){if(label==='dsh-remote.routePools'){const cleanup=setup();assert.equal(typeof cleanup,'function');cleanups.push(cleanup);}},get:n=>n==='webServer'?{register:r=>{routes.set(r.path,r.handler);return()=>{};}}:undefined,tools:{register(){}},systemPrompt:{section(){}}};
 const reg=registerCarrierWhenAvailable(api);const original=SshPool.prototype.sftp;
 const originalConnect=SshPool.prototype.connect,originalExec=SshPool.prototype.exec,originalClose=SshPool.prototype.close;
 let releaseCount=0;const def=api.sshCarrierOf('devtunnel'),acquire=def.acquire;
 def.acquire=async options=>{const lease=await acquire(options);return {...lease,release:async()=>{releaseCount++;await lease.release();}};};
 try{
 const {apply}=await import(`../../dsh-remote/lib/index.js?adapter-route=${Date.now()}`);await apply(ctx,{...CONFIG,experimentalSshCarrier:true});
 assert.equal(cleanups.length,1,'routePools setup immediately returns one unload disposer');
 const route=routes.get('/dsh-remote/machines');assert.ok(route);
 const disabledRoutes=new Map();const disabledCtx={...ctx,get:n=>n==='webServer'?{register:r=>{disabledRoutes.set(r.path,r.handler);return()=>{};}}:undefined};
 await apply(disabledCtx,{...CONFIG});
 async function runtimeCapabilities(map){let output;const res={statusCode:0,setHeader(){},end(text){output=JSON.parse(text);}};await map.get('/dsh-remote/status')({method:'GET',url:'/dsh-remote/status'},res);assert.equal(res.statusCode,200);return detectCapabilities(output);}
 assert.equal((await runtimeCapabilities(routes)).experimentalWorkspaceSupported,true);
 assert.equal((await runtimeCapabilities(disabledRoutes)).experimentalWorkspaceSupported,false);
 const disabledProbe=await call(disabledRoutes.get('/dsh-remote/test-connect'),{connector:{kind:'devtunnel'}},'/dsh-remote/test-connect');assert.equal(disabledProbe.body.ok,false);assert.match(disabledProbe.body.error,/experimental opt-in/);
 const pin='SHA256:'+Buffer.alloc(32,3).toString('base64').replace(/=+$/,'');
 const connector={kind:'devtunnel',tunnelId:'fixture.jpe1',remotePort:22,endpoint:{host:'127.0.0.1',port:50736}};
 const add=await call(route,{action:'add',id:'adapter-b',username:'tester',useAgent:true,connector,expectedHostFingerprint:pin});assert.equal(add.status,200,JSON.stringify(add.body));assert.equal(add.body.machine.host,undefined);assert.equal(add.body.machine.password,undefined);
 const probeRoute=routes.get('/dsh-remote/test-connect');let connects=0,closes=0,failExec=false;
 SshPool.prototype.connect=async function(){connects++;assert.equal(this.config.host,'127.0.0.1');assert.equal(this.config.hostKeyMode,'verify');return {};};
 SshPool.prototype.exec=async()=>{if(failExec)throw Error('fixture exec failure');return {stdout:'',stderr:'',code:0};};
 SshPool.prototype.close=function(){closes++;};
 const success=await call(probeRoute,{id:'adapter-b'},'/dsh-remote/test-connect');assert.equal(success.body.ok,true,JSON.stringify(success.body));assert.equal(success.body.hostKeyVerified,true);assert.equal(releaseCount,1);assert.equal(closes,1);
 failExec=true;const failed=await call(probeRoute,{id:'adapter-b'},'/dsh-remote/test-connect');assert.equal(failed.body.ok,false);assert.equal(releaseCount,2);assert.equal(closes,2);failExec=false;
 for(const bad of [{id:'unknown',connector},{connector,username:'tester',useAgent:true},{connector,username:'tester',useAgent:true,expectedHostFingerprint:pin,password:'not-supported'}]){const result=await call(probeRoute,bad,'/dsh-remote/test-connect');assert.equal(result.body.ok,false);}
 assert.equal(connects,2,'validation errors never dial');
 SshPool.prototype.connect=originalConnect;SshPool.prototype.exec=originalExec;SshPool.prototype.close=originalClose;
 const rotate=await call(route,{action:'update',id:'adapter-b',connector:{...connector,endpoint:{host:'127.0.0.1',port:64894}}});assert.equal(rotate.status,200,JSON.stringify(rotate.body));
 assert.equal(api.sshConnectorTargetIdentity(rotate.body.machine.connector),api.sshConnectorTargetIdentity(connector));
 const change=await call(route,{action:'update',id:'adapter-b',connector:{...connector,tunnelId:'other.jpe1'}});assert.equal(change.status,400);
 const repin=await call(route,{action:'update',id:'adapter-b',expectedHostFingerprint:'SHA256:'+Buffer.alloc(32,4).toString('base64').replace(/=+$/,'')});assert.equal(repin.status,400);
 SshPool.prototype.sftp=async()=>({stat:async()=>({isDirectory:()=>true})});
 const mirrored=await call(routes.get('/dsh-remote/mirror'),{path:'/srv/project',machine:'adapter-b',workspace:'/local/fixture'},'/dsh-remote/mirror');assert.equal(mirrored.status,200,JSON.stringify(mirrored.body));
 const meta=JSON.parse(readFileSync(path.join(mirrored.body.localMirror,'.dsh-remote-meta.json'),'utf8'));assert.equal(meta.schemaVersion,3);assert.equal(meta.machineId,'adapter-b');assert.equal(meta.connectorTargetIdentity,api.sshConnectorTargetIdentity(connector));assert.equal(meta.host,undefined);assert.equal(meta.port,undefined);
 const deleted=await call(route,{action:'delete',id:'adapter-b'});assert.equal(deleted.status,200);
 const disk=JSON.parse(readFileSync(path.join(home,'remote-workspaces','machines.json'),'utf8'));assert.equal(disk.list.length,0);for(const selected of Object.values(disk.workspaces??{}))assert.notEqual(selected?.machineId,'adapter-b');
 await reg.dispose();const missing=await call(route,{action:'add',id:'missing',username:'tester',useAgent:true,connector,expectedHostFingerprint:pin});assert.equal(missing.status,400);assert.match(missing.body.error,/not installed|unavailable/);
 }finally{
 SshPool.prototype.connect=originalConnect;SshPool.prototype.exec=originalExec;SshPool.prototype.close=originalClose;
 SshPool.prototype.sftp=original;for(const cleanup of cleanups.reverse())await cleanup();await reg.dispose();
 if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;
 // Isolated tmpdir retained intentionally; never delete a computed unchecked path.
 }
});
