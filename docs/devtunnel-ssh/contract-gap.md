# 公开契约核查与最小底座需求（2026-10-07）

结论：不能只注册 Provider 即复用现有 SSH。此处是**接口提案，不是已存在 API**。底座没有修改；父会话直接消息被工具父树限制拒绝，交付此文作为明确需求报告。

## 已核实源码

- [exports](<../../../dsh-remote/package.json#L28-L34>) 不公开 SshPool；[Provider 注册](<../../../dsh-remote/lib/provider.js#L11-L35>) 有 validate/sanitize/connect 与 disposer，但 [内建 ssh connect](<../../../dsh-remote/lib/index.js#L479-L500>) 返回 fs/exec=null 概念句柄。
- [machinePoolOf](<../../../dsh-remote/lib/index.js#L923-L1017>) 私有；SSH 绕过 Provider，用 host:port:user 创建 SshPool，不能深导入/monkey patch。
- [hostkey](<../../../dsh-remote/lib/hostkey.js#L48-L91>) 按 host:port 信任，默认 accept-new，有 off 分支。新承载必须严格按逻辑目标确认指纹，禁止 off/自动 accept-new。另 [routePool 创建](<../../../dsh-remote/lib/index.js#L988-L1005>) 未传 knownHostsFile，而其他池有传入，须作为底座安全回归项。
- [镜像路径/meta](<../../../dsh-remote/lib/index.js#L268-L318>) 仅 vscode-tunnel 使用稳定身份；[binding](<../../../dsh-remote/lib/binding.js#L94-L116>) 的 SSH 仍用 host/port。需要新逻辑 SSH schema，不能把 localhost 临时端口写成身份。
- [PTY](<../../../dsh-remote/lib/pool.js#L481-L574>) 独立 Client；[close](<../../../dsh-remote/lib/pool.js#L703-L749>) 不管理全部独立 PTY。底座须将每个 PTY/forward 纳入 carrier lease 生命周期。
- [机器保存](<../../../dsh-remote/lib/index.js#L3827-L3930>) 硬编码 transport/SSH 字段；[连接测试](<../../../dsh-remote/lib/index.js#L4038-L4055>) 直接建池。只改一个拨号调用点不够。
- [命令注册契约](</Users/havoc/Documents/Projects/tools/deepseek-harness/packages/interaction/commands/src/index.ts#L179-L190>) 已核实，实验入口只注册诊断命令，不启动连接。host/webServer 可用于后续独立 UI，但没有安装/浏览器验收。
- [subprocess](</Users/havoc/Documents/Projects/tools/deepseek-harness/packages/subprocess/subprocess/src/index.ts#L94-L96>) 跟随 filesystem 执行世界，不能假设 ctx.subprocess 就是控制端本机；CLI manager 必须明确 host-local。

## 请求父侧评审的最小通用合同

```js
// 拟议名称与字段，尚未实现/发布
registerSshCarrier({
  id, apiVersion, validateConnector, sanitizeConnector,
  acquire({ machineId, connector, signal }) // -> lease
}) // -> disposer
// lease = { dialHost, dialPort, targetIdentity, generation, closed, release }
```

1. 本仓拥有官方 CLI 生命周期；底座拥有 SSH 认证、hostVerifier、SFTP/exec/PTY，不公开裸引擎也可。
2. connector 保存、导入、测试、全部拨号入口走同一 resolver，公开 CRUD 或泛化现有路由，插件不私写 machines.json。
3. trust 按逻辑机器+目标 revision 绑定，含 tunnel/cluster/remotePort；临时本地端口变化不丢信任，目标变化需重新人工信任。指纹独立渠道核实、查询/撤销接口与默认严格策略。
4. 池键至少 machineId + target revision + username/auth revision + generation；镜像按稳定 machineId/目标 revision/remotePath，兼容旧 schema 但 carrier 缺记录时禁止 ad-hoc localhost fallback。
5. 每个 SSH/PTY/forward 持有 lease 引用；generation 失效关闭所有旧连接，不能重放 exec/write/PTY 输入。release 幂等可等待；dispose/start race 必须无泄漏。
6. 能力版本可探测；缺 API 时显示不可用而不是影响宿主启动。新 transport/connector 的命名与正式版本待 Step0 和底座实现后冻结。

## 未进行

无兄弟仓修改。无完整 UI、安装器、自动迁移、产品 profile 部署。原参考计划的跨工作区移动仍待明确授权，未重试或变通。
