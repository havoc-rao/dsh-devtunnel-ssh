// Strict, read-only developer query over the bounded diagnostic ring.
// No query can start a CLI, connect SSH or expand retention.
const machinePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
export function queryDiagnostics(diagnostics, requestUrl = '/dsh-devtunnel-ssh/diagnostics') {
  const url = new URL(requestUrl, 'http://localhost');
  const allowed = new Set(['after', 'limit', 'machineId']);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) throw new Error('DIAGNOSTICS_QUERY_REJECTED');
  }
  const numeric = (key, fallback, min, max) => {
    if (!url.searchParams.has(key)) return fallback;
    const value = url.searchParams.get(key);
    if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) throw new Error('DIAGNOSTICS_QUERY_REJECTED');
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error('DIAGNOSTICS_QUERY_REJECTED');
    return n;
  };
  const after = numeric('after', 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = numeric('limit', 20, 1, 20);
  const machineId = url.searchParams.get('machineId');
  if (machineId !== null && !machinePattern.test(machineId)) throw new Error('DIAGNOSTICS_QUERY_REJECTED');
  const revision = diagnostics.revision;
  const retained = diagnostics.snapshot();
  const candidates = retained.filter(entry => entry.seq > after && (machineId === null || entry.machineId === machineId));
  const entries = candidates.slice(0, limit);
  const oldestSeq = retained.length ? retained[0].seq : null;
  const nextAfter = entries.length ? entries[entries.length - 1].seq : after;
  return { ok: true, revision, entries,
    pagination: { after, limit, nextAfter, hasMore: candidates.length > entries.length,
      oldestSeq, truncated: oldestSeq !== null && after < oldestSeq - 1 },
    scope: 'managed-channel-events',
    note: 'Read-only retained events; CONNECT_READY is not SSH authentication success. No raw CLI or SSH debug output.' };
}
