import { spawn } from 'node:child_process';
import { requireText } from './core.mjs';

export function tunnelTarget(value) {
  if (!value || Object.keys(value).sort().join(',') !== 'remotePort,schemaVersion,tunnelId' || value.schemaVersion !== 1) throw new Error('Invalid saved tunnel target');
  requireText(value.tunnelId, 'tunnel ID', /^[a-z0-9][a-z0-9-]{0,99}(?:\.[a-z0-9]{1,20})?$/);
  if (!Number.isInteger(value.remotePort) || value.remotePort < 1 || value.remotePort > 65535) throw new Error('Invalid remote SSH port');
  return value;
}
export function tunnelCommand(action, target) {
  tunnelTarget(target);
  if (!['host', 'connect'].includes(action)) throw new Error('Unsupported tunnel action');
  // Existing persistent tunnel only. No port creation, anonymous ACL or implicit target.
  return { executable: 'devtunnel', args: [action, target.tunnelId] };
}
export function foreground(command, { spawnProcess = spawn, signals = process } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawnProcess(command.executable, command.args, { shell: false, stdio: 'inherit' }); }
    catch { reject(new Error('Unable to start official Dev Tunnel CLI')); return; }
    let killTimer;
    const stop = () => {
      if (killTimer || child.exitCode !== null) return;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 2000);
      killTimer.unref();
    };
    const cleanup = () => { clearTimeout(killTimer); signals.removeListener('SIGINT', stop); signals.removeListener('SIGTERM', stop); };
    signals.on('SIGINT', stop); signals.on('SIGTERM', stop);
    child.once('error', () => { cleanup(); reject(new Error('Dev Tunnel CLI unavailable; install/login explicitly using official instructions')); });
    child.once('close', (code, signal) => { cleanup(); if (code === 0 || signal === 'SIGTERM' || signal === 'SIGINT') resolve(); else reject(new Error(`Dev Tunnel CLI exited (${code}); inspect its output above`)); });
  });
}
