// Fixture harness for the dsh-devtunnel-ssh client half and for the
// cross-repo composition test. It is a hand-rolled React/slot double: enough
// semantics to render the real client bundles (classic __ModuleLoader__
// entries) without a browser, React, or the DSH web client.
//
// Not a test file (no *.test.mjs) — `node --test test/*.test.mjs` ignores it.

/** Minimal React double: hooks are call-order indexed, like a real render pass. */
export function createReact() {
  const states = []
  const refs = []
  const effects = []
  let cursor = 0
  const React = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) {
      const index = cursor++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in refs)) refs[index] = { current: initial }
      return refs[index]
    },
    useEffect(fn) { effects.push(fn) },
    useMemo(fn) { return fn() },
    useCallback(fn) { return fn },
  }
  return {
    React,
    effects,
    /** Reset hook indexing before one component-tree render pass. */
    reset() { cursor = 0 },
    /** Run and clear the effects queued by the render pass just performed. */
    flush() { const queued = effects.splice(0); for (const fn of queued) fn() },
    states,
    refs,
  }
}

/**
 * Slot-registry double with the owner semantics that matter here: a child slot
 * exists only after a registration declares it, `inject` waits for that
 * declaration (so load order is irrelevant), keyed dispatch selects by key and
 * list dispatch orders by order.
 */
export function createSlots(React) {
  const records = new Map([
    ['root', { spec: { kind: 'single', scope: 'root' }, entries: [] }],
    // Declared by the shipped settings shell; dsh-remote registers its page into it.
    ['settings.section', { spec: { kind: 'list', scope: 'root' }, entries: [] }],
  ])
  const waiting = new Map()
  const record = key => {
    if (!records.has(key)) records.set(key, { spec: undefined, entries: [] })
    return records.get(key)
  }
  const notify = key => {
    const record_ = record(key)
    if (record_.spec === undefined) return
    const queued = waiting.get(key)
    if (!queued) return
    waiting.delete(key)
    for (const callback of queued) callback()
  }
  const slots = {
    registered: [],
    inject(key, callback) {
      if (record(key).spec !== undefined) { callback(); return () => {} }
      if (!waiting.has(key)) waiting.set(key, [])
      waiting.get(key).push(callback)
      return () => {}
    },
    register(def, component) {
      const target = record(def.name)
      if (target.spec === undefined) throw new Error(`slot "${def.name}" is not declared`)
      if (target.spec.kind === 'list' && def.id === undefined) throw new Error(`list slot "${def.name}" requires id`)
      if (target.spec.kind === 'keyed' && def.key === undefined) throw new Error(`keyed slot "${def.name}" requires key`)
      for (const childKey of Object.keys(def.children || {})) {
        if (record(childKey).spec !== undefined) throw new Error(`slot "${childKey}" is already declared`)
      }
      const entry = { def, component }
      target.entries.push(entry)
      slots.registered.push({ def, component })
      for (const [childKey, childSpec] of Object.entries(def.children || {})) record(childKey).spec = childSpec
      for (const childKey of Object.keys(def.children || {})) notify(childKey)
      return () => { target.entries = target.entries.filter(candidate => candidate !== entry) }
    },
    entries(key) { return record(key).entries },
    spec(key) { return record(key).spec },
    renderSlot(key, owner = {}, opts = {}) {
      const target = record(key)
      if (target.spec === undefined) return null
      let entries = target.entries
      if (target.spec.kind === 'keyed') entries = entries.filter(entry => entry.def.key === opts.entryKey)
      if (target.spec.kind === 'list') {
        entries = [...entries].sort((a, b) => ((a.def.priority || 0) - (b.def.priority || 0)) || ((a.def.order || 0) - (b.def.order || 0)))
      }
      const rendered = entries.map(entry => entry.component({ ...owner }))
      if (rendered.length) return rendered
      return opts.fallback === undefined ? null : opts.fallback
    },
  }
  return slots
}

/** Load one classic client bundle and return its exported module. */
export function loadClient(source, { React, windowOverrides = {}, fetchImpl } = {}) {
  let exports
  const window = {
    location: { protocol: 'https:' },
    confirm: () => true,
    localStorage: { getItem: () => null },
    ...windowOverrides,
    __ModuleLoader__: { load: definition => { exports = definition.factory(name => { if (name !== 'react') throw new Error('unexpected require: ' + name); return React }) } },
  }
  const document = { getElementById: () => null, createElement: () => ({ style: {}, set textContent(v) {}, appendChild() {} }), head: { appendChild() {} } }
  const fetch = fetchImpl || (() => { throw new Error('this client half must not fetch') })
  // Timers are capped to the next macrotask and never repeat: a client half that
  // races a fetch against a fallback timeout must settle, and no interval may
  // keep the test process alive.
  const timers = new Set()
  const setTimeoutImpl = (fn, ms) => { const handle = globalThis.setTimeout(fn, Math.min(Number(ms) || 0, 0)); timers.add(handle); return handle }
  const clearTimeoutImpl = handle => { timers.delete(handle); globalThis.clearTimeout(handle) }
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'navigator', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'console', 'fetch', source)(
    window, document, { languages: ['zh-CN'] }, setTimeoutImpl, clearTimeoutImpl, () => 0, () => {}, console, fetch,
  )
  return { exports, window, disposeTimers() { for (const handle of timers) globalThis.clearTimeout(handle); timers.clear() } }
}

/** Walk a fixture element tree and collect every node. */
export function nodes(node, out = []) {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const child of node) nodes(child, out); return out }
  out.push(node)
  nodes(node.children, out)
  return out
}

/** Flatten fixture text (strings only, no React internals). */
export function text(node) {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(text).join(' ')
  if (node && typeof node === 'object') return text(node.children)
  return ''
}

export function findButton(tree, label) {
  return nodes(tree).find(node => node.type === 'button' && text(node) === label)
}

export function findInput(tree, key) {
  const container = nodes(tree).find(node => node.props && node.props.key === key)
  return container ? nodes(container).find(node => node.type === 'input') : undefined
}

export const fingerprint = 'SHA256:' + 'A'.repeat(43)
