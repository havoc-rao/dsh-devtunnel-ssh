# dsh-devtunnel-ssh 开发约束

独立零构建host插件，用户UI统一在兄弟dsh-remote RemoteSettings；禁止重新增加独立settings page。lib为手写源码；runtime只使用公开carrier注册路径，不复制SSH引擎或monkey patch。test内部source imports只是开发组合测试，不表示公开API。

- 机器表单UI按槽位契约注入：dsh-remote 声明 `settings.remote.machine.transport.option`(list) 与 `settings.remote.machine.transport.fields`(keyed, entryKey=transport)，本包浏览器半侧只经 `ctx.slots.inject` + `register` 注入「Dev Tunnel SSH」类型按钮、通道模式与 devtunnel 字段，并把 draft 交回 owner 提交；不直接调用宿主路由、不注册 settings.section、不覆盖他人条目。契约见 docs/devtunnel-ssh/remote-settings-slot-contract.md，改动任一侧前先同步它。
- 浏览器半侧须同时具备 `exports["./client"]` 与 manifest `dsh.client`（platform web + inject renderer/locale），否则不会被装载；`inject` 仅声明 client 组合依赖，不是公开JS API。

- 默认external/manual；managed须宿主明确managedEnabled授权且已从宿主PATH或可选绝对路径覆盖检测CLI后按需启用，恢复有界且不重放SSH业务；productionReady不夸大。保留实际证据PASS/FAIL/NOT RUN；用户与父侧实机证据不冒充本会话执行。
- 不自动安装CLI/登录/启用sshd/改防火墙，不读取token/cache/privatekey/agent；preflight必须用户明确确认，路径由宿主已持久化Settings提供，Config.cliExecutable仅兼容默认；Settings写入必须宿主认证与明确授权，不接受预检body临时路径。
- 不修改Desktop/profile或启动替代GUI，部署授权另由宿主任务处理。
- 测试：node --test test/*.test.mjs；语法node --check lib/*.js逐文件；pack用npm pack --ignore-scripts，允许lib/manifest/patch/README/MANUAL无secret/test/docs/node_modules。
- 组合测试依赖../dsh-remote checkout，改兄弟仓前读其AGENTS/dev-standards且需明确权限；原split任务不修改它；本次managed落地已获用户明确授权，可在兄弟仓工作区修改统一UI与契约，不部署profile。
- 原dsh-remote-vscode保留旧Bridge/归档与原子迁移前源副本，不自动删源。不init/commit本repo，待用户决定。
