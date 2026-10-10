# dsh-devtunnel-ssh — 独立实验插件包

本包是可本地打包/装配的独立npm/DSH bundle，不替换旧Bridge包。private=true防止误发公共registry。peer dsh-remote按真实API能力检查而非猜未发布版本；正式最小版本待父侧发布冻结。

入口动态加载公开 `dsh-remote/lib/ssh-carrier.js`，缺失或注册失败安全显示能力缺失，不拖垮宿主。安装/加载本包不安装CLI、不登录、不启用SSH、不创建机器或连接隧道。

默认注册external/manual carrier。显式授权 `managedEnabled:true` 且宿主已检测到CLI后，可启用 managed 托管：仅在实际连接/测试时启动官方 `devtunnel connect`，自动解析本地端口；旧租约失效后，下次连接受控退避重建，不重放SSH业务。保存机器及加载插件不启动CLI。**两端A/B都需自行安装官方devtunnel CLI并明确完成GitHub登录**，不是安装插件就已具备；B还需用户授权的系统sshd/账号与独立核实的主机fingerprint。agent不自动安装、登录、读取密钥/agent/cache或启用服务。

**实验route源码已组合验证**：显式opt-in下CRUD、fresh probe、schema3 mirror与cache/卸载可测试；不是只实现registry。当前实例能力由宿主认证的`GET /dsh-remote/status`返回`sshCarrierCapabilities`决定；托管通过注册carrier的精确 `managedConnect` 能力与宿主workspace opt-in共同门控；本包capabilities模块将真实`workspaceSupported:true`映射为`experimentalWorkspaceSupported:true`，缺失/未知false，不从registry推断。用户入口统一在父dsh-remote的RemoteSettings机器卡，不再注册独立settings.section。父侧只声明两个槽位（`settings.remote.machine.transport.option` / `.fields`）；本包浏览器半侧（manifest `dsh.client` + `exports["./client"]`）经公开 `ctx.slots.inject` 注入「Dev Tunnel SSH」类型按钮、通道模式与全部 devtunnel 字段，并把经能力门控的连接体 draft 交回父侧提交；本包不直接调用任何宿主路由。父侧保留机器注册表与通用保存/probe/mirror接线；本包保留carrier、CLI预检及status/help。契约见[docs/devtunnel-ssh/remote-settings-slot-contract.md](<docs/devtunnel-ssh/remote-settings-slot-contract.md>)。**ordinaryWorkspaceReady=false / productionReady=false**：真实GUI、all-dial/凭据与剩余Step0未验收；无产品profile部署或个人Tunnel自动测试。

全局CLI路径与托管授权在 **dsh-remote统一RemoteSettings → DevTunnel设置** 中保存，无需手工编辑Config文件。默认留空，从宿主PATH自动检测 `devtunnel`，不运行shell/which/CLI，不搜索空或相对/current目录。手动覆盖为可选POSIX绝对路径（例如`/Users/YOU/bin/devtunnel`），不展开`~`；覆盖失败不偷偷回退PATH。界面显示只读检测结果，宿主PATH可能不同于终端。认证专用Settings API要求明确确认、revision乐观校验；改变活动托管设置须确认断开，先完成进程cleanup再应用新路径/授权。保存不执行CLI；预检仍独立确认并使用宿主已保存路径。设置只持久化两个非秘密字段到DSH_HOME下插件数据目录，权限0600、原子替换；坏文件fail closed禁用managed。公开Schemastery Config保留为首次未保存时的兼容默认，默认空路径/托管关闭；Settings保存后优先，不改产品profile。 统一 RemoteSettings 里新增本插件注入的「Dev Tunnel 通道管理」box：活动托管通道（机器/Tunnel ID/端口/回环端点/起始时间）、重试或阻塞状态、最近事件，并可对单条通道显式断开（确认后执行，失败不重试）；数据来自本插件只读路由 `GET /dsh-devtunnel-ssh/channels`（断开为 `POST` 同路径）。managed 连接失败（如 `CONNECT_OUTPUT_REJECTED`）现在会脱敏记录：宿主控制台每次拒绝一行（`ctx.logger`，缺失回落 console），浏览器控制台在 Dev Tunnel 表单打开期间镜像宿主条目，另有只读 `GET /dsh-devtunnel-ssh/diagnostics`；原始 CLI 输出从不落日志/响应（URL/token/长串全部掩码，见[docs/devtunnel-ssh/managed-connect-diagnostics.md](<docs/devtunnel-ssh/managed-connect-diagnostics.md>))。

安装后使用`devtunnel-ssh-status`和`devtunnel-ssh-help`；完整首版external流程已随包提供[MANUAL.md](<MANUAL.md>)。API接线必须走宿主正式认证，无猜测Bearer/cookie脚本。统一 RemoteSettings 仅在 authenticated status 的 `sshCarrierCapabilities.devTunnelManaged=true` 时允许选 managed；默认仍是 external。

受控本地pack检查：`npm pack --dry-run --json --ignore-scripts`。未提供自动安装脚本。本仓[合同与证据](<docs/devtunnel-ssh/adapter-contract.md>)仅源码开发参考，不打入包。
