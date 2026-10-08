// Experimental fixture adapter. No reconnect/replay, login, process lookup or SSH I/O.
import { spawn as nodeSpawn } from 'node:child_process';
import { connectCommand } from './cli-policy.js';
import { ownProcess } from './owned-process.js';
import { createForwardingParser } from './output-parser.js';

const fail = code => Object.assign(new Error(code), { code });
const bounded = (n, max) => Number.isSafeInteger(n) && n >= 1 && n <= max;

export async function startManagedConnect(options = {}) {
  let command, remotePort, spawn, signal, startupTimeoutMs, graceMs, killMs;
  try {
    ({ remotePort, spawn = nodeSpawn, signal, startupTimeoutMs = 10000,
      graceMs = 1000, killMs = 1000 } = options);
    command = connectCommand({ executable: options.executable, tunnelId: options.tunnelId });
    if (!bounded(remotePort, 65535) || typeof spawn !== 'function'
        || !bounded(startupTimeoutMs, 120000) || !bounded(graceMs, 30000) || !bounded(killMs, 30000)
        || (signal !== undefined && !(signal instanceof AbortSignal))) throw 0;
  } catch { throw fail('INVALID_MANAGED_CONFIG'); }
  if (signal?.aborted) throw fail('CONNECT_ABORTED');

  let child;
  try {
    child = spawn(command.executable, [...command.args], {
      shell: false, stdio: ['ignore', 'pipe', 'pipe'], detached: false,
    });
  } catch { throw fail('CONNECT_SPAWN_FAILED'); }

  let resolveDone, resolveClosed, resolveReady, rejectReady;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  let owner, endpoint = null, invalid = false, delivered = false, timer, cleanupTask, cleanupFailed = false;
  let bytes = 0, publicCloseTask;
  function close() {
    if (!publicCloseTask) publicCloseTask = cleanup('CONNECT_CLOSED').then(() => {
      if (cleanupFailed) throw fail('CONNECT_CLEANUP_FAILED');
    });
    return publicCloseTask;
  }
  const listeners = [];
  function listen(emitter, name, fn) {
    if (!emitter || typeof emitter.on !== 'function' || typeof emitter.removeListener !== 'function') throw 0;
    emitter.on(name, fn); listeners.push([emitter, name, fn]);
  }
  function detach() {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    for (const [emitter, name, fn] of listeners.splice(0)) emitter.removeListener(name, fn);
  }
  function invalidate(code) {
    if (invalid) return;
    invalid = true; endpoint = null; clearTimeout(timer);
    resolveClosed(Object.freeze({ reason: code }));
    // Rejection is delayed until cleanup is bounded and complete.
  }
  function cleanup(code) {
    invalidate(code);
    if (!cleanupTask) {
      cleanupTask = (async () => {
        try { await owner?.close(); }
        catch { cleanupFailed = true; code = 'CONNECT_CLEANUP_FAILED'; }
        finally { detach(); }
        if (!delivered) rejectReady(fail(code));
      })();
    }
    return cleanupTask;
  }
  function onAbort() { void cleanup('CONNECT_ABORTED'); }
  function onForwarding(value) {
    if (invalid || signal?.aborted || value?.remotePort !== remotePort
        || !['127.0.0.1', '::1'].includes(value.host) || !bounded(value.port, 65535)) return;
    // Commit after synchronous output/error events have had a chance to invalidate.
    queueMicrotask(() => {
      if (invalid || signal?.aborted || delivered) return;
      delivered = true; clearTimeout(timer);
      endpoint = Object.freeze({ host: value.host, port: value.port });
      resolveReady(Object.freeze({ get endpoint() { return endpoint; }, closed, close }));
    });
  }
  try {
    if (!child || typeof child.kill !== 'function') throw 0;
    owner = ownProcess({ done, terminate: value => child.kill(value) }, { graceMs, killMs });
    listen(child, 'exit', () => { resolveDone(); void cleanup('CONNECT_EXITED'); });
    listen(child, 'close', () => { resolveDone(); void cleanup('CONNECT_EXITED'); });
    listen(child, 'error', () => {
      // Node emits spawn errors with no PID, then close; do not infer a live child.
      if (child.pid === undefined) resolveDone();
      void cleanup('CONNECT_SPAWN_FAILED');
    });
    for (const stream of [child.stdout, child.stderr]) {
      const parser = createForwardingParser({ remotePort, onForwarding });
      listen(stream, 'data', chunk => {
        if (invalid) return;
        try {
          bytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
          if (bytes > 256 * 1024) throw 0;
          parser.push(chunk);
        } catch { void cleanup('CONNECT_OUTPUT_REJECTED'); }
      });
      listen(stream, 'end', () => {
        if (!invalid) try { parser.finish(); } catch { void cleanup('CONNECT_OUTPUT_REJECTED'); }
      });
      listen(stream, 'error', () => { void cleanup('CONNECT_OUTPUT_REJECTED'); });
    }
    timer = setTimeout(() => { void cleanup('CONNECT_STARTUP_TIMEOUT'); }, startupTimeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  } catch { await cleanup('CONNECT_ADAPTER_FAILED'); }
  return ready;
}
