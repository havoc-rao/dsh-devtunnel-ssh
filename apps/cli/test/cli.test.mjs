import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { resolve, join } from 'node:path';
import { verificationCode } from '../src/core.mjs';
const main = resolve('apps/cli/src/main.mjs');
const run = (args, home) => spawnSync(process.execPath,[main,...args],{encoding:'utf8',env:{...process.env,...(home?{HOME:home,USERPROFILE:home}:{})}});
test('CLI help/version and unknown options',()=>{
  assert.equal(run(['--version']).stdout.trim(),'0.1.0');
  assert.match(run(['--help']).stdout,/host invite/);
  assert.match(run(['--help']).stdout,/dsh-remote-devtunnel-link \(dsh-rdl\)/);
  assert.match(run(['unknown-command']).stderr,/^dsh-rdl:/);
  assert.equal(run(['pair','--wat','x']).status,1);
});
test('local invite and dedicated pair workflow produces no private key in response',(t)=>{
  const dir=mkdtempSync(join(realpathSync(tmpdir()),'dsh-link-cli-'));
  const generation=spawnSync('ssh-keygen',['-t','ed25519','-N','','-f',join(dir,'host-key')],{encoding:'utf8'});
  if(generation.error?.code==='ENOENT') { t.skip('System ssh-keygen unavailable'); return; }
  assert.equal(generation.status,0,generation.stderr);
  const invite=join(dir,'invite.json'), response=join(dir,'response.json');
  const create=run(['host','invite','--name','fixture','--username',userInfo().username,'--tunnel','fixture.usw3','--host-key',join(dir,'host-key.pub'),'--out',invite],dir);
  assert.equal(create.status,0,create.stderr);
  const pair=run(['pair','--invite',invite,'--out',response],dir);
  assert.equal(pair.status,0,pair.stderr);
  const r=JSON.parse(readFileSync(response,'utf8'));
  assert.equal(r.kind,'dsh-link-response'); assert.match(r.publicKey,/^ssh-ed25519 /);
  assert.doesNotMatch(readFileSync(response,'utf8'),/PRIVATE KEY|privateKeyPath/);
  assert.match(pair.stdout,/Check code:/);
  const exportDenied=run(['dsh','export','--invite',invite,'--response',response,'--out',join(dir,'handoff.json'),'--confirm','wrong'],dir);
  assert.equal(exportDenied.status,1); assert.match(exportDenied.stderr,/Verification code mismatch/);
  const i=JSON.parse(readFileSync(invite,'utf8')),code=verificationCode(i,r);
  const exported=run(['dsh','export','--invite',invite,'--response',response,'--out',join(dir,'handoff.json'),'--confirm',code],dir);
  assert.equal(exported.status,0,exported.stderr);
  if(process.platform !== 'win32') {
    const bin=join(dir,'bin'); mkdirSync(bin);
    const log=join(dir,'ssh-args.json');
    for(const tool of ['ssh','sftp']) writeFileSync(join(bin,tool),`#!/usr/bin/env node\nrequire('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify({tool:${JSON.stringify(tool)},args:process.argv.slice(2)})+'\\n');\nprocess.stdin.resume();\n`,{mode:0o700});
    const v=spawnSync(process.execPath,[main,'verify','--invite',invite,'--response',response,'--confirm',code,'--local-port','58339'],{encoding:'utf8',env:{...process.env,HOME:dir,PATH:bin+':'+process.env.PATH}});
    assert.equal(v.status,0,v.stderr);
    const records=readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(records.length,2);assert.equal(records[0].tool,'ssh');assert.equal(records[1].tool,'sftp');
    for(const record of records) {assert.ok(record.args.includes('PasswordAuthentication=no'));assert.ok(record.args.includes('IdentityAgent=none'));assert.ok(record.args.includes('StrictHostKeyChecking=yes'));assert.ok(record.args.includes('IdentitiesOnly=yes'));}
    assert.match(v.stdout,/SFTP pwd/);
    const receipt=JSON.parse(readFileSync(join(dir,'.dsh-link','verified',r.clientId+'.json'),'utf8'));
    assert.equal(receipt.kind,'dsh-link-verified');
    assert.ok(receipt.verifiedAt<i.expiresAt);
    // A new, unverified pair cannot gain an established receipt on SSH failure.
    const response2=join(dir,'response2.json');
    assert.equal(run(['pair','--invite',invite,'--out',response2],dir).status,0);
    const r2=JSON.parse(readFileSync(response2,'utf8'));
    writeFileSync(join(bin,'ssh'),'#!/usr/bin/env node\nprocess.exit(1);\n',{mode:0o700});
    const failed=spawnSync(process.execPath,[main,'verify','--invite',invite,'--response',response2,'--confirm',verificationCode(i,r2),'--local-port','58339'],{encoding:'utf8',env:{...process.env,HOME:dir,PATH:bin+':'+process.env.PATH}});
    assert.equal(failed.status,1);assert.match(failed.stderr,/ssh failed/);
    assert.throws(()=>readFileSync(join(dir,'.dsh-link','verified',r2.clientId+'.json')));
  }
});

test('CLI package exposes full and short names with matching lock metadata',()=>{
  const pkg=JSON.parse(readFileSync(resolve('apps/cli/package.json'),'utf8'));
  const lock=JSON.parse(readFileSync(resolve('apps/cli/package-lock.json'),'utf8'));
  assert.equal(pkg.name,'dsh-remote-devtunnel-link');
  assert.deepEqual(pkg.bin,{'dsh-remote-devtunnel-link':'src/main.mjs','dsh-rdl':'src/main.mjs'});
  assert.equal(lock.name,pkg.name);
  assert.equal(lock.packages[''].name,pkg.name);
  assert.deepEqual(lock.packages[''].bin,pkg.bin);
});
