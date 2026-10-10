# managed connect 诊断日志（CONNECT_OUTPUT_REJECTED 等）

用户报告测试连接返回 `CONNECT_OUTPUT_REJECTED`。该错误来自本插件宿主半侧的 managed 适配器：
它只接受官方 CLI 的 `SSH: Forwarding from <loopback>:<port> to host port <remotePort>` 一种措辞，
任何"含 Forwarding from 但语法不匹配"的行、超长行/缓冲、越界端口或累积配额都会 **fail closed**。

以前这条路径完全静默（见原 `managed-connect.js` 的"nothing is logged"注释），所以现在补上诊断。

## 实测根因（2026-10-10 用户日志）

```
line1="Connection to client tunnel relay restored."
line2="Connected to tunnel: <redacted>"
line3="SSH: Forwarding from 127.0.0.1:62608 to host port 22."
```

官方 CLI 现在在转发行末尾多打了一个**句末句号** `.`，而原语法是行尾锚定的（`…([0-9]{1,5})\r?$`），
于是被判为 `UNSUPPORTED_FORWARDING`：不是端口、指纹或信任问题，是措辞变化。
现接受"可选单个句号 + 行尾空白"（`…([0-9]{1,5})\.?\s*$`），其余仍严格：主机必须是
`127.0.0.1` / `[::1]`，两端口 1–65535，目标端口必须等于配置的远端端口；多一个 token
（`22.5`、`22..`、`22. done`）或 `0.0.0.0` 依旧 fail closed。

## 日志出现在哪里

| 位置 | 内容 |
| --- | --- |
| 宿主控制台（`ctx.logger`，缺失时回落 `console.warn/info`） | 每次 managed 拒绝一行：`[dsh-devtunnel-ssh] code=… reason=… stream=… lines=… bytes=… sawForwarding=… line1="…"` |
| 浏览器控制台 | 打开「Dev Tunnel SSH」表单期间，前端每 3s 只读拉取 `GET /dsh-devtunnel-ssh/diagnostics`，把**尚未见过**的条目以同样前缀 `console.warn` 出来 |
| 宿主认证 API | `GET /dsh-devtunnel-ssh/diagnostics` → `{ ok:true, revision, entries:[…] }`（只读、同源、与 settings/preflight 同一 host 注册边界） |

宿主若从终端启动（`dsh web --profile …`）可直接看到第一行；Desktop(Electron) 启动时宿主 stdout
被 pipe 到 Electron 主进程，通常要改用浏览器控制台或 `GET /dsh-devtunnel-ssh/diagnostics`。

## 脱敏规则（`lib/util/connect-diagnostics.js`）

原始 CLI 输出**从不**落日志、响应或控制台：

- `https?://…` → `scheme://host/path?<redacted>`（query 一律丢弃）
- `token/access_token/authorization/secret/password/passphrase/api_key/cookie/signature/sig` 后跟 `:`/`=` 的值 → `<redacted>`；`Bearer <…>` → `Bearer <redacted>`
- 连续 ≥24 的 `[A-Za-z0-9+_-]` 串（base64url/JWT/hex 形状）→ `<redacted>`；**刻意不含 `/`**，以免吞掉宿主路径
- 控制字符转空格、连续空白折叠、单行截断到 240 字符
- 每流只保留最近 3 行样例，环形缓冲上限 20 条
- `reason/stream/mode` 只接受 `[A-Za-z0-9_.-]{1,48}` 的内部码，其他一律 `UNKNOWN`
- `machineId` 与 `tunnelId` 同规则：按语法校验后原样输出（同一页面已明文展示），形状不合法才丢弃
- `tunnelId`（`^[a-z0-9][a-z0-9-]{0,99}(?:\.[a-z0-9]{1,20})?$`）与 `executable`（POSIX 绝对路径，≤4096）**只校验不掩码**：
  它们是同一认证页面（机器列表 / 全局设置）已经明文展示的配置；掩码只会把 24 字符的 tunnel id 变成 `<redacted>.jpe1`，反而妨碍排查
- 任何 sink 抛错都不影响连接路径（诊断是 best-effort）

## reason 码含义

| reason | 含义 / 下一步 |
| --- | --- |
| `UNSUPPORTED_FORWARDING` | 出现了含 `Forwarding from` 但不匹配严格语法的行（例如 `0.0.0.0`、别的措辞或本地化文案）——**样例行就是根因** |
| `REMOTE_PORT_MISMATCH` | 匹配到转发行但目标端口 ≠ 机器配置的远端端口（样例里的 `to host port N` 直接说明 CLI 在转发哪个端口） |
| `PORT_OUT_OF_RANGE` / `LINE_TOO_LONG` / `PENDING_OVERFLOW` / `BYTE_QUOTA` / `BAD_INPUT` | 解析器 fail closed 的具体分支 |
| `STREAM_ERROR` | stdout/stderr 流错误 |
| `CONNECT_ATTEMPT_FAILED` / `CONNECT_RETRY_EXHAUSTED` | supervisor 层：第 N 次尝试失败 / 重试预算耗尽（`CONNECT_EXITED`、`CONNECT_STARTUP_TIMEOUT` 可重试） |
| `CHANNEL_LEASED` | SSH 层从 carrier 取到一条通道租约（带 `machineId`、`endpoint`、`generation`）：**失败若出现在这之后，问题在 SSH 认证/信任，而不是通道** |
| `CHANNEL_RELEASED` | 最后一个租约释放（通道随之收摊）；若测试失败却始终没有 `CHANNEL_RELEASED`，说明租约被池缓存或泄漏 |
| `CHANNEL_STOPPED` | 用户在通道管理 box 里显式断开（`stream=user`） |
| `CONNECT_READY` | 成功拿到回环端点（info 级，附 endpoint 与匹配行） |

主动停止（`CONNECT_CLOSED`）与用户取消（`CONNECT_ABORTED`）不产生失败日志，避免噪音。

## 边界

诊断只描述**本插件自己 spawn 的 connect 进程**输出；不读 token/cache/私钥/agent，不写 B 端，
不改变拒绝语义（仍是 fail closed，不重放 SSH 业务）。`/dsh-devtunnel-ssh/diagnostics` 只读、
同源、无 query/body、非 GET 返回 405，sink 不可用时 503。
