# 工作区连接标记 v1：SSH 与 Dev Tunnel 特化

## 职责

- dsh-remote 是工作区绑定/SSH 状态的 producer，既有 GET /dsh-remote/status?sessionId=…&cwd=… 新增 additive connection。
- dsh-devtunnel-ssh 是 Dev Tunnel consumer，独立提供 tunnel 状态；使用既有 conversation.session.header.utilities，不修改 dsh 壳。
- 不迁移机器/镜像数据，不更改 targetIdentity，不修改产品 profile，不部署或重启桌面。

## 摘要

```js
connection: {
  schemaVersion: 1, scope: 'workspace',
  binding: 'local' | 'bound' | 'unavailable',
  machineId?, name?, protocol?, path?: 'direct' | 'carrier',
  carrierKind?, mode?, targetIdentity?,
  carrierTarget?: { tunnelId, remotePort, channelId? },
  ssh?: { state: 'connected' | 'disconnected' | 'unknown' }
}
```

local 只含版本/作用域/绑定。bound 使用 machineForMirror 的严格身份解析。孤儿镜像、目标不匹配是 unavailable，不借用全局当前机器。SSH 状态仅在实际 mirror context 与解析 machine 匹配时读取现有 pool；不创建 pool、不拨号。摘要不包含凭据、私钥、pin 或临时 localhost endpoint。旧 status 字段保持兼容。

Dev Tunnel 是 `protocol:'ssh', path:'carrier', carrierKind:'devtunnel'`，不是普通 direct SSH。真实 schema-3 carrier 镜像保留 machineId + connectorTargetIdentity；transport=ssh 不意味着 direct。

## 特化展示

- 隧道 ready：Dev Tunnel 隧道就绪；与 SSH 已连接/未连接/未知分别展示。
- recovering/starting/stopped/error：对应隧道状态，不暗示 SSH 认证成功。
- external：外部管理（未验证）；不探测或控制用户进程。
- 已确定 Dev Tunnel 身份而 /channels 失败：状态未知，保留 chip。
- 显式 channelId 缺失：missing，不偷偷匹配同目标别的通道；目标变更：unavailable。
- 旧宿主缺少 connection 字段：兼容 resolve-mirror + machines 元数据读；存在 connection 但 local/unavailable/不支持版本时禁止 fallback。
- 不依赖 Git 仓库或 Git 成功，不参考全局机器；按 sessionId/cwd 每 10s 不重叠查询，切会话/工作区立即隐藏旧状态，卸载结束轮询。

## 本轮证据

- 本插件 node --test test/*.test.mjs：PASS，229/229（含真实 producer→consumer 组合）。
- dsh-remote 新10项摘要测试 + 相关43项回归：PASS，53/53。
- dsh-remote node check.mjs、相关源码 node --check、git diff --check：PASS。
- dsh-remote 隔离 boot-smoke：NOT RUN；脚本前置检查失败，硬编码桌面 harness 入口不存在，未启动实例。
- 真实 Tunnel/真实 GUI：NOT RUN；源码实现不等于部署或实际渲染成功。
- dsh-remote 全量 npm test：930项，921 PASS / 1 FAIL / 8 SKIP。唯一 FAIL 是 docs-images 截图裁边测试：系统 python 缺少 Pillow（No module named PIL）。未安装依赖、未改系统环境；不宣称全量通过。
