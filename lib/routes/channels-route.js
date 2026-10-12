import { settingsError } from '../util/settings-store.js';

// Channel management is a host-authenticated read plus one explicit stop.
// Codes are the only thing the browser ever sees; adapter/CLI text never is.
const ERROR_STATUS = new Map([
  ['CHANNEL_NOT_FOUND', 404],
  ['CHANNEL_EXTERNAL', 409], ['CHANNEL_TARGET_EXISTS', 409],
  ['MANAGED_UNAVAILABLE', 503], ['CONNECT_CLEANUP_FAILED', 503],
  ['SETTINGS_REVISION_CONFLICT', 409],
  ['INVALID_MACHINE_ID', 400],
  ['CHANNELS_REJECTED', 400],
  ['CHANNELS_UNAVAILABLE', 503],
  ['SETTINGS_UNAVAILABLE', 503],
  ['SETTINGS_BUSY', 409],
  ['SETTINGS_UPDATING', 409],
  ['DISPOSED', 503],
  ['CLEANUP_FAILED', 503],
]);
const POST_KEYS = ['action', 'channelId', 'revision', 'confirmed'];
const MACHINE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u;

async function readBody(req) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 4096) throw settingsError('CHANNELS_REJECTED');
    chunks.push(buffer);
  }
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes))); }
  catch { throw settingsError('CHANNELS_REJECTED'); }
  const keys = [...POST_KEYS, ...(['create', 'update'].includes(body?.action) ? ['channel'] : [])];
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== keys.length || Object.keys(body).some(key => !keys.includes(key))
      || !['create', 'update', 'delete', 'start', 'stop', 'restart'].includes(body.action) || body.confirmed !== true
      || !Number.isSafeInteger(body.revision) || body.revision < 0
      || typeof body.channelId !== 'string'
      || (body.action === 'create' ? body.channelId !== '' : !MACHINE_ID.test(body.channelId))) {
    throw settingsError('CHANNELS_REJECTED');
  }
  return body;
}

function publicSnapshot(value, revision, recent) {
  const resident = value?.resident;
  if (!value || value.available === false || typeof value !== 'object'
      || typeof value.enabled !== 'boolean'
      || !Number.isSafeInteger(value.activeManaged) || value.activeManaged < 0
      || !Array.isArray(value.channels) || !Array.isArray(value.supervisor)
      || !resident || typeof resident.enabled !== 'boolean'
      || !['off', 'immediate', 'lazy'].includes(resident.mode)
      || (resident.enabled === true
        && (typeof resident.tunnelId !== 'string' || !Number.isSafeInteger(resident.remotePort)
          || resident.remotePort < 1 || resident.remotePort > 65535))) {
    throw settingsError('CHANNELS_UNAVAILABLE');
  }
  return {
    ok: true, revision: Number.isSafeInteger(revision) ? revision : 0,
    catalogRevision: value.catalogRevision ?? 0, enabled: value.enabled, activeManaged: value.activeManaged,
    channels: value.channels, supervisor: value.supervisor,
    resident: { ...resident }, // runtime-solidified, read-only; no handles
    recent: Array.isArray(recent) ? recent : [],
  };
}

export function installChannelsRoute(ctx, { runtime, diagnostics } = {}) {
  if (typeof ctx.inject !== 'function') return;
  // Same host registration/auth boundary as settings and preflight.
  ctx.inject(['webServer'], inner => {
    const server = inner.get('webServer');
    if (!server || typeof server.register !== 'function') return;
    inner.effect(() => server.register({
      kind: 'exact', path: '/dsh-devtunnel-ssh/channels',
      handler: async (req, res) => {
        const reply = (status, data) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(data));
        };
        if (!['GET', 'POST'].includes(req.method)) {
          res.setHeader('Allow', 'GET, POST');
          return reply(405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
        }
        try {
          if (!runtime || typeof runtime.channelSnapshot !== 'function') throw settingsError('CHANNELS_UNAVAILABLE');
          const revision = diagnostics && Number.isSafeInteger(diagnostics.revision) ? diagnostics.revision : 0;
          if (req.method === 'GET') {
            const recent = typeof diagnostics?.snapshot === 'function' ? diagnostics.snapshot() : [];
            return reply(200, publicSnapshot(runtime.channelSnapshot(), revision, recent));
          }
          const body = await readBody(req);
          if (typeof runtime.channelCommand !== 'function') throw settingsError('CHANNELS_UNAVAILABLE');
          const channelId = await runtime.channelCommand(body);
          const recent = typeof diagnostics?.snapshot === 'function' ? diagnostics.snapshot() : [];
          return reply(200, { ...publicSnapshot(runtime.channelSnapshot(), revision, recent), channelId });
        } catch (error) {
          const code = ERROR_STATUS.has(error?.code) ? error.code : 'CHANNELS_UNAVAILABLE';
          return reply(ERROR_STATUS.get(code), { ok: false, error: code });
        }
      },
    }));
  });
}
