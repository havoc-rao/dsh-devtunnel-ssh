# dsh-link 0.1.0（实验版）

独立 CLI 位于本插件仓库，但不修改现有插件运行时或 DSH 注册表。当前落地的是**安全配对文件 + 公钥授权计划/应用 + 无密码验证 + 手动 DSH 配置交接**，不是完整的一键安装服务。

## 当前能力与边界

- PASS（自动测试）：严格公钥解析、邀请过期/目标绑定、双方校验码、拒绝覆盖输出和符号链接、平台授权脚本生成。
- CLI 默认只读或输出计划；Windows/macOS 授权写入必须显式 `--apply --confirm <双方核对的校验码>`。
- 新建每次配对专用 Ed25519 密钥，不读取现有私钥或 agent。私钥未加口令，目录需保持仅本用户可访问；Windows/macOS 整机账户安全仍是前提。
- 双方需用可信渠道传送邀请/响应，并核对完整校验码。邀请不是证书，文件内容自身不证明远端身份。第一版没有自建公网服务或短码自动配对。
- 邀请有效期一小时；接受尝试前持久化消费状态，失败后需要重新发邀请，不重放写操作。首次验证须在一小时内完成；SSH 和 SFTP 验证成功后，本机保存绑定邀请/响应摘要的验证记录，后续 verify/export 可以在邀请过期后使用。过期邀请没有对应验证记录时仍被拒绝。授权本身不会随邀请过期自动撤销；撤销命令尚未实现。
- macOS 支持标准 `/etc/ssh/sshd_config.d/*` Include：检查真实目录与配置文件均为 root 所有、不可被 group/world 写入、无符号链接，最多 64 个文件。嵌套 Include、自定义授权路径、Match 等复杂配置仍拒绝应用，不自动删除配置来绕过检查。真实 macOS 授权写入仍未验收。
- 仅授权当前 OS 用户。Windows 需要管理员终端来修改管理员授权文件；不自动提权、安装 OpenSSH、启动服务、登录、改防火墙或匿名 ACL。
- 保留其他授权公钥；平台脚本拒绝非标准 SSH 授权路径，不盲目“修复”自定义配置。
- 隧道支持保存稳定目标和显式前台 host/connect；默认仅输出计划，启动需 --apply。既有隧道及 SSH 端口/私有 ACL 仍需用户在官方 CLI 配置。无自动 DSH 导入、撤销、守护进程、自更新。
- NOT RUN：真实 Windows 授权应用、真实双机隧道/SSH/SFTP、GitHub Release、正式签名/公证。

## 开发运行

需要 Node.js 22+ 和系统 OpenSSH（ssh、sftp、ssh-keygen）。

```sh
node apps/cli/src/main.mjs --help
node apps/cli/src/main.mjs host       # 交互创建邀请/查看接受计划
node apps/cli/src/main.mjs pair       # 交互生成专用密钥与响应
node apps/cli/src/main.mjs doctor
node --test apps/cli/test/*.test.mjs
```

以下用 `dsh-link` 表示已下载的可执行文件；源码运行时替换为上面的 Node 命令。

## Windows 作为被连接端，Mac 作为控制端

### 1. 被连接端准备（用户手动操作）

OpenSSH Server 必须已运行、账号可登录。用官方 Dev Tunnel CLI 创建**持久、私有**隧道并发布 SSH 端口，后续 `host` 始终传入该 ID；匿名开放不是配对方案。命令语法随 CLI 版本变化，请检查 `devtunnel create --help` / `devtunnel port create --help` / `devtunnel host --help`。

两端 Dev Tunnel 需具有访问权限（同一账号或已明确授予权限）；公钥配对不会绕过隧道 ACL。

准备好既有持久隧道后，可保存目标并通过 CLI 显式启动（默认仅查看计划）：

```sh
dsh-link tunnel save --tunnel YOUR-ID.usw3 --port 22 --out tunnel-target.json
dsh-link tunnel host --target tunnel-target.json
dsh-link tunnel host --target tunnel-target.json --apply
```

发送目标文件给控制端后，控制端可用 `dsh-link tunnel connect --target tunnel-target.json --apply` 代替手动 connect。进程保持前台、透传官方 CLI 输出；Ctrl-C 停止自身子进程，不控制其他用户进程。它不创建端口、不核实 ACL，也不会自动恢复或登录。

Windows 管理员 PowerShell：

```powershell
dsh-link doctor
dsh-link host invite --name Windows-HAVOC --username havoc --tunnel YOUR-ID.usw3 --port 22 --host-key C:\ProgramData\ssh\ssh_host_ed25519_key.pub --out host-invite.dshlink
```

CLI 不联网核实隧道，因此 Tunnel ID/端口必须与实际 host 一致。用可信传输方式把邀请发给 Mac；不要发送主机私钥。

### 2. 控制端生成响应

```sh
dsh-link pair --invite host-invite.dshlink --out client-response.dshlink
```

输出专用配对校验码。私钥由系统 ssh-keygen 写入本机 `~/.dsh-link/keys/<clientId>/id_ed25519`；只发送响应文件，不发送该目录或私钥。

### 3. 被连接端先看计划，再核对并应用

```powershell
dsh-link host accept --invite host-invite.dshlink --response client-response.dshlink
```

它显示校验码和实际脚本。**通过电话或其他可信渠道，与 Mac 上的校验码逐字符核对**。一致后才能执行：

```powershell
dsh-link host accept --invite host-invite.dshlink --response client-response.dshlink --confirm XXXX-XXXX-XXXX-XXXX-XXXX-XXXX --apply
```

失败时不重复用该邀请：保留报错，新建邀请并检查原因。CLI 不自动重启 sshd，公钥文件通常按连接重新读取。

### 4. 控制端建立转发并验证

Mac 一个终端保持：

```sh
devtunnel connect YOUR-ID.usw3
```

查看 **远端 SSH 端口 22 对应的当前本机端口**。另一个终端，例如本机端口为 58339：

```sh
dsh-link verify --invite host-invite.dshlink --response client-response.dshlink --confirm XXXX-XXXX-XXXX-XXXX-XXXX-XXXX --local-port 58339
```

调用系统 SSH/SFTP：专用密钥、固定主机公钥、关闭 agent 和密码回退、关闭用户 SSH 配置，先验证 echo 再 SFTP pwd。不会传输/写远端文件。私钥内容不进入 CLI 或日志。

### 5. 导出 DSH 手动接入说明

```sh
dsh-link dsh export --invite host-invite.dshlink --response client-response.dshlink --confirm XXXX-XXXX-XXXX-XXXX-XXXX-XXXX --out windows-handoff.json
```

这是**交接文档**，不是内部注册表；禁止拿它覆盖 DSH 配置。RemoteSettings 中：

1. 根据权限开启托管（或者使用 CLI 外部连接模式）。
2. 创建通道，填写稳定 Tunnel ID、SSH 端口；保存并显式启动。
3. 添加 Dev Tunnel SSH 机器、选择通道、填写文档中的用户/指纹/本机专用私钥绝对路径；SSH agent 关闭。
4. 保存并执行 DSH 自身的连接测试，再选择远端目录。

同一连接的生命周期只能由 CLI 或 DSH 中一方管理，不同时启动两份托管连接。

macOS 被连接端使用系统主机**公钥**路径（例如 `/private/etc/ssh/ssh_host_ed25519_key.pub`（使用真实路径，拒绝符号链接祖先）），授权只写当前用户 `.ssh/authorized_keys`；macOS 远程登录须用户在系统设置自行启用。

## 发布

参见 RELEASE.md。GitHub CI 提供原生 Windows x64/macOS arm64/macOS x64 的 SEA 构建路径，但当前仓库尚未发布可供用户下载的正式 Release。不能宣称安装链接已经可用。
