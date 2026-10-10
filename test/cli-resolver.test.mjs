import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { resolveCliExecutable } from '../lib/cli-resolver.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'devtunnel-resolver-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'bin');
  await mkdir(directory);
  const executable = join(directory, 'devtunnel');
  // If detection ever executes this file, the test must fail rather than log in.
  await writeFile(executable, '#!/bin/sh\nexit 99\n', { mode: 0o700 });
  return { root, directory, executable };
}
test('absolute PATH directories find an executable without running it', async t => {
  const { directory, executable } = await fixture(t);
  assert.deepEqual(await resolveCliExecutable({ path: ['', '.', 'relative', directory].join(delimiter) }),
    { status: 'found', source: 'path', resolvedExecutable: executable });
});
test('override takes priority and an invalid override never falls back', async t => {
  const { root, directory } = await fixture(t);
  const override = join(root, 'custom');
  await writeFile(override, 'not executable', { mode: 0o600 });
  assert.deepEqual(await resolveCliExecutable({ override, path: directory }),
    { status: 'not-found', source: 'override', resolvedExecutable: '' });
  await chmod(override, 0o700);
  assert.deepEqual(await resolveCliExecutable({ override, path: directory }),
    { status: 'found', source: 'override', resolvedExecutable: override });
  assert.equal((await resolveCliExecutable({ override: join(root, 'missing'), path: directory })).status, 'not-found');
  assert.equal((await resolveCliExecutable({ override: 'relative', path: directory })).status, 'not-found');
});
test('regular executable symlinks are accepted but directories are not', async t => {
  const { root, executable } = await fixture(t);
  const link = join(root, 'link');
  await symlink(executable, link);
  assert.equal((await resolveCliExecutable({ override: link })).status, 'found');
  assert.equal((await resolveCliExecutable({ override: root })).status, 'not-found');
});
test('PATH detection is bounded and ignores cwd including symlink aliases', async t => {
  const { root, directory } = await fixture(t);
  assert.equal((await resolveCliExecutable({ path: 'x'.repeat(65537) })).status, 'not-found');
  assert.equal((await resolveCliExecutable({ path: Array(4096).fill('').concat(directory).join(delimiter) })).status, 'not-found');
  assert.equal((await resolveCliExecutable({ path: undefined })).source, 'path');
  const cwdAlias = join(root, 'cwd');
  await symlink(process.cwd(), cwdAlias);
  assert.equal((await resolveCliExecutable({ path: [process.cwd(), cwdAlias, '.', ''].join(delimiter) })).status, 'not-found');
});
