# 独立 Dev Tunnel SSH 插件：预 Step0 阶段

日期：2026-10-07。**新 SSH Step0 NOT RUN；未产品化、未部署。** 第一台目标平台 macOS。持续目标已建立，当前推进安全夹具及契约核查，不将旧 HTTP Bridge 实验当作本门证据。

## 架构选择

```text
DSH host / 本仓独立插件（CLI 管理、诊断/后续 UI）
  -> 官方 devtunnel connect（控制端本机、显式私有 tunnel）
  -> 临时 loopback TCP（不是机器身份）
  -> Azure Dev Tunnel
  -> 官方独立 devtunnel host（远端 Mac，不是 code tunnel）
  -> 系统 sshd
```

SSH/SFTP/PTY、认证与指纹校验必须复用 dsh-remote；[公开接口缺口报告](<contract-gap.md>) 说明当前为什么不能直接接通。没有复制 SSH 引擎、深导入 pool、monkey patch、自研远端 Worker 或 VS Code 扩展依赖。旧运行入口保留，仅历史冻结：[可恢复归档](<../../archive/vscode-bridge-20261007/README.md>)。

## 本轮实现边界

新源码位于 [实验入口](<../../lib/index.js>)、[CLI 策略](<../../lib/util/cli-policy.js>)、[租约管理夹具](<../../archive/lease-manager.js>)。

- 实验入口只使用真实 commands 注册契约提供状态命令；不注册伪 SSH Provider。无新 manifest/bundle/profile 安装，无完整 UI，不声称现有 GUI 已更新。
- CLI 策略只生成 `connect <显式 tunnel-id>` argv，不调用 shell，不接收 token/anonymous/remap 参数；只有绝对可执行路径。未知状态/错误不原样下发浏览器。
- 租约管理器注入 start，进行稳定目标、并发、引用计数、失效与 dispose 安全验证；不是实际 CLI readiness/进程所有权证明，不执行 SSH 操作。自动重连预算为零，显式重试建立新 generation，不重放业务操作。
- 续任务新增[carrier/managed/解析/前提诊断/注册合同](<adapter-contract.md>)，实现default external、managed安全spawn、双流有界解析与取消超时；仅fake进程测试PASS，尚未真实CLI/底座集成。CLI listener所有权、严格host-key和PTY/镜像验收仍需实测。见[60项测试结果](<evidence/results.md>)。

## CLI 真实帮助

A：macOS 26.6.2 (25G83), arm64, Node v22.22.0。PATH 无 devtunnel，但已有 `~/bin/devtunnel`。版本 `1.0.2086+eb5ddeb517`，CLI 提示有更新；本轮没有安装/升级。

- [connect --help 原文](<evidence/connect-help.txt>)：只有 access-token、verbose、help，**没有 remap/local-port/remote-port 参数**。
- [host --help 原文](<evidence/host-help.txt>)：可选 `-p`，有 `--allow-anonymous` 但禁止使用。
- [port create --help](<evidence/port-create-help.txt>) 也不能据此推断有端口映射能力。
- 不能编造 `connect --port 2222:22`。**2026-10-07用户实际connect自动分配本地64894，重启后50736，对应remotePort22**；无remap参数不代表同号端口，不再将控制端绑定22视为必然阻断。插件必须解析真实输出，匹配remotePort而非猜本地端口。详见[人工证据](<evidence/user-macos-20261007.md>)。
- 首次版本探针 .NET bundle 缓存不可写，exit 159；当时申请同命令授权重试获准，exit 0。之后会话变为 full-access，但操作授权范围没有扩大。版本探针会输出服务版本检查结果，未执行账号登录/隧道连接/凭据读取。

## 新 Step0 人工验收表

2026-10-07续任务已有用户人工SSH、动态端口重连、256KiB SFTP与PTY resize证据；不是agent测。[详细证据和局限](<evidence/user-macos-20261007.md>)。完整门仍未放行，不以mock或旧HTTP结果填PASS。

| 项目 | 所需条件与证据 |
|---|---|
| 两台真实 Mac、独立 host | 明确 B 可操作连接与用户授权；记录双方 OS/CLI 版本和主机区分，独立 host 的私有 ACL，非 VS Code tunnel |
| 关闭 VS Code 仍可用 | 用户关闭两侧相关 VS Code 后 SSH/SFTP/PTY 重跑；不自动停正在用的旧 Bridge |
| 私有与未授权拒绝 | 官方 CLI 人工登录、ACL 检查；另一个未授权上下文尝试连接被拒（不是只测 SSH 密码错误） |
| loopback 与端口所有权 | A/B 相关监听审计，证实本地端点归属自有 CLI，只绑定 loopback；不能把其他用户程序误认成功 |
| SSH 指纹 | B 独立可信渠道给公钥指纹；A 严格验证；端口变更仍匹配逻辑机器，目标/指纹改变拒绝并重新人工确认 |
| SFTP | 用户指定临时实验目录；上传/下载中文及二进制并比对 hash，不碰业务文件 |
| PTY | 交互、resize、Ctrl-C、关闭清理；断线后明确失效，不重放输入 |
| 生命周期/隔离 | 两 workspace/机器并发、引用计数、未知进程不清理；断网/睡眠恢复有界；不得重放 exec/write |
| 后台会话 | 按 macOS 实测用户登录/退出、Keychain 与前台 CLI生命周期；不承诺无人登录开机恢复 |

用户报告已准备两端GitHub CLI登录、B独立host/sshd及指纹，但没有授权agent连接当前个人隧道；不从用户手测推定DSH ssh2/agent已有密钥权限。剩余关闭VSCode、未授权拒绝、完整大文件、PTY Ctrl-C和生命周期须补测。启用/调整SSH、系统服务或防火墙仍需额外确认，不做安装器。默认external手动端点，详见[接线合同](<adapter-contract.md>)和[双端前提runbook](<prerequisites-runbook.md>)。

## 不变事项

- [原参考计划](<../../../dsh-remote/docs/devtunnel-ssh-build-plan.md>) 仍在兄弟仓：移动此前被沙箱拒绝，本轮**未移动、未复制后删除、未重试**，待明确授权。
- 产品 profile 未改，未运行 sync/deploy，未自动停止旧 Bridge，未另起 GUI。
- [测试证据](<evidence/results.md>) 区分本机 PASS 与实机 NOT RUN。
