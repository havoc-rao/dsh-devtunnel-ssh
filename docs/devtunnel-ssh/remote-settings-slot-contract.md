# RemoteSettings 机器表单槽位契约 v8（dsh-remote ↔ dsh-devtunnel-ssh）

用户指令：dsh-remote 统一 RemoteSettings 里的「类型」与 Dev Tunnel 通道模式/字段必须由本插件注入，
dsh-remote 只提供 slot，各司其职。本插件不再注册独立 `settings.section`，也不再渲染整页表单。

v3（2026-10-11）：`settings.remote.machine.transport.panel` 的 owner props 增加 `tunnel`
（dsh-remote 的 `useTunnelSettings` 状态机）；**Dev Tunnel 全局设置卡从 dsh-remote 页面顶部
迁入该 box**。occupant 渲染整卡（全局设置 + 常驻 + 通道管理），owner 不再渲染设置卡、不重复
展示常驻状态。渲染层 i18n 文案随迁移进入本插件字典；hook 内 confirm/错误/消息翻译与全部写操作
仍由 owner 状态机完成。

## v8 Client 密码引导专用密钥（2026-10-19）

fields.carrier 增加可选 `bootstrapKey({ password }): Promise<boolean>`。仅新建未保存机器可用；occupant 的密码只保留组件内存，不 patch/publish、不进入机器连接体。旧 owner 无回调时不展示入口。用户先独立核对主机指纹；owner 确认将为目标账号添加专用公钥且私钥未加口令、仅保存在运行 DSH 的 Client 用户私有目录，然后调用既有 `/dsh-remote/machines` 的 `action:'bootstrap-key'`。本操作仅临时密码认证，不保存密码、不启用 agent、不启动隧道、不安装 CLI/服务；通道须先就绪。首轮仅支持 macOS Host。

引导允许无 privateKeyPath/useAgent 的结构有效草稿，故 owner 读取原始 published body（不得放宽普通保存/测试的 valid 门控）。服务端拒绝已保存 id/缺失 confirmed/无指纹/额外私钥或 agent 输入，强制 native pinned-host pool。通过已有密码会话安装公钥，不重放安装；新独立连接禁止密码/agent回退，用真实 native SSH/SFTP 验证。成功仅返回私钥路径与验证摘要；owner 回填 privateKeyPath、关闭 agent、清空密码与 passphrase，再由用户点击既有保存动作。保存失败不删除密钥或远端授权。安装已尝试后的失败标识 remoteMayBeAuthorized，提示保留的本机路径、不要盲目重试；不泄露密码/私钥/远端原始 stderr。owner 对重复点击互斥，编辑切换后的旧响应不回填。

## v7 已保存机器显式更换通道（2026-10-19）

fields 的 `carrier` 新增可选 `retarget(connector): Promise<boolean>` 回调：owner 仅在用户确认、CAS 提交并重新 hydrate 成功后返回 `true`；取消、门控拒绝或失败返回 `false`，由 owner 展示错误。occupant 也捕获意外 rejection，不重试。

occupant 只提供一个“选择通道”下拉，显示实时完整 channels list（包括 stopped/error/recovering，不按当前目标过滤）。`useChannelFeed(false)` 挂载时读取、每 3 秒刷新，聚焦/打开时另行刷新；下方添加通道后，列表在下一次成功轮询时更新，不要求先启动。

新机器选择通道继续 `patch` 普通 draft。已保存（locked）机器选择不同 canonical Tunnel ID（trim）/远端端口（Number）时，只调用 `carrier.retarget(connector)`，绝不 patch/publish 新目标，不乐观更新选中值；立即恢复受控的当前值，取消/失败保持原选择，成功只跟随 owner hydrate。无回调的旧 owner 仍显示全部选项，但跨目标选项禁用且 handler 拒绝，绝不降级普通 patch。同目标 channelId/模式/endpoint 变更仍经普通 patch + 显式保存契约；Tunnel ID、远端端口与指纹仍锁定。busy、正在切换/启动、已保存草稿 dirty 或 feed 不可用时禁用下拉；按 carrier/managed 能力禁用不可选选项。不得另设“更换通道”下拉或按钮。

owner 负责确认（显示原/新目标、共享该机器的全部 workspace 受影响、断开旧 SSH、同一远端与原指纹要求），然后调用既有 machines 路由的 `action:'retarget-carrier'`，携带 `id, connector, expectedConnector, expectedHostFingerprint, confirmed:true`。不提交其他机器草稿，不自动启动通道、不探测、不重放 SSH。服务器保留原指纹与其他机器配置，原 workspace/镜像目录必须继续解析到新目标；普通 update 仍拒绝改目标。迁移失败不得把旧镜像解析到未提交的新目标。保存完成后重新加载已保存机器，作废旧探测反馈。

## v6 机器 item 状态与显式操作（2026-10-15）

新增三个 list/root 槽位，各自由渲染它的 entry 声明，禁止借用其他 entry 的 renderSlot：
- `settings.remote.machine.status`：设置页机器行。
- `remote.picker.hero.machine.status`：hero 目录选择器。
- `remote.picker.sidebar.machine.status`：侧栏目录选择器（包括替换侧栏的 directoryFlow）。

owner props 为 `{ machine, busy, interactive?, onOpenChange? }`，machine 为已保存的脱敏快照，不是草稿。
occupant 仅为 connector.kind=devtunnel 的机器渲染状态 chip；选择器下拉行与选中机器旁均可显示。
选择器下拉行传 `interactive: false`：仅渲染非聚焦的状态 tag，无按钮、下拉箭头或菜单交互。
选中机器右侧传 `interactive: true`：保留状态操作菜单；设置页未传时维持原有交互。
chip 是机器选择按钮的兄弟，不嵌套按钮；交互不会选择机器、浏览目录或连接 SSH。
`onOpenChange(boolean)` 允许 owner 在 portal 菜单展开时暂缓关闭外层下拉；卸载归还 false。
无 occupant 时不留占位。未经 slot 注册的旧内嵌选择器保持原样。

选择器弹窗遵循宿主 ui-primitives 的标准层级：modal overlay 为 `z-index: 1000`，
状态操作菜单使用 `Menu portal:true`（标准 portal 层级 `1100`），以逃逸卡片滚动/裁剪容器并显示在弹窗之上。
owner 不得把选择器 overlay 提升到菜单之上（例如 `9999`）；occupant 不通过私有 CSS 硬抬菜单层级。
此约束同样适用于选择器内的本地目录浏览弹窗；菜单开关仍经 `onOpenChange` 回报 owner。
回归验证须检查 hero/sidebar 两个 directoryFlow 的实际 DirPicker 渲染树，以及嵌套本地浏览弹窗：
每个 `drp-ovl` 均为 `1000`，不能只验证 occupant 已传 `portal:true`（后者无法防止 owner 用 `9999` 遮挡菜单）。

Dev Tunnel 复用会话头的状态与操作菜单，状态只表示隧道，不代表 SSH 已连接。
只读轮询共用短时缓存与在途请求，失败显示未知而非沿用就绪；卸载不再轮询。
每次写操作重新读取机器注册表并核验 connector 身份，再读取最新 catalogRevision；
确认后仍检查当前 item 身份。只允许已有且目标一致的 managed 通道显式启动/重启/停止，
缺失、目标改变、未知、stopping、未授权与 external 禁用写入；不自动创建通道，失败不重试。
启动不重放 SSH 操作，停止/重启警告影响共享通道的全部 SSH 连接。

## v5 独立通道列表（2026-10-11）

本节取代下文旧版 resident 与按 machineId 停止通道的行为。通道配置独立持久化在
`devtunnel-channels.json`，由本插件拥有；channelId 与 SSH machineId 无关。
`GET /channels` 返回所有已保存通道（包括 stopped/recovering/error），`catalogRevision` 用于写入乐观锁。
`POST /channels` 接受 `{action, channelId, revision, confirmed:true, channel?}`：
`create/update` 带严格通道配置 `{name,mode,tunnelId,remotePort,endpoint?}`，create 的 channelId 为
空串，由宿主生成；`start/stop/restart/delete` 不带 channel。mode 为 managed/external；external
仅登记 loopback endpoint，禁止 start/stop/restart，不控制外部进程。列表最多 64 条，同一目标
只登记一次。保存不启动，重载后 managed 通道保持 stopped。旧 resident 配置只在首次读取
空目录时投影成 stopped 的待保存通道；不自动连接、不自动写文件、不改机器注册表。

SSH connector 增加可选 channelId（兼容旧机器按 tunnelId+remotePort 查找唯一通道）；保留
目标描述与原 targetIdentity 算法，防止通道编辑重定向旧机器或破坏既有镜像身份。
carrier acquire 仅借用已就绪通道，release 仅减少引用；停止/故障关闭该代 closed，旧 SSH
连接随之失效。后台 Git/SSH 查询不能创建或重启进程。显式 start/restart 允许 supervisor
在本次启动内有界重试；清理失败阻止再次启动，且永不自动恢复。

### 有界自动恢复（2026-10-13）

已显式启动并达到 ready 的 managed 通道，其 connect 进程意外退出（CONNECT_EXITED）时自动恢复而非
停留在 error：状态先进入 `recovering`（列表错误码保留原退出原因），按 2s/8s/30s 退避最多自动重启
3 次（每次重启内含 supervisor 的启动期有界重试预算）；任一代稳定运行满 5 分钟即重置该失败预算。
预算耗尽后进入 `error`（错误码 `CONNECT_RETRY_EXHAUSTED`）等待用户操作；显式 start/restart 开启
全新恢复周期。用户 stop/restart/delete、设置变更 stopAll、清理失败（CONNECT_CLEANUP_FAILED）均
立即取消待执行的自动重启，停止的通道永不被自动拉起。

宿主进程整机睡眠/合屏/断电恢复后，devtunnel 客户端即使进程存活也常与中继失去连接。插件以纯 Node
心跳（30s，Date.now 墙钟差值）检测 ≥5 分钟的事件循环挂起间隙，对恢复时仍处于 ready 的 managed
通道各执行一次有界重启（重置恢复预算，新 generation），解决挂死隧道；stopped/error/starting 通道
与 external 条目不受影响。catalog-less 嵌入下 carrier 还会经 `wakeRecover` 失效仍存活的 managed
on-demand 代，使下次 acquire 建立新隧道。检测是启发式（正向墙钟跳变同样触发），无宿主 power API
依赖；重启通道会让借用它的旧 SSH 连接失效，但绝不重放 SSH 业务。

panel 继续由插件渲染，去除 singleton resident 表单，增加独立通道增删改查与启停。
全局设置/preflight 仍经 owner tunnel hook；通道目录 CRUD/启停使用本插件已有受控 channels
路由。fields 从 channels 只读获取选择器；新 managed 机器必须选择已保存通道。
owner 保存/编辑/canonical 快照必须保留 connector.channelId。外部手工端点旧机器保持兼容。

### 已保存机器快捷启动

fields 为已保存 managed 机器提供“启动通道”：用户确认后，读取最新通道目录，以明确
channelId 或旧机器的 Tunnel ID/远端端口匹配。无 channelId 且不存在目标时，用已有名称与
目标创建目录条目，再显式 start。已指定但丢失/变更目标的 channelId 不自动替换。
仅写本插件 channels 路由，不修改机器草稿/注册表，不连接 SSH；旧机器按目标匹配仍可使用。
启动失败保留已创建条目，提示错误；禁止自动重试写操作。

## v4 设置分区（2026-10-11）

统一入口内增加机器 / 连接服务 / 诊断页签。panel 的配置与运行卡位于机器页添加/编辑机器 box 下方，工作区工具归入连接服务；诊断页单独派发事件区，仅当前页签挂载 panel：`section: "services" | "diagnostics"`。服务仅呈现全局配置、常驻及活动/阻塞状态；诊断仅呈现最近事件。未传 section 时保留 v3 完整呈现以兼容旧 owner。owner 保留设置草稿，切页不丢失修改；机器编辑器默认收起。写入与确认职责不变。

## 职责划分

| 侧 | 拥有 |
| --- | --- |
| dsh-remote（slot owner） | 机器注册表与列表、当前工作区作用域、添加/编辑机器卡片外壳、通用保存/删除/探测/镜像提交、SSH 形态的按钮与字段（自己注册进自己的槽位）；Dev Tunnel 设置**状态机**（`useTunnelSettings`：/settings 读写、preflight、resident 门控与确认、revision 乐观锁），经 panel owner props 的 `tunnel` 交给占用方渲染 |
| dsh-devtunnel-ssh（occupant） | `Dev Tunnel SSH` 类型按钮与不可用提示、通道模式（外部监听器/托管连接）、全部 devtunnel 字段、devtunnel 校验与连接体（draft）、镜像路径输入与按钮的呈现；**Dev Tunnel 整卡**（panel 槽位）：全局设置表单（CLI 路径/托管授权/常驻配置/预检按钮，状态经 `props.tunnel` 读写）、常驻状态行、活动通道、重试/阻塞、最近事件、断开 |

插件不直接调用宿主路由：所有写操作经 owner 回调回到 dsh-remote 的公开机器 API。

## 槽位（dsh-remote 在 `settings.section` 条目上声明 children）

### `settings.remote.machine.transport.option`

* kind `list`，scope `root`
* owner props：`{ transport, locked, busy, status, onSelect }`
  * `transport: string` 当前选中的传输 key
  * `locked: boolean` 编辑已保存机器时为 true（宿主禁止 update 变更 transport）
  * `busy: boolean`
  * `status: object | null` 当前作用域 `GET /dsh-remote/status` 的响应（含 `sshCarrierCapabilities`）
  * `onSelect(transport: string): void`
* 注册项
  * dsh-remote：`{ name, id: 'ssh', order: 0 }`，渲染 `SSH` 按钮
  * dsh-devtunnel-ssh：`{ name, id: 'devtunnel-ssh', order: 10, locale }`，渲染
    `Dev Tunnel SSH` 按钮；能力不可用时按钮 disabled 并在下方渲染自己的不可用提示

### `settings.remote.machine.transport.fields`

* kind `keyed`，scope `root`，派发 `entryKey = transport`
* owner props：`{ transport, locked, busy, status, scopeDir, form, patch, setChecked, advOpen, setAdvOpen, ssh, carrier }`
  * `form: object` 当前机器草稿（只读快照）
  * `patch(partial: object): void` 浅合并进草稿；**同时清除上一次探测/镜像反馈**
    （owner 的 `tst`/`msg`/`err`/`localMirror`），因此 occupant 不需要单独的 reset 回调
  * `setChecked(key: string, checked: boolean): void`（与 `patch` 同样清除反馈）
  * `advOpen` / `setAdvOpen` SSH 高级折叠（SSH 条目使用）
  * `ssh: { entries, toggle(), apply(entry), alias(entry) }` SSH 专用助手
  * `carrier`：
    * `publish(draft: { valid: boolean, body: object } | null): void`
      —— occupant 每次字段变化后发布；owner 必须**幂等**（canonical 相同不得 setState，避免渲染环）
    * `saved: string` 已保存连接体的 canonical JSON；新机器为 `''`
    * `dirty: boolean` `canonical(published.body) !== saved`
    * `retarget?(connector): Promise<boolean>`（v7）：跨目标显式确认/CAS/重新 hydrate；成功 `true`，取消/门控/失败 `false`；occupant 不改普通 draft（详见 v7）。
    * `mirrorPath: string`、`setMirrorPath(v)`、`localMirror: string`、`createMirror(): void`
* 注册项
  * dsh-remote：`{ name, key: 'ssh' }`
  * dsh-devtunnel-ssh：`{ name, key: 'devtunnel-ssh', locale }`

### `settings.remote.machine.transport.panel`

* kind `list`，scope `root`；渲染位置：机器页添加/编辑 box 下方，以及诊断页签（整宽 box，按 section 分区）
* owner props：`{ status, machines, currentId, scopeDir, busy, tunnel, section }`（v4 起含 `section`）
  * `status: object | null` 当前作用域 `/dsh-remote/status`（含 `sshCarrierCapabilities`）
  * `machines: array` 机器注册表当前快照（occupant 用它把 `machineId` 映射成名字/目标）
  * `currentId: string`、`scopeDir: string`、`busy: boolean`
  * `tunnel`：owner `useTunnelSettings` 的返回（状态机；渲染层消费，写操作全经它）：
    `{ tunnelSettings, tunnelDraft, setTunnelDraft, tunnelBusy, tunnelErr, tunnelMsg, tunnelProbe,
       tunnelReady, tunnelDirty, tunnelPath, tunnelValid, tunnelResident,
       refreshTunnelSettings, saveTunnelSettings, preflightTunnel }`
    * 表单编辑必须经 `setTunnelDraft`，并同时 `setTunnelProbe(null)` + `setTunnelMsg('')`（作废过期反馈）
    * `tunnelErr`/`tunnelMsg`/`tunnelProbe` 已是宿主侧翻译后的字符串/对象，occupant 原样展示
    * `confirm` 与 `/settings`、`/preflight` 写请求全部在 hook 内完成，occupant 不得自行调用宿主路由
* 注册项：dsh-devtunnel-ssh `{ name, id: 'devtunnel-ssh', order: 10, locale }`
* occupant 职责：渲染 **Dev Tunnel 整卡**——
  1. 全局设置表单（CLI 路径覆盖 / 托管授权 / 常驻模式-Tunnel ID-远端端口 / 保存 / 刷新 / 版本预检 / 登录预检），
     `tunnel` 未就绪（路由缺失或形状不符）时整节禁用而非隐藏，手工刷新恒可用；
  2. 自行只读轮询宿主 `GET /dsh-devtunnel-ssh/channels`，渲染常驻状态行（**整卡只在此处展示一次**）、
     「活动托管通道 / 重试或阻塞 / 最近事件」清单，并用
     `POST /dsh-devtunnel-ssh/channels { action:'stop', machineId, confirmed:true }` 断开单条托管通道；
  3. 宿主侧未启用 managed（`getManagedStarter` 缺失）时显示提示而不是隐藏整个 box。

### 宿主只读/受控接口（本插件自有路由，不属于 slot 契约）

`GET /dsh-devtunnel-ssh/channels` →
`{ ok:true, revision, enabled, activeManaged, channels:[{machineId,mode,tunnelId,remotePort,state,endpoint,since,generation,refs}],
   supervisor:[{tunnelId,remotePort,active,failures,blocked,cooldownUntil,pending}], recent:[诊断条目…] }`

`POST /dsh-devtunnel-ssh/channels` `{ action:'stop', machineId, confirmed:true }` → `{ ok:true }`；
未知 machineId 404 `CHANNEL_NOT_FOUND`，托管未启用/适配器不可用 503 `CHANNELS_UNAVAILABLE`，其余 405/400。

## draft（连接体）契约

插件 `carrier.publish` 的 `body` 与机器 POST body 同形（owner 再补 `action`/`id`）：

```js
{
  transport: 'ssh',                 // 既有字段，保持字面量
  name, username,                   // trim 后
  connector: { kind: 'devtunnel', mode: 'external' | 'managed', tunnelId,
               remotePort: Number, ...(mode === 'external' ? { endpoint: { host, port: Number } } : {}) },
  hostKeyMode: 'verify',
  expectedHostFingerprint: 'SHA256:…',
  useAgent: Boolean, privateKeyPath: String,
}
```

* `valid` 同时包含字段校验与**通道模式能力**（`devTunnelManaged === true` 才允许 managed）。
* dsh-remote 的「已保存」快照用**同一形状**从机器记录构造，并用递归键排序的 canonical JSON 比较，
  因此两侧 `JSON.stringify` 的键顺序不构成契约。

## 门控

* 保存：`carrier.publish` 的 `valid` 为真；已保存机器改草稿需确认（断开旧连接）。
* 探测（test-connect）：`valid` 且 `dirty === false`（不探测未保存草稿）。
* 镜像：`form.id` 存在、`dirty === false`、`mirrorPath` 非空。
* 列表行「设为当前」仍由 dsh-remote 按 `sshCarrierCapabilities` 门控（注册表职责）。

## 顺序与生命周期

* 两个槽位都由 dsh-remote 的 `settings.section` 条目在 `children` 中声明；插件用
  `ctx.slots.inject(key, …)` + `ctx.slots.register(…)` 注入，声明等待语义保证与加载顺序无关。
* owner 在**派发的 transport 变化**时作废已发布 draft（等新的 occupant 重新 publish），因此 occupant
  每次挂载都必须发布一次；occupant 自己的去重只能覆盖同一次挂载内的重复渲染，不能跨挂载复用。
* 保存/探测门控只看「draft 已发布且 `valid`（+ 脏检查）」，**不比较 `body.transport` 与 UI transport key**：
  `body.transport` 是持久化字面量 `'ssh'`，只在 canonical 比较和机器形状校验里出现。
* 插件 `inject` 服务：`['slots', 'locale']`；`ctx.get('slots')` 缺失时静默返回。
* manifest 需要 `exports["./client"]` 与 `dsh.client = { platform: 'web', inject: [...] }`，否则浏览器半侧不会被装载。

## 视觉

occupant 复用 owner 注入的 `.rws-btn`（激活态加 ` on`）与 `.rws-input` 类名获得一致外观；
panel 使用 `.dvt-panel` 命名空间下的 CSS，避免污染 owner 或其他槽位；不使用 owner 私有主题常量。普通内容颜色继承 currentColor，通过透明度区分层级，窄容器自动换行。通道列表置于顶部，全局设置折叠，未配置时默认展开。

通道状态圆点与机器行/会话头复用同一颜色映射：ready 绿色，starting/recovering/stopping 黄色，error 红色，stopped/未知灰色；external 蓝色（仅表示外部管理，不代表已验证就绪）。保留状态文字，不仅依赖颜色传递信息，彩色圆点不降低透明度。「已授权托管」只表示权限，保持中性色，不冒充运行状态。此项仅调整 occupant 展示，不改变 owner props、状态机或启停行为。

## 版本历史

* **v3（2026-10-11）**：全局设置卡迁入 panel 槽位整卡（见文首）；dsh-remote 移除
  `tunnelCard`/`residentStatusLine` 渲染，页面顶部不再有第二张 Dev Tunnel 卡；常驻状态只在整卡
  展示一次。渲染层 i18n（`tunnel*` keys）迁移到本插件字典，hook 层 keys 留在 dsh-remote。
* v1/v2：option + fields 注入（v1）；panel 通道管理 box（v2）。

## 会话头 Dev Tunnel 状态标记（2026-10-13，dsh 本体会话壳）

面向 dsh 本体的会话界面，不是 dsh-remote 槽位。本插件浏览器半侧占用 ui-conversation 声明的
`conversation.session.header.utilities`（list，session 作用域，id=`devtunnel-status`，order=-100），
仅对 Dev Tunnel 工作区在会话头右侧（utilities 区，open-in-app 等原生控件旁）渲染一枚状态标记：
已连接/连接中/恢复中（自动重启）/
连接失败（含错误码）/未启动/外部监听/通道缺失，点悬停显示通道名、Tunnel ID、远端端口与实际
loopback 端点。非 devtunnel 工作区渲染空（不占位）；本条目 order=-100，在 utilities 区内排在
open-in-app（-10）、editor-workbench（9）等按钮左侧。声明缺失时 `slots.inject` 静默跳过，不影响原有会话头。

### 工作区连接摘要 v1（SSH 与 Dev Tunnel 特化）

优先读取 `GET /dsh-remote/status?sessionId=…&cwd=…` 的 `connection`：
`schemaVersion:1, scope:'workspace', binding:'local'|'bound'|'unavailable'`；仅 bound 摘要包含
稳定 machineId、protocol、path（direct/carrier）、carrierKind、mode、carrierTarget 与
`ssh.state`（connected/disconnected/unknown）。Dev Tunnel 的 carrierTarget 只含 tunnelId、
remotePort、可选 channelId。targetIdentity 沿用 canonical 身份，不使用临时 localhost 端点。
该字段是只读 additive 展示契约，不迁移机器或镜像记录，不创建 pool、不拨号。

本插件只处理 `protocol:'ssh', path:'carrier', carrierKind:'devtunnel'` 的 bound 工作区，
然后读取自有 `/dsh-devtunnel-ssh/channels` 获得通道状态。隧道 ready 显示“隧道就绪”而非
“SSH 已连接”；tag 只展示 Dev Tunnel 状态，不追加 SSH 状态文案；external 显示“外部管理（未验证）”。已确认 Dev Tunnel
身份而通道查询失败时仍显示“状态未知”，不隐藏；显式 channelId 缺失/目标变化不得匹配别的通道。

旧版本没有 connection 字段时，明确兼容 `/dsh-remote/resolve-mirror?local=…` +
`/dsh-remote/machines` 的稳定绑定与 connector.kind；绝不读取 Git 标记或全局当前机器猜身份。
存在 connection 但 local/unavailable/不支持版本时不得走旧接口降级。轮询每 10s 一次，不重叠请求，
切工作区立即隐藏旧 chip，卸载停止轮询；自动状态查询只读、同源认证，无设置写入。

### tag 点击悬浮操作

状态 tag 为 button，点击展开 dsh ui-primitives 的 Menu（portal，支持点击外部/Esc/键盘关闭），
列出当前通道信息与启动/重启/停止/刷新。操作复用已认证 `/channels` 接口与设置页的确认提示；
每次动作重新读取工作区身份和 catalogRevision，严格校验 channelId/tunnelId/remotePort/mode。
已停止才可启动，ready/starting/recovering 时启动禁用，stopping/缺失/未知或未授权时写操作禁用。
external 仅展示与刷新，绝不控制外部进程；不会自动创建通道，不修改机器绑定或全局设置。
同组件并发操作互斥，POST 失败不重试；确认后切工作区则拒绝旧动作。操作完成刷新当前 tag。
停止/重启影响所有共享该通道的 SSH 会话，确认提示保留此警告，不重放 SSH 业务。

dsh 壳零改动；dsh-remote 仅新增统一只读摘要；Dev Tunnel 特化由本插件拥有。
