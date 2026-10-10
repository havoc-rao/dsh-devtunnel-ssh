import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createCarrier } from '../lib/carrier.js';
import { startManagedConnect } from '../lib/managed-connect.js';
import { createManagedStarter } from '../lib/managed-supervisor.js';

// Full owned CLI adapter composition: no terminal-created listener, real CLI,
// SSH credential reads, or network. A requested managed lease owns the spawn.
test('plugin spawns explicit connect and holds it until the last workspace lease ends',async()=>{
 const children=[],calls=[];
 const spawn=(executable,args,options)=>{
   calls.push({executable,args,options});
   const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.pid=1000+children.length;
   child.signals=[];child.kill=signal=>{child.signals.push(signal);queueMicrotask(()=>child.emit('exit',0));return true;};
   children.push(child);queueMicrotask(()=>child.stdout.emit('data','SSH: Forwarding from 127.0.0.1:57321 to host port 22\n'));
   return child;
 };
 const starter=createManagedStarter({executable:'/fixture/devtunnel',start:opts=>startManagedConnect({...opts,spawn,graceMs:10,killMs:10})});
 const carrier=createCarrier({startManaged:starter});
 const request={machineId:'existing-pc',connector:{kind:'devtunnel',mode:'managed',tunnelId:'fixture.jpe1',remotePort:22}};
 assert.equal(calls.length,0,'registration never starts a CLI');
 const [work,other]=await Promise.all([carrier.acquire(request),carrier.acquire(request)]);
 assert.equal(calls.length,1);assert.equal(work.dialPort,57321);
 assert.deepEqual(calls[0].args,['connect','fixture.jpe1']);assert.equal(calls[0].options.shell,false);
 assert.deepEqual(children[0].signals,[],'plugin retains its live CLI during work');
 await work.release();assert.deepEqual(children[0].signals,[],'other owner keeps channel running');
 assert.equal(other.dialPort,57321);await other.release();assert.deepEqual(children[0].signals,['SIGTERM']);
 const fresh=await carrier.acquire(request);assert.equal(calls.length,2);assert.notEqual(fresh.generation,work.generation);
 await carrier.dispose();await fresh.closed;assert.deepEqual(children[1].signals,['SIGTERM']);assert.throws(()=>fresh.dialPort,/STALE_LEASE/);
});
