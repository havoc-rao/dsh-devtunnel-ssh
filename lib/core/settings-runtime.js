import { createManagedStarter } from './managed-supervisor.js';
import { validateSettings } from '../util/settings-store.js';
import { resolveCliExecutable } from '../util/cli-resolver.js';
const fail = code => Object.assign(new Error(code), { code });

// One runtime per loaded plugin. Browser requests may only use the confirmed
// settings route; caller-supplied executables are never accepted by preflight.
export async function createSettingsRuntime({ store, makeStarter = createManagedStarter, resolveCli = resolveCliExecutable, diagnostics } = {}) {
  let current, starter, carrier, busy = false, disposed = false, pending;
  let blocked = false;
  try { current = await store.snapshot(); }
  catch { blocked = true; current = { settings: { cliExecutable: '', managedEnabled: false }, revision: 0, source: 'config' }; }
  const detect = settings => resolveCli({ override: settings.cliExecutable });
  let cli = blocked ? { status: 'not-found', source: 'path', resolvedExecutable: '' } : await detect(current.settings);
  const build = (settings, detection) => settings.managedEnabled && detection.status === 'found'
    ? makeStarter({ executable: detection.resolvedExecutable, diagnostics }) : undefined;
  starter = build(current.settings, cli);
  const enabled = () => !blocked && !disposed && !!starter;
  const capabilities = Object.freeze({
    get managedConnect() { return enabled(); },
    get automaticLocalPort() { return enabled(); },
    get reconnect() { return enabled() ? 'bounded-on-demand' : 'manual'; },
  });
  const view = () => ({ ...current, settings: { ...current.settings }, cli: { ...cli }, activeManaged: carrier?.activeManaged ?? 0, available: true });
  async function snapshot({ refresh = true } = {}) {
    if (blocked || disposed) throw fail('SETTINGS_UNAVAILABLE');
    // A live generation owns its executable until an explicit settings update.
    // Re-check after the asynchronous probe: a lease may have appeared meanwhile.
    if (refresh && !busy && !carrier?.activeManaged) {
      busy = true;
      pending = (async () => {
        const detected = await detect(current.settings);
        if (disposed) throw fail('SETTINGS_UNAVAILABLE');
        if (!carrier?.activeManaged) {
          const changed = detected.status !== cli.status || detected.source !== cli.source
            || detected.resolvedExecutable !== cli.resolvedExecutable;
          const nextStarter = changed ? build(current.settings, detected) : starter;
          cli = detected;
          starter = nextStarter;
        }
      })();
      try { await pending; } finally { pending = null; busy = false; }
    }
    if (blocked || disposed) throw fail('SETTINGS_UNAVAILABLE');
    return view();
  }
  async function update(body) {
    if (busy) throw fail('SETTINGS_BUSY');
    if (blocked || disposed) throw fail('SETTINGS_UNAVAILABLE');
    if (body?.confirmed !== true || typeof body.disconnectActive !== 'boolean') throw fail('SETTINGS_CONFIRM_REQUIRED');
    const settings = validateSettings({ cliExecutable: body.cliExecutable, managedEnabled: body.managedEnabled });
    if (body.revision !== current.revision) throw fail('SETTINGS_REVISION_CONFLICT');
    const changed = settings.cliExecutable !== current.settings.cliExecutable || settings.managedEnabled !== current.settings.managedEnabled;
    if (!changed && current.source === 'settings') return snapshot();
    if (changed && carrier?.activeManaged && !body.disconnectActive) throw fail('SETTINGS_ACTIVE_CONFIRM_REQUIRED');
    busy = true;
    pending = (async () => {
      const commit = async () => {
        if (disposed) throw fail('SETTINGS_UNAVAILABLE');
        const detected = !changed && carrier?.activeManaged ? cli : await detect(settings);
        if (disposed) throw fail('SETTINGS_UNAVAILABLE');
        const nextStarter = !changed && carrier?.activeManaged ? starter : build(settings, detected); // Never CLI spawn.
        const saved = await store.save(settings, { expectedRevision: body.revision });
        current = saved;
        cli = detected;
        starter = disposed ? undefined : nextStarter;
      };
      try {
        if (changed && carrier) await carrier.reconfigureManaged(commit);
        else await commit();
      } catch (error) {
        if (error?.code === 'CLEANUP_FAILED') { blocked = true; starter = undefined; throw fail('SETTINGS_CLEANUP_FAILED'); }
        throw error;
      }
      return snapshot({ refresh: false });
    })();
    try { return await pending; } finally { pending = null; busy = false; }
  }
  return Object.freeze({ capabilities, getStarter: () => enabled() ? starter : undefined,
    attachCarrier(value) { carrier = value; }, snapshot, update,
    // Channel management view for the settings panel. Read-only and total: a
    // missing carrier or starter degrades to empty lists, never an error.
    channelSnapshot() {
      // A disposed or blocked runtime manages nothing: report empty instead of
      // stale carrier state (the route is torn down with the plugin anyway).
      if (blocked || disposed) return Object.freeze({ enabled: false, activeManaged: 0, channels: [], supervisor: [] });
      const channels = typeof carrier?.snapshot === 'function' ? carrier.snapshot() : [];
      const supervisor = typeof starter?.list === 'function' ? starter.list() : [];
      return Object.freeze({ enabled: enabled(), activeManaged: carrier?.activeManaged ?? 0, channels, supervisor });
    },
    // Explicit, authenticated stop of one managed channel. Never silently
    // substitutes another machine and never retries on its own.
    async stopManagedChannel(machineId) {
      if (blocked || disposed) throw fail('SETTINGS_UNAVAILABLE');
      if (typeof carrier?.stopManaged !== 'function') throw fail('CHANNELS_UNAVAILABLE');
      try { return await carrier.stopManaged(machineId); }
      catch (error) {
        if (typeof error?.code === 'string') throw error;
        throw fail('CHANNELS_UNAVAILABLE');
      }
    },
    // Settings saves and preflight cannot cross: never test a stale executable.
    async withExecutable(fn) {
      if (busy) throw fail('SETTINGS_BUSY');
      if (blocked || disposed) throw fail('SETTINGS_UNAVAILABLE');
      if (cli.status !== 'found') throw fail('HOST_CLI_NOT_FOUND');
      busy = true;
      pending = Promise.resolve().then(() => fn(cli.resolvedExecutable));
      try { return await pending; } finally { pending = null; busy = false; }
    },
    async dispose() { disposed = true; starter = undefined; if (pending) await pending.catch(() => {}); },
  });
}
