import { createCarrier } from './carrier.js';
// Explicitly inject the verified public dsh-remote/lib/ssh-carrier.js API.
// Registry/factory support is NOT ordinary workspace CRUD/mirror/PTY readiness.
// No startup connection or localhost fallback.
export function registerCarrierWhenAvailable(api, options) {
  let register;
  try { register = api?.registerSshCarrier; } catch { /* Broken optional API is unavailable. */ }
  if (typeof register !== 'function') {
    return Object.freeze({ status: 'ssh-api-required', ordinaryWorkspaceReady: false, dispose: async () => {} });
  }
  const carrier = createCarrier(options);
  let unregister;
  try { unregister = register.call(api, carrier); }
  catch { void carrier.dispose().catch(() => {}); return Object.freeze({ status: 'registration-unavailable', ordinaryWorkspaceReady: false, dispose: async () => {} }); }
  let task;
  return Object.freeze({ status: 'registered-experimental', ordinaryWorkspaceReady: false, dispose() {
    if (!task) task = (async () => {
      try { if (typeof unregister === 'function') await unregister(); }
      finally { await carrier.dispose(); }
    })();
    return task;
  } });
}
