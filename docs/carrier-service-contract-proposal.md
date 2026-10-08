# Desktop carrierUnavailable根因与最小合同（dlg-20261008-e43054b9）

已读独立entry/tests，实际独立source loadCarrierApi默认返回false复现。Node dynamic import按entry realpath独立目录解析peer，profile里的dsh-remote link不在独立source祖先node_modules，optional peer不存在导致捕获并永久ssh-api-required。测试之前注入source API并未覆盖真实profile resolver。

不能固定绝对fallback到../dsh-remote/source：Desktop可能运行deploy-pkg另一模块实例，module-global registry将分裂，注册成功也不会被真实UI/status消费。不能在本任务写用户node_modules/profile或重启。

## 最小建议：底座公开reactive context service（需父侧实施）

提议服务名 **dshRemoteSshCarriers**（待父/host确认，不假称现有）；由真实运行的dsh-remote apply `ctx.provide` 提供：

```js
{ apiVersion:1,
  registerSshCarrier, sshCarrierOf, sshCarrierIds,
  // 上述函数闭包必须直接引用该运行实例原registry，不复制new Map
  experimentalWorkspaceSupported: () => !!config.experimentalSshCarrier
}
```

独立插件 `ctx.inject(['dshRemoteSshCarriers'], inner=>{ const api=inner.get(...); const registration=registerCarrierWhenAvailable(api); inner.effect(()=>()=>registration.dispose()); })`，inject子fiber保证服务晚出现时注册、撤销时注销/lease失效、重新提供时注册新运行实例。commands应使用动态状态对象，不固定启动时registration变量，不把等待service当永久失败。可选静态API loader不作为主要注册路径；无service则明确等待底座，不fallback私有source。

已读真实Cordis inject实现（创建依赖plugin fiber）与provide lifecycle，需实测late provide/unload/re-provide，包括真实Desktop上下文多provider冲突。服务namespace可另定，必须父侧公开后再接入production entry，本轮只合同/测试。

建议验收：同一runtime namespace，late-order reactiveness，provider unload取消注册/已租约，reprovide新namespace，不触CLI。host resolver如有正式root resolve接口可以另一方案，但本任务不猜。当前tgz不修改，不重新部署；服务未实施前不会假修载入。
