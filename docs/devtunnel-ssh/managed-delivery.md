# A侧 managed 通道源码交付（2026-10-09）

## 实现

- host Config `managedEnabled` 默认false，`cliExecutable` 空或非绝对路径不启用。明确授权后注册carrier managed能力；加载/保存不运行CLI或预检。
- `startManagedConnect` 仅spawn官方明确Tunnel ID，shell=false；按remotePort解析loopback动态端口。长时间输出流不触发累计字节配额误杀，仍限制单行/待解析buffer及启动总量。进程退出/端口映射变化令旧endpoint立即失效。
- `createManagedStarter` 按tunnelId+remotePort共享故障预算。仅退出/启动timeout重试，0.5/1.5/4秒退避；4次不稳定故障耗尽，稳定30秒后惰性reset。取消与主动释放不计故障，无租约时不后台重连。安全/输出/spawn错误不重试，cleanup失败禁止复启同目标。
- carrier旧generation闭合后等待cleanup，后续acquire取得新port与generation；不会修改旧lease或重放SSH请求。父pool/cache沿用闭合后按需重建契约，严格pin不变。
- dsh-remote统一RemoteSettings增加external/managed选择，精确authenticated `sshCarrierCapabilities.devTunnelManaged===true`门控。managed保存不含endpoint并隐藏本地port输入；remotePort默认22仍应确认。B侧host不在托管范围。
- external兼容，不杀用户自己的CLI进程。同目标不同machineId不同时启动第二个托管进程，报告busy。

## 本会话实际证据

| 验证 | 结果 |
| --- | --- |
| `node --test test/*.test.mjs` 本插件最终全套 | PASS，119/119，0 skip/失败 |
| 逐文件 `node --check lib/*.js` | PASS |
| 本插件 `git diff --check` | PASS |
| 父仓 `node check.mjs` / `git diff --check` | PASS |
| 父仓 unified client + managed contract 两测试文件 | PASS，9/9 |
| fake supervisor +真实父pool/cache组合 | PASS，保持pin/新port-generation/不重放exec |
| `npm pack --ignore-scripts` 隔离tmp cache | PASS，18文件，仅lib/manifest/patch/README/MANUAL |
| 默认npm cache打包 | FAIL（EPERM，cache不可写）；未修用户cache，改隔离临时cache成功 |
| 官方CLI / GitHub登录 / 真实Tunnel / B-side host | NOT RUN |
| 当前GUI部署/浏览器验收/睡眠恢复/真实SSH | NOT RUN，本会话未部署 |

并行父仓代理另外报告其更广测试43+38通过/2个OS凭据后端不可用跳过；最终补充契约22通过。该报告属代理执行，不冒充父会话直接执行。父仓原有tree-scroll相关工作树变更保留。

## 启用与剩余验证

部署另行授权。实际宿主须启用dsh-remote experimentalSshCarrier，再配置本插件 cliExecutable + managedEnabled:true；status能力确认后，在原机器卡同目标同pin切换托管、保存、测试。不把新port写入机器配置。budget/安全封锁需排查后显式reload插件才重置监督器；不承诺无缝恢复旧PTY。

需继续实机核对CLI输出版本、动态port、连接断开/网络失败、系统睡眠恢复、删除/卸载进程回收以及现有GUI路径。productionReady仍false。

## 自动重启恢复加强（2026-10-13）

用户实测：断电/合屏一段时间后 devtunnel 连接失败。SSH 侧契约明确"closed lease stays closed，不后台保活、不重放"，因此恢复必须由本插件拥有。本次交付：

- **意外退出自动重启**：已显式启动并 ready 的 managed 通道，connect 进程意外退出（CONNECT_EXITED）不再停留 error，而是进入 `recovering` 状态并按 2s/8s/30s 退避自动重启，最多 3 次/恢复周期；任一代稳定运行 ≥5 分钟重置预算；耗尽进入 `error`（`CONNECT_RETRY_EXHAUSTED`）等待用户操作，显式 start/restart 开启全新周期。用户 stop/restart/delete、设置变更 stopAll、`CONNECT_CLEANUP_FAILED` 毒化均立即取消待执行重启；停止的通道永不被自动拉起；不重放 SSH 业务。
- **整机睡眠/合屏/断电恢复看门狗**：进程存活但隧道挂死（devtunnel 与中继连接失效）是无退出的病态，靠退出事件无法恢复。新增纯 Node 心跳（30s 间隔，Date.now 墙钟差值）检测 ≥5 分钟事件循环挂起间隙，对恢复时仍处于 ready 的 managed 通道各重启一次（新 generation、重置预算）。stopped/error/starting 通道与 external 条目不受影响。启发式检测（正向墙钟跳变同样触发），不依赖宿主 power API。
- **on-demand carrier 路径**：无租约时仍无后台重连，下次 acquire 全新 generation，supervisor 保持启动期有界重试；唤醒恢复时 `carrier.wakeRecover` 会失效 catalog-less 嵌入下仍存活（含借用中）的 managed 代，使下一次 acquire 建立新隧道，避免拨号挂死的旧中继连接。生产接线（runtime.getChannelEntry）下 managed 连接全部经已保存通道走常驻恢复，不受此影响。
- **真断电重启整机**（进程被杀死）：重载后 managed 通道保持 stopped 的既有契约不变，开机自动拉起属后续独立决策（需持久化意图 + 可选 UI），本次未实现。

### 本次实际证据

| 验证 | 结果 |
| --- | --- |
| `node --test test/*.test.mjs` 全量（含新增 sleep-watchdog 4 项、channel-manager 恢复 8 项） | PASS，218/218，0 fail/skip |
| 新增：意外退出→recovering→自动重启新 generation、旧 lease 失效 | PASS |
| 新增：恢复预算耗尽→error CONNECT_RETRY_EXHAUSTED、显式 restart 新周期 | PASS |
| 新增：稳定 5 分钟（测试用 25ms 稳定窗）重置恢复周期 | PASS |
| 新增：用户 stop 取消待执行自动重启；restart 压过 pending 恢复 | PASS |
| 新增：delete 丢弃恢复记录；cleanup 毒化永不自动重启 | PASS |
| 新增：看门狗唤醒→ready managed 通道重启一次，stopped/external 不受影响，稳态不重复触发 | PASS |
| 新增：看门狗唤醒→catalog-less on-demand managed 代失效，下次 acquire 新 generation | PASS |
| 新增：看门狗配置校验、stop 幂等、handler 异常不外泄 | PASS |
| 逐文件 `node --check lib/*.js` | PASS |
| `git diff --check` | PASS |

契约变更已同步 [槽位契约 v5](<remote-settings-slot-contract.md>)（`recovering` 状态、有界自动恢复小节）；README/MANUAL 已更新。真机睡眠/断电恢复仍为 NOT RUN：本会话未部署、未在真实宿主上验证 macOS 合屏/断电→唤醒→自动重连链路。

## 会话头 Dev Tunnel 状态标记（2026-10-13，dsh 本体会话壳）

用户要求配合 `deepseek-harness/packages/client/ui-conversation/.../ConversationSession.js` 的会话
头区域，对 devtunnel 工作区标记 devtunnel 状态。结论：宿主侧**零改动**——ui-conversation 已声明
`conversation.session.header.utilities`（list/session 作用域，dsh-inputbar-replacement、
ui-open-in-app 等第三方插件已有同等占用先例），本插件浏览器半侧直接 `ctx.slots.inject` +
`register`（id=`devtunnel-status`, order=100）注入状态组件：

- 组件经框架注入 `sessionId` + `useSessions` 取会话 cwd；仅当工作区是 devtunnel carrier 机器时渲染
  状态芯片：ready/starting/recovering/stopping/error（含错误码）/stopped/external/missing。
- 解析链三条公开只读 GET（不新增宿主路由、不写任何数据）：`/dsh-remote/git-workspace?local=` →
  `/dsh-remote/machines` → `/dsh-devtunnel-ssh/channels`；挂载时每 10s 轮询，卸载即停；任一环节
  失败保持上一状态或隐藏；非 devtunnel 工作区在第一条链路就短路，不产生多余请求。
- 无 dsh-remote 时链路 404，标记自然不可见；与 RemoteSettings 面板共用同一通道源（恢复中/错误码
  与其一致，含上节自动恢复状态）。

### 本次实际证据

| 验证 | 结果 |
| --- | --- |
| `node --test test/*.test.mjs` 全量（新增客户端 4 项：解析投影/轮询链路/芯片渲染/槽位注册） | PASS，222/222，0 fail/skip |
| 新增：resolveSessionDevTunnelStatus 边界（非 devtunnel→null、external、managed ready/recovering、legacy 目标匹配、缺失→missing、非法身份拒绝） | PASS |
| 新增：轮询链路按序读三条 GET，非 devtunnel 短路、失败返回 null 不外抛 | PASS |
| 新增：芯片仅 devtunnel 工作区渲染，文案/悬停明细正确；普通工作区渲染 null 且只发一次请求 | PASS |
| 新增：apply 等待会话壳声明后注册 utilities 条目（id/order 冻结） | PASS |
| 逐文件 `node --check`（含 lib/client/client.js） | PASS |
| `git diff --check` | PASS |
| 真实浏览器会话头渲染、dsh-remote 路由联调 | NOT RUN，需宿主部署后目视核对 |

既有客户端路由只读断言已同步为新契约：除自有 `/dsh-devtunnel-ssh/channels` 外，仅读
`/dsh-remote/git-workspace` 与 `/dsh-remote/machines` 两处公开 GET，无写。
