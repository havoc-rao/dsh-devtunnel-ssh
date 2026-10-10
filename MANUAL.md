# 首版external/manual实验用户流程

安装本包仅注册carrier和两个命令：`devtunnel-ssh-status`、`devtunnel-ssh-help`。不会安装CLI、登录、启用SSH、改底座Config或连接机器。默认managed未启用；宿主明确配置后可按需托管，见下文。按用户最新要求，机器录入/当前端口更新/测试/镜像统一由dsh-remote现有RemoteSettings机器卡承载；本包不再增加独立设置页。本包浏览器半侧（manifest `dsh.client`）经公开槽位 `settings.remote.machine.transport.option` / `.fields` 注入类型按钮、通道模式与 devtunnel 字段，draft 由父侧提交（契约见 docs/devtunnel-ssh/remote-settings-slot-contract.md）；无独立设置页、不直接调用宿主路由。实际统一GUI接线仍需真实profile验收。本手册保留手工接线，不宣称GUI生产。

## 托管模式（A侧 connect，显式 opt-in）

保持双端安装/登录、B的sshd与独立主机pin前提。在 **dsh-remote统一Settings → DevTunnel全局设置** 中默认留空路径，自动从A宿主PATH检测已安装官方CLI（绝对路径覆盖为可选），勾选托管授权并明确确认保存，代表授权插件按需启动、维护和清理自己创建的 connect 进程。无需手工编辑Config文件；Config只在尚无已保存Settings时提供兼容默认。未授权或未检测到CLI保持关闭；界面只读显示解析路径与PATH/覆盖来源，找不到时刷新或提供可选覆盖；预检按钮仍需独立确认且使用宿主解析的当前路径，未保存修改不能预检，不自动运行。

刷新只读取设置。保存经宿主认证API持久化到DSH_HOME的插件数据目录，不改产品profile、不安装/登录或启动通道。修改路径/托管开关若有活动托管连接，必须确认断开；全部自有进程cleanup成功后再应用。旧SSH/PTY失效，不重放；external手动租约不受影响。保存使用revision避免覆盖另一窗口修改，冲突需刷新核对，不能自动重试。坏设置文件或cleanup失败均fail closed。多宿主进程同时写同一DSH_HOME不提供跨进程CAS，避免共享数据目录写入。

统一 RemoteSettings 中能力可用时选择「插件托管」，不填本地host/port。已有external机器可在同Tunnel ID/远端端口/pin保持不变时切换为托管并确认保存；无需删机器或重设指纹，旧业务连接失效且不重放。修改未保存时不能probe/mirror。全局已授权的新DevTunnel机器默认托管，未授权不自动授权。托管测试成功提示不显示external旧端口。 统一 RemoteSettings 中新增本插件注入的「Dev Tunnel 通道管理」box（活动通道/重试阻塞/最近事件，可显式断开单条通道，失败不自动重试）。managed 失败时宿主控制台会打印一行脱敏诊断（`reason` 说明是语法不支持的 Forwarding 行、远端端口不匹配，还是端口/行长/配额被拒），浏览器控制台在表单打开期间同步显示，另有只读 `GET /dsh-devtunnel-ssh/diagnostics`；日志不含 token/URL query/私钥，原始 CLI 输出不落盘也不下发。保存的connector示例：
```json
{"kind":"devtunnel","mode":"managed","tunnelId":"explicit-id.cluster","remotePort":22}
```
远端sshd端口不是本地动态端口，通常22但应核实。保存不启动；连接/测试时才启动CLI，匹配对应remotePort的loopback转发输出。CLI退出或映射改变令旧租约/SSH失效；后续连接在0.5/1.5/4秒退避后按需重建，最多初始+3次不稳定失败尝试。稳定存活30秒后恢复预算。取消/释放不计故障，无用户持有租约时不后台重连。终端、文件写入和失败请求不会自动重放。

异常输出、配置、spawn或无法确认cleanup的错误不自动重试；预算耗尽或安全封锁后，先排查CLI/登录/网络，显式重载插件才重置监督器。不恢复旧PTY；重新连接需重新验证SSH pin。只清理自有进程；同目标已有托管进程时不再启动第二个（不同machineId会报告busy）。B侧 `devtunnel host` 仍由用户维护，此模式不托管B。

本轮源码/fake测试不代表真实CLI、GUI、睡眠恢复或生产验收通过；实际部署另行授权，不改当前profile。

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
