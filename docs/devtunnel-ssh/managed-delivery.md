# A侧 managed 通道源码交付（2026-10-09）

## 实现

- host Config `managedEnabled` 默认false，`cliExecutable` 空或非绝对路径不启用。明确授权后注册carrier managed能力；加载/保存不运行CLI或预检。
- `startManagedConnect` 仅spawn官方明确Tunnel ID，shell=false；按remotePort解析loopback动态端口。长时间输出流不触发累计字节配额误杀，仍限制单行/待解析buffer及启动总量。进程退出/端口映射变化令旧endpoint立即失效。
- `createManagedStarter` 按tunnelId+remotePort共享故障预算。仅退出/启动timeout重试，0.5/1.5/4秒退避；4次不稳定故障耗尽，稳定30秒后惰性reset。取消与主动释放不计故障，无租约时不后台重连。安全/输出/spawn错误不重试，cleanup失败禁止复启同目标。
- carrier旧generation闭合后等待cleanup，后续acquire取得新port与generation；不会修改旧lease或重放SSH请求。父pool/cache沿用闭合后按需重建契约，严格pin不变。
- dsh-remote统一RemoteSettings增加external/managed选择，精确authenticated `sshCarrierCapabilities.devTunnelManaged===true`门控。managed保存不含endpoint并隐藏本地port输入；remotePort默认22仍应确认。B侧host不在托管范围。
- external兼容，不杀用户自己的CLI进程。同目标不同machineId不同时启动第二个托管进程，报告busy。

## 本会话实际证据

| 验证 | 结果 |
| --- | --- |
| `node --test test/*.test.mjs` 本插件最终全套 | PASS，119/119，0 skip/失败 |
| 逐文件 `node --check lib/*.js` | PASS |
| 本插件 `git diff --check` | PASS |
| 父仓 `node check.mjs` / `git diff --check` | PASS |
| 父仓 unified client + managed contract 两测试文件 | PASS，9/9 |
| fake supervisor +真实父pool/cache组合 | PASS，保持pin/新port-generation/不重放exec |
| `npm pack --ignore-scripts` 隔离tmp cache | PASS，18文件，仅lib/manifest/patch/README/MANUAL |
| 默认npm cache打包 | FAIL（EPERM，cache不可写）；未修用户cache，改隔离临时cache成功 |
| 官方CLI / GitHub登录 / 真实Tunnel / B-side host | NOT RUN |
| 当前GUI部署/浏览器验收/睡眠恢复/真实SSH | NOT RUN，本会话未部署 |

并行父仓代理另外报告其更广测试43+38通过/2个OS凭据后端不可用跳过；最终补充契约22通过。该报告属代理执行，不冒充父会话直接执行。父仓原有tree-scroll相关工作树变更保留。

## 启用与剩余验证

部署另行授权。实际宿主须启用dsh-remote experimentalSshCarrier，再配置本插件 cliExecutable + managedEnabled:true；status能力确认后，在原机器卡同目标同pin切换托管、保存、测试。不把新port写入机器配置。budget/安全封锁需排查后显式reload插件才重置监督器；不承诺无缝恢复旧PTY。

需继续实机核对CLI输出版本、动态port、连接断开/网络失败、系统睡眠恢复、删除/卸载进程回收以及现有GUI路径。productionReady仍false。
