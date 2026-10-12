# 槽位化改造证据（remote-settings-slot-contract v1）

用户要求：dsh-remote 里「类型」与 Dev Tunnel 通道模式/字段由本插件注入，dsh-remote 只提供 slot，各司其职。
契约：[remote-settings-slot-contract.md](<remote-settings-slot-contract.md>)。

## 两侧改动

| 侧 | 文件 | 改动 |
| --- | --- | --- |
| dsh-devtunnel-ssh（本仓） | [lib/client/client.js](../../lib/client/client.js) | 由 legacy noop/纯 helpers 改为真实浏览器半侧：经 `ctx.slots.inject` 向 `settings.remote.machine.transport.option`(list, id `devtunnel-ssh`, order 10) 与 `settings.remote.machine.transport.fields`(keyed, key `devtunnel-ssh`) 注册类型按钮+不可用提示、通道模式、全部 devtunnel 字段、镜像控件；向 owner `carrier.publish` 发布 `{valid, body}` draft；无任何宿主路由调用 |
| dsh-devtunnel-ssh（本仓） | [package.json](../../package.json) | 补 `dsh.client = { platform: 'web', inject: [renderer, locale] }`（原先缺失 → 浏览器半侧不会被装载） |
| dsh-remote（兄弟仓，`session-a3e6194f`） | `lib/client.js` | `settings.section` 条目声明两个 children 并透传 `renderSlot`；SSH 按钮/字段改为自注册条目；删除硬编码 Dev Tunnel 按钮/字段与 `devTunnelFormBody/Valid`，改为 canonical JSON 比较 + `machineCarrierBody` + occupant 发布 draft 的通用提交门控 |

## 验证（本会话实际执行）

| 命令 | 结果 |
| --- | --- |
| `node --check lib/*.js`（逐文件） | PASS |
| `node --test test/*.test.mjs`（本仓全量，含组合测试、诊断、通道面板与租约事件） | **PASS 196/196, 0 FAIL, exit 0** |
| `node --test test/remote-slot-composition.test.mjs`（真实加载两仓 client bundle + 手写 slots double，三槽位） | **PASS 8/8** |
| 兄弟仓全量 `npm test`（PATH 注入 harness 自带 Python） | **PASS 807/809, 0 FAIL, 2 SKIP, exit 0**（2 SKIP 为既有「OS 凭据后端不可用」） |
| 兄弟仓 `node --test test/client-carrier-integration.test.js test/client-devtunnel-settings.test.js test/client-lifecycle.test.js` | **PASS 42/42, exit 0**（panel 槽位后） |
| 兄弟仓 `node --check lib/client.js` + `node check.mjs` | PASS（route-prefix 33 / defineTool 21 等闸门无违规） |
| `npm pack --ignore-scripts`（私有 cache 目录绕开本机 root-owned 全局 cache） | PASS — 24 files，仅 lib/manifest/patch/README/MANUAL，无 secret/test/docs/node_modules |

### 追加：通道管理 box（第三个槽位，2026-10-10）

用户反馈「只有日志、UI 不可视 & 混乱」，要求把 devtunnel 通道/线程管理做成 box 注入 RemoteSettings。
契约 v2 增加 `settings.remote.machine.transport.panel`（list, root，owner props `{status,machines,currentId,scopeDir,busy}`），
owner 侧挂载在机器列表卡片与添加/编辑卡片之间（兄弟会话 `session-a3e6194f` 实现，全量 809 PASS / 0 FAIL / 2 SKIP）。
本仓实现：`carrier.snapshot()/stopManaged()`（活动通道与显式断开）、supervisor `list()`（重试/阻塞状态）、
runtime `channelSnapshot()/stopManagedChannel()`、新路由 `lib/routes/channels-route.js`（GET 快照+最近事件，POST `{action:'stop',machineId,confirmed:true}`，
非 GET/POST 405、校验失败 400、不可用 503，绝不回传 adapter 文本）、浏览器半侧 `DevTunnelPanel`（活动通道/重试阻塞/最近事件三段，
显式确认后断开、失败不重试、路由未就绪时显示「宿主通道管理不可用」而不是假装为空）。
新增测试：`channels-route`(3)、carrier(+3，含 `CHANNEL_LEASED/RELEASED/STOPPED` 与抛错 sink)、supervisor(+1)、runtime(+2)、client(+4)、组合(+2)。

2026-10-10 追加：为了让「通道已就绪但测试仍失败」可归因，carrier 在每次租约交接处记录 `CHANNEL_LEASED`（带 machineId/endpoint）、最后一个租约释放记 `CHANNEL_RELEASED`、显式断开记 `CHANNEL_STOPPED`；诊断条目新增经校验的 `machineId`，box 的最近事件行据此显示是哪台机器的 SSH 层用上了通道。

### 追加：Dev Tunnel 整卡（契约 v3，2026-10-11）

用户反馈：页面顶部「Dev Tunnel 全局设置」卡与「Dev Tunnel 通道管理」box 分开且 resident 常驻状态
重复展示，要求**封装为一个 box 并只删重复**。采纳 occupant 全渲染方向：
[dsh-remote `lib/client.js`](../../../dsh-remote/lib/client.js) 删除 `tunnelCard` 与
`residentStatusLine`（顶部卡与重复的状态行），`useTunnelSettings` 状态机保留并经 panel 槽位
owner props 的 `tunnel` 传给占用方（`renderSlot(SLOT_TRANSPORT_PANEL, { ..., tunnel })`）；
本仓 `DevTunnelPanel` 扩展为整卡：全局设置表单（CLI 路径/托管授权/常驻配置/保存/刷新/预检，
`tunnel` 未就绪时整节禁用而非隐藏）+ 常驻状态行（整卡唯一一处）+ 活动通道/重试阻塞/最近事件/断开。
面板标题改为中性「Dev Tunnel」；渲染层 i18n（`tunnel*` keys）迁入本插件 zh/en 字典，
hook 内 confirm/错误/消息 keys 留在 dsh-remote。契约 v3：
[remote-settings-slot-contract.md](<remote-settings-slot-contract.md>)。

### 追加：managed 诊断日志（`CONNECT_OUTPUT_REJECTED` 可见化）

见[managed-connect-diagnostics.md](<managed-connect-diagnostics.md>)。新增 `lib/util/connect-diagnostics.js`（掩码 + 环形缓冲）、
`output-parser` 的 reason 码与 `observe` 观察面、`managed-connect`/`managed-supervisor` 的诊断上报、
`settings-route` 的只读 `GET /dsh-devtunnel-ssh/diagnostics`、`index.js` 的宿主日志 sink，以及
浏览器半侧在表单打开期间的诊断镜像（`console.warn('[dsh-devtunnel-ssh] …')`，3s 只读拉取、按 seq 去重）。
新增/扩展测试：`connect-diagnostics.test.mjs`、`host-diagnostics-sink.test.mjs`（各 5/2 例）、
`output-parser`(+2)、`managed-connect`(+3)、`settings-route`(+2)、`client`(+2)、`settings-entry`(+1)。

组合测试覆盖：dsh-remote 声明三槽位且被本插件填充（option list / fields keyed / panel list 的成员与 order）；通道管理 box 出现在机器列表卡片之后、添加/编辑卡片之前，occupant 缺席时不留占位；类型行两个按钮都由槽位渲染；选中注入类型后注入的通道模式/字段出现且 fresh draft 在宿主已授权时默认 managed；填好必填项后 owner 的保存按钮启用并提交 occupant 发布的 body；能力缺失时类型按钮禁用、SSH 不受影响；occupant 先加载/后加载两种顺序都能组合。

兄弟仓（dsh-remote）侧由委派会话 `session-a3e6194f-ad35-4534-8e44-4d951dbe1ade` 实现并报告：`npm test` **809 tests → 807 PASS / 0 FAIL / 2 SKIP（exit 0）**；新增回归断言「carrier 形态由 `form.transport` 判定，绝不比较 `body.transport`」并做了反向对照（临时还原旧比较 → 12 例中 9 例失败）。父会话独立复跑其全量（PATH 用 harness 自带 Python，否则 `docs-images` 会因缺 PIL 报环境失败）：**809 tests → 807 PASS / 0 FAIL / 2 SKIP, exit 0**，其 client 子集单独复验 40/40。

## 部署现状（用户要求下已执行 build，未重启 GUI）

- `~/.dsh/profiles/desktop/node_modules/dsh-devtunnel-ssh` → **symlink 到本仓**：`package.json` 的 `dsh.client` 与 `lib/client/client.js` 已在磁盘生效路径内。
- `~/.dsh/profiles/{desktop,web}/node_modules/dsh-remote` → symlink 到 `dsh-remote/dev-harness/deploy-pkg`（**物化部署副本**）。当前运行的 GUI 是 Electron Desktop（`:53872` 监听者），即走 desktop profile。
- 已执行：`node scripts/build.mjs --target <repo>/dev-harness/deploy-pkg --instrument`（普通 build 只把 symlink 安装判为「已是源码」并跳过，不会更新该物化副本，因此必须显式 `--target`）。结果：`deploy-pkg/lib/client.js` 已更新为槽位化版本（844218 bytes，含 `SLOT_TRANSPORT_OPTION`），dcf 注入版保留（`data-locatorjs` 418 处）；`lib/` 37 文件 + package.json + cordis.patch.yml + LICENSE 同步完成；仓库内 harness 沙箱安装同步更新；`check.mjs` 与 37 文件语法闸门 PASS。
- **仍需用户重启 Desktop 宿主**：client module 表对「无 `dsh.client`」的否定结论在进程内缓存（`packages/client/modules` 的 `pkgMeta`：negative verdicts remain stable until restart），本插件的 Loader 行在加入 `dsh.client` 之前就被扫描过，因此仅刷新页面不会装载其浏览器半侧；重启宿主后再刷新页面即可。

## NOT RUN / 未验证

- **真实 profile / 真实 GUI**：已完成 build/同步（见上），但**未重启、未刷新**正在运行的 Electron Desktop；页面仍是旧渲染，重启宿主 + 刷新后需人工复核类型行与字段确实来自槽位。
- **真实浏览器渲染**：组合测试使用手写 React/slot double（声明语义：未声明不可注册、inject 等待声明、keyed 派发、list 按 order），不是真实 `@deepseek-ai/dsh-client-ui-slots` + `ui-renderer`，也不是 DOM/视觉验收（按钮位置/提示换行等外观未截图比对）。
- **真实 devtunnel connect / SSH 业务**：本改动只涉及 UI 归属与提交门控，未连接任何远端、未运行 CLI。
- 兄弟仓 host 侧（carrier/pool/路由/机器注册表语义）未改动，其 host 测试只作为回归背景。
- **运行期依赖**：机器表单里 Dev Tunnel 的保存/探测现在要求 occupant 已发布合法 draft；若本插件浏览器半侧未装载（或未通过校验），dsh-remote 会显示 `settings.carrierNotPublished` 并禁用保存——这是设计取舍，不是缺陷，但部署时需确认 `dsh.client` 已被宿主扫描到。
