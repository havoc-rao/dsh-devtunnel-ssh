import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { delimiter, isAbsolute, join, resolve } from 'node:path';

const MAX_PATH_LENGTH = 64 * 1024;
const MAX_PATH_ENTRIES = 4096;

// Detection is read-only: never invoke a shell, which, or the CLI itself.
export async function resolveCliExecutable({ override = '', path = process.env.PATH } = {}) {
  const source = override !== '' ? 'override' : 'path';
  const missing = () => ({ status: 'not-found', source, resolvedExecutable: '' });
  const executable = async candidate => {
    try {
      await access(candidate, constants.X_OK);
      return (await stat(candidate)).isFile(); // stat follows executable symlinks.
    } catch { return false; }
  };
  if (source === 'override') {
    if (typeof override !== 'string' || !isAbsolute(override) || !await executable(override)) return missing();
    return { status: 'found', source, resolvedExecutable: override };
  }
  if (typeof path !== 'string' || path.length > MAX_PATH_LENGTH) return missing();
  const cwd = await realpath(process.cwd()).catch(() => resolve(process.cwd()));
  const entries = path.split(delimiter, MAX_PATH_ENTRIES);
  for (const directory of entries) {
    if (!directory || !isAbsolute(directory) || directory.length > 4085
      || /[\u0000-\u001f\u007f-\u009f]/u.test(directory) || resolve(directory) === cwd) continue;
    try { if (await realpath(directory) === cwd) continue; } catch { continue; }
    const candidate = join(directory, 'devtunnel');
    if (await executable(candidate)) return { status: 'found', source, resolvedExecutable: candidate };
  }
  return missing();
}
