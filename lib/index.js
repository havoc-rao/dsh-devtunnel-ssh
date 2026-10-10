import { registerCarrierWhenAvailable } from './core/registration.js';
import { installPreflightRoute } from './routes/preflight-route.js';
import Schema from '@deepseek-ai/schemastery';
import { createSettingsRuntime } from './core/settings-runtime.js';
import { createSettingsStore } from './util/settings-store.js';
import { installSettingsRoute, installDiagnosticsRoute } from './routes/settings-route.js';
import { installChannelsRoute } from './routes/channels-route.js';
import { createConnectDiagnostics, formatDiagnostic } from './util/connect-diagnostics.js';
import { homedir } from 'node:os';
import path from 'node:path';
// macOS-first: empty disables preflight; only literal POSIX absolute host paths.
export const Config = Schema.object({
  cliExecutable: Schema.string().pattern(/^(?:|\/[^\x00-\x1f\x7f]*)(?![\s\S])/u).default('')
    .description('官方 devtunnel 的可选宿主绝对路径覆盖；留空从宿主PATH检测。不自动安装或登录。'),
  managedEnabled: Schema.boolean().default(false)
    .description('明确授权插件按需启动和清理 devtunnel connect；动态端口自动获取，异常后受控按需重连。不安装或登录。'),
});
export const name = 'dsh-devtunnel-ssh';
export const inject = [];

// Only verified public optional subpath. No internal cache/record imports at runtime.
export async function loadCarrierApi(load = () => import('dsh-remote/lib/ssh-carrier.js')) {
  try { return await load(); } catch { return undefined; }
}
export async function applyWithLoader(ctx, load, options = {}) {
  // Do not acquire registration ownership if context cannot own its disposer.
  if (typeof ctx.effect !== 'function') return;
  // Explicit test/integration resolver wins. Otherwise use the host profile
  // Loader's public import so linked peers share the deployed registry namespace.
  let resolver = load;
  if (resolver === undefined) {
    let loader;
    try { loader = ctx.get('loader'); } catch { /* Optional service unavailable. */ }
    if (typeof loader?.import === 'function') {
      resolver = () => loader.import('dsh-remote/lib/ssh-carrier.js');
    }
  }
  const api = await loadCarrierApi(resolver);
  const registration = registerCarrierWhenAvailable(api, options);
  const mode = () => (options.capabilities?.managedConnect ?? typeof options.startManaged === 'function') ? 'managed-enabled (bounded on-demand reconnect)' : 'external/manual (managed disabled)';
  ctx.effect(() => () => registration.dispose());
  const commands = ctx.get('commands');
  if (!commands || typeof commands.register !== 'function') return;
  ctx.effect(() => commands.register({
    name: 'devtunnel-ssh-status',
    description: '显示实验 Dev Tunnel SSH 的前提与接口状态（不连接）',
    handler: async () => ({ kind: 'success', text: `Dev Tunnel SSH: ${registration.status}; ${mode()}; experimentalRoutesImplemented=source-tested; experimentalWorkspaceSupported=false (authenticated runtime status not queried; use /dsh-remote/status); Step0 incomplete; ordinaryWorkspaceReady=false; productionReady=false. No connection started.` }),
  }));
  ctx.effect(() => commands.register({
    name: 'devtunnel-ssh-help',
    description: '显示官方CLI前提与手动/托管实验接线流程（不安装、不连接）',
    handler: async () => ({ kind: 'success', text: [
      'Dev Tunnel SSH — external/manual experimental workflow',
      '1. Both Macs: install official devtunnel CLI and manually sign in with GitHub. Remote Mac: authorized sshd and independently confirmed SHA256 host pin.',
      '2. On the DSH host run your own devtunnel connect with an explicit tunnel ID. Read the actual loopback port forwarded to remote port 22; it may change after restart.',
      '3. In a user-approved isolated sandbox, explicitly enable dsh-remote experimentalSshCarrier. Installation does not enable this config.',
      '4. Use the sandbox host authenticated API per the bundled MANUAL.md: add external connector + current endpoint + pin + useAgent, fresh probe, then mirror bind. Never bypass host authentication or write registry files.',
      '5. Verify the DSH host agent credentials, actual remote identity and file/PTY operations. Update connector explicitly after port rotation; target/pin changes require new trust.',
      '6. Delete the sandbox machine and verify cleanup. External CLI remains user-owned; this plugin does not stop it.',
      `Managed: ${mode()}. CLI is detected from the host PATH by default; an absolute override is optional. Explicitly authorize managed mode in RemoteSettings.`,
      'Managed machines omit endpoint: the plugin reads the actual local port when connecting. Closed SSH/PTY operations are never replayed; subsequent connects retry with bounded backoff. Remote devtunnel host remains user-owned.',
      'No connection/config change was performed by this help command. GUI/production ready=false.',
    ].join('\n') }),
  }));
}
/**
 * Host console sink for managed-connect diagnostics. Entries are already masked
 * by connect-diagnostics; nothing raw is ever written. Prefers the Cordis
 * logger and falls back to the process console (host stdout/stderr).
 */
export function hostDiagnosticSink(ctx, output = console) {
  return entry => {
    const level = entry?.code === 'CONNECT_READY' ? 'info' : 'warn';
    const text = `[dsh-devtunnel-ssh] ${formatDiagnostic(entry)}`;
    try {
      const logger = ctx?.logger;
      if (logger && typeof logger[level] === 'function') { logger[level](text); return; }
    } catch { /* fall through to the process console */ }
    try { (level === 'info' ? output.info : output.warn).call(output, text); } catch { /* never throw from logging */ }
  };
}
export async function apply(ctx, config = {}) {
  if(typeof ctx.effect !== 'function')return;
  const cliExecutable = typeof config.cliExecutable === 'string'
    && /^\/[^\x00-\x1f\x7f]+(?![\s\S])/u.test(config.cliExecutable) ? config.cliExecutable : '';
  const home = process.env.DSH_HOME?.trim() || path.join(homedir(), '.dsh');
  const store = createSettingsStore({ directory: path.resolve(home, 'devtunnel-ssh'),
    defaults: { cliExecutable, managedEnabled: config.managedEnabled === true } });
  const diagnostics = createConnectDiagnostics({ sink: hostDiagnosticSink(ctx) });
  const runtime = await createSettingsRuntime({ store, diagnostics });
  ctx.effect(() => () => runtime.dispose());
  installSettingsRoute(ctx, { runtime });
  installDiagnosticsRoute(ctx, { diagnostics });
  installChannelsRoute(ctx, { runtime, diagnostics });
  installPreflightRoute(ctx, { runtime });
  return applyWithLoader(ctx, undefined, { getManagedStarter: runtime.getStarter,
    capabilities: runtime.capabilities, onCarrier: runtime.attachCarrier, diagnostics });
}
