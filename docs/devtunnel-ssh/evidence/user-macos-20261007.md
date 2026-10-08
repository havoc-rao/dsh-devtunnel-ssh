# 用户人工双Mac证据（2026-10-07）

来源：本次委派由用户提供的摘要；**不是agent执行**。只保存公有/脱敏结果，不读取私钥、ssh-agent、Keychain 或 CLI token/cache。以下不授权agent连接用户当前个人隧道。

- B身份：`havocrao@HAVOCRAO-MC1`；两侧CLI由用户报告GitHub登录，独立官方Tunnel已建立（具体个人tunnel ID不复制到产品fixture）。remotePort=22。
- 用户报告Ed25519主机指纹：`SHA256:MULbTDMznUed/g2TRjkEEKOIQUSQ/hCRGQ/saqn/wCQ`；agent未独立取得B公钥，不声称已二次核验。
- A自动映射64894，Ctrl-C/connect重启后50736；IPv4/IPv6 localhost监听。**无remap参数不代表端口同号**，修改了此前文档中端口22阻断的推断。
- 同一HostKeyAlias严格指纹验证，密码SSH成功：hostname=HAVOCRAO-MC1，whoami=havocrao。重启新映射端口后SSH验证成功。
- 用户生成专用A Ed25519密钥，B追加公钥，`ssh-add --apple-use-keychain`；OpenSSH `BatchMode=yes` + `IdentitiesOnly=yes` 成功无密码。不代表DSH ssh2已取得agent/密钥权限。
- PTY `/dev/ttys006`；`stty size` 40x137 -> 51x180；sleep60返回。Ctrl-C是否中断未明确：**NOT CONFIRMED**。
- 256KiB SFTP：中文空格文件名，上传/下载SHA256一致 `1b7c2935a745fd01e47f83bb93b15d0f9908348f78a079ddf79ea68015cf292c`，cmp exit0；upload31.5KB/s约8s，download51KB/s约5s：用户实测PASS。
- 8MiB上传多次被用户中断，仅6789120字节；下载cmp exit1：**INCOMPLETE / 非完整性PASS**，不能据此归因传输损坏。
- 旧CLI会话 `Invalid channel ID 0` / `send window full`：原因未定；不自动解释为CLI缺陷或网络故障。

## 门状态

新SSH链路已获得用户人工功能性证据，但**完整Step0仍未放行**。关闭VSCode仍可用、未授权客户端拒绝、完整8MiB校验、无人值守及登录退出/睡眠生命周期：NOT RUN。PTY Ctrl-C NOT CONFIRMED；DSH ssh2集成 NOT RUN。agent本轮只执行帮助核查与本机fixture，不操作个人隧道。
