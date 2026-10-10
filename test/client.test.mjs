import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createReact, createSlots, loadClient, nodes, text, findButton, findInput, fingerprint } from './support/slot-harness.mjs'

const source = readFileSync(new URL('../lib/client/client.js', import.meta.url), 'utf8')
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

const CAPABLE = { sshCarrierCapabilities: { workspaceSupported: true, carrierIds: ['devtunnel'] } }
const MANAGED = { sshCarrierCapabilities: { workspaceSupported: true, carrierIds: ['devtunnel'], devTunnelManaged: true } }

function load(fetchImpl) {
  const env = createReact()
  const loaded = loadClient(source, { React: env.React, ...(fetchImpl ? { fetchImpl } : {}) })
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
function fieldsRig({ form = {}, status = CAPABLE, locked = false, busy = false, scopeDir = '/local/ws', dirty = true, mirrorPath = '', localMirror = '', fetchImpl } = {}) {
  const { env, module } = load(fetchImpl)
  const calls = { patch: [], checked: [], publish: [], mirror: 0, mirrorPath: [] }
  const state = { ...form }
  let mirror = mirrorPath
  let local = localMirror
  const carrier = {
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

test('the only host routes this half touches are the read-only channel feed and its stop', () => {
  const { module } = load()
  assert.deepEqual(Object.keys(module.dict.zh).sort(), Object.keys(module.dict.en).sort())
  // Machine/save/probe/mirror routes belong to the owner, never to this half.
  assert.doesNotMatch(source, /\/dsh-remote\//u)
  const routes = [...source.matchAll(/'(\/dsh-devtunnel-ssh\/[a-z-]+)'/gu)].map(match => match[1])
  assert.deepEqual([...new Set(routes)], ['/dsh-devtunnel-ssh/channels'])
  assert.doesNotMatch(source, /Authorization|Bearer|document\.cookie/u)
})

const feed = {
  ok: true, revision: 2, enabled: true, activeManaged: 1,
  channels: [{ machineId: 'mac-b', mode: 'managed', tunnelId: 'fixture.euw', remotePort: 22, state: 'ready', endpoint: { host: '127.0.0.1', port: 53162 }, since: 1760000000000, generation: 'g1', refs: 1 }],
  supervisor: [{ tunnelId: 'other.euw', remotePort: 22, active: false, pending: false, failures: 2, blocked: 'CONNECT_OUTPUT_REJECTED', cooldownUntil: null }],
  recent: [
    { seq: 1, at: 1760000001000, code: 'CONNECT_OUTPUT_REJECTED', machineId: 'mac-b', reason: 'UNSUPPORTED_FORWARDING', stream: 'stderr', sample: ['SSH: Forwarding from 0.0.0.0:1234 to host port 22'] },
    { seq: 2, at: 1760000002000, code: 'CHANNEL_LEASED', machineId: 'mac-b', endpoint: { host: '127.0.0.1', port: 53162 } },
    { seq: 3, at: 1760000003000, code: 'CONNECT_READY', reason: 'FORWARDING_MATCHED', endpoint: { host: '127.0.0.1', port: 53162 } },
  ],
}

function panelRig({ payload = feed, stopFails = false, stopError = 'CHANNELS_UNAVAILABLE', routeMissing = false, answers, machines = [{ id: 'mac-b', name: 'Build B' }], status = CAPABLE, busy = false } = {}) {
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
  const pass = () => { env.reset(); return module.DevTunnelPanel({ status, machines, currentId: 'mac-b', scopeDir: '/local/ws', busy }) }
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
    assert.match(body, /fixture\.euw :22/)
    assert.match(body, /\u2192 127\.0\.0\.1:53162/)
    assert.match(body, /other\.euw :22/)
    assert.match(body, /CONNECT_OUTPUT_REJECTED/)
    assert.match(body, /mac-b/, 'lease events name the machine whose SSH layer used the channel')
    assert.match(body, /\u9700\u4eba\u5de5\u5904\u7406|needs manual action/u, 'blocked state is spelled out')
    assert.ok(findButton(rig.tree, rig.t('panelStop')))
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

test('the box distinguishes a retrying channel from a blocked one', async () => {
  const retrying = panelRig({ payload: { ...feed, activeManaged: 0, channels: [], supervisor: [{ tunnelId: 'other.euw', remotePort: 22, active: false, pending: false, failures: 2, blocked: null, cooldownUntil: null }] } })
  await settle(); retrying.render()
  const body = text(retrying.tree)
  assert.match(body, /other\.euw :22/)
  assert.match(body, /2 |\u7b2c 2|attempt 2/u)
  assert.doesNotMatch(body, /\u9700\u4eba\u5de5\u5904\u7406|needs manual action/u)
})

test('the box disconnects one channel explicitly, confirms first and never retries on failure', async () => {
  const rig = panelRig({ answers: [true] })
  await settle(); rig.render()
  findButton(rig.tree, rig.t('panelStop')).props.onClick(); await settle(); rig.render()
  assert.equal(rig.confirmations.length, 1)
  assert.match(rig.confirmations[0], /Build B/)
  const post = rig.requests.find(request => request.method === 'POST')
  assert.deepEqual(post.body, { action: 'stop', machineId: 'mac-b', confirmed: true })
  assert.equal(post.url, '/dsh-devtunnel-ssh/channels')

  const declined = panelRig({ answers: [false] })
  await settle(); declined.render()
  findButton(declined.tree, declined.t('panelStop')).props.onClick()
  await settle()
  assert.equal(declined.requests.some(request => request.method === 'POST'), false, 'declined confirmation posts nothing')

  const failing = panelRig({ stopFails: true, answers: [true] })
  await settle(); failing.render()
  findButton(failing.tree, failing.t('panelStop')).props.onClick()
  await settle(); failing.render()
  assert.equal(failing.requests.filter(request => request.method === 'POST').length, 1, 'failure is not retried')
  assert.match(text(failing.tree), new RegExp(failing.t('panelErrorUnavailable')))
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
  assert.match(body, new RegExp(empty.t('panelEmpty')))
  assert.match(body, new RegExp(empty.t('panelDisabled')))
  assert.match(body, new RegExp(empty.t('carrierUnavailableHint')))
})
