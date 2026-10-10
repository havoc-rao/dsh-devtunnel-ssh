# DevTunnel 全局 Settings 源码交付（2026-10-09）

用户无需手工编辑Config。在dsh-remote原RemoteSettings中新增全局DevTunnel配置：CLI绝对路径、托管授权、保存/刷新、独立确认的版本与登录预检。机器级Tunnel ID/远端SSH端口/凭据/pin保持原卡片，不新设独立页面。

## 实现与边界

- 认证宿主 exact `/dsh-devtunnel-ssh/settings` GET/POST；公开字段仅settings(cliExecutable,managedEnabled)、revision、source、activeManaged、available。POST严格5字段、confirmed=true、8192B上限；错误allowlist，不返回raw fs/CLI秘密。
- 数据保存于DSH_HOME/devtunnel-ssh/devtunnel-settings.json，schemaVersion1、0600、exclusive临时文件+fsync+atomic rename。仅保存两个非秘密设置，不编辑profile。缺文件用Config兼容默认；坏文件fail closed。
- Settings保存优先于Config，确认不代表安装/登录或执行CLI。保存及读取不会启动通道。已存设置通过revision避免同宿主多个窗口/实例覆盖；不同进程共享同DSH_HOME未提供跨进程原子CAS，避免同时写入。
- 动态runtime保持registry capabilities getter；改路径/托管开关时，同步阻止新acquire，关闭并等待活动managed cleanup后再持久化及交换starter。旧pool经lease.closed失效，不重放；external租约不影响。cleanup失败禁用managed并拒绝再次启动。
- 活动断开必须单独confirm disconnectActive；revision冲突409不自动retry；未保存路径时UI不准预检。预检独立confirm，只读host当前路径，不接受body任意路径，预检与设置保存互斥。
- 保存Config同值也可建立持久化覆盖且不无故断开。动态能力随保存与卸载更新。

## 证据

父会话直接运行：
- 本插件完整 `node --test test/*.test.mjs`：PASS 137/137，0 skip/fail。
- 全部lib `node --check`：PASS。
- 实际apply+路由+registry展平getter、保存+重载持久化fake组合：PASS，无realCLI。
- 运行时活动cleanup前不切starter、不启动新CLI；external仍可用；坏file/cleanup failure/revision/preflight动态路径：PASS。

父仓工作区代理报告：
- 完整回归794项，792 PASS、2 SKIP、0 FAIL（初次系统Python缺Pillow，改bundled Python重跑通过）。
- check.mjs、client语法、diff校验PASS。
- 最后POSIX路径严格对齐补测7/7 PASS；委派结束被宿主回收，修改已落盘。父会话直接复跑统一Settings+carrier integration+managed contract共16/16 PASS，并复核check.mjs、client语法与两仓diff闸门PASS。
- 最终npm pack（隔离tmp cache，ignore-scripts）PASS，21个允许文件，无个人Settings数据、test/docs。

真实CLI/当前GUI部署与浏览器端到端验收：NOT RUN。未安装CLI、登录、启用sshd、修改profile或启动替代GUI；productionReady仍false。包仅源码允许文件，不含Settings个人数据或test/docs。
