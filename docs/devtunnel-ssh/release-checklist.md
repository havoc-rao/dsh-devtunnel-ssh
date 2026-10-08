# 实验接线 release checklist（dlg-20261007-800928a9）

## 状态分层（不把实验能力等同生产ready）

1. **carrierPluginPackable：已验证**。独立manifest/patch/entry，本地npm pack dry-run成功；不表示已安装。
2. **experimentalRoutesImplemented：源码组合已验证**。父侧experimentalSshCarrier显式opt-in下机器CRUD、canonical rotation/reject target-pin、schema3 mirror、fresh probe、factory/cache/卸载测试通过。本仓79 tests含上述无网络route fixtures；不是只有registry building block。
3. **experimentalWorkspaceSupported（当前运行实例）：unknown / 未公布**。没有可供本插件查询实际宿主Config opt-in的公开API；registry注册不能推定opt-in为true。安装本插件也不打开底座配置。
4. **ordinaryWorkspaceReady / productionReady：false**。真实GUI、真实DSH宿主凭据/个人Tunnel、完整Step0与所有业务入口验收仍缺。父侧本轮full suite/local SSH apply wire应引用其最终结果，不能把“将跑”写成PASS。

## 最小公开能力合同建议（尚非已有API）

```js
// 由dsh-remote当前apply上下文提供，只读；非全局registry猜测
getSshCarrierCapabilities({ workspaceId? }) => {
  apiVersion: 1,
  experimentalWorkspaceSupported: boolean,
  experimentalOptIn: boolean, // 当前实例真实Config值
  routes: { machines: boolean, probe: boolean, mirror: boolean, terminal: boolean },
  carrierKinds: string[],
  productionReady: false
}
```

只有当前实例真实opt-in=true且相应入口接线完整时才experimentalWorkspaceSupported=true；未提供API则unknown，并明确已完成源码实验routes。必须避免多个ctx实例共用module registry而误报另一实例已启用。接口不含账号/endpoint/密钥；status命令后续查询而不缓存启动值。父侧可先只公开instance opt-in+routes，workspaceId可选，权限沿正式宿主机制。当前插件不擅自动态import假定的capability函数。

## 安装前提与sandbox阶段

- 两端官方CLI已安装，用户人工GitHub登录；B授权系统sshd/账号，私有ACL与独立确认pin；A是DSH host所在地。
- 底座实际安装版本提供public carrier注册/targetIdentity/factory及实验route能力；正式最低版本待父侧发布，不以peer `*`声称所有版本支持。
- 隔离DSH_HOME/profile，用户明确许可后按[sandbox API流程](<sandbox-api-acceptance.md>)装配；experimentalSshCarrier默认false，另行opt-in。现GUI未修改。
- external用户前台CLI提供当前端点；rotation显式update。SSH_AUTH_SOCK/私钥仅由宿主正式机制授权，OpenSSH成功不是ssh2权限证据。
- 插件加载/注销/运行时能力查询、GUI实际route调用、错误反馈和工作区绑定须验收；本轮fake启动不是GUI验收。

## 达成用户目标仍需的核心功能/验收

- 当前实例公开opt-in/capability探测，不能以registry推定workspace支持。
- 真实隔离宿主装配并从agent/files/terminal入口验证跨机器SSH/SFTP/PTY；完整all-dial fence与hostless Git/tools/端口转发逐项证明。
- 前提诊断runner的真实host-local取消/输出限制/权限接线；目前run注入合同，不是可用GUI诊断按钮。
- managed宿主受控CLI绝对路径/配置/审批接入；目前函数可用、入口默认external无managed配置入口。真实转发输出/监听PID归属/退出清理尚未跑。
- 已有用户人工SSH/256KiB/resize证据；关闭VSCode仍可用、未授权拒绝、完整8MiB、PTY Ctrl-C、睡眠与退出生命周期仍需补齐，不能安装器替代门。
- 凭据与fingerprint真实验证、更新/delete/unload对活动terminal语义，生产不能靠FakePool证明。

## 可后续生产/UX优化（非实验external最小链路阻断）

完整图形向导/自动发现列表、受控安装帮助、支持矩阵扩展、更多CLI文案兼容、可观察日志/诊断导出、非秘密健康统计、有限自动重连策略（当前0预算是安全选择）、无人值守后台服务（不作首版承诺）。managed自动化若用户明确目标为插件管理connect则属上段核心，不能永远标后续。

## release操作边界

未生成/安装产品profile，未自动CLI安装/登录/服务变更，不卸载旧Bridge。private实验包允许本地pack而不发布npm。原跨工作区计划移动尚未执行，待授权。此checklist是交付收敛，不冒充已生产release。
