import test from 'node:test';
import assert from 'node:assert/strict';
import { ownProcess } from '../lib/util/owned-process.js';
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const budget = { graceMs: 5, killMs: 5 };
test('close is single-flight and signals only the supplied handle', async () => {
  const d = deferred(), signals = [];
  const process = ownProcess({ done: d.promise, terminate(signal) { signals.push(signal); d.resolve(); } }, budget);
  const first = process.close(); assert.equal(first, process.close());
  await first; assert.deepEqual(signals, ['SIGTERM']); assert.equal(process.exited, true);
});
test('already exited process is never signalled', async () => {
  const process = ownProcess({ done: Promise.resolve(), terminate() { assert.fail('unowned signal'); } }, budget);
  await process.close();
});
test('TERM escalates once to KILL and waits for confirmed exit', async () => {
  const d = deferred(), signals = [];
  const process = ownProcess({ done: d.promise, terminate(signal) { signals.push(signal); if (signal === 'SIGKILL') d.resolve(); } }, budget);
  await process.close(); assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});
test('unconfirmed exit fails closed after bounded waits, with no repeated cleanup', async () => {
  const signals = [];
  const process = ownProcess({ done: new Promise(() => {}), terminate(signal) { signals.push(signal); return new Promise(() => {}); } }, budget);
  await assert.rejects(process.close(), /PROCESS_EXIT_TIMEOUT/);
  await assert.rejects(process.close(), /PROCESS_EXIT_TIMEOUT/);
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});
test('failed exit observation is not success and does not leak raw errors', async () => {
  const process = ownProcess({ done: Promise.reject(Error('private detail')), terminate() {} }, budget);
  await assert.rejects(process.close(), e => e.message === 'EXIT_UNCONFIRMED');
});
test('signal failures are redacted and do not cancel bounded escalation', async () => {
  const d = deferred();
  const process = ownProcess({ done: d.promise, terminate(signal) { if (signal === 'SIGTERM') throw Error('private detail'); d.resolve(); } }, budget);
  await process.close();
});
test('reject invalid handles and unbounded timeout settings', () => {
  for (const ms of [0, Infinity, NaN, -1, 30001, 1.5]) assert.throws(() => ownProcess({}, { graceMs: ms }), /INVALID_TIMEOUT/);
  assert.throws(() => ownProcess({ done: {}, terminate() {} }), /INVALID_PROCESS_HANDLE/);
});
