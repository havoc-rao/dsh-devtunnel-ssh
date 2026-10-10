// Owned CLI adapter. Reconnect policy lives in managed-supervisor; never replay SSH I/O.
import { spawn as nodeSpawn } from 'node:child_process';
import { connectCommand } from '../util/cli-policy.js';
import { ownProcess } from '../util/owned-process.js';
import { createForwardingParser } from '../util/output-parser.js';

const fail = code => Object.assign(new Error(code), { code });
const bounded = (n, max) => Number.isSafeInteger(n) && n >= 1 && n <= max;
// A user-requested stop is not a failure; everything else is worth a report.
const INTENTIONAL = new Set(['CONNECT_CLOSED', 'CONNECT_ABORTED']);
const MAX_SAMPLE_LINES = 3;

export async function startManagedConnect(options = {}) {
  let command, remotePort, spawn, signal, startupTimeoutMs, graceMs, killMs, diagnostics;
  try {
    ({ remotePort, spawn = nodeSpawn, signal, startupTimeoutMs = 10000,
      graceMs = 1000, killMs = 1000, diagnostics } = options);
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

  // ── diagnostics ───────────────────────────────────────────────────────────
  // Nothing observed here is ever logged raw: every report goes through the
  // diagnostics sink, which masks URLs/tokens/long runs and bounds line count.
  // A missing, broken or throwing sink never affects the connect path.
  const report = entry => {
    try { diagnostics?.record?.({ mode: 'managed', tunnelId: options.tunnelId, executable: command.executable, remotePort, ...entry }); }
    catch { /* diagnostics are best effort */ }
  };
  const observed = new Map();
  function observeStream(label) {
    const state = { lines: 0, bytes: 0, sample: [], sawForwarding: false, failureReason: undefined };
    observed.set(label, state);
    return event => {
      if (!event || typeof event.text !== 'string') return;
      state.lines += 1;
      state.bytes += Buffer.byteLength(event.text);
      if (event.kind === 'forwarding' || event.kind === 'unsupported' || event.kind === 'other-port') state.sawForwarding = true;
      if (event.reason !== undefined) state.failureReason = event.reason;
      state.sample.push(event.text);
      while (state.sample.length > MAX_SAMPLE_LINES) state.sample.shift();
    };
  }
  let lastFailure;
  function markFailure(label, error) {
    const state = observed.get(label);
    lastFailure = {
      stream: label,
      reason: typeof error?.reason === 'string' ? error.reason : (state?.failureReason ?? 'UNKNOWN'),
    };
  }
  function samplesOf(stream) {
    if (stream !== undefined && observed.has(stream)) return observed.get(stream).sample;
    return [...observed.values()].flatMap(state => state.sample).slice(-MAX_SAMPLE_LINES);
  }
  function reportRejection(code) {
    if (INTENTIONAL.has(code)) return;
    let stream = lastFailure?.stream;
    let reason = lastFailure?.reason;
    // A timeout can be explained by an observed-but-unmatched forwarding line
    // (e.g. the CLI forwarded another remote port) without any thrown error.
    if (reason === undefined) {
      for (const [label, state] of observed) {
        if (state.failureReason !== undefined) { stream = label; reason = state.failureReason; break; }
      }
    }
    const state = stream === undefined ? undefined : observed.get(stream);
    report({
      code, stream, reason,
      lines: state?.lines, bytes: state?.bytes, sawForwarding: state?.sawForwarding,
      sample: samplesOf(stream),
    });
  }

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
      reportRejection(code);
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
  let matchedStream;
  function onForwarding(label, value) {
    if (invalid || signal?.aborted || value?.remotePort !== remotePort
        || !['127.0.0.1', '::1'].includes(value.host) || !bounded(value.port, 65535)) return;
    // In-process remapping must invalidate the old SSH generation too. IPv4 /
    // IPv6 announcements of the same port are benign duplicate listeners.
    if (delivered && endpoint?.port !== value.port) {
      void cleanup('CONNECT_EXITED');
      return;
    }
    matchedStream = label;
    // Commit after synchronous output/error events have had a chance to invalidate.
    queueMicrotask(() => {
      if (invalid || signal?.aborted) return;
      if (delivered) {
        if (endpoint?.port !== value.port) void cleanup('CONNECT_EXITED');
        return;
      }
      delivered = true; clearTimeout(timer);
      endpoint = Object.freeze({ host: value.host, port: value.port });
      const state = observed.get(label);
      report({
        code: 'CONNECT_READY', stream: label, reason: 'FORWARDING_MATCHED', endpoint,
        lines: state?.lines, bytes: state?.bytes, sawForwarding: true, sample: samplesOf(label),
      });
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
    for (const [label, stream] of [['stdout', child.stdout], ['stderr', child.stderr]]) {
      const parser = createForwardingParser({
        remotePort, streaming: true, observe: observeStream(label),
        onForwarding: value => onForwarding(label, value),
      });
      listen(stream, 'data', chunk => {
        if (invalid) return;
        try {
          if (!delivered) {
            bytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
            if (bytes > 256 * 1024) throw 0;
          }
          // No lifetime byte quota for a long-running owned channel. Parser
          // still bounds individual lines and pending buffers; the raw text is
          // never logged — only masked diagnostics leave this module.
          parser.push(chunk);
        } catch (error) { markFailure(label, error); void cleanup('CONNECT_OUTPUT_REJECTED'); }
      });
      listen(stream, 'end', () => {
        if (!invalid) {
          try { parser.finish(); }
          catch (error) { markFailure(label, error); void cleanup('CONNECT_OUTPUT_REJECTED'); }
        }
      });
      listen(stream, 'error', () => { markFailure(label, { reason: 'STREAM_ERROR' }); void cleanup('CONNECT_OUTPUT_REJECTED'); });
    }
    timer = setTimeout(() => { void cleanup('CONNECT_STARTUP_TIMEOUT'); }, startupTimeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  } catch { await cleanup('CONNECT_ADAPTER_FAILED'); }
  return ready;
}
