# 双Mac前提诊断与受控验证

本手册给用户人工执行，非agent安装/连接授权。不提供自动下载脚本，不自动登录/启用sshd/改系统服务、防火墙或profile。先确认两端官方CLI已安装；缺失时仅提示用户从[微软官方安装说明](https://learn.microsoft.com/azure/developer/dev-tunnels/get-started)选择平台安装方式，版本和完整性由用户核实。

## A 控制端

1. 确认运行DSH host的真实机器/用户，不将浏览器localhost当host；找到官方devtunnel绝对路径。
2. `devtunnel --version`；`devtunnel user show --help`先核实登录诊断命令。版本可能联网检查服务；不要保存原始账号输出到聊天/日志。
3. 用户自己在私密终端执行 `devtunnel user show` 检查GitHub登录；未登录时用户自行 `devtunnel user login --help` 并选GitHub流程。agent不自动登录、不读cache或token。
4. 前台 `devtunnel connect <explicit-id.cluster>`，不省略ID、不加token/verbose/anonymous，不假设端口同号。抄下 **remotePort22对应的localPort**；不粘贴整段可能含账号的日志。
5. `lsof -nP -iTCP:<localPort> -sTCP:LISTEN`确认CLI PID和loopback；外部CLI不是插件所有资源，插件external release绝不能kill它。

## B 远端

1. 记录macOS/架构与官方CLI版本，GitHub用户自己登录并检查有效性；两端安装不能由A安装成功推定B已安装。
2. 系统设置中用户自行确认Remote Login/允许账号，已有sshd监听和测试账号权限；如未启用，先明确授权后由用户修改。本插件只报告缺失。
3. 明确独立私有Tunnel及ACL；不可从省略`--allow-anonymous`推断既有Tunnel没匿名ACL。host前检查保存的access控制，使用受控专用Tunnel，绝不转Public。
4. 前台 `devtunnel host <explicit-id.cluster>`，使用已审阅port22配置。创建Tunnel/port是用户另行决定的持久远端动作，不在agent自动流程内。
5. 通过独立可信渠道取得B主机Ed25519指纹（用户可审阅 `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`），只交付公有SHA256；禁止发送私钥。

## external/manual 首选

connector例子（非真实个人隧道）：
```json
{"kind":"devtunnel","mode":"external","tunnelId":"example.jpe1","remotePort":22,"endpoint":{"host":"127.0.0.1","port":50736}}
```

底座先按逻辑机器+Tunnel/remotePort严格指纹信任，连接SSH认证由底座负责。端口重新分配后显式释放旧代/重新录入端点；targetIdentity不变，generation变。不要把OpenSSH的HostKeyAlias/ssh-add成功直接当作DSH ssh2已获凭据授权。

## managed（源码实验，未部署）

需用户另行许可插件启动host-local官方CLI。executable来自宿主受控绝对路径，不允许浏览器任意二进制；固定无shell argv `connect <id>`。仅关闭自身child；startup timeout、AbortSignal与TERM/KILL确认有界，解析器仅接受匹配remotePort的loopback转发消息，未知文案能力失败，不泄露raw输出。

默认零自动重试；下一次显式acquire可以建立新代。SSH断线不重放exec/write/PTY输入。CLI输出到ready仅说明映射信息，底座严格host-key验证才证明远端身份；实际listener所有权与真实CLI集成尚需验收。

## 补齐Step0

- 关闭两侧VSCode后重跑SSH/SFTP/PTY，证明独立host；不得自动停用户旧Bridge。
- 未授权账号/上下文连接明确拒绝，账号操作由用户完成。
- 完整8MiB上传下载，等待完成，核对大小/SHA256/cmp。被Ctrl-C中断的部分文件不是完整性PASS或损坏证据。
- PTY Ctrl-C中断前台sleep、resize、关闭清理；断线/睡眠恢复新代，不重放输入。
- 后台登录态/用户退出、Keychain、CLI前台退出逐项实测，不承诺无人登录开机恢复。
- 用户明确授权后才agent对真实隧道做集成测试；当前仅用户人工证据和本机fixture。
