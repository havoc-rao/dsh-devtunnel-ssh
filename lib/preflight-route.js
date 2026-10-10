import { preflight } from './preflight-runner.js';
export function installPreflightRoute(ctx,{executable,spawn,runtime}={}) {
  if(typeof ctx.inject!=='function')return;
  // No browser-provided executable; host config only. Host webServer keeps auth.
  ctx.inject(['webServer'],inner=>{
    const server=inner.get('webServer');if(!server||typeof server.register!=='function')return;
    let busy=false;
    inner.effect(()=>server.register({kind:'exact',path:'/dsh-devtunnel-ssh/preflight',handler:async(req,res)=>{
      const reply=(status,data)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
      if(req.method!=='POST')return reply(405,{ok:false,error:'METHOD_NOT_ALLOWED'});
      if(!runtime&&!executable)return reply(409,{ok:false,error:'HOST_CLI_PATH_NOT_CONFIGURED'});
      if(busy)return reply(409,{ok:false,error:'PREFLIGHT_BUSY'});
      let bytes=0,text='';try{for await(const chunk of req){bytes+=Buffer.byteLength(chunk);if(bytes>1024)throw 0;text+=chunk;}const body=JSON.parse(text);
        if(!body||Object.keys(body).some(k=>!['confirmed','checkLogin'].includes(k))||body.confirmed!==true||typeof body.checkLogin!=='boolean')throw 0;
        busy=true;try{
          const run=async path=>{
            if(!path)throw Object.assign(new Error('HOST_CLI_PATH_NOT_CONFIGURED'),{code:'HOST_CLI_PATH_NOT_CONFIGURED'});
            return preflight({executable:path,spawn,checkLogin:body.checkLogin});
          };
          const result=runtime?await runtime.withExecutable(run):await run(executable);
          reply(200,{ok:true,...result});
        }finally{busy=false;}
      }catch(error){
        const code=['HOST_CLI_PATH_NOT_CONFIGURED','HOST_CLI_NOT_FOUND','SETTINGS_BUSY','SETTINGS_UNAVAILABLE'].includes(error?.code)?error.code:'PREFLIGHT_REJECTED';
        reply(code==='PREFLIGHT_REJECTED'?400:409,{ok:false,error:code});
      }
    }}));
  });
}
