# 已保存机器的通道复用修复

## 原因
carrier 以 machineId 分享租约，managed supervisor 以 Tunnel ID + remotePort 防止重复启动。
旧客户端提交 probe draft 不带机器 id，host 因此生成临时 machineId；同目标已有托管通道时，新身份请求触发 CONNECT_TARGET_BUSY。

## 修复
- 已保存且未改的机器：client test-connect 仅提交 `{id: form.id}`。
- Host 从保存记录完整解析 connector、user、auth 与 pin；带 id 和任何额外 draft 字段明确拒绝。
- 已保存机器存在未保存修改：阻止 probe，不静默使用旧配置。
- 新机器：完整有效草稿、临时身份，仍独立探测。
- probe 使用独立 SSH pool，但以保存机器 id 获取共享 carrier 租约。
- probe 成功、失败、取消只释放自身引用；现有业务租约保持有效。最后一个拥有者释放才停止 CLI。
- 不共享 SSH 会话，不改变 pin，不重放业务，不撤掉 CONNECT_TARGET_BUSY 的不同机器保护。

## 实际验证
本仓 `node --test --test-timeout=30000 test/*.test.mjs`：199 PASS / 0 FAIL，exit 0。
新增 `test/probe-reuse.test.mjs` 使用真实 carrier + supervisor 验证旧临时身份重现 BUSY、稳定身份复用同代通道、probe/取消不停止业务租约。
双 bundle 组合测试新增保存机器发稳定 id、dirty draft 不再发 probe 的回归。
兄弟 dsh-remote 委派会话报告：818 tests，816 PASS / 0 FAIL / 2 SKIP（bundled Python），node --check/check.mjs/diff --check PASS。
生命周期测试的 SSH/CLI 是测试桩；未执行个人远端连接。

## 生效范围
本次修改 dsh-remote 源码，尚未同步其 dev-harness/deploy-pkg，也未重启宿主。
运行 profile 若指向 deploy-pkg，需要按该仓当前 AGENTS.md 的 sync-profile.sh 重建，随后重启宿主及刷新页面。
