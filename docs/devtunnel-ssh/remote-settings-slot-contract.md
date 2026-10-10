# RemoteSettings 机器表单槽位契约 v1（dsh-remote ↔ dsh-devtunnel-ssh）

用户指令：dsh-remote 统一 RemoteSettings 里的「类型」与 Dev Tunnel 通道模式/字段必须由本插件注入，
dsh-remote 只提供 slot，各司其职。本插件不再注册独立 `settings.section`，也不再渲染整页表单。

## 职责划分

| 侧 | 拥有 |
| --- | --- |
| dsh-remote（slot owner） | 机器注册表与列表、当前工作区作用域、添加/编辑机器卡片外壳、通用保存/删除/探测/镜像提交、SSH 形态的按钮与字段（自己注册进自己的槽位） |
| dsh-devtunnel-ssh（occupant） | `Dev Tunnel SSH` 类型按钮与不可用提示、通道模式（外部监听器/托管连接）、全部 devtunnel 字段、devtunnel 校验与连接体（draft）、镜像路径输入与按钮的呈现 |

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
    * `mirrorPath: string`、`setMirrorPath(v)`、`localMirror: string`、`createMirror(): void`
* 注册项
  * dsh-remote：`{ name, key: 'ssh' }`
  * dsh-devtunnel-ssh：`{ name, key: 'devtunnel-ssh', locale }`

### `settings.remote.machine.transport.panel`

* kind `list`，scope `root`；渲染位置：机器列表卡片之后、添加/编辑机器卡片之前（整宽 box）
* owner props：`{ status, machines, currentId, scopeDir, busy }`
  * `status: object | null` 当前作用域 `/dsh-remote/status`（含 `sshCarrierCapabilities`）
  * `machines: array` 机器注册表当前快照（occupant 用它把 `machineId` 映射成名字/目标）
  * `currentId: string`、`scopeDir: string`、`busy: boolean`
* 注册项：dsh-devtunnel-ssh `{ name, id: 'devtunnel-ssh', order: 10, locale }`
* occupant 职责：自行只读轮询宿主 `GET /dsh-devtunnel-ssh/channels`，渲染「活动托管通道 / 重试或阻塞 / 最近事件」清单，
  并用 `POST /dsh-devtunnel-ssh/channels { action:'stop', machineId, confirmed:true }` 断开单条托管通道；
  宿主侧未启用 managed（`getManagedStarter` 缺失）时显示提示而不是隐藏整个 box。

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
布局用内联样式、不使用 owner 的私有主题常量，颜色只用 `opacity`/继承以免耦合主题。

## 不在本次范围

dsh-remote 页面顶部的「全局 Dev Tunnel 设置（宿主）」卡片（CLI 路径 / 托管授权 / 预检）仍由
dsh-remote 渲染并直接调用本插件宿主路由 `/dsh-devtunnel-ssh/settings`、`/dsh-devtunnel-ssh/preflight`；
它是宿主设置，不是机器表单的一部分，如需同样注入属后续独立变更。
