import { randomUUID } from 'node:crypto';
const fail = code => Object.assign(new Error(code), {code});
// Only expose known diagnostic codes, never adapter messages or raw CLI output.
const acquisitionCodes = new Set([
  'ABORTED', 'MANAGED_UNAVAILABLE', 'INVALID_MANAGED_CONFIG',
  'CONNECT_ABORTED', 'CONNECT_CLOSED', 'CONNECT_SPAWN_FAILED',
  'CONNECT_EXITED', 'CONNECT_STARTUP_TIMEOUT', 'CONNECT_OUTPUT_REJECTED',
  'CONNECT_ADAPTER_FAILED', 'CONNECT_CLEANUP_FAILED',
  'CONNECT_TARGET_BUSY', 'CONNECT_RETRY_EXHAUSTED',
  'CHANNEL_NOT_FOUND', 'CHANNEL_NOT_READY', 'CHANNEL_TARGET_CHANGED', 'SETTINGS_BUSY',
]);
function acquisitionCode(error) {
  try { return acquisitionCodes.has(error?.code) ? error.code : 'ACQUIRE_FAILED'; }
  catch { return 'ACQUIRE_FAILED'; }
}
export function validateConnector(input) {
  try {
    if (!input || ![Object.prototype,null].includes(Object.getPrototypeOf(input))) throw 0;
    const descriptors=Object.getOwnPropertyDescriptors(input);
    const keys=Reflect.ownKeys(descriptors);
    if(keys.some(k=>typeof k!=='string'||!['kind','mode','tunnelId','remotePort','endpoint','channelId'].includes(k)||!Object.hasOwn(descriptors[k],'value'))) throw 0;
    const value=Object.fromEntries(keys.map(k=>[k,descriptors[k].value]));
    if(value.kind!=='devtunnel')throw 0;
    const mode=value.mode??'external';
    if(!['external','managed'].includes(mode)||typeof value.tunnelId!=='string'||!/^[a-z0-9][a-z0-9-]{0,99}(?:\.[a-z0-9]{1,20})?(?![\s\S])/u.test(value.tunnelId)
      ||!Number.isInteger(value.remotePort)||value.remotePort<1||value.remotePort>65535) throw 0;
    if (Object.hasOwn(value,'channelId') && (typeof value.channelId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value.channelId))) throw 0;
    let endpoint;
    if(mode==='external') {
      const d=Object.getOwnPropertyDescriptors(value.endpoint);
      if(Reflect.ownKeys(d).length!==2||!Object.hasOwn(d.host??{},'value')||!Object.hasOwn(d.port??{},'value')) throw 0;
      const host=d.host.value,port=d.port.value;
      if(!['127.0.0.1','::1'].includes(host)||!Number.isInteger(port)||port<1||port>65535) throw 0;
      endpoint=Object.freeze({host,port});
    } else if(Object.hasOwn(value,'endpoint')) throw 0;
    return Object.freeze({kind:'devtunnel',mode,tunnelId:value.tunnelId,remotePort:value.remotePort,...(value.channelId?{channelId:value.channelId}:{}),...(endpoint?{endpoint}:{})});
  } catch { throw fail('INVALID_CONNECTOR'); }
}
export const sanitizeConnector = validateConnector;

// Descriptor identity only: never accept persisted/user-supplied identity claims.
// machineId is a separate trust/pool scope owned by the SSH base.
export function targetIdentity(connector) {
  const config = validateConnector(connector);
  return JSON.stringify(['devtunnel-target-v1', config.kind, config.tunnelId, config.remotePort]);
}

// Independent adapter contract; registering with dsh-remote is deferred until API exists.
export function createCarrier({ startManaged, getManagedStarter, capabilities, onCarrier, diagnostics, getChannelEntry } = {}) {
  // Lease handoff events make the SSH layer's use of a managed channel visible:
  // the box then shows whether a failing probe ever reached the channel at all.
  const report = entry => { try { diagnostics?.record?.(entry); } catch { /* best effort */ } };
  const entries=new Map();let disposed=false,cleanupFailed=false,reconfiguring=false;
  const starter = () => typeof getManagedStarter === 'function' ? getManagedStarter() : startManaged;
  function releaseEntry(entry) {
    if(entry.cleanup) return entry.cleanup;
    entry.live=false;entry.resolveClosed();
    entry.cleanup=entry.ready.catch(()=>{}).then(()=>entry.handle?.close()).catch(()=>{cleanupFailed=true;throw fail('CLEANUP_FAILED');}).finally(()=>{if(entries.get(entry.machineId)===entry)entries.delete(entry.machineId);});
    return entry.cleanup;
  }
  // Independent channels are already running. A borrow tracks SSH users only;
  // releasing it cannot stop the plugin-owned process.
  async function acquireChannel({machineId,config,signal,resident}) {
    resident.use();
    let released=false;
    try {
      await resident.ready;
      if(released||disposed||signal?.aborted)throw fail('ABORTED');
      if(!resident.usable)throw fail('CONNECT_CLOSED');
      const valid=()=>{if(released||disposed||!resident.usable)throw fail('STALE_LEASE');};
      const endpoint=resident.endpoint; // guarded getter
      report({code:'CHANNEL_LEASED',machineId,mode:config.mode,tunnelId:config.tunnelId,remotePort:config.remotePort,
        endpoint,channelId:config.channelId,generation:resident.generation,stream:'ssh'});
      return Object.freeze({
        get dialHost(){valid();return resident.endpoint.host;},
        get dialPort(){valid();return resident.endpoint.port;},
        targetIdentity:JSON.stringify(['devtunnel',machineId,config.tunnelId,config.remotePort]),
        generation:resident.generation,
        closed:resident.closed, // shared channel generation invalidator
        release(){
          if(released)return Promise.resolve();
          released=true;
          resident.unuse();
          return Promise.resolve();
        },
      });
    } catch(error) {
      resident.unuse();
      throw fail(signal?.aborted?'ABORTED':acquisitionCode(error));
    }
  }
  async function acquire({machineId,connector,signal}={}) {
    if(disposed)throw fail('DISPOSED');
    if(cleanupFailed)throw fail('CLEANUP_FAILED');
    if(reconfiguring)throw fail('SETTINGS_UPDATING');
    if(typeof machineId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}(?![\s\S])/u.test(machineId))throw fail('INVALID_MACHINE_ID');
    if(signal!==undefined && !(signal instanceof AbortSignal))throw fail('INVALID_SIGNAL');
    if(signal?.aborted)throw fail('ABORTED');
    const config=validateConnector(connector),key=JSON.stringify(config);
    // The production runtime supplies the independent channel catalog. No
    // lookup failure may fall back to an SSH-owned connect process.
    if (typeof getChannelEntry === 'function' && (config.mode === 'managed' || config.channelId)) {
      const channel = getChannelEntry(config);
      return acquireChannel({machineId,config,signal,resident:channel});
    }
    let entry=entries.get(machineId);
    if(entry && entry.key!==key)throw fail('ACTIVE_CONNECTOR_CHANGED');
    // A closed generation cannot be reused. Await owned-process cleanup before
    // allowing the next on-demand generation to start (never two CLI children).
    if(entry && !entry.live) {
      await releaseEntry(entry);
      return acquire({machineId,connector,signal});
    }
    if(!entry) {
      let resolveClosed;const closed=new Promise(r=>{resolveClosed=r;});
      entry={machineId,key,config,closed,resolveClosed,refs:0,live:true,generation:randomUUID(),controller:new AbortController(),createdAt:Date.now()};
      entries.set(machineId,entry);
      entry.ready=Promise.resolve().then(async()=> {
        if(!entry.live)throw fail('ABORTED');
        if(config.mode==='external') {entry.endpoint=config.endpoint;return;}
        const start = starter();
        if(typeof start!=='function')throw fail('MANAGED_UNAVAILABLE');
        entry.handle=await start({tunnelId:config.tunnelId,remotePort:config.remotePort,signal:entry.controller.signal});
        entry.endpoint=validateConnector({...config,mode:'external',endpoint:entry.handle.endpoint}).endpoint;
        entry.handle.closed.then(()=>{void releaseEntry(entry).catch(()=>{});},()=>{void releaseEntry(entry).catch(()=>{});});
      });
    }
    const current=entry;current.refs++;let released=false,releaseTask;
    const release=()=> {
      if(releaseTask)return releaseTask;released=true;signal?.removeEventListener('abort',abort);
      current.refs--;
      if(current.refs===0){
        report({code:'CHANNEL_RELEASED',machineId:current.machineId,mode:current.config.mode,
          tunnelId:current.config.tunnelId,remotePort:current.config.remotePort,generation:current.generation,stream:'ssh'});
        current.controller.abort();releaseTask=releaseEntry(current);
      }
      else releaseTask=Promise.resolve();
      return releaseTask;
    };
    const abort=()=>{void release().catch(()=>{});};
    signal?.addEventListener('abort',abort,{once:true});
    // Check again after installing listener; aborted acquisition must not hang on startup.
    if(signal?.aborted)abort();
    let onAbort;
    const cancelled=new Promise((_,reject)=>{onAbort=()=>reject(fail('ABORTED'));signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)onAbort();});
    try {
      await Promise.race([current.ready,cancelled]);
      if(released||!current.live||disposed)throw fail('ABORTED');
      const valid=()=>{if(released||!current.live||disposed)throw fail('STALE_LEASE');};
      report({code:'CHANNEL_LEASED',machineId,mode:config.mode,tunnelId:config.tunnelId,remotePort:config.remotePort,
        endpoint:{host:current.endpoint.host,port:current.endpoint.port},generation:current.generation,stream:'ssh'});
      return Object.freeze({
        get dialHost(){valid();return current.endpoint.host;},get dialPort(){valid();return current.endpoint.port;},
        targetIdentity:JSON.stringify(['devtunnel',machineId,config.tunnelId,config.remotePort]),
        generation:current.generation,closed:current.closed,release,
      });
    } catch (error) {
      let code=acquisitionCode(error);
      await release(); // Cleanup failures take precedence over startup/cancellation.
      // Final-owner release already awaited startup. A cancellation may have
      // won the race before the adapter reported its failed process cleanup.
      if(current.refs===0) await current.ready.catch(startError=>{
        if(acquisitionCode(startError)==='CONNECT_CLEANUP_FAILED')code='CONNECT_CLEANUP_FAILED';
      });
      throw fail(code==='CONNECT_CLEANUP_FAILED'?code:signal?.aborted?'ABORTED':code);
    }
    finally {signal?.removeEventListener('abort',onAbort);}
  }
  const carrier = Object.freeze({id:'devtunnel',apiVersion:1,
    capabilities:capabilities ?? Object.freeze({managedConnect:typeof startManaged==='function',
      automaticLocalPort:typeof startManaged==='function',reconnect:typeof startManaged==='function'?'bounded-on-demand':'manual'}),
    validateConnector,sanitizeConnector,targetIdentity,acquire,
    get activeManaged(){return [...entries.values()].filter(e=>e.config.mode==='managed').length;},
    // Read-only management view for the settings panel: live channel identity,
    // state and loopback endpoint. Never exposes handles, signals or CLI output.
    snapshot(){
      return [...entries.values()].map(entry=>({machineId:entry.machineId,mode:entry.config.mode,
        tunnelId:entry.config.tunnelId,remotePort:entry.config.remotePort,
        state:!entry.live?'closing':entry.endpoint?'ready':'starting',
        endpoint:entry.endpoint?{host:entry.endpoint.host,port:entry.endpoint.port}:null,
        since:entry.createdAt,generation:entry.generation,refs:entry.refs}));
    },
    // Explicit user stop of ONE managed channel. The carrier still owns process
    // cleanup; callers must never assume the SSH session survives (no replay).
    async stopManaged(machineId){
      if(disposed)throw fail('DISPOSED');
      if(cleanupFailed)throw fail('CLEANUP_FAILED');
      if(reconfiguring)throw fail('SETTINGS_UPDATING');
      if(typeof machineId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}(?![\s\S])/u.test(machineId))throw fail('INVALID_MACHINE_ID');
      const entry=entries.get(machineId);
      if(!entry)throw fail('CHANNEL_NOT_FOUND');
      report({code:'CHANNEL_STOPPED',machineId,mode:entry.config.mode,tunnelId:entry.config.tunnelId,remotePort:entry.config.remotePort,generation:entry.generation,stream:'user'});
      entry.controller.abort();
      await releaseEntry(entry);
      return Object.freeze({machineId,mode:entry.config.mode,tunnelId:entry.config.tunnelId,remotePort:entry.config.remotePort});
    },
    // Reserve synchronously before awaits so a settings change cannot race new
    // acquires; cleanup must finish before swapping executables or authority.
    async reconfigureManaged(change){
      if(disposed)throw fail('DISPOSED');
      if(reconfiguring)throw fail('SETTINGS_BUSY');
      if(cleanupFailed)throw fail('CLEANUP_FAILED');
      reconfiguring=true;
      try {
        await Promise.all([...entries.values()].filter(e=>e.config.mode==='managed').map(e=>{
          e.controller.abort();return releaseEntry(e);
        }));
        return await change();
      } finally {reconfiguring=false;}
    },
    async dispose(){disposed=true;await Promise.all([...entries.values()].map(e=>{e.controller.abort();return releaseEntry(e);}));}
  });
  if(typeof onCarrier==='function')onCarrier(carrier);
  return carrier;
}
