import { randomUUID } from 'node:crypto';
import { validateCatalog, validateChannel, CHANNEL_ID } from '../util/channel-store.js';
import { settingsError as fail, residentConfigOf } from '../util/settings-store.js';

// This owns connect processes. SSH only borrows a generation; never starts it.
export async function createChannelManager({ store, getStarter, enabled, legacySettings, diagnostics } = {}) {
  let unavailable = false, saved;
  try { saved = store ? await store.snapshot() : { settings: { channels: [] }, revision: 0, source: 'config' }; }
  catch { unavailable = true; saved = { settings: { channels: [] }, revision: 0, source: 'unavailable' }; }
  saved = { ...saved, settings: validateCatalog(saved.settings) };
  const legacy = residentConfigOf(legacySettings);
  // Read-only migration preview; the first explicit catalog write persists it.
  if (saved.source === 'config' && !saved.settings.channels.length && legacy) {
    saved = { ...saved, settings: validateCatalog({ channels: [{ channelId: 'legacy-resident',
      name: 'Migrated resident', mode: 'managed', tunnelId: legacy.tunnelId, remotePort: legacy.remotePort }] }) };
  }
  const entries = new Map();
  let disposed = false;
  const report = (code, config, extra = {}) => { try { diagnostics?.record?.({ code,
    channelId: config.channelId, tunnelId: config.tunnelId, remotePort: config.remotePort, mode: config.mode, stream: 'user', ...extra }); } catch {} };
  const rows = () => saved.settings.channels;
  const active = () => [...entries.values()].filter(e => e.mode === 'managed' && ['starting', 'ready', 'stopping'].includes(e.state)).length;
  function invalidate(entry, state, code = null) {
    entry.state = state; entry.error = code; entry.endpoint = null; entry.resolveClosed();
    if (state === 'error' && entry.config) report('CHANNEL_FAILED', entry.config, { reason: code });
  }
  async function close(entry) {
    if (!entry) return;
    if (entry.cleanup) return entry.cleanup;
    const poisoned = entry.error === 'CONNECT_CLEANUP_FAILED';
    invalidate(entry, 'stopping');
    entry.controller.abort();
    entry.cleanup = (async () => {
      await entry.task?.catch(() => {});
      try {
        await entry.failureCleanup;
        if (poisoned || entry.error === 'CONNECT_CLEANUP_FAILED') throw fail('CONNECT_CLEANUP_FAILED');
        await entry.closeHandle?.();
        if (entry.error === 'CONNECT_CLEANUP_FAILED') throw fail('CONNECT_CLEANUP_FAILED');
        invalidate(entry, 'stopped');
      } catch {
        invalidate(entry, 'error', 'CONNECT_CLEANUP_FAILED');
        throw fail('CONNECT_CLEANUP_FAILED');
      }
    })();
    return entry.cleanup;
  }
  function start(config) {
    if (disposed || unavailable) throw fail('SETTINGS_UNAVAILABLE');
    if (config.mode !== 'managed') throw fail('CHANNEL_EXTERNAL');
    if (!enabled()) throw fail('MANAGED_UNAVAILABLE');
    const previous = entries.get(config.channelId);
    if (previous && ['starting', 'ready'].includes(previous.state)) return;
    if (previous?.error === 'CONNECT_CLEANUP_FAILED') throw fail('CONNECT_CLEANUP_FAILED');
    // Runtime gives each channel its own bounded supervisor. An explicit start
    // after a clean failure gets a new retry budget; cleanup poison never resets.
    const starter = getStarter();
    if (typeof starter !== 'function') throw fail('MANAGED_UNAVAILABLE');
    let resolveClosed;
    const entry = { mode: 'managed', state: 'starting', endpoint: null, error: null, since: Date.now(),
      generation: randomUUID(), refs: 0, controller: new AbortController(),
      closed: new Promise(r => { resolveClosed = r; }), resolveClosed: null, handle: null, cleanup: null };
    entry.resolveClosed = resolveClosed;
    entries.set(config.channelId, entry);
    report('CHANNEL_STARTED', config);
    entry.config = config;
    entry.task = (async () => {
      try {
        // Do not overlap an exited generation's asynchronous cleanup.
        if (previous) await close(previous);
        if (disposed || entry.controller.signal.aborted) return;
        const handle = await starter({ tunnelId: config.tunnelId, remotePort: config.remotePort, signal: entry.controller.signal });
        entry.handle = handle;
        let handleCleanup;
        entry.closeHandle = () => handleCleanup ||= Promise.resolve().then(() => handle.close());
        if (disposed || entry.controller.signal.aborted) { await entry.closeHandle(); return; }
        const endpoint = handle.endpoint;
        if (!endpoint || !['127.0.0.1', '::1'].includes(endpoint.host)
          || !Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535
          || typeof handle.close !== 'function' || !(handle.closed instanceof Promise)) throw fail('CONNECT_ADAPTER_FAILED');
        entry.endpoint = Object.freeze({ host: endpoint.host, port: endpoint.port });
        entry.state = 'ready';
        const ended = () => {
          if (entry.state !== 'ready') return;
          invalidate(entry, 'error', 'CONNECT_EXITED');
          // Keep the error visible; cleanup owns no reconnect policy.
          entry.failureCleanup = entry.closeHandle().catch(() => {
            invalidate(entry, 'error', 'CONNECT_CLEANUP_FAILED');
          });
        };
        handle.closed.then(ended, ended);
      } catch (error) {
        const code = error?.code === 'CONNECT_CLEANUP_FAILED' ? error.code
          : typeof error?.code === 'string' && /^CONNECT_[A-Z_]+$/u.test(error.code) ? error.code : 'CONNECT_ADAPTER_FAILED';
        try { await entry.closeHandle?.(); } catch { invalidate(entry, 'error', 'CONNECT_CLEANUP_FAILED'); return; }
        invalidate(entry, entry.controller.signal.aborted && code !== 'CONNECT_CLEANUP_FAILED' ? 'stopped' : 'error', code);
      }
    })();
    entry.task.catch(() => {});
  }
  async function commit(channels) {
    const settings = validateCatalog({ channels });
    if (store) saved = await store.save(settings, { expectedRevision: saved.revision });
    else saved = { settings, revision: saved.revision + 1, source: 'settings' };
  }
  async function command(body) {
    if (disposed || unavailable) throw fail('SETTINGS_UNAVAILABLE');
    if (body?.confirmed !== true || !Number.isSafeInteger(body.revision) || body.revision < 0) throw fail('CHANNELS_REJECTED');
    if (body.revision !== saved.revision) throw fail('SETTINGS_REVISION_CONFLICT');
    if (body.action === 'create') {
      if (body.channelId !== '') throw fail('CHANNELS_REJECTED');
      const channel = { channelId: randomUUID(), ...validateChannel(body.channel) };
      await commit([...rows(), channel]);
      return channel.channelId;
    }
    if (typeof body.channelId !== 'string' || !CHANNEL_ID.test(body.channelId)) throw fail('CHANNELS_REJECTED');
    const config = rows().find(c => c.channelId === body.channelId);
    if (!config) throw fail('CHANNEL_NOT_FOUND');
    const entry = entries.get(config.channelId);
    if (body.action === 'update' || body.action === 'delete') {
      const updated = body.action === 'update' ? { channelId: config.channelId, ...validateChannel(body.channel) } : null;
      const next = rows().flatMap(c => c.channelId === config.channelId ? (updated ? [updated] : []) : [c]);
      validateCatalog({ channels: next });
      await close(entry);
      await commit(next);
      entries.delete(config.channelId);
    } else if (['start', 'stop', 'restart'].includes(body.action)) {
      if (config.mode !== 'managed') throw fail('CHANNEL_EXTERNAL');
      if (body.action !== 'start') {
        await close(entry);
        report('CHANNEL_STOPPED', config);
      }
      if (body.action !== 'stop') start(config);
    } else throw fail('CHANNELS_REJECTED');
    return config.channelId;
  }
  function getEntry(connector) {
    if (disposed || unavailable) throw fail('SETTINGS_UNAVAILABLE');
    const config = connector.channelId ? rows().find(c => c.channelId === connector.channelId)
      : rows().find(c => c.tunnelId === connector.tunnelId && c.remotePort === connector.remotePort && c.mode === connector.mode);
    if (!config) throw fail('CHANNEL_NOT_FOUND');
    if (config.tunnelId !== connector.tunnelId || config.remotePort !== connector.remotePort || config.mode !== connector.mode)
      throw fail('CHANNEL_TARGET_CHANGED');
    let entry = entries.get(config.channelId);
    if (config.mode === 'external' && !entry) {
      let resolveClosed;
      entry = { mode: 'external', state: 'ready', endpoint: config.endpoint, generation: randomUUID(), refs: 0,
        closed: new Promise(r => { resolveClosed = r; }), resolveClosed: null, controller: new AbortController() };
      entry.resolveClosed = resolveClosed;
      entries.set(config.channelId, entry);
    }
    if (!entry || entry.state !== 'ready' || (config.mode === 'managed' && !enabled())) throw fail('CHANNEL_NOT_READY');
    const valid = () => !disposed && entry.state === 'ready' && !!entry.endpoint;
    return Object.freeze({
      use() { if (!valid()) throw fail('CHANNEL_NOT_READY'); entry.refs++; },
      unuse() { entry.refs = Math.max(0, entry.refs - 1); },
      ready: Promise.resolve(), closed: entry.closed,
      get endpoint() { if (!valid()) throw fail('STALE_LEASE'); return entry.endpoint; },
      generation: entry.generation, get usable() { return valid(); },
    });
  }
  function snapshot() {
    return { catalogRevision: saved.revision, available: !unavailable && !disposed, enabled: !unavailable && enabled(), activeManaged: rows().filter(c => c.mode === 'managed'
      && ['starting', 'ready', 'stopping'].includes(entries.get(c.channelId)?.state)).length,
      channels: rows().map(c => {
        const e = entries.get(c.channelId);
        return { ...c, state: e?.state || (c.mode === 'external' ? 'external' : 'stopped'),
          endpoint: e?.endpoint || (c.mode === 'external' ? c.endpoint : null),
          generation: e?.generation || null, since: e?.since || null, refs: e?.refs || 0, error: e?.error || null };
      }), supervisor: [], resident: { enabled: false, mode: 'off' } };
  }
  return { command, getEntry, snapshot, active,
    async stopAll() { await Promise.all([...entries.values()].filter(e => e.mode === 'managed').map(close)); },
    async dispose() { disposed = true; await Promise.all([...entries.values()].map(close)); },
  };
}
