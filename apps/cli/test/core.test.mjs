import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, symlinkSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publicKey, makeInvite, validateInvite, makeResponse, validateResponse, verificationCode, checkCode, saveJSON, readJSON, noSymlink, digest, validateEstablishedPair } from '../src/core.mjs';
const { publicKey: k } = generateKeyPairSync('ed25519');
const bytes = k.export({ format: 'der', type: 'spki' }).subarray(-32);
const type = Buffer.from('ssh-ed25519'), len = b => { const size = Buffer.alloc(4); size.writeUInt32BE(b.length); return Buffer.concat([size,b]); };
const key = 'ssh-ed25519 ' + Buffer.concat([len(type),len(bytes)]).toString('base64');
const now = 1000000;
const invite = () => makeInvite({ name:'Windows', username:'havoc', tunnelId:'happy-plane-3d6rqsn.usw3', remotePort:22, hostPublicKey:key },now);
test('strict key parser rejects truncated RSA and mismatched types', () => {
  assert.throws(() => publicKey('ssh-rsa AAAAB3NzaC1yc2EAAAADAQAB'));
  assert.throws(() => publicKey(key.replace('ssh-ed25519 ', 'ssh-rsa ')));
  assert.match(publicKey(key).fingerprint,/^SHA256:/);
});
test('invitation expiry, fields and fingerprint checked', () => {
  const i=invite(); assert.equal(validateInvite(i,now).username,'havoc');
  assert.throws(() => validateInvite(i,now+3600000));
  assert.throws(() => validateInvite({...i, hostFingerprint:'SHA256:fake'},now));
  assert.throws(() => validateInvite({...i, injected:true},now));
  assert.throws(() => makeInvite({name:'x',username:'x;exit',tunnelId:'x',remotePort:22,hostPublicKey:key},now));
});
test('response target binding and trusted-channel code', () => {
  const i=invite(), r=makeResponse(i,key,now); validateResponse(i,r,now);
  assert.throws(() => validateResponse({...i,tunnelId:'other'},r,now));
  const code=verificationCode(i,r); checkCode(code,code); assert.throws(() => checkCode(code,'wrong'));
  assert.notEqual(code,verificationCode(i,{...r,clientId:'b'.repeat(36)}));
});
test('established receipt permits expired pair only when immutable target matches', () => {
  const i=invite(),r=makeResponse(i,key,now);
  const receipt={schemaVersion:1,kind:'dsh-link-verified',inviteDigest:digest(i),responseDigest:digest(r),verifiedAt:now+100};
  assert.throws(()=>validateResponse(i,r,now+7200000));
  assert.equal(validateEstablishedPair(i,r,receipt).invite.id,i.id);
  assert.throws(()=>validateEstablishedPair({...i,remotePort:23},r,receipt));
  assert.throws(()=>validateEstablishedPair(i,{...r,clientId:'f'.repeat(36)},receipt));
  assert.throws(()=>validateEstablishedPair(i,r,{...receipt,verifiedAt:i.expiresAt}));
  assert.throws(()=>validateEstablishedPair(i,r,{...receipt,extra:true}));
});
test('JSON writing refuses overwrite and symlink ancestors', () => {
  const dir=mkdtempSync(join(realpathSync(tmpdir()),'dsh-link-test-')), file=join(dir,'test.json');
  saveJSON(file,{ok:true}); assert.deepEqual(readJSON(file),{ok:true});
  assert.throws(() => saveJSON(file,{ok:false}));
  saveJSON(file,{ok:false},{overwrite:true}); assert.equal(readJSON(file).ok,false);
  assert.match(readFileSync(file,'utf8'),/false/);
  if(process.platform!=='win32') { symlinkSync(dir,join(dir,'link')); assert.throws(()=>noSymlink(join(dir,'link','new.json'))); }
});
