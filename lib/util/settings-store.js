import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_FILE_BYTES = 8192;
// Resident tunnel: the plugin keeps ONE global `devtunnel connect` alive
// (immediate: right after a confirmed save; lazy: after the first SSH session
// uses it). SSH sessions rent the resident channel; dsh-remote owns SSH only.
const SETTINGS_KEYS = ['cliExecutable', 'managedEnabled', 'residentTunnelId', 'residentRemotePort', 'residentMode'];
export const RESIDENT_MODES = Object.freeze(['off', 'immediate', 'lazy']);
export const RESIDENT_TUNNEL_ID = /^[a-z0-9][a-z0-9-]{0,99}(?:\.[a-z0-9]{1,20})?(?![\s\S])/u;
const LEGACY_KEYS = ['cliExecutable', 'managedEnabled'];
// Serialize all store instances targeting the same file within this host process.
const writers = new Map();
export function settingsError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every(key => keys.includes(key));
}
/** Effective resident configuration, or null when disabled/incomplete. */
export function residentConfigOf(settings) {
  if (!settings || !['immediate', 'lazy'].includes(settings.residentMode)) return null;
  if (typeof settings.residentTunnelId !== 'string' || !RESIDENT_TUNNEL_ID.test(settings.residentTunnelId)) return null;
  if (!Number.isInteger(settings.residentRemotePort) || settings.residentRemotePort < 1 || settings.residentRemotePort > 65535) return null;
  return Object.freeze({ tunnelId: settings.residentTunnelId, remotePort: settings.residentRemotePort, mode: settings.residentMode });
}
export function validateSettings(value) {
  const keys = Object.keys(value ?? {});
  const full = exactKeys(value, SETTINGS_KEYS);
  // The legacy two-key record stays readable; missing resident fields default off.
  const legacy = exactKeys(value, LEGACY_KEYS);
  if ((!full && !legacy)
      || typeof value.cliExecutable !== 'string'
      || value.cliExecutable.length > 4096
      || /[\u0000-\u001f\u007f-\u009f]/u.test(value.cliExecutable)
      || (value.cliExecutable !== '' && !value.cliExecutable.startsWith('/'))
      || typeof value.managedEnabled !== 'boolean') {
    throw settingsError('SETTINGS_REJECTED');
  }
  if (legacy) {
    return Object.freeze({ cliExecutable: value.cliExecutable, managedEnabled: value.managedEnabled,
      residentTunnelId: '', residentRemotePort: 0, residentMode: 'off' });
  }
  const { residentTunnelId, residentRemotePort, residentMode } = value;
  if (typeof residentTunnelId !== 'string' || (residentTunnelId !== '' && !RESIDENT_TUNNEL_ID.test(residentTunnelId))
      || !Number.isInteger(residentRemotePort) || residentRemotePort < 0 || residentRemotePort > 65535
      || !RESIDENT_MODES.includes(residentMode)) {
    throw settingsError('SETTINGS_REJECTED');
  }
  if ((residentTunnelId === '') !== (residentRemotePort === 0)) throw settingsError('SETTINGS_REJECTED');
  if (residentMode !== 'off' && residentTunnelId === '') throw settingsError('SETTINGS_REJECTED');
  return Object.freeze({ cliExecutable: value.cliExecutable, managedEnabled: value.managedEnabled,
    residentTunnelId, residentRemotePort, residentMode });
}
function positiveRevision(value) { return Number.isSafeInteger(value) && value > 0; }

/** Only the authorized settings are persisted; product profiles are never touched. */
export function createSettingsStore({ directory, defaults, validate = validateSettings, basename = 'devtunnel-settings.json', maxBytes = MAX_FILE_BYTES } = {}) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) throw settingsError('SETTINGS_REJECTED');
  const config = validate(defaults);
  const filename = join(directory, basename);
  const configSnapshot = () => ({ settings: { ...config }, revision: 0, source: 'config' });

  async function checkDirectory(create = false) {
    if (create) await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw settingsError('SETTINGS_UNAVAILABLE');
      return true;
    } catch (error) {
      if (!create && error.code === 'ENOENT') return false;
      throw error;
    }
  }
  async function readSnapshot() {
    if (!await checkDirectory()) return configSnapshot();
    let before;
    try { before = await lstat(filename); }
    catch (error) { if (error.code === 'ENOENT') return configSnapshot(); throw error; }
    if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) {
      throw settingsError('SETTINGS_UNAVAILABLE');
    }
    let handle;
    try {
      handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > maxBytes || stat.dev !== before.dev || stat.ino !== before.ino) {
        throw settingsError('SETTINGS_UNAVAILABLE');
      }
      // One bounded allocation and bounded reads, including one byte to detect growth.
      const buffer = Buffer.alloc(maxBytes + 1);
      let used = 0;
      while (used < buffer.length) {
        const { bytesRead } = await handle.read(buffer, used, buffer.length - used, used);
        if (!bytesRead) break;
        used += bytesRead;
      }
      if (used > maxBytes) throw settingsError('SETTINGS_UNAVAILABLE');
      const record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, used)));
      if (!exactKeys(record, ['schemaVersion', 'revision', 'settings'])
          || record.schemaVersion !== 1 || !positiveRevision(record.revision)) {
        throw settingsError('SETTINGS_UNAVAILABLE');
      }
      return { settings: validate(record.settings), revision: record.revision, source: 'settings' };
    } finally { await handle?.close(); }
  }
  async function snapshot() {
    try { return await readSnapshot(); }
    catch { throw settingsError('SETTINGS_UNAVAILABLE'); }
  }
  function save(value, options = {}) {
    const operation = (writers.get(filename) ?? Promise.resolve()).then(async () => {
      const settings = validate(value);
      const expectedRevision = typeof options === 'number' ? options : options.expectedRevision;
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw settingsError('SETTINGS_REJECTED');
      let temporary;
      let handle;
      try {
        const current = await snapshot();
        if (current.revision !== expectedRevision) throw settingsError('SETTINGS_REVISION_CONFLICT');
        if (current.revision === Number.MAX_SAFE_INTEGER) throw settingsError('SETTINGS_UNAVAILABLE');
        await checkDirectory(true);
        const revision = current.revision + 1;
        const payload = JSON.stringify({ schemaVersion: 1, revision, settings }) + '\n';
        if (Buffer.byteLength(payload) > maxBytes) throw settingsError('SETTINGS_REJECTED');
        temporary = join(directory, `.devtunnel-settings.${randomUUID()}.tmp`);
        handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        await handle.chmod(0o600);
        await handle.writeFile(payload, 'utf8');
        await handle.sync();
        await handle.close();
        handle = undefined;
        // Re-read immediately before replacement: refuse changed or unsafe targets.
        const latest = await snapshot();
        if (latest.revision !== current.revision) throw settingsError('SETTINGS_REVISION_CONFLICT');
        await checkDirectory();
        await rename(temporary, filename);
        temporary = undefined;
        return { settings: { ...settings }, revision, source: 'settings' };
      } catch (error) {
        if (['SETTINGS_REJECTED', 'SETTINGS_REVISION_CONFLICT'].includes(error.code)) throw settingsError(error.code);
        throw settingsError('SETTINGS_UNAVAILABLE');
      } finally {
        await handle?.close().catch(() => {});
        if (temporary) await unlink(temporary).catch(() => {});
      }
    });
    const settled = operation.catch(() => {});
    writers.set(filename, settled);
    void settled.then(() => { if (writers.get(filename) === settled) writers.delete(filename); });
    return operation;
  }
  return {
    snapshot,
    save,
    update: body => save({ cliExecutable: body.cliExecutable, managedEnabled: body.managedEnabled,
      residentTunnelId: body.residentTunnelId, residentRemotePort: body.residentRemotePort,
      residentMode: body.residentMode }, { expectedRevision: body.revision }),
  };
}
