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
  const { Switch, Menu } = require('@deepseek-ai/dsh-client-ui-primitives')
  const h = React.createElement
  const name = 'dsh-devtunnel-ssh'

  // Owner-declared slots (settings.remote.machine.*) and this transport key.
  const TRANSPORT = 'devtunnel-ssh'
  const SLOT_TRANSPORT_OPTION = 'settings.remote.machine.transport.option'
  const SLOT_TRANSPORT_FIELDS = 'settings.remote.machine.transport.fields'
  const SLOT_TRANSPORT_PANEL = 'settings.remote.machine.transport.panel'
  // Shell-declared session header seat (ui-conversation): the status marker
  // for a Dev Tunnel workspace renders here, next to the session title.
  const SLOT_SESSION_UTILITIES = 'conversation.session.header.utilities'
  const MACHINE_STATUS_SLOTS = ['settings.remote.machine.status', 'remote.picker.hero.machine.status', 'remote.picker.sidebar.machine.status']
  const SESSION_STATUS_ID = 'devtunnel-status'
  const SESSION_STATUS_POLL_MS = 10000
  // Read-only public resolution chain: workspace dir -> machine -> connector
  // (dsh-remote's own client-safe GET routes) -> this plugin's channel feed.
  const CONNECTION_STATUS_PATH = '/dsh-remote/status'
  const WORKSPACE_STATUS_PATH = '/dsh-remote/resolve-mirror'
  const MACHINES_PATH = '/dsh-remote/machines'

  // ── i18n ────────────────────────────────────────────────────────────────
  // Same shape as the owner's dictionary: stable ids, zh + en share the key
  // set, lookup falls back to the local table so a missing binder still shows
  // readable text instead of a blank page.
  const NS = 'dsh-devtunnel-ssh'
  const L = {
    zh: {
      'channelFromMachine': '已有配置',
      'channelQuickStart': '启动通道',
      'channelReady': '通道已就绪',
      'channelQuickConfirm': '使用 {tunnel}:{port} 启动 Dev Tunnel？没有对应通道时会先创建，不会连接 SSH。',
      'channelQuickStarted': '通道启动已提交，可在通道列表查看状态。',

      'panelUnauthorized': '未授权托管',
      'panelAuthorized': '已授权托管',
      'panelActiveCount': '{count} 个运行中',
      'channelList': '通道列表',
      'channelEmptyTitle': '还没有通道',
      'channelSelect': '选择通道',
      'channelSelectHint': '选择已保存的通道，或使用已有机器配置启动。SSH 断开不会停止通道。',
      'channelName': '通道名称',
      'channelAdd': '添加通道',
      'channelEdit': '编辑',
      'channelDelete': '删除',
      'channelStart': '启动',
      'channelStop': '停止',
      'channelRestart': '重启',
      'channelSave': '保存通道',
      'channelCancel': '取消',
      'channelConfirm': '对通道执行「{action}」？停止、重启、编辑或删除会使所有借用它的 SSH 连接失效。',
      'channelRefs': 'SSH 引用：{count}',
      'channelStopped': '已停止',
      'channelError': '连接失败',
      'channelExternal': '外部管理（仅登记）',
      'channelEmpty': '添加并启动通道后，即可连接 SSH 机器。',
      'channelFailure': '操作失败：{code}。请刷新列表后重试。',

      'carrierUnavailableHint': 'Dev Tunnel SSH 不可用：请在宿主启用工作区支持并注册 Dev Tunnel carrier。',
      'carrierHint': '实验性 SSH carrier。请通过独立渠道确认远端 SSH SHA256 指纹；不使用 TOFU 或密码。连接前请自行启动外部 Dev Tunnel 本机回环监听器。',
      'carrierMode': '通道模式',
      'carrierExternal': '外部监听器',
      'carrierManaged': '托管连接',
      'carrierManagedHint': '选择已保存的通道，或使用已有机器配置启动。SSH 断开不会停止通道。',
      'carrierManagedUnavailable': '托管模式不可用：请在本页全局 Dev Tunnel 设置中开启托管连接，并确认宿主 PATH 或可选路径覆盖能找到 CLI。保存或查看设置不会启动 CLI。',
      'carrierTunnelId': 'Tunnel ID',
      'channelRetarget': '更换通道',
      'channelRetargetHint': '仅用于同一台远端机器更换 tunnel。保留原 SSH 指纹与工作区目录，影响使用此机器的全部工作区；请先保存其他修改。',
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
      'panelTitle': 'Dev Tunnel',
      'panelHint': '独立管理连接通道，供 SSH 机器使用。',
      'panelResident': '常驻隧道',
      'panelResidentOff': '未启用（在全局设置中配置）',
      'panelResidentStarting': '启动中',
      'panelResidentBlocked': '阻塞（需显式动作恢复）',
      'panelResidentExhausted': '重试耗尽',
      'panelResidentImmediate': '立即常驻',
      'panelResidentLazy': '按需常驻',
      'panelManaged': '托管授权',
      'panelEnabled': '已开启',
      'panelDisabled': '未开启',
      'panelActive': '活动通道',
      'panelEmpty': '尚未保存通道。添加通道后可独立启动，无需先创建 SSH 机器。',
      'panelStarting': '启动中…',
      'panelClosing': '正在关闭…',
      'panelRecovering': '恢复中…（自动重连，失败预算有限）',
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
      'tunnelAdvanced': 'CLI 高级设置',
      'tunnelTechnical': '环境详情',
      'panelNoEvents': '暂无通道事件',
      'sessionStatusReady': 'Dev Tunnel 隧道就绪',
      'sessionStatusStarting': 'Dev Tunnel 连接中',
      'sessionStatusRecovering': 'Dev Tunnel 恢复中',
      'sessionStatusStopping': 'Dev Tunnel 断开中',
      'sessionStatusError': 'Dev Tunnel 连接失败',
      'sessionStatusStopped': 'Dev Tunnel 未启动',
      'sessionStatusExternal': 'Dev Tunnel 外部管理（未验证）',
      'sessionSshConnected': 'SSH 已连接',
      'sessionSshDisconnected': 'SSH 未连接',
      'sessionSshUnknown': 'SSH 状态未知',
      'sessionStatusMissing': 'Dev Tunnel 通道缺失',
      'sessionStatusUnavailable': 'Dev Tunnel 状态未知',
      'tunnelDetails': '查看检查详情',
      'tunnelGlobal': '连接设置',
      'tunnelHelp': 'CLI 默认从宿主 PATH 查找。更改设置会停止活动通道，检查操作需单独确认。',
      'tunnelCli': 'CLI 路径覆盖（可选）',
      'tunnelCliPlaceholder': '留空：自动查找宿主 PATH 中的 devtunnel',
      'tunnelResolved': 'CLI · {source}',
      'tunnelNotFound': '未找到可执行的 devtunnel（来源：{source}）。设置 API 正常；请检查宿主 PATH 或指定绝对路径覆盖。保存仍可进行，预检暂不可用。',
      'tunnelEnabled': '授权托管连接',
      'tunnelResident': '常驻通道（全局单通道）',
      'tunnelResidentMode': '常驻模式',
      'tunnelResidentOff': '关闭',
      'tunnelResidentImmediate': '立即启动（immediate）',
      'tunnelResidentLazy': '按需启动（lazy）',
      'tunnelResidentId': '常驻 Tunnel ID',
      'tunnelResidentPort': '远端端口',
      'tunnelMeta': '来源：{source} · revision {revision} · 活动托管连接：{count}',
      'tunnelSave': '保存设置',
      'tunnelRefresh': '刷新设置',
      'tunnelProbe': '检查 CLI 版本',
      'tunnelLoginProbe': '检查登录状态',
      'tunnelDirty': '有未保存修改：请先保存，再预检。',
      'tunnelInvalid': '请输入宿主上的 POSIX CLI 绝对路径，或留空自动查找 PATH。',
    },
    en: {
      'channelFromMachine': 'Existing config',
      'channelQuickStart': 'Start channel',
      'channelReady': 'Channel ready',
      'channelQuickConfirm': 'Start Dev Tunnel for {tunnel}:{port}? A missing channel will be created first. SSH will not be connected.',
      'channelQuickStarted': 'Channel start requested. Check its status in the channel list.',

      'panelUnauthorized': 'Managed access disabled',
      'panelAuthorized': 'Managed access enabled',
      'panelActiveCount': '{count} running',
      'channelList': 'Channels',
      'channelEmptyTitle': 'No channels yet',
      'channelSelect': 'Select channel',
      'channelSelectHint': 'Select a saved channel or start one from an existing machine configuration. Disconnecting SSH keeps the channel running.',
      'channelName': 'Channel name',
      'channelAdd': 'Add channel',
      'channelEdit': 'Edit',
      'channelDelete': 'Delete',
      'channelStart': 'Start',
      'channelStop': 'Stop',
      'channelRestart': 'Restart',
      'channelSave': 'Save channel',
      'channelCancel': 'Cancel',
      'channelConfirm': 'Perform “{action}” on this channel? Stopping, restarting, editing or deleting invalidates all SSH connections using it.',
      'channelRefs': 'SSH references: {count}',
      'channelStopped': 'Stopped',
      'channelError': 'Connection failed',
      'channelExternal': 'Externally managed (registered only)',
      'channelEmpty': 'Add and start a channel to connect an SSH machine.',
      'channelFailure': 'Operation failed: {code}. Refresh the list before retrying.',

      'carrierUnavailableHint': 'Dev Tunnel SSH unavailable: enable workspace support and register the Dev Tunnel carrier on the host.',
      'carrierHint': 'Experimental SSH carrier. Confirm the remote SSH SHA256 fingerprint out of band; no TOFU or passwords. Start the external Dev Tunnel loopback listener yourself before connecting.',
      'carrierMode': 'Channel mode',
      'carrierExternal': 'External listener',
      'carrierManaged': 'Managed connection',
      'carrierManagedHint': 'Select a saved channel or start one from an existing machine configuration. Disconnecting SSH keeps the channel running.',
      'carrierManagedUnavailable': 'Managed mode unavailable: enable managed connections and ensure the host PATH or optional override resolves the CLI in the global settings on this page. Saving or viewing settings does not start the CLI.',
      'carrierTunnelId': 'Tunnel ID',
      'channelRetarget': 'Change channel',
      'channelRetargetHint': 'Only for a new tunnel to the same remote machine. Keeps the SSH fingerprint and workspace directories; affects every workspace using this machine. Save other edits first.',
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
      'panelTitle': 'Dev Tunnel',
      'panelHint': 'Manage connection channels for your SSH machines.',
      'panelResident': 'Resident tunnel',
      'panelResidentOff': 'disabled (configure in global settings)',
      'panelResidentStarting': 'starting',
      'panelResidentBlocked': 'blocked (explicit action required)',
      'panelResidentExhausted': 'retries exhausted',
      'panelResidentImmediate': 'immediate',
      'panelResidentLazy': 'on-demand',
      'panelManaged': 'Managed authorization',
      'panelEnabled': 'enabled',
      'panelDisabled': 'off',
      'panelActive': 'Active channels',
      'panelEmpty': 'No saved channels. Add and start a channel independently of SSH machines.',
      'panelStarting': 'starting…',
      'panelClosing': 'closing…',
      'panelRecovering': 'recovering… (bounded auto-restart)',
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
      'tunnelAdvanced': 'Advanced CLI settings',
      'tunnelTechnical': 'Environment details',
      'panelNoEvents': 'No channel events',
      'sessionStatusReady': 'Dev Tunnel ready',
      'sessionStatusStarting': 'Dev Tunnel starting…',
      'sessionStatusRecovering': 'Dev Tunnel recovering…',
      'sessionStatusStopping': 'Dev Tunnel closing…',
      'sessionStatusError': 'Dev Tunnel failed',
      'sessionStatusStopped': 'Dev Tunnel stopped',
      'sessionStatusExternal': 'Dev Tunnel external (unverified)',
      'sessionSshConnected': 'SSH connected',
      'sessionSshDisconnected': 'SSH disconnected',
      'sessionSshUnknown': 'SSH state unknown',
      'sessionStatusMissing': 'Dev Tunnel channel missing',
      'sessionStatusUnavailable': 'Dev Tunnel unknown',
      'tunnelDetails': 'View check details',
      'tunnelGlobal': 'Connection settings',
      'tunnelHelp': 'The CLI is detected from the host PATH. Changing settings stops active channels; checks require confirmation.',
      'tunnelCli': 'CLI path override (optional)',
      'tunnelCliPlaceholder': 'Leave empty to find devtunnel on the DSH host PATH',
      'tunnelResolved': 'CLI · {source}',
      'tunnelNotFound': 'Executable devtunnel not found (source: {source}). The settings API is working; check the host PATH or specify an absolute path override. Saving is allowed; preflight is unavailable.',
      'tunnelEnabled': 'Authorize managed connections',
      'tunnelResident': 'Resident tunnel (single global channel)',
      'tunnelResidentMode': 'Resident mode',
      'tunnelResidentOff': 'Off',
      'tunnelResidentImmediate': 'Start now (immediate)',
      'tunnelResidentLazy': 'On demand (lazy)',
      'tunnelResidentId': 'Resident tunnel ID',
      'tunnelResidentPort': 'Remote port',
      'tunnelMeta': 'Source: {source} · revision {revision} · active managed connections: {count}',
      'tunnelSave': 'Save settings',
      'tunnelRefresh': 'Refresh settings',
      'tunnelProbe': 'Check CLI version',
      'tunnelLoginProbe': 'Check sign-in',
      'tunnelDirty': 'Unsaved changes: save before running preflight.',
      'tunnelInvalid': 'Enter a POSIX absolute CLI path on the host, or leave empty to search the PATH.',
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
        ...(source.channelId ? { channelId: source.channelId } : {}),
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
    if (entry.channelId) parts.push(`channelId=${entry.channelId}`)
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
  async function startConfiguredChannel(form, request) {
    const tunnelId = trimmed(form.tunnelId), remotePort = Number(form.remotePort)
    const channelId = form.channelId || ''
    const name = trimmed(form.name) || tunnelId
    if (!form.id || modeOf(form) !== 'managed' || !/^[a-z0-9][a-z0-9-]{0,99}(?:\.[a-z0-9]{1,20})?$/.test(tunnelId)
      || !Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) throw new Error('CHANNELS_REJECTED')
    const call = request || (async (method, body) => {
      const response = await fetch(CHANNELS_PATH, { method, credentials: 'same-origin', redirect: 'error',
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
      const data = await response.json()
      if (!response.ok || data.ok !== true) throw new Error(data.error || 'CHANNELS_UNAVAILABLE')
      return data
    })
    let catalog = await call('GET')
    if (!catalog || catalog.ok !== true || !catalog.enabled || !Number.isSafeInteger(catalog.catalogRevision)
      || !Array.isArray(catalog.channels)) throw new Error('CHANNELS_UNAVAILABLE')
    let channel = channelId ? catalog.channels.find(c => c.channelId === channelId)
      : catalog.channels.find(c => c.tunnelId === tunnelId && c.remotePort === remotePort)
    if (channelId && !channel) throw new Error('CHANNEL_NOT_FOUND')
    if (channel && (channel.mode !== 'managed' || channel.tunnelId !== tunnelId || channel.remotePort !== remotePort))
      throw new Error('CHANNEL_TARGET_CHANGED')
    if (!channel) {
      catalog = await call('POST', { action: 'create', channelId: '', revision: catalog.catalogRevision, confirmed: true,
        channel: { name, mode: 'managed', tunnelId, remotePort } })
      channel = catalog.channels?.find(c => c.channelId === catalog.channelId)
      if (!channel || !Number.isSafeInteger(catalog.catalogRevision)) throw new Error('CHANNELS_UNAVAILABLE')
    }
    if (!['ready', 'starting'].includes(channel.state)) {
      await call('POST', { action: 'start', channelId: channel.channelId, revision: catalog.catalogRevision, confirmed: true })
    }
    return channel.channelId
  }

  function useChannelFeed(logEvents = true) {
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
                try { if (logEvents) console.warn(`[dsh-devtunnel-ssh] ${formatEntry(entry)}`) } catch { /* console unavailable */ }
              }
              setFeed(data)
            })
            .catch(() => { if (live) setError('panelErrorUnavailable') })
        } catch { /* best effort */ }
      }
      pullRef.current = pull
      pull()
      const timer = setInterval(pull, 3000)
      return () => { live = false; clearInterval(timer) }
    }, [])
    return { feed, error, refresh: () => { try { pullRef.current() } catch { /* best effort */ } } }
  }

  // New Chat hides conversation chrome. This root overlay uses the actual
  // mounted Session (never a global-current machine or a fabricated Session).
  const FALLBACK_OWN = '[data-dvt-status-fallback]'
  function statusFallbackPosition() {
    if (typeof document.querySelectorAll !== 'function') return undefined
    if (Array.from(document.querySelectorAll('[data-dvt-status-entry]')).some(e => !e.closest(FALLBACK_OWN))) return undefined
    const anchors = Array.from(document.querySelectorAll('[data-sidebar-right-expand], [data-sidebar-right-toggle]'))
    const rect = anchors.map(e => e.getBoundingClientRect()).find(r => r.width >= 4 && r.height >= 4)
    if (!rect) return undefined
    const top = Math.max(4, rect.top + (rect.height - 28) / 2)
    if (top + 28 > window.innerHeight - 4) return undefined
    const controls = Array.from(document.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="tab"], [role="menuitem"], [role="link"], [data-dsh-dock-fallback], [data-dsh-bottom-toggle], [data-dsew-resume-fallback], [data-dsh-editor-workbench="resume"]')).filter(e => !e.closest(FALLBACK_OWN))
    for (let left = Math.min(rect.left - 36, window.innerWidth - 32); left >= 4; left -= 4) {
      const occupied = controls.some(e => {
        const box = e.getBoundingClientRect()
        return box.width > 4 && box.height > 4 && left < box.right + 4 && left + 28 > box.left - 4 && top < box.bottom + 4 && top + 28 > box.top - 4
      })
      const hit = typeof document.elementsFromPoint === 'function' && [2, 8, 14, 20, 26].some(dx => [2, 14, 26].some(dy => document.elementsFromPoint(left + dx, top + dy).some(e => {
        if (e.closest(FALLBACK_OWN) || e === document.body || e === document.documentElement) return false
        const box = e.getBoundingClientRect(), background = window.getComputedStyle(e).backgroundColor
        return box.width <= 300 && box.height > 0 && background !== '' && background !== 'transparent' && background !== 'rgba(0, 0, 0, 0)'
      })))
      if (!occupied && !hit) return { top, left }
    }
    return undefined // No safe seat: don't cover somebody else's controls.
  }
  function createStatusFallback(mounted) {
    const subscribe = mounted && typeof mounted.subscribe === 'function' ? mounted.subscribe : undefined
    const getSnapshot = mounted && typeof mounted.getSnapshot === 'function' ? mounted.getSnapshot : undefined
    return function StatusFallback(props) {
      const [sessionId, setSessionId] = React.useState(() => typeof getSnapshot === 'function' ? getSnapshot() : undefined)
      const panel = typeof props.usePanelInfo === 'function' ? props.usePanelInfo(s => s.activePanelId) : null
      const [position, setPosition] = React.useState(statusFallbackPosition)
      const presenceRef = React.useRef(false)
      const [show, setShow] = React.useState(false)
      React.useEffect(() => {
        if (typeof subscribe !== 'function' || typeof getSnapshot !== 'function') return undefined
        return subscribe(() => setSessionId(getSnapshot()))
      }, [])
      React.useEffect(() => { setShow(presenceRef.current) })
      React.useEffect(() => {
        if (typeof window === 'undefined' || typeof document === 'undefined') return undefined
        const update = () => setPosition(previous => {
          const next = statusFallbackPosition()
          return previous?.left === next?.left && previous?.top === next?.top ? previous : next
        })
        const observer = typeof window.MutationObserver === 'function' ? new window.MutationObserver(update) : null
        if (observer) observer.observe(document.body, { childList: true, subtree: true, attributes: true })
        window.addEventListener('resize', update)
        const timer = setInterval(update, 500)
        update()
        return () => { observer && observer.disconnect(); window.removeEventListener('resize', update); clearInterval(timer) }
      }, [])
      // No invented Session: without a mounted one the status has nothing real
      // to show (it is bound to the on-screen Session's workspace). The
      // wrapper stays transparent and pointer-transparent until the status
      // entry really renders (presenceRef), so a non-devtunnel workspace
      // never even looks occupied.
      if (!sessionId || panel || !position) return null
      // Host-provided ReactDOM: classic client has no bundled React/ReactDOM.
      return require('react-dom').createPortal(h('span',
        { 'data-dvt-status-fallback': '',
          style: { position: 'fixed', zIndex: 40, ...position, width: 28, height: 28, display: 'inline-flex',
            WebkitAppRegion: 'no-drag', pointerEvents: show ? 'auto' : 'none' } },
        h(SessionDevTunnelStatus, { ...props, sessionId, compact: true, presenceRef })), document.body)
    }
  }

  // ── session header Dev Tunnel status marker ─────────────────────────────
  // The conversation header renders this chip only for a Dev Tunnel (carrier)
  // workspace. Resolution is read-only, same-origin and composed from the
  // platform's own client-safe GET routes:
  //   session/cwd → /dsh-remote/status.connection → stable connection identity + SSH state
  //   carrierTarget → /dsh-devtunnel-ssh/channels → independently observed tunnel state
  // Old hosts without connection use resolve-mirror + machines, never Git markers.
  // Polling is read-only; explicit menu actions use the confirmed channels route.

  /** Bounded projection of workspace → devtunnel status; null = not a devtunnel workspace. */
  function resolveSessionDevTunnelStatus(workspaceMachine, machines, channels) {
    if (!workspaceMachine || workspaceMachine.mode !== 'remote' || !workspaceMachine.machineId) return null
    const machine = Array.isArray(machines)
      ? machines.find(m => m && typeof m.id === 'string' && m.id === workspaceMachine.machineId) : null
    const connector = machine && machine.connector
    if (!connector || connector.kind !== 'devtunnel') return null
    const tunnelId = trimmed(connector.tunnelId)
    const remotePort = Number(connector.remotePort)
    if (!/^[a-z0-9][a-z0-9-]{0,99}(?:\.[a-z0-9]{1,20})?$/.test(tunnelId)
      || !Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) return null
    const base = { tunnelId, remotePort }
    if (connector.mode === 'external') {
      const endpoint = connector.endpoint || null
      if (!endpoint || !['127.0.0.1', '::1'].includes(endpoint.host)
        || !Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535) return null
      return { ...base, state: 'external', code: null, name: null, endpoint: { host: endpoint.host, port: endpoint.port } }
    }
    if (connector.mode !== 'managed') return null
    if (!Array.isArray(channels)) return { ...base, state: 'unavailable', code: 'CHANNELS_UNAVAILABLE', name: null, endpoint: null }
    const rows = channels
    const row = connector.channelId ? rows.find(c => c && c.channelId === connector.channelId)
      : rows.find(c => c && c.mode !== 'external' && c.tunnelId === tunnelId && c.remotePort === remotePort)
    if (row && ((row.tunnelId !== undefined && row.tunnelId !== tunnelId)
      || (row.remotePort !== undefined && row.remotePort !== remotePort) || row.mode === 'external')) {
      return { ...base, state: 'unavailable', code: 'CHANNEL_TARGET_CHANGED', name: null, endpoint: null }
    }
    if (!row || typeof row.state !== 'string' || !row.state) {
      return { ...base, state: 'missing', code: 'CHANNEL_NOT_FOUND', name: null, endpoint: null }
    }
    const endpoint = row.endpoint && ['127.0.0.1', '::1'].includes(row.endpoint.host)
      && Number.isInteger(row.endpoint.port) && row.endpoint.port >= 1 && row.endpoint.port <= 65535
      ? { host: row.endpoint.host, port: row.endpoint.port } : null
    return { ...base, state: row.state, code: typeof row.error === 'string' ? row.error : null,
      name: typeof row.name === 'string' && row.name ? row.name : null, endpoint }
  }

  /** Specialize the producer-owned connection contract; SSH state is not tunnel readiness. */
  function specializeDevTunnelConnection(connection, channels) {
    if (!connection || connection.schemaVersion !== 1 || connection.scope !== 'workspace'
      || connection.binding !== 'bound' || connection.protocol !== 'ssh'
      || connection.path !== 'carrier' || connection.carrierKind !== 'devtunnel'
      || !connection.machineId || !connection.carrierTarget) return null
    const connector = { ...connection.carrierTarget, kind: 'devtunnel', mode: connection.mode }
    // Reuse validated channel matching without changing persistence identity.
    const result = resolveSessionDevTunnelStatus({ mode: 'remote', machineId: connection.machineId },
      [{ id: connection.machineId, connector }], channels)
    if (!result) return null
    return { ...result, machineId: connection.machineId,
      sshState: ['connected', 'disconnected', 'unknown'].includes(connection.ssh?.state) ? connection.ssh.state : 'unknown' }
  }

  const SESSION_TAG_CSS = `
.dvt-session-tag{display:inline-flex;align-items:center;gap:7px;margin-right:6px;padding:5px 9px;border:1px solid transparent;border-radius:7px;background:transparent;color:inherit;font:inherit;font-size:12px;line-height:20px;white-space:nowrap;cursor:pointer;-webkit-app-region:no-drag;transition:background .14s ease,border-color .14s ease}
.dvt-session-tag-compact{box-sizing:border-box;width:28px;height:28px;margin:0;padding:0;justify-content:center;gap:3px}
.dvt-session-tag-compact>span{width:5px!important;height:5px!important}
.dvt-session-tag:not(.dvt-session-tag-static):hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12));border-color:color-mix(in srgb,currentColor 12%,transparent)}
.dvt-session-tag-static{cursor:default}
.dvt-session-tag:not(.dvt-session-tag-static):active,.dvt-session-tag[aria-expanded=true]{background:color-mix(in srgb,currentColor 12%,transparent);border-color:color-mix(in srgb,currentColor 18%,transparent)}
.dvt-session-tag:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:2px}
.dvt-session-tag .dvt-tag-chevron{opacity:.45;transition:transform .14s ease}
.dvt-session-tag[aria-expanded=true] .dvt-tag-chevron{transform:rotate(180deg)}
.dvt-session-menu{width:288px!important;min-width:224px!important;max-width:calc(100vw - 24px)!important;padding:5px!important}
.dvt-session-menu [role=menuitem]{box-sizing:border-box;height:28px;min-height:28px;padding:3px 8px;font-size:12px;line-height:18px;border-radius:5px;transition:background .12s ease}
.dvt-session-menu [role=presentation]{padding-top:0;padding-bottom:0}
.dvt-session-menu [role=separator]{margin:4px 3px}
.dvt-session-menu [role=menuitem]:not(:disabled):hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
.dvt-session-details{display:flex;flex-direction:column;gap:2px;padding:5px 2px;white-space:normal;overflow-wrap:anywhere}
.dvt-session-details strong{font-size:12px;line-height:18px;color:var(--dsw-alias-text-primary,inherit);font-weight:600}
.dvt-session-details code{font:11px/16px ui-monospace,SFMono-Regular,Menlo,monospace;opacity:.75}
.dvt-session-details .dvt-session-state{font-size:11px;line-height:16px;opacity:.8}
@media(prefers-reduced-motion:reduce){.dvt-session-tag,.dvt-session-tag .dvt-tag-chevron,.dvt-session-menu [role=menuitem]{transition:none}}
`
  function sessionActionIcon(kind) {
    const paths = { start: 'M6 3l9 5-9 5z', stop: 'M4 4h8v8H4z',
      restart: 'M13 6a5 5 0 1 0 0 5M13 2v4H9', refresh: 'M13 6a5 5 0 1 0 0 5M13 2v4H9', chevron: 'M4 6l4 4 4-4' }
    return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
      strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      ...(kind === 'chevron' ? { className: 'dvt-tag-chevron' } : {}) }, h('path', { d: paths[kind] }))
  }

  function actionableTunnelStatus(status, connector, feed) {
    if (!status) return null
    const row = connector?.channelId ? feed?.channels?.find(c => c.channelId === connector.channelId)
      : feed?.channels?.find(c => c.mode === 'managed' && c.tunnelId === status.tunnelId && c.remotePort === status.remotePort)
    return { ...status, mode: connector?.mode, channelId: connector?.channelId || row?.channelId || '',
      catalogRevision: Number.isSafeInteger(feed?.catalogRevision) ? feed.catalogRevision : null,
      managedEnabled: feed?.enabled === true }
  }

  /** Prefer the shared connection contract; legacy fallback is explicit, metadata-only. */
  async function pullSessionDevTunnelStatus(cwd, request, sessionId) {
    try {
      const call = typeof request === 'function' ? request : (async url => {
        const response = await fetch(url, { method: 'GET', credentials: 'same-origin', redirect: 'error' })
        if (!response || !response.ok) throw new Error('HTTP ' + (response ? response.status : 'ERR'))
        return response.json()
      })
      let shared
      try {
        shared = await call(CONNECTION_STATUS_PATH + '?cwd=' + encodeURIComponent(cwd)
          + (sessionId ? '&sessionId=' + encodeURIComponent(sessionId) : ''))
      } catch { /* old hosts may not expose the connection summary */ }
      if (shared && Object.prototype.hasOwnProperty.call(shared, 'connection')) {
        const identified = specializeDevTunnelConnection(shared.connection, undefined)
        if (!identified || identified.state === 'external') return actionableTunnelStatus(identified, { ...shared.connection?.carrierTarget, mode: shared.connection?.mode })
        try {
          const feed = await call(CHANNELS_PATH)
          return actionableTunnelStatus(specializeDevTunnelConnection(shared.connection,
            feed && feed.ok === true && Array.isArray(feed.channels) ? feed.channels : undefined),
            { ...shared.connection.carrierTarget, mode: shared.connection.mode }, feed)
        } catch { return actionableTunnelStatus(identified, { ...shared.connection.carrierTarget, mode: shared.connection.mode }) }
      }
      const workspace = await call(WORKSPACE_STATUS_PATH + '?local=' + encodeURIComponent(cwd))
      // resolve-mirror is a metadata-only read: no Git probe, SSH dial or global-current fallback.
      if (!workspace || workspace.mode !== 'remote' || !workspace.machineId) return null
      const machines = await call(MACHINES_PATH)
      if (!machines || !Array.isArray(machines.machines)) return null
      const connector = machines.machines.find(m => m.id === workspace.machineId)?.connector
      const identified = resolveSessionDevTunnelStatus(workspace, machines.machines, undefined)
      if (!identified || identified.state === 'external') return actionableTunnelStatus(identified, connector)
      try {
        const channels = await call(CHANNELS_PATH)
        return actionableTunnelStatus(resolveSessionDevTunnelStatus(workspace, machines.machines,
          channels && channels.ok === true && Array.isArray(channels.channels) ? channels.channels : undefined), connector, channels)
      } catch { return actionableTunnelStatus(identified, connector) }
    } catch { return null }
  }

  // One shared catalog request for all visible machine chips; never cache errors.
  let machineFeedPending = null
  let machineFeedCache = null
  let machineFeedAt = 0
  async function machineChannelFeed() {
    if (machineFeedPending) return machineFeedPending
    if (machineFeedCache && Date.now() - machineFeedAt < 1000) return machineFeedCache
    machineFeedPending = fetch(CHANNELS_PATH, { method: 'GET', credentials: 'same-origin', redirect: 'error' })
      .then(async response => {
        const data = await response.json()
        if (!response.ok || data?.ok !== true || !Array.isArray(data.channels)) throw new Error('CHANNELS_UNAVAILABLE')
        machineFeedCache = data; machineFeedAt = Date.now(); return data
      }).catch(error => { machineFeedCache = null; throw error }).finally(() => { machineFeedPending = null })
    return machineFeedPending
  }
  function machineTunnelStatus(machine, feed) {
    const resolved = resolveSessionDevTunnelStatus({ mode: 'remote', machineId: machine?.id }, [machine], feed?.channels)
    return actionableTunnelStatus(resolved, machine?.connector, feed)
  }
  async function pullMachineTunnelStatus(machine) {
    const identified = machineTunnelStatus(machine)
    if (!identified || identified.state === 'external') return identified
    try { return machineTunnelStatus(machine, await machineChannelFeed()) } catch { return identified }
  }
  async function runMachineTunnelAction(action, expected, machine, request, confirm, isCurrent = () => true) {
    const resolve = async call => {
      const records = await call(MACHINES_PATH, { method: 'GET' })
      const current = records?.machines?.find(m => m.id === machine.id)
      if (!current || canonicalJson(current.connector) !== canonicalJson(machine.connector)) throw new Error('CHANNEL_TARGET_CHANGED')
      const feed = await call(CHANNELS_PATH, { method: 'GET' })
      if (feed?.ok !== true || !Array.isArray(feed.channels)) throw new Error('CHANNELS_UNAVAILABLE')
      return machineTunnelStatus(current, feed)
    }
    try { return await runSessionTunnelAction(action, expected, '', undefined, request, confirm, isCurrent, resolve) }
    finally { machineFeedCache = null }
  }

  async function runSessionTunnelAction(action, expected, cwd, sessionId, request, confirm, isCurrent = () => true, resolve) {
    if (!['start', 'stop', 'restart'].includes(action) || !expected?.channelId || expected.mode !== 'managed') throw new Error('CHANNELS_REJECTED')
    const call = request || (async (url, options = {}) => {
      const response = await fetch(url, { credentials: 'same-origin', redirect: 'error', ...options })
      const body = await response.json()
      if (!response.ok || body?.ok === false) throw new Error(body?.error || 'CHANNELS_UNAVAILABLE')
      return body
    })
    const current = resolve ? await resolve(call) : await pullSessionDevTunnelStatus(cwd, url => call(url, { method: 'GET' }), sessionId)
    if (!current || current.channelId !== expected.channelId || current.tunnelId !== expected.tunnelId
      || current.remotePort !== expected.remotePort || current.mode !== 'managed') throw new Error('CHANNEL_TARGET_CHANGED')
    if (!current.managedEnabled || !Number.isSafeInteger(current.catalogRevision)
      || !['stopped', 'error', 'ready', 'starting', 'recovering'].includes(current.state)) throw new Error('CHANNEL_NOT_READY')
    if (action === 'start' && ['ready', 'starting', 'recovering'].includes(current.state)) return false
    if (action === 'stop' && current.state === 'stopped') return false
    if (!confirm || !await confirm(tr('channelConfirm', { action: tr({ start: 'channelStart', stop: 'channelStop', restart: 'channelRestart' }[action]) }))) return false
    if (!isCurrent()) throw new Error('CHANNEL_TARGET_CHANGED')
    await call(CHANNELS_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, channelId: current.channelId, revision: current.catalogRevision, confirmed: true }) })
    return true
  }

  /**
   * `conversation.session.header.utilities` occupant: a compact status chip
   * marking the current Dev Tunnel workspace. Renders nothing for any other
   * transport. Polls only while the header entry is mounted; every fetch is a
   * read-only same-origin GET and failures keep the previous state (or hide).
   */
  function SessionDevTunnelStatus(props) {
    const { sessionId, useSessions } = props
    const cwd = typeof useSessions === 'function'
      ? useSessions(state => (state && state.byId && sessionId !== undefined ? state.byId[sessionId]?.cwd : undefined))
      : undefined
    const [result, setResult] = React.useState(null)
    const [opened, setOpened] = React.useState(null)
    const [busy, setBusy] = React.useState(false)
    const [actionError, setActionError] = React.useState('')
    const actionLock = React.useRef(false)
    const currentOccurrence = React.useRef(null)
    const refreshRef = React.useRef(() => {})
    const tagRef = React.useRef(null)
    const getTagRect = React.useCallback(() => tagRef.current?.getBoundingClientRect() || null, [])
    const key = typeof cwd === 'string' ? cwd : ''
    const machine = props.machine
    const occurrence = machine ? canonicalJson([machine.id, machine.connector]) : JSON.stringify([sessionId, key])
    currentOccurrence.current = occurrence
    const status = result && result.occurrence === occurrence ? result.status : null
    // Presence report for the blank/hero fallback: the portal wrapper must not
    // occupy (even invisibly) while this entry has nothing real to show.
    if (props.presenceRef) props.presenceRef.current = status !== null
    React.useEffect(() => {
      props.onOpenChange?.(opened === occurrence)
      return () => props.onOpenChange?.(false)
    }, [opened, occurrence, props.onOpenChange])
    React.useEffect(() => {
      if ((!key && !machine) || typeof window === 'undefined' || typeof fetch !== 'function') { setResult(null); return undefined }
      let live = true
      let timer = null
      let pending = false
      const pull = () => {
        if (pending) return
        pending = true
        Promise.resolve().then(() => machine ? pullMachineTunnelStatus(machine) : pullSessionDevTunnelStatus(key, undefined, sessionId))
          .then(value => { if (live) setResult({ occurrence, status: value }) })
          .catch(() => { if (live) setResult({ occurrence, status: null }) })
          .finally(() => { pending = false })
      }
      refreshRef.current = pull
      pull()
      if (typeof setInterval === 'function') timer = setInterval(pull, SESSION_STATUS_POLL_MS)
      return () => {
        live = false
        if (refreshRef.current === pull) refreshRef.current = () => {}
        if (currentOccurrence.current === occurrence) currentOccurrence.current = null
        if (timer !== null && typeof clearInterval === 'function') clearInterval(timer)
      }
    }, [occurrence])
    if (!status) return null
    const LABEL = { ready: 'sessionStatusReady', starting: 'sessionStatusStarting', recovering: 'sessionStatusRecovering',
      stopping: 'sessionStatusStopping', error: 'sessionStatusError', stopped: 'sessionStatusStopped',
      external: 'sessionStatusExternal', missing: 'sessionStatusMissing', unavailable: 'sessionStatusUnavailable' }
    const DOT = { ready: '#22c55e', starting: '#f59e0b', recovering: '#f59e0b', stopping: '#94a3b8',
      error: '#dc2626', stopped: '#94a3b8', external: '#3b82f6', missing: '#dc2626', unavailable: '#94a3b8' }
    const state = Object.prototype.hasOwnProperty.call(LABEL, status.state) ? status.state : 'unavailable'
    const detail = [status.name, `${status.tunnelId}:${status.remotePort}`].filter(Boolean).join(' · ')
      + (status.endpoint ? ` → ${status.endpoint.host}:${status.endpoint.port}` : '')
      + (status.code ? ` (${status.code})` : '')
    if (props.interactive === false) return h('span', {
      className: 'dvt-session-tag dvt-session-tag-static' + (props.compact ? ' dvt-session-tag-compact' : ''),
      'data-testid': 'devtunnel-machine-status', title: tr(LABEL[state]) + ' · ' + detail,
      'aria-label': tr(LABEL[state]) + ' · ' + detail },
      h('span', { 'aria-hidden': true, style: { width: 8, height: 8, borderRadius: '50%',
        background: DOT[state] || '#94a3b8', display: 'inline-block' } }),
      props.compact ? null : h('span', null, tr(LABEL[state])))
    const anchor = h('button', { type: 'button', ref: tagRef, className: 'dvt-session-tag' + (props.compact ? ' dvt-session-tag-compact' : ''), 'data-dvt-status-entry': machine ? undefined : '', 'data-testid': machine ? 'devtunnel-machine-status' : 'devtunnel-session-status', title: tr(LABEL[state]) + ' · ' + detail,
      'aria-label': tr(LABEL[state]) + ' · ' + detail,
      'aria-haspopup': 'menu', 'aria-expanded': opened === occurrence, onClick: () => {
        setActionError(''); setOpened(opened === occurrence ? null : occurrence); refreshRef.current()
      },
      'aria-busy': busy || undefined },
      h('span', { 'aria-hidden': true, style: { width: 8, height: 8, borderRadius: '50%',
        background: DOT[state] || '#94a3b8', display: 'inline-block' } }),
      props.compact ? null : h('span', null, tr(LABEL[state] || 'sessionStatusUnavailable')), props.compact ? null : sessionActionIcon('chevron'))
    const blocked = busy || props.busy || status.mode !== 'managed' || !status.channelId || !status.managedEnabled
      || !Number.isSafeInteger(status.catalogRevision) || !['stopped', 'error', 'ready', 'starting', 'recovering'].includes(state)
    const items = [
      { type: 'label', id: 'target', text: h('div', { className: 'dvt-session-details' },
        h('strong', null, status.name || 'Dev Tunnel'),
        h('code', null, `${status.tunnelId}:${status.remotePort}`),
        status.endpoint ? h('code', null, `→ ${status.endpoint.host}:${status.endpoint.port}`) : null,
        h('span', { className: 'dvt-session-state' }, tr(LABEL[state])),
        status.code ? h('code', null, status.code) : null) },
      { type: 'separator', id: 'actions' },
      { id: 'start', label: tr('channelStart'), icon: sessionActionIcon('start'), disabled: blocked || ['ready', 'starting', 'recovering'].includes(state) },
      { id: 'restart', label: tr('channelRestart'), icon: sessionActionIcon('restart'), disabled: blocked },
      { id: 'stop', label: tr('channelStop'), icon: sessionActionIcon('stop'), disabled: blocked || state === 'stopped', danger: true },
      { id: 'refresh', label: tr('panelRefresh'), icon: sessionActionIcon('refresh'), disabled: busy },
      ...(actionError && opened === occurrence ? [{ type: 'label', id: 'error', text: actionError }] : []),
    ]
    const select = async action => {
      if (action === 'refresh') { refreshRef.current(); return }
      if (actionLock.current || items.find(item => item.id === action)?.disabled) return
      actionLock.current = true; setBusy(true); setActionError('')
      try {
        const confirm = message => typeof window.confirm === 'function' && window.confirm(message)
        const isCurrent = () => currentOccurrence.current === occurrence
        if (machine) await runMachineTunnelAction(action, status, machine, undefined, confirm, isCurrent)
        else await runSessionTunnelAction(action, status, key, sessionId, undefined, confirm, isCurrent)
      } catch (error) {
        if (currentOccurrence.current === occurrence) setActionError(tr('channelFailure', {
          code: /^[A-Z_]+$/.test(error?.message) ? error.message : 'CHANNELS_UNAVAILABLE' }))
      } finally {
        actionLock.current = false; setBusy(false)
        if (currentOccurrence.current === occurrence) refreshRef.current()
      }
    }
    return h(Menu, { open: opened === occurrence, anchor, items, onSelect: select,
      onClose: () => setOpened(null), portal: true, align: 'start', side: 'bottom', autoFocus: true,
      compact: true, dense: true, listClassName: 'dvt-session-menu', getAnchorRect: getTagRect })
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
    const { feed: channelFeed, error: channelFeedError, refresh: refreshChannels } = useChannelFeed(false)
    const channelOptions = channelFeed?.channels || []
    const form = props.form || {}
    const carrier = props.carrier || {}
    const locked = !!props.locked
    const busy = !!props.busy
    const mode = modeOf(form) === 'managed' ? 'managed' : 'external'
    const ready = carrierReady(props.status)
    const managedReady = managedAvailable(props.status)
    const patch = typeof props.patch === 'function' ? props.patch : () => {}
    const [retargeting, setRetargeting] = React.useState(false)
    const retargetLock = React.useRef(false)
    const [channelStarting, setChannelStarting] = React.useState(false)
    const [channelFeedback, setChannelFeedback] = React.useState(null)
    const startLock = React.useRef(false)
    const matchedChannel = form.channelId ? channelOptions.find(c => c.channelId === form.channelId)
      : channelOptions.find(c => c.mode === mode && c.tunnelId === trimmed(form.tunnelId) && c.remotePort === Number(form.remotePort))
    const channelRunning = matchedChannel && ['ready', 'starting'].includes(matchedChannel.state)
    const startFromMachine = async () => {
      if (startLock.current || busy || !managedReady || !form.id || mode !== 'managed') return
      if (typeof window.confirm !== 'function' || !window.confirm(tr('channelQuickConfirm', {
        tunnel: trimmed(form.tunnelId), port: Number(form.remotePort),
      }))) return
      startLock.current = true; setChannelStarting(true); setChannelFeedback(null)
      try {
        await startConfiguredChannel({ id: form.id, name: form.name, carrierMode: mode, channelId: form.channelId,
          tunnelId: form.tunnelId, remotePort: form.remotePort })
        setChannelFeedback({ error: false, text: tr('channelQuickStarted') })
      } catch (e) {
        setChannelFeedback({ error: true, text: tr('channelFailure', { code: /^[A-Z_]+$/.test(e.message) ? e.message : 'CHANNELS_UNAVAILABLE' }) })
      } finally { startLock.current = false; setChannelStarting(false); refreshChannels() }
    }


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
    const valid = devTunnelValid(form, props.status) && (mode !== 'managed' || !!form.id || !!form.channelId)
    const published = React.useRef('')
    const draftKey = canonicalJson(body) + '|' + (valid ? '1' : '0')
    React.useEffect(() => {
      if (published.current === draftKey) return
      published.current = draftKey
      if (typeof carrier.publish === 'function') carrier.publish({ valid, body })
    })

    const setField = key => event => patch({ [key]: event.target.value })

    const modeButton = (target, label, enabled, hint) => h('button', {
      type: 'button',
      className: 'rws-btn' + (mode === target ? ' on' : ''),
      disabled: busy || !enabled,
      title: hint,
      onClick: () => { if (!busy && enabled) patch({ carrierMode: target, channelId: '' }) },
    }, label)

    const mirrorPath = typeof carrier.mirrorPath === 'string' ? carrier.mirrorPath : ''
    const dirty = carrier.dirty !== false
    const mirrorDisabled = busy || !ready || !valid || !form.id || !props.scopeDir || !mirrorPath.trim() || dirty
    const selectedChannelId = form.channelId || matchedChannel?.channelId || ''
    const selectionDisabled = busy || channelStarting || retargeting || !!channelFeedError || !ready || (locked && dirty)
    const sameTarget = channel => trimmed(channel.tunnelId) === trimmed(form.tunnelId)
      && Number(channel.remotePort) === Number(form.remotePort)
    const channelDisabled = channel => (channel.mode === 'managed' ? !managedReady : channel.mode !== 'external')
      || (locked && !sameTarget(channel) && (!form.id || typeof carrier.retarget !== 'function'))
    const selectChannel = async event => {
      const requestedId = event.target.value
      // A native select changes its DOM value before onChange. Restore it now:
      // cancel/failure (and even success until owner hydrate) must not drift.
      event.target.value = selectedChannelId
      if (selectionDisabled || retargetLock.current) return
      const channel = channelOptions.find(c => c.channelId === requestedId)
      if (!channel) {
        if (!locked && requestedId === '') patch({ channelId: '' })
        return
      }
      if (channelDisabled(channel)) return
      if (locked && !sameTarget(channel)) {
        retargetLock.current = true; setRetargeting(true)
        try {
          await carrier.retarget({ kind: 'devtunnel', mode: channel.mode, channelId: channel.channelId,
            tunnelId: trimmed(channel.tunnelId), remotePort: Number(channel.remotePort),
            ...(channel.mode === 'external' ? { endpoint: { ...channel.endpoint } } : {}) })
        } catch { /* owner reports errors; never fall back to ordinary patch */ }
        finally { retargetLock.current = false; setRetargeting(false) }
        return
      }
      patch({ channelId: channel.channelId, carrierMode: channel.mode, tunnelId: trimmed(channel.tunnelId),
        remotePort: String(channel.remotePort), ...(channel.mode === 'external' ? {
          localHost: channel.endpoint.host, localPort: String(channel.endpoint.port) } : {}) })
    }

    return h(React.Fragment, null,
      row(tr('carrierMode'), h('div', { style: { display: 'flex', gap: 4 } },
        modeButton('external', tr('carrierExternal'), ready, tr('carrierHint')),
        modeButton('managed', tr('carrierManaged'), managedReady, tr('carrierManagedHint'))), 'cmode'),
      h('div', { style: { ...NOTE, color: 'inherit' } }, tr(mode === 'managed' ? 'carrierManagedHint' : 'carrierHint')),
      managedReady ? null : h('div', { style: { ...NOTE, opacity: 0.7 } }, tr('carrierManagedUnavailable')),
      row(tr('channelSelect'), h('select', { className: 'rws-input', value: selectedChannelId,
        disabled: selectionDisabled, onFocus: refreshChannels, onMouseDown: refreshChannels,
        onChange: selectChannel }, h('option', { value: '', disabled: locked }, tr('channelSelect')),
        selectedChannelId && !channelOptions.some(c => c.channelId === selectedChannelId)
          ? h('option', { value: selectedChannelId }, selectedChannelId) : null,
        channelOptions.map(c => h('option', { key: c.channelId, value: c.channelId, disabled: channelDisabled(c) },
          `${c.name} · ${c.tunnelId}:${c.remotePort} · ${c.state}`))), 'channel'),
      locked && typeof carrier.retarget === 'function'
        ? h('div', { style: NOTE }, tr('channelRetargetHint')) : null,
      locked && form.id && mode === 'managed' ? row(tr('channelFromMachine'),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' } },
          h('button', { type: 'button', className: 'rws-btn',
            disabled: busy || channelStarting || !managedReady || !!channelRunning,
            onClick: startFromMachine }, tr(channelStarting || matchedChannel?.state === 'starting' ? 'panelStarting'
              : matchedChannel?.state === 'ready' ? 'channelReady' : 'channelQuickStart')),
          channelFeedback ? h('div', { role: channelFeedback.error ? 'alert' : 'status', style: NOTE }, channelFeedback.text) : null), 'channel-start') : null,
      row(tr('user'), textInput({ value: form.username || '', onChange: setField('username') }), 'cu'),
      row(tr('carrierTunnelId'), textInput({ value: form.tunnelId || '', onChange: setField('tunnelId'), disabled: locked || !!form.channelId }), 'ctid'),
      row(tr('carrierRemotePort'), textInput({ value: form.remotePort || '', onChange: setField('remotePort'), disabled: locked || !!form.channelId }), 'crp'),
      mode === 'managed' ? null : row(tr('carrierLocalPort'), textInput({ value: form.localPort || '', onChange: setField('localPort'), disabled: !!form.channelId }), 'clp'),
      row(tr('carrierFingerprint'), textInput({
        value: form.expectedHostFingerprint || '', onChange: setField('expectedHostFingerprint'),
        disabled: locked, placeholder: 'SHA256:… (required, confirmed)',
      }), 'cfp'),
      h('div', { key: 'ca', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, padding: '16px 0' } },
        h('div', null,
          h('div', { style: { fontSize: 14, lineHeight: '20px' } }, 'SSH agent'),
          h('div', { style: { fontSize: 12, lineHeight: '18px', marginTop: 4, opacity: 0.75 } }, 'SSH_AUTH_SOCK')),
        h(Switch, { checked: !!form.useAgent, disabled: busy, label: tr('agent'), onChange: next => {
          if (busy) return
          if (typeof props.setChecked === 'function') props.setChecked('useAgent', next)
          else patch({ useAgent: next })
        } })),
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
   * Dev Tunnel box — global settings (CLI path / managed authorization /
   * resident channel), live channels, retry/blocked state and recent events.
   * The settings state machine is the owner's `useTunnelSettings`, passed
   * through the panel props; only the rendering and the channel feed are ours.
   * Read-only except one explicit, confirmed stop per channel.
   */
  const PANEL_CSS = `
.dvt-panel{container-type:inline-size;font-size:13px;line-height:1.55;min-width:0}
.dvt-panel *{box-sizing:border-box}
.dvt-panel .dvt-header,.dvt-panel .dvt-toolbar,.dvt-panel .dvt-actions,.dvt-panel .dvt-titleline{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dvt-panel .dvt-header{justify-content:space-between;margin-bottom:18px;gap:12px}
.dvt-panel .dvt-heading{font-size:16px;font-weight:650;letter-spacing:-.2px}
.dvt-panel .dvt-subtitle{font-size:12px;opacity:.6;margin-top:3px;line-height:1.6}
.dvt-panel .dvt-badge{display:inline-flex;align-items:center;gap:6px;border:1px solid color-mix(in srgb,currentColor 12%,transparent);border-radius:20px;padding:3px 9px;font-size:11px;font-weight:500;white-space:nowrap}
.dvt-panel .dvt-dot{width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.5}
.dvt-panel .dvt-toolbar{justify-content:space-between;margin-bottom:12px}
.dvt-panel .dvt-section-title{font-size:13px;font-weight:600}
.dvt-panel .dvt-count{opacity:.5;font-size:12px;margin-left:6px}
.dvt-panel .rws-btn{height:30px;width:auto;flex:none;padding:0 12px;font-size:12px;line-height:18px;border-radius:8px;color:inherit}
.dvt-panel .rws-btn.dvt-primary{background:color-mix(in srgb,currentColor 9%,transparent);border-color:color-mix(in srgb,currentColor 18%,transparent);font-weight:600}
.dvt-panel .rws-btn.dvt-primary>span{color:inherit}
.dvt-panel .rws-btn.dvt-primary:hover:not(:disabled){background:color-mix(in srgb,currentColor 14%,transparent)}
.dvt-panel .rws-btn.dvt-quiet{border-color:transparent;background:transparent;opacity:.7}
.dvt-panel .rws-btn:focus-visible,.dvt-panel summary:focus-visible{outline:2px solid currentColor;outline-offset:3px}
.dvt-panel .dvt-empty{padding:28px 16px;text-align:center;border:1px dashed color-mix(in srgb,currentColor 18%,transparent);border-radius:12px;background:color-mix(in srgb,currentColor 2%,transparent)}
.dvt-panel .dvt-empty-title{font-size:14px;font-weight:600;margin-bottom:5px}
.dvt-panel .dvt-empty-note{font-size:12px;opacity:.6;max-width:360px;margin:0 auto 16px}
.dvt-panel .dvt-channel{padding:14px;border:1px solid color-mix(in srgb,currentColor 12%,transparent);border-radius:10px;min-width:0}
.dvt-panel .dvt-channel+.dvt-channel{margin-top:8px}
.dvt-panel .dvt-channel-name{font-size:13px;font-weight:600;overflow-wrap:anywhere}
.dvt-panel .dvt-channel-meta{display:flex;gap:6px 16px;flex-wrap:wrap;margin-top:7px;font-size:12px;opacity:.65;overflow-wrap:anywhere}
.dvt-panel code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;overflow-wrap:anywhere;white-space:normal}
.dvt-panel .dvt-channel .dvt-actions{margin-top:12px;padding-top:10px;border-top:1px solid color-mix(in srgb,currentColor 8%,transparent)}
.dvt-panel .dvt-editor{padding:16px;margin-top:12px;border-radius:10px;background:color-mix(in srgb,currentColor 3%,transparent);border:1px solid color-mix(in srgb,currentColor 12%,transparent)}
.dvt-panel .dvt-editor-title{font-size:13px;font-weight:600;margin-bottom:14px}
.dvt-panel .dvt-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px}
.dvt-panel .dvt-field{display:flex;flex-direction:column;gap:5px;min-width:0;font-size:12px}
.dvt-panel .dvt-field>span{opacity:.7}
.dvt-panel .rws-input{width:100%;min-width:0;font-size:12px;border-radius:7px}
.dvt-panel .dvt-editor>.dvt-actions{margin-top:16px;justify-content:flex-end}
.dvt-panel .dvt-settings{border-top:1px solid color-mix(in srgb,currentColor 10%,transparent);margin-top:20px;padding-top:14px}
.dvt-panel summary{cursor:pointer;font-size:12px;line-height:1.6}
.dvt-panel .dvt-settings>summary{font-size:13px;font-weight:550}
.dvt-panel .dvt-settings-content{padding-top:14px;display:flex;flex-direction:column;gap:12px}
.dvt-panel .dvt-setting-row{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:4px 0}
.dvt-panel .dvt-help{font-size:12px;opacity:.6;line-height:1.7}
.dvt-panel .dvt-cli{padding:10px 12px;border-radius:8px;background:color-mix(in srgb,currentColor 3%,transparent);display:flex;gap:8px;flex-wrap:wrap;align-items:baseline}
.dvt-panel .dvt-cli-label{font-size:11px;opacity:.6;flex-shrink:0}
.dvt-panel .dvt-settings-actions{display:flex;gap:8px;flex-wrap:wrap;padding-top:4px}
.dvt-panel .dvt-notice{font-size:12px;padding:8px 10px;border-left:2px solid currentColor;overflow-wrap:anywhere}
.dvt-panel .dvt-events{margin-top:16px;font-size:11px;line-height:1.7}
.dvt-panel .dvt-event{padding:7px 0;border-bottom:1px solid color-mix(in srgb,currentColor 8%,transparent);overflow-wrap:anywhere;opacity:.7}
@container(max-width:480px){.dvt-panel .dvt-form-grid{grid-template-columns:1fr}.dvt-panel .dvt-header{align-items:flex-start}.dvt-panel .dvt-badge{font-size:10px}.dvt-panel .dvt-empty{padding:22px 12px}.dvt-panel .dvt-settings-actions .rws-btn{flex:1 1 auto}}
`

  function ChannelCatalog({ feed, refresh, busy }) {
    const [draft, setDraft] = React.useState(null)
    const [working, setWorking] = React.useState(false)
    const [error, setError] = React.useState('')
    const lock = React.useRef(false)
    const channels = feed?.channels || []
    const blank = () => ({ channelId: '', name: '', mode: 'managed', tunnelId: '', remotePort: 22, localHost: '127.0.0.1', localPort: 2222 })
    const edit = c => setDraft({ ...blank(), ...c, localHost: c.endpoint?.host || '127.0.0.1', localPort: c.endpoint?.port || 2222 })
    const run = async (action, c) => {
      if (lock.current || !feed || !Number.isSafeInteger(feed.catalogRevision)) return
      if (typeof window.confirm !== 'function' || !window.confirm(tr('channelConfirm', { action: tr({
        create: 'channelAdd', update: 'channelEdit', delete: 'channelDelete', start: 'channelStart', stop: 'channelStop', restart: 'channelRestart',
      }[action]) }))) return
      lock.current = true; setWorking(true); setError('')
      try {
        const body = { action, channelId: c.channelId, revision: feed.catalogRevision, confirmed: true }
        if (action === 'create' || action === 'update') body.channel = {
          name: c.name.trim(), mode: c.mode, tunnelId: c.tunnelId.trim(), remotePort: Number(c.remotePort),
          ...(c.mode === 'external' ? { endpoint: { host: c.localHost, port: Number(c.localPort) } } : {}),
        }
        const response = await fetch(CHANNELS_PATH, { method: 'POST', credentials: 'same-origin', redirect: 'error',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const data = await response.json()
        if (!response.ok || data.ok !== true) throw new Error(data.error || 'CHANNELS_UNAVAILABLE')
        if (action === 'create' || action === 'update') setDraft(null)
      } catch (e) { setError(tr('channelFailure', { code: /^[A-Z_]+$/.test(e.message) ? e.message : 'CHANNELS_UNAVAILABLE' })) }
      finally { lock.current = false; setWorking(false); refresh() }
    }
    const disabled = busy || working || !feed || !Number.isSafeInteger(feed.catalogRevision)
    const button = (label, action, c, unavailable = false) => h('button', { type: 'button',
      className: 'rws-btn' + (action === 'start' || action === 'create' || action === 'update' ? ' dvt-primary' : action === 'delete' ? ' dvt-quiet' : ''),
      disabled: disabled || unavailable, onClick: () => run(action, c) }, h('span', null, tr(label)))
    const field = (key, label, type = 'text') => h('label', { key, className: 'dvt-field' }, h('span', null, tr(label)),
      textInput({ type, value: draft[key], disabled, onChange: e => setDraft({ ...draft, [key]: e.target.value }) }))
    const addButton = () => h('button', { type: 'button', className: 'rws-btn dvt-primary', disabled,
      onClick: () => setDraft(blank()) }, h('span', null, tr('channelAdd')))
    return h('div', { 'data-testid': 'devtunnel-channel-catalog' },
      h('div', { className: 'dvt-toolbar' },
        h('div', { className: 'dvt-section-title' }, tr('channelList'), h('span', { className: 'dvt-count' }, String(channels.length))),
        channels.length && !draft ? addButton() : null),
      error ? h('div', { role: 'alert', className: 'dvt-notice' }, error) : null,
      feed && !channels.length && !draft ? h('div', { className: 'dvt-empty' },
        h('div', { className: 'dvt-empty-title' }, tr('channelEmptyTitle')),
        h('div', { className: 'dvt-empty-note' }, tr('channelEmpty')), addButton()) : null,
      channels.map(c => h('div', { key: c.channelId, className: 'dvt-channel' },
        h('div', { className: 'dvt-titleline' },
          h('span', { className: 'dvt-channel-name' }, c.name),
          h('span', { className: 'dvt-badge' }, h('span', { className: 'dvt-dot', 'aria-hidden': true }),
            c.mode === 'external' ? tr('channelExternal') : c.state === 'ready' ? tr('panelEnabled')
            : c.state === 'starting' ? tr('panelStarting') : c.state === 'recovering' ? tr('panelRecovering')
            : c.state === 'stopping' ? tr('panelClosing')
            : c.state === 'error' ? tr('channelError') : tr('channelStopped'))),
        h('div', { className: 'dvt-channel-meta' }, h('code', null, `${c.tunnelId}:${c.remotePort}`),
          c.endpoint ? h('code', null, `→ ${c.endpoint.host}:${c.endpoint.port}`) : null,
          h('span', null, tr('channelRefs', { count: c.refs || 0 }))),
        c.error ? h('code', { role: 'status', className: 'dvt-notice' }, c.error) : null,
        h('div', { className: 'dvt-actions' },
          c.mode === 'managed' ? h(React.Fragment, null,
            button('channelStart', 'start', c, !feed.enabled || ['ready', 'starting', 'stopping'].includes(c.state)),
            button('channelStop', 'stop', c, c.state === 'stopped'),
            button('channelRestart', 'restart', c, !feed.enabled || c.state === 'stopping')) : null,
          h('button', { type: 'button', className: 'rws-btn dvt-quiet', disabled, onClick: () => edit(c) }, tr('channelEdit')),
          button('channelDelete', 'delete', c)))),
      draft ? h('div', { className: 'dvt-editor' },
        h('div', { className: 'dvt-editor-title' }, tr(draft.channelId ? 'channelEdit' : 'channelAdd')),
        h('div', { className: 'dvt-form-grid' }, field('name', 'channelName'),
          h('label', { key: 'mode', className: 'dvt-field' }, h('span', null, tr('carrierMode')),
            h('select', { className: 'rws-input', value: draft.mode, disabled,
              onChange: e => setDraft({ ...draft, mode: e.target.value }) },
              h('option', { value: 'managed' }, tr('carrierManaged')), h('option', { value: 'external' }, tr('carrierExternal')))),
          field('tunnelId', 'carrierTunnelId'), field('remotePort', 'carrierRemotePort', 'number'),
          draft.mode === 'external' ? h(React.Fragment, null,
            h('label', { key: 'host', className: 'dvt-field' }, h('span', null, 'Loopback'),
              h('select', { className: 'rws-input', value: draft.localHost, disabled,
                onChange: e => setDraft({ ...draft, localHost: e.target.value }) },
                h('option', { value: '127.0.0.1' }, '127.0.0.1'), h('option', { value: '::1' }, '::1'))),
            field('localPort', 'carrierLocalPort', 'number')) : null),
        h('div', { className: 'dvt-actions' },
          h('button', { type: 'button', className: 'rws-btn dvt-quiet', disabled: working, onClick: () => setDraft(null) }, tr('channelCancel')),
          button('channelSave', draft.channelId ? 'update' : 'create', draft,
            !draft.name.trim() || !/^[a-z0-9][a-z0-9-]{0,99}(?:\.[a-z0-9]{1,20})?$/.test(draft.tunnelId.trim())
            || !Number.isInteger(Number(draft.remotePort)) || Number(draft.remotePort) < 1 || Number(draft.remotePort) > 65535
            || (draft.mode === 'external' && (!Number.isInteger(Number(draft.localPort)) || Number(draft.localPort) < 1 || Number(draft.localPort) > 65535))))) : null)
  }

  function DevTunnelPanel(props) {
    const { feed, error: feedError, refresh } = useChannelFeed()
    const recent = feed && Array.isArray(feed.recent) ? feed.recent.slice(-5).reverse() : []
    // ── global settings section (owner's useTunnelSettings via panel props) ──
    // Rendering is ours; the state machine, its confirmations and every write
    // stay with the owner. Without the tunnel props (older owner / unit rigs)
    // the section renders disabled, never silently absent.
    const tunnel = props.tunnel || {}
    const tun = {
      draft: tunnel.tunnelDraft || {},
      settings: tunnel.tunnelSettings || null,
      ready: !!tunnel.tunnelReady,
      busy: !!tunnel.tunnelBusy,
      dirty: !!tunnel.tunnelDirty,
      valid: tunnel.tunnelValid !== false,
    }
    // Any edit invalidates the previous probe result and its message.
    const patchTunnel = next => {
      if (typeof tunnel.setTunnelDraft === 'function') tunnel.setTunnelDraft(next)
      if (typeof tunnel.setTunnelProbe === 'function') tunnel.setTunnelProbe(null)
      if (typeof tunnel.setTunnelMsg === 'function') tunnel.setTunnelMsg('')
    }
    const tunDisabled = tun.busy || !tun.ready
    const probeDisabled = tunDisabled || tun.dirty || !tun.settings || tun.settings.cli.status !== 'found'
    const settingsBody = [
      h('div', { key: 'st-enabled', className: 'dvt-setting-row' },
        h('div', { className: 'dvt-section-title' }, tr('tunnelEnabled')),
        h(Switch, { checked: !!tun.draft.managedEnabled, disabled: tunDisabled, label: tr('tunnelEnabled'),
          onChange: next => { if (!tunDisabled) patchTunnel({ ...tun.draft, managedEnabled: next }) } })),
      h('div', { key: 'st-help', className: 'dvt-help' }, tr('tunnelHelp')),
      tun.ready ? h('div', { key: 'st-resolved', className: 'dvt-cli' },
        h('span', { className: 'dvt-cli-label' }, tr('tunnelResolved', { source: tun.settings.cli.source })),
        h('code', { 'data-testid': 'devtunnel-resolved-executable' }, tun.settings.cli.resolvedExecutable || '—')) : null,
      h('details', { key: 'st-advanced' }, h('summary', null, tr('tunnelAdvanced')),
        h('div', { style: { paddingTop: 10 } }, row(tr('tunnelCli'), textInput({
          value: tun.draft.cliExecutable || '', placeholder: tr('tunnelCliPlaceholder'), disabled: tunDisabled,
          'aria-label': tr('tunnelCli'), onChange: e => patchTunnel({ ...tun.draft, cliExecutable: e.target.value }),
        }), 'st-cli'))),
      tun.ready && tun.settings.cli.status === 'not-found'
        ? h('div', { key: 'st-notfound', role: 'status', className: 'dvt-notice' }, tr('tunnelNotFound', { source: tun.settings.cli.source })) : null,
      tun.dirty ? h('div', { key: 'st-dirty', className: 'dvt-notice' }, tr(tun.valid ? 'tunnelDirty' : 'tunnelInvalid')) : null,
      h('div', { key: 'st-actions', className: 'dvt-settings-actions' },
        h('button', { type: 'button', className: 'rws-btn dvt-primary', disabled: tunDisabled || !tun.dirty || !tun.valid,
          onClick: () => typeof tunnel.saveTunnelSettings === 'function' && tunnel.saveTunnelSettings() }, h('span', null, tr('tunnelSave'))),
        h('button', { type: 'button', className: 'rws-btn', disabled: probeDisabled,
          onClick: () => typeof tunnel.preflightTunnel === 'function' && tunnel.preflightTunnel(false) }, tr('tunnelProbe')),
        h('button', { type: 'button', className: 'rws-btn', disabled: probeDisabled,
          onClick: () => typeof tunnel.preflightTunnel === 'function' && tunnel.preflightTunnel(true) }, tr('tunnelLoginProbe')),
        h('button', { type: 'button', className: 'rws-btn dvt-quiet', disabled: tun.busy,
          onClick: () => typeof tunnel.refreshTunnelSettings === 'function' && tunnel.refreshTunnelSettings() }, tr('tunnelRefresh'))),
      tunnel.tunnelErr ? h('div', { key: 'st-err', role: 'alert', className: 'dvt-notice' }, tunnel.tunnelErr) : null,
      tunnel.tunnelMsg ? h('div', { key: 'st-msg', role: 'status', className: 'dvt-help' }, tunnel.tunnelMsg) : null,
      tun.ready && tun.settings ? h('details', { key: 'st-meta' }, h('summary', null, tr('tunnelTechnical')),
        h('div', { className: 'dvt-help', style: { paddingTop: 8 } }, tr('tunnelMeta', {
          source: tun.settings.source, revision: tun.settings.revision, count: tun.settings.activeManaged }))) : null,
      tunnel.tunnelProbe ? h('details', { key: 'st-probe' }, h('summary', null, tr('tunnelDetails')),
        h('pre', { style: { fontSize: 11, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, JSON.stringify(tunnel.tunnelProbe, null, 2))) : null,
    ]

    const diagnostics = props.section === 'diagnostics'
    const services = props.section !== 'diagnostics'
    const showEvents = props.section !== 'services'
    return h('div', { className: 'rws-card dvt-panel', 'data-testid': 'devtunnel-channel-panel', style: { padding: 20 } },
      h('style', null, PANEL_CSS),
      h('div', { className: 'dvt-header' },
        h('div', null, h('div', { className: 'dvt-heading' }, tr(diagnostics ? 'panelRecent' : 'panelTitle')),
          services ? h('div', { className: 'dvt-subtitle' }, tr('panelHint')) : null),
        h('div', { className: 'dvt-actions' },
          services && feed ? h('span', { className: 'dvt-badge' },
            h('span', { className: 'dvt-dot', 'aria-hidden': true }), tr(feed.enabled ? 'panelAuthorized' : 'panelUnauthorized')) : null,
          services && feed ? h('span', { className: 'dvt-count' }, tr('panelActiveCount', { count: feed.activeManaged })) : null,
          h('button', { type: 'button', className: 'rws-btn dvt-quiet', disabled: !!props.busy, onClick: refresh }, tr('panelRefresh')))),
      feedError ? h('div', { role: 'alert', className: 'dvt-notice' }, tr(feedError)) : null,
      services ? h(ChannelCatalog, { feed, refresh, busy: !!props.busy || tun.busy }) : null,
      services ? h('details', { className: 'dvt-settings', open: !tun.ready || !tun.settings?.settings?.managedEnabled || undefined },
        h('summary', null, tr('tunnelGlobal')),
        h('div', { className: 'dvt-settings-content' }, ...settingsBody)) : null,
      showEvents && recent.length ? h('div', { className: 'dvt-events' },
        diagnostics ? null : h('div', { className: 'dvt-section-title' }, tr('panelRecent')),
        recent.map(entry => h('div', { key: entry.seq, className: 'dvt-event' },
          `${new Date(entry.at).toLocaleTimeString()} ${entry.code}${entry.machineId ? ` ${entry.machineId}` : ''}${entry.reason ? ` ${entry.reason}` : ''}${entry.endpoint ? ` → ${entry.endpoint.host}:${entry.endpoint.port}` : ''}`))) : null,
      diagnostics && feed && !recent.length ? h('div', { role: 'status', className: 'dvt-help' }, tr('panelNoEvents')) : null)
  }

  function MachineDevTunnelStatus(props) {
    if (!props.machine?.id || props.machine?.connector?.kind !== 'devtunnel') return null
    return h(SessionDevTunnelStatus, props)
  }

  function apply(ctx) {
    if (!ctx || typeof ctx.get !== 'function') return
    // The slot registry is optional: without it the host half still works.
    const slots = ctx.get('slots')
    if (slots === undefined || slots === null) return
    wireLocale(ctx)
    if (typeof ctx.effect === 'function') ctx.effect(() => {
      if (typeof document === 'undefined') return () => {}
      const style = document.createElement('style')
      style.textContent = SESSION_TAG_CSS
      document.head.appendChild(style)
      return () => { style.remove?.() }
    }, 'dsh-devtunnel-ssh.session-tag-style')
    for (const slot of MACHINE_STATUS_SLOTS) slots.inject(slot, () =>
      slots.register({ name: slot, id: TRANSPORT, order: 10 }, MachineDevTunnelStatus))
    slots.inject(SLOT_TRANSPORT_OPTION, () =>
      slots.register({ name: SLOT_TRANSPORT_OPTION, id: TRANSPORT, order: 10 }, DevTunnelTransportOption))
    slots.inject(SLOT_TRANSPORT_FIELDS, () =>
      slots.register({ name: SLOT_TRANSPORT_FIELDS, key: TRANSPORT }, DevTunnelFields))
    slots.inject(SLOT_TRANSPORT_PANEL, () =>
      slots.register({ name: SLOT_TRANSPORT_PANEL, id: TRANSPORT, order: 10 }, DevTunnelPanel))
    // Session header status chip (declared by the harness conversation shell;
    // a missing declaration only leaves the chip out).
    slots.inject(SLOT_SESSION_UTILITIES, () =>
      slots.register({ name: SLOT_SESSION_UTILITIES, id: SESSION_STATUS_ID, order: -100 }, SessionDevTunnelStatus))
    // New Chat blank/hero hides conversation chrome, so the header seat never
    // renders there. Like dsh-better-sidebar's dock-fallback and
    // dsh-editor-workbench's resume-fallback, a root `shell.overlay` entry
    // portals the same status button next to the native right-sidebar anchor
    // while the header entry is actually absent from the DOM, and steps aside
    // the moment it appears. `sidebarRight.mounted` (host on-screen Session)
    // is guarded: without it the fallback never fabricates a Session.
    const sidebarRight = ctx.get('sidebarRight')
    const mounted = sidebarRight && sidebarRight.mounted
    if (mounted && typeof mounted.subscribe === 'function' && typeof mounted.getSnapshot === 'function') {
      slots.inject('shell.overlay', () =>
        slots.register({ name: 'shell.overlay', id: SESSION_STATUS_ID + '-fallback', order: 9 }, createStatusFallback(mounted)))
    }
  }

  const module = { exports: {} }
  module.exports.name = name
  module.exports.apply = apply
  module.exports.inject = ['slots', 'locale']
  // Contract + helpers, exported for the fixture tests (not a public API).
  module.exports.MACHINE_STATUS_SLOTS = MACHINE_STATUS_SLOTS
  module.exports.MachineDevTunnelStatus = MachineDevTunnelStatus
  module.exports.machineTunnelStatus = machineTunnelStatus
  module.exports.runMachineTunnelAction = runMachineTunnelAction
  module.exports.NS = NS
  module.exports.dict = L
  module.exports.TRANSPORT = TRANSPORT
  module.exports.SLOT_TRANSPORT_OPTION = SLOT_TRANSPORT_OPTION
  module.exports.SLOT_TRANSPORT_FIELDS = SLOT_TRANSPORT_FIELDS
  module.exports.SLOT_TRANSPORT_PANEL = SLOT_TRANSPORT_PANEL
  module.exports.SLOT_SESSION_UTILITIES = SLOT_SESSION_UTILITIES
  module.exports.SESSION_STATUS_ID = SESSION_STATUS_ID
  module.exports.capabilities = capabilities
  module.exports.carrierReady = carrierReady
  module.exports.managedAvailable = managedAvailable
  module.exports.defaultMode = defaultMode
  module.exports.canonicalJson = canonicalJson
  module.exports.devTunnelBody = devTunnelBody
  module.exports.devTunnelValid = devTunnelValid
  module.exports.DevTunnelTransportOption = DevTunnelTransportOption
  module.exports.startConfiguredChannel = startConfiguredChannel
  module.exports.DevTunnelFields = DevTunnelFields
  module.exports.ChannelCatalog = ChannelCatalog
  module.exports.runSessionTunnelAction = runSessionTunnelAction
  module.exports.specializeDevTunnelConnection = specializeDevTunnelConnection
  module.exports.resolveSessionDevTunnelStatus = resolveSessionDevTunnelStatus
  module.exports.pullSessionDevTunnelStatus = pullSessionDevTunnelStatus
  module.exports.SessionDevTunnelStatus = SessionDevTunnelStatus
  module.exports.DevTunnelPanel = DevTunnelPanel
  module.exports.statusFallbackPosition = statusFallbackPosition
  module.exports.createStatusFallback = createStatusFallback
  return module.exports
}})
