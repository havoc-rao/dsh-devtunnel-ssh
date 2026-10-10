import test from 'node:test';
import assert from 'node:assert/strict';
import { createCarrier } from '../lib/carrier.js';
import { createManagedStarter } from '../lib/managed-supervisor.js';

const connector = { kind: 'devtunnel', mode: 'managed', tunnelId: 'fixture.jpe1', remotePort: 22 };

test('saved-machine probe reuses the real supervisor generation without closing the business lease', async () => {
  let starts = 0, closes = 0;
  const starter = createManagedStarter({ executable: '/fixture/devtunnel', start: async () => {
    starts++;
    let resolveClosed;
    const closed = new Promise(resolve => { resolveClosed = resolve; });
    return { endpoint: { host: '127.0.0.1', port: 62771 }, closed,
      async close() { closes++; resolveClosed({ reason: 'CONNECT_CLOSED' }); } };
  } });
  const carrier = createCarrier({ startManaged: starter });
  const business = await carrier.acquire({ machineId: 'mac-mini', connector });
  try {
    // The former client request generated another identity for this same target.
    await assert.rejects(carrier.acquire({ machineId: 'temporary-probe', connector }), { code: 'CONNECT_TARGET_BUSY' });
    assert.equal(starts, 1);
    assert.equal(business.dialPort, 62771);
    // Preserve the saved machine id: acquire shares the channel, not SSH I/O.
    const probe = await carrier.acquire({ machineId: 'mac-mini', connector });
    assert.equal(probe.generation, business.generation);
    assert.equal(probe.dialPort, business.dialPort);
    assert.equal(starts, 1);
    assert.equal(carrier.snapshot()[0].refs, 2);
    await probe.release();
    assert.equal(closes, 0, 'finishing a probe must not stop the business channel');
    assert.equal(carrier.snapshot()[0].refs, 1);
    assert.equal(business.dialPort, 62771);
    await business.release();
    assert.equal(closes, 1, 'only the final owner closes the owned CLI');
  } finally { await carrier.dispose(); }
});

test('cancelling a saved-machine probe releases only its own shared reference', async () => {
  let starts = 0, closes = 0;
  const starter = createManagedStarter({ executable: '/fixture/devtunnel', start: async () => {
    starts++;
    return { endpoint: { host: '127.0.0.1', port: 62771 }, closed: new Promise(() => {}), async close() { closes++; } };
  } });
  const carrier = createCarrier({ startManaged: starter });
  const business = await carrier.acquire({ machineId: 'mac-mini', connector });
  const controller = new AbortController();
  const probe = await carrier.acquire({ machineId: 'mac-mini', connector, signal: controller.signal });
  controller.abort();
  await probe.release();
  assert.equal(starts, 1);
  assert.equal(closes, 0);
  assert.equal(business.dialPort, 62771);
  await business.release();
  assert.equal(closes, 1);
  await carrier.dispose();
});
