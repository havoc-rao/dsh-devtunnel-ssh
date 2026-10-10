import test from 'node:test';
import assert from 'node:assert/strict';
import { hostDiagnosticSink } from '../lib/index.js';

test('host sink prefers the cordis logger and never falls through on a healthy logger', () => {
  const calls = [];
  const ctx = { logger: { info: line => calls.push(['info', line]), warn: line => calls.push(['warn', line]) } };
  const sink = hostDiagnosticSink(ctx, { info() { assert.fail('console must not be used'); }, warn() { assert.fail('console must not be used'); } });
  sink({ code: 'CONNECT_READY', endpoint: { host: '127.0.0.1', port: 55981 } });
  sink({ code: 'CONNECT_OUTPUT_REJECTED', reason: 'UNSUPPORTED_FORWARDING', stream: 'stderr', sample: ['SSH: Forwarding from 0.0.0.0:1234 to host port 22'] });
  assert.deepEqual(calls.map(([level]) => level), ['info', 'warn']);
  assert.match(calls[0][1], /^\[dsh-devtunnel-ssh\] code=CONNECT_READY endpoint=127\.0\.0\.1:55981$/u);
  assert.match(calls[1][1], /^\[dsh-devtunnel-ssh\] code=CONNECT_OUTPUT_REJECTED reason=UNSUPPORTED_FORWARDING stream=stderr line1="SSH: Forwarding from 0\.0\.0\.0:1234 to host port 22"$/u);
});

test('host sink falls back to the process console and never throws', () => {
  const lines = [];
  const output = { info: line => lines.push(line), warn: line => lines.push(line) };
  hostDiagnosticSink({}, output)({ code: 'CONNECT_EXITED', reason: 'CONNECT_EXITED' });
  assert.match(lines[0], /^\[dsh-devtunnel-ssh\] code=CONNECT_EXITED reason=CONNECT_EXITED$/u);

  const throwing = hostDiagnosticSink({ get logger() { throw new Error('logger unavailable'); } }, output);
  throwing({ code: 'CONNECT_ABORTED' });
  assert.match(lines.at(-1), /code=CONNECT_ABORTED/u);

  const brokenConsole = hostDiagnosticSink(undefined, { info() { throw new Error('console down'); }, warn() { throw new Error('console down'); } });
  assert.doesNotThrow(() => brokenConsole({ code: 'CONNECT_SPAWN_FAILED' }));
  assert.doesNotThrow(() => brokenConsole(undefined));
});
