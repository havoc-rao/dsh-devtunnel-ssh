import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { tunnelTarget, tunnelCommand, foreground } from '../src/tunnels.mjs';
const target = {schemaVersion:1,tunnelId:'happy-plane-3d6rqsn.usw3',remotePort:22};
test('persistent explicit tunnel command never creates implicit or anonymous tunnel',()=>{
  assert.deepEqual(tunnelCommand('host',target),{executable:'devtunnel',args:['host',target.tunnelId]});
  assert.deepEqual(tunnelCommand('connect',target).args,['connect',target.tunnelId]);
  for (const t of [{...target,tunnelId:'--allow-anonymous'}, {...target,remotePort:0}, {...target,token:'x'}]) assert.throws(()=>tunnelTarget(t));
  assert.throws(()=>tunnelCommand('create',target));
});
test('foreground owns only child and removes signal handlers',async()=>{
  const signals=new EventEmitter(), child=new EventEmitter(); child.exitCode=null;
  const killed=[]; child.kill=s=>killed.push(s);
  const promise=foreground(tunnelCommand('connect',target),{signals,spawnProcess:(exe,args,opts)=>{
    assert.equal(exe,'devtunnel'); assert.equal(opts.shell,false); assert.equal(opts.stdio,'inherit');
    assert.deepEqual(args,['connect',target.tunnelId]); return child;
  }});
  signals.emit('SIGINT'); assert.deepEqual(killed,['SIGTERM']);
  child.emit('close',null,'SIGTERM'); await promise;
  assert.equal(signals.listenerCount('SIGINT'),0);
});
test('foreground missing executable and nonzero exits fail without retry',async()=>{
  const signals=new EventEmitter(),child=new EventEmitter();
  let calls=0;
  const p=foreground(tunnelCommand('host',target),{signals,spawnProcess:()=>{calls++;return child;}});
  child.emit('error',new Error('secret')); await assert.rejects(p,/unavailable/);assert.equal(calls,1);
  assert.equal(signals.listenerCount('SIGTERM'),0);
  await assert.rejects(foreground(tunnelCommand('host',target),{signals,spawnProcess:()=>{throw new Error('secret');}}),/Unable/);
});
