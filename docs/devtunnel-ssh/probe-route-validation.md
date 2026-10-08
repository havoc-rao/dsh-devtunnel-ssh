# Fresh probe组合验证（dlg-20261007-474e86b2）

本仓实际adapter+父apply route新增断言：saved id probe成功，factory config使用lease loopback与strict verify；exec失败也关闭pool/release；每probe fresh acquire/release计数分别1与2，未cache。带connector未知id/缺pin/password输入均在dial前失败；默认experimental false拒绝。Fake connect/exec/close和sftp原型finally恢复，隔离DSH_HOME，不读取私钥、agent、凭据。

全套79/79 PASS（在现有route test内增加assertions，非新增test数量），0FAIL exit0；syntax/diff PASS。见[TAP](<evidence/probe-route-tests.txt>)。hostKeyVerified=true为fake connect流程字段，仅合同断言，非真实pin验收。ordinaryReady/productionReady不变。

发现待父側审计：test-connect仅以body含connector或body.id匹配saved connector进入carrier分支；**单独未知id、不含connector**会进入旧direct probe并使用body/config.host。当前unknown-id测试明确含connector，未把它说成所有unknown-id都fail closed；建议如果body.id显式存在，先统一查找saved并拒绝unknown，而非direct fallback。本仓未修改父侧。

[用户sandbox API手工验收](<sandbox-api-acceptance.md>)已准备：显式opt-in、add external/current endpoint/pin/useAgent、fresh probe、mirror绑定、端口显式更新、delete清理；需验证DSH宿主真实agent可达性，不能以OpenSSH成功替代。文档未执行，不更新现GUI，不部署。
