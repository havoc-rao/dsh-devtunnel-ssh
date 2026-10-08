# 最终实验交付复验（dlg-20261007-99ba5e43）

父侧最终audit更新后，本仓完整source组合suite **83/83 PASS、0 FAIL、exit0**，见[TAP](<evidence/final-audit-tests.txt>)。新增async pool.close完成前不release的真实factory+本仓adapter组合断言；只FakePool无真实SSH。全部package lib/test语法与diff检查PASS。

既有[实际实验tgz](<../../.dsh/artifacts/dsh-devtunnel-ssh-0.0.1-experimental.tgz>)14files逐个tar字节与当前package源码/manifest/README/MANUAL比对一致，新增test不入包，因此无需重打。SHA256仍 `dacec4eb229eccd38d645548b2ca9e8ac8396ca4a23603df1b97f6ec83c51487`。严格允许清单检查无secret/cache/profile/test/archive，未部署。

交付范围：独立实验可装配插件、status/help用户命令、external完整手册、managed安全函数（入口not enabled）、前提诊断合同、认证status capability parser、carrier/canonical identity及真实底座registry/factory/cache/record/apply/status组合tests。源码完善与实验接线已交付，不能标成只fixture，也不能等同生产GUI。

父侧strict orphan reconnect/no fallback、invalidate、nullconnector presence fence属父侧audit修改，本仓全source回归未受影响；本轮不声称逐项个人Tunnel实测。asyncClose顺序本轮直接覆盖。

真实sandbox安装/当前GUI接线需另授权，CLI安装/登录/sshd服务不自动执行，不读取个人key/agent/cache。剩余完整Step0、宿主凭据可达性、真实CLI listener所有权/文案和managed审批config为验收/后续核心；普通生产ready=false。旧Bridge归档与入口保留，跨workspace计划移动未做。
