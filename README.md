# dsh-devtunnel-ssh — 独立实验插件包

本包是可本地打包/装配的独立npm/DSH bundle，不替换旧Bridge包。private=true防止误发公共registry。peer dsh-remote按真实API能力检查而非猜未发布版本；正式最小版本待父侧发布冻结。

入口动态加载公开 `dsh-remote/lib/ssh-carrier.js`，缺失或注册失败安全显示能力缺失，不拖垮宿主。安装/加载本包不安装CLI、不登录、不启用SSH、不创建机器或连接隧道。

默认注册external/manual carrier，managed函数已有源码但本入口不自动启用（绝对CLI路径配置/审批尚未装配）。**两端A/B都需自行安装官方devtunnel CLI并明确完成GitHub登录**，不是安装插件就已具备；B还需用户授权的系统sshd/账号与独立核实的主机fingerprint。agent不自动安装、登录、读取密钥/agent/cache或启用服务。

**实验route源码已组合验证**：显式opt-in下CRUD、fresh probe、schema3 mirror与cache/卸载可测试；不是只实现registry。当前实例能力由宿主认证的`GET /dsh-remote/status`返回`sshCarrierCapabilities`决定；本包capabilities模块将真实`workspaceSupported:true`映射为`experimentalWorkspaceSupported:true`，缺失/未知false，不从registry推断。用户入口统一在父dsh-remote的RemoteSettings机器卡，不再注册独立settings.section。manifest移除dsh.client自动注入；./client仅保留旧纯表单/API helpers与noop apply供测试/兼容，非日常独立UI。父侧负责统一录入/更新/probe/mirror接线；本包保留carrier、CLI预检及status/help。**ordinaryWorkspaceReady=false / productionReady=false**：真实GUI、all-dial/凭据与剩余Step0未验收；无产品profile部署或个人Tunnel自动测试。

公开Schemastery Config：`cliExecutable`默认空，禁用预检；只接受macOS宿主POSIX绝对路径（例如`/Users/YOU/bin/devtunnel`），不展开`~`、不搜索PATH。需用户在隔离插件行配置，浏览器请求不可修改。null按框架默认归空，不执行CLI。

安装后使用`devtunnel-ssh-status`和`devtunnel-ssh-help`；完整首版external流程已随包提供[MANUAL.md](<MANUAL.md>)。API接线必须走宿主正式认证，无猜测Bearer/cookie脚本。managed不假装enabled。

受控本地pack检查：`npm pack --dry-run --json --ignore-scripts`。未提供自动安装脚本。本仓[合同与证据](<docs/devtunnel-ssh/adapter-contract.md>)仅源码开发参考，不打入包。
