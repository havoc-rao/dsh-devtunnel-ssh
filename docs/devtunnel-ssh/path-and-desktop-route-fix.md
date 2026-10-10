# PATH自动检测与Desktop Settings 404修复（2026-10-09）

用户实机证据：GET dsh-app://app/api/dsh-devtunnel-ssh/settings ->404 text/plain。核对真实Desktop main.ts协议转发以及web-document.ts forwardWebRequest：路径原样保留、cookie由Desktop注入，不strip /api。本插件注册exact /dsh-devtunnel-ssh/settings；client误加/api致路由不匹配。已修统一dsh-remote apiPath和本插件legacy helper为直接插件path，不新增API alias或重试写，不改宿主/profile。

CLI设置现在默认为空覆盖，宿主只读从PATH解析devtunnel；无需填安装路径。解析access X_OK/stat常规文件，有界PATH，忽略空/相对/current目录及其symlink别名/控制字符。可选绝对override优先且失败不fallback。解析不执行shell/which/CLI，不自动安装登录。snapshot cli={status,source,resolvedExecutable}安全投影；UI只读显示真实解析路径，PATH notfound独立于设置API错误。空override+managed授权可保存；notfound能力false，预检HOST_CLI_NOT_FOUND；确认授权和预检仍分别需要。

保持活动managed的解析/starter，不能refresh悄悄改exe；空闲refresh可重新探测。同样解析不重建starter，避免刷新绕过监督器故障预算。设置改动需确认断开+cleanup后才交换。预检只用host解析路径。

UI按404 route/401-403 auth/503设置读或cleanup/网络/响应契约分类诊断，不返回原始正文或秘密。Desktop仍使用原认证forward；不绕RPC /api。

实际证据：
- 本插件全套148/148 PASS，全部lib语法PASS。
- 父会话直接运行父仓UI+Desktop route contract12/12 PASS，check.mjs/diff PASS。
- 并行父仓代理相关63/63 PASS，最终DCF build 1/37注入0错误，源码locator0/部署434；部署apiPath已核实直接return path。
- 本会话只读PATH检测found /opt/homebrew/bin/devtunnel；这不是实际Desktop进程PATH证据，也未运行CLI。
- npm pack隔离cache ignore-scripts22白名单文件PASS，不含docs/tests/个人数据。
- 真实Desktop重启/当前GUI HTTP200、真实CLI版本/通道连接：NOT RUN，须用户重启原npm run dev:desktop:dcf后验收。没有改profile/自动登录/真实通道启动。动态本地端口只读展示仍另一个未完成项。
