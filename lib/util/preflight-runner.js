import { spawn as hostSpawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { parsePrerequisiteResult } from './prerequisites.js';
// Host Node process only: never ctx.subprocess, whose world may be remote.
export function createPreflightRunner({ executable, spawn = hostSpawn } = {}) {
  if(typeof executable!=='string'||!isAbsolute(executable)||/[\x00-\x1f\x7f]/u.test(executable)||typeof spawn!=='function')throw Error('INVALID_PREFLIGHT_CONFIG');
  return async function run(args) {
    const key=JSON.stringify(args);
    if(!['["--version"]','["user","show","--json"]'].includes(key))throw Error('INVALID_PREFLIGHT_COMMAND');
    return new Promise(resolve=>{
      let child,timer,killTimer,finished=false,bytes=0,stdout='',stderr='';
      const finish=result=>{if(finished)return;finished=true;clearTimeout(timer);clearTimeout(killTimer);resolve(result);};
      const stop=()=>{
        try{child.kill('SIGTERM');}catch{}
        if(finished)return;
        killTimer=setTimeout(()=>{try{child.kill('SIGKILL');}catch{}finish({code:null,stdout:'',stderr:''});},500);
      };
      try{child=spawn(executable,args,{shell:false,stdio:['ignore','pipe','pipe'],detached:false});}
      catch(error){finish({code:error?.code==='ENOENT'?'ENOENT':null,stdout:'',stderr:''});return;}
      let stopping=false;
      const abort=()=>{if(stopping||finished)return;stopping=true;stdout='';stderr='';stop();};
      for(const [stream,name] of [[child.stdout,'stdout'],[child.stderr,'stderr']]){
        stream.on('data',chunk=>{if(finished||stopping)return;bytes+=Buffer.byteLength(chunk);if(bytes>65536){abort();return;}if(name==='stdout')stdout+=chunk.toString();else stderr+=chunk.toString();});
        stream.on('error',abort);
      }
      child.on('error',error=>finish({code:error?.code==='ENOENT'?'ENOENT':null,stdout:'',stderr:''}));
      child.on('close',code=>finish({code:stopping?null:code,stdout:stopping?'':stdout,stderr:stopping?'':stderr}));
      timer=setTimeout(abort,5000);
    });
  };
}
export function parseLoginJson(result) {
  // Real user-show JSON schema has not been inspected with a personal account.
  // Until an official documented/approved fixture schema is supplied, unknown
  // is the only truthful login result. Never guess success from arbitrary fields.
  return Object.freeze({loggedIn:null,provider:'unknown',accountLabel:null});
}
export async function preflight({executable,spawn,checkLogin=false}) {
  const run=createPreflightRunner({executable,spawn});
  // Single version parser: prerequisites.js owns the whitelist grammar, this
  // module only owns host-child spawning. Login JSON stays conservatively unknown.
  const version=parsePrerequisiteResult('version',await run(['--version']));
  if(version.status!=='installed')return {installed:version.status==='not-installed'?false:null,version:null,login:{loggedIn:null,provider:'unknown',accountLabel:null}};
  const login=checkLogin?parseLoginJson(await run(['user','show','--json'])):{loggedIn:null,provider:'unknown',accountLabel:null};
  return {installed:true,version:version.version,login};
}
