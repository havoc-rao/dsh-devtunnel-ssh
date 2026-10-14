import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parsePublicKey, planWindowsAuthorize, planMacAuthorize, diagnosticCommands } from '../src/platforms.mjs';

const field = value => { const b = Buffer.from(value); const size = Buffer.alloc(4); size.writeUInt32BE(b.length); return Buffer.concat([size, b]); };
const blob = Buffer.concat([field('ssh-ed25519'), field(Buffer.alloc(32, 42))]).toString('base64');
const key = `ssh-ed25519 ${blob} test@example`;

test('strict parser validates wire type, base64, field length and complete consumption', () => {
  assert.equal(parsePublicKey(key).blob, blob);
  assert.equal(parsePublicKey(key).publicKey, key);
  for (const invalid of [undefined, '', 'ssh-ed25519 AAAA', `${key}\n`, `${key}\r`, `${key}\0`, `ssh-rsa ${blob}`, `ssh-dss ${blob}`, `command="touch /tmp/x" ${key}`, `ssh-ed25519 ${blob}!`, `ssh-ed25519 ${blob}===`, `ssh-ed25519 ${Buffer.concat([field('ssh-ed25519'), field(Buffer.alloc(31))]).toString('base64')}`, `ssh-ed25519 ${Buffer.concat([field('ssh-ed25519'), field(Buffer.alloc(32)), Buffer.alloc(1)]).toString('base64')}`]) assert.throws(() => parsePublicKey(invalid), TypeError);
});

test('ECDSA validates actual curve points, not only their lengths', () => {
  const point = Buffer.concat([Buffer.from([4]), Buffer.alloc(64)]);
  const invalid = `ecdsa-sha2-nistp256 ${Buffer.concat([field('ecdsa-sha2-nistp256'), field('nistp256'), field(point)]).toString('base64')}`;
  assert.throws(() => parsePublicKey(invalid), /point/);
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const validPoint = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  const valid = `ecdsa-sha2-nistp256 ${Buffer.concat([field('ecdsa-sha2-nistp256'), field('nistp256'), field(validPoint)]).toString('base64')}`;
  assert.equal(parsePublicKey(valid).type, 'ecdsa-sha2-nistp256');
});

test('planners reject unsupported input before producing scripts', () => {
  for (const user of [undefined, '', '-option', 'a/b', 'user\nInjected', ' user', 'u\0']) {
    assert.throws(() => planWindowsAuthorize({ username: user, publicKey: key }));
    assert.throws(() => planMacAuthorize({ username: user, publicKey: key, home: '/Users/u' }));
  }
  for (const path of ['', 'relative', '\\\\server\\share\\keys', 'C:\\a\\..\\keys', 'C:\\a\\keys:stream', 'C:\\a\\keys.', 'C:\\a\\x\n']) assert.throws(() => planWindowsAuthorize({ username: 'u', publicKey: key, path }));
  for (const home of [undefined, '', '/', 'relative', '/Users/../u', '/Users/u/', '/Users/u\n']) assert.throws(() => planMacAuthorize({ username: 'u', publicKey: key, home }));
  assert.throws(() => planWindowsAuthorize({ username: 'u', publicKey: 'invalid' }));
  assert.throws(() => planMacAuthorize({ username: 'u', publicKey: 'invalid', home: '/Users/u' }));
});

test('PowerShell interpolations use literal single quotes with doubled apostrophes', () => {
  const { script } = planWindowsAuthorize({ username: "O'Brien; $(whoami)", publicKey: `ssh-ed25519 ${blob} x'; $(evil)`, path: "C:\\Users\\O'Brien\\.ssh\\authorized_keys" });
  assert.ok(script.includes("$requestedUser = 'O''Brien; $(whoami)'"));
  assert.ok(script.includes(`$keyLine = 'ssh-ed25519 ${blob} x''; $(evil)'`));
  assert.ok(script.includes("$requestedPath = 'C:\\Users\\O''Brien\\.ssh\\authorized_keys'"));
});

test('Windows script gates CURRENT identity, actual config, SID ACLs and atomic preserving updates', () => {
  const { script, description } = planWindowsAuthorize({ username: 'u', publicKey: key });
  assert.equal(typeof description, 'string');
  for (const gate of ['WindowsIdentity]::GetCurrent()', '$identity.User', '$identity.Groups', 'Only the CURRENT Windows account', 'Get-CimInstance Win32_Service', '$service.PathName', 'Custom sshd service arguments', 'sshd_config', 'Match\\s+Group\\s+administrators', '__PROGRAMDATA__/ssh/administrators_authorized_keys', 'Custom user authorized keys path', 'Requested path does not match sshd_config', 'ReparsePoint', 'S-1-5-18', 'S-1-5-32-544', '$ownerSid = if ($useAdminFile)', 'SetAccessRuleProtection($true, $false)', 'UTF8Encoding]::new($false, $true)', 'FileMode]::CreateNew', 'File]::Replace($temp, $target, $backup)', 'File]::Move($temp, $target)', '$existing + $separator + $keyLine', '$keyBlob.TrimEnd', 'changed concurrently', 'Set-KeyAcl $backup', '"`r`n"']) assert.ok(script.includes(gate), gate);
  assert.ok(script.includes("($currentName -split '\\\\')[-1]"));
  assert.ok(script.includes("(?i)^(Include|AuthorizedKeysCommand|AuthorizedKeysCommandUser)\\b"));
  assert.ok(script.includes("(?i)^AuthorizedKeysFile\\s+(.+)$"));
  assert.ok(script.includes("($existing -split '\\r?\\n')"));
  assert.doesNotMatch(script, /[\x00-\x08\x0b\x0c]/u);
  assert.ok(script.indexOf('Only the CURRENT Windows account') < script.indexOf('CreateDirectory'));
  assert.ok(script.indexOf('Custom user authorized keys path') < script.indexOf('CreateDirectory'));
  assert.doesNotMatch(script, /Start-Service|Install-WindowsCapability|New-NetFirewallRule|Set-Service|Add-WindowsCapability/u);
});

test('generated Windows script passes PowerShell AST parsing without execution', { skip: process.platform !== 'win32' }, () => {
  const { script } = planWindowsAuthorize({ username: 'fixture', publicKey: key });
  const encoded=Buffer.from(script,'utf8').toString('base64');
  const command=`$s=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); $tokens=$null; $errors=$null; $null=[System.Management.Automation.Language.Parser]::ParseInput($s,[ref]$tokens,[ref]$errors); if($errors.Count){$errors | ForEach-Object {Write-Error $_.Message}; exit 1}`;
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);
});

test('Mac script safely quotes data and gates account, symlinks and preserving append', () => {
  const { script, description } = planMacAuthorize({ username: "o'brien", publicKey: `ssh-ed25519 ${blob} x'; $(evil)`, home: "/Users/o'brien" });
  assert.equal(typeof description, 'string');
  assert.ok(script.includes("requested_user='o'\\''brien'"));
  assert.ok(script.includes("requested_home='/Users/o'\\''brien'"));
  assert.ok(script.includes(`key_line='ssh-ed25519 ${blob} x'\\''; $(evil)'`));
  for (const gate of ['/usr/bin/id -un', 'Only the CURRENT macOS user', 'NFSHomeDirectory', 'Home does not belong to CURRENT user', '[ ! -L "$candidate" ]', 'assert_no_symlink "$target"', '/bin/chmod 700 "$directory"', '/bin/chmod 600 "$target"', '-v blob="$key_blob"', '/bin/cat "$snapshot" > "$temp"', "printf '%s\\n'", '/usr/bin/cmp -s', 'authorized_keys.backup.', '/bin/mv -f "$temp" "$target"']) assert.ok(script.includes(gate), gate);
  assert.ok(script.includes('assert_no_symlink /private/etc/ssh/sshd_config'));
  assert.ok(script.includes('directive == "include" || directive == "match"'));
  assert.ok(script.includes('$2 != "/etc/ssh/sshd_config.d/*"'));
  assert.ok(script.includes('assert_config_safe "$config"'));
  assert.ok(script.includes('root-owned and not group/world writable'));
  assert.ok(script.includes('$2 != ".ssh/authorized_keys"'));
  assert.ok(script.indexOf('Custom SSH configuration requires manual review') < script.indexOf('/bin/mkdir'));
  assert.ok(script.indexOf('Home does not belong') < script.indexOf('/bin/mkdir'));
  assert.doesNotMatch(script.split('\n').filter(line => !line.startsWith('#')).join('\n'), /sudo|systemsetup|launchctl|ssh-add|id_rsa|id_ed25519|login|token/u);
});

test('generated POSIX script passes parse-only shell check without execution', { skip: process.platform === 'win32' }, () => {
  const { script } = planMacAuthorize({ username: "o'brien", publicKey: `ssh-ed25519 ${blob} x'; $(evil)`, home: "/Users/o'brien" });
  const result = spawnSync('/bin/sh', ['-n'], { input: script, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('Mac root/include AWK validators accept default include and reject custom trust paths', { skip: process.platform === 'win32' }, () => {
  const { script } = planMacAuthorize({ username: 'fixture', publicKey: `ssh-ed25519 ${blob}`, home: '/Users/fixture' });
  const blocks = [...script.matchAll(/\/usr\/bin\/awk '\n([\s\S]*?)\n\s*' "\$(config_root|config)"/g)];
  assert.equal(blocks.length, 2);
  const root = blocks.find(b=>b[2]==='config_root')[1], child = blocks.find(b=>b[2]==='config')[1];
  const check = (program,input) => spawnSync('/usr/bin/awk',[program],{input,encoding:'utf8'}).status;
  assert.equal(check(root,'Include /etc/ssh/sshd_config.d/*\nAuthorizedKeysFile .ssh/authorized_keys\n'),0);
  assert.equal(check(child,'# Apple defaults\nUsePAM yes\n'),0);
  for(const bad of ['Include /tmp/*\n','Match User root\n','AuthorizedKeysFile /tmp/keys\n','AuthorizedKeysCommand /bin/evil\n']) assert.notEqual(check(root,bad),0);
  assert.notEqual(check(child,'Include /etc/ssh/sshd_config.d/*\n'),0);
});

test('diagnostics are read-only arrays and mark CLI version explicit-only', () => {
  for (const platform of ['win32', 'darwin']) {
    const commands = diagnosticCommands(platform);
    assert.equal(commands.length, 3);
    assert.ok(commands.every(c => typeof c.command === 'string' && Array.isArray(c.args) && typeof c.label === 'string'));
    const cli = commands.find(c => c.command === 'devtunnel');
    assert.deepEqual(cli.args, ['--version']);
    assert.equal(cli.requiresExplicitCheck, true);
    assert.doesNotMatch(JSON.stringify(commands), /login|cache|token|Start-Service|enable|install/u);
    commands[0].args.push('mutation');
    assert.ok(!diagnosticCommands(platform)[0].args.includes('mutation'));
  }
  for (const platform of ['linux', 'windows', undefined, 'darwin; evil']) assert.throws(() => diagnosticCommands(platform), /Unsupported platform/);
});
