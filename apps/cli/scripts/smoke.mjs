#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
const executable = resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Usage: node smoke.mjs <built executable>');
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
for (const [args, expected] of [[['--version'], version], [['--help'], 'dsh-remote-devtunnel-link (dsh-rdl)']]) {
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 10000, maxBuffer: 65536 });
  if (result.error || result.status !== 0 || !result.stdout.includes(expected)) throw new Error(`Executable smoke failed: ${args.join(' ')}`);
}
const invalid = spawnSync(executable, ['unknown-command'], { encoding: 'utf8', timeout: 10000 });
if (invalid.status !== 1) throw new Error('Invalid command must fail');
console.log('PASS: native executable version/help/error-path smoke; no service or network operations');
