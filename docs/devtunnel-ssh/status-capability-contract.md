# 当前实例能力检测（dlg-20261007-ac1ad5cd）

已只读父侧/dsh-remote/status真实返回sshCarrierCapabilities shape：apiVersion1、experimentaltrue、workspaceSupported/freshProbe取当前apply Config.experimentalSshCarrier、schemaVersion3、authModes agent/private-key、productionReady/additionalForwards/perWorkspaceDisconnect false。

新增[detectCapabilities(status)](<../../lib/contracts/capabilities.js>)仅解析通过宿主既有认证GET status的JSON，不发请求、不绕过认证、不用registry推断。缺失/未知版本/畸形/非true值返回experimentalWorkspaceSupported=false；正常optin=true返回true，production始终false；额外能力继续fenced false。

实际apply route组合fixture分别创建optin true/false实例，调用GET status并使用parser，证明实例Config检测而非module registry判断；3个parser单测包括恶意getter/未知版本/生产伪升级。全套82/82 PASS、0FAIL exit0，见[TAP](<evidence/status-capability-tests.txt>)；语法/diff PASS。fake ctx已绕过真实HTTP/auth，仅验证handler契约，不证明浏览器认证/GUI验收。

插件暂无client，status命令不能自动取得已认证status数据，入口仍声明未查询实例能力；集成方应通过正式宿主请求status后调用parser，不硬编码registry支持。不增加无认证后台HTTP请求或猜端口。runtime是否experimentalWorkspaceSupported以实际status为准；公开字段不是实际SSH/GUI验收或production ready。

父侧报告671pass0fail2skip是父侧执行结果，本仓不复述为本轮agent测试；真实wire route尚pending，不记PASS。普通GUI/宿主credentials/剩余Step0 gate保留，无部署个人Tunnel。
