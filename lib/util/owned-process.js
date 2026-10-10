// Pre-Step0 fixture: owns only an explicitly supplied handle, never a PID lookup.
// Adapter must bind terminate to its own child and settle done on actual exit.
// This is not a CLI readiness parser, process-tree implementation or SSH adapter.
import { isPromise } from 'node:util/types';
const failure = code => Object.assign(new Error(code), { code });
export function ownProcess(handle, { graceMs = 1000, killMs = 1000 } = {}) {
  if (!Number.isSafeInteger(graceMs) || graceMs < 1 || graceMs > 30000
      || !Number.isSafeInteger(killMs) || killMs < 1 || killMs > 30000) throw failure('INVALID_TIMEOUT');
  let done, terminate;
  try {
    done = handle.done;
    terminate = handle.terminate;
    if (!isPromise(done) || typeof terminate !== 'function') throw 0;
  } catch { throw failure('INVALID_PROCESS_HANDLE'); }
  let exited = false, failed = false, closeTask;
  const exit = Promise.prototype.then.call(done,
    () => { exited = true; },
    () => { failed = true; });
  async function wait(ms) {
    let timer;
    try {
      await Promise.race([exit, new Promise(resolve => { timer = setTimeout(resolve, ms); })]);
    } finally { clearTimeout(timer); }
    if (failed) throw failure('EXIT_UNCONFIRMED');
    return exited;
  }
  function signal(value) {
    try {
      // A signal request is not exit confirmation; never expose adapter errors.
      Promise.resolve(terminate.call(handle, value)).catch(() => {});
    } catch { /* Still wait for exit, then escalate within the bounded budget. */ }
  }
  return Object.freeze({
    get exited() { return exited; },
    close() {
      if (closeTask) return closeTask;
      closeTask = (async () => {
        // Observe already-settled done before attempting to signal.
        await Promise.resolve();
        if (failed) throw failure('EXIT_UNCONFIRMED');
        if (exited) return;
        signal('SIGTERM');
        if (await wait(graceMs)) return;
        signal('SIGKILL');
        if (!await wait(killMs)) throw failure('PROCESS_EXIT_TIMEOUT');
      })();
      return closeTask;
    },
  });
}
