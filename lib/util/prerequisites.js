// Read-only fixture checks. Caller supplies a bounded runner; no CLI execution here.
import { isAbsolute } from 'node:path';
const fail = code => Object.assign(new Error(code), { code });
const result = (status, extra = {}) => Object.freeze({ status, ...extra });
const MAX_OUTPUT = 64 * 1024;

// Never return account names, stderr, raw output, arbitrary exception messages or tokens.
export function parsePrerequisiteResult(kind, value) {
  try {
    if (!value || typeof value !== 'object') return result('unknown');
    if (value.code === 'ENOENT') return result('not-installed');
    if (!Number.isInteger(value.code) || value.code !== 0) return result('unknown');
    const stdout = value.stdout ?? '', stderr = value.stderr ?? '';
    if (typeof stdout !== 'string' || typeof stderr !== 'string'
        || Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > MAX_OUTPUT) return result('unknown');
    if (kind === 'version') {
      const versions = [];
      let officialLines = 0;
      for (const line of stdout.split(/\r?\n/u)) {
        if (!line.startsWith('Tunnel CLI version:')) continue;
        officialLines++;
        const match = line.match(/^Tunnel CLI version: (\d{1,4}\.\d{1,4}\.\d{1,6})(?:\+[a-zA-Z0-9]{1,64})?$/u);
        if (match) versions.push(match[1]);
      }
      if (officialLines) return officialLines === 1 && versions.length === 1
        ? result('installed', { version: versions[0] }) : result('unknown');
      const match = stdout.trim().match(/^(?:devtunnel(?: version)?\s+)?(\d{1,4}\.\d{1,4}\.\d{1,6})(?:\+[a-zA-Z0-9]{1,64})?$/u);
      return match ? result('installed', { version: match[1] }) : result('unknown');
    }
    if (kind === 'login-help') {
      return /\buser show\b/u.test(stdout) && /\b(?:Usage|USAGE):/u.test(stdout)
        ? result('supported') : result('unknown');
    }
    if (kind === 'login') {
      // Fixture grammar, not an assertion about arbitrary CLI/localized output.
      if (/^Logged in as [^\r\n]{1,1024}\.?\r?\n?$/u.test(stdout)) return result('logged-in');
      if (/^(?:Not logged in\.?|You are not logged in\.?)\r?\n?$/u.test(stdout)) return result('not-logged-in');
    }
  } catch { /* Treat untrusted runner results as unknown, without their text. */ }
  return result('unknown');
}

export async function checkPrerequisites(options = {}) {
  let executable, run, checkLogin, timeoutMs;
  try {
    ({ executable, run, checkLogin = false, timeoutMs = 5000 } = options);
    if (typeof executable !== 'string' || !isAbsolute(executable) || /[\x00-\x1f\x7f]/u.test(executable)
        || typeof run !== 'function' || typeof checkLogin !== 'boolean'
        || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw 0;
  } catch { throw fail('INVALID_PREREQUISITE_CONFIG'); }
  async function invoke(args, kind) {
    let timer;
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => run(executable, args, Object.freeze({
          shell: false, stdio: Object.freeze(['ignore', 'pipe', 'pipe']),
          timeoutMs, maxOutputBytes: MAX_OUTPUT,
        }))),
        new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); }),
      ]);
      return parsePrerequisiteResult(kind, value);
    } catch (error) {
      // Only this well-known OS code escapes; never the error text.
      try { if (error?.code === 'ENOENT') return result('not-installed'); } catch {}
      return result('unknown');
    } finally { clearTimeout(timer); }
  }
  const version = await invoke(['--version'], 'version');
  if (version.status !== 'installed') return result(version.status, { login: 'unknown' });
  const help = await invoke(['user', 'show', '--help'], 'login-help');
  let login = 'unknown';
  if (checkLogin === true && help.status === 'supported') {
    login = (await invoke(['user', 'show'], 'login')).status;
  }
  return result('installed', { version: version.version, login,
    loginCheckSupported: help.status === 'supported' });
}
