import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createReact, loadClient } from './support/slot-harness.mjs'
const source = readFileSync(new URL('../lib/client/client.js', import.meta.url), 'utf8')
const load = () => loadClient(source, { React: createReact().React }).exports
const target = { mode: 'managed', channelId: 'c1', tunnelId: 'lab.jpe1', remotePort: 22 }
const summary = { schemaVersion: 1, scope: 'workspace', binding: 'bound', machineId: 'm1', protocol: 'ssh',
  path: 'carrier', carrierKind: 'devtunnel', mode: 'managed', carrierTarget: target, ssh: { state: 'unknown' } }
function rig({ state = 'stopped', enabled = true, connection = summary, failPost = false } = {}) {
  const calls = []
  const request = async (url, options = {}) => {
    calls.push({ url, ...options })
    if (url.startsWith('/dsh-remote/status?')) return { connection }
    if (options.method === 'POST') {
      if (failPost) throw Error('SETTINGS_REVISION_CONFLICT')
      return { ok: true }
    }
    if (url === '/dsh-devtunnel-ssh/channels') return { ok: true, enabled, catalogRevision: 17,
      channels: [{ ...target, state }] }
    throw Error('unexpected route')
  }
  return { calls, request }
}
test('header action revalidates binding, confirms, posts exact channel and fresh revision once', async () => {
  for (const action of ['start', 'stop', 'restart']) {
    const f = rig({ state: action === 'start' ? 'stopped' : 'ready' })
    let confirms = 0
    assert.equal(await load().runSessionTunnelAction(action, target, '/mirror/lab', 's1', f.request,
      () => { confirms++; return true }), true)
    assert.equal(confirms, 1)
    const posts = f.calls.filter(call => call.method === 'POST')
    assert.equal(posts.length, 1)
    assert.equal(posts[0].url, '/dsh-devtunnel-ssh/channels')
    assert.deepEqual(JSON.parse(posts[0].body), { action, channelId: 'c1', revision: 17, confirmed: true })
  }
})
test('cancel, external, changed binding, disabled management and switched workspace never write', async () => {
  const module = load()
  const cancelled = rig()
  assert.equal(await module.runSessionTunnelAction('start', target, '/mirror/lab', 's1', cancelled.request, () => false), false)
  assert.equal(cancelled.calls.some(c => c.method === 'POST'), false)
  const external = rig()
  await assert.rejects(module.runSessionTunnelAction('start', { ...target, mode: 'external' }, '/mirror/lab', 's1', external.request, () => true), /CHANNELS_REJECTED/)
  assert.equal(external.calls.length, 0)
  for (const opts of [{ connection: { ...summary, carrierTarget: { ...target, channelId: 'c2' } } }, { enabled: false }]) {
    const f = rig(opts)
    await assert.rejects(module.runSessionTunnelAction('restart', target, '/mirror/lab', 's1', f.request, () => true))
    assert.equal(f.calls.some(c => c.method === 'POST'), false)
  }
  const switched = rig()
  await assert.rejects(module.runSessionTunnelAction('start', target, '/mirror/lab', 's1', switched.request,
    () => true, () => false), /CHANNEL_TARGET_CHANGED/)
  assert.equal(switched.calls.some(c => c.method === 'POST'), false)
})
test('failed mutation is never automatically replayed', async () => {
  const f = rig({ failPost: true })
  await assert.rejects(load().runSessionTunnelAction('start', target, '/mirror/lab', 's1', f.request, () => true), /SETTINGS_REVISION_CONFLICT/)
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1)
})
