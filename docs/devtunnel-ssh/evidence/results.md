# 阶段验证结果（2026-10-07）

环境：控制端 macOS 26.6.2 (25G83), arm64, Node v22.22.0；当前运行权限 danger-full-access（测试没有再次提权）。所有测试均为本机/注入夹具；真实双 Mac SSH-over-private-Dev-Tunnel **NOT RUN**。

| 验证 | 真实结果 | 原始记录 |
|---|---|---|
| 旧快照逐文件与 git HEAD 字节比对 | PASS，62 tracked files；tar 共80条目含目录 | archive SHA-256 见[归档索引](<../../../archive/vscode-bridge-20261007/README.md>) |
| 根旧 Bridge 回归 `node --test test/*.test.mjs` | PASS 25/25，0 fail，exit 0 | [TAP](<legacy-root-tests.txt>) |
| 旧 protocol `node --test packages/protocol/test/protocol.test.mjs` | PASS 37/37，0 fail，exit 0 | [TAP](<legacy-protocol-tests.txt>) |
| 旧 Worker `node --test packages/vscode-bridge/worker/test/*.test.mjs packages/vscode-bridge/test/*.test.mjs` | PASS 38/38，0 fail，exit 0 | [TAP](<legacy-worker-tests.txt>) |
| 新夹具 `node --test packages/devtunnel-ssh/test/*.test.mjs` | PASS 20/20，0 fail，exit 0 | [TAP](<new-fixture-tests.txt>) |
| 新 lib/*.js 与 test/*.mjs 逐文件 `node --check` | PASS，exit 0 | 本轮工具执行记录 |
| CLI version/connect/host/port create help | PASS，真实二进制帮助已保存；版本第一次因 .NET缓存权限 exit159，获批同命令复跑 exit0 | [connect](<connect-help.txt>) / [host](<host-help.txt>) / [port](<port-create-help.txt>) |
| 真 SSH、指纹、SFTP、PTY、关闭 VS Code、未授权拒绝 | NOT RUN | [所需条件](<../README.md>) |
| 完整 DSH 插件装载 / 浏览器 UI / profile安装 / SSH carrier集成 | NOT RUN | 只有命令注册 fixture，没有产品连接入口 |

新20项 = 租约15 + CLI策略3 + 注册2。覆盖并发去重、身份固定/机器隔离、幂等释放、dispose 与 inflight start、无效 endpoint清理、失效旧代租约、失败显式重试、清理失败 fail-closed、禁止参数注入/秘密参数、缺服务安全退出与命令 disposer。

## 明确限制

- `start/close` 注入函数需最终 settle；尚无 AbortSignal/硬时限，不能用本夹具直接管理生产进程。真实端口与 PID 所有权、CLI 输出解析尚未实现。
- 租约只锁定逻辑 target，不验证 SSH host key；新 manager 不代表用户已重新信任。严格信任必须由底座接口实施，不能把 fixture的 machineId 当真实性证明。
- CLI connect 帮助无端口 remap参数，尚不能声称系统22端口可非特权无冲突使用。
- 旧 SSH底座 routePool knownHostsFile缺参是源码观察，未做真实SSH风险复现；应由父侧评审修复，不宣称已修好。
- 未自动停止现有旧 Bridge、未安装/登录、未启用SSH或改防火墙、未修改兄弟仓、未部署替代GUI。

## 持续目标 Round 1：参数边界复核

修复 CLI tunnelId 的 `$` 正则尾换行边界；配置改为读取自有数据描述符，拒绝 getter、未知 symbol、继承字段及 malformed 对象，Proxy trap 异常仅返回固定错误码。新增2项测试覆盖多种行终止符与恶意配置对象。未启动真实进程。

- `node --check` 两个变更文件：PASS。
- `node --test packages/devtunnel-ssh/test/*.test.mjs`：**22/22 PASS、0 FAIL，exit 0**，见[Round1 TAP](<round1-fixture-tests.txt>)。
- 新 SSH Step0、真实CLI/SSH连接及产品装载仍 NOT RUN；整体持续目标保留 active，不能把参数安全夹具等同完整连接管理实现。

## 持续目标 Round 2：自有进程清理合同

新增 [owned-process.js](<../../../packages/devtunnel-ssh/lib/owned-process.js>)，只接受注入的自有 handle（done/terminate），无 PID 查询、无真实 spawn、无进程组实现。幂等 close 发送 TERM，等待超时后最多一次 KILL；信号发送不是退出确认，未观察到真实退出时有限超时失败。原始 adapter 异常不外泄。未来真实 adapter 必须证明 handle 所有权和 done 的退出语义，本轮不能证明真实进程树已清理。

新增7项测试；全套 **29/29 PASS、0 FAIL，exit 0**，语法检查 PASS，见[Round2 TAP](<round2-fixture-tests.txt>)。尚未将此合同接入 CLI start/lease manager；后者对任意永不 settle 的 start 仍无强制取消能力。真实实机门和底座接口缺口保持不变。

## 持续目标 Round 3：组合验证与阶段停止条件

新增[生命周期组合测试](<../../../packages/devtunnel-ssh/test/lifecycle-composition.test.mjs>)，将 injected owned process 与租约 manager 组合：最后一个引用释放才清理；退出未确认导致 CLEANUP_FAILED，后续 acquire 不再重开可能仍占用的端点。无真实 spawn/CLI/SSH。

- 完整新夹具 **31/31 PASS、0 FAIL、exit 0**，见[Round3 TAP](<round3-fixture-tests.txt>)；新测试语法 PASS。
- 归档 SHA-256 再次核查一致，`git diff --check` PASS。
- 连续三个持续目标轮次未获得 B 本次实机操作授权、独立私有 host/CLI登录与 sshd 准备证明、独立SSH指纹；底座公开 SSH carrier 接口仍未实现。新 SSH Step0 保持 NOT RUN，不继续堆叠 mock 来替代实机验收。
- 安全源码归档、公开契约报告及预门槛夹具阶段已经交付；完整连接目标不能宣称达成。持续目标将标为 blocked，等待上述实机条件与父侧底座接口决策，再由用户明确恢复。原计划移动仍待授权。

## 续委派 dlg-20261007-e7a97d7a

用户明确继续，持续目标已resume。新增[用户人工双Mac证据](<user-macos-20261007.md>)，严格区分用户功能性PASS、被中断8MiB非完整性证据及未跑项。完整Step0未放行，但不再将无remap参数误推为本地必须绑定22。

新增动态端口解析、默认external carrier、managed自身child启动管理、前提诊断和显式注入API注册层。实际接口与父侧同步见[adapter合同](<../adapter-contract.md>)；底座未修改。managed固定connect argv、双流独立有界解析、remotePort筛选、startup timeout/AbortSignal、TERM/KILL退出确认，引用计数及generation在carrier层。默认0自动重试，不重放业务。

验证：所有新lib/test逐文件`node --check` PASS；全套 **60/60 PASS、0 FAIL、exit0**，见[续任务TAP](<continued-fixture-tests.txt>)。进程均fake ChildProcess EventEmitter，没有真实个人隧道连接。A真实 `user --help` / `user show --help` 成功，确认show存在及--json选项，未执行真实user show。已有CLI版本基线沿用先前agent执行1.0.2086；B安装/登录/sshd仅用户报告，agent未读取。

### 本轮限制

- 登录结果parser只有fixture文案证据；未知实际输出返回unknown，不据文案猜账号。preflight必须注入runner，runner负责真正取消/输出限额/清理；调用方timeout不能强停任意Promise。
- managed默认node spawn可用，但本轮只跑注入fake；未验证真实输出文案、listener PID所有权或进程树。parser模式来自已记录官方历史样式，本次只收到端口摘要；未知Forwarding语法fail closed。
- external只包裹用户端点，不能观测外部CLI退出；abort/dispose/底座SSH失效处理须协作。release不kill外部CLI。
- API registration显式注入，非静态导入未发布底座API；无manifest/profile部署，无浏览器UI验收。底座validateConnector调用语义仍需父侧最终核对（此模块返回规范化connector，错误throw）。

## 接口同步 dlg-20261007-a0a7bc2f

已只读父侧实际registry源码，严格采用connector.kind=devtunnel（非id）、machine transport=ssh，machine.id稳定；expectedHostFingerprint仅机器SSH字段。更新external/managed/test/runbook，旧无kind配置明确拒绝，不静默迁移。

新增[真实registry组合测试](<../../../packages/devtunnel-ssh/test/base-contract.test.mjs>)，直接import父侧源码，仅本进程registry注册/注销与external lease acquisition，无网络/SSH。验证lease字段、稳定machine与fingerprint不混入connector；父侧实际拒绝useSshConfig/proxy、错误transport、缺machineId；adapter拒绝错误kind/id/秘密字段。

完整独立插件 **62/62 PASS、0 FAIL，exit0**，见[接口同步TAP](<base-contract-tests.txt>)。这是registry+manager真实源码集成，不是端到端CRUD/镜像/PTY/严格指纹网络验收，后者仍未完成。能力检测仍显式API注入，缺API安全降级，未改旧入口/产品profile或连接个人Tunnel。

## Factory合同 dlg-20261007-1c5f2c92

已只读父侧[实验合同](<../../../../dsh-remote/docs/ssh-carrier-contract.md>)与factory实际源码。新增[factory组合测试](<../../../packages/devtunnel-ssh/test/factory-contract.test.mjs>)：直接使用父側实际registry/factory与本仓adapter，SSH Pool注入FakePool，不连接任何SSH。

验证factory拒绝缺fingerprint，强制verify/pin（config off不能绕过），动态host/port使用lease，logical hostKeyIdentity包含machine.id+targetIdentity，pool.close先调用底层close后release，close幂等、失效后connect拒绝。仅验证调用顺序，不证明FakePool真实PTY已清理；真实PTY与严格pin wire证据属于父侧验证，本轮未复跑。

全套 **64/64 PASS、0 FAIL，exit0**，见[factory TAP](<factory-contract-tests.txt>)。注册结果显式`ordinaryWorkspaceReady:false`，能力注册不等于普通工作区ready；不手写registry、不提供raw localhost正式接线替代。CRUD/镜像/all-dial/TTL与terminal引用策略尚未完整，保持gate，不部署。

## 持续目标 Round4：并发取消与晚到资源

补充实际carrier adapter竞态测试：单个并发acquire取消不会取消另一个持有者的共享启动；启动中dispose等待晚到handle并只清理一次，不能交付旧代lease。两项纯注入测试PASS；全套 **66/66 PASS、0 FAIL、exit0**，见[Round4 TAP](<round4-fixture-tests.txt>)。无真实进程/隧道连接。普通工作区gate不变，持续目标仍未整体完成。

## 持续目标 Round5：能力缺失安全边界与阶段汇总

可选API getter抛错现在安全返回ssh-api-required，所有注册状态均明确ordinaryWorkspaceReady=false；新增异常getter测试，避免缺API时拖垮宿主。全套 **67/67 PASS、0 FAIL、exit0**，见[Round5 TAP](<round5-fixture-tests.txt>)；所有lib/test语法与diff检查PASS；归档SHA256再次一致。

五轮自动续跑达到配置上限，目标不标完成：独立管理/解析/external/managed源码与registry/factory组合测试已交付，但真实managed CLI/监听归属、完整Step0和端到端CRUD/镜像/all-dial/终端TTL仍待验证；父侧底座同步不可被本仓fixture取代。目标保持active，下一步需父侧接口集成进展与用户明确授权实机测试，不安装/登录/部署，不读取秘密，原移动仍未执行。
- 新Step0剩余：关闭VSCode、未授权拒绝、完整8MiB、PTY Ctrl-C、无人值守及DSH ssh2认证集成仍NOT RUN/NOT CONFIRMED。原计划移动未做。



