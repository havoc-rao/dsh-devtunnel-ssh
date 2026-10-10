# 独立包与内部cache组合验证（dlg-20261007-3b6b967a）

已核实root旧package/cordis patch布局和命令注册契约，新增独立包[manifest](<../../packages/devtunnel-ssh/package.json>)/[patch](<../../packages/devtunnel-ssh/cordis.patch.yml>)，name dsh-devtunnel-ssh，main lib/index.js，dsh.bundle.patch正确；private=true避免误发npm，仍可本地打包装配，未安装到profile。旧Bridgeroot manifest/入口/归档不改。

[入口](<../../lib/index.js>)动态import已核实公开dsh-remote/lib/ssh-carrier.js，失败返回undefined安全能力缺失；ctx.effect拥有carrier及命令disposer；不会启动CLI/创建机器。默认external，managed代码存在但宿主路径/审批配置尚未装配，不自动启用。peer dsh-remote可选且不编造正式最低版本；仅能力探测。普通工作区ready=false、productionReady=false，已有用户功能证据不放行完整Step0。

验证：入口fake API加载/缺导出/注册/dispose tests PASS；父侧真实内部cache source+adapter+factory(FakePool)组合验证singleflight、认证revision和端点变化关闭旧pool、显式invalidate、carrierClosed重建；**cache不是包公开runtime依赖**，无真实SSH/PTY。

全套77/77 PASS，0FAIL exit0，见[TAP](<evidence/package-cache-tests.txt>)；所有lib/test node --check、diff PASS。

`npm pack --dry-run --json --ignore-scripts`实际成功：12 files、11,220 bytes估算packed；核对仅lib/manifest/patch/README，无test、归档或.dsh秘密；见[pack文件清单](<evidence/package-pack-dry-run.json>)。这是dry-run，没有真实tgz交付/安装/browser验收。npm cache放临时目录，没有profile写入/依赖安装。

契约缺口：动态注册依赖插件加载顺序（底座同进程registry），最低版本待发布；启动fail-safe不代表CRUD/mirror/all-dial完成；managed host-local executable/配置权限与前提runner仍需受控装配；cache移除TTL避免PTY强关但update/delete/unload仍关闭整个pool，terminal引用UI语义待父侧验证。raw endpoint只运行时外部租约，不手写registry或用普通localhost机器替代。record/sanitize源码由父侧加固，本轮未额外测试新auth类型（原record组合回归仍PASS）。
