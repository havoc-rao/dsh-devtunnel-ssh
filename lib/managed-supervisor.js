// Opt-in starter only: no SSH replay, endpoint mutation, or background reconnect.
import { isPromise } from 'node:util/types';
import { startManagedConnect } from './managed-connect.js';
import { connectCommand } from './cli-policy.js';

const fail = code => Object.assign(new Error(code), { code });
const retryable = code => ['CONNECT_EXITED', 'CONNECT_STARTUP_TIMEOUT'].includes(code);
const intentional = code => ['CONNECT_ABORTED', 'CONNECT_CLOSED'].includes(code);
const codeOf = error => typeof error?.code === 'string' && /^[A-Z_]+$/.test(error.code)
  ? error.code : 'CONNECT_ADAPTER_FAILED';

function waitUntil(deadline, signal) {
  if (signal?.aborted) return Promise.reject(fail('CONNECT_ABORTED'));
  const remaining = Math.max(0, deadline - Date.now());
  if (!remaining) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve();
    };
    const abort = () => finish(fail('CONNECT_ABORTED'));
    const timer = setTimeout(() => finish(), remaining);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

/**
 * The adapter owns cleanup on rejected start; a returned handle transfers it here.
 * State is scoped to this factory and target, NOT machineId or acquire invocation.
 * A live target rejects concurrent starts (carrier owns reference sharing).
 * Failed cleanup poisons that target permanently: no uncertain process overlap.
 */
export function createManagedStarter({ executable, start = startManagedConnect, diagnostics,
  retryDelaysMs = [500, 1500, 4000], stableMs = 30000 } = {}) {
  if (typeof start !== 'function' || !Array.isArray(retryDelaysMs)
      || retryDelaysMs.length > 3
      || Array.from(retryDelaysMs).some(n => !Number.isSafeInteger(n) || n < 0 || n > 120000)
      || !Number.isSafeInteger(stableMs) || stableMs < 1) throw fail('INVALID_MANAGED_CONFIG');
  const delays = [...retryDelaysMs];
  const targets = new Map();
  // Best-effort only: diagnostics must never change retry/cleanup semantics.
  const report = entry => { try { diagnostics?.record?.(entry); } catch { /* ignored */ } };
  const managedStarter = async function managedStarter(opts = {}) {
    let tunnelId, remotePort, signal;
    try {
      ({ tunnelId, remotePort, signal } = opts);
      connectCommand({ executable, tunnelId });
      if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535
          || (signal !== undefined && !(signal instanceof AbortSignal))) throw 0;
    } catch { throw fail('INVALID_MANAGED_CONFIG'); }
    if (signal?.aborted) throw fail('CONNECT_ABORTED');
    const key = JSON.stringify([tunnelId, remotePort]);
    let state = targets.get(key);
    if (!state) {
      state = { failures: 0, cooldown: 0, blocked: null, pending: false, active: null };
      targets.set(key, state);
    }
    if (state.pending || (state.active && !state.active.invalid)) throw fail('CONNECT_TARGET_BUSY');
    state.pending = true; // Reserve before the first await, including cleanup waits.
    function resetIfStable(entry) {
      if (Date.now() - entry.readyAt >= stableMs) {
        state.failures = 0;
        state.cooldown = 0;
      }
    }
    function record(code) {
      if (intentional(code)) return;
      if (!retryable(code)) { state.blocked = code; return; }
      state.failures++;
      state.cooldown = Date.now() + (delays[state.failures - 1] ?? 0);
    }
    try {
      if (state.active) await state.active.cleanup();
      for (;;) {
        if (signal?.aborted) throw fail('CONNECT_ABORTED');
        if (state.blocked) throw fail(state.blocked);
        if (state.failures > delays.length) {
          report({ code: 'CONNECT_RETRY_EXHAUSTED', reason: 'RETRY_EXHAUSTED', attempt: state.failures, tunnelId, remotePort });
          throw fail('CONNECT_RETRY_EXHAUSTED');
        }
        await waitUntil(state.cooldown, signal);
        if (signal?.aborted) throw fail('CONNECT_ABORTED');
        let raw;
        try { raw = await start({ ...opts, executable, tunnelId, remotePort, signal, diagnostics }); }
        catch (error) {
          const code = codeOf(error);
          // Cleanup failure is never hidden by a concurrent cancellation.
          if (code === 'CONNECT_CLEANUP_FAILED') state.blocked = code;
          if (signal?.aborted && code !== 'CONNECT_CLEANUP_FAILED') throw fail('CONNECT_ABORTED');
          report({ code: 'CONNECT_ATTEMPT_FAILED', reason: code, attempt: state.failures + 1, tunnelId, remotePort });
          record(code);
          if (!retryable(code)) throw fail(code);
          continue;
        }
        let close;
        const entry = { invalid: false, deliberate: false, readyAt: Date.now(), cleanupTask: null };
        entry.cleanup = () => {
          entry.invalid = true;
          if (!entry.cleanupTask) {
            entry.cleanupTask = Promise.resolve().then(() => close.call(raw)).catch(() => {
              state.blocked = 'CONNECT_CLEANUP_FAILED';
              throw fail('CONNECT_CLEANUP_FAILED');
            }).finally(() => {
              signal?.removeEventListener('abort', abort);
              if (state.active === entry) state.active = null;
            });
          }
          return entry.cleanupTask;
        };
        const publicClose = () => {
          if (!entry.invalid) { entry.deliberate = true; resetIfStable(entry); }
          return entry.cleanup();
        };
        const abort = () => { void publicClose().catch(() => {}); };
        state.active = entry;
        let endpoint, closed;
        try {
          close = raw?.close;
          if (typeof close !== 'function') throw 0;
          closed = raw.closed;
          if (!isPromise(closed)) throw 0;
          const value = raw.endpoint;
          if (!value || !['127.0.0.1', '::1'].includes(value.host)
              || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw 0;
          endpoint = Object.freeze({ host: value.host, port: value.port });
        } catch {
          state.blocked = 'CONNECT_ADAPTER_FAILED';
          await entry.cleanup();
          throw fail('CONNECT_ADAPTER_FAILED');
        }
        const onClosed = value => {
          if (!entry.invalid) {
            entry.invalid = true;
            resetIfStable(entry);
            if (!entry.deliberate) record(value?.reason ?? 'CONNECT_ADAPTER_FAILED');
          }
          void entry.cleanup().catch(() => {});
        };
        // Observe before returning: old closed remains the carrier's invalidator.
        Promise.prototype.then.call(closed, onClosed, () => onClosed(null));
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) {
          await publicClose();
          throw fail('CONNECT_ABORTED');
        }
        return Object.freeze({ get endpoint() { return entry.invalid ? null : endpoint; },
          closed, close: publicClose });
      }
    } finally { state.pending = false; }
  };
  // Supervisor-owned retry/blocked state for the channel management panel:
  // identity, live generation, failure count and cooldown — no handles.
  managedStarter.list = () => [...targets.entries()].map(([key, state]) => {
    let tunnelId, remotePort;
    try { [tunnelId, remotePort] = JSON.parse(key); } catch { return null; }
    return { tunnelId, remotePort, active: !!(state.active && !state.active.invalid), pending: state.pending,
      failures: state.failures, blocked: state.blocked,
      cooldownUntil: state.cooldown > Date.now() ? state.cooldown : null };
  }).filter(Boolean);
  return managedStarter;
}
