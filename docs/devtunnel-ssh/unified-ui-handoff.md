# 统一RemoteSettings交接（dlg-20261008-9bac9503）

用户要求改为父dsh-remote现有RemoteSettings机器卡，本仓已删除独立settings.section注册，legacy client apply为noop、inject=[]；manifest删除dsh.client renderer注入。不触父文件/产品profile。./client export保留纯helpers fixture与兼容代码，不被manifest自动装配；没有新增renderer dependency，host依赖Schemastery/Cordis仍必需。

保留独立host carrier、Config.cliExecutable、reactive webServer预检route、status/help。父UI预检应走真实端点：**POST /dsh-devtunnel-ssh/preflight**，不是/dsh-remote/preflight；dsh-app需/api前缀沿父helper。请求{confirmed:true,checkLogin:boolean}，不可executable/token；同源宿主认证，固定host配置路径，缺路径409，未知login schema仍null/unknown，不passed。不自动login/install/managed。

README/MANUAL已指向统一RemoteSettings，实际父卡接线/GUI验收属父侧。本仓全tests97/97 PASS、0FAIL exit0；无额外settings注册断言、manifest无client自动注入及host route tests正常。syntax/diff PASS。

实际tgz17files22354bytes逐文件源码/允许清单一致，SHA256 b538fe3eed7783c74e8310c4e8070d5c8a1bc287aa552b9c151416c4ea0a9d62。无secrets/test/profile。未安装GUI/重启/个人SSH，旧Bridge不变。
