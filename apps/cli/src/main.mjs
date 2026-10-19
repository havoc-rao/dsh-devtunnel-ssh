#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir, userInfo, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { VERSION, makeInvite, validateInvite, makeResponse, validateResponse, verificationCode, checkCode, publicKey, readText, readJSON, saveJSON, noSymlink, requireText, digest, validateEstablishedPair } from './core.mjs';
import { planWindowsAuthorize, planMacAuthorize, diagnosticCommands } from './platforms.mjs';
import { wizard } from './wizard.mjs';
import { tunnelTarget, tunnelCommand, foreground } from './tunnels.mjs';

const HELP = `dsh-remote-devtunnel-link (dsh-rdl) ${VERSION} — experimental, no cloud pairing service

  tunnel save --tunnel ID [--port 22] --out FILE   Save existing private tunnel target
  tunnel host --target FILE --apply               Explicit foreground host by saved ID
  tunnel connect --target FILE --apply            Explicit foreground connect by saved ID
  doctor [--check-cli]                         Read-only diagnostics
  host invite --name NAME --username USER --tunnel ID --host-key PUB --out FILE
              [--port 22]                     Create one-hour invitation
  pair --invite FILE --out RESPONSE           Generate dedicated key + response
  host accept --invite FILE --response FILE   Show authorization plan + check code
              --confirm CODE --apply         Compare BOTH devices, then apply
  verify --invite FILE --response FILE --confirm CODE --local-port PORT
  dsh export --invite FILE --response FILE --confirm CODE --out FILE

Both devices must compare the SAME check code over a trusted channel.
No private keys are sent or read by this tool. System ssh-keygen generates keys;
system ssh uses them only for an explicit verification. No password fallback.
Dev Tunnel host/connect remain explicit external processes in this first version.
Run devtunnel connect <saved-tunnel-id> on the controlling computer and keep it running.
Use its CURRENT remote-SSH-port -> local-port mapping, never the browser URL.
DSH export is a handoff document, NOT automatic registry import.
`;
function parse(argv) {
  const positional = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) { positional.push(argv[i]); continue; }
    const key = argv[i].slice(2);
    if (!/^[a-z-]+$/.test(key) || Object.hasOwn(flags, key)) throw new Error('Invalid or duplicate option');
    flags[key] = ['apply', 'check-cli', 'help', 'version'].includes(key) ? true : argv[++i];
    if (flags[key] === undefined || (typeof flags[key] === 'string' && flags[key].startsWith('--'))) throw new Error(`Missing --${key} value`);
  }
  return { positional, flags };
}
function needed(flags, key) { if (typeof flags[key] !== 'string' || !flags[key]) throw new Error(`Required --${key}`); return flags[key]; }
function allowed(flags, keys) { for (const key of Object.keys(flags)) if (!keys.includes(key)) throw new Error(`Unknown option --${key}`); }
const stateRoot = () => {
  const path = noSymlink(join(homedir(), '.dsh-link'));
  if (existsSync(path) && platform() !== 'win32') {
    const info = fs.lstatSync(path);
    if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o077)) throw new Error('State directory must belong to current user with mode 700');
  }
  return path;
};
const inviteState = id => join(stateRoot(), 'invites', `${id}.json`);
const clientState = id => join(stateRoot(), 'clients', `${id}.json`);
function run(command, args, opts = {}) {
  const result = spawnSync(command, args, { shell: false, encoding: 'utf8', timeout: 30000, maxBuffer: 65536, ...opts });
  if (result.error || result.status !== 0) throw new Error(`${command} failed (${result.error?.code || result.status}); inspect the command output locally`);
  return result.stdout || '';
}
function loadPair(flags, established = false) {
  const invite = readJSON(needed(flags, 'invite'));
  const response = readJSON(needed(flags, 'response'));
  if (established) {
    // Validate document structure before using clientId as a path component.
    validateResponse(invite, response, invite.createdAt);
    const receiptPath = join(stateRoot(), 'verified', `${response.clientId}.json`);
    if (existsSync(receiptPath)) validateEstablishedPair(invite, response, readJSON(receiptPath));
    else validateResponse(invite, response);
  } else validateResponse(invite, response);
  return { invite, response, code: verificationCode(invite, response) };
}
function localClient(response, invite) {
  const record = readJSON(clientState(response.clientId));
  const expected = join(stateRoot(), 'keys', response.clientId, 'id_ed25519');
  if (record.clientId !== response.clientId || record.inviteId !== invite.id || record.publicKey !== response.publicKey || record.privateKeyPath !== expected) throw new Error('No matching dedicated local pairing key');
  noSymlink(expected);
  const info = fs.lstatSync(expected);
  if (!info.isFile() || (platform() !== 'win32' && (info.uid !== process.getuid() || (info.mode & 0o077)))) throw new Error('Dedicated key ownership/permissions invalid');
  return record;
}
async function main() {
  const { positional: pos, flags: f } = parse(await wizard(process.argv.slice(2)));
  if (f.version) { console.log(VERSION); return; }
  if (!pos.length || f.help) { console.log(HELP); return; }
  const cmd = pos.join(' ');
  if (cmd === 'tunnel save') {
    allowed(f, ['tunnel', 'port', 'out']);
    const target = tunnelTarget({ schemaVersion: 1, tunnelId: needed(f, 'tunnel'), remotePort: Number(f.port || 22) });
    saveJSON(needed(f, 'out'), target);
    console.log('Existing tunnel target saved. This does NOT create a tunnel or publish ports. Review private ACL and configured SSH port using the official CLI.');
    return;
  }
  if (cmd === 'tunnel host' || cmd === 'tunnel connect') {
    allowed(f, ['target', 'apply']);
    const target = tunnelTarget(readJSON(needed(f, 'target')));
    const command = tunnelCommand(pos[1], target);
    console.log(`Target: ${target.tunnelId}; expected remote SSH port: ${target.remotePort}\nCommand: devtunnel ${command.args.join(' ')}\nUses the existing tunnel configuration/ACL; no login, installation or port creation.`);
    if (!f.apply) { console.log('PLAN ONLY. Add --apply to start this foreground process.'); return; }
    await foreground(command);
    return;
  }
  if (cmd === 'doctor') {
    allowed(f, ['check-cli']);
    console.log(`Platform: ${platform()} / account: ${userInfo().username}`);
    for (const item of diagnosticCommands(platform()).filter(item => !item.requiresExplicitCheck)) {
      const exe = item.command || item.executable;
      const result = spawnSync(exe, item.args, { shell: false, encoding: 'utf8', timeout: 10000, maxBuffer: 65536 });
      console.log(`[${!result.error && result.status === 0 ? 'PASS' : 'FAIL'}] ${item.label || item.description || exe}`);
      if (result.stdout) console.log(result.stdout.trim());
    }
    if (f['check-cli']) console.log(run('devtunnel', ['--version']));
    else console.log('[NOT RUN] Dev Tunnel CLI version (may contact service): use --check-cli to authorize');
    console.log('[NOT RUN] Login credentials/cache, SSH authentication, SFTP, DSH import');
    return;
  }
  if (cmd === 'host invite') {
    allowed(f, ['name', 'username', 'tunnel', 'host-key', 'out', 'port']);
    if (needed(f, 'username').toLowerCase() !== userInfo().username.toLowerCase()) throw new Error('First version only configures the current OS account');
    const hostKeyPath = needed(f, 'host-key');
    if (!hostKeyPath.endsWith('.pub')) throw new Error('Host key input must be a public .pub file; never supply a private key');
    const invite = makeInvite({ name: needed(f, 'name'), username: f.username, tunnelId: needed(f, 'tunnel'), remotePort: f.port || 22, hostPublicKey: readText(hostKeyPath) });
    saveJSON(f.out || needed(f, 'out'), invite);
    saveJSON(inviteState(invite.id), { invite, used: false });
    console.log(`Invitation created; expires in one hour. Host fingerprint: ${invite.hostFingerprint}\nSend invitation using your trusted file-transfer channel. No SSH service or tunnel was modified.`);
    return;
  }
  if (cmd === 'pair') {
    allowed(f, ['invite', 'out']);
    const invite = validateInvite(readJSON(needed(f, 'invite')));
    const out = noSymlink(needed(f, 'out'));
    if (existsSync(out)) throw new Error('Response output already exists');
    // Invitation was validated before any key generation. Never read existing private keys.
    const preliminary = makeResponse(invite, invite.hostPublicKey);
    const dir = noSymlink(join(stateRoot(), 'keys', preliminary.clientId));
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const keyPath = join(dir, 'id_ed25519');
    if (platform() === 'win32') run('icacls.exe', [dir, '/inheritance:r', '/grant:r', `${userInfo().username}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F']);
    run('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', `dsh-link:${preliminary.clientId}`, '-f', keyPath]);
    const response = { ...makeResponse(invite, readText(`${keyPath}.pub`)), clientId: preliminary.clientId };
    saveJSON(clientState(response.clientId), { clientId: response.clientId, inviteId: invite.id, publicKey: response.publicKey, privateKeyPath: keyPath });
    saveJSON(out, response);
    console.log(`Dedicated key generated locally (unencrypted; restricted directory).\nCheck code: ${verificationCode(invite, response)}\nSend response to host. Compare this code on BOTH devices before accepting or verifying.`);
    return;
  }
  if (cmd === 'host accept') {
    allowed(f, ['invite', 'response', 'confirm', 'apply']);
    const { invite, response, code } = loadPair(f);
    const record = readJSON(inviteState(invite.id));
    if (record.used || JSON.stringify(record.invite) !== JSON.stringify(invite)) throw new Error('Invitation unavailable or already consumed');
    if (invite.username.toLowerCase() !== userInfo().username.toLowerCase()) throw new Error('Invitation account is not the current account');
    const plan = platform() === 'win32' ? planWindowsAuthorize({ username: invite.username, publicKey: response.publicKey }) : platform() === 'darwin' ? planMacAuthorize({ username: invite.username, publicKey: response.publicKey, home: homedir() }) : null;
    if (!plan) throw new Error('Only Windows and macOS hosts supported');
    console.log(`Check code: ${code}\nClient key fingerprint: ${publicKey(response.publicKey).fingerprint}\n${plan.description}\n${plan.script}`);
    if (!f.apply) { console.log('PLAN ONLY. Compare code on both devices; rerun with --confirm CODE --apply to authorize.'); return; }
    checkCode(code, needed(f, 'confirm'));
    // Exclusive claim prevents concurrent/replayed accepts. Failed operations require a new invite.
    saveJSON(`${inviteState(invite.id)}.claim`, { clientId: response.clientId });
    // Consume BEFORE mutation: a failed/interrupted operation requires a new invitation.
    saveJSON(inviteState(invite.id), { ...record, used: true, responseDigest: response.inviteDigest }, { overwrite: true });
    if (platform() === 'win32') run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', plan.script], { stdio: 'inherit' });
    else run('/bin/sh', ['-c', plan.script], { stdio: 'inherit' });
    console.log('Authorization applied. Verify from controlling device. Tunnel/service configuration unchanged.');
    return;
  }
  if (cmd === 'verify') {
    allowed(f, ['invite', 'response', 'confirm', 'local-port']);
    const { invite, response, code } = loadPair(f, true); checkCode(code, needed(f, 'confirm'));
    const local = localClient(response, invite), port = Number(needed(f, 'local-port'));
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid local port');
    const dir = noSymlink(join(stateRoot(), 'clients', response.clientId)); mkdirSync(dir, { recursive: true, mode: 0o700 });
    const known = join(dir, `known_hosts-${randomUUID()}`);
    // Dedicated file, pinned to independently compared invitation, not TOFU.
    const { writeFileSync } = requireFS();
    writeFileSync(noSymlink(known), `[127.0.0.1]:${port} ${invite.hostPublicKey}\n`, { flag: 'wx', mode: 0o600 });
    const options = ['-F', platform() === 'win32' ? 'NUL' : '/dev/null', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none', '-o', 'PreferredAuthentications=publickey', '-o', 'PasswordAuthentication=no', '-o', 'KbdInteractiveAuthentication=no', '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile="${known.replaceAll('\\', '/')}"`, '-o', `GlobalKnownHostsFile=${platform() === 'win32' ? 'NUL' : '/dev/null'}`, '-o', 'HostKeyAlgorithms=ssh-ed25519,rsa-sha2-512,rsa-sha2-256,ecdsa-sha2-nistp256', '-o', 'ConnectTimeout=10', '-i', local.privateKeyPath];
    run('ssh', [...options, '-p', String(port), `${invite.username}@127.0.0.1`, 'echo dsh-link-verified']);
    console.log('[PASS] SSH connection, pinned host key and dedicated public-key authentication');
    run('sftp', [...options, '-P', String(port), '-b', '-', `${invite.username}@127.0.0.1`], { input: 'pwd\nquit\n' });
    const receiptPath = join(stateRoot(), 'verified', `${response.clientId}.json`);
    if (!existsSync(receiptPath)) {
      const verifiedAt = Date.now();
      if (verifiedAt >= invite.expiresAt) throw new Error('Invitation expired during first verification; create a new invitation');
      saveJSON(receiptPath, { schemaVersion: 1, kind: 'dsh-link-verified', inviteDigest: digest(invite), responseDigest: digest(response), verifiedAt });
    }
    console.log('[PASS] SFTP pwd (no write test)\nEstablished pairing recorded locally; later verification/export can outlive this invitation.\n[NOT RUN] DSH import, remote command permissions beyond echo, file write');
    return;
  }
  if (cmd === 'dsh export') {
    allowed(f, ['invite', 'response', 'confirm', 'out']);
    const { invite, response, code } = loadPair(f, true); checkCode(code, needed(f, 'confirm')); const local = localClient(response, invite);
    saveJSON(needed(f, 'out'), { schemaVersion: 1, kind: 'dsh-link-handoff', verifiedByExport: false, machine: { transport: 'ssh', name: invite.name, username: invite.username, connector: { kind: 'devtunnel', mode: 'managed', tunnelId: invite.tunnelId, remotePort: invite.remotePort }, hostKeyMode: 'verify', expectedHostFingerprint: invite.hostFingerprint, useAgent: false, privateKeyPath: local.privateKeyPath }, instructions: 'Manual RemoteSettings handoff only. Create/select a saved channel; managed requires host authorization. No public automatic import API is assumed.' });
    console.log('Handoff exported. This is NOT an importable DSH registry or proof of verification. Enter fields in RemoteSettings; do not replace internal settings files.');
    return;
  }
  throw new Error(`Unknown command: ${cmd}\n${HELP}`);
}
// Statically imported fs keeps SEA/CJS bundling straightforward.
import * as fs from 'node:fs';
function requireFS() { return fs; }
main().catch(error => { console.error(`dsh-rdl: ${error.message}`); process.exitCode = 1; });
