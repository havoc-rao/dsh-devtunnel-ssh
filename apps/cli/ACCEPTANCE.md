# dsh-remote-devtunnel-link（dsh-rdl）0.1.0 双机与发布验收

代码/本机构建完成不代表实际 Windows 或 GitHub 下载验收完成。以下操作仅供用户明确授权后执行，不由工具默认自动运行。

## 双机测试矩阵

至少执行 Windows host → macOS client 和 macOS host → Windows client。

1. 两端 `doctor`，记录 OS/架构、系统 OpenSSH 可用性；版本预检另用 `--check-cli` 授权。
2. 用户确认官方 Dev Tunnel 同一账户/既有访问授权，以及持久隧道已发布 SSH 端口、未匿名开放。
3. `tunnel save` 后查看 host/connect 计划，确认 ID 不变。另加 `--apply` 保持前台。
4. `host invite` 或 `host` 向导生成邀请；通过可信文件传输渠道送到 client。
5. `pair` 生成专用密钥；响应只含公钥，不包含私钥路径或凭据。
6. host 执行 `host accept` 查看计划。核对双方完整校验码，一致才 `--apply --confirm CODE`。
7. 公钥写入前后比较：旧公钥/注释保留；备份存在；Windows SID ACL 正确；macOS 700/600 正确。
8. client `verify`：SSH 和 SFTP 都 PASS；禁止密码/agent 回退；指纹来自邀请，不接受 TOFU。
9. 首次验证产生本机 established receipt；邀请过期后相同配对可以 verify/export，改变目标不能使用旧记录。
10. `dsh export` 手动填写 RemoteSettings，保存/测试/创建镜像；不要覆盖 DSH 内部文件。
11. Ctrl-C 只停止 CLI 自己的 Dev Tunnel 子进程。验证其他 CLI/DSH 进程未受影响。

## 负向测试

- 截断/空公钥、过期邀请、错校验码、错响应目标、重复授权：拒绝。
- 已存在输出文件、symlink/reparse 公钥路径、非本机账号：拒绝。
- SSH 指纹不匹配、公钥认证失败、SFTP 失败：不产生 established receipt。
- 隧道没登录/无权限/本机端口过期：明确失败，不尝试密码、不自动安装/登录。
- 自定义 SSH Include/Match/授权路径：不支持的配置应在写入前拒绝。

## 发布验收

1. 获授权后提交代码和锁文件；先手动触发 workflow_dispatch，publish=false。
2. 三个平台构建、源码测试、PowerShell AST 检查（Windows）与可执行文件 smoke 成功。
3. 从 artifact 下载正确架构包，在干净账户验证 SHA256 与启动；不要关闭系统安全策略。
4. 当前 macOS 仅 ad hoc 签名，Windows 无发行者签名：不得宣称已正式签名或公证。
5. 双机验收完成后，另行授权发布 dsh-remote-devtunnel-link-v0.1.0；检查实际 Release assets 与 checksum。
6. 正式下载链接必须由实际仓库和 Release 返回，代码阶段不编造链接。

## 生命周期限制

本版不提供撤销命令。撤销时需在被连接端备份授权文件，按本配对公钥 blob/指纹识别并仅删除对应条目（不要清空文件），再从控制端确认认证拒绝。删除本机私钥或验证记录不等于撤销远端授权。长期 unattended/开机自启和自动安装服务不在本版范围。

## 当前证据

- PASS：本机 22 项 CLI 测试，1 项 Windows 专属 AST 测试本机跳过；插件 232 项回归。
- PASS：macOS arm64 SEA 构建、可执行文件 version/help/error-path smoke。
- NOT RUN：实际 Windows AST、ACL 写入、真实 macOS 授权、双机 Tunnel/SSH/SFTP、DSH GUI 导入验证、Windows/x64 构建、GitHub 发布与下载。
