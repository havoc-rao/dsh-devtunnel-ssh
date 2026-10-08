# External重启日常UX复核（dlg-20261008-e212adc6）

具体bug：编辑当前端口/用户后按probe仍只发保存machine.id，实际会测旧端点并让用户误信新表单通过。已增加unsaved connection gate，端点/用户名/agent变化先显式保存后才能probe/mirror；save重置lastprobe。当前保存target/endpoint和lastprobe明确展示；编辑锁stable id/tunnel/remotePort/pin，新Tunnel目标必须点击新机器。

固定agent认证提示明确，save私钥路径清空避免原记录privateKey+agent暗混（本GUI不读私钥）；useAgent:false旧记录需明确save转换再probe。probe仍只test-connect，不修改机器/不重试。错误分类仅已知白名单：宿主认证/CLI路径缺失/SSH信任/agent认证/endpoint不可达/能力缺失/新信任要求，raw错误未上屏。未知登录态维持unknown，缺配置明确预检未执行，不能passed。

新增两项tests，全suite95/95 PASS、0FAIL exit0；client复跑6/6 PASS，语法/diff PASS。实际settings render/click尚未本agent执行，用户确认隔离设置区出现为用户证据。新Tunnel具体ID/57680归属和probe未确认，不拨号、不填PASS。

源改后实际包更新17files21877bytes，SHA256bfca6d786b6f301a01d391ae5da07e1a3fd1534d4f103405b4a6e033c71d6d92，允许清单与每文件源码比对PASS。无profile/currentGUI读写、无个人CLI/agent访问。生产ready=false。
