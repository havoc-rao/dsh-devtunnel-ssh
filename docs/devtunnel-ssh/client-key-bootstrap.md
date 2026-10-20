# Client 密码引导专用密钥（首轮实现）

## 目标

Host 已具备私有 Dev Tunnel、SSH 与可用的系统账号密码时，不要求 Host 安装 RDL，不交换邀请/响应文件。统一 RemoteSettings 提供临时密码引导，Client 生成密钥并经现有 SSH 通道安装公钥。

## 使用流程（源码完成，尚未部署）

1. Host 手动创建持久私有隧道、发布 SSH 端口、启动 host；启用 SSH，并确认目标账号可密码登录。
2. 在 Host 本机查看 SSH 主机 SHA256 指纹，经可信渠道交给 Client。Dev Tunnel 登录身份不能替代 SSH 主机身份校验。
3. Client 在统一远程设置准备并启动通道，新建 Dev Tunnel SSH 机器，选择通道、填写用户名与已独立确认的指纹。
4. 在“临时登录密码”输入 Host 系统账号密码，点击“用密码设置专用密钥”。不是 GitHub/Microsoft 的 Dev Tunnel 账号密码。
5. 确认目标与变更摘要。系统在运行 DSH 后端的 Client 用户私有目录生成无口令 Ed25519 私钥；Host 仅接收公钥。
6. 独立的纯私钥 native SSH 连接和 SFTP 检查通过后，表单自动回填私钥路径并关闭 agent；点击“保存”完成机器添加。保存不会将机器设为当前工作区。

## 首轮边界

- 仅新建机器、macOS Host 的标准 SSH 配置布局；Windows/Linux/未知 OS 拒绝授权，不做半套支持。
- 仅密码认证引导，暂不支持多轮 OTP/keyboard-interactive。
- Client 当前需要 POSIX 文件权限与 `/usr/bin/ssh-keygen`；Windows Client 尚未适配。
- 专用私钥没有 passphrase，存于 DSH 后端 known-hosts 目录旁的 bootstrap-keys 私有目录。不得发送给 Host 或分享给其他人。
- 密码只在组件与本次服务器请求内存中使用，不 patch/publish、不保存到机器注册表、不写诊断日志。
- 需要真实 Connection 鉴权能力和 experimentalSshCarrier；拒绝只有 loopback/Origin 检查的旧组合。服务端引导操作互斥，不自动重试。
- 通道必须事先就绪；不自动创建/启动隧道，不安装 CLI、不启用 SSH、不改服务、密码登录策略、防火墙或产品 profile。
- 公钥安装使用已连接 SSH 单次命令，禁止业务自动重连重放；保留原有授权行与备份，检查系统 Include/Apple crypto 配置、授权路径 symlink 和文件权限。
- 此检查不是通用 sshd 有效配置解析器；自定义启动参数/授权路径不承诺支持。只有后续 key-only SSH/SFTP 实际成功才报告验证通过。
- 远端授权脚本有检查与写入间的竞态窗口，不能宣称对同一账号恶意并发修改绝对安全。

## 失败恢复

安装尝试后断线、超时或验证失败，会保留本机专用密钥并标识“远端可能已授权”。错误信息提供保留路径，不显示密码、私钥或远端原始 stderr。先确认远端状态，不要反复点击生成多把密钥。不会自动撤销公钥、删除恢复所需私钥或关闭原有密码登录。

表单目标在操作过程中被编辑/切换时，不自动回填旧结果；用户需按提示核查保留密钥。验证通过后仍由用户明确保存；不提供跨表单的一次性验证凭据，不承诺后续任意手动修改后的目标已验证。

## 验证证据

- PASS：本轮本仓完整自动测试 281/281；其中引导 helper mock 与本地真实 ssh-keygen 测试 16/16，浏览器字段/密码隔离与互斥等客户端回归通过。
- PASS：dsh-remote `node check.mjs` 框架约束闸门、两仓 diff whitespace 检查。
- PASS：dsh-remote 相关 carrier 回归 30 PASS、5 SKIP、0 FAIL。
- BLOCKED（环境）：已尝试 `scripts/boot-smoke.sh`，脚本硬编码的 Desktop harness 路径不存在，启动前退出；未改路径、未启动替代 GUI，不能声称启动冒烟通过。
- NOT RUN：真实双机密码引导、公钥写入、新 key-only SSH/SFTP、实际 GUI 操作、Windows 兼容。
- 本轮不部署、不提交、不发布；用户之前其他会话的实机成功不算此功能的实测证据。

## 后续

接入完成后的远端 DSH/RDL 安装与服务启动应复用独立受控部署能力，不能混入测试连接。下一步优先真实 macOS Host 闭环验收，再补恢复/撤销与 Windows 平台，最后考虑自动隧道创建。
