import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsRuntime as createRuntime } from '../lib/settings-runtime.js';
const fakeResolver = async ({ override }) => ({ status: 'found', source: override ? 'override' : 'path', resolvedExecutable: override || '/fixture/path/devtunnel' });
const createSettingsRuntime = options => createRuntime({ resolveCli: fakeResolver, ...options });
import { createCarrier } from '../lib/carrier.js';
function storeFixture() {
  let value={settings:{cliExecutable:'/fixture/old',managedEnabled:true},revision:0,source:'config'};
  return { snapshot:async()=>value,save:async(settings,{expectedRevision})=>{
    assert.equal(expectedRevision,value.revision);
    value={settings,revision:value.revision+1,source:'settings'};return value;
  }};
}
const body=(revision,extra={})=>({cliExecutable:'/fixture/new',managedEnabled:true,confirmed:true,disconnectActive:false,revision,...extra});
const connector={kind:'devtunnel',mode:'managed',tunnelId:'fixture',remotePort:22};
const detection = (path = '', source = 'path') => ({ status: path ? 'found' : 'not-found', source, resolvedExecutable: path });
const emptyStore = () => {
  const store = storeFixture();
  const snapshot = store.snapshot;
  store.snapshot = async () => ({ ...await snapshot(), settings: { cliExecutable: '', managedEnabled: true } });
  return store;
};
test('empty authorized override enables only when PATH finds CLI, without spawning', async () => {
  for (const path of ['', '/fixture/path/devtunnel']) {
    let builds = 0;
    const runtime = await createRuntime({ store: emptyStore(), resolveCli: async ({ override }) => {
      assert.equal(override, ''); return detection(path);
    }, makeStarter: ({ executable }) => {
      builds++; assert.equal(executable, path); return () => assert.fail('detection spawned');
    } });
    const snap = await runtime.snapshot({ refresh: false });
    assert.deepEqual(snap.cli, detection(path));
    assert.equal(runtime.capabilities.managedConnect, !!path);
    assert.equal(builds, path ? 1 : 0);
    if (path) await runtime.withExecutable(value => assert.equal(value, path));
    else await assert.rejects(runtime.withExecutable(() => assert.fail()), /HOST_CLI_NOT_FOUND/);
    await runtime.dispose();
  }
});
test('not-found empty override can persist authorization and never builds or spawns', async () => {
  const runtime = await createRuntime({ store: storeFixture(), resolveCli: async ({ override }) => detection('', override ? 'override' : 'path'), makeStarter: () => assert.fail() });
  const saved = await runtime.update(body(0, { cliExecutable: '' }));
  assert.equal(saved.settings.cliExecutable, ''); assert.equal(saved.settings.managedEnabled, true);
  assert.equal(saved.revision, 1); assert.equal(saved.cli.status, 'not-found');
  assert.equal(runtime.capabilities.managedConnect, false);
  await runtime.dispose();
});
test('refresh detects PATH changes without spawning and preserves active starter and endpoint', async () => {
  let path = '/fixture/path/first', probes = 0;
  const runtime = await createRuntime({ store: emptyStore(), resolveCli: async () => { probes++; return detection(path); },
    makeStarter: ({ executable }) => async () => ({ endpoint: { host: '127.0.0.1', port: executable.endsWith('first') ? 5001 : 5002 }, closed: new Promise(() => {}), close: async () => {} }) });
  const carrier = createCarrier({ getManagedStarter: runtime.getStarter, capabilities: runtime.capabilities, onCarrier: runtime.attachCarrier });
  const lease = await carrier.acquire({ machineId: 'mac', connector });
  const starter = runtime.getStarter(); path = '/fixture/path/second';
  assert.equal((await runtime.snapshot()).cli.resolvedExecutable, '/fixture/path/first');
  assert.equal(probes, 1); assert.equal(runtime.getStarter(), starter); assert.equal(lease.dialPort, 5001);
  await lease.release();
  assert.equal((await runtime.snapshot()).cli.resolvedExecutable, path);
  assert.notEqual(runtime.getStarter(), starter);
  const refreshedStarter = runtime.getStarter();
  await runtime.snapshot();
  assert.equal(runtime.getStarter(), refreshedStarter, 'unchanged detection retains supervisor retry budget');
  path = ''; assert.equal((await runtime.snapshot()).cli.status, 'not-found');
  assert.equal(runtime.getStarter(), undefined);
  await carrier.dispose(); await runtime.dispose();
});
test('refresh serializes with update and preflight; dispose cannot resurrect starter', async () => {
  let resolveProbe, probes = 0, builds = 0;
  const runtime = await createRuntime({ store: emptyStore(), resolveCli: async () => {
    if (++probes === 1) return detection('/fixture/path/first');
    return new Promise(resolve => { resolveProbe = resolve; });
  }, makeStarter: () => { builds++; return () => assert.fail(); } });
  const refresh = runtime.snapshot();
  await assert.rejects(runtime.update(body(0)), /SETTINGS_BUSY/);
  await assert.rejects(runtime.withExecutable(() => assert.fail()), /SETTINGS_BUSY/);
  const disposing = runtime.dispose();
  resolveProbe(detection('/fixture/path/second'));
  await assert.rejects(refresh, /SETTINGS_UNAVAILABLE/); await disposing;
  assert.equal(builds, 1); assert.equal(runtime.getStarter(), undefined);
});
test('lease acquired during refresh keeps its original detected executable', async () => {
  let resolveProbe, probes = 0;
  const runtime = await createRuntime({ store: emptyStore(), resolveCli: async () => {
    if (++probes === 1) return detection('/fixture/path/first');
    return new Promise(resolve => { resolveProbe = resolve; });
  }, makeStarter: () => async () => ({ endpoint: { host: '127.0.0.1', port: 5001 }, closed: new Promise(() => {}), close: async () => {} }) });
  const carrier = createCarrier({ getManagedStarter: runtime.getStarter, capabilities: runtime.capabilities, onCarrier: runtime.attachCarrier });
  const starter = runtime.getStarter(); const refresh = runtime.snapshot();
  const lease = await carrier.acquire({ machineId: 'mac', connector });
  resolveProbe(detection('/fixture/path/second'));
  assert.equal((await refresh).cli.resolvedExecutable, '/fixture/path/first');
  assert.equal(runtime.getStarter(), starter); assert.equal(lease.dialPort, 5001);
  await lease.release(); await carrier.dispose(); await runtime.dispose();
});
test('disabled managed still detects CLI and supports preflight without starter', async () => {
  const store = storeFixture(); const snapshot = store.snapshot;
  store.snapshot = async () => ({ ...await snapshot(), settings: { cliExecutable: '', managedEnabled: false } });
  const runtime = await createRuntime({ store, resolveCli: async () => detection('/fixture/path/devtunnel'), makeStarter: () => assert.fail() });
  assert.equal(runtime.capabilities.managedConnect, false);
  await runtime.withExecutable(path => assert.equal(path, '/fixture/path/devtunnel'));
  await runtime.dispose();
});
test('settings apply closes active generations before swapping executable, external survives',async()=>{
  let starts=[],finishCleanup;
  const runtime=await createSettingsRuntime({store:storeFixture(),makeStarter:({executable})=>async()=>{
    starts.push(executable);
    return {endpoint:{host:'127.0.0.1',port:5000},closed:new Promise(()=>{}),
      close:executable==='/fixture/old'?()=>new Promise(r=>{finishCleanup=r;}):async()=>{}};
  }});
  const carrier=createCarrier({getManagedStarter:runtime.getStarter,capabilities:runtime.capabilities,onCarrier:runtime.attachCarrier});
  const lease=await carrier.acquire({machineId:'mac',connector});
  const external=await carrier.acquire({machineId:'external',connector:{...connector,mode:'external',endpoint:{host:'127.0.0.1',port:4000}}});
  await assert.rejects(runtime.update(body(0)),/SETTINGS_ACTIVE_CONFIRM_REQUIRED/);
  const saving=runtime.update(body(0,{disconnectActive:true}));
  await lease.closed;assert.throws(()=>lease.dialPort,/STALE_LEASE/);
  await assert.rejects(carrier.acquire({machineId:'new',connector}),/SETTINGS_UPDATING/);
  assert.deepEqual(starts,['/fixture/old']);assert.equal(external.dialPort,4000);
  await new Promise(r=>setImmediate(r));finishCleanup();
  const saved=await saving;assert.equal(saved.revision,1);assert.equal(saved.activeManaged,0);
  assert.deepEqual(starts,['/fixture/old'],'save never spawns');
  const next=await carrier.acquire({machineId:'mac',connector});assert.deepEqual(starts,['/fixture/old','/fixture/new']);
  await next.release();await external.release();await carrier.dispose();await runtime.dispose();
});
test('saving unchanged Config defaults persists an override without disconnecting',async()=>{
 const store=storeFixture();let disconnects=0;
 const runtime=await createSettingsRuntime({store,makeStarter:()=>()=>{assert.fail();}});
 runtime.attachCarrier({activeManaged:1,reconfigureManaged(){disconnects++;assert.fail();}});
 const saved=await runtime.update(body(0,{cliExecutable:'/fixture/old'}));
 assert.equal(saved.source,'settings');assert.equal(saved.revision,1);assert.equal(disconnects,0);
 await runtime.dispose();
});
test('revision, authorization and invalid settings fail before disconnection',async()=>{
  const runtime=await createSettingsRuntime({store:storeFixture(),makeStarter:()=>()=>{assert.fail();}});
  await assert.rejects(runtime.update(body(9)),/SETTINGS_REVISION_CONFLICT/);
  await assert.rejects(runtime.update(body(0,{confirmed:false})),/SETTINGS_CONFIRM_REQUIRED/);
  await assert.rejects(runtime.update(body(0,{cliExecutable:'relative'})),/SETTINGS_REJECTED/);
  const saved=await runtime.update(body(0,{managedEnabled:false}));
  assert.equal(saved.settings.managedEnabled,false);assert.equal(runtime.capabilities.managedConnect,false);
  await runtime.dispose();
});
test('preflight uses saved executable and serializes with saves; corrupt store disables',async()=>{
  const runtime=await createSettingsRuntime({store:storeFixture(),makeStarter:()=>()=>{assert.fail();}});
  let finish;
  const preflight=runtime.withExecutable(path=>{assert.equal(path,'/fixture/old');return new Promise(r=>{finish=r;});});
  await assert.rejects(runtime.update(body(0)),/SETTINGS_BUSY/);
  await new Promise(r=>setImmediate(r));finish();await preflight;
  await runtime.update(body(0));await runtime.withExecutable(path=>assert.equal(path,'/fixture/new'));
  await runtime.dispose();
  const bad=await createSettingsRuntime({store:{snapshot:async()=>{throw Error('private');}},makeStarter:()=>{assert.fail();}});
  assert.equal(bad.capabilities.managedConnect,false);assert.equal(bad.getStarter(),undefined);
  await assert.rejects(bad.snapshot(),/SETTINGS_UNAVAILABLE/);await bad.dispose();
});
test('cleanup failure blocks settings and never saves or restarts',async()=>{
  let writes=0;const store=storeFixture();const save=store.save;store.save=(...args)=>{writes++;return save(...args);};
  const runtime=await createSettingsRuntime({store,makeStarter:()=>async()=>({endpoint:{host:'127.0.0.1',port:5000},closed:new Promise(()=>{}),close:async()=>{throw Error('secret');}})});
  const carrier=createCarrier({getManagedStarter:runtime.getStarter,capabilities:runtime.capabilities,onCarrier:runtime.attachCarrier});
  await carrier.acquire({machineId:'mac',connector});
  await assert.rejects(runtime.update(body(0,{disconnectActive:true})),/SETTINGS_CLEANUP_FAILED/);
  assert.equal(writes,0);assert.equal(runtime.capabilities.managedConnect,false);
  await assert.rejects(runtime.snapshot(),/SETTINGS_UNAVAILABLE/);await carrier.dispose();await runtime.dispose();
});

test('channel snapshot merges carrier channels with supervisor state and degrades to empty', async () => {
  const channels = [{ machineId: 'mac-b', mode: 'managed', tunnelId: 'fixture', remotePort: 22, state: 'ready', endpoint: { host: '127.0.0.1', port: 53162 }, since: 1, generation: 'g1', refs: 1 }];
  const supervisor = [{ tunnelId: 'other', remotePort: 22, active: false, pending: false, failures: 2, blocked: null, cooldownUntil: null }];
  const runtime = await createSettingsRuntime({ store: storeFixture(), makeStarter: () => Object.assign(() => {}, { list: () => supervisor }) });
  // No carrier attached yet: total, never throwing.
  assert.deepEqual(runtime.channelSnapshot(), { enabled: true, activeManaged: 0, channels: [], supervisor });
  runtime.attachCarrier({ activeManaged: 1, snapshot: () => channels, stopManaged: async machineId => ({ machineId, mode: 'managed', tunnelId: 'fixture', remotePort: 22 }) });
  assert.deepEqual(runtime.channelSnapshot(), { enabled: true, activeManaged: 1, channels, supervisor });
  assert.deepEqual(await runtime.stopManagedChannel('mac-b'), { machineId: 'mac-b', mode: 'managed', tunnelId: 'fixture', remotePort: 22 });
  await runtime.dispose();
  assert.deepEqual(runtime.channelSnapshot(), { enabled: false, activeManaged: 0, channels: [], supervisor: [] });
});

test('stopManagedChannel fails closed on an unusable carrier and keeps adapter codes', async () => {
  const runtime = await createSettingsRuntime({ store: storeFixture(), makeStarter: () => undefined });
  await assert.rejects(runtime.stopManagedChannel('mac-b'), error => error.code === 'CHANNELS_UNAVAILABLE');
  runtime.attachCarrier({ activeManaged: 0, snapshot: () => [], stopManaged: async () => { throw Object.assign(new Error('x'), { code: 'CHANNEL_NOT_FOUND' }); } });
  await assert.rejects(runtime.stopManagedChannel('mac-b'), error => error.code === 'CHANNEL_NOT_FOUND');
  runtime.attachCarrier({ activeManaged: 0, snapshot: () => [], stopManaged: async () => { throw new Error('raw adapter secret'); } });
  await assert.rejects(runtime.stopManagedChannel('mac-b'), error => error.code === 'CHANNELS_UNAVAILABLE' && !/secret/u.test(error.message));
  await runtime.dispose();
  await assert.rejects(runtime.stopManagedChannel('mac-b'), error => error.code === 'SETTINGS_UNAVAILABLE');
});
