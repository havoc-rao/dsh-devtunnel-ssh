// Staged backend primitives; integration is intentionally NOT applied to sibling checkout.
import { isDeepStrictEqual } from 'node:util'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, openSync, closeSync, fsyncSync, renameSync, unlinkSync, lstatSync, readdirSync } from 'node:fs'
import path from 'node:path'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }) }
const strict = m => m?.schemaVersion === 3 && m.transport === 'ssh' && typeof m.machineId === 'string' && !!m.machineId && typeof m.connectorTargetIdentity === 'string' && !!m.connectorTargetIdentity
const pin = value => typeof value === 'string' && /^SHA256:[A-Za-z0-9+/]{43}=?$/.test(value) && Buffer.from(value.slice(7), 'base64').toString('base64').replace(/=+$/, '') === value.slice(7).replace(/=+$/, '')
export function prepareCarrierRetarget(previous, body, normalize) {
  if (!previous || previous.id !== body.id) fail('machine not found', 404)
  if (body.confirmed !== true) fail('explicit carrier retarget confirmation required')
  if (previous.transport !== 'ssh' || previous.connector?.kind !== 'devtunnel' || body.connector?.kind !== 'devtunnel') fail('retarget supports devtunnel to devtunnel only')
  if (!isDeepStrictEqual(previous.connector, body.expectedConnector)) fail('saved connector changed; reload before retargeting', 409)
  if (!pin(previous.expectedHostFingerprint) || body.expectedHostFingerprint !== previous.expectedHostFingerprint) fail('retarget cannot replace the trusted fingerprint')
  const normalized = normalize({ ...previous, connector: body.connector })
  return { ...previous, connector: normalized.connector }
}
function realMetaPath(root, metaPath) {
  root = path.resolve(root); metaPath = path.resolve(metaPath)
  const relative = path.relative(root, metaPath).split(path.sep)
  if (relative.length !== 3 || relative[0] === '..' || relative[2] !== '.dsh-remote-meta.json') fail('mirror path outside registry')
  let current = root
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) fail('invalid mirror root')
  for (const [i, part] of relative.entries()) {
    current = path.join(current, part)
    const stat = lstatSync(current)
    if (stat.isSymbolicLink() || (i < 2 ? !stat.isDirectory() : !stat.isFile())) fail('unsafe mirror path')
  }
  return metaPath
}
export function projectCarrierMeta(meta, bytes, metaPath, document, targetIdentity) {
  if (!strict(meta)) return meta
  const key = path.resolve(metaPath)
  const binding = document.carrierMirrorBindings?.[key]
  if (!binding || binding.digest !== hash(bytes) || binding.machineId !== meta.machineId || binding.sourceIdentity !== meta.connectorTargetIdentity) return meta
  const machine = document.list?.find(m => m.id === binding.machineId)
  if (!machine || machine.connector?.kind !== 'devtunnel' || !pin(machine.expectedHostFingerprint) || machine.expectedHostFingerprint !== binding.fingerprint) return meta
  let current
  try { current = targetIdentity(machine.connector) } catch { return meta }
  if (current !== binding.targetIdentity) return meta
  return { ...meta, connectorTargetIdentity: current }
}
export function readCarrierMirrorMeta(root, metaPath, document, targetIdentity) {
  const file = realMetaPath(root, metaPath)
  const bytes = readFileSync(file)
  return projectCarrierMeta(JSON.parse(bytes), bytes, file, document, targetIdentity)
}
export function planCarrierRetarget({ root, document, previous, next, targetIdentity }) {
  const sourceIdentity = targetIdentity(previous.connector)
  const destinationIdentity = targetIdentity(next.connector)
  const bindings = Object.fromEntries(Object.entries(document.carrierMirrorBindings || {}).filter(([, v]) => v.machineId !== previous.id))
  let count = 0
  for (const host of readdirSync(root, { withFileTypes: true })) {
    if (!host.isDirectory() || host.isSymbolicLink()) continue
    const hostPath = path.join(root, host.name)
    for (const child of readdirSync(hostPath, { withFileTypes: true })) {
      if (!child.isDirectory() || child.isSymbolicLink()) continue
      const file = path.join(hostPath, child.name, '.dsh-remote-meta.json')
      let bytes, meta
      try { realMetaPath(root, file); bytes = readFileSync(file); meta = JSON.parse(bytes) } catch (error) {
        if (error.code === 'ENOENT') continue
        // Malformed metadata cannot gain authority; ignore it, never rewrite it.
        if (error instanceof SyntaxError) continue
        throw error
      }
      const effective = projectCarrierMeta(meta, bytes, file, document, targetIdentity)
      if (!strict(effective) || effective.machineId !== previous.id || effective.connectorTargetIdentity !== sourceIdentity || typeof effective.remotePath !== 'string' || !effective.remotePath) continue
      bindings[path.resolve(file)] = { machineId: previous.id, digest: hash(bytes), sourceIdentity: meta.connectorTargetIdentity, targetIdentity: destinationIdentity, fingerprint: previous.expectedHostFingerprint }
      count++
    }
  }
  return { document: { ...document, list: document.list.map(m => m.id === previous.id ? next : m), carrierMirrorBindings: bindings }, retargetedMirrors: count }
}
// Synchronous CAS and atomic replacement. Caller must publish in-memory state
// synchronously after return, with no await, while its exclusion gate is held.
export function commitCarrierRegistry(file, expectedBytes, document, { beforeRename } = {}) {
  if (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile()) fail('unsafe machine registry')
  const lock = file + '.retarget-lock'
  let lockFd
  try { lockFd = openSync(lock, 'wx', 0o600) } catch (error) { if (error.code === 'EEXIST') fail('registry write already in progress', 409); throw error }
  const temp = file + '.retarget-' + randomUUID()
  let fd
  try {
    if (!readFileSync(file).equals(Buffer.from(expectedBytes))) fail('machine registry changed; reload before retargeting', 409)
    fd = openSync(temp, 'wx', 0o600)
    writeFileSync(fd, JSON.stringify(document, null, 2)); fsyncSync(fd); closeSync(fd); fd = undefined
    beforeRename?.()
    if (!readFileSync(file).equals(Buffer.from(expectedBytes))) fail('machine registry changed; reload before retargeting', 409)
    renameSync(temp, file) // Commit point. Do not throw a post-commit cleanup error.
  } finally {
    if (fd !== undefined) try { closeSync(fd) } catch {}
    try { unlinkSync(temp) } catch {}
    try { closeSync(lockFd) } catch {}
    try { unlinkSync(lock) } catch {}
  }
}
// Host route adapter. The caller must share assertAvailable with every registry
// mutator and cache get; cache itself must also reject stale saved-record revisions.
export function createCarrierRetargetTransaction({ registryFile, root, machines, normalize, targetIdentity, invalidate, gate = createRetargetGate(), commit = commitCarrierRegistry }) {
  return async function retarget(body) {
    const id = body.id
    gate.assertAvailable(id)
    const index = machines.findIndex(m => m.id === id)
    const previous = index < 0 ? null : structuredClone(machines[index])
    const next = prepareCarrierRetarget(previous, body, normalize)
    const expectedBytes = readFileSync(registryFile)
    const document = JSON.parse(expectedBytes)
    const persisted = document.list?.find(m => m.id === id)
    if (!isDeepStrictEqual(persisted, previous)) fail('saved machine registry changed; reload before retargeting', 409)
    const unblock = gate.block(id)
    try {
      await invalidate(id)
      const currentIndex = machines.findIndex(m => m.id === id)
      if (currentIndex < 0 || !isDeepStrictEqual(machines[currentIndex], previous)) fail('saved machine changed during retarget', 409)
      if (!readFileSync(registryFile).equals(expectedBytes)) fail('machine registry changed during retarget', 409)
      const plan = planCarrierRetarget({ root, document, previous, next, targetIdentity })
      // No awaits between plan, CAS commit and publication. Failure leaves the
      // old metadata/registry authoritative and the old connection closed.
      commit(registryFile, expectedBytes, plan.document)
      machines[currentIndex] = next
      return { machine: next, retargetedMirrors: plan.retargetedMirrors }
    } finally { unblock() }
  }
}
export function createRetargetGate() {
  const blocked = new Set()
  return {
    assertAvailable(id) { if (blocked.has(id)) fail('machine retarget already in progress', 409) },
    block(id) { this.assertAvailable(id); blocked.add(id); return () => blocked.delete(id) },
  }
}
