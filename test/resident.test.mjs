import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSettings, residentConfigOf } from '../lib/util/settings-store.js';

const C = () => ({ cliExecutable: '/fx/devtunnel', managedEnabled: true, residentTunnelId: '', residentRemotePort: 0, residentMode: 'off' });
test('resident settings whitelist: ids, modes and consistency, legacy normalization', async () => {
  assert.throws(() => validateSettings({ ...C(), residentTunnelId: 'Bad ID' }), /SETTINGS_REJECTED/);
  assert.throws(() => validateSettings({ ...C(), residentMode: 'always' }), /SETTINGS_REJECTED/);
  assert.throws(() => validateSettings({ ...C(), residentTunnelId: 'r.jpe1', residentRemotePort: 0, residentMode: 'immediate' }), /SETTINGS_REJECTED/);
  assert.throws(() => validateSettings({ ...C(), residentTunnelId: '', residentRemotePort: 22 }), /SETTINGS_REJECTED/);
  assert.throws(() => validateSettings({ ...C(), residentTunnelId: '', residentRemotePort: 0, residentMode: 'lazy' }), /SETTINGS_REJECTED/);
  assert.throws(() => validateSettings({ ...C(), residentRemotePort: 70000 }), /SETTINGS_REJECTED/);
  const legacy = validateSettings({ cliExecutable: '/x', managedEnabled: true });
  assert.deepEqual(legacy, { ...C(), cliExecutable: '/x' });
  assert.equal(residentConfigOf(legacy), null);
  assert.deepEqual(residentConfigOf(validateSettings({ ...C(), residentTunnelId: 'r.jpe1', residentRemotePort: 22, residentMode: 'lazy' })),
    { tunnelId: 'r.jpe1', remotePort: 22, mode: 'lazy' });
  assert.equal(residentConfigOf(validateSettings({ ...C(), residentTunnelId: 'r.jpe1', residentRemotePort: 22, residentMode: 'off' })), null);
});

