// Sleep/resume detection without any host API: a periodic heartbeat whose
// wall-clock gap far exceeds its own interval implies the event loop was
// suspended (lid close, power loss with suspend/resume, deep sleep). Pure Node
// timers only, so the plugin never depends on host power events. A gap can
// also be caused by a large forward clock adjustment; recovery treats both
// the same (bounded, per-channel, documented).
export function createSleepWatchdog({ now = Date.now, intervalMs = 30000, gapMs = 5 * 60 * 1000, onResume } = {}) {
  const valid = value => Number.isSafeInteger(value) && value > 0;
  if (!valid(intervalMs) || !valid(gapMs) || typeof now !== 'function' || typeof onResume !== 'function') {
    throw Object.assign(new Error('INVALID_WATCHDOG_CONFIG'), { code: 'INVALID_WATCHDOG_CONFIG' });
  }
  let timer = null, running = false, last = now();
  function heart() {
    const current = now();
    const gap = current - last;
    last = current;
    if (gap >= gapMs) {
      try { onResume(gap); } catch { /* recovery must never throw into the timer */ }
    }
  }
  return Object.freeze({
    start() {
      if (running) return;
      running = true;
      last = now();
      timer = setInterval(heart, intervalMs);
      // Never keep the host process alive just for recovery.
      if (timer && typeof timer.unref === 'function') timer.unref();
    },
    stop() {
      if (!running) return;
      running = false;
      clearInterval(timer);
      timer = null;
    },
    get running() { return running; },
  });
}