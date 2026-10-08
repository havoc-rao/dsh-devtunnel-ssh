# Record pure gate组合验证（dlg-20261007-aa5676ab）

只读核实父侧normalizeCarrierMachine实际源码，source-only测试，不把record模块当公共API。[父侧exports](<../../../dsh-remote/package.json#L28-L35>)尚未包含record；普通CRUD gate保持不启用。

新增[record组合测试](<../../packages/devtunnel-ssh/test/record-contract.test.mjs>)直接import父侧source，注册本仓真实adapter后调用纯normalizer，无文件写入/SSH/network：

- external.endpoint 50736->64894 / IPv4->IPv6 canonical相同；改managed仍同目标（active lease依然可拒绝活跃期配置变化）。
- 更换tunnel/remotePort拒绝原地更新；pin改变要求显式re-trust。
- connector自填targetIdentity/token/password拒绝；adapter白名单不接受秘密。
- 顶层host/port/generation/connectorTargetIdentity/schemaVersion伪造值不进入输出；canonical调用def纯函数计算，schema3不是用户身份声明。
- SSH密码/passphrase/privateKeyPath/useAgent保留在机器认证层，未进connector。测试都是合成字符串；无真实秘密读取。normalizer返回认证字段不等于对浏览器安全：未来保存/凭据后端与registry sanitize仍需底座处理，不能将normalizer输出直接发browser/log。
- useSshConfig/proxy混搭拒绝。

全套 **74/74 PASS、0 FAIL、exit0**，见[本轮TAP](<evidence/record-contract-tests.txt>)。未修改父侧registry、record、CRUD/UI；普通工作区ready=false，无部署/个人Tunnel连接。此证据仅building blocks组合，不放行实际机器保存、schema3绑定或镜像/终端生命周期。
