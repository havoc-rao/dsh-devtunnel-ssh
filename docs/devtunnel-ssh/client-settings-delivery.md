# 日常external设置入口源码交付（dlg-20261008-2304e36a）

核实公开实际契约：兄弟dsh-remote classic client使用window.__ModuleLoader__.load({id,factory(require)})、require('react')、slots.inject/register settings.section，manifest client export/dsh.client.inject web；本插件同样实现，不静态import底座私有模块。核实兄弟API helper按web同源fetch、dsh-app加/api前缀，不在请求中读cookie或token；宿主web scaffold说明正式登录交换session cookie（本插件不执行/读取交换秘密）。

新增[client.js](<../../packages/devtunnel-ssh/lib/client/client.js>)：独立Dev Tunnel SSH设置区，真实status instance opt-in gate，前提人工确认，stable id/name/B username、explicitTunnel/remotePort、独立SHA256 pin、agent-only、当前IPv4/IPv6端口，external add/update；编辑锁目标/pin/id不原地换信任。machines列表/delete确认、fresh test-connect、明确remotePath+local workspace后mirror确认。保存不激活；hostless descriptor；无密码/token、无managed启动、无自动Config opt-in、无mutation retry。

API封闭路由允许list，同源credentials和redirect:error；401/403显示正常登录要求，不绕认证/读缓存。错误仅固定公共消息；React文本渲染无innerHTML。前提诊断目前人工checkbox+真实能力/fresh probe，不读取CLI登录cache；实际CLI诊断runner仍待受控host接线。

4个新增classic loader/API/form/capability tests PASS；全套87/87 PASS、0FAIL exit0，[TAP](<evidence/client-suite-tests.txt>)。fixture调用真实client factory与request/form纯组件边界，不是真浏览器render/click/e2e。未修改宿主或产品profile、不启动GUI。

新manifest client export+inject renderer web。实际包重打：15files18,490bytes，SHA256 `54c7d9a6ef995cad3d56cd9922e77e27b4702c65e5c93bf089289b110f88929d`，每文件tar字节与当前源码比对，严格lib/README/MANUAL/manifest/patch allowlist无秘密。[tgz](<../../.dsh/artifacts/dsh-devtunnel-ssh-0.0.1-experimental.tgz>)原同名实验产物已更新，历史hash不再代表最新包。

下一步需用户授权**隔离DSH_HOME/profile安装并加载真实client**，使用宿主正式认证URL，确认loader/settings显示、optin gate、add/update/probe/mirror/delete交互与SSH_AUTH_SOCK权限；不能通过另起GUI假装现GUI已更新。用户报告A55981/此前pin与agent/SFTP/PTY成功是用户证据，本轮无个人Tunnel连接。生产Ready false，managed入口disabled，剩余Step0/全业务入口实际验收未完成。

局限需实际GUI复验：mounted web路径与dsh-app端协议参照底座helper但不作全prefix支持声明；表单明确local workspace而非猜active session，不自动切换会话；编辑user/auth变化及delete会影响pool，需明确用户反馈。普通remote日常external入口源码已推进，不等同生产GUI可用。
