// Experimental pre-Step0 policy. No spawn, credentials, discovery, or network I/O.
import { isAbsolute } from 'node:path';

export const CLI_BASELINE = '1.0.2086+eb5ddeb517';

// connect --help on the baseline exposes no local/remote port remap switch.
// Restrict to an explicit tunnel ID; never fall back to the CLI's last-used tunnel.
export function connectCommand(config) {
  // Read data descriptors, not getters. Reject unknown/symbol fields as well as
  // inherited configs; normalize even Proxy trap failures without leaking text.
  try {
    if (!config || ![Object.prototype, null].includes(Object.getPrototypeOf(config))) throw 0;
    const descriptors = Object.getOwnPropertyDescriptors(config);
    if (Reflect.ownKeys(descriptors).length !== 2
        || !Object.hasOwn(descriptors, 'executable') || !Object.hasOwn(descriptors, 'tunnelId')
        || !Object.hasOwn(descriptors.executable, 'value') || !Object.hasOwn(descriptors.tunnelId, 'value')) throw 0;
    const { value: executable } = descriptors.executable;
    const { value: tunnelId } = descriptors.tunnelId;
    if (typeof executable !== 'string' || !isAbsolute(executable)
        || /[\x00-\x1f\x7f]/u.test(executable)
        || typeof tunnelId !== 'string'
        || !/^[a-z0-9][a-z0-9-]{0,99}(?:\.[a-z0-9]{1,20})?(?![\s\S])/u.test(tunnelId)) throw 0;
    return Object.freeze({ executable, args: Object.freeze(['connect', tunnelId]), shell: false });
  } catch {
    throw new Error('INVALID_CONNECT_CONFIG');
  }
}

// No raw errors/stdout/account identity in UI. TCP reachability is not SSH trust.
export function publicStatus(state) {
  const allowed = new Set(['idle', 'starting', 'unavailable', 'closed', 'step0-required', 'ssh-api-required']);
  return Object.freeze({ state: allowed.has(state) ? state : 'unavailable', productionReady: false });
}
