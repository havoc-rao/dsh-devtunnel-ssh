# 实验可安装包交付（dlg-20261007-fb365c4f）

实际产物[本地tgz](<../../.dsh/artifacts/dsh-devtunnel-ssh-0.0.1-experimental.tgz>)，npm pack --ignore-scripts，仅本repo；先核对.dsh/artifacts realpath为本workspace内且非意外symlink。包14files/15,146bytes；SHA256 `dacec4eb229eccd38d645548b2ca9e8ac8396ca4a23603df1b97f6ec83c51487`。tar真实清单已核对仅lib/manifest/patch/README/MANUAL，无test/archive/.dsh/密钥文件，未部署或npm发布。

新增可用devtunnel-ssh-help命令，已读真实commands normalize name/description/handler契约；status/help均ctx.effect注册生命周期清理。随包MANUAL提供完整external API手工步骤，不只引用repo外文档。未核实可从commands使用的public authenticated HTTP服务/账号格式，因此不猜Bearer/cookie、不提供绕认证interactive script。首版external允许用户按正式宿主认证sandbox手工接线；managed源码可用但入口受控路径/审批尚未接入，明确disabled。

全suite82/82 PASS，0FAIL exit0，语法/diff PASS；[TAP](<evidence/delivery-suite-tests.txt>)/[实际pack元数据](<evidence/delivery-pack.json>)。真实installed loader/browser认证请求尚未执行；不是GUI生产。

父侧报告full675pass0fail2skip、localapplyexec4pass属于父侧执行证据，不当作本仓个人Tunnel实测。核心后续：获批隔离宿主安装包/当前instance能力读取/正式认证API或GUI表单、真实SSH agent可达性与剩余Step0、managed审批/config、prerequisite runner和listener归属；范围建议先验收external手工最小链路再managed自动化，生产UX扩展分期。

旧Bridge入口/归档保留，未运行product sync/profile安装，不自动CLI登录/安装/sshd，不读取秘密，原跨workspace移动仍未做。
