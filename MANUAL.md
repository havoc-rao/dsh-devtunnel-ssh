# Dev Tunnel 通道与 SSH 使用流程

本插件管理通道目录和 connect 进程；dsh-remote 管理 SSH。UI 统一在 RemoteSettings，独立通道列表通过 panel 槽位注入，不增加独立设置页。安装或加载插件不启动通道。

## 托管通道列表

1. 在 Dev Tunnel 整卡保存 CLI 路径（默认从宿主 PATH 检测）和托管授权；版本/登录状态预检需单独确认，使用已保存设置解析的路径。
2. 添加通道：名称、managed 模式、Tunnel ID、远端端口。保存后状态为 stopped。
3. 点击启动，确认后由插件执行 connect。列表显示 starting/recovering/ready/error、实际本地端口和 SSH 引用数。启动内有界重试；已启动通道意外退出会以 recovering 状态自动恢复（2s/8s/30s 退避，最多 3 次，稳定运行 5 分钟重置预算，耗尽进入 error 等待手动重启）。宿主睡眠/合屏/断电恢复后，检测到 ≥5 分钟挂起间隙会对仍 ready 的托管通道各重启一次，解决挂死隧道；用户停止或清理失败立即取消自动重启。
4. 新建 Dev Tunnel SSH 机器时选择通道，再填写 SSH 用户、认证方式与独立确认的主机指纹。机器保存/测试/镜像仍由 dsh-remote 提交。
5. SSH 可以独立断开；引用数归零不停止通道。停止/重启通道会让全部借用它的 SSH 连接失效，旧业务不会重放。已停止通道不会被后台 Git/SSH 查询拉起。
6. 编辑通道配置或删除条目需要确认，并先完成进程清理。修改目标后，旧机器仍绑定原目标，必须重新创建机器并确认目标信任；不会悄悄重定向。

通道目录保存在 DSH_HOME 的插件数据目录，独立于 SSH 机器注册表。列表包括停止/恢复中/失败的条目，最多 64 条，同一 Tunnel ID/远端端口只登记一次。多窗口修改使用 revision 检查；冲突后刷新核对，不自动重试。多宿主进程不应共用数据目录写入。

重载插件后保留配置，但 managed 通道停止，需显式启动。旧全局 resident 配置只在尚无目录时投影成一个停止的迁移条目，首次明确的目录写入才保存；不再支持 SSH 触发 lazy 启动。旧 managed 机器可按相同目标使用已有通道，编辑选择通道后保存 channelId。清理失败会阻止该条目再次启动或删除，避免遗留进程与新进程重叠。

external 条目只登记已有监听器及 IPv4/IPv6 loopback 端点，没有启动/停止/重启按钮，插件不能控制外部终端启动的进程。既有不带 channelId 的 external 机器继续支持手工端点。

更改全局 CLI/授权设置若存在活动通道，需要确认停止；完成清理后才应用设置。保存不执行 CLI，且不自动重新启动通道。实际产品 GUI 与个人 Tunnel 验收需另行完成；无部署或生产就绪声明。

## 1. 人工前提

A必须是运行DSH host的Mac，浏览器所在电脑localhost不一定是A。A/B都先安装微软官方devtunnel并自行GitHub登录。B用户明确授权system sshd与账号，独立渠道取得SHA256主机指纹。确认独立Tunnel私有ACL，不能用Public/匿名模式。不要把token、私钥、密码、缓存发聊天。

用户在A前台运行 `devtunnel connect EXPLICIT_ID.CLUSTER`，从remotePort22对应的真实转发输出取得loopback端口（比如50736；不能硬编码）。检查该listener归官方CLI。用户持有CLI，external release不会kill它。OpenSSH ssh-add成功不证明DSH host进程/ssh2已获agent权限。

## 2. 用户明确许可的隔离sandbox

选择隔离DSH_HOME/profile，按宿主正式插件装配流程添加本包和支持carrier的dsh-remote；不要覆盖正在使用的旧Bridge或产品profile。另行显式设置底座 `experimentalSshCarrier:true`，默认false。核对sandbox实际URL，不改当前GUI、不启动替代GUI冒充更新。

HTTP请求必须遵循该sandbox宿主现有认证机制。没有通用public HTTP调用服务/凭据格式已核实可用，因此本包不提供猜测Bearer、cookie或无认证curl脚本。用户通过正式已认证API客户端/宿主现有请求机制操作。无法确认认证时停止，不借用缓存或浏览器cookie绕过。

GET `/dsh-remote/status`：检查 `sshCarrierCapabilities.apiVersion=1`，`workspaceSupported=true`/`freshProbe=true`；productionReady仍false。缺/未知false，不由插件registry存在推断。

POST `/dsh-remote/machines` body（所有示例占位需替换）：
```json
{"action":"add","id":"sandbox-mac-b","name":"Sandbox Mac B","username":"REMOTE_USER","useAgent":true,"expectedHostFingerprint":"SHA256:CONFIRMED_PIN","connector":{"kind":"devtunnel","mode":"external","tunnelId":"explicit-id.cluster","remotePort":22,"endpoint":{"host":"127.0.0.1","port":50736}}}
```
不放host/port顶层，不放password/passphrase/token或自填targetIdentity；保存不激活工作区。公开response不应有秘密。

POST `/dsh-remote/test-connect`：`{"id":"sandbox-mac-b"}`，fresh严格pin pool在finally释放。真实hostKeyVerified只在真实SSH成功才记PASS。若失败，排查宿主SSH_AUTH_SOCK/授权私钥路径、CLI listener和B账号；不得fallback localhost普通机器。

POST `/dsh-remote/mirror`：
```json
{"path":"/REMOTE/AUTHORIZED/EXPERIMENT_DIR","machine":"sandbox-mac-b","workspace":"/LOCAL/SANDBOX/WORKSPACE"}
```
实际授权目录，响应localMirror的meta schema3应有machineId/canonical target，无runtime端口。通过真实DSH agent/fs/terminal入口核对B hostname/username与文件操作，不以浏览器API成功代替host工具上下文。

## 3. 更新与结束

connect重启动态端口后，显式machines update同id完整connector endpoint；逻辑target/pin不变，旧业务/输入不重放。目标/指纹改变不得原地替换信任。POST machines `{"action":"delete","id":"sandbox-mac-b"}`，检查绑定/PTY/pool清理；CLI由用户停止自己前台进程。

完整门还需：关闭VSCode独立host工作、未授权Tunnel拒绝、完整8MiB大小/hash/cmp、PTY Ctrl-C/resize/关闭、睡眠恢复与宿主真实认证。既有用户256KiB/resize成功不是全部通过，8MiB中断不算完整性证据。无人值守不承诺。

本包status/help是真可注册命令；API步骤仍需用户手动操作和授权sandbox。核心后续：真实宿主装配/GUI验收、认证请求接入、managed真实CLI/GUI/恢复验收、前提runner接线和listener归属验证。不得只凭本手册宣布生产ready。
