import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { noSymlink, saveJSON, makeInvite, makeResponse, validateResponse, verificationCode } from '../src/core.mjs';

const field = value => { const data = Buffer.from(value); const size = Buffer.alloc(4); size.writeUInt32BE(data.length); return Buffer.concat([size, data]); };
const key = `ssh-ed25519 ${Buffer.concat([field('ssh-ed25519'), field(Buffer.alloc(32, 7))]).toString('base64')}`;
const fixture = () => makeInvite({ name: 'review', username: 'review', tunnelId: 'review.usw3', remotePort: 22, hostPublicKey: key });

// Intentionally asserts the safe contract, not the vulnerable behavior. Parent
// should fix the implementation; this review does not change application code.
test('SECURITY: dangling symlink must be rejected before known_hosts writes', { skip: process.platform === 'win32' ? 'Symlink privilege is not assumed' : false }, () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'dsh-link-review-'));
  const known = join(dir, 'known_hosts');
  const destination = join(dir, 'unexpected-created-file');
  symlinkSync(destination, known);
  assert.equal(existsSync(known), false, 'dangling links are invisible to existsSync');
  assert.throws(() => noSymlink(known), /symlink/i, 'noSymlink must use lstat even when target does not exist');
});

test('SECURITY: one-time claim uses exclusive creation and cannot be replayed', () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'dsh-link-review-'));
  const path = join(dir, 'invitation.claim');
  saveJSON(path, { clientId: 'first' });
  assert.throws(() => saveJSON(path, { clientId: 'second' }), { code: 'EEXIST' });
});

test('SECURITY: response and check code bind tunnel, port, account and host key', () => {
  const invite = fixture();
  const response = makeResponse(invite, key);
  for (const mutation of [{ tunnelId: 'another.usw3' }, { remotePort: 2222 }, { username: 'another' }]) {
    const altered = { ...invite, ...mutation };
    assert.throws(() => validateResponse(altered, response), /does not match/);
    assert.notEqual(verificationCode(altered, response), verificationCode(invite, response));
  }
});

