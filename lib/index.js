import { registerCarrierWhenAvailable } from './registration.js';
import { installPreflightRoute } from './preflight-route.js';
import Schema from '@deepseek-ai/schemastery';
// macOS-first: empty disables preflight; only literal POSIX absolute host paths.
export const Config = Schema.object({
  cliExecutable: Schema.string().pattern(/^(?:|\/[^\x00-\x1f\x7f]*)(?![\s\S])/u).default('')
    .description('官方 devtunnel 的宿主绝对路径；空值禁用预检。不搜索PATH、不自动登录。'),
});
export const name = 'dsh-devtunnel-ssh';
export const inject = [];

// Only verified public optional subpath. No internal cache/record imports at runtime.
export async function loadCarrierApi(load = () => import('dsh-remote/lib/ssh-carrier.js')) {
  try { return await load(); } catch { return undefined; }
}
export async function applyWithLoader(ctx, load) {
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
  const registration = registerCarrierWhenAvailable(api);
  ctx.effect(() => () => registration.dispose());
  const commands = ctx.get('commands');
  if (!commands || typeof commands.register !== 'function') return;
  ctx.effect(() => commands.register({
    name: 'devtunnel-ssh-status',
    description: '显示实验 Dev Tunnel SSH 的前提与接口状态（不连接）',
    handler: async () => ({ kind: 'success', text: `Dev Tunnel SSH: ${registration.status}; experimentalRoutesImplemented=source-tested; experimentalWorkspaceSupported=false (authenticated runtime status not queried; use /dsh-remote/status); Step0 incomplete; ordinaryWorkspaceReady=false; productionReady=false. No connection started.` }),
  }));
  ctx.effect(() => commands.register({
    name: 'devtunnel-ssh-help',
    description: '显示官方CLI前提与external手工实验接线流程（不安装、不连接）',
    handler: async () => ({ kind: 'success', text: [
      'Dev Tunnel SSH — external/manual experimental workflow',
      '1. Both Macs: install official devtunnel CLI and manually sign in with GitHub. Remote Mac: authorized sshd and independently confirmed SHA256 host pin.',
      '2. On the DSH host run your own devtunnel connect with an explicit tunnel ID. Read the actual loopback port forwarded to remote port 22; it may change after restart.',
      '3. In a user-approved isolated sandbox, explicitly enable dsh-remote experimentalSshCarrier. Installation does not enable this config.',
      '4. Use the sandbox host authenticated API per the bundled MANUAL.md: add external connector + current endpoint + pin + useAgent, fresh probe, then mirror bind. Never bypass host authentication or write registry files.',
      '5. Verify the DSH host agent credentials, actual remote identity and file/PTY operations. Update connector explicitly after port rotation; target/pin changes require new trust.',
      '6. Delete the sandbox machine and verify cleanup. External CLI remains user-owned; this plugin does not stop it.',
      'Managed CLI is not enabled by this entry. No connection/config change was performed. GUI/production ready=false.',
    ].join('\n') }),
  }));
}
export async function apply(ctx, config = {}) {
  installPreflightRoute(ctx, { executable: config.cliExecutable });
  return applyWithLoader(ctx);
}
