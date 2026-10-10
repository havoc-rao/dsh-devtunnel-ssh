import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('host configuration alone gates managed; registration never starts CLI', async () => {
  const bin=mkdtempSync(path.join(tmpdir(),'devtunnel-cli-entry-'));
  const executable=path.join(bin,'devtunnel');writeFileSync(executable,'fixture-no-execute',{mode:0o700});
  for (const [config, enabled] of [
    [{}, false], [{cliExecutable:'/fixture/devtunnel'}, false],
    [{managedEnabled:true}, true], [{managedEnabled:true,cliExecutable:executable}, true],
    [{managedEnabled:true,cliExecutable:'/fixture/missing-devtunnel'}, false],
  ]) {
    let carrier; const cleanup=[];
    const ctx={effect:setup=>cleanup.push(setup()),get:name=>name==='loader'?{
      import:async()=>({registerSshCarrier:def=>{carrier=def;return()=>{};}}),
    }:undefined};
    const previous=process.env.DSH_HOME,previousPath=process.env.PATH;
    process.env.PATH=bin;
    process.env.DSH_HOME=mkdtempSync(path.join(tmpdir(),'devtunnel-entry-'));
    try { await apply(ctx,config); }
    finally { if(previous===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=previous;
      if(previousPath===undefined)delete process.env.PATH;else process.env.PATH=previousPath; }
    assert.equal(carrier.capabilities.managedConnect,enabled);
    assert.equal(carrier.capabilities.automaticLocalPort,enabled);
    if (!enabled) await assert.rejects(carrier.acquire({machineId:'mac',connector:{kind:'devtunnel',mode:'managed',tunnelId:'fixture',remotePort:22}}),/MANAGED_UNAVAILABLE/);
    for(const dispose of cleanup.reverse())await dispose();
  }
});
