# 开发诊断读取 API

## 通道事件（本插件）

`GET /dsh-devtunnel-ssh/diagnostics?after=0&limit=20&machineId=mac-mini`

同源宿主认证，GET-only/no-store，不启动任何 CLI/SSH 操作。
`machineId` 可省略；`after` 为事件 seq 游标（默认 0）；`limit` 为 1–20（默认 20）。
未知或重复 query、非法机器 ID、越界/负数参数返回 400 DIAGNOSTICS_QUERY_REJECTED。

响应保留原来的 `{ok, revision, entries}`，新增：
- `scope: managed-channel-events`，明确它不是 SSH 认证结果；
- `pagination: {after, limit, nextAfter, hasMore, oldestSeq, truncated}`。
使用 `nextAfter` 增量读取；`truncated=true` 表示该游标之前的部分事件已经离开内存环。
当前只保留 20 条事件，重启或插件重载后清空，不存在原始输出或历史磁盘日志。
`machineId` 过滤仅命中带该字段的租约事件；不带 machineId 的 CLI 启动事件需不带过滤读取。

浏览器示例：
```js
const response = await fetch('/dsh-devtunnel-ssh/diagnostics?after=0&limit=20', {
  credentials: 'same-origin', redirect: 'error'
});
console.log(response.status, await response.json());
```

## SSH 探测时间线（dsh-remote）

`GET /dsh-remote/probe-diagnostics?after=0&limit=50&machineId=mac-mini`

同源宿主认证，GET-only/no-store。`machineId` 精确过滤可省略；`after` 默认 0；`limit` 为 1–200。
响应：`{ok, events, latestSeq, oldestSeq, nextAfter, hasMore, truncated, retention, retainedProbes}`。
每条 event 含 `seq, probeId, machineId?, event, at, elapsedMs, phase, code?`，还可含校验后的
loopback `endpoint` 与 `generation/reusedGeneration`；单次测试响应会附带 `probeId`。
最多保留 200 条事件/20 次测试，重启或插件释放后清空。

阶段：`probe.start → carrier.acquire.start/complete → pool.connect.start → ssh.identification →
ssh.handshake.complete → ssh.ready → exec.start/complete → probe.success/failure → pool.close.start/complete`。
原始 ssh2 debug 只在内部用固定前缀识别阶段，随即丢弃，不被存储或下发。
若未出现 `ssh.identification`，不能断言已收到远端 SSH 标识；已出现 identification 但无 handshake.complete，
说明握手未完成；handshake.complete 后无 ssh.ready 则尚未到认证就绪。

本轮仅源码交付，未同步 dsh-remote deploy-pkg 或重启宿主；使用新API前需要重建并重启。

## 层级边界

CONNECT_READY 只表示本地转发端点已宣布，不等于远端 sshd 可达、更不等于 SSH 认证成功。
`Timed out while waiting for handshake` 需要 SSH 探测时间线才能进一步归因；不能直接说是公钥错误。
SSH 引擎在 dsh-remote，详细探测日志 API 由其提供，不在本插件复制 SSH 引擎或抓取凭据。

所有读取接口遵循宿主既有认证边界。不读取 cookie/token/cache/privateKey/agent。
不暴露原始 ssh2 debug、banner、handshake 对象或原始异常，只提供白名单结构化阶段。
