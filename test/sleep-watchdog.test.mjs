import test from 'node:test';
import assert from 'node:assert/strict';
import { createSleepWatchdog } from '../lib/util/sleep-watchdog.js';

test('watchdog fires resume only when the wall-clock gap exceeds the threshold', async () => {
  let clock = 1000;
  const resumes = [];
  const watchdog = createSleepWatchdog({ now: () => clock, intervalMs: 10, gapMs: 50,
    onResume: gap => resumes.push(gap) });
  watchdog.start();
  // Steady heartbeats carry only the interval; no resume.
  for (let i = 0; i < 5; i++) { clock += 10; await new Promise(r => setTimeout(r, 5)); }
  assert.equal(resumes.length, 0);
  // A long suspended gap (lid close / power loss + resume) fires once.
  clock += 70 * 60 * 1000;
  await new Promise(r => setTimeout(r, 15));
  assert.equal(resumes.length, 1);
  assert.ok(resumes[0] >= 70 * 60 * 1000 && resumes[0] < 70 * 60 * 1000 + 1000,
    `gap ${resumes[0]} reports the suspended duration plus at most one heartbeat interval`);
  // Back to steady state: no further fires.
  for (let i = 0; i < 5; i++) { clock += 10; await new Promise(r => setTimeout(r, 5)); }
  assert.equal(resumes.length, 1);
  watchdog.stop();
});

test('watchdog never restarts once stopped and tolerates throwing handlers', async () => {
  let clock = 0, fired = 0;
  const watchdog = createSleepWatchdog({ now: () => clock, intervalMs: 5, gapMs: 10,
    onResume: () => { fired++; throw new Error('handler failure must not escape'); } });
  watchdog.start();
  clock += 100;
  await new Promise(r => setTimeout(r, 15));
  assert.equal(fired, 1);
  watchdog.stop();
  const count = fired;
  clock += 500;
  await new Promise(r => setTimeout(r, 20));
  assert.equal(fired, count);
});

test('watchdog rejects invalid configuration', () => {
  for (const bad of [
    { intervalMs: 0 }, { gapMs: -1 }, { onResume: null }, { now: 42 },
    { intervalMs: 1.5 }, { gapMs: Number.NaN },
  ]) assert.throws(() => createSleepWatchdog({ intervalMs: 10, gapMs: 20, now: () => 0, onResume: () => {}, ...bad }),
    /INVALID_WATCHDOG_CONFIG/);
});

test('watchdog start is idempotent and reset the baseline on start', async () => {
  let clock = 100, resumes = 0;
  const watchdog = createSleepWatchdog({ now: () => clock, intervalMs: 10, gapMs: 30,
    onResume: () => resumes++ });
  watchdog.start();
  // Starting twice must not double the interval ticks nor fire from history.
  watchdog.start();
  await new Promise(r => setTimeout(r, 25));
  assert.equal(resumes, 0, 'baseline reset at start must swallow the old gap');
  watchdog.stop();
});