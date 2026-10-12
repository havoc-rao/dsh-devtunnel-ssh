import { createChannelManager } from './channel-manager.js';
import { createManagedStarter } from './managed-supervisor.js';
import { validateSettings } from '../util/settings-store.js';
import { resolveCliExecutable } from '../util/cli-resolver.js';
const fail = code => Object.assign(new Error(code), { code });

// One runtime per loaded plugin. Browser requests may only use the confirmed
// settings route; caller-supplied executables are never accepted by preflight.
export async function createSettingsRuntime({ store, channelStore, makeStarter = createManagedStarter, resolveCli = resolveCliExecutable, diagnostics } = {}) {
  let current, starter, carrier, busy = false, disposed = false, pending;
  let blocked = false;
  try { current = await store.snapshot(); }
  catch { blocked = true; current = { settings: { cliExecutable: '', managedEnabled: false, residentTunnelId: '', residentRemotePort: 0, residentMode: 'off' }, revision: 0, source: 'config' }; }
  const detect = settings => resolveCli({ override: settings.cliExecutable });
  let cli = blocked ? { status: 'not-found', source: 'path', resolvedExecutable: '' } : await detect(current.settings);
  const build = (settings, detection) => settings.managedEnabled && detection.status === 'found'
    ? makeStarter({ executable: detection.resolvedExecutable, diagnostics }) : undefined;
  starter = build(current.settings, cli);
  const enabled = () => !blocked && !disposed && !!starter;
  const capabilities = Object.freeze({
    get managedConnect() { return enabled(); },
    get automaticLocalPort() { return enabled(); },
    get reconnect() { return 'manual' },
  });
  const view = () => ({ ...current, settings: { ...current.settings }, cli: { ...cli }, activeManaged: channels.snapshot().activeManaged, available: true });

  const channels = await createChannelManager({ store: channelStore, legacySettings: current.settings,
    enabled, getStarter: () => build(current.settings, cli), diagnostics });
  const active = () => channels.active() || carrier?.activeManaged || 0;
  const getChannelEntry = connector => {
    if (busy) throw fail('SETTINGS_BUSY');
    if (blocked || disposed) throw fail('SETTINGS_UNAVAILABLE');
    return channels.getEntry(connector);
  };
  async function snapshot({ refresh = true } = {}) {
    if (blocked || disposed) throw fail('SETTINGS_UNAVAILABLE');
    // A live generation owns its executable until an explicit settings update.
    // Re-check after the asynchronous probe: a lease may have appeared meanwhile.
    if (refresh && !busy && !active()) {
      busy = true;
      pending = (async () => {
        const detected = await detect(current.settings);
        if (disposed) throw fail('SETTINGS_UNAVAILABLE');
        if (!active()) {
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
    const settings = validateSettings({ cliExecutable: body.cliExecutable, managedEnabled: body.managedEnabled,
      residentTunnelId: body.residentTunnelId, residentRemotePort: body.residentRemotePort,
      residentMode: body.residentMode });
    if (body.revision !== current.revision) throw fail('SETTINGS_REVISION_CONFLICT');
    // Normalize persisted settings before comparing: legacy two-key records
    // (defaults filled by validateSettings at load) must read as explicit off.
    const normalized = validateSettings(current.settings);
    const changed = settings.cliExecutable !== normalized.cliExecutable
      || settings.managedEnabled !== normalized.managedEnabled
      || settings.residentTunnelId !== normalized.residentTunnelId
      || settings.residentRemotePort !== normalized.residentRemotePort
      || settings.residentMode !== normalized.residentMode;
    if (changed && active() && !body.disconnectActive) throw fail('SETTINGS_ACTIVE_CONFIRM_REQUIRED');
    busy = true;
    pending = (async () => {
      const commit = async () => {
        if (disposed) throw fail('SETTINGS_UNAVAILABLE');
        const detected = !changed && active() ? cli : await detect(settings);
        if (disposed) throw fail('SETTINGS_UNAVAILABLE');
        const nextStarter = !changed && active() ? starter : build(settings, detected); // Never CLI spawn.
        const saved = await store.save(settings, { expectedRevision: body.revision });
        current = saved;
        cli = detected;
        starter = disposed ? undefined : nextStarter;
      };
      try {
        if (changed) {
          await channels.stopAll();
          if (carrier) await carrier.reconfigureManaged(commit);
          else await commit();

        } else {
          await commit();
        }
      } catch (error) {
        if (['CLEANUP_FAILED', 'CONNECT_CLEANUP_FAILED'].includes(error?.code)) { blocked = true; starter = undefined; throw fail('SETTINGS_CLEANUP_FAILED'); }
        throw error;
      }
      return snapshot({ refresh: false });
    })();
    try { return await pending; } finally { pending = null; busy = false; }
  }
  return Object.freeze({ capabilities, getStarter: () => enabled() ? starter : undefined,
    attachCarrier(value) { carrier = value; }, getChannelEntry, snapshot, update,
    channelSnapshot() { return channels.snapshot(); },
    async channelCommand(body) {
      if (blocked || disposed) throw fail('SETTINGS_UNAVAILABLE');
      if (busy) throw fail('SETTINGS_BUSY');
      busy = true;
      pending = channels.command(body);
      try { return await pending; } finally { pending = null; busy = false; }
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
    async dispose() {
      disposed = true;
      starter = undefined;
      if (pending) await pending.catch(() => {});
      await channels.dispose();
    },
  });
}
