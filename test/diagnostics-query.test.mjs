import test from 'node:test';
import assert from 'node:assert/strict';
import { queryDiagnostics } from '../lib/util/diagnostics-query.js';
import { createConnectDiagnostics } from '../lib/util/connect-diagnostics.js';

test('developer query paginates and filters the retained channel timeline', () => {
  const log = createConnectDiagnostics({ maxEntries: 3 });
  for (let i = 1; i <= 5; i++) log.record({ code: 'CHANNEL_LEASED', machineId: i % 2 ? 'mac-mini' : 'other' });
  const first = queryDiagnostics(log, '/dsh-devtunnel-ssh/diagnostics?limit=1');
  assert.deepEqual(first.entries.map(e => e.seq), [3]);
  assert.equal(first.pagination.truncated, true);
  assert.equal(first.pagination.oldestSeq, 3);
  assert.equal(first.pagination.nextAfter, 3);
  assert.equal(first.pagination.hasMore, true);
  const second = queryDiagnostics(log, '/dsh-devtunnel-ssh/diagnostics?after=3&machineId=mac-mini');
  assert.deepEqual(second.entries.map(e => e.seq), [5]);
  assert.equal(second.pagination.hasMore, false);
  assert.equal(second.scope, 'managed-channel-events');
  assert.match(second.note, /not SSH authentication success/);
});

test('invalid and duplicate query parameters cannot widen the read surface', () => {
  const log = createConnectDiagnostics({});
  for (const query of ['limit=0', 'limit=21', 'limit=1.5', 'limit=-1', 'after=-1', 'after=1e2',
    'after=9007199254740992', 'limit=1&limit=2', 'token=secret', 'machineId=../etc', 'machineId=']) {
    assert.throws(() => queryDiagnostics(log, '/dsh-devtunnel-ssh/diagnostics?' + query), /DIAGNOSTICS_QUERY_REJECTED/, query);
  }
  const empty = queryDiagnostics(log);
  assert.deepEqual(empty.entries, []);
  assert.equal(empty.pagination.oldestSeq, null);
  assert.equal(empty.pagination.truncated, false);
});
