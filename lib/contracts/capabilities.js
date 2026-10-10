// Parse the authenticated /dsh-remote/status JSON only. No request/auth bypass.
// Module registry existence is intentionally irrelevant to runtime opt-in.
export function detectCapabilities(status) {
  const unavailable = () => Object.freeze({ experimentalWorkspaceSupported: false,
    freshProbe: false, productionReady: false, additionalForwards: false,
    perWorkspaceDisconnect: false, devTunnelManaged: false,
    authModes: Object.freeze([]), schemaVersion: null });
  try {
    const descriptor = Object.getOwnPropertyDescriptor(status, 'sshCarrierCapabilities');
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return unavailable();
    const raw = descriptor.value;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return unavailable();
    const d = Object.getOwnPropertyDescriptors(raw);
    const read = key => Object.hasOwn(d[key] ?? {}, 'value') ? d[key].value : undefined;
    if (read('apiVersion') !== 1 || read('experimental') !== true || read('schemaVersion') !== 3) return unavailable();
    const supported = read('workspaceSupported') === true;
    const modes = read('authModes');
    const authModes = Array.isArray(modes) ? [...new Set(modes.filter(m => m === 'agent' || m === 'private-key'))] : [];
    return Object.freeze({ experimentalWorkspaceSupported: supported,
      freshProbe: supported && read('freshProbe') === true,
      productionReady: false, // Never promote production based on experiment status.
      additionalForwards: false, perWorkspaceDisconnect: false,
      devTunnelManaged: supported && read('devTunnelManaged') === true,
      authModes: Object.freeze(authModes), schemaVersion: 3 });
  } catch { return unavailable(); }
}
