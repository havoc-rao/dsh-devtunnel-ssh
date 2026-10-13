# dsh-devtunnel-ssh — 独立实验插件包

本插件独立管理 `devtunnel connect` 通道；`dsh-remote` 管理 SSH 认证、连接池、终端、文件和 Git。通道与 SSH 机器分别保存，使用公开 `dsh-remote/lib/ssh-carrier.js` 注册路径交接端点和失效通知，不复制 SSH 引擎。

## 使用

在 dsh-remote 的统一 RemoteSettings 中打开 **Dev Tunnel** 整卡：

1. 按需保存宿主 CLI 路径覆盖及托管授权。默认 external/manual；未授权或未检测到 CLI 时不能启动托管通道。预检须另行确认。
2. 添加通道，填写名称、Tunnel ID、远端端口及模式。保存不启动。
3. 在列表显式启动通道，等待显示实际 loopback 端口；也可以停止、重启、编辑或删除。
4. 添加 Dev Tunnel SSH 机器，选择已保存通道，填写 SSH 用户、认证方式及独立确认的 SHA256 主机指纹，然后保存、测试和创建镜像。

已保存的 managed 机器也可在编辑区点击“启动通道”，直接使用已有 Tunnel ID/远端端口：缺少条目时先创建，已有条目则复用。不会自动修改机器配置或连接 SSH。

通道可在没有 SSH 机器时独立运行，也可由多台机器共享。SSH 释放引用不停止 connect；停止、重启、编辑或删除通道会使借用它的旧 SSH 连接失效。停止后，后台 Git 查询及 SSH 重连不能自动启动通道。显式启动期间有界重试；已启动通道运行中意外退出会在 recovering 状态下按 2s/8s/30s 退避有界自动重启（最多 3 次，稳定 5 分钟重置预算，耗尽后进入 error 等待用户操作）；宿主整机睡眠/合屏/断电恢复后，插件以 30s 心跳检测到 ≥5 分钟挂起间隙，会对恢复时仍处于 ready 的 managed 通道各重启一次，解决 devtunnel 挂死隧道。用户 stop/delete/清理失败立即取消待执行重启，不重放 SSH 业务。

列表包含所有已保存通道，包括 stopped/recovering/error。external 条目只登记用户管理的回环端点，不控制外部进程。宿主重载后 managed 条目保持 stopped。旧常驻配置首次只投影成停止的待保存条目，不自动连接或写入；旧 managed 机器可按相同 Tunnel ID/远端端口匹配列表通道，显式选择后保存 channelId。原目标身份算法不变，旧镜像身份不因动态端口改变。

## Git 与机器身份边界

carrier 机器可以没有顶层 `host`/`port`；它不是以当前 `127.0.0.1` 转发端口保存的普通 SSH 机器。canonical connector identity 只标识 Dev Tunnel 目标，lease 的 `dialHost`/`dialPort` 与 `generation` 属于运行代；端点变化不能改变目标/镜像身份，旧代失效后不得继续拨号。

carrier 镜像的 Git snapshot 仍由 `dsh-remote` 的 `/git-workspace` 提供，Git marker 消费方须接受 transport-neutral 机器摘要（包括无直接 host 的 carrier）。本插件不伪造 host/port、不提供第二套 Git 服务；repo 与 nonRepo 的 wire 兼容修复需生产方与消费者共同验收。源码契约及检查项见 [adapter 契约](<docs/devtunnel-ssh/adapter-contract.md>)。

## 边界与存储

两端需用户自行安装并登录官方 devtunnel，远端需已授权的 sshd；本插件不安装、登录、启用服务、读取凭据或修改防火墙。CLI 默认从宿主 PATH 检测，可选 POSIX 绝对路径覆盖。CLI/授权设置保存在 `$DSH_HOME/devtunnel-ssh/devtunnel-settings.json`，通道目录独立保存在 `devtunnel-channels.json`；文件权限 0600、原子替换、revision 乐观锁，不修改产品 profile。动态端口、进程、generation、SSH 认证信息不写入托管通道配置。

UI 经 `ctx.slots.inject` 注入 RemoteSettings，不注册独立 settings page。owner 负责机器写入、全局设置及 preflight 状态机；本插件负责通道列表及自有 `/dsh-devtunnel-ssh/channels` 路由。两侧契约见 [槽位契约 v5](docs/devtunnel-ssh/remote-settings-slot-contract.md)。`exports["./client"]` 与 manifest `dsh.client` 同时声明浏览器半侧。

Dev Tunnel 工作区（会话头）：经现有 `conversation.session.header.utilities` 注入状态 chip，dsh 壳零改动。优先消费 dsh-remote `/status?sessionId=…&cwd=…` 的 `connection` v1：底层 protocol=ssh、路径 path=carrier、carrierKind=devtunnel 与直连 SSH 明确区分。再读取自有 `/channels`，显示隧道就绪/恢复中/停止/失败，与 SSH connected/disconnected/unknown 分开；external 仅标记外部管理（未验证）。旧版无 connection 时兼容 resolve-mirror + machines 的稳定绑定，绝不依赖 Git 标记或全局当前机器。每 10s 不重叠轮询，卸载即停；换工作区立即隐藏旧 chip。查询不拨号、不重启、不写设置。

当前仍为实验包，`productionReady=false`。源码测试不代表个人 Tunnel、实际 GUI 或产品部署验收。包设为 private，未提供自动安装脚本。开发组合测试的兄弟仓 source imports 不是公开 API；低层 adapter 单测不代表生产运行会由 SSH 启动 connect。

运行 `node --test test/*.test.mjs`；打包使用 `npm pack --ignore-scripts`。完整说明见 [MANUAL.md](MANUAL.md)。
