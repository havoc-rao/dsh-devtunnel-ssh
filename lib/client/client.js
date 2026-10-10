// dsh-devtunnel-ssh — client half.
//
// Contributes the "Dev Tunnel SSH" transport to dsh-remote's unified
// RemoteSettings page. dsh-remote owns the machine registry, the machine card
// shell and every write; this half owns the devtunnel type option, the channel
// mode, all devtunnel fields, their validation and the carrier body, and hands
// that body back through owner callbacks. The only host route this half reads
// is the read-only managed-connect diagnostics pull (mirrored to the console);
// every machine write stays with the owner.
//
// Slots are declared by dsh-remote's `settings.section` entry; `slots.inject`
// waits for that declaration, so load order does not matter. Contract:
// docs/devtunnel-ssh/remote-settings-slot-contract.md
//
// Client entries are classic scripts registered through window.__ModuleLoader__
// ({ id, factory }); the factory receives a synchronous `require`.
window.__ModuleLoader__.load({ id: 'dsh-devtunnel-ssh', factory: require => {
  const React = require('react')
  const h = React.createElement
  const name = 'dsh-devtunnel-ssh'

  // Owner-declared slots (settings.remote.machine.*) and this transport key.
  const TRANSPORT = 'devtunnel-ssh'
  const SLOT_TRANSPORT_OPTION = 'settings.remote.machine.transport.option'
  const SLOT_TRANSPORT_FIELDS = 'settings.remote.machine.transport.fields'
  const SLOT_TRANSPORT_PANEL = 'settings.remote.machine.transport.panel'

  // ── i18n ────────────────────────────────────────────────────────────────
  // Same shape as the owner's dictionary: stable ids, zh + en share the key
  // set, lookup falls back to the local table so a missing binder still shows
  // readable text instead of a blank page.
  const NS = 'dsh-devtunnel-ssh'
  const L = {
    zh: {
      'carrierUnavailableHint': 'Dev Tunnel SSH 不可用：请在宿主启用工作区支持并注册 Dev Tunnel carrier。',
      'carrierHint': '实验性 SSH carrier。请通过独立渠道确认远端 SSH SHA256 指纹；不使用 TOFU 或密码。连接前请自行启动外部 Dev Tunnel 本机回环监听器。',
      'carrierMode': '通道模式',
      'carrierExternal': '外部监听器',
      'carrierManaged': '托管连接',
      'carrierManagedHint': '由插件在连接时启动并维护已授权的 devtunnel connect，无需手工终端，自动分配回环端口。保存修改会断开此机器旧连接；先保存才能测试或创建镜像。远端 SSH 端口与 SHA256 指纹须独立确认。通道关闭使当前操作失败，不自动重放；后续连接重新获取通道。',
      'carrierManagedUnavailable': '托管模式不可用：请在本页全局 Dev Tunnel 设置中开启托管连接，并确认宿主 PATH 或可选路径覆盖能找到 CLI。保存或查看设置不会启动 CLI。',
      'carrierTunnelId': 'Tunnel ID',
      'carrierRemotePort': '远端端口',
      'carrierLocalPort': '本机端口',
      'carrierFingerprint': '指纹',
      'carrierKeyHint': 'A（DSH 宿主）上的私钥路径，不是 .pub',
      'carrierRemoteDir': '远端目录',
      'carrierCreateMirror': '创建本地镜像',
      'carrierMirrorHint': '请先保存机器。创建镜像后，在工作区侧栏手动选择显示的本地镜像目录；本页不会替您切换侧栏选择。',
      'user': '用户',
      'agent': 'SSH agent（SSH_AUTH_SOCK）',
      'privateKey': '私钥路径',
      'panelTitle': 'Dev Tunnel 通道管理（本插件）',
      'panelHint': '托管通道由本插件按需启动；此处显示活动通道、重试/阻塞状态与最近事件。断开只影响该机器，SSH 业务不重放。',
      'panelManaged': '托管授权',
      'panelEnabled': '已开启',
      'panelDisabled': '未开启',
      'panelActive': '活动通道',
      'panelEmpty': '当前没有活动托管通道；连接托管机器时按需建立。',
      'panelStarting': '启动中…',
      'panelClosing': '正在关闭…',
      'panelStop': '断开',
      'panelStopping': '断开中…',
      'panelStopConfirm': '断开 {machine} 的托管通道？该机器上的 SSH 会话会失效，且不会自动重放。',
      'panelRetrying': '重试中：{tunnel} :{port}（第 {attempts} 次）',
      'panelBlocked': '已阻塞：{tunnel} :{port} · {code}（需人工处理后再试）',
      'panelRecent': '最近事件',
      'panelRefresh': '刷新',
      'panelErrorNotFound': '该通道已不存在（可能已断开）。',
      'panelErrorUnavailable': '宿主通道管理不可用。',
      'panelErrorFailed': '断开失败，未自动重试。',
    },
    en: {
      'carrierUnavailableHint': 'Dev Tunnel SSH unavailable: enable workspace support and register the Dev Tunnel carrier on the host.',
      'carrierHint': 'Experimental SSH carrier. Confirm the remote SSH SHA256 fingerprint out of band; no TOFU or passwords. Start the external Dev Tunnel loopback listener yourself before connecting.',
      'carrierMode': 'Channel mode',
      'carrierExternal': 'External listener',
      'carrierManaged': 'Managed connection',
      'carrierManagedHint': 'The plugin starts and maintains authorized devtunnel connect when connecting; no manual terminal is needed. The loopback port is automatic. Saving changes disconnects this machine’s old connections; save before testing or creating a mirror. Independently confirm the remote SSH port and SHA256 fingerprint. Channel closure fails current operations without replay; later connections acquire a new channel.',
      'carrierManagedUnavailable': 'Managed mode unavailable: enable managed connections and ensure the host PATH or optional override resolves the CLI in the global settings on this page. Saving or viewing settings does not start the CLI.',
      'carrierTunnelId': 'Tunnel ID',
      'carrierRemotePort': 'Remote port',
      'carrierLocalPort': 'Local port',
      'carrierFingerprint': 'Fingerprint',
      'carrierKeyHint': 'Private key path on A (DSH host), not .pub',
      'carrierRemoteDir': 'Remote dir',
      'carrierCreateMirror': 'Create local mirror',
      'carrierMirrorHint': 'Save the machine first. After creating its mirror, manually select the displayed local mirror directory in the workspace sidebar; this page does not change your sidebar selection.',
      'user': 'User',
      'agent': 'SSH agent (SSH_AUTH_SOCK)',
      'privateKey': 'Private key path',
      'panelTitle': 'Dev Tunnel channels (this plugin)',
      'panelHint': 'Managed channels start on demand in this plugin. This box lists active channels, retry/blocked state and recent events. Disconnecting affects only that machine; SSH work is never replayed.',
      'panelManaged': 'Managed authorization',
      'panelEnabled': 'enabled',
      'panelDisabled': 'off',
      'panelActive': 'Active channels',
      'panelEmpty': 'No active managed channel; one starts on demand when a managed machine connects.',
      'panelStarting': 'starting…',
      'panelClosing': 'closing…',
      'panelStop': 'Disconnect',
      'panelStopping': 'Disconnecting…',
      'panelStopConfirm': 'Disconnect the managed channel for {machine}? Its SSH sessions fail and are not replayed.',
      'panelRetrying': 'Retrying: {tunnel} :{port} (attempt {attempts})',
      'panelBlocked': 'Blocked: {tunnel} :{port} · {code} (needs manual action)',
      'panelRecent': 'Recent events',
      'panelRefresh': 'Refresh',
      'panelErrorNotFound': 'That channel no longer exists (already disconnected).',
      'panelErrorUnavailable': 'Host channel management is unavailable.',
      'panelErrorFailed': 'Disconnect failed; not retried automatically.',
    },
  }
  let tr = key => key
  function wireLocale(ctx) {
    try {
      const locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined
      if (!locale || typeof locale.register !== 'function' || typeof locale.bind !== 'function') return
      const dispose = locale.register(NS, { zh: L.zh, en: L.en })
      const bound = locale.bind(NS)
      tr = (key, params) => {
        let value = bound(key, params)
        if (value === key) {
          const local = L.zh[key] !== undefined ? L.zh[key] : L.en[key]
          value = local === undefined ? key : local
          if (params) value = String(value).replace(/\{(\w+)\}/g, (m, p) => (p in params ? String(params[p]) : m))
        }
        return value
      }
      if (typeof ctx.effect === 'function') ctx.effect(() => (typeof dispose === 'function' ? dispose : () => {}), 'dsh-devtunnel-ssh.locale')
    } catch { /* keep the local table fallback */ }
  }

  // ── pure contract helpers ───────────────────────────────────────────────
  function capabilities(status) {
    return status && status.sshCarrierCapabilities ? status.sshCarrierCapabilities : null
  }
  /** The owner exposes carrier capability + registered carrier ids on /status. */
  function carrierReady(status) {
    const c = capabilities(status)
    return !!(c && c.workspaceSupported === true && Array.isArray(c.carrierIds) && c.carrierIds.includes('devtunnel'))
  }
  /** Managed mode needs the host's explicit devTunnelManaged authorization. */
  function managedAvailable(status) {
    const c = capabilities(status)
    return !!(carrierReady(status) && c.devTunnelManaged === true)
  }
  function defaultMode(status) {
    return managedAvailable(status) ? 'managed' : 'external'
  }
  function trimmed(value) {
    return typeof value === 'string' ? value.trim() : ''
  }
  /** Recursive key-sorted JSON: the owner compares saved vs published drafts. */
  function canonicalJson(value) {
    if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}'
    }
    return JSON.stringify(value === undefined ? null : value)
  }
  function modeOf(form) {
    const raw = (form || {}).carrierMode
    if (raw === undefined || raw === null || raw === '') return 'external'
    return raw
  }
  /**
   * The carrier body the owner commits (owner adds action/id). Field set and
   * constants match the owner's saved-record shape so the owner's canonical
   * dirty check works on either side.
   */
  function devTunnelBody(form) {
    const source = form || {}
    const mode = modeOf(source) === 'managed' ? 'managed' : 'external'
    return {
      transport: 'ssh',
      name: trimmed(source.name),
      username: trimmed(source.username),
      connector: {
        kind: 'devtunnel',
        mode,
        tunnelId: trimmed(source.tunnelId),
        remotePort: Number(source.remotePort),
        ...(mode === 'external'
          ? { endpoint: { host: source.localHost || '127.0.0.1', port: Number(source.localPort) } }
          : {}),
      },
      hostKeyMode: 'verify',
      expectedHostFingerprint: trimmed(source.expectedHostFingerprint),
      useAgent: !!source.useAgent,
      privateKeyPath: trimmed(source.privateKeyPath),
    }
  }
  /** Field validation plus the capability gate the owner used to apply itself. */
  function devTunnelValid(form, status) {
    const mode = modeOf(form)
    if (mode !== 'external' && mode !== 'managed') return false
    if (mode === 'managed' ? !managedAvailable(status) : !carrierReady(status)) return false
    const body = devTunnelBody(form)
    const port = value => Number.isInteger(value) && value >= 1 && value <= 65535
    return !!(body.username
      && /^[a-z0-9][a-z0-9-]{0,99}(?:\.[a-z0-9]{1,20})?$/.test(body.connector.tunnelId)
      && port(body.connector.remotePort)
      && (body.connector.mode === 'managed'
        || (port(body.connector.endpoint.port) && ['127.0.0.1', '::1'].includes(body.connector.endpoint.host)))
      && /^SHA256:[A-Za-z0-9+/]{43}=?$/.test(body.expectedHostFingerprint)
      && (body.useAgent || body.privateKeyPath))
  }

  // ── shared presentation (mirrors the owner's row metrics) ───────────────
  const ROW = { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }
  const LABEL = { width: 88, fontSize: 13, lineHeight: '20px', opacity: 0.75, flexShrink: 0 }
  const NOTE = { fontSize: 12, opacity: 0.8, marginBottom: 8 }
  function row(label, control, key) {
    return h('div', { key, style: ROW }, h('label', { style: LABEL }, label), h('div', { style: { flex: 1, minWidth: 0 } }, control))
  }
  function textInput(props) {
    return h('input', { className: 'rws-input', ...props })
  }
  // The host masks every field before the entry ever leaves it; this only
  // renders one bounded console line.
  function formatEntry(entry) {
    const parts = [`code=${entry.code}`]
    for (const key of ['reason', 'stream', 'mode', 'attempt', 'lines', 'bytes', 'remotePort']) {
      if (entry[key] !== undefined) parts.push(`${key}=${entry[key]}`)
    }
    if (entry.sawForwarding !== undefined) parts.push(`sawForwarding=${entry.sawForwarding === true}`)
    if (entry.endpoint) parts.push(`endpoint=${entry.endpoint.host}:${entry.endpoint.port}`)
    if (entry.machineId) parts.push(`machineId=${entry.machineId}`)
    if (entry.tunnelId) parts.push(`tunnelId=${entry.tunnelId}`)
    if (entry.executable) parts.push(`executable=${entry.executable}`)
    for (const [index, line] of (entry.sample || []).entries()) parts.push(`line${index + 1}="${line}"`)
    return parts.join(' ')
  }
  // Channel management feed: read-only, same-origin, best effort. It runs while
  // the panel is mounted (the panel is always on the settings page) and mirrors
  // each new host diagnostic into the console with a stable prefix.
  const CHANNELS_PATH = '/dsh-devtunnel-ssh/channels'
  function useChannelFeed() {
    const [feed, setFeed] = React.useState(null)
    // Distinguishes "no channels" from "the host route is not (yet) there":
    // a silently empty box would hide that the plugin half needs a reload.
    const [error, setError] = React.useState('')
    // A ref (not a closure variable) keeps de-duplication across an effect
    // re-run: React StrictMode mounts, unmounts and re-mounts in development,
    // and a re-run must not replay entries that were already shown.
    const seen = React.useRef(0)
    const pullRef = React.useRef(() => {})
    React.useEffect(() => {
      if (typeof window === 'undefined' || typeof fetch !== 'function' || typeof setInterval !== 'function') return undefined
      let live = true
      const pull = () => {
        try {
          fetch(CHANNELS_PATH, { method: 'GET', credentials: 'same-origin', redirect: 'error' })
            .then(response => {
              if (!response || !response.ok) { if (live) setError('panelErrorUnavailable'); return null }
              return response.json()
            })
            .then(data => {
              if (!live || !data) return
              if (data.ok !== true) { setError('panelErrorUnavailable'); return }
              setError('')
              for (const entry of Array.isArray(data.recent) ? data.recent : []) {
                if (!entry || !Number.isSafeInteger(entry.seq) || entry.seq <= seen.current) continue
                seen.current = entry.seq
                try { console.warn(`[dsh-devtunnel-ssh] ${formatEntry(entry)}`) } catch { /* console unavailable */ }
              }
              setFeed(data)
            })
            .catch(() => { /* the panel degrades to its empty state */ })
        } catch { /* best effort */ }
      }
      pullRef.current = pull
      pull()
      const timer = setInterval(pull, 3000)
      return () => { live = false; clearInterval(timer) }
    }, [])
    return { feed, error, refresh: () => { try { pullRef.current() } catch { /* best effort */ } } }
  }

  /**
   * `settings.remote.machine.transport.option` occupant: the Dev Tunnel SSH
   * type button plus this transport's own availability hint.
   */
  function DevTunnelTransportOption(props) {
    const ready = carrierReady(props.status)
    const active = props.transport === TRANSPORT
    const disabled = !!props.busy || !!props.locked || !ready
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' } },
      h('button', {
        type: 'button',
        className: 'rws-btn' + (active ? ' on' : ''),
        disabled,
        onClick: () => { if (!disabled && typeof props.onSelect === 'function') props.onSelect(TRANSPORT) },
      }, 'Dev Tunnel SSH'),
      ready ? null : h('div', { style: { fontSize: 12, opacity: 0.7 } }, tr('carrierUnavailableHint')))
  }

  /**
   * `settings.remote.machine.transport.fields` occupant for key
   * 'devtunnel-ssh': channel mode, fields, mirror flow and the published draft.
   * Never probes or saves on its own — the owner owns every write.
   */
  function DevTunnelFields(props) {
    const form = props.form || {}
    const carrier = props.carrier || {}
    const locked = !!props.locked
    const busy = !!props.busy
    const mode = modeOf(form) === 'managed' ? 'managed' : 'external'
    const ready = carrierReady(props.status)
    const managedReady = managedAvailable(props.status)
    const patch = typeof props.patch === 'function' ? props.patch : () => {}

    // New-draft defaults: a fresh devtunnel draft gets the capability default
    // mode and the agent-first authentication the rest of the flow assumes.
    const entered = React.useRef(false)
    React.useEffect(() => {
      if (entered.current) return
      entered.current = true
      if (locked) return
      const next = {}
      if (!trimmed(form.tunnelId) && !trimmed(form.expectedHostFingerprint)) {
        next.carrierMode = defaultMode(props.status)
        next.useAgent = true
      }
      if (!form.useAgent && !trimmed(form.privateKeyPath) && next.useAgent === undefined) next.useAgent = true
      if (!form.remotePort) next.remotePort = '22'
      if (!form.localHost) next.localHost = '127.0.0.1'
      if (!form.localPort) next.localPort = '2222'
      if (Object.keys(next).length) patch(next)
    }, [])

    // Publish the draft upward. The ref keeps an unchanged draft from
    // re-publishing (the owner's publish is idempotent too, belt and braces).
    const body = devTunnelBody(form)
    const valid = devTunnelValid(form, props.status)
    const published = React.useRef('')
    const draftKey = canonicalJson(body) + '|' + (valid ? '1' : '0')
    React.useEffect(() => {
      if (published.current === draftKey) return
      published.current = draftKey
      if (typeof carrier.publish === 'function') carrier.publish({ valid, body })
    })

    const setField = key => event => patch({ [key]: event.target.value })
    const setCheck = key => event => {
      if (typeof props.setChecked === 'function') props.setChecked(key, event.target.checked)
      else patch({ [key]: event.target.checked })
    }
    const modeButton = (target, label, enabled, hint) => h('button', {
      type: 'button',
      className: 'rws-btn' + (mode === target ? ' on' : ''),
      disabled: busy || !enabled,
      title: hint,
      onClick: () => { if (!busy && enabled) patch({ carrierMode: target }) },
    }, label)

    const mirrorPath = typeof carrier.mirrorPath === 'string' ? carrier.mirrorPath : ''
    const dirty = carrier.dirty !== false
    const mirrorDisabled = busy || !ready || !valid || !form.id || !props.scopeDir || !mirrorPath.trim() || dirty

    return h(React.Fragment, null,
      row(tr('carrierMode'), h('div', { style: { display: 'flex', gap: 4 } },
        modeButton('external', tr('carrierExternal'), ready, tr('carrierHint')),
        modeButton('managed', tr('carrierManaged'), managedReady, tr('carrierManagedHint'))), 'cmode'),
      h('div', { style: { ...NOTE, color: 'inherit' } }, tr(mode === 'managed' ? 'carrierManagedHint' : 'carrierHint')),
      managedReady ? null : h('div', { style: { ...NOTE, opacity: 0.7 } }, tr('carrierManagedUnavailable')),
      row(tr('user'), textInput({ value: form.username || '', onChange: setField('username') }), 'cu'),
      row(tr('carrierTunnelId'), textInput({ value: form.tunnelId || '', onChange: setField('tunnelId'), disabled: locked }), 'ctid'),
      row(tr('carrierRemotePort'), textInput({ value: form.remotePort || '', onChange: setField('remotePort'), disabled: locked }), 'crp'),
      mode === 'managed' ? null : row(tr('carrierLocalPort'), textInput({ value: form.localPort || '', onChange: setField('localPort') }), 'clp'),
      row(tr('carrierFingerprint'), textInput({
        value: form.expectedHostFingerprint || '', onChange: setField('expectedHostFingerprint'),
        disabled: locked, placeholder: 'SHA256:… (required, confirmed)',
      }), 'cfp'),
      row(tr('agent'), h('input', { type: 'checkbox', checked: !!form.useAgent, onChange: setCheck('useAgent') }), 'ca'),
      row(tr('privateKey'), textInput({ value: form.privateKeyPath || '', onChange: setField('privateKeyPath'), placeholder: tr('carrierKeyHint') }), 'ck'),
      row(tr('carrierRemoteDir'), textInput({
        value: mirrorPath,
        onChange: event => { if (typeof carrier.setMirrorPath === 'function') carrier.setMirrorPath(event.target.value) },
        placeholder: '/absolute/remote/directory',
      }), 'cmd'),
      h('button', {
        type: 'button',
        className: 'rws-btn',
        disabled: mirrorDisabled,
        onClick: () => { if (!mirrorDisabled && typeof carrier.createMirror === 'function') carrier.createMirror() },
      }, tr('carrierCreateMirror')),
      carrier.localMirror
        ? h('code', { style: { display: 'block', fontSize: 12, wordBreak: 'break-all' } }, carrier.localMirror)
        : null,
      h('div', { style: { fontSize: 12, opacity: 0.7, marginTop: 6 } }, tr('carrierMirrorHint')))
  }

  /**
   * `settings.remote.machine.transport.panel` occupant: the always-visible
   * Dev Tunnel channel box — live channels, retry/blocked state and recent
   * events. Read-only except one explicit, confirmed stop per channel.
   */
  function DevTunnelPanel(props) {
    const { feed, error: feedError, refresh } = useChannelFeed()
    const [stopping, setStopping] = React.useState('')
    const [error, setError] = React.useState('')
    const machines = Array.isArray(props.machines) ? props.machines : []
    const nameOf = id => {
      const machine = machines.find(candidate => candidate && candidate.id === id)
      return machine ? (machine.name || machine.id) : id
    }
    const stop = channel => {
      if (stopping) return
      const label = nameOf(channel.machineId)
      if (typeof window !== 'undefined' && typeof window.confirm === 'function'
        && !window.confirm(tr('panelStopConfirm', { machine: label }))) return
      setStopping(channel.machineId); setError('')
      const finish = () => { setStopping(''); refresh() }
      try {
        fetch(CHANNELS_PATH, { method: 'POST', credentials: 'same-origin', redirect: 'error',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'stop', machineId: channel.machineId, confirmed: true }) })
          .then(response => response.json().catch(() => ({})).then(data => ({ response, data })))
          .then(({ response, data }) => {
            if (!response || !response.ok || data.ok !== true) {
              const code = typeof data.error === 'string' ? data.error : 'CHANNELS_UNAVAILABLE'
              setError(tr(code === 'CHANNEL_NOT_FOUND' ? 'panelErrorNotFound'
                : code === 'CHANNELS_UNAVAILABLE' ? 'panelErrorUnavailable' : 'panelErrorFailed'))
            }
          })
          .catch(() => setError(tr('panelErrorFailed')))
          .then(finish)
      } catch { setError(tr('panelErrorFailed')); finish() }
    }
    const channels = feed && Array.isArray(feed.channels) ? feed.channels : []
    const supervisor = feed && Array.isArray(feed.supervisor) ? feed.supervisor : []
    const recent = feed && Array.isArray(feed.recent) ? feed.recent.slice(-5).reverse() : []
    // A supervisor entry without a live channel is retrying or blocked.
    const pending = supervisor.filter(agent => !channels.some(channel =>
      channel.tunnelId === agent.tunnelId && channel.remotePort === agent.remotePort))
    const stateText = channel => channel.state === 'ready'
      ? (channel.endpoint ? `\u2192 ${channel.endpoint.host}:${channel.endpoint.port}` : '\u2014')
      : tr(channel.state === 'closing' ? 'panelClosing' : 'panelStarting')
    return h('div', { className: 'rws-card', 'data-testid': 'devtunnel-channel-panel', style: { display: 'flex', flexDirection: 'column', gap: 6 } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
        h('div', { style: { fontSize: 13, fontWeight: 600, lineHeight: '20px' } }, tr('panelTitle')),
        h('div', { style: { fontSize: 12, opacity: 0.7, marginLeft: 'auto' } },
          `${tr('panelManaged')}: ${feed ? (feed.enabled ? tr('panelEnabled') : tr('panelDisabled')) : '\u2014'} \u00b7 ${tr('panelActive')}: ${feed ? feed.activeManaged : '\u2014'}`)),
      h('div', { style: { fontSize: 12, opacity: 0.75 } }, tr('panelHint')),
      carrierReady(props.status) ? null : h('div', { style: { fontSize: 12, opacity: 0.75 } }, tr('carrierUnavailableHint')),
      error || feedError ? h('div', { role: 'alert', style: { fontSize: 12 } }, error || tr(feedError)) : null,
      channels.length ? null : (feed ? h('div', { style: { fontSize: 12, opacity: 0.6, padding: '2px 0' } }, tr('panelEmpty')) : null),
      channels.map(channel => h('div', { key: `channel:${channel.machineId}:${channel.generation}`,
        className: 'rws-row', style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
        h('span', { style: { fontSize: 12, fontWeight: 500 } }, nameOf(channel.machineId)),
        h('code', { style: { fontSize: 12 } }, `${channel.tunnelId} :${channel.remotePort}`),
        h('span', { style: { fontSize: 12, opacity: 0.75 } }, stateText(channel)),
        h('span', { className: 'rws-chip' }, channel.mode === 'managed' ? tr('carrierManaged') : tr('carrierExternal')),
        channel.since ? h('span', { style: { fontSize: 11, opacity: 0.6 } }, new Date(channel.since).toLocaleTimeString()) : null,
        h('button', { type: 'button', className: 'rws-btn ghost danger', style: { marginLeft: 'auto' },
          disabled: !!props.busy || stopping === channel.machineId,
          onClick: () => stop(channel) }, stopping === channel.machineId ? tr('panelStopping') : tr('panelStop')))),
      pending.map(agent => h('div', { key: `agent:${agent.tunnelId}:${agent.remotePort}`, style: { fontSize: 12, opacity: 0.8 } },
        agent.blocked
          ? tr('panelBlocked', { tunnel: agent.tunnelId, port: agent.remotePort, code: agent.blocked })
          : tr('panelRetrying', { tunnel: agent.tunnelId, port: agent.remotePort, attempts: agent.failures }))),
      recent.length
        ? h('div', { style: { marginTop: 4 } },
            h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 2 } }, tr('panelRecent')),
            recent.map(entry => h('div', { key: entry.seq, style: { fontSize: 11, opacity: 0.85, overflowWrap: 'anywhere' } },
              `${new Date(entry.at).toLocaleTimeString()} ${entry.code}${entry.machineId ? ` ${entry.machineId}` : ''}${entry.reason ? ` ${entry.reason}` : ''}${entry.endpoint ? ` \u2192 ${entry.endpoint.host}:${entry.endpoint.port}` : ''}`)))
        : null,
      h('div', null, h('button', { type: 'button', className: 'rws-btn ghost', disabled: !!props.busy, onClick: refresh }, tr('panelRefresh'))))
  }

  function apply(ctx) {
    if (!ctx || typeof ctx.get !== 'function') return
    // The slot registry is optional: without it the host half still works.
    const slots = ctx.get('slots')
    if (slots === undefined || slots === null) return
    wireLocale(ctx)
    slots.inject(SLOT_TRANSPORT_OPTION, () =>
      slots.register({ name: SLOT_TRANSPORT_OPTION, id: TRANSPORT, order: 10 }, DevTunnelTransportOption))
    slots.inject(SLOT_TRANSPORT_FIELDS, () =>
      slots.register({ name: SLOT_TRANSPORT_FIELDS, key: TRANSPORT }, DevTunnelFields))
    slots.inject(SLOT_TRANSPORT_PANEL, () =>
      slots.register({ name: SLOT_TRANSPORT_PANEL, id: TRANSPORT, order: 10 }, DevTunnelPanel))
  }

  const module = { exports: {} }
  module.exports.name = name
  module.exports.apply = apply
  module.exports.inject = ['slots', 'locale']
  // Contract + helpers, exported for the fixture tests (not a public API).
  module.exports.NS = NS
  module.exports.dict = L
  module.exports.TRANSPORT = TRANSPORT
  module.exports.SLOT_TRANSPORT_OPTION = SLOT_TRANSPORT_OPTION
  module.exports.SLOT_TRANSPORT_FIELDS = SLOT_TRANSPORT_FIELDS
  module.exports.SLOT_TRANSPORT_PANEL = SLOT_TRANSPORT_PANEL
  module.exports.capabilities = capabilities
  module.exports.carrierReady = carrierReady
  module.exports.managedAvailable = managedAvailable
  module.exports.defaultMode = defaultMode
  module.exports.canonicalJson = canonicalJson
  module.exports.devTunnelBody = devTunnelBody
  module.exports.devTunnelValid = devTunnelValid
  module.exports.DevTunnelTransportOption = DevTunnelTransportOption
  module.exports.DevTunnelFields = DevTunnelFields
  module.exports.DevTunnelPanel = DevTunnelPanel
  return module.exports
}})
