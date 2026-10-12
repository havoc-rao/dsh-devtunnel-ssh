import { createSettingsStore, settingsError, RESIDENT_TUNNEL_ID } from './settings-store.js';
export const CHANNEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u;
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === keys.length && Object.keys(v).every(k => keys.includes(k));
export function validateChannel(value) {
  const external = value?.mode === 'external';
  if (!exact(value, ['name', 'mode', 'tunnelId', 'remotePort', ...(external ? ['endpoint'] : [])])
    || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 128 || /[\x00-\x1f\x7f]/u.test(value.name)
    || !['managed', 'external'].includes(value.mode)
    || typeof value.tunnelId !== 'string' || !RESIDENT_TUNNEL_ID.test(value.tunnelId)
    || !Number.isInteger(value.remotePort) || value.remotePort < 1 || value.remotePort > 65535)
    throw settingsError('CHANNELS_REJECTED');
  let endpoint;
  if (external) {
    const e = value.endpoint;
    if (!exact(e, ['host', 'port']) || !['127.0.0.1', '::1'].includes(e.host)
      || !Number.isInteger(e.port) || e.port < 1 || e.port > 65535) throw settingsError('CHANNELS_REJECTED');
    endpoint = Object.freeze({ host: e.host, port: e.port });
  }
  return Object.freeze({ name: value.name.trim(), mode: value.mode, tunnelId: value.tunnelId,
    remotePort: value.remotePort, ...(endpoint ? { endpoint } : {}) });
}
export function validateCatalog(value) {
  if (!exact(value, ['channels']) || !Array.isArray(value.channels) || value.channels.length > 64) throw settingsError('CHANNELS_REJECTED');
  const ids = new Set(), targets = new Set();
  const channels = value.channels.map(row => {
    const { channelId, ...config } = row || {};
    if (typeof channelId !== 'string' || !CHANNEL_ID.test(channelId) || ids.has(channelId)) throw settingsError('CHANNELS_REJECTED');
    const channel = validateChannel(config), target = JSON.stringify([channel.tunnelId, channel.remotePort]);
    if (targets.has(target)) throw settingsError('CHANNEL_TARGET_EXISTS');
    ids.add(channelId); targets.add(target);
    return Object.freeze({ channelId, ...channel });
  });
  return Object.freeze({ channels: Object.freeze(channels) });
}
export function createChannelStore({ directory }) {
  return createSettingsStore({ directory, defaults: { channels: [] }, validate: validateCatalog,
    basename: 'devtunnel-channels.json', maxBytes: 65536 });
}
