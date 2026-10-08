# 首版external/manual实验用户流程

安装本包仅注册carrier和两个命令：`devtunnel-ssh-status`、`devtunnel-ssh-help`。不会安装CLI、登录、启用SSH、改底座Config或连接机器。managed代码存在但未由入口启用。按用户最新要求，机器录入/当前端口更新/测试/镜像统一由dsh-remote现有RemoteSettings机器卡承载；本包不再增加独立设置页。旧client helper apply为noop，manifest无client自动注入。实际统一GUI接线由父侧实现验收。本手册保留手工接线，不宣称GUI生产。

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

本包status/help是真可注册命令；API步骤仍需用户手动操作和授权sandbox。核心后续：真实宿主装配/GUI验收、认证请求接入、managed受控配置/审批、前提runner接线和listener归属验证。不得只凭本手册宣布生产ready。
