# 续任务同步合同（拟议，2026-10-07）

父侧源码已新增通用 `registerSshCarrier/sshCarrierIds/sshCarrierOf`，本轮只读核实[实际registry](<../../../dsh-remote/lib/ssh-carrier.js>)并运行真实registry+adapter的无网络组合测试。本仓不修改底座，不宣称已发布/全链路可用。carrier def id=`devtunnel`, apiVersion=1；connector必须kind=`devtunnel`，机器transport保持`ssh`，machine.id稳定。`expectedHostFingerprint`另属SSH机器字段，严格pin归底座；拒绝useSshConfig/proxy混搭，不放进connector。

```js
connector = {
  kind: 'devtunnel', // connector选择字段；不是id
  mode: 'external', // 默认；managed显式选择
  tunnelId: 'example-id.jpe1',
  remotePort: 22,
  endpoint: { host: '127.0.0.1', port: 50736 } // external必填，不作为身份
}
// managed由宿主受控配置提供绝对executable，不从浏览器任意输入执行路径
registerSshCarrier({ id:'devtunnel', apiVersion:1,
  validateConnector, sanitizeConnector,
  acquire({machineId,connector,signal})
})
// lease {dialHost,dialPort,targetIdentity,generation,closed,release}
```

`targetIdentity` 建议为 JSON 编码的 [carrier id,machineId,tunnelId,remotePort]；username/authRevision由底座池键另加。generation 每次建立/外部端点录入变更产生新值，目标身份不随端口改变。目标变更须底座重新信任；插件不会以创建manager视为信任。

external不拥有外部CLI，release/dispose绝不停止外部进程。端点变更只能明确重录配置并失效旧代，禁止从偶然端口扫描推定目标；TCP reachability不是真SSH身份验证。external失效通知由abort/dispose及底座SSH连接失败协作，不能声称已观测外部CLI退出。

managed owns自身spawn child：固定argv，无shell/凭据参数；解析匹配remotePort的真实CLI转发消息（本地端口可自动分配），取消/启动超时清理；引用计数在carrier层，最后release关闭。自动重试预算0（显式重新acquire新代），不重放exec/write/PTY输入。基础模块lease-manager原型尚无signal接口；新adapter必须独立明确取消语义。

底座须：所有SSH/SFTP/PTY/forward统一承载resolver；严格逻辑指纹与目标revision，池/镜像机器隔离；PTY独立持有lease。缺注册API时只显示能力缺失，不能返回伪成功连接；现有诊断入口不影响宿主。

## 已实现模块形状（未部署）

- [carrier](<../../packages/devtunnel-ssh/lib/carrier.js>) `createCarrier({startManaged})` 返回上述def及dispose；validate/sanitize返回规范化connector，非法throw。external默认，不拥有CLI；同machine并发managed acquire singleflight，引用计数release，abort取消自身租约；配置活跃期改变拒绝。lease dial getter失效后throw，closed表示失效不是退出证明；release可等待清理，清理失败阻止再次acquire。
- [managed](<../../packages/devtunnel-ssh/lib/managed-connect.js>) `startManagedConnect({executable,tunnelId,remotePort,spawn?,signal?,startupTimeoutMs?,graceMs?,killMs?}) -> {endpoint:{host,port},closed,close}`。host-local executable由宿主配置提供，可通过 `startManaged: args=>startManagedConnect({...args,executable})` 接入carrier。
- [输出parser](<../../packages/devtunnel-ssh/lib/output-parser.js>) `createForwardingParser({remotePort,onForwarding}) -> push/finish`，每流独立，用真实历史样式匹配动态端口，未知候选拒绝。
- [前提诊断](<../../packages/devtunnel-ssh/lib/prerequisites.js>) `checkPrerequisites({executable,run,checkLogin=false,timeoutMs})`，run必需注入；返回白名单状态/数字版本，不给账号原文。run必须承担实际取消和自有进程清理。
- [能力注册](<../../packages/devtunnel-ssh/lib/registration.js>) `registerCarrierWhenAvailable(api,{startManaged})`：缺API -> ssh-api-required，注册异常 -> registration-unavailable，不破坏宿主；成功返回status/dispose。没有在旧lib/index或产品profile自动装配。

## Factory gate（父侧实验合同已核对）

公开building blocks路径为 `dsh-remote/lib/ssh-carrier.js` 与 `dsh-remote/lib/ssh-carrier-pool.js`；后者createCarrierSshPool(machine,config,{knownHostsFile,credentialResolver,signal})，严格expectedHostFingerprint pin，lease整pool生命周期包含PTY。close先关闭channels再release；失效只能新建pool，不能复活旧端点。

当前是whole-pool lease，并非每PTY lease；TTL不得关闭仍预期存活的terminal，生命周期引用策略待父侧解决。普通CRUD/mirrors/all-dial尚未完整，注册结果明确`ordinaryWorkspaceReady:false`，不以registry/factory存在显示普通工作区已ready；不手写registry、不用raw localhost机器替代正式接线。

底座可先external联调，managed不先自动启用。validate/sanitize返回值形状、closed失效通知与generation消费由父侧最终合同确认，不能将fixture注册PASS等同底座集成PASS。

进度文件已提前同步上述字段与当前模块；跨父树send_message不可用，父侧可读取本合同。安装/登录/SSH启用都属于用户前提，不自动执行。
