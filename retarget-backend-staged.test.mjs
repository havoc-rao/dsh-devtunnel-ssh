import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { registerSshCarrier, sshConnectorTargetIdentity } from '../dsh-remote/lib/ssh-carrier.js'
import { normalizeCarrierMachine } from '../dsh-remote/lib/ssh-carrier-record.js'
import { machineForMirror } from '../dsh-remote/lib/route-machine.js'
import { prepareCarrierRetarget, planCarrierRetarget, readCarrierMirrorMeta, commitCarrierRegistry, createRetargetGate, createCarrierRetargetTransaction } from './retarget-backend-staged.mjs'
registerSshCarrier({ id: 'devtunnel', acquire() { throw new Error('must not acquire') }, targetIdentity: c => `devtunnel:${c.tunnelId}:${c.remotePort}`, sanitizeConnector: c => structuredClone(c), validateConnector(c) { if (!/^[a-z]+$/.test(c.tunnelId) || c.remotePort !== 22) throw new Error('invalid connector') } })
const fingerprint = 'SHA256:' + Buffer.alloc(32, 7).toString('base64').replace(/=$/, '')
const previous = { ...normalizeCarrierMachine({ id: 'machine-a', transport: 'ssh', connector: { kind: 'devtunnel', mode: 'managed', tunnelId: 'old', remotePort: 22 }, username: 'user', expectedHostFingerprint: fingerprint }), workspace: '/project', recentWorkspaces: ['/one', '/two'], credentialBackend: 'plain', customPreserved: { x: true } }
const request = (overrides = {}) => ({ id: previous.id, confirmed: true, connector: { ...previous.connector, tunnelId: 'next' }, expectedConnector: structuredClone(previous.connector), expectedHostFingerprint: fingerprint, ...overrides })
const prepare = body => prepareCarrierRetarget(previous, body, normalizeCarrierMachine)
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dsh-retarget-stage-'))
  const document = { list: [structuredClone(previous)], currentId: previous.id, workspaces: { '/local-a': { machineId: previous.id, workspace: '/one' }, '/local-b': { machineId: previous.id, workspace: '/two' } }, arbitraryTopLevel: true }
  const files = ['/one', '/two'].map((remotePath, i) => {
    const dir = path.join(root, 'original-hash', 'workspace-' + i); mkdirSync(dir, { recursive: true })
    const file = path.join(dir, '.dsh-remote-meta.json')
    writeFileSync(file, JSON.stringify({ schemaVersion: 3, transport: 'ssh', machineId: previous.id, connectorTargetIdentity: sshConnectorTargetIdentity(previous.connector), remotePath, createdAt: 'unchanged' }))
    return file
  })
  const registry = path.join(root, 'machines.json'); writeFileSync(registry, JSON.stringify(document))
  return { root, document, files, registry }
}
test('retarget preserves every other machine field; validates target without acquisition', () => {
  const next = prepare(request()); assert.deepEqual({ ...next, connector: previous.connector }, previous)
  assert.throws(() => prepare(request({ connector: { ...previous.connector, tunnelId: '../bad' } })), /invalid connector/)
})
test('normal update still rejects a changed target or fingerprint', () => {
  assert.throws(() => normalizeCarrierMachine({ ...previous, connector: request().connector }, previous), /target cannot change/)
  assert.throws(() => normalizeCarrierMachine({ ...previous, expectedHostFingerprint: 'SHA256:' + Buffer.alloc(32, 8).toString('base64') }, previous), /fingerprint cannot change/)
})
test('explicit retarget rejects stale complete connector, unconfirmed, changed pin and other carrier', () => {
  for (const body of [request({ confirmed: false }), request({ expectedConnector: { ...previous.connector, channelId: 'stale' } }), request({ expectedHostFingerprint: 'SHA256:' + Buffer.alloc(32, 8).toString('base64') }), request({ connector: { kind: 'other' } })]) assert.throws(() => prepare(body))
  assert.throws(() => prepareCarrierRetarget(null, request(), normalizeCarrierMachine), /not found/)
})
test('two workspaces retain original directory, metadata bytes, strict owner and selections after atomic commit/reload', () => {
  const f = fixture(), next = prepare(request()), bytes = f.files.map(file => readFileSync(file))
  const plan = planCarrierRetarget({ ...f, previous, next, targetIdentity: sshConnectorTargetIdentity })
  assert.equal(plan.retargetedMirrors, 2)
  assert.deepEqual(plan.document.workspaces, f.document.workspaces)
  commitCarrierRegistry(f.registry, readFileSync(f.registry), plan.document)
  const persisted = JSON.parse(readFileSync(f.registry))
  for (const [i, file] of f.files.entries()) {
    assert.deepEqual(readFileSync(file), bytes[i])
    const effective = readCarrierMirrorMeta(f.root, file, persisted, sshConnectorTargetIdentity)
    assert.equal(machineForMirror(effective, persisted.list).record.id, previous.id)
    assert.equal(machineForMirror(JSON.parse(bytes[i]), persisted.list), null)
  }
})
test('unlisted/copied/tampered metadata and mismatched fingerprint cannot inherit mapping', () => {
  const f = fixture(), next = prepare(request())
  const plan = planCarrierRetarget({ ...f, previous, next, targetIdentity: sshConnectorTargetIdentity })
  const dir = path.join(f.root, 'copied', 'workspace'); mkdirSync(dir, { recursive: true })
  const copy = path.join(dir, '.dsh-remote-meta.json'); writeFileSync(copy, readFileSync(f.files[0]))
  assert.equal(machineForMirror(readCarrierMirrorMeta(f.root, copy, plan.document, sshConnectorTargetIdentity), [next]), null)
  writeFileSync(f.files[0], readFileSync(f.files[0], 'utf8') + '\n')
  assert.equal(machineForMirror(readCarrierMirrorMeta(f.root, f.files[0], plan.document, sshConnectorTargetIdentity), [next]), null)
  plan.document.list[0] = { ...next, expectedHostFingerprint: 'other' }
  assert.equal(machineForMirror(readCarrierMirrorMeta(f.root, f.files[1], plan.document, sshConnectorTargetIdentity), [next]), null)
})
test('repeated retarget composes only previously authorized exact-byte mirrors', () => {
  const f = fixture(), next = prepare(request())
  const first = planCarrierRetarget({ ...f, previous, next, targetIdentity: sshConnectorTargetIdentity })
  const last = prepareCarrierRetarget(next, { ...request(), expectedConnector: next.connector, connector: { ...next.connector, tunnelId: 'last' } }, normalizeCarrierMachine)
  const second = planCarrierRetarget({ root: f.root, document: first.document, previous: next, next: last, targetIdentity: sshConnectorTargetIdentity })
  assert.equal(second.retargetedMirrors, 2)
  assert.equal(machineForMirror(readCarrierMirrorMeta(f.root, f.files[0], second.document, sshConnectorTargetIdentity), [last]).record, last)
})
test('precommit failure and stale registry do not partially migrate anything', () => {
  const f = fixture(), bytes = readFileSync(f.registry), next = prepare(request())
  const plan = planCarrierRetarget({ ...f, previous, next, targetIdentity: sshConnectorTargetIdentity })
  assert.throws(() => commitCarrierRegistry(f.registry, bytes, plan.document, { beforeRename() { throw new Error('injected disk failure') } }), /disk failure/)
  assert.deepEqual(readFileSync(f.registry), bytes); assert.equal(existsSync(f.registry + '.retarget-lock'), false)
  writeFileSync(f.registry, JSON.stringify({ ...f.document, revision: 2 }))
  assert.throws(() => commitCarrierRegistry(f.registry, bytes, plan.document), /registry changed/)
  assert.equal(JSON.parse(readFileSync(f.registry)).revision, 2)
})
test('registry lock and machine gate reject concurrent writers then release', () => {
  const f = fixture(); writeFileSync(f.registry + '.retarget-lock', '')
  assert.throws(() => commitCarrierRegistry(f.registry, readFileSync(f.registry), f.document), /already in progress/)
  const gate = createRetargetGate(); const unblock = gate.block(previous.id)
  assert.throws(() => gate.block(previous.id), /already in progress/)
  assert.throws(() => gate.assertAvailable(previous.id), /already in progress/)
  gate.assertAvailable('other'); unblock(); gate.assertAvailable(previous.id)
})
