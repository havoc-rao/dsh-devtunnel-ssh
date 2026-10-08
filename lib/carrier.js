import { randomUUID } from 'node:crypto';
const fail = code => Object.assign(new Error(code), {code});
export function validateConnector(input) {
  try {
    if (!input || ![Object.prototype,null].includes(Object.getPrototypeOf(input))) throw 0;
    const descriptors=Object.getOwnPropertyDescriptors(input);
    const keys=Reflect.ownKeys(descriptors);
    if(keys.some(k=>typeof k!=='string'||!['kind','mode','tunnelId','remotePort','endpoint'].includes(k)||!Object.hasOwn(descriptors[k],'value'))) throw 0;
    const value=Object.fromEntries(keys.map(k=>[k,descriptors[k].value]));
    if(value.kind!=='devtunnel')throw 0;
    const mode=value.mode??'external';
    if(!['external','managed'].includes(mode)||typeof value.tunnelId!=='string'||!/^[a-z0-9][a-z0-9-]{0,99}(?:\.[a-z0-9]{1,20})?(?![\s\S])/u.test(value.tunnelId)
      ||!Number.isInteger(value.remotePort)||value.remotePort<1||value.remotePort>65535) throw 0;
    let endpoint;
    if(mode==='external') {
      const d=Object.getOwnPropertyDescriptors(value.endpoint);
      if(Reflect.ownKeys(d).length!==2||!Object.hasOwn(d.host??{},'value')||!Object.hasOwn(d.port??{},'value')) throw 0;
      const host=d.host.value,port=d.port.value;
      if(!['127.0.0.1','::1'].includes(host)||!Number.isInteger(port)||port<1||port>65535) throw 0;
      endpoint=Object.freeze({host,port});
    } else if(Object.hasOwn(value,'endpoint')) throw 0;
    return Object.freeze({kind:'devtunnel',mode,tunnelId:value.tunnelId,remotePort:value.remotePort,...(endpoint?{endpoint}:{})});
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
export function createCarrier({ startManaged } = {}) {
  const entries=new Map();let disposed=false,cleanupFailed=false;
  function releaseEntry(entry) {
    if(entry.cleanup) return entry.cleanup;
    entry.live=false;entry.resolveClosed();
    entry.cleanup=entry.ready.catch(()=>{}).then(()=>entry.handle?.close()).catch(()=>{cleanupFailed=true;throw fail('CLEANUP_FAILED');}).finally(()=>{if(entries.get(entry.machineId)===entry)entries.delete(entry.machineId);});
    return entry.cleanup;
  }
  async function acquire({machineId,connector,signal}={}) {
    if(disposed)throw fail('DISPOSED');
    if(cleanupFailed)throw fail('CLEANUP_FAILED');
    if(typeof machineId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}(?![\s\S])/u.test(machineId))throw fail('INVALID_MACHINE_ID');
    if(signal!==undefined && !(signal instanceof AbortSignal))throw fail('INVALID_SIGNAL');
    if(signal?.aborted)throw fail('ABORTED');
    const config=validateConnector(connector),key=JSON.stringify(config);
    let entry=entries.get(machineId);
    if(entry && entry.key!==key)throw fail('ACTIVE_CONNECTOR_CHANGED');
    if(!entry) {
      let resolveClosed;const closed=new Promise(r=>{resolveClosed=r;});
      entry={machineId,key,config,closed,resolveClosed,refs:0,live:true,generation:randomUUID(),controller:new AbortController()};
      entries.set(machineId,entry);
      entry.ready=Promise.resolve().then(async()=> {
        if(!entry.live)throw fail('ABORTED');
        if(config.mode==='external') {entry.endpoint=config.endpoint;return;}
        if(typeof startManaged!=='function')throw fail('MANAGED_UNAVAILABLE');
        entry.handle=await startManaged({tunnelId:config.tunnelId,remotePort:config.remotePort,signal:entry.controller.signal});
        entry.endpoint=validateConnector({...config,mode:'external',endpoint:entry.handle.endpoint}).endpoint;
        entry.handle.closed.then(()=>{void releaseEntry(entry).catch(()=>{});},()=>{void releaseEntry(entry).catch(()=>{});});
      });
    }
    const current=entry;current.refs++;let released=false,releaseTask;
    const release=()=> {
      if(releaseTask)return releaseTask;released=true;signal?.removeEventListener('abort',abort);
      current.refs--;
      if(current.refs===0){current.controller.abort();releaseTask=releaseEntry(current);}
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
      return Object.freeze({
        get dialHost(){valid();return current.endpoint.host;},get dialPort(){valid();return current.endpoint.port;},
        targetIdentity:JSON.stringify(['devtunnel',machineId,config.tunnelId,config.remotePort]),
        generation:current.generation,closed:current.closed,release,
      });
    } catch { await release();throw fail(signal?.aborted?'ABORTED':'ACQUIRE_FAILED'); }
    finally {signal?.removeEventListener('abort',onAbort);}
  }
  return Object.freeze({id:'devtunnel',apiVersion:1,validateConnector,sanitizeConnector,targetIdentity,acquire,
    async dispose(){disposed=true;await Promise.all([...entries.values()].map(e=>{e.controller.abort();return releaseEntry(e);}));}
  });
}
