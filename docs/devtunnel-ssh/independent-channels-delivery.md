# 独立通道列表交付（2026-10-11）

## 变更

生产 apply 为 carrier 注入 getChannelEntry；SSH managed acquire 只能借用列表中已就绪的
通道，没有按需启动的回退。目录配置与 SSH 机器分开保存，channelId 可被多台机器引用。
通道列表提供创建、编辑、删除、启动、停止、重启，保存不启动；external 仅登记回环端点。
停止、退出或更新使旧 generation 的 closed 通知所有借用者，SSH release 不停止进程。
启动期间取消、迟到句柄、清理失败、全局设置变更均纳入运行生命周期。

RemoteSettings panel 保持统一入口，移除全局 singleton resident 表单；本插件提供通道列表和
机器通道选择器。dsh-remote 的机器草稿、编辑回填和 canonical 快照保留 channelId，原有
未提交的页签/UI 改动未回退。契约升级 v5；README 与 MANUAL 同步。

旧 managed 机器可按目标匹配已保存通道；目标描述与 mirror identity 不变。旧 resident
在无目录时仅展示停止的迁移预览，首次明确写入才持久化。重载后 managed 一律 stopped。
显式启动允许有界重试；运行中断线等待用户操作。未执行个人数据迁移、部署或提交。

## 本会话证据

- PASS：`node --test test/*.test.mjs`，202/202，无跳过。
- PASS：dsh-remote 相关 UI/record/cache/wire/apply-wire 测试，49/49。
- PASS：本插件全部 lib JavaScript（含子目录）及兄弟 client 逐文件语法，23 文件。
- PASS：dsh-remote `node check.mjs`、`git diff --check`。
- PASS：真实已安装 Cordis Context 加载本插件及 routes、目录重载、卸载租约测试，隔离 DSH_HOME，
  未读取/修改产品 profile，没有启动 GUI。
- PASS：真实 loopback ssh2 server + dsh-remote carrier factory/cache/PTY 组合：多机器共用一个
  connect fixture，SSH 池关闭不停止通道；停止关闭旧 PTY，显式启动才取得新代次。
  SSH wire 为真实网络；devtunnel 进程为受控 fixture，不冒充官方 CLI 实机验证。
- PASS：`npm pack --ignore-scripts`，26 文件；仅 lib、manifest/package、patch、README、MANUAL，
  不含 test/docs/node_modules。
- NOT RUN：实际官方 devtunnel、用户 Tunnel、产品 GUI、产品部署验收。
- NOT RUN：旧 Desktop boot-smoke 脚本（硬编码旧用户应用路径，且本次不运行替代 GUI）；
  已用上述隔离 Cordis 启动测试验证本插件加载。

测试记录：`evidence/independent-channels-tests.txt`、
`evidence/independent-channels-remote-tests.txt`。

打包产物：`/Users/havoc/Documents/Projects/tools/dsh-plugins/dsh-devtunnel-ssh/.dsh/artifacts/channels-v5-q3pt186k/dsh-devtunnel-ssh-0.0.1-experimental.tgz`

npm shasum：`92ad9573bdc62144422fef5ab060ac70d4e049b0`。productionReady 仍为 false。

## 同日 UI 整理

通道列表前置，配置移至底部 details（已配置默认折叠）；缩短说明与按钮文案，统一状态标签、
通道卡片、表单网格和操作区。CSS 限定 `.dvt-panel`，继承主题色，容器宽度不足时切单列。
本轮 202/202 测试通过，全部 lib 语法与 pack 内容检查通过。Headless Chrome 渲染真实组件
静态 fixture，人工检查浅色空列表、浅色编辑表单、420px 容器深色通道列表；无横向溢出。
预览使用模拟数据及 Switch 占位，仅验证布局，不代表实际宿主 GUI 验收。未部署 profile。
预览与本轮测试记录在 `.dsh/artifacts/panel-ui-cgy18v82/`。
