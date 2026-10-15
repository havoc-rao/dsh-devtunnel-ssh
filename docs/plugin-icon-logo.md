# DSH 插件 Icon / Logo 配置与更新

本文记录本插件在 DSH 插件管理页配置包图标的方案，以及修改后未显示时的排查方法。

## 1. 推荐方案：manifest 声明 + 导出 package.json

在包根目录放置自包含的图标，并在 [package.json](<../package.json#L9-L11>) 中配置：

```json
{
  "name": "dsh-devtunnel-ssh",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client/client.js",
    "./package.json": "./package.json"
  },
  "icon": "./icon.svg",
  "files": [
    "lib",
    "cordis.patch.yml",
    "README.md",
    "MANUAL.md",
    "icon.svg"
  ]
}
```

关键点：

- 顶层 `icon` 声明图标路径。本插件使用 [icon.svg](<../icon.svg>)。
- `exports["./package.json"]` 允许 DSH 通过包资源解析读取 manifest；只有顶层 `icon`、却不公开 manifest，并不足以让 DSH 获取图标。
- `files` 必须包含图标，以便打包安装时图标仍存在；npm 会自动包含包的 manifest。
- 此方案无需额外声明 `exports["./icon"]`。
- `dsh.client` 与 `exports["./client"]` 用于浏览器半侧装载，不是包图标声明的位置。

这与 Better Sidebar 的有效配置方式一致：公开 manifest，再由其顶层 `icon` 指向图像。

## 2. 可选方案：直接导出图标资源

若不公开 manifest，也可以单独提供图标资源：

```json
{
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client/client.js",
    "./icon": "./icon.svg"
  },
  "files": ["lib", "icon.svg"]
}
```

上述片段仅展示相关字段，不应覆盖本插件现有的其他配置。

DSH 对包根 specifier 的读取顺序是：

1. 尝试解析 `<包名>/package.json`。
2. 如果可读 manifest 声明了 `icon`，使用该路径。
3. 如果没有可用的 manifest 图标声明，尝试解析 `<包名>/icon`。

**已声明但无效或不可读的 manifest 图标不会回退到导出的图标。** 因此同时采用两种声明时，应确保 manifest 路径正确。

对于子路径插件（例如 `some-plugin/feature`），DSH 不读取包根 manifest；需要公开对应的 `some-plugin/feature/icon` 资源。

## 3. 图标资源限制

根据本次检查的 DSH 元数据读取实现：

- 支持 SVG、PNG、JPEG（`.jpg` / `.jpeg`）、WebP。
- 原始文件最大 256 KiB。
- manifest 中的图标路径必须是相对文件路径，不能使用绝对路径或 HTTP URL。
- manifest 图标不能逃出声明 manifest 所在目录；导出的图标须属于当前包，软链接不能绕过归属检查。
- 图标必须是普通文件，不能是目录。
- DSH 将图像字节编码成 `data:` URI，交给插件管理 UI 显示，而不是直接让浏览器请求源码目录。

建议 SVG 自包含，避免外部字体或图片依赖；保证 `viewBox` 正确，并检查小尺寸下的识别度。本插件当前 SVG 为 36 × 36。

## 4. 是否需要 build / pack？

本插件是零构建插件：`lib` 为手写源码，没有 `build` 脚本。包图标由宿主读取，不经过浏览器半侧编译。

| 安装来源 | 更新图标或声明后的处理 |
| --- | --- |
| `link:/绝对路径/插件目录` | 源文件直接可见，无需 build 或 pack；修改 `exports` 后可能需要完整重启 DSH 宿主 |
| `.tgz` 压缩包 | 重新 pack，并安装新生成的压缩包；旧压缩包不会随源码变化 |
| 发布到 registry 的版本 | 发布新版本并更新安装，核对实际安装版本 |

本次用户提供的安装来源是：

```text
link:/Users/havoc/Documents/Projects/tools/dsh-plugins/dsh-devtunnel-ssh
```

因此不应把 build 或重新打包作为该链接安装的解决步骤。

## 5. 为什么重新安装 link 后仍可能不显示？

**Node 进程可能缓存修改前的包 `exports`。** 如果宿主已解析过不公开 manifest 的旧声明，在同一进程中修改声明、重新安装链接，不一定能更新解析结果。

本次隔离实验结果：

```text
修改 exports 前：           ERR_PACKAGE_PATH_NOT_EXPORTED
修改 exports 后，同一进程： ERR_PACKAGE_PATH_NOT_EXPORTED
新进程：                   正常解析 package.json
```

处理方法：

1. 保存 manifest 与图标修改。
2. 完整退出并重新启动承载当前 GUI 的 DSH 宿主进程。
3. 刷新浏览器，重新打开插件管理页。

仅刷新浏览器、禁用再启用插件，或者重装同一个链接，不能保证清除宿主的模块解析缓存。

注意区分：修改 `exports` 涉及模块解析缓存；仅替换图像字节则不应直接认定为同一种缓存问题。应先重新请求插件列表，检查接口返回的元数据。

## 6. 验证与排查

### 6.1 检查当前源码包的资源解析

在插件根目录运行：

```bash
node --input-type=module -e '
import { readFileSync } from "node:fs";
const manifestURL = import.meta.resolve("dsh-devtunnel-ssh/package.json");
const manifest = JSON.parse(readFileSync(new URL(manifestURL), "utf8"));
const iconURL = new URL(manifest.icon, manifestURL);
const bytes = readFileSync(iconURL);
console.log("manifest:", manifestURL);
console.log("icon:", iconURL.href);
console.log("icon bytes:", bytes.length);
'
```

若出现 `ERR_PACKAGE_PATH_NOT_EXPORTED`，先检查公开导出。此命令验证的是新进程中的源码包解析，不能证明运行中 DSH 已采用相同解析结果。

### 6.2 检查打包内容

```bash
npm pack --ignore-scripts --dry-run --json
```

确认清单包含 `package.json` 和 `icon.svg`。需要生成实际压缩包时使用：

```bash
npm pack --ignore-scripts
```

本次默认 npm 缓存访问失败；使用临时缓存完成了 dry-run：

```bash
npm pack --ignore-scripts --dry-run --json --cache /tmp/dsh-devtunnel-pack-cache
```

这只是绕开默认缓存访问问题，不表示已修复默认缓存权限，也无需为图标问题执行 `sudo chown`。

### 6.3 完整重启后仍不显示

继续检查运行中宿主，而不是反复 build：

- 插件管理列表返回的 `meta.icon` 是否存在，是否为预期图像的 `data:` URI。
- `meta.error` 是否包含资源解析、格式、大小或路径归属错误。
- 实际包解析目录是否确实指向当前链接目标。
- 若接口已有正确图像，检查浏览器的图像加载错误、CSP 与 UI 渲染。
- 若只有已安装包卡片或只有运行插件条目异常，分别检查对应列表的元数据。

不要自动修改 profile、启动替代 GUI 或重启用户进程；部署与重启应由用户确认或操作。

## 7. 本次证据与边界

截至 2026-10-15：

- **PASS**：补充 manifest 导出后，新 Node 进程可解析当前源码包的 manifest。
- **PASS**：可读取当前图标，大小 835 字节。
- **PASS**：npm pack dry-run 清单包含 manifest 与图标。
- **PASS**：隔离实验复现同进程旧导出规则、新进程新导出规则的差异。
- **NOT RUN**：未直接核验当前已认证 GUI 的插件列表接口或图标呈现。
- **NOT RUN**：未替用户重启 DSH 宿主，也未修改部署 profile。

因此，缺少 manifest 导出是已确认的配置问题；宿主缓存是已验证机制与当前现象的候选解释，但没有宿主接口与完整重启后的证据，不能宣称线上显示已修复。
