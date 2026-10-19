import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const mac = 'apps/cli/install/install-macos.sh';
test('macOS installer parses and refuses invalid arguments before download', {skip: process.platform === 'win32'}, () => {
  assert.equal(spawnSync('/bin/sh', ['-n', mac]).status, 0);
  for (const args of [['--version','../bad'], ['--unknown']]) {
    const result=spawnSync('/bin/sh',[mac,...args],{encoding:'utf8'});
    assert.equal(result.status,2);
  }
});
test('installers pin repo, require checksums and never bypass OS security', () => {
  const sh=readFileSync(mac,'utf8');
  const ps=readFileSync('apps/cli/install/install-windows.ps1','utf8');
  for(const text of [sh,ps]) {
    assert.match(text,/havoc-rao\/dsh-devtunnel-ssh/);
    assert.match(text,/sha256/i);
    assert.doesNotMatch(text,/Set-ExecutionPolicy|ExecutionPolicy Bypass|xattr -d|spctl --master-disable/);
  }
  assert.match(sh,/--force/);
  assert.match(ps,/AddToPath/);
});
test('Windows installer passes PowerShell AST parsing', {skip: process.platform !== 'win32'},()=>{
  const command="$tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PWD 'apps/cli/install/install-windows.ps1'),[ref]$tokens,[ref]$errors) | Out-Null; if ($errors.Count) { $errors | Out-String | Write-Error; exit 1 }";
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr || result.error?.message);
});
test('release workflow separates main build from tag publication',()=>{
  const workflow=readFileSync('.github/workflows/dsh-remote-devtunnel-link-release.yml','utf8');
  assert.match(workflow,/branches: \[main\]/);
  assert.match(workflow,/github.ref_type == 'tag'/);
  assert.match(workflow,/install-macos.sh release-assets/);
  assert.match(workflow,/install-windows.ps1 release-assets/);
});
