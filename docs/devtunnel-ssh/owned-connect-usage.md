# 插件管理 connect 的使用路径修复

2026-10-09 用户截图现有机器external（本机端口54432）且managed按钮disabled。后端已经支持插件spawn/监督connect，缺口是已有机器编辑界面被!!form.id锁住mode。

修复范围：同Tunnel ID、remotePort、pin不变可切external/managed；模式保存确认将失效旧连接，connector managed无endpoint，不能沿用external端口；已授权的新DevTunnel默认managed，不擅自启用全局授权。测试成功提示不能宣称旧form port为实际托管端口。host正常canonical identity不会因mode而改变，保存需清理pool。这不是要求用户人工启动connect。

插件负责运行DSH的A侧connect：通过明确Tunnel ID shell:false spawn子进程，匹配remotePort的实际loopback转发输出，refcount所有者释放前持有；最后release/卸载TERM必要KILL等待exit。退出使旧generation/pool失效；下次请求受控退避重新acquire。测试使用短生命周期probe释放后会停通道；真实工作区pool持有时才持续；保存机器或全局设置不启动，不做无人使用的永驻/开机daemon。B的host仍由B用户维护。

新增本插件组合test managed-owned-connect：实际owned adapter+supervisor+carrier（fake spawn，非realCLI）证明注册不spawn、两个owner共享一次connect、真实argv明确Tunnel ID、使用期间不kill、最后owner释放SIGTERM、下一acquire新generation、卸载SIGTERM。本会话完整tests149/149 PASS。父会话直接复核UI+模式保存cleanup测试10/10 PASS，check.mjs/diff PASS；父侧代理完整804项802 PASS/2 SKIP/0 FAIL（bundled Python），DCF build434注入、clean源码0；未修改产品profile/重启Desktop/运行真实Tunnel，productionReady仍false。
