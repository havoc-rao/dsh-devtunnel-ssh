# Host Loader peer namespace修复（dlg-20261008-798de538）

按Host已核实公开合同，entry applyWithLoader选择显式load优先；否则ctx.get('loader').import('dsh-remote/lib/ssh-carrier.js')，绑定loader this；无loader才原裸import安全unsupported。Host实际profile基址诊断resolvedAPI===deployedAPI是Host证据；本repofake Loader精确返回namespace注册/dispose验证，不冒充Desktop已重启。

无绝对source fallback，无私有resolver/service新设计，无profile依赖/node_modules修改。先前context service提案被本方案替代，未接entry。

独立全suite100/100 PASS、0FAIL exit0（97原tests+1先前service提案+2新Loader tests）；entry syntax PASS。版本0.0.1-experimental不变，hashartifact用于准确指认。17files22506bytes真实tar允许清单/源码字节PASS，SHA256 af3d6e2891ee5186aacc4dfe88d4db1ba6c71854295b40ffe0b9725bea431f96。

Desktop link指独立source时需父/用户按授权重启/热重载验证注册，**本会话没有重启**。status carrierUnavailable修复代码已落，运行实例还需实际核对。旧子包是deprecated回退副本，不同步entry，以免继续双树运行；UI统一RemoteSettings，生产限制不变。
