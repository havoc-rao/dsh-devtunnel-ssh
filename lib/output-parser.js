import { StringDecoder } from 'node:string_decoder';
const fail = () => { throw new Error('INVALID_FORWARDING_OUTPUT'); };
export function createForwardingParser({ remotePort, onForwarding } = {}) {
  if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535 || typeof onForwarding !== 'function') fail();
  const decoder = new StringDecoder('utf8');
  let pending = '', bytes = 0, finished = false;
  function line(text) {
    if (Buffer.byteLength(text) > 4096) fail();
    // Based on observed official CLI wording, not an invented remap flag.
    const match = /^SSH: Forwarding from (127\.0\.0\.1|\[::1\]):([0-9]{1,5}) to host port ([0-9]{1,5})\r?$/u.exec(text);
    if (!match) {
      if (text.includes('Forwarding from')) fail(); // unsupported/non-loopback candidate fails closed
      return;
    }
    const port = Number(match[2]), dest = Number(match[3]);
    if (port < 1 || port > 65535 || dest < 1 || dest > 65535) fail();
    if (dest === remotePort) onForwarding(Object.freeze({ host: match[1] === '[::1]' ? '::1' : match[1], port, remotePort: dest }));
  }
  function consume(text) {
    pending += text;
    let end;
    while ((end = pending.indexOf('\n')) !== -1) {
      line(pending.slice(0, end)); pending = pending.slice(end + 1);
    }
    if (Buffer.byteLength(pending) > 4096) fail();
  }
  return Object.freeze({
    push(chunk) {
      if (finished || !(typeof chunk === 'string' || Buffer.isBuffer(chunk))) fail();
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += data.length;
      if (bytes > 262144) fail();
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
