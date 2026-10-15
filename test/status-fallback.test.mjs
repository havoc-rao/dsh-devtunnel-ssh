import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createReact, createSlots, loadClient, nodes } from './support/slot-harness.mjs'

const source = readFileSync(new URL('../lib/client/client.js', import.meta.url), 'utf8')

const FALLBACK_OWN = '[data-dvt-status-fallback]'
const ENTRY_SELECTOR = '[data-dvt-status-entry]'
const ANCHOR_SELECTOR = '[data-sidebar-right-expand], [data-sidebar-right-toggle]'
const CONTROLS_SELECTOR = 'button, a, input, select, textarea, [role="button"], [role="tab"], [role="menuitem"], [role="link"], [data-dsh-dock-fallback], [data-dsh-bottom-toggle], [data-dsew-resume-fallback], [data-dsh-editor-workbench="resume"]'

function rect(left, top, width, height) {
  return { left, top, right: left + width, bottom: top + height, width, height }
}

/** Minimal DOM double: selector registry of fake elements with rect/closest. */
function makeDom(entries = []) {
  const bySelector = new Map()
  for (const [selector, element] of entries) {
    if (!bySelector.has(selector)) bySelector.set(selector, [])
    bySelector.get(selector).push(element)
  }
  return {
    body: {},
    querySelectorAll(selector) { return bySelector.get(selector) || [] },
  }
}
function fakeElement(box, { own = false } = {}) {
  return {
    own,
    getBoundingClientRect: () => box,
    closest(selector) {
      if (selector === FALLBACK_OWN) return this.own ? this : null
      return null
    },
  }
}

function load({ fetchImpl, document, window: windowOverrides = {} } = {}) {
  const env = createReact()
  const loaded = loadClient(source, {
    React: env.React,
    fetchImpl,
    documentOverrides: { ...(document || makeDom()) },
    windowOverrides: { innerWidth: 1200, innerHeight: 800, ...windowOverrides },
  })
  return { env, module: loaded.exports }
}

const mountedStore = initial => {
  let value = initial
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    set(v) { value = v; for (const fn of listeners) fn() },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
  }
}

// ── position measurement ──────────────────────────────────────────────────

test('fallback position: header entry presence wins over the phase (dedup)', () => {
  const { module } = load({ document: makeDom([
    [ENTRY_SELECTOR, fakeElement(rect(1000, 20, 28, 28))],
    [ANCHOR_SELECTOR, fakeElement(rect(1000, 20, 28, 28))],
  ]) })
  assert.equal(module.statusFallbackPosition(), undefined, 'an actual header entry must make the overlay step aside')
})

test('fallback position: own wrapper entry never counts as the header entry', () => {
  const { module } = load({ document: makeDom([
    [ENTRY_SELECTOR, fakeElement(rect(1000, 20, 28, 28), { own: true })],
    [ANCHOR_SELECTOR, fakeElement(rect(1000, 20, 28, 28))],
  ]) })
  assert.deepEqual(module.statusFallbackPosition(), { top: 20, left: 964 })
})

test('fallback position: no anchor and no seat both yield undefined', () => {
  const none = load({ document: makeDom([]) })
  assert.equal(none.module.statusFallbackPosition(), undefined)
  // A collapsed/zero-size anchor offers no seat either.
  const tiny = load({ document: makeDom([[ANCHOR_SELECTOR, fakeElement(rect(0, 0, 0, 0))]]) })
  assert.equal(tiny.module.statusFallbackPosition(), undefined)
})

test('fallback position: sits vertically centred left of the native anchor', () => {
  const { module } = load({ document: makeDom([[ANCHOR_SELECTOR, fakeElement(rect(1000, 84, 28, 28))]]) })
  assert.deepEqual(module.statusFallbackPosition(), { top: 84, left: 964 })
  // Non-square anchor: button is 28 high, aligned to the anchor's midline.
  const tall = load({ document: makeDom([[ANCHOR_SELECTOR, fakeElement(rect(1000, 40, 32, 64))]]) })
  assert.deepEqual(tall.module.statusFallbackPosition(), { top: 58, left: 964 })
})

test('fallback position: walks left past occupying controls and other plugins fallbacks', () => {
  const { module } = load({ document: makeDom([
    [ANCHOR_SELECTOR, fakeElement(rect(1000, 20, 28, 28))],
    [CONTROLS_SELECTOR, fakeElement(rect(948, 20, 28, 28))],
    ['[data-dsh-dock-fallback]', fakeElement(rect(880, 20, 28, 28))],
    ['[data-dsh-bottom-toggle]', fakeElement(rect(840, 20, 28, 28))],
    ['[data-dsew-resume-fallback]', fakeElement(rect(800, 20, 28, 28))],
    ['[data-dsh-editor-workbench="resume"]', fakeElement(rect(940, 20, 4, 4))],
  ]) })
  const position = module.statusFallbackPosition()
  assert.ok(position, 'a later free slot must be found')
  assert.ok(position.left < 944, 'must clear the neighbour occupying 948..976')
  assert.ok(position.left >= 4)
  assert.equal(position.top, 20)
})

test('fallback position: the overlay itself never counts as an occupant', () => {
  const { module } = load({ document: makeDom([
    [ANCHOR_SELECTOR, fakeElement(rect(1000, 20, 28, 28))],
    [CONTROLS_SELECTOR, fakeElement(rect(964, 20, 28, 28), { own: true })],
    [ENTRY_SELECTOR, fakeElement(rect(964, 20, 28, 28), { own: true })],
  ]) })
  assert.deepEqual(module.statusFallbackPosition(), { top: 20, left: 964 })
})

test('fallback position: fully occupied row leaves no seat instead of covering controls', () => {
  const { module } = load({ document: makeDom([
    [ANCHOR_SELECTOR, fakeElement(rect(1000, 20, 28, 28))],
    [CONTROLS_SELECTOR, fakeElement(rect(4, 20, 990, 28))],
  ]) })
  assert.equal(module.statusFallbackPosition(), undefined, 'never overlap native controls')
})

test('fallback position: respects the viewport bottom for tall anchors', () => {
  const { module } = load({ document: makeDom([[ANCHOR_SELECTOR, fakeElement(rect(1000, 780, 28, 28))]]) })
  assert.equal(module.statusFallbackPosition(), undefined)
})

// ── overlay registration ──────────────────────────────────────────────────

test('apply registers the shell.overlay entry only when the host provides sidebarRight.mounted', () => {
  const { env, module } = load()
  const slots = createSlots(env.React)
  slots.register({ name: 'root', children: { 'shell.overlay': { kind: 'list', scope: 'root' } } }, () => null)
  const locale = { register: () => () => {}, bind: () => key => 'T:' + key }
  const ctxFor = extra => ({
    get: name => (name === 'slots' ? slots : name === 'locale' ? locale : extra[name]),
    effect: fn => fn(), inject: () => {}, on() {}, logger: { warn() {} },
  })
  // Without the service nothing is injected.
  module.apply(ctxFor({}))
  assert.equal(slots.registered.some(entry => entry.def.name === 'shell.overlay'), false)
  // With a mounted observable the overlay entry lands with a stable id/order.
  const mounted = mountedStore(undefined)
  module.apply(ctxFor({ sidebarRight: { mounted } }))
  const entry = slots.registered.find(e => e.def.name === 'shell.overlay')
  assert.ok(entry)
  assert.equal(entry.def.id, 'devtunnel-status-fallback')
  assert.equal(entry.def.order, 9)
  assert.equal(typeof entry.component, 'function')
  // A malformed service must not crash apply.
  module.apply(ctxFor({ sidebarRight: {} }))
})

// ── overlay component ─────────────────────────────────────────────────────

const sessions = { byId: { s1: { cwd: '/mirror/ws' } } }
const devtunnelFetch = async url => {
  if (url.startsWith('/dsh-remote/status?')) {
    return { ok: true, json: async () => ({ connection: {
      schemaVersion: 1, scope: 'workspace', binding: 'bound', machineId: 'm1', protocol: 'ssh', path: 'carrier',
      carrierKind: 'devtunnel', mode: 'managed',
      carrierTarget: { mode: 'managed', channelId: 'c1', tunnelId: 't.jpe1', remotePort: 22 },
      ssh: { state: 'connected' } } }) }
  }
  if (url === '/dsh-devtunnel-ssh/channels') {
    return { ok: true, json: async () => ({ ok: true, enabled: true, catalogRevision: 17,
      channels: [{ channelId: 'c1', name: 'Mac', tunnelId: 't.jpe1', remotePort: 22, state: 'ready', endpoint: { host: '127.0.0.1', port: 53162 } }] }) }
  }
  return { ok: false, status: 404 }
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await new Promise(resolve => setImmediate(resolve)) }

const overlayProps = () => ({
  useSessions: selector => selector(sessions),
  usePanelInfo: selector => selector({ activePanelId: null }),
})

function overlayRig({ fetchImpl = devtunnelFetch, mounted = mountedStore('s1'), panel = null, document } = {}) {
  const { env, module } = load({ fetchImpl, document: document || makeDom([[ANCHOR_SELECTOR, fakeElement(rect(1000, 20, 28, 28))]]) })
  const StatusFallback = module.createStatusFallback(mounted)
  const props = () => ({
    useSessions: selector => selector(sessions),
    usePanelInfo: selector => selector({ activePanelId: panel }),
  })
  const render = () => { env.reset(); return StatusFallback(props()) }
  let tree = render()
  env.flush()
  return { env, module, StatusFallback, props, render, mounted, get tree() { return tree } }
}

test('overlay renders nothing without a mounted session (no invented Session)', () => {
  const rig = overlayRig({ mounted: mountedStore(undefined) })
  assert.equal(rig.tree, null)
})

test('overlay yields entirely while a non-conversation panel is open', () => {
  const rig = overlayRig({ panel: 'settings' })
  assert.equal(rig.tree, null)
})

test('overlay renders the compact status entry inside a portal wrapper once real status exists', async () => {
  const rig = overlayRig()
  assert.ok(rig.tree, 'wrapper renders for a mounted session with a free seat')
  assert.equal(rig.tree.type, 'span')
  assert.ok(rig.tree.props['data-dvt-status-fallback'] !== undefined)
  assert.equal(rig.tree.props.style.position, 'fixed')
  assert.equal(rig.tree.props.style.zIndex, 40)
  assert.equal(rig.tree.props.style.pointerEvents, 'none', 'empty state must not intercept clicks')
  const child = rig.tree.children[0]
  assert.ok(child, 'portal wrapper carries the status entry')
  assert.equal(child.type, rig.module.SessionDevTunnelStatus)
  assert.equal(child.props.sessionId, 's1')
  assert.equal(child.props.compact, true)
  assert.equal(typeof child.props.presenceRef.current, 'boolean')

  // Drive the child: fetch resolves to a devtunnel status → presence flips true.
  rig.env.reset()
  rig.module.SessionDevTunnelStatus(child.props)
  rig.env.flush()
  await settle()
  rig.env.reset()
  const after = rig.module.SessionDevTunnelStatus(child.props)
  assert.ok(after, 'chip renders for a devtunnel workspace')
  assert.equal(child.props.presenceRef.current, true)
  // Presence effect commits `show` only on a fresh StatusFallback pass.
  rig.env.reset()
  rig.StatusFallback(overlayProps())
  rig.env.flush()
  rig.env.reset()
  const revealed = rig.StatusFallback(overlayProps())
  assert.equal(revealed.props.style.pointerEvents, 'auto', 'visible button becomes interactive')

  // Clicking the compact anchor opens the same confirmation-flow menu.
  const anchor = nodes(after.props.anchor).find(node => node.props && node.props['data-dvt-status-entry'] !== undefined)
  assert.ok(anchor, 'fallback button carries the stable entry marker')
  assert.equal(anchor.props.className, 'dvt-session-tag dvt-session-tag-compact')
  assert.ok(typeof anchor.props['aria-label'] === 'string' && anchor.props['aria-label'].length > 0)
  assert.match(anchor.props.title, /sessionStatusReady/)
  assert.equal(nodes(anchor).some(node => node.props && node.props.className === 'dvt-tag-chevron'), false,
    'compact mode keeps the chevron icon off the 28px button')
  anchor.props.onClick()
  rig.env.reset()
  const opened = rig.module.SessionDevTunnelStatus(child.props)
  assert.equal(opened.props.open, true, 'menu opens exactly like the header entry')
  const items = opened.props.items.filter(item => !item.type).map(item => item.id)
  assert.deepEqual(items, ['start', 'restart', 'stop', 'refresh'])
})

test('overlay stays pointer-transparent for non-devtunnel workspaces', async () => {
  const rig = overlayRig({ fetchImpl: async () => ({ ok: false, status: 404 }) })
  const child = rig.tree.children[0]
  rig.env.reset()
  rig.module.SessionDevTunnelStatus(child.props)
  rig.env.flush()
  await settle()
  rig.env.reset()
  assert.equal(rig.module.SessionDevTunnelStatus(child.props), null, 'no chip for a plain workspace')
  assert.equal(child.props.presenceRef.current, false)
  rig.env.flush()
  rig.env.reset()
  assert.equal(rig.StatusFallback(overlayProps()).props.style.pointerEvents, 'none', 'wrapper must not intercept clicks')
})

test('overlay tracks the mounted session and hides when it clears', () => {
  const mounted = mountedStore('s1')
  const rig = overlayRig({ mounted })
  assert.ok(rig.tree)
  mounted.set(undefined)
  rig.env.reset()
  assert.equal(rig.StatusFallback(rig.props()), null)
})

test('overlay re-positions and releases every subscription and observer on unmount', () => {
  const listeners = []
  const mounted = {
    getSnapshot: () => 's1',
    subscribe: fn => { listeners.push(fn); return () => { listeners.splice(listeners.indexOf(fn), 1) } },
  }
  const { env, module } = load()
  const StatusFallback = module.createStatusFallback(mounted)
  env.reset()
  StatusFallback(overlayProps())
  const effects = env.effects.splice(0)
  assert.equal(effects.length, 3)
  const cleanups = effects.map(fn => fn()).filter(fn => typeof fn === 'function')
  assert.equal(cleanups.length, 2, 'subscription + observer/resize/timer cleanup')
  assert.equal(listeners.length, 1)
  for (const cleanup of cleanups) cleanup()
  assert.equal(listeners.length, 0, 'subscription and observers are released')
})

test('overlay never renders without a safe seat even with a session', () => {
  const rig = overlayRig({ document: makeDom([
    [ANCHOR_SELECTOR, fakeElement(rect(1000, 20, 28, 28))],
    [CONTROLS_SELECTOR, fakeElement(rect(4, 20, 990, 28))],
  ]) })
  assert.equal(rig.tree, null, 'no seat → nothing, no matter the session state')
})