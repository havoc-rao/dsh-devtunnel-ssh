import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createReact, createSlots, loadClient, nodes, text, findButton, findInput, fingerprint } from './support/slot-harness.mjs'

const source = readFileSync(new URL('../lib/client/client.js', import.meta.url), 'utf8')
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const CAPABLE = { sshCarrierCapabilities: { workspaceSupported: true, carrierIds: ['devtunnel'] } }
const MANAGED = { sshCarrierCapabilities: { workspaceSupported: true, carrierIds: ['devtunnel'], devTunnelManaged: true } }

function load(fetchImpl, timerOptions = {}) {
  const env = createReact()
  const loaded = loadClient(source, { React: env.React, ...timerOptions, ...(fetchImpl ? { fetchImpl } : {}) })
  return { env, module: loaded.exports, window: loaded.window }
}

/** Declares the owner side of the contract exactly as dsh-remote does. */
function declareOwnerSlots(slots, module) {
  slots.register({
    name: 'settings.section',
    id: 'dsh-remote',
    order: 40,
    children: {
      [module.SLOT_TRANSPORT_OPTION]: { kind: 'list', scope: 'root' },
      [module.SLOT_TRANSPORT_FIELDS]: { kind: 'keyed', scope: 'root' },
    },
  }, () => null)
}

test('browser half is declared in the manifest and registered as a classic client entry', () => {
  assert.equal(manifest.dsh.client.platform, 'web')
  for (const dependency of ['@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-locale']) {
    assert.ok(manifest.dsh.client.inject.includes(dependency), dependency)
  }
  assert.equal(manifest.exports['./client'], './lib/client/client.js')
  const { module } = load()
  assert.equal(module.name, 'dsh-devtunnel-ssh')
  assert.equal(typeof module.apply, 'function')
  assert.deepEqual(module.inject, ['slots', 'locale'])
  assert.equal(module.SLOT_TRANSPORT_OPTION, 'settings.remote.machine.transport.option')
  assert.equal(module.SLOT_TRANSPORT_FIELDS, 'settings.remote.machine.transport.fields')
})

test('apply injects both owner slots with the frozen id/key and tolerates a missing registry', () => {
  const { env, module } = load()
  const slots = createSlots(env.React)
  const services = { slots, locale: { register: () => () => {}, bind: () => key => 'T:' + key } }
  const ctx = { get: name => services[name], effect: fn => fn(), inject: () => {}, on() {}, logger: { warn() {} } }
  module.apply(ctx)
  assert.deepEqual(slots.registered.map(entry => entry.def.name), [], 'nothing registers before the owner declares')
  declareOwnerSlots(slots, module)
  const devtunnel = slots.registered.filter(entry => entry.def.name.startsWith('settings.remote.machine.transport'))
  assert.deepEqual(devtunnel.map(entry => [entry.def.name, entry.def.id || entry.def.key]),
    [[module.SLOT_TRANSPORT_OPTION, 'devtunnel-ssh'], [module.SLOT_TRANSPORT_FIELDS, 'devtunnel-ssh']])
  assert.equal(devtunnel[0].def.order, 10)

  // No slots service at all: the host half must still load cleanly.
  module.apply({ get: () => undefined, effect: fn => fn(), inject: () => {} })
  module.apply({ get: () => null, effect: fn => fn(), inject: () => {} })
})

test('registration lands even when the occupant loads after the declaration', () => {
  const { env, module } = load()
  const slots = createSlots(env.React)
  declareOwnerSlots(slots, module)
  const services = { slots, locale: { register: () => () => {}, bind: () => key => 'T:' + key } }
  module.apply({ get: name => services[name], effect: fn => fn(), inject: () => {}, on() {}, logger: { warn() {} } })
  assert.deepEqual(slots.registered.filter(entry => entry.def.name.startsWith('settings.remote.machine.transport')).map(entry => entry.def.id || entry.def.key), ['devtunnel-ssh', 'devtunnel-ssh'])
})

test('carrier capability gates readiness and the managed default', () => {
  const { module } = load()
  assert.equal(module.carrierReady(null), false)
  assert.equal(module.carrierReady({ sshCarrierCapabilities: { workspaceSupported: false, carrierIds: ['devtunnel'] } }), false)
  assert.equal(module.carrierReady({ sshCarrierCapabilities: { workspaceSupported: true, carrierIds: [] } }), false)
  assert.equal(module.carrierReady(CAPABLE), true)
  assert.equal(module.managedAvailable(CAPABLE), false)
  assert.equal(module.managedAvailable(MANAGED), true)
  for (const weird of [false, 'true', 1, null, undefined]) {
    assert.equal(module.managedAvailable({ sshCarrierCapabilities: { ...CAPABLE.sshCarrierCapabilities, devTunnelManaged: weird } }), false, String(weird))
  }
  assert.equal(module.defaultMode(CAPABLE), 'external')
  assert.equal(module.defaultMode(MANAGED), 'managed')
})

test('carrier body matches the owner saved-record shape and omits the endpoint when managed', () => {
  const { module } = load()
  const form = {
    name: ' B ', username: 'dev', tunnelId: 'abc123', remotePort: '22', localHost: '127.0.0.1',
    localPort: '2222', expectedHostFingerprint: fingerprint, useAgent: true, privateKeyPath: '',
  }
  assert.deepEqual(Object.keys(module.devTunnelBody(form)).sort(),
    ['connector', 'expectedHostFingerprint', 'hostKeyMode', 'name', 'privateKeyPath', 'transport', 'useAgent', 'username'])
  const external = module.devTunnelBody(form)
  assert.equal(external.transport, 'ssh')
  assert.equal(external.name, 'B')
  assert.equal(external.hostKeyMode, 'verify')
  assert.deepEqual(external.connector, { kind: 'devtunnel', mode: 'external', tunnelId: 'abc123', remotePort: 22, endpoint: { host: '127.0.0.1', port: 2222 } })
  const managed = module.devTunnelBody({ ...form, carrierMode: 'managed', localHost: 'malicious', localPort: '0' })
  assert.deepEqual(managed.connector, { kind: 'devtunnel', mode: 'managed', tunnelId: 'abc123', remotePort: 22 })
  assert.equal(managed.connector.endpoint, undefined)
})

test('validation covers capability, mode, identity, loopback ports, pin and authentication', () => {
  const { module } = load()
  const valid = {
    name: 'dev', username: 'dev', tunnelId: 'abc123', remotePort: '22', localHost: '127.0.0.1',
    localPort: '2222', expectedHostFingerprint: fingerprint, useAgent: true, privateKeyPath: '',
  }
  assert.equal(module.devTunnelValid(valid, CAPABLE), true)
  assert.equal(module.devTunnelValid({ ...valid, localHost: '::1' }, CAPABLE), true)
  for (const change of [
    { localHost: 'localhost' }, { localHost: '10.0.0.1' }, { tunnelId: 'bad/id' }, { remotePort: '0' },
    { localPort: '65536' }, { expectedHostFingerprint: '' }, { useAgent: false }, { username: '' },
  ]) assert.equal(module.devTunnelValid({ ...valid, ...change }, CAPABLE), false, JSON.stringify(change))
  assert.equal(module.devTunnelValid({ ...valid, useAgent: false, privateKeyPath: '/keys/dev' }, CAPABLE), true)
  assert.equal(module.devTunnelValid({ ...valid, carrierMode: 'unknown' }, CAPABLE), false)
  // Managed ignores a stale external port but needs the explicit host authorization.
  assert.equal(module.devTunnelValid({ ...valid, carrierMode: 'managed', localHost: 'malicious', localPort: '0' }, MANAGED), true)
  assert.equal(module.devTunnelValid({ ...valid, carrierMode: 'managed' }, CAPABLE), false)
  assert.equal(module.devTunnelValid(valid, null), false)
})

test('canonical JSON ignores key order so saved and published drafts compare structurally', () => {
  const { module } = load()
  const left = { b: [{ y: 1, x: 2 }], a: { d: 4, c: 3 } }
  const right = { a: { c: 3, d: 4 }, b: [{ x: 2, y: 1 }] }
  assert.equal(module.canonicalJson(left), module.canonicalJson(right))
  assert.notEqual(module.canonicalJson(left), module.canonicalJson({ ...right, a: { c: 3, d: 5 } }))
  assert.equal(module.canonicalJson(undefined), 'null')
})

test('the type option renders its own button and hint, and honours locked/busy/unavailable', () => {
  const { module } = load()
  const render = props => module.DevTunnelTransportOption({ transport: 'ssh', locked: false, busy: false, status: CAPABLE, onSelect() {}, ...props })
  const ready = render({})
  assert.equal(text(ready).includes('Dev Tunnel SSH'), true)
  assert.equal(findButton(ready, 'Dev Tunnel SSH').props.disabled, false)
  assert.doesNotMatch(text(ready), /carrierUnavailableHint/u)

  const unavailable = render({ status: null })
  assert.equal(findButton(unavailable, 'Dev Tunnel SSH').props.disabled, true)
  assert.match(text(unavailable), /carrierUnavailableHint/u)

  assert.equal(findButton(render({ locked: true }), 'Dev Tunnel SSH').props.disabled, true)
  assert.equal(findButton(render({ busy: true }), 'Dev Tunnel SSH').props.disabled, true)

  const selected = []
  const active = render({ transport: 'devtunnel-ssh', onSelect: value => selected.push(value) })
  assert.match(findButton(active, 'Dev Tunnel SSH').props.className, /\bon\b/)
  findButton(active, 'Dev Tunnel SSH').props.onClick()
  assert.deepEqual(selected, ['devtunnel-ssh'])
  findButton(render({ status: null, onSelect: value => selected.push(value) }), 'Dev Tunnel SSH').props.onClick()
  assert.deepEqual(selected, ['devtunnel-ssh'], 'unavailable option never selects')
})

/** Renders the fields occupant with an owner double and returns the handles. */
function fieldsRig({ form = {}, status = CAPABLE, locked = false, busy = false, scopeDir = '/local/ws', dirty = true, mirrorPath = '', localMirror = '', fetchImpl, retarget, bootstrapKey, timerOptions } = {}) {
  const { env, module } = load(fetchImpl, timerOptions)
  const calls = { patch: [], checked: [], publish: [], mirror: 0, mirrorPath: [] }
  const state = { ...form }
  let mirror = mirrorPath
  let local = localMirror
  const carrier = {
    retarget, bootstrapKey,
    publish: draft => calls.publish.push(draft),
    get saved() { return '' },
    get dirty() { return dirty },
    get mirrorPath() { return mirror },
    setMirrorPath(value) { mirror = value; calls.mirrorPath.push(value) },
    get localMirror() { return local },
    createMirror() { calls.mirror += 1 },
  }
  const props = () => ({
    transport: 'devtunnel-ssh', locked, busy, status, scopeDir, form: state,
    patch: partial => { Object.assign(state, partial); calls.patch.push(partial) },
    setChecked: (key, value) => { state[key] = value; calls.checked.push([key, value]) },
    advOpen: false, setAdvOpen() {}, ssh: {}, carrier,
  })
  const pass = () => { env.reset(); return module.DevTunnelFields(props()) }
  let tree = pass()
  env.flush()
  return {
    module, env, state, calls,
    setDirty(value) { dirty = value },
    setLocalMirror(value) { local = value },
    render() { tree = pass(); env.flush(); return tree },
    get tree() { return tree },
  }
}

test('a fresh devtunnel draft gets the capability default mode, agent-first auth and loopback ports through patch', () => {
  const rig = fieldsRig({ form: { carrierMode: 'external', useAgent: false, tunnelId: '', expectedHostFingerprint: '' }, status: MANAGED })
  assert.deepEqual(rig.state.carrierMode, 'managed')
  assert.equal(rig.state.useAgent, true)
  assert.equal(rig.state.remotePort, '22')
  assert.equal(rig.state.localHost, '127.0.0.1')
  assert.equal(rig.state.localPort, '2222')
  assert.deepEqual(rig.calls.patch[0], { carrierMode: 'managed', useAgent: true, remotePort: '22', localHost: '127.0.0.1', localPort: '2222' })

  // Without managed authorization the same draft stays external.
  const plain = fieldsRig({ form: { carrierMode: '', useAgent: false }, status: CAPABLE })
  assert.equal(plain.state.carrierMode, 'external')
  assert.equal(plain.state.useAgent, true)

  // Editing a saved machine must not rewrite its mode or authentication.
  const editing = fieldsRig({ form: { carrierMode: 'external', useAgent: true, tunnelId: 'abc123', expectedHostFingerprint: fingerprint }, status: MANAGED, locked: true })
  for (const call of editing.calls.patch) assert.equal('carrierMode' in call, false)
})

test('the occupant publishes its draft upward and never mutates it behind the owner', () => {
  const rig = fieldsRig({ form: { carrierMode: 'external', username: 'dev', tunnelId: 'abc123', remotePort: '22', localHost: '127.0.0.1', localPort: '2222', expectedHostFingerprint: fingerprint, useAgent: true }, status: CAPABLE })
  const published = rig.calls.publish.at(-1)
  assert.equal(published.valid, true)
  assert.deepEqual(published.body.connector, { kind: 'devtunnel', mode: 'external', tunnelId: 'abc123', remotePort: 22, endpoint: { host: '127.0.0.1', port: 2222 } })

  const before = rig.calls.publish.length
  rig.render()
  assert.equal(rig.calls.publish.length, before, 'an unchanged draft is not re-published')

  findInput(rig.tree, 'ctid').props.onChange({ target: { value: 'other.jpe1' } })
  rig.render()
  assert.equal(rig.state.tunnelId, 'other.jpe1')
  assert.equal(rig.calls.publish.at(-1).body.connector.tunnelId, 'other.jpe1')
})

test('mode buttons patch the draft and managed stays disabled without host authorization', () => {
  const capable = fieldsRig({ form: { carrierMode: 'external', username: 'dev', tunnelId: 'abc123', remotePort: '22', localHost: '127.0.0.1', localPort: '2222', expectedHostFingerprint: fingerprint, useAgent: true }, status: CAPABLE })
  const managedButton = findButton(capable.render(), 'carrierManaged')
  assert.equal(managedButton.props.disabled, true)
  const externalButton = findButton(capable.tree, 'carrierExternal')
  assert.equal(externalButton.props.disabled, false)
  assert.match(externalButton.props.className, /\bon\b/)

  const allowed = fieldsRig({ form: { carrierMode: 'external', username: 'dev', tunnelId: 'abc123', remotePort: '22', localHost: '127.0.0.1', localPort: '2222', expectedHostFingerprint: fingerprint, useAgent: true }, status: MANAGED })
  findButton(allowed.render(), 'carrierManaged').props.onClick()
  assert.equal(allowed.state.carrierMode, 'managed')
  assert.equal(findInput(allowed.render(), 'clp'), undefined, 'managed hides the external loopback port')
})

test('mirror creation stays gated on a saved, non-dirty draft with a path and a scope', () => {
  const draft = { carrierMode: 'external', id: 'mac-b', username: 'dev', tunnelId: 'abc123', remotePort: '22', localHost: '127.0.0.1', localPort: '2222', expectedHostFingerprint: fingerprint, useAgent: true }
  const dirty = fieldsRig({ form: draft, mirrorPath: '/remote/project' })
  assert.equal(findButton(dirty.render(), 'carrierCreateMirror').props.disabled, true)

  const clean = fieldsRig({ form: draft, dirty: false, mirrorPath: '/remote/project' })
  assert.equal(findButton(clean.render(), 'carrierCreateMirror').props.disabled, false)
  findButton(clean.tree, 'carrierCreateMirror').props.onClick()
  assert.equal(clean.calls.mirror, 1)

  const unsaved = fieldsRig({ form: { ...draft, id: '' }, dirty: false, mirrorPath: '/remote/project' })
  assert.equal(findButton(unsaved.render(), 'carrierCreateMirror').props.disabled, true)

  const noScope = fieldsRig({ form: draft, dirty: false, mirrorPath: '/remote/project', scopeDir: '' })
  assert.equal(findButton(noScope.render(), 'carrierCreateMirror').props.disabled, true)

  const noPath = fieldsRig({ form: draft, dirty: false })
  assert.equal(findButton(noPath.render(), 'carrierCreateMirror').props.disabled, true)
  findInput(noPath.tree, 'cmd').props.onChange({ target: { value: '/remote/other' } })
  assert.deepEqual(noPath.calls.mirrorPath, ['/remote/other'])

  clean.setLocalMirror('/local/mirror/mac-b')
  assert.match(text(clean.render()), /\/local\/mirror\/mac-b/)
})

test('the only host routes this half touches are read-only feeds: its own channels and the session status chain', () => {
  const { module } = load()
  assert.deepEqual(Object.keys(module.dict.zh).sort(), Object.keys(module.dict.en).sort())
  // Machine/save/probe/mirror WRITE routes belong to the owner, never to this half.
  // The session header marker additionally reads two public client-safe GET
  // routes of dsh-remote (workspace→machine resolution) — never writes.
  const remoteReads = [...source.matchAll(/'(\/dsh-remote\/[a-z-]+)'/gu)].map(match => match[1])
  assert.deepEqual([...new Set(remoteReads)], ['/dsh-remote/status', '/dsh-remote/resolve-mirror', '/dsh-remote/machines'])
  const routes = [...source.matchAll(/'(\/dsh-devtunnel-ssh\/[a-z-]+)'/gu)].map(match => match[1])
  assert.deepEqual([...new Set(routes)], ['/dsh-devtunnel-ssh/channels'])
  assert.doesNotMatch(source, /Authorization|Bearer|document\.cookie|POST.*dsh-remote|action.*dsh-remote/u)
})

const feed = {
  ok: true, revision: 2, catalogRevision: 3, enabled: true, activeManaged: 1,
  channels: [{ channelId: 'channel-b', name: 'Build B', mode: 'managed', tunnelId: 'fixture.euw', remotePort: 22, state: 'ready', endpoint: { host: '127.0.0.1', port: 53162 }, since: 1760000000000, generation: 'g1', refs: 1 }],
  supervisor: [{ tunnelId: 'other.euw', remotePort: 22, active: false, pending: false, failures: 2, blocked: 'CONNECT_OUTPUT_REJECTED', cooldownUntil: null }],
  recent: [
    { seq: 1, at: 1760000001000, code: 'CONNECT_OUTPUT_REJECTED', machineId: 'mac-b', reason: 'UNSUPPORTED_FORWARDING', stream: 'stderr', sample: ['SSH: Forwarding from 0.0.0.0:1234 to host port 22'] },
    { seq: 2, at: 1760000002000, code: 'CHANNEL_LEASED', machineId: 'mac-b', endpoint: { host: '127.0.0.1', port: 53162 } },
    { seq: 3, at: 1760000003000, code: 'CONNECT_READY', reason: 'FORWARDING_MATCHED', endpoint: { host: '127.0.0.1', port: 53162 } },
  ],
}

/** Owner-side useTunnelSettings surface, as the panel receives it through the
 *  `settings.remote.machine.transport.panel` owner props (contract v3). */
function mockTunnel(over = {}) {
  return {
    tunnelSettings: {
      ok: true, available: true, revision: 7, source: 'config', activeManaged: 0,
      settings: { cliExecutable: '', managedEnabled: false, residentTunnelId: '', residentRemotePort: 0, residentMode: 'off' },
      cli: { status: 'found', source: 'path', resolvedExecutable: '/usr/bin/devtunnel' },
    },
    tunnelDraft: { cliExecutable: '', managedEnabled: false, residentTunnelId: '', residentRemotePort: 0, residentMode: 'off' },
    setTunnelDraft() {}, setTunnelProbe() {}, setTunnelMsg() {},
    tunnelBusy: false, tunnelReady: true, tunnelDirty: false, tunnelValid: true,
    tunnelErr: '', tunnelMsg: '', tunnelProbe: null,
    saveTunnelSettings() {}, refreshTunnelSettings() {}, preflightTunnel() {},
    ...over,
  }
}

function panelRig({ payload = feed, stopFails = false, stopError = 'CHANNELS_UNAVAILABLE', routeMissing = false, answers, machines = [{ id: 'mac-b', name: 'Build B' }], status = CAPABLE, busy = false, section, tunnel = mockTunnel() } = {}) {
  const requests = [], confirmations = []
  const fetchImpl = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined
    requests.push({ url, method: options.method || 'GET', body })
    if (options.method === 'POST') {
      return stopFails
        ? { ok: false, status: 503, json: async () => ({ ok: false, error: stopError }) }
        : { ok: true, status: 200, json: async () => ({ ok: true, ...payload }) }
    }
    if (routeMissing) return { ok: false, status: 404, json: async () => ({ ok: false, error: 'ROUTE_NOT_FOUND' }) }
    return { ok: true, status: 200, json: async () => payload }
  }
  const { env, module, window } = load(fetchImpl)
  // Wire the real locale path (apply -> wireLocale) with a zh dictionary, so
  // assertions see interpolated copy exactly like the shipped page.
  const dict = module.dict.zh
  const bind = key => (dict[key] !== undefined ? dict[key] : key)
  const ctx = {
    get: name => name === 'slots'
      ? { inject: (_key, callback) => { callback(); return () => {} }, register: () => () => {} }
      : name === 'locale'
        ? {
            register: () => () => {},
            bind: () => (key, params) => {
              let value = bind(key)
              if (params) value = String(value).replace(/\{(\w+)\}/gu, (match, name) => (name in params ? String(params[name]) : match))
              return value
            },
          }
        : undefined,
    effect: fn => fn(), inject: () => {}, on() {}, logger: { warn() {} },
  }
  module.apply(ctx)
  if (window && typeof window === 'object') {
    window.confirm = message => { confirmations.push(message); return answers ? answers.shift() : true }
  }
  const expand = node => {
    if (Array.isArray(node)) return node.map(expand)
    if (!node || typeof node !== 'object') return node
    if (node.type === module.ChannelCatalog) return expand(module.ChannelCatalog(node.props))
    return { ...node, children: (node.children || []).map(expand) }
  }
  const pass = () => { env.reset(); return expand(module.DevTunnelPanel({ status, machines, currentId: 'mac-b', scopeDir: '/local/ws', busy, tunnel, section })) }
  env.reset()
  let tree = pass()
  env.flush()
  return {
    module, env, requests, confirmations, t: bind,
    render() { tree = pass(); env.flush(); return tree },
    get tree() { return tree },
  }
}

const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

test('the channel box lists live channels, retry/blocked state and mirrors new events to the console once', async () => {
  const logged = []
  const savedWarn = console.warn
  console.warn = line => logged.push(line)
  try {
    const rig = panelRig()
    await settle()
    rig.render()
    const body = text(rig.tree)
    assert.match(body, /Build B/)
    assert.match(body, /fixture\.euw:22/)
    assert.match(body, /\u2192 127\.0\.0\.1:53162/)
    assert.match(body, /CONNECT_OUTPUT_REJECTED/)
    assert.match(body, /mac-b/, 'lease events name the machine whose SSH layer used the channel')
    assert.ok(findButton(rig.tree, rig.t('channelStop')))
    assert.ok(findButton(rig.tree, rig.t('panelRefresh')))
    // Console mirroring: both new entries once, stable prefix, oldest first.
    assert.equal(logged.length, 3, JSON.stringify(logged))
    assert.match(logged[0], /^\[dsh-devtunnel-ssh\] code=CONNECT_OUTPUT_REJECTED reason=UNSUPPORTED_FORWARDING/u)
    assert.match(logged[1], /^\[dsh-devtunnel-ssh\] code=CHANNEL_LEASED/u)
    assert.match(logged[2], /^\[dsh-devtunnel-ssh\] code=CONNECT_READY reason=FORWARDING_MATCHED endpoint=127\.0\.0\.1:53162/u)
    rig.render(); await settle()
    assert.equal(logged.length, 3, 'already seen sequences are never repeated')
    assert.equal(rig.requests.filter(request => request.url === '/dsh-devtunnel-ssh/channels')[0].method, 'GET')
  } finally { console.warn = savedWarn }
})

test('catalog status dots distinguish runtime states without coloring authorization as running', async () => {
  const cases = [
    ['ready', 'managed', '#22c55e', '已开启'],
    ['starting', 'managed', '#f59e0b', '启动中'],
    ['recovering', 'managed', '#f59e0b', '恢复中'],
    ['stopping', 'managed', '#f59e0b', '正在关闭'],
    ['error', 'managed', '#dc2626', '连接失败'],
    ['stopped', 'managed', '#94a3b8', '已停止'],
    ['future-state', 'managed', '#94a3b8', '已停止'],
    ['ready', 'external', '#3b82f6', '外部'],
  ]
  for (const [state, mode, color, label] of cases) {
    const rig = panelRig({ payload: { ...feed, recent: [], channels: [{ ...feed.channels[0], state, mode }] } })
    await settle(); rig.render()
    const dot = nodes(rig.tree).find(node => node.props?.className === 'dvt-dot' && node.props['data-state'])
    assert.equal(dot.props.style.background, color, `${mode}/${state}`)
    assert.equal(dot.props['aria-hidden'], true)
    const badge = nodes(rig.tree).find(node => node.props?.className === 'dvt-badge' && nodes(node).includes(dot))
    assert.ok(text(badge).includes(label), text(badge))
    const authorization = nodes(rig.tree).find(node => node.props?.className === 'dvt-dot' && !node.props['data-state'])
    assert.equal(authorization.props.style, undefined, 'authorization remains neutral')
    assert.match(text(rig.tree), /\.dvt-panel \.dvt-dot\[data-state\]\{opacity:1\}/u)
  }
})

test('the catalog retains stopped and failed channels in the list', async () => {
  const rig = panelRig({ payload: { ...feed, channels: [{ ...feed.channels[0], state: 'error', endpoint: null, error: 'CONNECT_RETRY_EXHAUSTED' }] } })
  await settle(); rig.render()
  assert.match(text(rig.tree), /CONNECT_RETRY_EXHAUSTED/)
  assert.ok(findButton(rig.tree, rig.t('channelStart')))
})

test('the box disconnects one channel explicitly, confirms first and never retries on failure', async () => {
  const rig = panelRig({ answers: [true] })
  await settle(); rig.render()
  findButton(rig.tree, rig.t('channelStop')).props.onClick(); await settle(); rig.render()
  assert.equal(rig.confirmations.length, 1)
  assert.match(rig.confirmations[0], /SSH/)
  const post = rig.requests.find(request => request.method === 'POST')
  assert.deepEqual(post.body, { action: 'stop', channelId: 'channel-b', revision: 3, confirmed: true })
  assert.equal(post.url, '/dsh-devtunnel-ssh/channels')

  const declined = panelRig({ answers: [false] })
  await settle(); declined.render()
  findButton(declined.tree, declined.t('channelStop')).props.onClick()
  await settle()
  assert.equal(declined.requests.some(request => request.method === 'POST'), false, 'declined confirmation posts nothing')

  const failing = panelRig({ stopFails: true, answers: [true] })
  await settle(); failing.render()
  findButton(failing.tree, failing.t('channelStop')).props.onClick()
  await settle(); failing.render()
  assert.equal(failing.requests.filter(request => request.method === 'POST').length, 1, 'failure is not retried')
  assert.match(text(failing.tree), /CHANNELS_UNAVAILABLE/)
})

test('a missing host route is reported, not shown as an empty channel list', async () => {
  const missing = panelRig({ routeMissing: true })
  await settle(); missing.render()
  const body = text(missing.tree)
  assert.match(body, new RegExp(missing.t('panelErrorUnavailable')))
  assert.doesNotMatch(body, new RegExp(missing.t('panelEmpty')), 'an unreachable route is not "no channels"')
})

test('the box shows its empty/unavailable state instead of disappearing', async () => {
  const empty = panelRig({ payload: { ok: true, revision: 0, enabled: false, activeManaged: 0, channels: [], supervisor: [], recent: [] }, status: null })
  await settle(); empty.render()
  const body = text(empty.tree)
  assert.match(body, new RegExp(empty.t('channelEmpty')))
  assert.match(body, new RegExp(empty.t('panelUnauthorized')))
  assert.ok(findButton(empty.tree, empty.t('channelAdd')), 'catalog remains independent of SSH availability')
})

test('contract v3: the box renders the owner-supplied global settings section and gates writes/preflight', () => {
  const rig = panelRig()
  rig.render()
  const body = text(rig.tree)
  assert.match(body, /连接设置/)
  assert.match(body, /CLI 路径覆盖/)
  assert.equal(findInput(rig.tree, 'st-cli').props.value, '', 'draft CLI path comes from the tunnel props')
  assert.equal(findInput(rig.tree, 'st-cli').props.disabled, false)
  assert.ok(findButton(rig.tree, rig.t('tunnelSave')), 'save button rendered by the occupant')
  assert.equal(findButton(rig.tree, rig.t('tunnelSave')).props.disabled, true, 'unchanged settings cannot be saved')
  assert.equal(findButton(rig.tree, rig.t('tunnelProbe')).props.disabled, false, 'a found CLI at a clean draft permits preflight')
  assert.match(body, /\/usr\/bin\/devtunnel/, 'resolved executable line is rendered')
  assert.match(body, /revision 7/, 'meta line is rendered')

  // Editing the draft (a real setTunnelDraft through the props) enables save.
  let draft = { cliExecutable: '', managedEnabled: false, residentTunnelId: '', residentRemotePort: 0, residentMode: 'off' }
  const editing = panelRig({ tunnel: {
    ...mockTunnel({ tunnelDirty: true }),
    get tunnelDraft() { return draft },
    setTunnelDraft(next) { draft = next },
  } })
  editing.render()
  const input = findInput(editing.tree, 'st-cli')
  input.props.onChange({ target: { value: '/usr/bin/devtunnel --port' } })
  editing.render()
  assert.equal(findInput(editing.tree, 'st-cli').props.value, '/usr/bin/devtunnel --port',
    'the occupant forwards edits through tunnel.setTunnelDraft')
  assert.equal(findButton(editing.tree, editing.t('tunnelSave')).props.disabled, false)
  assert.equal(findButton(editing.tree, editing.t('tunnelProbe')).props.disabled, true, 'dirty settings block preflight')
})

test('contract v3: an unreachable owner settings machine disables the section instead of hiding it', () => {
  const rig = panelRig({ tunnel: mockTunnel({ tunnelSettings: null, tunnelReady: false }) })
  rig.render()
  const body = text(rig.tree)
  assert.match(body, /连接设置/, 'the section stays visible when the settings route is missing')
  assert.equal(findInput(rig.tree, 'st-cli').props.disabled, true)
  for (const key of ['tunnelSave', 'tunnelProbe', 'tunnelLoginProbe']) {
    assert.equal(findButton(rig.tree, rig.t(key)).props.disabled, true, key)
  }
  assert.equal(findButton(rig.tree, rig.t('tunnelRefresh')).props.disabled, false, 'manual refresh always remains possible')
})


test('v4 services and diagnostics separate settings, controls and events', async () => {
  const services = panelRig({ section: 'services' })
  const diagnostics = panelRig({ section: 'diagnostics' })
  await settle(); services.render(); diagnostics.render()
  assert.ok(findButton(services.tree, services.t('tunnelSave')))
  assert.ok(findButton(services.tree, services.t('channelStop')))
  assert.doesNotMatch(text(services.tree), new RegExp(services.t('panelRecent')))
  assert.ok(!findButton(diagnostics.tree, diagnostics.t('tunnelSave')))
  assert.ok(!findButton(diagnostics.tree, diagnostics.t('channelStop')))
  assert.match(text(diagnostics.tree), new RegExp(diagnostics.t('panelRecent')))
  assert.ok(findButton(diagnostics.tree, diagnostics.t('panelRefresh')))
})

test('host SSH agent switch publishes boolean owner changes and refuses changes while busy', () => {
  const rig = fieldsRig({ form: { useAgent: true }, locked: true })
  const toggle = nodes(rig.tree).find(node => node.type === 'HostSwitch')
  assert.equal(toggle.props.checked, true)
  assert.equal(toggle.props.label, 'agent')
  toggle.props.onChange(false)
  rig.render()
  assert.deepEqual(rig.calls.checked, [['useAgent', false]])
  assert.equal(rig.calls.publish.at(-1).body.useAgent, false)
  const busy = fieldsRig({ form: { useAgent: true }, locked: true, busy: true })
  const disabled = nodes(busy.tree).find(node => node.type === 'HostSwitch')
  assert.equal(disabled.props.disabled, true)
  disabled.props.onChange(false)
  assert.deepEqual(busy.calls.checked, [])
})

test('catalog creates an independent channel and validates external ports', async () => {
  const rig = panelRig({ payload: { ...feed, channels: [] } })
  await settle(); rig.render()
  findButton(rig.tree, rig.t('channelAdd')).props.onClick(); rig.render()
  for (const [key, value] of [['name', 'Standalone'], ['tunnelId', 'standalone.jpe1'], ['remotePort', '22']]) {
    findInput(rig.tree, key).props.onChange({ target: { value } }); rig.render()
  }
  assert.equal(findButton(rig.tree, rig.t('channelSave')).props.disabled, false)
  await findButton(rig.tree, rig.t('channelSave')).props.onClick(); await settle(); rig.render()
  assert.deepEqual(rig.requests.find(r => r.method === 'POST').body, {
    action: 'create', channelId: '', revision: 3, confirmed: true,
    channel: { name: 'Standalone', mode: 'managed', tunnelId: 'standalone.jpe1', remotePort: 22 },
  })
  assert.equal(rig.requests.some(r => r.body?.action === 'start'), false, 'save never starts a channel')
  findButton(rig.tree, rig.t('channelAdd')).props.onClick(); rig.render()
  const mode = nodes(rig.tree).find(n => n.type === 'select' && n.props.value === 'managed')
  mode.props.onChange({ target: { value: 'external' } }); rig.render()
  findInput(rig.tree, 'localPort').props.onChange({ target: { value: '65536' } }); rig.render()
  assert.equal(findButton(rig.tree, rig.t('channelSave')).props.disabled, true)
})

const savedQuickForm = { id: 'saved-mac', name: 'Mac mini', carrierMode: 'managed', tunnelId: 'fixture.jpe1', remotePort: '22' }
const quickChannel = { channelId: 'channel-existing', name: 'Mac mini', mode: 'managed', tunnelId: 'fixture.jpe1', remotePort: 22, state: 'stopped' }
test('saved machine quick start creates only a missing channel then starts with the new revision', async () => {
  const { module } = load(); const calls = []
  const form = { ...savedQuickForm, privateKeyPath: '/not-for-channel', expectedHostFingerprint: fingerprint }
  const before = { ...form }
  const result = await module.startConfiguredChannel(form, async (method, body) => {
    calls.push({ method, body })
    if (method === 'GET') return { ok: true, enabled: true, catalogRevision: 4, channels: [] }
    if (body.action === 'create') return { ok: true, catalogRevision: 5, channelId: quickChannel.channelId, channels: [quickChannel] }
    return { ok: true }
  })
  assert.equal(result, quickChannel.channelId)
  assert.deepEqual(calls[1].body, { action: 'create', channelId: '', revision: 4, confirmed: true,
    channel: { name: 'Mac mini', mode: 'managed', tunnelId: 'fixture.jpe1', remotePort: 22 } })
  assert.deepEqual(calls[2].body, { action: 'start', channelId: quickChannel.channelId, revision: 5, confirmed: true })
  assert.deepEqual(form, before, 'no machine edits or credential forwarding')
})

test('quick start reuses stopped, starting and ready channels without duplicate creation', async () => {
  const { module } = load()
  for (const state of ['stopped', 'starting', 'ready']) {
    const calls = []
    await module.startConfiguredChannel(savedQuickForm, async (method, body) => {
      calls.push(body)
      return { ok: true, enabled: true, catalogRevision: 8, channels: [{ ...quickChannel, state }] }
    })
    assert.equal(calls.length, state === 'stopped' ? 2 : 1)
    if (state === 'stopped') assert.equal(calls[1].action, 'start')
  }
})

test('quick start refuses a missing or changed explicit reference and never retries failures', async () => {
  const { module } = load()
  for (const channels of [[], [{ ...quickChannel, tunnelId: 'changed.jpe1' }], [{ ...quickChannel, mode: 'external' }]]) {
    let calls = 0
    await assert.rejects(module.startConfiguredChannel({ ...savedQuickForm, channelId: quickChannel.channelId }, async () => {
      calls++; return { ok: true, enabled: true, catalogRevision: 1, channels }
    }), /CHANNEL_NOT_FOUND|CHANNEL_TARGET_CHANGED/)
    assert.equal(calls, 1)
  }
  let calls = 0
  await assert.rejects(module.startConfiguredChannel(savedQuickForm, async (method) => {
    calls++
    if (method === 'GET') return { ok: true, enabled: true, catalogRevision: 1, channels: [quickChannel] }
    throw new Error('SETTINGS_REVISION_CONFLICT')
  }), /SETTINGS_REVISION_CONFLICT/)
  assert.equal(calls, 2)
})

test('saved machine start button uses the channels route only and prevents duplicate clicks', async () => {
  const requests = []
  const rig = fieldsRig({ form: savedQuickForm, status: MANAGED, locked: true, fetchImpl: async (url, options = {}) => {
    const body = options.body && JSON.parse(options.body)
    requests.push({ url, body })
    return { ok: true, json: async () => ({ ok: true, enabled: true, catalogRevision: 1, channels: [quickChannel] }) }
  } })
  await settle(); rig.render()
  const button = findButton(rig.tree, 'channelQuickStart')
  assert.ok(button); assert.equal(button.props.disabled, false)
  await Promise.all([button.props.onClick(), button.props.onClick()]); await settle(); rig.render()
  assert.equal(requests.filter(r => r.body).length, 1)
  assert.equal(requests.find(r => r.body).body.action, 'start')
  assert.ok(requests.every(r => r.url === '/dsh-devtunnel-ssh/channels'))
  assert.deepEqual(rig.calls.patch, [])
})

// ── session header Dev Tunnel status marker ───────────────────────────────

test('session status resolves only devtunnel carrier workspaces to a bounded projection', () => {
  const { module } = load()
  assert.equal(module.resolveSessionDevTunnelStatus(null, [], []), null)
  assert.equal(module.resolveSessionDevTunnelStatus({ id: 'm1', carrierKind: 'ssh' }, [], []), null)
  assert.equal(module.resolveSessionDevTunnelStatus({ machineId: 'm1', mode: 'remote' }, [], []), null)
  assert.equal(module.resolveSessionDevTunnelStatus({ machineId: 'm1', mode: 'remote' }, [{ id: 'm2', connector: { kind: 'devtunnel' } }], []), null)
  assert.equal(module.resolveSessionDevTunnelStatus({ machineId: 'm1', mode: 'remote' },
    [{ id: 'm1', connector: { kind: 'ssh' } }], []), null)

  const external = module.resolveSessionDevTunnelStatus({ machineId: 'm1', mode: 'remote' },
    [{ id: 'm1', connector: { kind: 'devtunnel', mode: 'external', tunnelId: 't.jpe1', remotePort: 22, endpoint: { host: '127.0.0.1', port: 51234 } } }], [])
  assert.deepEqual(external, { tunnelId: 't.jpe1', remotePort: 22, state: 'external', code: null, name: null, endpoint: { host: '127.0.0.1', port: 51234 } })

  const managed = module.resolveSessionDevTunnelStatus({ machineId: 'm1', mode: 'remote' },
    [{ id: 'm1', connector: { kind: 'devtunnel', mode: 'managed', tunnelId: 't.jpe1', remotePort: 22, channelId: 'c1' } }],
    [{ channelId: 'c1', tunnelId: 't.jpe1', remotePort: 22, name: 'Mac', state: 'recovering', error: 'CONNECT_EXITED', endpoint: null }])
  assert.deepEqual(managed, { tunnelId: 't.jpe1', remotePort: 22, state: 'recovering', code: 'CONNECT_EXITED', name: 'Mac', endpoint: null })

  // Legacy machine without channelId matches the saved channel by target.
  const legacy = module.resolveSessionDevTunnelStatus({ machineId: 'm2', mode: 'remote' },
    [{ id: 'm2', connector: { kind: 'devtunnel', mode: 'managed', tunnelId: 't.jpe1', remotePort: 22 } }],
    [{ channelId: 'c1', tunnelId: 't.jpe1', remotePort: 22, state: 'ready', endpoint: { host: '127.0.0.1', port: 50100 } }])
  assert.equal(legacy.state, 'ready')
  assert.deepEqual(legacy.endpoint, { host: '127.0.0.1', port: 50100 })

  // Managed machine whose channel disappeared reads as missing, never guessed.
  const missing = module.resolveSessionDevTunnelStatus({ machineId: 'm3', mode: 'remote' },
    [{ id: 'm3', connector: { kind: 'devtunnel', mode: 'managed', tunnelId: 'gone.jpe1', remotePort: 22 } }], [])
  assert.deepEqual(missing, { tunnelId: 'gone.jpe1', remotePort: 22, state: 'missing', code: 'CHANNEL_NOT_FOUND', name: null, endpoint: null })

  // Malformed identity is refused loudly (no chip) instead of rendering garbage.
  for (const connector of [
    { kind: 'devtunnel', mode: 'managed', tunnelId: 'bad/id', remotePort: 22 },
    { kind: 'devtunnel', mode: 'managed', tunnelId: 't.jpe1', remotePort: 0 },
    { kind: 'devtunnel', mode: 'external', tunnelId: 't.jpe1', remotePort: 22, endpoint: { host: '10.0.0.1', port: 22 } },
  ]) {
    assert.equal(module.resolveSessionDevTunnelStatus({ machineId: 'm1', mode: 'remote' },
      [{ id: 'm1', connector }], []), null, JSON.stringify(connector))
  }
})

test('session status pull composes the three public read routes in order', async () => {
  const { module } = load()
  const calls = []
  const call = async url => {
    calls.push(url)
    if (url.startsWith('/dsh-remote/resolve-mirror')) return { machineId: 'm1', mode: 'remote' }
    if (url === '/dsh-remote/machines') return { machines: [{ id: 'm1', connector: { kind: 'devtunnel', mode: 'managed', tunnelId: 't.jpe1', remotePort: 22, channelId: 'c1' } }] }
    if (url === '/dsh-devtunnel-ssh/channels') return { ok: true, channels: [{ channelId: 'c1', state: 'error', error: 'CONNECT_RETRY_EXHAUSTED' }] }
    throw new Error('unexpected url ' + url)
  }
  const status = await module.pullSessionDevTunnelStatus('/mirror/ws', call)
  assert.equal(status.state, 'error')
  assert.equal(status.code, 'CONNECT_RETRY_EXHAUSTED')
  assert.equal(calls[0], '/dsh-remote/status?cwd=' + encodeURIComponent('/mirror/ws'))
  assert.equal(calls[1], '/dsh-remote/resolve-mirror?local=' + encodeURIComponent('/mirror/ws'))
  // Non-devtunnel workspace stops the chain before any machines/channels read.
  const calls2 = []
  const none = await module.pullSessionDevTunnelStatus('/plain/ws', async url => {
    calls2.push(url)
    if (url.startsWith('/dsh-remote/resolve-mirror')) return { mode: 'local', machineId: '', fallback: true }
    throw new Error('must not read further')
  })
  assert.equal(none, null)
  assert.equal(calls2.length, 2, 'old host compatibility probes status then metadata only')
  // A broken intermediate source yields null (chip hides), never throws.
  const broken = await module.pullSessionDevTunnelStatus('/mirror/ws', async url => {
    if (url.startsWith('/dsh-remote/resolve-mirror')) return { ok: true }
    throw new Error('down')
  })
  assert.equal(broken, null)
})

test('the session header chip renders only for devtunnel workspaces and shows live state', async () => {
  const requests = []
  const urlFor = {
    ['/dsh-remote/resolve-mirror?local=' + encodeURIComponent('/mirror/ws')]: { machineId: 'm1', mode: 'remote' },
    '/dsh-remote/machines': { machines: [{ id: 'm1', connector: { kind: 'devtunnel', mode: 'managed', tunnelId: 't.jpe1', remotePort: 22, channelId: 'c1' } }] },
    '/dsh-devtunnel-ssh/channels': { ok: true, channels: [{ channelId: 'c1', name: 'Mac', state: 'recovering', error: 'CONNECT_EXITED', endpoint: null }] },
  }
  const fetchImpl = async (url, options = {}) => {
    requests.push(url)
    const body = urlFor[url]
    if (!body) return { ok: false, status: 404 }
    return { ok: true, json: async () => body }
  }
  const { env, module } = load(fetchImpl)
  const sessions = { byId: { s1: { cwd: '/mirror/ws' } } }
  const render = () => { env.reset(); return module.SessionDevTunnelStatus({ sessionId: 's1', useSessions: selector => selector(sessions) }) }
  let tree = render()
  env.flush()
  await settle()
  await new Promise(resolve => setImmediate(resolve))
  tree = render()
  const chip = nodes(tree.props.anchor).find(node => node.props && node.props['data-testid'] === 'devtunnel-session-status')
  assert.ok(chip, 'chip renders for a devtunnel workspace')
  assert.equal(chip.type, 'button')
  assert.equal(tree.type, 'HostMenu')
  chip.props.onClick()
  const opened = render()
  assert.equal(opened.props.open, true)
  assert.equal(opened.props.portal, true)
  assert.equal(opened.props.compact, true)
  assert.equal(opened.props.dense, true)
  assert.equal(opened.props.listClassName, 'dvt-session-menu')
  const tagRect = { top: 10, bottom: 38, left: 20, right: 220, width: 200, height: 28 }
  chip.props.ref.current = { getBoundingClientRect: () => tagRect }
  assert.equal(opened.props.getAnchorRect(), tagRect, 'portal anchors to button instead of wrapper layout')
  assert.equal(chip.props.className, 'dvt-session-tag')
  assert.match(source, /\.dvt-session-tag:not\(\.dvt-session-tag-static\):hover/)
  assert.match(source, /\.dvt-session-tag:focus-visible/)
  const targetDetails = opened.props.items.find(item => item.id === 'target').text
  assert.match(text(targetDetails), /statusTarget/)
  assert.ok(nodes(targetDetails).some(node => node.props?.className === 'dvt-session-connection'))
  assert.match(text(opened.props.items.find(item => item.id === 'tips').text), /statusTipUnavailable/)
  assert.equal(opened.props.items.find(item => item.id === 'refresh').label, 'statusRefresh')
  assert.ok(opened.props.items.filter(item => !item.type).every(item => item.icon))
  assert.deepEqual(opened.props.items.filter(item => !item.type).map(item => item.id), ['start', 'restart', 'stop', 'refresh'])
  opened.props.onClose()
  assert.equal(render().props.open, false)
  assert.doesNotMatch(text(chip), /Dev Tunnel|sessionStatusRecovering/)
  assert.match(chip.props.title, /sessionStatusRecovering/)
  assert.ok(nodes(chip).some(node => node.type === 'svg'), 'recognizable tunnel icon remains visible')
  assert.doesNotMatch(text(chip), /SSH|sessionSsh/)
  assert.equal(nodes(chip).some(node => Object.hasOwn(node.props || {}, 'data-devtunnel-ssh-state')), false)
  assert.match(chip.props.title, /Mac · t\.jpe1:22 \(CONNECT_EXITED\)/)

  // Non-devtunnel workspace: fresh mount, no chip, and the chain stops after
  // the workspace read (no machines/channels fetch).
  const plainPulls = []
  const plain = load(async url => { plainPulls.push(url); return { ok: false, status: 404 } })
  const plainSlots = { byId: { s1: { cwd: '/plain/ws' } } }
  const plainRender = () => { plain.env.reset(); return plain.module.SessionDevTunnelStatus({ sessionId: 's1', useSessions: selector => selector(plainSlots) }) }
  plainRender(); plain.env.flush(); await settle(); plain.env.reset()
  assert.equal(plainRender(), null)
  assert.deepEqual(plainPulls, ['/dsh-remote/status?cwd=' + encodeURIComponent('/plain/ws') + '&sessionId=s1',
    '/dsh-remote/resolve-mirror?local=' + encodeURIComponent('/plain/ws')])
})

const replacementChannel = { channelId: 'new-channel', name: 'New tunnel', mode: 'managed', tunnelId: 'new.jpe1', remotePort: 22, state: 'stopped' }
const channelSelect = rig => nodes(rig.tree).find(n => n.props?.key === 'channel').children[1].children[0]
const selectEvent = value => ({ target: { value } })
const channelResponse = channels => ({ ok: true, json: async () => ({ ok: true, catalogRevision: 1, channels }) })

test('one selector lists all saved targets including stopped and refreshes after adding without starting', async () => {
  let channels = [quickChannel], reads = 0
  const timers = []
  const rig = fieldsRig({ form: { ...savedQuickForm, channelId: quickChannel.channelId }, status: MANAGED,
    locked: true, dirty: false, retarget: async () => false,
    timerOptions: { setIntervalImpl: (fn, ms) => { timers.push({ fn, ms }); return 0 } },
    fetchImpl: async () => { reads++; return channelResponse(channels) } })
  await settle(); rig.render()
  assert.equal(nodes(rig.tree).filter(n => n.type === 'select').length, 1)
  assert.equal(findButton(rig.tree, 'channelRetarget'), undefined)
  channels = [...channels, replacementChannel]
  assert.equal(timers[0].ms, 3000)
  timers[0].fn(); await settle(); rig.render()
  const select = channelSelect(rig)
  assert.match(text(select), /new.jpe1:22 · stopped/)
  assert.equal(nodes(select).filter(n => n.type === 'option' && n.props.value).length, 2)
  const before = reads
  select.props.onFocus(); await settle()
  assert.ok(reads > before, 'opening/focusing refreshes the catalog')
  assert.equal(rig.calls.patch.length, 0)
})

test('saved retarget restores native value, never patches/publishes target and waits for owner hydrate', async () => {
  for (const outcome of ['cancel', 'failure', 'success']) {
    let resolve
    const pending = new Promise(r => { resolve = r })
    const calls = []
    const rig = fieldsRig({ form: { ...savedQuickForm, channelId: 'old-channel' }, status: MANAGED,
      locked: true, dirty: false, retarget: async c => { calls.push(c); await pending; if (outcome === 'failure') throw Error('CAS'); return outcome === 'success' },
      fetchImpl: async () => channelResponse([replacementChannel]) })
    await settle(); rig.render()
    const before = rig.calls.publish.length
    const select = channelSelect(rig), event = selectEvent('new-channel')
    const result = select.props.onChange(event)
    assert.equal(event.target.value, 'old-channel', 'native DOM immediately returns to controlled selection')
    await select.props.onChange(selectEvent('new-channel'))
    rig.render()
    assert.equal(channelSelect(rig).props.disabled, true)
    assert.equal(calls.length, 1, 'in-flight duplicate ignored')
    assert.deepEqual(calls[0], { kind: 'devtunnel', mode: 'managed', channelId: 'new-channel', tunnelId: 'new.jpe1', remotePort: 22 })
    resolve(); await result; rig.render()
    assert.equal(channelSelect(rig).props.value, 'old-channel', outcome)
    assert.equal(rig.calls.patch.length, 0)
    assert.equal(rig.calls.publish.length, before)
    if (outcome === 'success') {
      Object.assign(rig.state, { channelId: 'new-channel', tunnelId: 'new.jpe1' }) // owner hydrate
      rig.render()
      assert.equal(channelSelect(rig).props.value, 'new-channel')
    }
  }
})

test('old owner, busy, dirty, capability and failed-feed gates reject cross-target handler calls', async () => {
  for (const gate of ['old-owner', 'busy', 'dirty', 'managed-unavailable', 'feed-error']) {
    const calls = []
    let failed = false
    const rig = fieldsRig({ form: { ...savedQuickForm, channelId: 'old-channel' }, locked: true,
      dirty: gate === 'dirty', busy: gate === 'busy', status: gate === 'managed-unavailable' ? CAPABLE : MANAGED,
      retarget: gate === 'old-owner' ? undefined : async c => { calls.push(c); return true },
      fetchImpl: async () => failed ? { ok: false } : channelResponse([replacementChannel]) })
    await settle(); rig.render()
    if (gate === 'feed-error') {
      await settle() // flush the hook double's preceding render-triggered pull
      failed = true; channelSelect(rig).props.onFocus(); await settle(); rig.render()
    }
    const select = channelSelect(rig)
    const option = nodes(select).find(n => n.type === 'option' && n.props.value === 'new-channel')
    assert.ok(option, 'even blocked targets remain visible')
    assert.equal(Boolean(select.props.disabled || option.props.disabled), true, gate)
    await select.props.onChange(selectEvent('new-channel'))
    assert.equal(calls.length, 0, gate)
    assert.equal(rig.calls.patch.length, 0, gate)
  }
})

test('new drafts patch selection, same canonical saved target uses ordinary save, external retarget keeps endpoint', async () => {
  for (const locked of [false, true]) {
    const calls = []
    const channel = { ...replacementChannel, mode: 'external', tunnelId: 'fixture.jpe1', remotePort: 22,
      endpoint: { host: '127.0.0.1', port: 5522 } }
    const rig = fieldsRig({ form: { ...savedQuickForm, ...(locked ? { tunnelId: ' fixture.jpe1 ', remotePort: '022' } : { id: '' }) },
      locked, dirty: false, status: MANAGED, retarget: async c => { calls.push(c); return true },
      fetchImpl: async () => channelResponse([channel]) })
    await settle(); rig.render()
    await channelSelect(rig).props.onChange(selectEvent('new-channel'))
    assert.equal(calls.length, 0)
    assert.equal(rig.calls.patch.at(-1).carrierMode, 'external')
    assert.equal(rig.calls.patch.at(-1).localPort, '5522')
    assert.equal(rig.state.tunnelId, 'fixture.jpe1')
  }
  const calls = []
  const channel = { ...replacementChannel, mode: 'external', endpoint: { host: '::1', port: 5522 } }
  const rig = fieldsRig({ form: savedQuickForm, locked: true, dirty: false, status: CAPABLE,
    retarget: async c => { calls.push(c); return true }, fetchImpl: async () => channelResponse([channel]) })
  await settle(); rig.render()
  await channelSelect(rig).props.onChange(selectEvent('new-channel'))
  assert.deepEqual(calls[0].endpoint, channel.endpoint)
  assert.equal(rig.calls.patch.length, 0)
  await channelSelect(rig).props.onChange(selectEvent(''))
  await channelSelect(rig).props.onChange(selectEvent('vanished-channel'))
  assert.equal(rig.calls.patch.length, 0, 'missing/stale selections do not clear a saved connector')
})

test('apply injects the session utilities entry once the conversation shell declares the seat', () => {
  const { env, module } = load()
  const slots = createSlots(env.React)
  const services = { slots, locale: { register: () => () => {}, bind: () => key => 'T:' + key } }
  const ctx = { get: name => services[name], effect: fn => fn(), inject: () => {}, on() {}, logger: { warn() {} } }
  module.apply(ctx)
  assert.equal(slots.registered.some(entry => entry.def.name === module.SLOT_SESSION_UTILITIES), false, 'waits for the declaration')
  // The shell declares the header seat exactly as ui-conversation does.
  slots.register({ name: 'root', children: { 'conversation.header': { kind: 'single', scope: 'session-maybe' } } }, () => null)
  slots.register({ name: 'conversation.header', children: { 'conversation.session.header': { kind: 'single', scope: 'session' } } }, () => null)
  slots.register({ name: 'conversation.session.header', children: { 'conversation.session.header.lineage': { kind: 'single', scope: 'session' }, [module.SLOT_SESSION_UTILITIES]: { kind: 'list', scope: 'session' } } }, () => null)
  const entry = slots.registered.find(e => e.def.name === module.SLOT_SESSION_UTILITIES)
  assert.ok(entry)
  assert.equal(entry.def.id, 'devtunnel-status')
  assert.equal(entry.def.order, -100)
  assert.equal(typeof entry.component, 'function')
  for (const [id, order] of [['open-in-app', -10], ['editor-workbench', 9], ['bottom-workbench', 10]]) {
    slots.register({ name: module.SLOT_SESSION_UTILITIES, id, order }, () => null)
  }
  const ordered = [...slots.entries(module.SLOT_SESSION_UTILITIES)].sort((a, b) => (a.def.order || 0) - (b.def.order || 0))
  assert.equal(ordered[0].def.id, 'devtunnel-status', 'status precedes existing header utility buttons')
})


test('bootstrap keeps password out of draft, clears it before owner call and prevents replay', async () => {
  let finish
  const pending = new Promise(resolve => { finish = resolve })
  const calls = []
  const rig = fieldsRig({ form: { username: 'alice', tunnelId: 'mac.jpe1', remotePort: '22', localPort: '2222', expectedHostFingerprint: fingerprint },
    bootstrapKey: async value => { calls.push(value); await pending; return true } })
  rig.render()
  const password = nodes(rig.tree).find(n => n.type === 'input' && n.props.type === 'password')
  password.props.onChange({ target: { value: 'ephemeral-only' } }); rig.render()
  const button = findButton(rig.tree, 'bootstrapKey')
  assert.equal(button.props.disabled, false)
  const first = button.props.onClick()
  await button.props.onClick()
  rig.render()
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { password: 'ephemeral-only' })
  assert.equal(nodes(rig.tree).find(n => n.props?.type === 'password').props.value, '')
  assert.equal(JSON.stringify(rig.calls).includes('ephemeral-only'), false)
  finish(); await first
  const oldOwner = fieldsRig()
  assert.equal(findButton(oldOwner.tree, 'bootstrapKey'), undefined)
  const locked = fieldsRig({ locked: true, bootstrapKey: async () => true })
  assert.equal(findButton(locked.tree, 'bootstrapKey'), undefined)
})
