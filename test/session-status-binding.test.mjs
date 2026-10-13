import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createReact, loadClient } from './support/slot-harness.mjs'
const source = readFileSync(new URL('../lib/client/client.js', import.meta.url), 'utf8')
const load = () => loadClient(source, { React: createReact().React }).exports
const binding = { schemaVersion: 3, mode: 'remote', transport: 'ssh', machineId: 'm-muzdafzl-9i0a',
  connectorTargetIdentity: '["devtunnel-target-v1","devtunnel","interesting-pond-7vcxn8k.jpe1",22]' }
const machine = { id: binding.machineId, transport: 'ssh', connector: {
  kind: 'devtunnel', mode: 'managed', tunnelId: 'interesting-pond-7vcxn8k.jpe1', remotePort: 22, channelId: 'channel-lab' } }
test('schema-3 Dev Tunnel mirror is recognized while disconnected without any Git response', async () => {
  const module = load(), calls = []
  const value = await module.pullSessionDevTunnelStatus('/mirror/wxaai-data-lab', async url => {
    calls.push(url)
    if (url.startsWith('/dsh-remote/resolve-mirror?')) return binding
    if (url === '/dsh-remote/machines') return { machines: [machine] }
    if (url === '/dsh-devtunnel-ssh/channels') return { ok: true, channels: [{ channelId: 'channel-lab',
      tunnelId: machine.connector.tunnelId, remotePort: 22, mode: 'managed', state: 'stopped', endpoint: null }] }
    throw Error('unexpected route')
  })
  assert.equal(value.state, 'stopped')
  assert.equal(calls.some(url => url.includes('git-workspace')), false)
})
test('known Dev Tunnel workspace keeps an unknown-status chip if channel feed fails', async () => {
  const module = load()
  const value = await module.pullSessionDevTunnelStatus('/mirror/wxaai-data-lab', async url => {
    if (url.startsWith('/dsh-remote/resolve-mirror?')) return binding
    if (url === '/dsh-remote/machines') return { machines: [machine] }
    throw Error('channel feed offline')
  })
  assert.equal(value.state, 'unavailable')
  assert.equal(value.code, 'CHANNELS_UNAVAILABLE')
})
test('direct SSH machine is not classified as Dev Tunnel despite shared ssh transport', () => {
  assert.equal(load().resolveSessionDevTunnelStatus(binding, [{ id: binding.machineId, transport: 'ssh', host: 'example.test' }], []), null)
})
test('explicit missing channel never silently matches another channel with the same target', () => {
  const value = load().resolveSessionDevTunnelStatus(binding, [machine], [{ channelId: 'other-channel',
    tunnelId: machine.connector.tunnelId, remotePort: 22, mode: 'managed', state: 'ready' }])
  assert.equal(value.state, 'missing')
})

const connection = { schemaVersion: 1, scope: 'workspace', binding: 'bound', machineId: machine.id,
  protocol: 'ssh', path: 'carrier', carrierKind: 'devtunnel', mode: 'managed',
  carrierTarget: { tunnelId: machine.connector.tunnelId, remotePort: 22, channelId: 'channel-lab' },
  ssh: { state: 'disconnected' } }
test('shared connection contract uses only status and channels; ready does not imply SSH connected', async () => {
  const calls = []
  const result = await load().pullSessionDevTunnelStatus('/mirror/lab', async url => {
    calls.push(url)
    if (url.startsWith('/dsh-remote/status?')) return { connection }
    if (url === '/dsh-devtunnel-ssh/channels') return { ok: true, channels: [{ channelId: 'channel-lab',
      tunnelId: machine.connector.tunnelId, remotePort: 22, mode: 'managed', state: 'ready' }] }
    throw Error('unexpected fallback')
  }, 'session-lab')
  assert.equal(result.state, 'ready')
  assert.equal(result.sshState, 'disconnected')
  assert.equal(calls.length, 2)
  assert.match(calls[0], /sessionId=session-lab/)
})
test('explicit local/unavailable/unknown-version summaries never fallback to another machine', async () => {
  for (const value of [{ ...connection, binding: 'local' }, { ...connection, binding: 'unavailable' },
    { ...connection, schemaVersion: 2 }, { ...connection, path: 'direct', carrierKind: undefined }]) {
    const calls = []
    const result = await load().pullSessionDevTunnelStatus('/mirror/lab', async url => {
      calls.push(url); return { connection: value }
    })
    assert.equal(result, null)
    assert.equal(calls.length, 1)
  }
})
test('real producer projection specializes Dev Tunnel while preserving separate SSH state', async () => {
  const { workspaceConnection } = await import('../../dsh-remote/lib/workspace-connection.js')
  const summary = workspaceConnection({ mirror: binding, record: machine,
    targetIdentity: binding.connectorTargetIdentity, connected: false })
  const result = load().specializeDevTunnelConnection(summary, [])
  assert.equal(result.state, 'missing')
  assert.equal(result.sshState, 'disconnected')
  assert.equal(summary.path, 'carrier')
  assert.equal(summary.protocol, 'ssh')
})
