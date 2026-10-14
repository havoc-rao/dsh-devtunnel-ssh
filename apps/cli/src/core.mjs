import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, lstatSync, renameSync, existsSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parsePublicKey } from './platforms.mjs';

export const VERSION = '0.1.0';
export const MAX_BYTES = 65536;
export function requireText(value, label, pattern = /^[^\x00-\x1f\x7f]{1,200}$/u) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}
export function publicKey(text) {
  if (typeof text !== 'string' || text.length > 16384) throw new Error('Invalid public key');
  parsePublicKey(text.trim());
  if (/[\r\n]/.test(text.trim())) throw new Error('Public key must be one complete line');
  const parts = text.trim().split(/\s+/);
  if (parts.length < 2 || !['ssh-ed25519', 'ssh-rsa', 'ecdsa-sha2-nistp256'].includes(parts[0]) || !/^[A-Za-z0-9+/]+={0,2}$/.test(parts[1])) throw new Error('Unsupported or truncated public key');
  const blob = Buffer.from(parts[1], 'base64');
  if (blob.toString('base64').replace(/=+$/, '') !== parts[1].replace(/=+$/, '')) throw new Error('Invalid public key encoding');
  let offset = 0;
  const field = () => { if (offset + 4 > blob.length) throw new Error('Truncated public key'); const size = blob.readUInt32BE(offset); offset += 4; if (size > 8192 || offset + size > blob.length) throw new Error('Truncated public key'); const result = blob.subarray(offset, offset + size); offset += size; return result; };
  if (field().toString() !== parts[0]) throw new Error('Public key type mismatch');
  if (parts[0] === 'ssh-ed25519') { if (field().length !== 32) throw new Error('Invalid Ed25519 key'); }
  else if (parts[0] === 'ssh-rsa') { const e = field(), n = field(); if (!e.length || e.length > 8 || n.length < 256) throw new Error('RSA key must be at least 2048 bits'); }
  else { if (field().toString() !== 'nistp256' || field().length !== 65) throw new Error('Invalid ECDSA key'); }
  if (offset !== blob.length) throw new Error('Trailing public key data');
  return { key: `${parts[0]} ${parts[1]}`, fingerprint: `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}` };
}
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
function exact(obj, keys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || Object.keys(obj).sort().join(',') !== keys.sort().join(',')) throw new Error('Invalid document fields');
}
export function validateInvite(invite, now = Date.now()) {
  exact(invite, ['schemaVersion', 'kind', 'id', 'createdAt', 'expiresAt', 'name', 'username', 'tunnelId', 'remotePort', 'hostPublicKey', 'hostFingerprint']);
  if (invite.schemaVersion !== 1 || invite.kind !== 'dsh-link-invite') throw new Error('Unsupported invitation version');
  requireText(invite.id, 'invitation ID', /^[a-f0-9-]{36}$/);
  requireText(invite.name, 'device name'); requireText(invite.username, 'username', /^[A-Za-z0-9_][A-Za-z0-9._@\\-]{0,99}$/);
  requireText(invite.tunnelId, 'tunnel ID', /^[a-z0-9][a-z0-9-]{0,99}(?:\.[a-z0-9]{1,20})?$/);
  if (!Number.isInteger(invite.remotePort) || invite.remotePort < 1 || invite.remotePort > 65535) throw new Error('Invalid SSH port');
  if (!Number.isSafeInteger(invite.createdAt) || !Number.isSafeInteger(invite.expiresAt) || invite.expiresAt <= now || invite.createdAt > now + 60000 || invite.expiresAt - invite.createdAt > 86400000 || invite.expiresAt <= invite.createdAt) throw new Error('Invitation expired or invalid clock');
  const key = publicKey(invite.hostPublicKey);
  if (key.fingerprint !== invite.hostFingerprint) throw new Error('Host fingerprint mismatch');
  return invite;
}
export function makeInvite(values, now = Date.now()) {
  const key = publicKey(values.hostPublicKey);
  return validateInvite({ schemaVersion: 1, kind: 'dsh-link-invite', id: randomUUID(), createdAt: now, expiresAt: now + 3600000, name: values.name, username: values.username, tunnelId: values.tunnelId, remotePort: Number(values.remotePort), hostPublicKey: key.key, hostFingerprint: key.fingerprint }, now);
}
export function makeResponse(invite, key, now = Date.now()) {
  validateInvite(invite, now);
  return { schemaVersion: 1, kind: 'dsh-link-response', inviteId: invite.id, inviteDigest: digest(invite), clientId: randomUUID(), publicKey: publicKey(key).key };
}
export function validateResponse(invite, response, now = Date.now()) {
  validateInvite(invite, now);
  exact(response, ['schemaVersion', 'kind', 'inviteId', 'inviteDigest', 'clientId', 'publicKey']);
  if (response.schemaVersion !== 1 || response.kind !== 'dsh-link-response' || response.inviteId !== invite.id || response.inviteDigest !== digest(invite)) throw new Error('Response does not match this invitation');
  requireText(response.clientId, 'client ID', /^[a-f0-9-]{36}$/);
  publicKey(response.publicKey);
  return response;
}
export function validateEstablishedPair(invite, response, receipt) {
  // Validate all immutable fields without permitting expired invites for new authorization.
  validateResponse(invite, response, invite.createdAt);
  exact(receipt, ['schemaVersion', 'kind', 'inviteDigest', 'responseDigest', 'verifiedAt']);
  if (receipt.schemaVersion !== 1 || receipt.kind !== 'dsh-link-verified' || receipt.inviteDigest !== digest(invite) || receipt.responseDigest !== digest(response) || !Number.isSafeInteger(receipt.verifiedAt) || receipt.verifiedAt < invite.createdAt || receipt.verifiedAt >= invite.expiresAt) throw new Error('No matching established pairing receipt');
  return { invite, response };
}
export function verificationCode(invite, response) { return digest({ invite, response }).slice(0, 24).match(/.{4}/g).join('-'); }
export function checkCode(expected, supplied) {
  const a = Buffer.from(expected), b = Buffer.from(supplied || '');
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('Verification code mismatch; compare BOTH devices via a trusted channel');
}
export function noSymlink(path) {
  const absolute = resolve(path);
  let cursor = absolute;
  while (true) {
    try { if (lstatSync(cursor).isSymbolicLink()) throw new Error('Symlink paths are not supported'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  return absolute;
}
export function readText(path) {
  const absolute = noSymlink(path), info = lstatSync(absolute);
  if (!info.isFile() || info.size > MAX_BYTES) throw new Error('Input must be a small regular file');
  return readFileSync(absolute, 'utf8');
}
export function readJSON(path) { return JSON.parse(readText(path)); }
export function saveJSON(path, value, { overwrite = false } = {}) {
  const absolute = noSymlink(path); mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 });
  if (!overwrite) { writeFileSync(absolute, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); return; }
  const temp = `${absolute}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); renameSync(temp, absolute);
  if (process.platform !== 'win32') chmodSync(absolute, 0o600);
}
