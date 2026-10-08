# Canonical descriptor 与 race 验证（dlg-20261007-ee63417b）

## 持久身份合同建议

已实现def.targetIdentity(connector)纯函数，输出JSON数组：

```text
["devtunnel-target-v1", kind, tunnelIdIncludingCluster, remotePort]
```

排除mode、external.endpoint、generation、machineId及认证。tunnelId按现有规范是精确小写显式字符串，可带.cluster；换cluster/remotePort变身份。未新增独立cluster字段或忽略cluster的归一化，不推定无cluster ID等于某cluster。

connector仍严格白名单，拒绝用户自填targetIdentity；底座应从registeredDef.targetIdentity(saved.connector)计算canonical descriptor并与schema3.connectorTargetIdentity比较，**不是saved.connector.targetIdentity**。mirror持久descriptor与machineId各存独立字段；机器身份/认证revision归底座。

当前runtime lease.targetIdentity仍为旧数组[devtunnel,machineId,tunnelId,remotePort]，不在本轮擅自更换已验证的pin/trust命名空间。建议父侧明确统一版本后将runtime改为同descriptor，logical trust由底座再加machine.id；这属于显式兼容/重新信任设计，不能静默迁移。纯函数已挂def，测试验证endpoint/mode不变、cluster/port改变、拒绝自填身份。

## external lifetime 审查

external.closed不是外部CLI实际退出观察；共享entry只有最后release/dispose才settle。单个lease release/abort立即令自身dial getter STALE；如其他引用仍持有entry，则shared closed可能仍pending。**父侧factory新增signal监听是必要的**，确保被abort的pool即刻关闭而不等待shared closed。dispose则所有entry.closed settle，factory监听关闭所有pool；本轮实际factory+adapter测试证明新connect拒绝。

已拨出的SSH连接不会仅因dial getter变STALE自动停止，必须factory signal/closed处理。当前factory.close同步调用底层close后release；真实pool.close必须关闭全部PTY，TTL/引用策略仍gate。测试用FakePool只证实调用顺序，不能证明真实PTY进程结束。

## managed 审查

startManagedConnect固定无shell argv，stdout/stderr独立parser，匹配remotePort，累计256KiB/行4096上限；unknown Forwarding候选、stream error/超限、startup timeout都清理自有child并拒绝，不fallback。双流碎片不能拼ready，测试已有覆盖。关闭只能证明child退出，不管理未知进程/进程树。未知实际CLI文案不会被猜测支持，真实CLI集成仍NOT RUN。

## 真实源码组合race tests

直接读父侧registry/factory，未修改兄弟源码。新增：stale getter仍release；factory创建后abort关闭；底层close抛错仍release且connect拒绝。全套71/71 PASS，FakePool无SSH/network。普通工作区UIgate保持false，未部署/个人Tunnel连接。
