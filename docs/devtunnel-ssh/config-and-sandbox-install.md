# 公开Config与隔离装配准备（dlg-20261008-f1e0567a）

已核实installed @deepseek-ai/schemastery3.18.2 string.pattern/default、standard-schema接口与Cordis4.0.2 resolveConfig/Context.plugin。入口导出Config，cliExecutable默认空，仅macOS-first POSIX绝对路径、无控制字符，relative/~路径/type错误拒绝。Schemastery null默认归空（实测），safe disabled，不伪称null报错。

package runtime dependency ^3.18.2 Schemastery支持零构建；Cordis保留peer。本repo测试仅在子包node_modules创建到现已安装兄弟schema库的开发symlink（实际版本核实），未npm install/profile变化/网络。symlink不入pack，真正安装实验tgz由包依赖解析，需另授权sandbox环境准备。

真实resolveConfig和Context.plugin测试PASS：default空/绝对路径/invalid拒绝；route路径未配置409 HOST_CLI_PATH_NOT_CONFIGURED，不spawn。浏览器只能confirmed/checkLogin，不能改executable。user show真实账号未执行；JSON schema仍unknown。此次没有运行CLI帮助，先前help证据已确认命令，避免重复个人环境动作。

## 最小隔离装配说明（只准备，不执行）

1. 用户明确授权新的独立sandbox DSH_HOME与profile目录，不使用产品profiles/web；使用现有可信dsh版本，先人工`dsh web --help`核实启动选项。本文不猜profile CLI参数。
2. 在sandbox profile按正式包依赖机制本地安装本工作区tgz以及父侧支持carrier的实验dsh-remote，依赖准备须另授权；不得copy进产品profile或运行产品sync。
3. sandbox Cordis插件行应为：
```yaml
- id: dsh-devtunnel-ssh
  name: dsh-devtunnel-ssh
  config:
    cliExecutable: /Users/YOU/bin/devtunnel
```
底座独立行config需experimentalSshCarrier:true，用户确认后设置。路径替换为实际官方CLI绝对路径，空值不执行。
4. 在受控shell设置 `DSH_HOME=/ABSOLUTE/SANDBOX_HOME` 后通过已核实宿主启动方式启动sandbox（不是当前GUI替代）；具体profile selection flags需用户/宿主正式文档确认。获取正式认证URL，不读token/cache，不把URL秘密发聊天。
5. 实际浏览器验证设置区、默认opt-in gate、预检确认/超时/登录unknown、add/probe/mirror/delete与agent权限。本轮未做安装/启动/GUI。

包变更需新tgz，所有代码测试与允许清单结果见本轮evidence。旧Bridge入口保留，productionReady false。
