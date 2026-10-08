// Classic browser entry: public ModuleLoader + React + settings.section slots.
window.__ModuleLoader__.load({ id: 'dsh-devtunnel-ssh', factory: require => {
  const React = require('react');
  const name = 'dsh-devtunnel-ssh';
  function createApi(fetchImpl, protocol) {
    const allowed = new Set(['status', 'machines', 'test-connect', 'mirror', 'preflight']);
    return async (method, route, body) => {
      if (!allowed.has(route) || !['GET','POST'].includes(method)) throw Error('INVALID_API_REQUEST');
      const path = (protocol === 'dsh-app:' ? '/api' : '') + (route === 'preflight' ? '/dsh-devtunnel-ssh/preflight' : '/dsh-remote/' + route);
      const options = { method, credentials: 'same-origin', redirect: 'error', headers: {} };
      if (body !== undefined) { options.headers['Content-Type']='application/json'; options.body=JSON.stringify(body); }
      const res = await fetchImpl(path, options);
      if (res.status === 401 || res.status === 403) throw Error('HOST_AUTH_REQUIRED');
      const data = await res.json();
      if (!res.ok || data.ok === false) throw Error(classifyFailure(data.error));
      return data;
    };
  }
  function classifyFailure(error) {
    const text=typeof error==='string'?error:'';
    if(text.includes('HOST_CLI_PATH_NOT_CONFIGURED'))return 'CLI_PATH_REQUIRED';
    if(/target cannot change|fingerprint cannot change/iu.test(text))return 'TARGET_OR_PIN_CHANGE_REQUIRES_NEW_MACHINE';
    if(/fingerprint|host key|hostkey|pin mismatch/iu.test(text))return 'SSH_TRUST_FAILED';
    if(/authentication|permission denied|agent|private.key/iu.test(text))return 'SSH_AUTH_FAILED';
    if(/ECONNREFUSED|ETIMEDOUT|unreachable|connect timeout|lease closed/iu.test(text))return 'ENDPOINT_UNREACHABLE';
    if(/experimental|not installed|unavailable/iu.test(text))return 'CAPABILITY_REQUIRED';
    return 'HOST_REQUEST_REJECTED';
  }
  function errorMessage(code) {
    const messages={HOST_AUTH_REQUIRED:'宿主认证失效，请正常重新登录。',CLI_PATH_REQUIRED:'未配置宿主官方CLI绝对路径；预检未执行，不能记为通过。',SSH_TRUST_FAILED:'SSH主机信任失败：请独立核实目标与pin，不要关闭校验。',SSH_AUTH_FAILED:'SSH认证失败：当前流程固定使用宿主agent，请检查宿主SSH_AUTH_SOCK与B账号授权。',ENDPOINT_UNREACHABLE:'当前保存端点不可达：检查官方connect所属listener及动态端口，保存新端口后再测。',CAPABILITY_REQUIRED:'宿主实验opt-in或插件能力未就绪；不降级到普通localhost机器。',TARGET_OR_PIN_CHANGE_REQUIRES_NEW_MACHINE:'Tunnel目标或pin改变必须新增机器/重新信任，不能原地替换。',INVALID_FORM:'输入不合法：核对ID、用户、独立pin与1–65535端口。'};
    return messages[code]||'宿主拒绝请求；请检查安全诊断。未重试，未降级。';
  }
  function hasUnsavedConnection(form,existing) {
    if(!existing)return true;
    try {const body=buildMachine(form,existing);return body.username!==existing.username||body.connector.endpoint.host!==existing.connector.endpoint.host||body.connector.endpoint.port!==existing.connector.endpoint.port||existing.useAgent!==true;}catch{return true;}
  }
  function buildMachine(form, existing) {
    const text = key => typeof form[key] === 'string' ? form[key].trim() : '';
    const id=text('id'),username=text('username'),tunnelId=text('tunnelId'),pin=text('pin');
    const port=Number(form.localPort),remotePort=Number(form.remotePort);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}(?![\s\S])/u.test(id) || !username
      || !/^[a-z0-9][a-z0-9-]{0,99}(?:\.[a-z0-9]{1,20})?(?![\s\S])/u.test(tunnelId)
      || !/^SHA256:[A-Za-z0-9+/]{43}=?$/u.test(pin)
      || !Number.isInteger(port)||port<1||port>65535||!Number.isInteger(remotePort)||remotePort<1||remotePort>65535
      || !['127.0.0.1','::1'].includes(form.host)) throw Error('INVALID_FORM');
    if(existing && (existing.id!==id || existing.connector.tunnelId!==tunnelId || existing.connector.remotePort!==remotePort || existing.expectedHostFingerprint!==pin)) throw Error('TARGET_OR_PIN_CHANGE_REQUIRES_NEW_MACHINE');
    return {action:existing?'update':'add',id,name:text('name')||id,username,useAgent:true,privateKeyPath:'',
      expectedHostFingerprint:pin,connector:{kind:'devtunnel',mode:'external',tunnelId,remotePort,endpoint:{host:form.host,port}}};
  }
  function mirrorNavigationHint(result) {
    if(!result || typeof result.localMirror!=='string' || !result.localMirror.startsWith('/') || /[\x00-\x1f\x7f]/u.test(result.localMirror))throw Error('INVALID_MIRROR_RESPONSE');
    return 'A的远程工作区镜像已创建/绑定，但尚未切换当前会话，也不表示已下载B目录的全部文件。A上的本地工作区路径：\n'+result.localMirror+'\n下一步：在宿主侧栏“添加/选择工作区”中手动添加此路径，再在该工作区打开会话和终端。';
  }
  function capability(status) {
    const c=status && status.sshCarrierCapabilities;
    return !!(c && c.apiVersion===1 && c.experimental===true && c.schemaVersion===3 && c.workspaceSupported===true);
  }
  const request=createApi((...args)=>window.fetch(...args),window.location.protocol);
  function Page() {
    const [machines,setMachines]=React.useState([]),[supported,setSupported]=React.useState(false),[message,setMessage]=React.useState('尚未检查宿主能力'),[busy,setBusy]=React.useState(false),[existing,setExisting]=React.useState(null);
    const blank={id:'',name:'',username:'',tunnelId:'',remotePort:'22',localPort:'',host:'127.0.0.1',pin:'',remotePath:'',workspace:''};
    const [form,setForm]=React.useState(blank),[confirmed,setConfirmed]=React.useState(false),[lastProbe,setLastProbe]=React.useState('未测试');
    const h=React.createElement;
    const refresh=async()=>{const status=await request('GET','status');setSupported(capability(status));const result=await request('GET','machines');setMachines((result.machines||[]).filter(m=>m.connector && m.connector.kind==='devtunnel'));};
    const run=async(fn)=>{if(busy)return;setBusy(true);try{await fn();}catch(e){setMessage(errorMessage(e.message));}finally{setBusy(false);}};
    React.useEffect(()=>{let live=true;run(async()=>{if(live)await refresh();});return()=>{live=false;};},[]);
    const field=(key,label,type='text',disabled=false)=>h('label',{key,style:{display:'block',margin:'8px 0'}},label,h('input',{type,value:form[key],disabled:busy||disabled,onChange:e=>setForm({...form,[key]:e.target.value}),style:{display:'block',width:'100%'}}));
    function choose(m){setExisting(m);setConfirmed(false);setLastProbe('未测试（当前保存配置）');setForm({...blank,id:m.id,name:m.name||'',username:m.username||'',tunnelId:m.connector.tunnelId,remotePort:String(m.connector.remotePort),localPort:String(m.connector.endpoint?.port||''),host:m.connector.endpoint?.host||'127.0.0.1',pin:m.expectedHostFingerprint||''});}
    const canWrite=supported&&confirmed&&!busy;
    const unsaved=hasUnsavedConnection(form,existing);
    return h('section',{style:{maxWidth:700,padding:16}},h('h2',null,'Dev Tunnel SSH · external'),
      h('p',null,'两端官方CLI + 人工GitHub登录；B授权sshd。独立渠道核实pin，A当前端口归官方connect。OpenSSH成功不等于宿主agent可达。'),
      h('p',null,`实验工作区支持：${supported?'已启用':'未启用/未知'}；productionReady=false。managed未启用。`),
      h('button',{disabled:busy,onClick:()=>run(refresh)},'检查宿主能力 / 刷新机器'),
      h('button',{disabled:busy,onClick:()=>{if(window.confirm('仅检查DSH宿主配置的官方CLI版本，不安装/登录/启动隧道。继续？'))run(async()=>{const data=await request('POST','preflight',{confirmed:true,checkLogin:false});setMessage(data.installed===true?'A CLI版本：'+data.version+'；B仍需手工预检。':'A CLI未确认安装；请检查宿主cliExecutable配置。');});}},'A 本机CLI只读预检'),
      h('button',{disabled:busy,onClick:()=>{if(window.confirm('运行官方 user show --json，原始账号输出不会下发；未知schema登录态显示未知。继续？'))run(async()=>{const data=await request('POST','preflight',{confirmed:true,checkLogin:true});setMessage('CLI登录状态：'+(data.login?.loggedIn===true?'已登录':'未知（当前JSON schema未确认）')+'；请人工核实GitHub。');});}},'A 登录态只读检查（明确授权）'),
      h('p',{role:'status'},message),
      h('p',null,existing?'当前保存目标：'+existing.connector.tunnelId+':'+existing.connector.remotePort+'；端点：'+existing.connector.endpoint.host+':'+existing.connector.endpoint.port:'新机器：尚无保存目标'),
      h('p',null,'最近probe：'+lastProbe+(unsaved?'；有未保存连接修改，先保存再测试/绑定。':'')),
      h('p',null,'认证方式固定为宿主 SSH agent；选择含私钥的已有记录时须明确保存为agent后再probe，不读取私钥。新Tunnel ID请点击“新机器”，同目标CLI重启仅更新当前端口。'),
      h('ul',null,...machines.map(m=>h('li',{key:m.id},m.name||m.id,' ',h('button',{disabled:busy,onClick:()=>choose(m)},'编辑当前端口'),h('button',{disabled:!supported||busy,onClick:()=>{if(window.confirm('删除机器会清理绑定和活动连接，继续？'))run(async()=>{await request('POST','machines',{action:'delete',id:m.id});setExisting(null);setForm(blank);await refresh();setMessage('已删除');});}},'删除')))),
      h('button',{disabled:busy,onClick:()=>{setExisting(null);setForm(blank);setConfirmed(false);}},'新机器'),
      field('id','稳定机器ID','text',!!existing),field('name','名称'),field('username','B SSH用户（使用宿主agent）'),field('tunnelId','明确Tunnel ID.cluster','text',!!existing),field('remotePort','B sshd端口','number',!!existing),field('pin','独立确认的SHA256主机pin','text',!!existing),
      h('label',null,'本地loopback ',h('select',{value:form.host,disabled:busy,onChange:e=>setForm({...form,host:e.target.value})},h('option',{value:'127.0.0.1'},'127.0.0.1'),h('option',{value:'::1'},'::1'))),field('localPort','A官方connect当前动态端口','number'),
      h('label',null,h('input',{type:'checkbox',checked:confirmed,disabled:busy,onChange:e=>setConfirmed(e.target.checked)}),'我确认双端前提、当前listener归属及独立主机pin；保存不会自动选择工作区。'),
      h('button',{disabled:!canWrite,onClick:()=>run(async()=>{const body=buildMachine(form,existing);const result=await request('POST','machines',body);choose(result.machine);await refresh();setMessage('已保存；请执行真实连接测试。');})},existing?'更新当前端口':'保存机器'),
      h('button',{disabled:!canWrite||!existing||unsaved,onClick:()=>run(async()=>{setLastProbe('测试中（保存端点）');try{await request('POST','test-connect',{id:existing.id});setLastProbe('当前保存目标验证成功');setMessage('宿主fresh SSH/pin/exec测试成功（不等于完整生产验收）。');}catch(e){setLastProbe('失败：'+errorMessage(e.message));throw e;}})}, '测试宿主agent与严格pin'),
      h('p',null,'保存机器只是保存连接，不等于切换当前会话。下面输入B上的目录；插件会自动在A生成对应的本地镜像工作区路径，不需要把B路径当作A目录。镜像创建不表示立即下载全部远端文件。'),
      field('remotePath','B上的远端目录（例如B的 /tmp 下已授权目录）'),field('workspace','A上的现有会话工作区路径（用于绑定，不是B目录或自动生成的镜像路径）'),
      h('button',{disabled:!canWrite||!existing||unsaved,onClick:()=>{if(window.confirm('为B上的目录创建A的本地镜像并绑定所填工作区，不会自动切换当前会话或下载全部文件。继续？'))run(async()=>{if(!form.remotePath.trim()||!form.workspace.trim())throw Error('INVALID_FORM');const result=await request('POST','mirror',{machine:existing.id,path:form.remotePath.trim(),workspace:form.workspace.trim()});setMessage(mirrorNavigationHint(result));});}},'创建A的远程工作区镜像'),
      h('p',null,'无密码/token输入，无自动安装/CLI启动/配置修改。CLI端口变化需显式更新；目标或pin改变需新机器与重新信任。'));
  }
  // Legacy helper export only. Unified RemoteSettings is owned by dsh-remote.
  // No independent settings page, slots injection or browser service registration.
  async function apply() {}
  return {name,apply,inject:[],createApi,buildMachine,capability,classifyFailure,errorMessage,hasUnsavedConnection,mirrorNavigationHint};
}});
