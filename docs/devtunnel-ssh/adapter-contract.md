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

managed owns自身spawn child：固定argv，无shell/凭据参数；解析匹配remotePort的真实CLI转发消息（本地端口可自动分配），取消/启动超时清理；引用计数在carrier层，最后release关闭。自动重试预算0（显式重新acquire新代），不重放exec/write/PTY输入。原[lease-manager原型](<../../archive/lease-manager.js>)（传输无关、无signal接口）已于分层重构时归档，生产取消语义由 [carrier](<../../lib/core/carrier.js>) 内联持有：外部AbortSignal取消、connector活跃期变化拒绝、引用计数最后释放关闭。

底座须：所有SSH/SFTP/PTY/forward统一承载resolver；严格逻辑指纹与目标revision，池/镜像机器隔离；PTY独立持有lease。缺注册API时只显示能力缺失，不能返回伪成功连接；现有诊断入口不影响宿主。

## Git snapshot wire 边界（2026-10-12）

- carrier 机器允许没有顶层 `host`/`port`，即使 external connector 内有 endpoint，也不能把该运行拨号端点投影为稳定机器身份。managed connector 不持久化 endpoint；canonical descriptor 为 `['devtunnel-target-v1', kind, tunnelId, remotePort]`，不包含 mode、channelId、端点或 generation。lease targetIdentity 另包含 machineId 用于 SSH 隔离，两者不能混为同一层契约。
- schema3 carrier mirror 仍由 dsh-remote `/git-workspace` 读取远端 Git 并生成 snapshot；本插件只交接 SSH lease，不复制 Git 服务，不通过虚构 host/port 绕过消费者 guard。
- 生产方建议：repo/nonRepo 使用同一 transport-neutral machine 摘要/序列化器，身份取规范化 descriptor，不读取或 acquire lease 只为拼机器摘要；如需旧消费者兼容，应由 wire 层定义明确 display/兼容字段，不能污染持久化机器或把 localhost 当身份。
- 消费者建议：校验有判别字段的 direct/carrier 摘要，direct 维持真实 host 校验，carrier 不强制 direct host；拒绝未知/畸形 identity，repo 与 nonRepo 两支统一校验，旧 direct SSH payload 继续兼容。
- 验收：对真实 JSON round-trip 后的 direct SSH、external/managed carrier，分别验证 repo 和 nonRepo；端点旋转后 canonical identity 与镜像定位不变、generation 更新、旧 dial getter 失效；停止通道时不得被后台 Git 自动启动。运行中 GUI 的 marker/warning 与已部署生产方/消费者版本须单独验收，单测通过不能代替该证据。
- 本仓回归仅证明 carrier/record 身份边界，不证明 Git route 或 UI guard 已修复。peerDependency `dsh-remote: "*"` 不是 wire 能力保证；发布协调需由 dsh-remote/消费者确定最低兼容版本，本仓不猜版本、不自动部署。

## 已实现模块形状（未部署）

- [carrier](<../../lib/core/carrier.js>) `createCarrier({startManaged})` 返回上述def及dispose；validate/sanitize返回规范化connector，非法throw。external默认，不拥有CLI；同machine并发managed acquire singleflight，引用计数release，abort取消自身租约；配置活跃期改变拒绝。lease dial getter失效后throw，closed表示失效不是退出证明；release可等待清理，清理失败阻止再次acquire。
- [managed](<../../lib/core/managed-connect.js>) `startManagedConnect({executable,tunnelId,remotePort,spawn?,signal?,startupTimeoutMs?,graceMs?,killMs?}) -> {endpoint:{host,port},closed,close}`。host-local executable由宿主配置提供，可通过 `startManaged: args=>startManagedConnect({...args,executable})` 接入carrier。
- [输出parser](<../../lib/util/output-parser.js>) `createForwardingParser({remotePort,onForwarding}) -> push/finish`，每流独立，用真实历史样式匹配动态端口，未知候选拒绝。
- [前提诊断](<../../lib/util/prerequisites.js>) `checkPrerequisites({executable,run,checkLogin=false,timeoutMs})`，run必需注入；返回白名单状态/数字版本，不给账号原文。run必须承担实际取消和自有进程清理。版本白名单解析为唯一实现，宿主探测 [preflight-runner](<../../lib/util/preflight-runner.js>) 经 `parsePrerequisiteResult` 复用同一解析（后者只持有宿主spawn）。
- [能力注册](<../../lib/core/registration.js>) `registerCarrierWhenAvailable(api,{startManaged})`：缺API -> ssh-api-required，注册异常 -> registration-unavailable，不破坏宿主；成功返回status/dispose。没有在旧lib/index或产品profile自动装配。

## 常驻隧道（全局单通道，2026-10-10 新增）

- settings 契约：新增 `residentTunnelId`（空或白名单 tunnel id）、`residentRemotePort`（0 或 1-65535）、`residentMode`（`off`/`immediate`/`lazy`）。一致性：id 空 ⟺ port 0；mode≠off 要求 id 非空。legacy 两键记录读取时补 off 默认。无独立启动按钮之外的授权：immediate 确认保存即显式授权 spawn。
- 语义：immediate=保存后插件立即 spawn 并保持；lazy=首个匹配 SSH 会话 acquire 时启动，会话释放不关。两者都只在显式动作（设置改 off/配置变更/卸载）时停止，release 永不停止常驻进程。
- 会话租用：managed connector 的 tunnelId/remotePort 与常驻配置一致时，carrier acquire 返回常驻代 lease（dialHost/dialPort 守卫 getter、共享 closed、generation=常驻代），release 只解除本会话（STALE_LEASE）；不匹配的 connector 走原 owned 路径不受影响。
- 失效与恢复：常驻进程退出/端口旋转 → 当代 closed → 持有会话全部失效；下次 acquire 等待新代（immediate 有界自动重试，lazy 仅在有需求时）。非可重试错误毒化该 starter 实例（面板显示 blocked）；显式保存设置重建 starter 解除毒化。

## Factory gate（父侧实验合同已核对）

公开building blocks路径为 `dsh-remote/lib/ssh-carrier.js` 与 `dsh-remote/lib/ssh-carrier-pool.js`；后者createCarrierSshPool(machine,config,{knownHostsFile,credentialResolver,signal})，严格expectedHostFingerprint pin，lease整pool生命周期包含PTY。close先关闭channels再release；失效只能新建pool，不能复活旧端点。

当前是whole-pool lease，并非每PTY lease；TTL不得关闭仍预期存活的terminal，生命周期引用策略待父侧解决。普通CRUD/mirrors/all-dial尚未完整，注册结果明确`ordinaryWorkspaceReady:false`，不以registry/factory存在显示普通工作区已ready；不手写registry、不用raw localhost机器替代正式接线。

底座可先external联调，managed不先自动启用。validate/sanitize返回值形状、closed失效通知与generation消费由父侧最终合同确认，不能将fixture注册PASS等同底座集成PASS。

进度文件已提前同步上述字段与当前模块；跨父树send_message不可用，父侧可读取本合同。安装/登录/SSH启用都属于用户前提，不自动执行。
