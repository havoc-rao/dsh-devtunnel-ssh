# 独立工作区拆分验收（dlg-20261008-f280965b）

实际独立目录：/Users/havoc/Documents/Projects/tools/dsh-plugins/dsh-devtunnel-ssh。本轮当前执行策略允许该写入，未出现sandbox denial，不曾绕过拒绝。完整复制lib/test/manifest/README/MANUAL/patch及适用设计与历史证据，**没有删除原源码**，旧Bridge/归档原处保留。未init/commit新Git repo。

测试相对底座source imports从旧4级改为新../../dsh-remote，真实内部组合仅开发test。runtime lib与原子包逐文件完全一致，公开carrier契约未更改。无独立settings auto inject/UI，父RemoteSettings统一。历史docs含旧位置链接/历史artifact hashes，是出处记录，不伪造成新目录artifact；当前证据权威目录docs/split-evidence，README主入口链接已改为本仓。

独立目录全suite97/97 PASS、0FAIL exit0，全部lib/test syntax PASS。Schemastery运行依赖已在manifest；本机开发使用现有兄弟已安装schema的symlink，不带node_modules进pack、不npm install。未来正常tgz安装由宿主授权流程解析runtime dependency。

真实pack17files22350bytes，严格lib/manifest/patch/README/MANUAL允许清单及tar逐字节源码比对PASS。SHA256 ef6d69ea4278cc1fe20c8696cc29ea30e424929768428adbcec5632a33a74f0d。

Host安装推荐不可变hash命名路径：
`/Users/havoc/Documents/Projects/tools/dsh-plugins/dsh-devtunnel-ssh/.dsh/artifacts/dsh-devtunnel-ssh-0.0.1-experimental-ef6d69ea4278cc1f.tgz`

父侧Desktop配置任务可使用该file artifact，不能仅按同版本包名依赖缓存。插件仍需要支持public carrier底座并由用户明确experimental optin；CLI安装/登录/sshd/agent权限非包安装自动完成。managed入口not enabled；production/GUI验收限制保留。

## 保守迁移/回退

本次为复制后验收，无覆盖/rename旧源：新目录验证完毕成为后续源码目标；旧副本只作回退，不并行编辑。真实Desktop装配/卸载授权由父任务实施，本会话不改profile不启动服务。若新包装配失败，宿主可恢复此前profile引用；源树仍完整，必要时重新从旧副本导出。待用户确认新目录稳定并另授权清理后才可删除旧子包，绝不自动删源或原Bridge。

原兄弟参考计划的跨工作区mv仍未执行；本次split授权不用于变相搬运该此前被拒绝文件。
