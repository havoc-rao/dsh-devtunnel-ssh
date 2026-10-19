# 安装 dsh-remote-devtunnel-link（dsh-rdl）

独立 CLI，安装后不需要 Node.js/npm。支持 macOS Apple Silicon、macOS Intel、Windows x64；不支持 Linux 或 Windows ARM64。官方仓库：https://github.com/havoc-rao/dsh-devtunnel-ssh 。

## 发布状态与下载入口

- 每次 push 到 main 会在 GitHub Actions 构建三个原生产物，仅上传保留 14 天的 workflow artifacts，不自动发布 Release。
- Actions：https://github.com/havoc-rao/dsh-devtunnel-ssh/actions 。下载 artifact 需要 GitHub 登录及相应权限；下载的是外层 artifact ZIP，先解开再使用内层平台压缩包及 checksum。
- 正式版本须在三个构建成功并完成验收后，显式推送与 CLI 版本匹配的标签（例如 `dsh-remote-devtunnel-link-v0.1.0`），或显式 dispatch publish。Release 列表：https://github.com/havoc-rao/dsh-devtunnel-ssh/releases 。
- 以下固定版本安装命令**仅在对应 Release 附件实际发布后可用**，不是当前已发布的声明。不存在时 curl 会失败，不会改用未校验来源。
- 私有仓库不支持以下匿名下载；应使用已登录的 GitHub CLI `gh release download TAG --repo havoc-rao/dsh-devtunnel-ssh` 获取文件并按手动方式安装，不把 token 放进 URL 或聊天。

## macOS：推荐的 Release 安装方式

下载脚本后先审阅，不使用 `curl | sh`：

```sh
VERSION=0.1.0
BASE="https://github.com/havoc-rao/dsh-devtunnel-ssh/releases/download/dsh-remote-devtunnel-link-v${VERSION}"
curl -fL --proto '=https' "$BASE/install-macos.sh" -o install-dsh-rdl.sh
less install-dsh-rdl.sh
sh install-dsh-rdl.sh --version "$VERSION"
```

脚本自动选择原生 arm64/x64（包括 Rosetta 下的 Apple Silicon），下载对应 tar.gz 和 SHA256，校验后检查签名结构与版本，安装到 `~/.local/bin/dsh-rdl`，无需 sudo。已有程序默认拒绝覆盖；审阅后升级用 `--force`。不自动修改 shell 配置。如提示 PATH 未配置，请在自己的 shell 配置中加入一次：

```sh
export PATH="$HOME/.local/bin:$PATH"
```

新开终端后：

```sh
dsh-rdl --version
dsh-rdl --help
dsh-rdl doctor
```

## Windows x64：Release 安装

在普通 PowerShell 中下载并审阅脚本：

```powershell
$Version = '0.1.0'
$Base = "https://github.com/havoc-rao/dsh-devtunnel-ssh/releases/download/dsh-remote-devtunnel-link-v$Version"
Invoke-WebRequest "$Base/install-windows.ps1" -OutFile install-dsh-rdl.ps1
Get-Content .\install-dsh-rdl.ps1
.\install-dsh-rdl.ps1 -Version $Version -AddToPath
```

安装到 `%LOCALAPPDATA%\Programs\dsh-rdl\dsh-rdl.exe`；只有 `-AddToPath` 才更新用户 PATH，重新打开终端生效。不改系统 PATH，不需要管理员权限。升级需显式 `-Force`。如果执行策略或企业安全策略阻止运行，不要自动关闭策略；使用组织批准流程或手动安装。

## 手动安装（Release 或 Actions artifact）

1. 下载适合系统的压缩包和同名 `.sha256`，文件名前缀为 `dsh-remote-devtunnel-link-0.1.0-`，后缀为 `macos-arm64.tar.gz` / `macos-x64.tar.gz` / `windows-x64.zip`。
2. 先核对哈希。macOS 在这两个文件所在目录运行：

   ```sh
   shasum -a 256 -c dsh-remote-devtunnel-link-0.1.0-macos-arm64.tar.gz.sha256
   ```

   Windows 使用 `Get-FileHash .\对应压缩包.zip -Algorithm SHA256`，与 checksum 文件逐字符比较。
3. 解压，macOS 把 `dsh-rdl` 放入 `~/.local/bin` 并确保可执行；Windows 把 `dsh-rdl.exe` 放入上述用户目录。已有程序先核对再决定是否替换。
4. 将安装目录加入用户 PATH，重新打开终端，检查 `dsh-rdl --version`。

macOS 手动安装示例（在解压目录执行）：

```sh
mkdir -p "$HOME/.local/bin"
install -m 755 ./dsh-rdl "$HOME/.local/bin/dsh-rdl"
```

## 安装后的连接流程

安装程序不代表连接环境就绪：两端需要自行安装官方 Dev Tunnel CLI、登录并授权私有隧道，被连接端需自行启用 OpenSSH 服务。安装脚本不创建隧道、不开放匿名权限、不改防火墙、不应用 SSH 公钥。

- 被连接端：`dsh-rdl host` 创建邀请。
- 控制端：`dsh-rdl pair` 生成独立配对密钥与响应。
- 双方可信渠道交换文件并核对完整校验码，再显式接受授权。
- 显式启动隧道，`verify` 验证 SSH/SFTP；`dsh export` 仅导出手动 DSH 交接说明，不自动写 DSH 注册表。

详细流程见 [CLI 使用说明](../apps/cli/README.md)。旧版 `.dsh-link` 本地状态目录与配对文件格式保留兼容，升级不迁移/删除密钥。

## 安全、卸载与证据边界

- macOS 仅 ad hoc 签名，无 Developer ID/Apple 公证；Windows 无 Authenticode 发行者签名。Gatekeeper/SmartScreen 可能拦截，安装器不移除隔离标记、不关闭安全检查。
- 同源 SHA256 只证明与发布附件一致，不是独立签名或可信发行者证明。安装脚本本身也应审阅。
- 卸载只需手动删除已确认的可执行文件并移除自己添加的 PATH 条目；不要删除密钥目录来假装撤销远端授权。当前没有自动撤销命令。
- CI 的版本/help/error smoke 不是双机 SSH/SFTP、公钥写入、所有系统版本兼容性验收；真实 Windows/macOS 授权及双机验证仍需单独执行。
