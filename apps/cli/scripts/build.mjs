#!/usr/bin/env node
// Native-only SEA builder. Dependencies are explicitly provisioned by the caller.
import { constants } from 'node:fs';
import { access, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const platform = process.platform;
const executableName = platform === 'win32' ? 'dsh-rdl.exe' : 'dsh-rdl';
const help = 'Usage: node apps/cli/scripts/build.mjs [--out <empty-output-directory>]';
const contains = (parent, child) => {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
};

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.signal ?? result.status})`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log(help);
    return;
  }
  if (args.length !== 0 && !(args.length === 2 && args[0] === '--out' && args[1] && !args[1].startsWith('-'))) {
    throw new Error(help);
  }
  if (Number(process.versions.node.split('.')[0]) !== 22) throw new Error('Build requires Node 22; no runtime will be downloaded.');
  if (!((platform === 'darwin' && ['arm64', 'x64'].includes(process.arch)) || (platform === 'win32' && process.arch === 'x64'))) {
    throw new Error(`Unsupported native target: ${platform}/${process.arch}. Cross-compilation is not supported.`);
  }

  const out = resolve(args[1] ?? join(cliRoot, 'dist'));
  // Never use a source directory, project ancestor, filesystem root, or symlink as output.
  if (contains(out, cliRoot) || ['src', 'scripts', 'test'].some(name => contains(join(cliRoot, name), out))) {
    throw new Error('Output must be a dedicated empty directory, not source or a project ancestor.');
  }
  await mkdir(out, { recursive: true });
  const outStat = await lstat(out);
  if (!outStat.isDirectory() || outStat.isSymbolicLink() || await realpath(out) !== out) {
    throw new Error('Output directory and its ancestors must not be symlinks.');
  }
  if ((await readdir(out)).length !== 0) throw new Error('Output directory must be empty; existing files are never removed or overwritten.');

  const { version } = JSON.parse(await readFile(join(cliRoot, 'package.json'), 'utf8'));
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('CLI package version must be a release semver.');
  await access(join(cliRoot, 'src', 'main.mjs'), constants.R_OK);
  const { build } = await import('esbuild');
  const postject = await import('postject');
  const inject = postject.inject ?? postject.default?.inject;
  if (typeof inject !== 'function') throw new Error('Installed postject does not expose inject().');

  const scratch = await mkdtemp(join(out, '.sea-'));
  try {
    const bundle = join(scratch, 'main.cjs');
    const blob = join(scratch, 'sea.blob');
    const candidate = join(scratch, executableName);
    await build({
      entryPoints: [join(cliRoot, 'src', 'main.mjs')],
      outfile: bundle,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      packages: 'bundle',
      sourcemap: false,
      legalComments: 'none',
      // main must not rely on import.meta, dynamic external imports, or sidecar files.
      logLevel: 'info',
    });
    const config = join(scratch, 'sea-config.json');
    await writeFile(config, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false }));
    run(process.execPath, ['--experimental-sea-config', config]);
    await copyFile(process.execPath, candidate, constants.COPYFILE_EXCL);
    if (platform === 'darwin') run('codesign', ['--remove-signature', candidate]);
    await inject(candidate, 'NODE_SEA_BLOB', await readFile(blob), {
      sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
      ...(platform === 'darwin' ? { machoSegmentName: 'NODE_SEA' } : {}),
    });
    if (platform === 'darwin') {
      run('codesign', ['--sign', '-', '--force', candidate]);
      run('codesign', ['--verify', candidate]);
    }
    const output = join(out, executableName);
    // The output was checked empty. Re-check before rename rather than replace any file.
    if ((await readdir(out)).some(name => name !== relative(out, scratch))) throw new Error('Output directory changed during build; refusing to overwrite.');
    await rename(candidate, output);
    console.log(`Built dsh-remote-devtunnel-link (dsh-rdl) ${version} for ${platform}/${process.arch}: ${output}`);
  } finally {
    // Only remove the exact temporary directory created above, after verifying its location.
    if (dirname(scratch) !== out || !relative(out, scratch).startsWith('.sea-') || await realpath(scratch) !== scratch) {
      throw new Error('Refusing unsafe temporary-directory cleanup.');
    }
    await rm(scratch, { recursive: true, force: false });
  }
}

main().catch(error => {
  console.error(`Build failed: ${error.message}`);
  process.exitCode = 1;
});
