# dsh-devtunnel-ssh 开发约束

独立零构建host插件，用户UI统一在兄弟dsh-remote RemoteSettings；禁止重新增加独立settings page。lib为手写源码；runtime只使用公开carrier注册路径，不复制SSH引擎或monkey patch。test内部source imports只是开发组合测试，不表示公开API。

- 默认external/manual，managed入口未启用；productionReady不夸大。保留实际证据PASS/FAIL/NOT RUN；用户与父侧实机证据不冒充本会话执行。
- 不自动安装CLI/登录/启用sshd/改防火墙，不读取token/cache/privatekey/agent；preflight必须用户明确确认，路径由Config.cliExecutable提供。
- 不修改Desktop/profile或启动替代GUI，部署授权另由宿主任务处理。
- 测试：node --test test/*.test.mjs；语法node --check lib/*.js逐文件；pack用npm pack --ignore-scripts，允许lib/manifest/patch/README/MANUAL无secret/test/docs/node_modules。
- 组合测试依赖../dsh-remote checkout，改兄弟仓前读其AGENTS/dev-standards且需明确权限；本split任务不修改它。
- 原dsh-remote-vscode保留旧Bridge/归档与原子迁移前源副本，不自动删源。不init/commit本repo，待用户决定。
