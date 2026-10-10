import { StringDecoder } from 'node:string_decoder';
// Based on observed official CLI wording, not an invented remap flag.
// The current CLI ends the line with a sentence period ("… to host port 22.");
// trailing whitespace/CR and that single period are accepted, nothing else —
// host, ports and the absence of extra tokens stay strict.
const FORWARDING = /^SSH: Forwarding from (127\.0\.0\.1|\[::1\]):([0-9]{1,5}) to host port ([0-9]{1,5})\.?\s*$/u;
// Failures carry a machine-readable reason for diagnostics; the message stays
// the single redacted code so no CLI text can escape through an error.
const fail = (reason, detail) => {
  const error = new Error('INVALID_FORWARDING_OUTPUT');
  if (typeof reason === 'string') error.reason = reason;
  if (detail !== undefined) error.detail = detail;
  throw error;
};
export function createForwardingParser({ remotePort, onForwarding, streaming = false, observe } = {}) {
  if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535 || typeof onForwarding !== 'function') fail('INVALID_PARSER_CONFIG');
  const decoder = new StringDecoder('utf8');
  let pending = '', bytes = 0, finished = false;
  // Observation is strictly advisory: a throwing observer never changes parsing.
  const note = (kind, text, reason) => {
    if (typeof observe !== 'function') return;
    try { observe(Object.freeze({ kind, text, ...(reason === undefined ? {} : { reason }) })); }
    catch { /* ignored by contract */ }
  };
  function line(text) {
    if (Buffer.byteLength(text) > 4096) { note('too-long', text.slice(0, 64), 'LINE_TOO_LONG'); fail('LINE_TOO_LONG'); }
    // Based on observed official CLI wording, not an invented remap flag.
    const match = FORWARDING.exec(text);
    if (!match) {
      if (text.includes('Forwarding from')) { note('unsupported', text, 'UNSUPPORTED_FORWARDING'); fail('UNSUPPORTED_FORWARDING'); } // unsupported/non-loopback candidate fails closed
      note('info', text);
      return;
    }
    const port = Number(match[2]), dest = Number(match[3]);
    if (port < 1 || port > 65535 || dest < 1 || dest > 65535) { note('invalid-port', text, 'PORT_OUT_OF_RANGE'); fail('PORT_OUT_OF_RANGE'); }
    if (dest === remotePort) {
      note('forwarding', text);
      onForwarding(Object.freeze({ host: match[1] === '[::1]' ? '::1' : match[1], port, remotePort: dest }));
      return;
    }
    note('other-port', text, 'REMOTE_PORT_MISMATCH');
  }
  function consume(text) {
    pending += text;
    let end;
    while ((end = pending.indexOf('\n')) !== -1) {
      line(pending.slice(0, end)); pending = pending.slice(end + 1);
    }
    if (Buffer.byteLength(pending) > 4096) { note('too-long', pending.slice(0, 64), 'PENDING_OVERFLOW'); fail('PENDING_OVERFLOW'); }
  }
  return Object.freeze({
    push(chunk) {
      if (finished || !(typeof chunk === 'string' || Buffer.isBuffer(chunk))) fail('BAD_INPUT');
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += data.length;
      if (!streaming && bytes > 262144) fail('BYTE_QUOTA', bytes);
      consume(decoder.write(data));
    },
    finish() {
      if (finished) return;
      finished = true;
      consume(decoder.end());
      if (pending) line(pending);
      pending = '';
    },
  });
}
