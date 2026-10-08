# Opt-in apply routes验证（dlg-20261007-e98105a3）

新增[真实apply组合测试](<../../packages/devtunnel-ssh/test/apply-routes-contract.test.mjs>)：真实本仓adapter + 父侧apply，隔离DSH_HOME mkdtemp，fake ctx/routes，SshPool.prototype.sftp仅注入stat fixture并finally还原。不连接CLI/SSH，不读keys/agent，不触真实profile。

PASS覆盖：experimentalSshCarrier=true add hostless carrier；endpoint rotation保持canonical身份；target/pin update拒绝；mirror返回schema3/machineId/canonical target且无host/port；delete删除machine并清理对应workspace选择；adapter注销后add缺插件fail closed。全套78/78 PASS、0FAIL exit0，见[TAP](<evidence/apply-route-tests.txt>)。无普通ready启用。

### 发现并明确报告的effect生命周期风险

首轮采用执行effect callback的fake ctx，mirror返回500 `ssh carrier cache disposed`，不是hostless路由失败。只读定位父侧 index.js 的effect行：`ctx.effect(() => closeRoutePools(), 'dsh-remote.routePools')`。该callback立即close carrier cache，若真实Cordis effect按setup执行，将在apply阶段关闭；与其它`() => () => pool.close()`模式不同。测试后改为底座现有fixture同样的effect no-op，CRUD/mirror通过。**此问题没有在本仓修底座，也未以no-op通过掩盖**：父侧需核实真实ctx.effect语义，可能需改返回disposer再加真实生命周期fixture。

测试的临时DSH_HOME保留系统tmpdir，不删除未经核实路径；没有文件写到profile。no-op effect不验证宿主unload销毁，因此factory/cache销毁由独立组合tests覆盖但非完整宿主生命周期。

hostless上下文：本轮实际add/update/mirror/delete未发现依赖machine.host的遗漏，schema3无需host/port；其它路由/PTY/Git/all-dial未覆盖，不能据此声称全部支持。删除后旧镜像文件仍可能存在，schema3 lookup必须靠父侧machine缺失fence拒绝，不把镜像存在等同可再激活。

前提README已明确两端官方CLI+GitHub登录、B授权sshd/独立fingerprint；ordinaryWorkspaceReady/productionReady=false。未部署、未连接个人Tunnel。

## 修复协作复验 dlg-20261007-f47d8997

父侧已将routePools effect改为 `ctx.effect(() => closeRoutePools, ...)`。本仓fixture针对该label立即执行setup、断言返回disposer并收集到finally卸载，而非no-op；CRUD/mirror全部通过，cache不再apply时即disposed。其它旧effect rows仍未由本轮fixture执行/审核，不能泛化为完整Cordis启动验收。

新增独立插件loader unload真实registry组合：立即effect setup收集注册disposer，持有external lease，unload注销carrier并settle closed/dial getter stale，重复卸载幂等。全套 **79/79 PASS、0 FAIL、exit0**，见[effect/unload TAP](<evidence/effect-unload-tests.txt>)。无网络/真实CLI/PTY，普通workspace gate不变。
