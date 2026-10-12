# 常驻隧道（Resident Tunnel）与 remote 侧兼容契约

日期：2026-10-11。本文档描述 dsh-devtunnel-ssh 新增「全局单通道常驻」功能后，兄弟仓 dsh-remote 需要配合兼容的面：**必需 1 处（硬性）、UI 1 处、建议若干、零改动面若干**。

## 一、结论摘要

| 面 | 是否需要 remote 配合 | 说明 |
|---|---|---|
| `/settings` POST body | **必需（硬性）** | body 白名单由 5 键扩为 **8 键**；现有 5 键 body 会被 `SETTINGS_REJECTED`（400）拒绝 |
| 全局设置 UI（tunnelCard） | **必需（功能可达）** | 常驻三字段的输入与展示在兄弟仓既有 DevTunnel 全局设置卡片 |
| ssh-carrier 注册 / lease 契约 | **零改动** | lease 形状与普通 managed 完全同构，父侧无需感知"常驻"概念 |
| 机器表单槽位（slot 契约） | **零改动** | connector 结构、canonical 比较、occupant 发布流程不变 |
| 组合测试 / 联调 | 建议 | 详见第四节 |

## 二、服务端契约面（本仓已实现，remote 侧只读消费）

### 1. `GET /dsh-devtunnel-ssh/settings`
快照 `settings` 对象新增三个字段（永远存在）：

```jsonc
{
  "cliExecutable": "/opt/devtunnel",
  "managedEnabled": true,
  "residentTunnelId": "my-tunnel.jpe1",   // "" = 未配置
  "residentRemotePort": 22,               // 0 = 未配置
  "residentMode": "off"                    // "off" | "immediate" | "lazy"
}
```

constraints：
- `residentTunnelId === '' ⟺ residentRemotePort === 0`
- `residentMode !== 'off'` ⇒ `residentTunnelId` 非空且合法（`^[a-z0-9][a-z0-9-]{0,99}(?:\.[a-z0-9]{1,20})?$`）
- legacy 磁盘记录（旧 2 键）读取时自动补 `'' / 0 / off`，无需迁移

### 2. `POST /dsh-devtunnel-ssh/settings`（**remote 侧必改**）

body 白名单 = **恰好 8 键**（多一少一都 400）：

```jsonc
{
  "cliExecutable": "/opt/devtunnel",
  "managedEnabled": true,
  "residentTunnelId": "my-tunnel.jpe1",
  "residentRemotePort": 22,
  "residentMode": "lazy",                  // off | immediate | lazy
  "confirmed": true,
  "disconnectActive": false,
  "revision": 1
}
```

- **现状风险**：兄弟仓 `useTunnelSettings` 的 POST 目前只发前 2 个设置键 + 3 个控制键（5 键）。新增契约后该请求将稳定 400——**必须补发 3 键后再升级联调**。
- 从 `off` 切到 `immediate`（或改 tunnelId/port）且常驻已激活时，`disconnectActive` 必须为 `true`（`SETTINGS_ACTIVE_CONFIRM_REQUIRED`，409）。

### 3. `GET /dsh-devtunnel-ssh/channels`

快照新增只读 `resident` 块（形状已由路由白名单校验）：

```jsonc
{
  "enabled": true,
  "mode": "lazy",                          // immediate | lazy
  "tunnelId": "my-tunnel.jpe1",
  "remotePort": 22,
  "state": "ready",                        // starting | ready
  "endpoint": { "host": "127.0.0.1", "port": 53162 },  // null 或 absent
  "since": 1760000000000,
  "generation": 1,
  "users": 0,                              // 当前租用会话数
  "blocked": null,                         // 毒化代码（非可重试失败后）
  "exhausted": false,
  "lastCode": null
}
// enabled:false 时：{"enabled":false,"mode":"off"} 或带 blocked/exhausted 的失败视图
```

### 4. lease 契约（**零改动**）

常驻模式返回的 lease 与普通 managed **完全同形**：

```jsonc
{ "dialHost": "127.0.0.1", "dialPort": 53162,   // getter，失效后 throw STALE_LEASE
  "targetIdentity": "[\"devtunnel\",\"mac-b\",\"my-tunnel.jpe1\",22]",
  "generation": 1,                                // 常驻代：所有租用会话共享
  "closed": Promise,                              // 常驻进程退出/端口旋转/显式停止时触发
  "release": () => Promise }
```

语义差异仅在内侧，父侧无需感知：
- `release` 只解除本会话（此后 getter `STALE_LEASE`），**不会停止常驻进程**
- `closed` 触发条件：常驻进程退出、端口旋转（managed-connect 活性检测）、显式停止（设置改 off / 配置变更 / 卸载）
- `generation` 变化 = 隧道重建，所有机器的会话**同时**失效（同一通道的必然结果）；`targetIdentity` 仍含 machineId，目标定界不受影响

## 三、remote 侧待办（按优先级）

### P0 — 必需：修补 `useTunnelSettings` 的 POST body

`/Users/havoc/Documents/Projects/tools/dsh-plugins/dsh-remote/lib/client.js` 的 `useTunnelSettings` 保存函数：

- draft 增加 `residentTunnelId` / `residentRemotePort` / `residentMode` 三值（GET 应用时从快照读入，缺省 `'' / 0 / 'off'`）
- POST body 增发三键（顺序无关，键数必须恰好 8）
- 切换 immediate/lazy 或改 id/port 且常驻激活时，沿用现有 disconnectActive 确认流（409 文案复用 `settings.tunnelActive` 一类提示）

### P1 — 必需（功能可达）：全局设置卡片加常驻区

`tunnelCard`（同文件，`data-testid="devtunnel-global-settings"`）增加一行常驻配置（建议放在托管授权复选框之后）：

- tunnel id 文本框（白名单正则同 connector）
- remotePort 数字输入（1-65535）
- mode 三选（off / immediate / lazy）——immediate 需在保存确认文案里明示"保存后立即启动并保持 connect 进程"
- 读到时展示当前常驻状态与用户数；blocked 时展示原因并提示"修改任何设置并保存以重建监督器"

### P2 — 建议：i18n 与提示

zh（`settings.tunnel*` 区段，L60 附近）/ en（L373 附近）补充：
`tunnelResident`、`tunnelResidentId`、`tunnelResidentPort`、`tunnelResidentMode`、`tunnelResidentImmediate`、`tunnelResidentLazy`、`tunnelResidentBlocked`。

### P3 — 建议：组合测试

- 若有断言 `/settings` POST body 键数的父侧测试 → 补 3 键
- 建议新增：保存 immediate → 面板 `resident` 块出现 ready + users 计数；两不同 machine 的 SSH 会话共享同一 generation（复现"会话 release 后进程仍在"）

## 四、无需配合的面（明确排除）

- `ssh-carrier.js` 注册/池化：acquire/lease 契约未改
- 机器表单槽位（transport option/fields/panel）：connector 结构与 occupant 发布流程未动
- whole-pool lease 策略：常驻通道下多个 pool 各自 acquire = 多个会话租用同一通道，release 互不影响
- 外部会话（external 模式）与非常驻 managed 机器：完全不受影响

## 五、联调步骤（生效链路）

1. 本仓已发布能力：服务端契约 + 面板只读展示（`node --test` 190/190）
2. 兄弟仓完成 P0+P1 后：**重启宿主进程 + 刷新页面**（client module 表对"无 `dsh.client`"的否定结论在进程内缓存，仅刷新页面不会重新装载）
3. 验证清单：
   - 全局设置保存带常驻三键 → 200，revision +1
   - immediate：保存后 `GET /channels` 的 `resident.state = ready`，无任何 SSH 会话也成立
   - lazy：保存后 resident 为 `enabled:false/mode:lazy`；首次连接该 tunnel 的机器后 ready；断开会话后仍 ready
   - 机器卡片 stop 不影响常驻通道；全局设置改回 off（带确认）后 `resident.enabled:false`，进程关闭
   - 进程被杀/端口变化：面板 `lastCode: CONNECT_EXITED`，会话 closed；lazy 下下次连接自动重建新代
4. 失败路径：连续失败 → `resident.blocked` 展示原因且不再自动重试；保存任意设置重建监督器后恢复

## 六、边界与注意

- 常驻通道是**全局单通道**：同一 tunnelId/remotePort 的所有机器共享；不同隧道不互相影响
- 常驻启动 = 显式授权（immediate 保存 / lazy 首次会话），插件从不空跑 connect
- `SECRETS`：所有状态经 `connect-diagnostics` 脱敏后出模块，remote 侧只消费白名单字段