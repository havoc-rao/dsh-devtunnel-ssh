import { settingsError, validateSettings } from '../util/settings-store.js';
import { queryDiagnostics } from '../util/diagnostics-query.js';

const ERROR_STATUS = new Map([
  ['SETTINGS_REJECTED', 400],
  ['SETTINGS_CONFIRM_REQUIRED', 400],
  ['SETTINGS_REVISION_CONFLICT', 409],
  ['SETTINGS_BUSY', 409],
  ['SETTINGS_ACTIVE_CONFIRM_REQUIRED', 409],
  ['SETTINGS_UNAVAILABLE', 503],
  ['SETTINGS_CLEANUP_FAILED', 503],
]);
const POST_KEYS = ['cliExecutable', 'managedEnabled', 'residentTunnelId', 'residentRemotePort', 'residentMode', 'confirmed', 'disconnectActive', 'revision'];
async function readBody(req) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 8192) throw settingsError('SETTINGS_REJECTED');
    chunks.push(buffer);
  }
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes))); }
  catch { throw settingsError('SETTINGS_REJECTED'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== POST_KEYS.length
      || Object.keys(body).some(key => !POST_KEYS.includes(key))
      || body.confirmed !== true || typeof body.disconnectActive !== 'boolean'
      || !Number.isSafeInteger(body.revision) || body.revision < 0) {
    throw settingsError('SETTINGS_REJECTED');
  }
  validateSettings({ cliExecutable: body.cliExecutable, managedEnabled: body.managedEnabled,
    residentTunnelId: body.residentTunnelId, residentRemotePort: body.residentRemotePort,
    residentMode: body.residentMode });
  return body;
}
function publicSnapshot(value) {
  // Runtime may hold private state: never serialize anything except this public contract.
  if (!value || !['settings', 'config'].includes(value.source)
      || !Number.isSafeInteger(value.revision)
      || value.revision < (value.source === 'settings' ? 1 : 0)) throw settingsError('SETTINGS_UNAVAILABLE');
  const settings = validateSettings({ cliExecutable: value.settings?.cliExecutable, managedEnabled: value.settings?.managedEnabled,
    residentTunnelId: value.settings?.residentTunnelId, residentRemotePort: value.settings?.residentRemotePort,
    residentMode: value.settings?.residentMode });
  const result = { settings, revision: value.revision, source: value.source };
  if (value.activeManaged !== undefined) {
    if (!Number.isSafeInteger(value.activeManaged) || value.activeManaged < 0) throw settingsError('SETTINGS_UNAVAILABLE');
    result.activeManaged = value.activeManaged;
  }
  if (value.available !== undefined) {
    if (typeof value.available !== 'boolean') throw settingsError('SETTINGS_UNAVAILABLE');
    result.available = value.available;
  }
  if(value.cli !== undefined){
    const cli=value.cli;
    if(!cli || !['found','not-found'].includes(cli.status) || !['path','override'].includes(cli.source)
      || typeof cli.resolvedExecutable !== 'string' || cli.resolvedExecutable.length>4096
      || /[\u0000-\u001f\u007f-\u009f]/u.test(cli.resolvedExecutable)
      || (cli.status==='found' ? !cli.resolvedExecutable.startsWith('/') : cli.resolvedExecutable!==''))throw settingsError('SETTINGS_UNAVAILABLE');
    result.cli={status:cli.status,source:cli.source,resolvedExecutable:cli.resolvedExecutable};
  }
  return result;
}
export function installSettingsRoute(ctx, { runtime } = {}) {
  if (typeof ctx.inject !== 'function') return;
  // The same host registration/auth boundary as preflight-route; do not bypass it.
  ctx.inject(['webServer'], inner => {
    const server = inner.get('webServer');
    if (!server || typeof server.register !== 'function') return;
    inner.effect(() => server.register({
      kind: 'exact', path: '/dsh-devtunnel-ssh/settings',
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
          if (!runtime || typeof runtime.snapshot !== 'function' || typeof runtime.update !== 'function') {
            throw settingsError('SETTINGS_UNAVAILABLE');
          }
          const snapshot = req.method === 'GET' ? await runtime.snapshot() : await runtime.update(await readBody(req));
          return reply(200, { ok: true, ...publicSnapshot(snapshot) });
        } catch (error) {
          const code = ERROR_STATUS.has(error?.code) ? error.code : 'SETTINGS_UNAVAILABLE';
          return reply(ERROR_STATUS.get(code), { ok: false, error: code });
        }
      },
    }));
  });
}

/**
 * Read-only managed-connect diagnostics for the browser console. Entries are
 * already masked by connect-diagnostics before they reach the sink, so no raw
 * CLI output can cross this route.
 */
export function installDiagnosticsRoute(ctx, { diagnostics } = {}) {
  if (typeof ctx.inject !== 'function') return;
  ctx.inject(['webServer'], inner => {
    const server = inner.get('webServer');
    if (!server || typeof server.register !== 'function') return;
    inner.effect(() => server.register({
      kind: 'exact', path: '/dsh-devtunnel-ssh/diagnostics',
      handler: async (req, res) => {
        const reply = (status, data) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(data));
        };
        if (req.method !== 'GET') {
          res.setHeader('Allow', 'GET');
          return reply(405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
        }
        try {
          if (!diagnostics || typeof diagnostics.snapshot !== 'function' || !Number.isSafeInteger(diagnostics.revision)) {
            throw settingsError('SETTINGS_UNAVAILABLE');
          }
          return reply(200, queryDiagnostics(diagnostics, req.url));
        } catch (error) {
          if (error?.message === 'DIAGNOSTICS_QUERY_REJECTED') return reply(400, { ok: false, error: 'DIAGNOSTICS_QUERY_REJECTED' });
          return reply(503, { ok: false, error: 'DIAGNOSTICS_UNAVAILABLE' });
        }
      },
    }));
  });
}
