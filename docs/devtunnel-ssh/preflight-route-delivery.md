# 实际本机预检runner/route接线（dlg-20261008-17d58da8）

独立插件新增reactive ctx.inject(['webServer']) route POST /dsh-devtunnel-ssh/preflight，由宿主既有webServer认证路径承载；未额外监听HTTP、不绕认证。已读真实WebRoute契约，effect注册disposer。入口config.cliExecutable是用户明确配置的绝对CLI路径，缺路径409，浏览器禁止传路径/任意argv，缺webServer不崩。尚未加入Schemastery Config编辑schema，隔离profile raw config接线需确认loader保留此字段，不能声称设置路径GUI已可用。

runner用node child_process hostSpawn，无shell、stdin ignore，仅允许--version和user show --json，不通过ctx.subprocess（可随远端filesystem变化）。固定5s超时，64KiB stdout+stderr上限，TERM后500ms KILL有界，返回stdout/stderr仅内部parser，不下发route；未知/超限清空。权限授权依据绝对host配置+显式点击confirmed，双端安装/登录仍人工，不启动managed/host/connect。

client新增A本机CLI版本预检及单独登录JSON确认按钮；同源credentials/redirect:error，固定可信route路径，无token/cookie读取，无mutation自动重试；B暂manual。JSON个人账号schema未获官方或用户脱敏真实样本，不猜loggedIn/provider/accountLabel；现阶段固定null/unknown/null，原始输出绝不返浏览器。需要父/用户给脱敏正式JSON schema或官方定义后实现准确login白名单；这项功能明确未知，非假成功。

新增3个fixture：fixed runner默认no-login/显式JSON原文脱敏、output cap自有child终止、reactive route确认与浏览器executable拒绝；全套90/90 PASS（参见TAP），syntax/diff PASS。未实际执行个人CLI预检、未HTTP/GUI/登录/读cache/keys。

实际实验包更新17files20,449bytes，SHA256609e4fa4027e99ccf96312bc05cd50a0aeb92abeb46788c1253436b2da39ed15。无profile部署，普通productionReady=false。runner仅自身child，不做进程树证明；若KILL后未确认退出返回unknown，不写退出PASS。后续需真实隔离装配/宿主Config schema/认证route可见性/超时race E2E。
