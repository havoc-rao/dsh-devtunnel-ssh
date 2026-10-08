# 用户sandbox API手工验收（未执行，不部署现GUI）

先另行明确授权受控sandbox宿主，隔离DSH_HOME与profile。本文不启动新GUI、不修改现GUI配置；只有批准后才装配独立包并显式配置底座experimentalSshCarrier=true。默认false必须拒绝connector probe/机器保存，不得用raw localhost机器绕过。ordinaryWorkspaceReady/productionReady仍false。

## 前提

A实际DSH host与B都安装官方devtunnel并用户自行GitHub登录；B已有授权sshd/账号，私有独立Tunnel ACL经检查，独立渠道核实B主机SHA256指纹。A前台connect并记录remotePort22对应**当前**loopback端口；不把浏览器localhost当DSH host，不粘贴token/privatekey。OpenSSH ssh-add成功不保证sandbox宿主ssh2能接触SSH_AUTH_SOCK；用户在宿主实际进程上下文验证agent可达性，插件不代读agent/keychain。

## API顺序（在获批sandbox自身HTTP端点，认证/CSRF按宿主正式要求）

1. POST `/dsh-remote/machines`：
```json
{"action":"add","id":"sandbox-mac-b","name":"Sandbox Mac B","username":"REMOTE_USER","useAgent":true,"expectedHostFingerprint":"SHA256:INDEPENDENTLY_CONFIRMED_PIN","connector":{"kind":"devtunnel","mode":"external","tunnelId":"EXPLICIT_ID.CLUSTER","remotePort":22,"endpoint":{"host":"127.0.0.1","port":50736}}}
```
替换占位，不用个人真实pin直接默认信任；id/name/user/tunnel大小写须满足真实校验。新password/passphrase不支持，勿放请求。响应machine无password/host/port；保存不激活工作区。

2. POST `/dsh-remote/test-connect`：`{"id":"sandbox-mac-b"}`。这是fresh严格pin pool/lease，connect+exec true后finally关闭，不进入cache。期待ok/hostKeyVerified只在**真实SSH**成功时可记PASS；本仓fixture的该字段不是实际指纹证据。错误必须fail closed，不从config.host拨备用机器。未知id应拒绝（带connector时明确走carrier分支，单独未知id的direct分派行为另需父侧审计）。

3. POST `/dsh-remote/mirror`：
```json
{"path":"/REMOTE/AUTHORIZED/EXPERIMENT_DIR","machine":"sandbox-mac-b","workspace":"/LOCAL/SANDBOX/WORKSPACE"}
```
用户选择本次授权实验目录；响应localMirror，仅schema3保存machineId/canonical descriptor，不存runtime端口。检查workspace绑定后从**真实宿主工具/终端**访问B，不以curl或浏览器端成功代替agent执行上下文。不要直接编辑registry/meta来强行绑定。

4. CLI重启端口改变后先确认新端点所属CLI，再POST machines `action:update,id,connector`（完整kind/mode/tunnel/remotePort/endpoint，新端口）。canonical不变，generation/cache更新；旧任务/终端不重放。target或pin改变必须重新建立/明确re-trust，不原地替换。

5. 结束POST machines delete相同id，确认workspace选择清除、pool/PTY清理。停止CLI只能用户关闭自己前台connect，external插件不kill它；原旧Bridge不自动卸载。

## 必补证据

关闭VSCode独立host存活、未授权Tunnel拒绝、完整8MiB大小/hash/cmp、PTY Ctrl-C/resize/关闭和sleep恢复、DSH宿主agent私钥权限；逐项版本/操作/结果PASS/FAIL/NOT RUN。当前均未由agent实测，手册不放行普通ready。
