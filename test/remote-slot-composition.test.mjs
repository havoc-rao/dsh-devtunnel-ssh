// Cross-repo composition acceptance: the real dsh-remote client bundle provides
// the machine-form slots and the real dsh-devtunnel-ssh client bundle injects
// the Dev Tunnel SSH transport into them. Both bundles are loaded unmodified
// from their checkouts; only the surrounding React/slot/page doubles are fakes.
//
// This is the test that proves "dsh-remote only provides a slot, this plugin
// injects the type + channel mode" without a browser or a deployed profile.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createReact, createSlots, loadClient, nodes, text, findButton, findInput, fingerprint } from './support/slot-harness.mjs'

const remoteSource = readFileSync(new URL('../../dsh-remote/lib/client.js', import.meta.url), 'utf8')
const devtunnelSource = readFileSync(new URL('../lib/client/client.js', import.meta.url), 'utf8')

const capable = { sshCarrierCapabilities: { workspaceSupported: true, carrierIds: ['devtunnel'] } }
const managed = { sshCarrierCapabilities: { workspaceSupported: true, carrierIds: ['devtunnel'], devTunnelManaged: true } }
const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }

function boot({ status = capable, machines = [], cwd = '/local/ws', order = 'occupant-first', only = 'both' } = {}) {
  const env = createReact()
  const slots = createSlots(env.React)
  const requests = []
  const fetchImpl = async (url, opts = {}) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : undefined
    requests.push({ url, method: (opts && opts.method) || 'GET', body })
    let data = { ok: true }
    if (url === '/dsh-remote/slot-config') data = {}
    else if (url.startsWith('/dsh-remote/status')) data = status
    else if (url === '/dsh-remote/machines') data = body ? { ok: true, machine: { ...body, id: 'mac-b' } } : { machines }
    else if (url === '/dsh-devtunnel-ssh/channels') data = {
      ok: true, revision: 0, catalogRevision: 1, enabled: true, activeManaged: 1,
      channels: [{ channelId: 'channel-b', name: 'Mac B', mode: 'managed', tunnelId: 'fixture.euw', remotePort: 22, state: 'ready', endpoint: { host: '127.0.0.1', port: 53162 }, since: 1760000000000, generation: 'g1', refs: 1 }],
      supervisor: [{ tunnelId: 'fixture.euw', remotePort: 22, active: true, pending: false, failures: 0, blocked: null, cooldownUntil: null }],
      recent: [{ seq: 1, at: 1760000001000, code: 'CONNECT_READY', reason: 'FORWARDING_MATCHED', endpoint: { host: '127.0.0.1', port: 53162 } }],
    }
    else if (url.startsWith('/dsh-remote/mirror')) data = { ok: true, localMirror: '/local/mirror/mac-b' }
    else if (url.startsWith('/dsh-devtunnel-ssh/settings')) data = {
      ok: true, available: true, revision: 0, source: 'config', activeManaged: 0,
      settings: { cliExecutable: '', managedEnabled: false, residentTunnelId: '', residentRemotePort: 0, residentMode: 'off' },
      cli: { status: 'not-found', source: 'path', resolvedExecutable: '' },
    }
    return { ok: true, status: 200, json: async () => data }
  }
  const services = {
    slots,
    locale: { register: () => () => {}, bind: () => key => 'T:' + key },
    sessions: { list: { getSnapshot: () => ({ current: 's', byId: { s: { cwd } } }), subscribe: () => () => {} } },
  }
  const ctx = {
    get: name => services[name],
    effect: fn => fn(),
    inject: (names, callback) => { if (names.every(name => services[name] !== undefined)) callback(ctx) },
    provide() {}, on() {}, logger: { warn() {} },
  }
  const load = source => loadClient(source, { React: env.React, fetchImpl }).exports
  const devtunnel = load(devtunnelSource)
  const remote = load(remoteSource)
  // Load the occupant FIRST: a declared-later slot must still receive it.
  const boot1 = order === 'occupant-first' ? [devtunnel, remote] : [remote, devtunnel]
  const plugins = only === 'owner' ? [remote] : only === 'occupant' ? [devtunnel] : boot1
  return { env, slots, requests, devtunnel, remote, ctx, boot: async () => { for (const plugin of plugins) await plugin.apply(ctx) } }
}

/** Renders dsh-remote's settings page with the slot renderer wired in. */
async function mountPage(world) {
  await world.boot()
  const section = world.slots.entries('settings.section').find(entry => entry.def.id === 'dsh-remote')
  assert.ok(section, 'dsh-remote registers its settings section')
  const renderSlot = (key, owner, opts) => world.slots.renderSlot(key, owner, opts)
  const pass = () => { const element = section.component({ renderSlot }); world.env.reset(); return element.type(element.props) }
  let tree = pass()
  world.env.flush()
  await tick()
  tree = pass()
  world.env.flush()
  await tick()
  // Two passes per render: an occupant's mount effect patches the owner draft,
  // and the owner must re-render before that draft is visible in the tree.
  const render = () => { tree = pass(); world.env.flush(); tree = pass(); world.env.flush(); return tree }
  return {
    render,
    get tree() { return tree },
    async click(label) { const button = findButton(tree, label); assert.ok(button, 'button ' + label); await button.props.onClick(); await tick(); return render() },
    async input(key, value) { findInput(tree, key).props.onChange({ target: { value } }); await tick(); return render() },
  }
}

const transportButton = (tree, label) => findButton(tree, label)

test('dsh-remote declares the three transport slots and this plugin fills them', async () => {
  const world = boot()
  await mountPage(world)
  assert.ok(world.slots.spec(world.devtunnel.SLOT_TRANSPORT_OPTION), 'option slot declared by dsh-remote')
  assert.ok(world.slots.spec(world.devtunnel.SLOT_TRANSPORT_FIELDS), 'fields slot declared by dsh-remote')
  assert.ok(world.slots.spec(world.devtunnel.SLOT_TRANSPORT_PANEL), 'panel slot declared by dsh-remote')
  assert.deepEqual(world.slots.entries(world.devtunnel.SLOT_TRANSPORT_OPTION).map(entry => entry.def.id).sort(), ['devtunnel-ssh', 'ssh'])
  assert.deepEqual(world.slots.entries(world.devtunnel.SLOT_TRANSPORT_FIELDS).map(entry => entry.def.key).sort(), ['devtunnel-ssh', 'ssh'])
  assert.deepEqual(world.slots.entries(world.devtunnel.SLOT_TRANSPORT_PANEL).map(entry => entry.def.id), ['devtunnel-ssh'])
  const registrant = world.slots.entries(world.devtunnel.SLOT_TRANSPORT_OPTION).find(entry => entry.def.id === 'devtunnel-ssh')
  assert.equal(registrant.def.order, 10)
})

test('the channel box renders inside the owner page with the injected panel', async () => {
  const world = boot()
  const page = await mountPage(world)
  await tick()
  page.render()
  const body = text(page.tree)
  assert.match(body, /panelTitle|Dev Tunnel channels/u, 'panel title comes from the plugin occupant')
  const panel = nodes(page.tree).find(node => node.props && node.props['data-testid'] === 'devtunnel-channel-panel')
  assert.ok(panel, 'the injected box is mounted in the page')
  const catalog = nodes(panel).find(n => n.type === world.devtunnel.ChannelCatalog)
  assert.equal(catalog.props.feed.channels[0].tunnelId, 'fixture.euw')
  assert.equal(catalog.props.feed.channels[0].endpoint.port, 53162)
  // The box must sit after the machine list and before the add/edit card. The
  // per-test fake renderer flattens the tree, so compare node order instead.
  const order = nodes(page.tree)
  const machinesRow = order.findIndex(node => typeof node.children !== 'undefined' && /machines|No machines|settings\.machines/u.test(text(node)) && order.indexOf(node) < order.indexOf(panel))
  assert.ok(machinesRow >= 0, 'machine list card precedes the channel box')
})

test('an absent panel occupant leaves no placeholder in the owner page', async () => {
  // Withhold the plugin's own panel registration: only dsh-remote boots.
  const world = boot({ only: 'owner' })
  await world.boot()
  const section = world.slots.entries('settings.section').find(entry => entry.def.id === 'dsh-remote')
  const renderSlot = (key, owner, opts) => world.slots.renderSlot(key, owner, opts)
  const element = section.component({ renderSlot })
  world.env.reset()
  const tree = element.type(element.props)
  world.env.flush()
  assert.equal(nodes(tree).some(node => node.props && node.props['data-testid'] === 'devtunnel-channel-panel'), false)
})

test('the owner page renders both transport buttons and only the plugin renders the devtunnel form', async () => {
  const world = boot()
  const page = await mountPage(world)
  assert.equal(transportButton(page.tree, 'SSH').props.disabled, false)
  assert.equal(transportButton(page.tree, 'Dev Tunnel SSH').props.disabled, false)
  // dsh-remote keeps the shared name row; devtunnel fields are absent while SSH is selected,
  // and the SSH fields shown here come from dsh-remote's own keyed occupant.
  assert.ok(findInput(page.tree, 'n'))
  assert.equal(findInput(page.tree, 'ctid'), undefined)
  assert.ok(findInput(page.tree, 'h'), 'SSH host field comes from the ssh occupant')
})

test('selecting the injected type renders the injected channel mode and fields, and saving posts the plugin draft', async () => {
  const world = boot({ status: managed })
  const page = await mountPage(world)
  await page.click('Dev Tunnel SSH')
  assert.ok(findInput(page.tree, 'ctid'), 'Tunnel ID field comes from the plugin occupant')
  assert.ok(findButton(page.tree, 'T:carrierManaged'), 'managed mode button comes from the plugin occupant')
  assert.ok(findButton(page.tree, 'T:carrierExternal'))
  // A fresh draft defaults to managed because the host authorized it.
  assert.equal(findInput(page.tree, 'clp'), undefined, 'managed hides the external loopback port')

  const type = page.input
  await type('cu', 'dev')
  const select = nodes(page.tree).find(n => n.type === 'select' && (n.children || []).flat(Infinity).some(c => c?.props?.value === 'channel-b'))
  select.props.onChange({ target: { value: 'channel-b' } }); await tick(); page.render()
  await type('cfp', fingerprint)
  const save = findButton(page.tree, 'T:settings.save')
  assert.equal(save.props.disabled, false, 'published draft with valid fields enables the owner save')
  await save.props.onClick()
  await tick()
  page.render()
  const saved = world.requests.find(request => request.url === '/dsh-remote/machines' && request.body)
  assert.ok(saved, 'owner committed the plugin-published body')
  assert.equal(saved.body.action, 'add')
  assert.equal(saved.body.transport, 'ssh')
  assert.equal(saved.body.expectedHostFingerprint, fingerprint)
  assert.deepEqual(saved.body.connector, { kind: 'devtunnel', mode: 'managed', channelId: 'channel-b', tunnelId: 'fixture.euw', remotePort: 22 })
})

test('saved carrier testing preserves machine identity and rejects an unsaved draft', async () => {
  const machine = { id: 'mac-mini', name: 'Mac', transport: 'ssh', username: 'dev', useAgent: true,
    privateKeyPath: '', hostKeyMode: 'verify', expectedHostFingerprint: fingerprint,
    connector: { kind: 'devtunnel', mode: 'managed', tunnelId: 'fixture.euw', remotePort: 22 } }
  const world = boot({ status: managed, machines: [machine] })
  const page = await mountPage(world)
  await page.click('T:settings.edit')
  await page.click('T:settings.testConn')
  const probes = () => world.requests.filter(request => request.url === '/dsh-remote/test-connect')
  assert.equal(probes().length, 1)
  assert.equal(probes()[0].body.id, 'mac-mini', 'a probe must not invent another machine identity')
  await page.input('cu', 'unsaved-user')
  const testButton = findButton(page.tree, 'T:settings.testOk') || findButton(page.tree, 'T:settings.testConn')
  assert.ok(testButton)
  testButton.props.onClick()
  await tick()
  assert.equal(probes().length, 1, 'unsaved changes cannot silently borrow the saved target')
})

test('the owner gates saving on the injected capability-validated draft', async () => {
  const world = boot({ status: capable })
  const page = await mountPage(world)
  await page.click('Dev Tunnel SSH')
  assert.equal(findButton(page.tree, 'T:settings.save').props.disabled, true, 'no identity yet')
  const type = page.input
  await type('cu', 'dev')
  await type('ctid', 'abc123')
  await type('cfp', fingerprint)
  assert.equal(findButton(page.tree, 'T:settings.save').props.disabled, false)
  await type('clp', '65536')
  assert.equal(findButton(page.tree, 'T:settings.save').props.disabled, true, 'invalid loopback port blocks the owner save')
})

test('an unavailable carrier disables the injected type option while SSH stays usable', async () => {
  const world = boot({ status: null })
  const page = await mountPage(world)
  assert.equal(transportButton(page.tree, 'Dev Tunnel SSH').props.disabled, true)
  assert.equal(transportButton(page.tree, 'SSH').props.disabled, false)
  assert.match(text(page.tree), /T:carrierUnavailableHint/)
})

test('load order does not matter: declaring first or injecting first both compose', async () => {
  for (const order of ['occupant-first', 'owner-first']) {
    const world = boot({ order })
    const page = await mountPage(world)
    assert.equal(transportButton(page.tree, 'Dev Tunnel SSH').props.disabled, false, order)
    await page.click('Dev Tunnel SSH')
    assert.ok(findInput(page.tree, 'ctid'), order)
  }
})
