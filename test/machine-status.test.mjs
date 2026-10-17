import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createReact, createSlots, loadClient } from './support/slot-harness.mjs'
const source = readFileSync(new URL('../lib/client/client.js', import.meta.url), 'utf8')
const load = () => loadClient(source, { React: createReact().React }).exports
const machine = { id: 'm1', connector: { kind: 'devtunnel', mode: 'managed', tunnelId: 'abc', remotePort: 22, channelId: 'c1' } }
const feed = { ok: true, enabled: true, catalogRevision: 7, channels: [{ channelId: 'c1', mode: 'managed', tunnelId: 'abc', remotePort: 22, state: 'stopped' }] }

test('machine slots wait for their distinct owners; plain SSH renders nothing', () => {
  const m = load(), slots = createSlots(createReact().React)
  m.apply({ get: key => key === 'slots' ? slots : null })
  for (const name of m.MACHINE_STATUS_SLOTS) {
    slots.register({ name: 'settings.section', id: name, children: { [name]: { kind: 'list', scope: 'root' } } }, () => null)
    assert.equal(slots.entries(name).length, 1)
    assert.equal(slots.entries(name)[0].component, m.MachineDevTunnelStatus)
  }
  assert.equal(m.MachineDevTunnelStatus({ machine: { id: 'ssh' } }), null)
  assert.equal(m.MachineDevTunnelStatus({ machine }).props.machine, machine)
})

test('machine chip renders live tunnel state and delegates menu actions without workspace resolution', async () => {
  const env = createReact(), calls = []
  const { exports: m } = loadClient(source, { React: env.React, fetchImpl: async (url, options) => {
    calls.push([url, options.method])
    return { ok: true, json: async () => feed }
  } })
  const render = props => { env.reset(); return m.SessionDevTunnelStatus({ machine, ...props }) }
  assert.equal(render(), null)
  env.flush()
  await new Promise(resolve => setImmediate(resolve))
  let menu = render()
  assert.equal(menu.type, 'HostMenu')
  assert.equal(menu.props.portal, true, 'status menu must escape the picker card clipping container')
  assert.equal(menu.props.listClassName, 'dvt-session-menu', 'use the standard host portal layer, not a private z-index override')
  assert.equal(typeof menu.props.getAnchorRect, 'function')
  assert.match(menu.props.anchor.props.title, /sessionStatusStopped/)
  assert.equal(menu.props.items.find(item => item.id === 'start').disabled, false)
  assert.equal(render({ busy: true }).props.items.find(item => item.id === 'start').disabled, true)
  menu.props.anchor.props.onClick()
  assert.equal(render().props.open, true)
  assert.equal(render({ machine: { ...machine, id: 'different' } }), null, 'old item status is hidden synchronously')
  assert.deepEqual(calls, [['/dsh-devtunnel-ssh/channels', 'GET']])
})

test('list status is a passive tag while selected status keeps its menu', async () => {
  const env = createReact()
  const { exports: m } = loadClient(source, { React: env.React, fetchImpl: async () => ({ ok: true, json: async () => feed }) })
  const render = interactive => { env.reset(); return m.SessionDevTunnelStatus({ machine, interactive }) }
  assert.equal(render(false), null)
  env.flush()
  await new Promise(resolve => setImmediate(resolve))
  const tag = render(false)
  assert.equal(tag.type, 'span')
  assert.match(tag.props.className, /dvt-session-tag-static/)
  assert.match(tag.props.title, /sessionStatusStopped/)
  for (const key of ['onClick', 'tabIndex', 'role', 'aria-haspopup', 'aria-expanded']) assert.equal(tag.props[key], undefined)
  assert.equal(tag.children.length, 2, 'dot and label only; no dropdown chevron')
  const menu = render(true)
  assert.equal(menu.type, 'HostMenu')
  assert.equal(menu.props.anchor.type, 'button')
  menu.props.anchor.props.onClick()
  assert.equal(render(true).props.open, true)
  assert.equal(render(false).type, 'span', 'list mode cannot render a previously opened menu')
})

test('visible machine chips coalesce their catalog reads', async () => {
  const env = createReact(), requests = []
  let release
  const pending = new Promise(resolve => { release = resolve })
  const { exports: m } = loadClient(source, { React: env.React, fetchImpl: async url => {
    requests.push(url)
    await pending
    return { ok: true, json: async () => feed }
  } })
  m.SessionDevTunnelStatus({ machine })
  m.SessionDevTunnelStatus({ machine: { ...machine, id: 'm2' } })
  env.flush()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(requests, ['/dsh-devtunnel-ssh/channels'])
  release()
  await new Promise(resolve => setImmediate(resolve))
})

test('machine status fails closed for missing, mismatched, and unavailable channels', () => {
  const m = load()
  assert.equal(m.machineTunnelStatus(machine, feed).state, 'stopped')
  assert.equal(m.machineTunnelStatus(machine).state, 'unavailable')
  assert.equal(m.machineTunnelStatus(machine, { ...feed, channels: [] }).state, 'missing')
  assert.equal(m.machineTunnelStatus(machine, { ...feed, channels: [{ ...feed.channels[0], tunnelId: 'other' }] }).code, 'CHANNEL_TARGET_CHANGED')
})

function rig({ saved = machine, catalog = feed, confirm = () => true, current = () => true } = {}) {
  const m = load(), calls = []
  const request = async (url, options) => {
    calls.push({ url, ...options })
    if (options.method === 'POST') return { ok: true }
    return url.endsWith('/machines') ? { machines: saved ? [saved] : [] } : catalog
  }
  return { calls, run: () => m.runMachineTunnelAction('start', m.machineTunnelStatus(machine, feed), machine, request, confirm, current) }
}

test('machine start revalidates registry, uses fresh revision, never connects SSH', async () => {
  const r = rig({ catalog: { ...feed, catalogRevision: 9 } })
  assert.equal(await r.run(), true)
  assert.deepEqual(r.calls.map(c => [c.url, c.method]), [['/dsh-remote/machines', 'GET'], ['/dsh-devtunnel-ssh/channels', 'GET'], ['/dsh-devtunnel-ssh/channels', 'POST']])
  assert.deepEqual(JSON.parse(r.calls[2].body), { action: 'start', channelId: 'c1', revision: 9, confirmed: true })
})

test('machine actions reject changed/deleted binding and unsafe catalog without writes', async () => {
  for (const args of [
    { saved: null }, { saved: { ...machine, connector: { ...machine.connector, tunnelId: 'other' } } },
    { catalog: { ...feed, enabled: false } }, { catalog: { ...feed, channels: [] } },
    { catalog: { ...feed, channels: [{ ...feed.channels[0], state: 'stopping' }] } },
    { catalog: { ok: false } }, { current: () => false },
  ]) {
    const r = rig(args)
    await assert.rejects(r.run())
    assert.equal(r.calls.some(c => c.method === 'POST'), false)
  }
})

test('external chips stay read-only and unknown states cannot trigger writes', async () => {
  const m = load()
  const external = { ...machine, connector: { ...machine.connector, mode: 'external', endpoint: { host: '127.0.0.1', port: 2222 } } }
  const status = m.machineTunnelStatus(external)
  assert.equal(status.state, 'external')
  await assert.rejects(m.runMachineTunnelAction('start', status, external, () => { throw new Error('unexpected request') }, () => true), /CHANNELS_REJECTED/)
  const r = rig({ catalog: { ...feed, channels: [{ ...feed.channels[0], state: 'future-state' }] } })
  await assert.rejects(r.run(), /CHANNEL_NOT_READY/)
  assert.equal(r.calls.some(c => c.method === 'POST'), false)
})

test('POST failure is surfaced once without retry or channel creation', async () => {
  const m = load(), writes = []
  await assert.rejects(m.runMachineTunnelAction('start', m.machineTunnelStatus(machine, feed), machine,
    async (url, options) => {
      if (options.method === 'POST') { writes.push(JSON.parse(options.body)); throw new Error('REVISION_CONFLICT') }
      return url.endsWith('/machines') ? { machines: [machine] } : feed
    }, () => true), /REVISION_CONFLICT/)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].action, 'start')
})

test('cancel and already starting/recovering/ready do not write', async () => {
  for (const args of [{ confirm: () => false }, ...['ready', 'starting', 'recovering'].map(state => ({ catalog: { ...feed, channels: [{ ...feed.channels[0], state }] } }))]) {
    const r = rig(args)
    assert.equal(await r.run(), false)
    assert.equal(r.calls.some(c => c.method === 'POST'), false)
  }
})
