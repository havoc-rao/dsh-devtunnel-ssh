// Bounded, redacted diagnostics for managed `devtunnel connect`.
//
// The official CLI can print access tokens, sign-in URLs and account details on
// the same streams we parse. Raw adapter output must therefore never reach a
// log sink, an HTTP response or the browser: this module is the single place
// that turns observed lines into shareable text. Everything is masked, every
// line is truncated, and only a small ring buffer is retained.
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/giu;
const SECRET_KEY_PATTERN = /\b(?:token|access[_-]?token|refresh[_-]?token|id[_-]?token|authorization|secret|password|passwd|passphrase|api[_-]?key|cookie|signature|sig)\b\s*[:=]\s*(?:bearer\s+)?[^\s,;]*/giu;
const BEARER_PATTERN = /\bbearer\s+[^\s,;]+/giu;
// Deliberately excludes '/' so host paths stay readable; base64url/JWT and hex
// blobs are the shapes the official CLI actually prints for credentials.
const LONG_RUN_PATTERN = /[A-Za-z0-9+_-]{24,}/gu;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/gu;
const CODE_PATTERN = /^[A-Za-z0-9_.-]{1,48}$/u;
// Config values the same authenticated page already shows verbatim (machine
// tunnel id, resolved CLI path). They are validated, not masked, so a
// diagnostic stays actionable without turning a 24-char tunnel id into
// "<redacted>.jpe1".
const TUNNEL_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}(?:\.[a-z0-9]{1,20})?$/u;
const MACHINE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u;
const EXECUTABLE_PATTERN = /^\/[^\u0000-\u001f\u007f]*$/u;
const MAX_LINE = 240;
const MAX_SAMPLE = 3;
const MAX_ENTRIES = 20;

const code = value => (typeof value === 'string' && CODE_PATTERN.test(value) ? value : undefined);

/** Mask one observed line: URLs, secret-looking keys and long runs. */
export function redactLine(value, max = MAX_LINE) {
  let text = typeof value === 'string' ? value : String(value ?? '');
  text = text.replace(URL_PATTERN, raw => {
    try {
      const url = new URL(raw);
      return `${url.origin}${url.pathname}${url.search ? '?<redacted>' : ''}`;
    } catch { return '<url>'; }
  });
  text = text.replace(SECRET_KEY_PATTERN, match => `${match.split('=')[0].split(':')[0].trim()} <redacted>`);
  text = text.replace(BEARER_PATTERN, 'Bearer <redacted>');
  text = text.replace(LONG_RUN_PATTERN, '<redacted>');
  text = text.replace(CONTROL_PATTERN, ' ').replace(/\s+/gu, ' ').trim();
  if (text.length > max) text = `${text.slice(0, max)}…`;
  return text;
}

/** One bounded, shareable console line for a diagnostic entry. */
export function formatDiagnostic(entry = {}) {
  const parts = [`code=${entry.code ?? 'UNKNOWN'}`];
  for (const key of ['reason', 'stream', 'mode', 'attempt']) {
    if (entry[key] !== undefined) parts.push(`${key}=${entry[key]}`);
  }
  for (const key of ['lines', 'bytes', 'remotePort']) {
    if (Number.isSafeInteger(entry[key])) parts.push(`${key}=${entry[key]}`);
  }
  if (entry.sawForwarding !== undefined) parts.push(`sawForwarding=${entry.sawForwarding === true}`);
  if (entry.endpoint) parts.push(`endpoint=${entry.endpoint.host}:${entry.endpoint.port}`);
  if (typeof entry.machineId === 'string' && MACHINE_ID_PATTERN.test(entry.machineId)) parts.push(`machineId=${entry.machineId}`);
  // Validated, not masked: the same page already shows these config values,
  // and masking a 24-char tunnel id only hides the field being diagnosed.
  if (typeof entry.tunnelId === 'string' && TUNNEL_ID_PATTERN.test(entry.tunnelId)) parts.push(`tunnelId=${entry.tunnelId}`);
  if (typeof entry.executable === 'string' && entry.executable.length <= 4096 && EXECUTABLE_PATTERN.test(entry.executable)) parts.push(`executable=${entry.executable}`);
  for (const [index, line] of (entry.sample ?? []).entries()) parts.push(`line${index + 1}="${line}"`);
  return parts.join(' ');
}

/**
 * Diagnostic sink: masks, bounds and broadcasts managed-connect observations.
 * `sink(entry)` receives the already-redacted entry (host log); `snapshot()`
 * serves the same entries to the authenticated diagnostics route.
 */
export function createConnectDiagnostics({ sink, maxEntries = MAX_ENTRIES } = {}) {
  const entries = [];
  let seq = 0;
  function record(input = {}) {
    const entry = Object.freeze({
      seq: ++seq,
      at: Date.now(),
      code: code(input.code) ?? 'UNKNOWN',
      ...(code(input.reason) !== undefined ? { reason: code(input.reason) } : {}),
      ...(code(input.stream) !== undefined ? { stream: code(input.stream) } : {}),
      ...(code(input.mode) !== undefined ? { mode: code(input.mode) } : {}),
      ...(Number.isSafeInteger(input.attempt) ? { attempt: input.attempt } : {}),
      ...(Number.isSafeInteger(input.lines) ? { lines: input.lines } : {}),
      ...(Number.isSafeInteger(input.bytes) ? { bytes: input.bytes } : {}),
      ...(typeof input.sawForwarding === 'boolean' ? { sawForwarding: input.sawForwarding } : {}),
      ...(Number.isSafeInteger(input.remotePort) ? { remotePort: input.remotePort } : {}),
      ...(input.endpoint && ['127.0.0.1', '::1'].includes(input.endpoint.host) && Number.isSafeInteger(input.endpoint.port)
        ? { endpoint: Object.freeze({ host: input.endpoint.host, port: input.endpoint.port }) } : {}),
      ...(typeof input.machineId === 'string' && MACHINE_ID_PATTERN.test(input.machineId) ? { machineId: input.machineId } : {}),
      ...(typeof input.tunnelId === 'string' && TUNNEL_ID_PATTERN.test(input.tunnelId) ? { tunnelId: input.tunnelId } : {}),
      ...(typeof input.executable === 'string' && input.executable.length <= 4096 && EXECUTABLE_PATTERN.test(input.executable)
        ? { executable: input.executable } : {}),
      ...(Array.isArray(input.sample)
        ? { sample: Object.freeze(input.sample.slice(-MAX_SAMPLE).map(line => redactLine(line))) } : {}),
    });
    entries.push(entry);
    while (entries.length > maxEntries) entries.shift();
    if (typeof sink === 'function') {
      try { sink(entry); } catch { /* a failing sink must never break the connect path */ }
    }
    return entry;
  }
  return Object.freeze({
    record,
    snapshot: () => entries.map(entry => ({ ...entry, ...(entry.endpoint ? { endpoint: { ...entry.endpoint } } : {}), ...(entry.sample ? { sample: [...entry.sample] } : {}) })),
    get revision() { return seq; },
  });
}
