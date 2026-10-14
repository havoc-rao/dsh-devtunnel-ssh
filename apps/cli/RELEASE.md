# dsh-link standalone releases

The forthcoming standalone CLI starts at **0.1.0**. Its package version is the
release source of truth; release tags must be exactly `dsh-link-v<version>`.
It is a dependency-free Node CLI at runtime. The build tools are development
dependencies, not runtime dependencies.

## Supported distribution targets

| Archive suffix | Native build runner | Executable |
| --- | --- | --- |
| `macos-arm64.tar.gz` | GitHub `macos-14`, Apple Silicon | `dsh-link` |
| `macos-x64.tar.gz` | GitHub `macos-15-intel`, Intel | `dsh-link` |
| `windows-x64.zip` | GitHub `windows-2022`, x64 | `dsh-link.exe` |

Each archive contains one self-contained **Node 22 SEA** executable and has a
sibling `.sha256` checksum file. End users do not need Node, npm, esbuild, or
postject installed to launch it. This does not bundle external tools the CLI
might invoke, provide credentials, install SSH servers, configure firewalls,
or authorize network access. Follow the CLI's own documented prerequisites.

These are three separate native executables, not a universal macOS binary.
Linux, Windows ARM64, other CPU architectures, cross-compilation, installers,
auto-updates, and package-manager publication are not provided. Node's SEA
facility is experimental. OS support is limited by the bundled Node 22 runtime
and by the application; a successful build on a hosted runner is **not** evidence
of compatibility with every older macOS or Windows version. The workflow runs
source tests before building and checks each native executable's version, help,
and invalid-command exit path before packaging. This is not end-to-end installed-binary
or all-supported-OS qualification. Windows CI also parses the generated PowerShell
script through the AST parser without applying authorization.

## Trust and operating-system prompts

**These releases are NOT publisher code-signed or notarized.** macOS builds
remove Node's original signature before injection, then apply a local **ad hoc**
signature and verify its structure. Ad hoc signing is needed for executable
integrity on macOS; it does not identify a trusted publisher, satisfy Developer
ID distribution requirements, or provide Apple notarization. Gatekeeper can
block downloaded executables or require a user-approved exception.

Windows builds do not apply an Authenticode publisher signature. Injection
changes the original Node executable, so its original signature must not be
regarded as a valid publisher signature for dsh-link. Windows/SmartScreen or
enterprise policies may warn or block execution. Do not disable security policy
as an automatic installation step.

SHA-256 files detect accidental corruption and allow comparison with the
release asset listing. They are uploaded alongside the binaries and are **not**
independently signed checksums or proof of authenticity. This workflow does not
produce signed provenance, attestations, or a reproducible-build guarantee.
Source review and a local rebuild remain available; registry dependencies,
runner images, action versions, and the Node 22 patch version can change.

## Building locally

Use the desired target machine with **Node 22** and, on macOS, `codesign`
available. Provision the CLI package's declared `esbuild` and `postject`
development dependencies explicitly first. The build script never runs npm,
installs tools, downloads Node binaries, or emulates a different architecture.
No root package changes or root install are required.

```sh
node --test apps/cli/test/*.test.mjs
node apps/cli/scripts/build.mjs
# Or use an explicit dedicated empty directory:
node apps/cli/scripts/build.mjs --out ./release-output
```

The default output directory is `apps/cli/dist`; `--out` is resolved from the
caller's current directory. The script writes `dsh-link` or `dsh-link.exe`,
rejects nonempty output directories, symlinks, source directories, and project
ancestors, and never clears an existing output directory. Choose a new empty
directory for repeat builds. Temporary SEA files are removed after the build.

The entry point is bundled by esbuild with `platform: node`, `format: cjs`, and
`target: node22` into a single CommonJS file. **The main source must not depend
on `import.meta`, external dynamic imports, sidecar modules/assets, or its source
file's original location.** The build script itself may use `import.meta.url`;
that script is not part of the SEA. Static imports of Node built-ins are fine.
The build invokes the selected native Node executable with
`--experimental-sea-config`, copies that same runtime, and injects the blob
using the local postject API. It does not ship the build dependencies.

## Release workflow and explicit publication

The GitHub workflow has only two triggers:

- Push a tag exactly matching the CLI package version, e.g. `dsh-link-v0.1.0`.
  After all three native builds pass, this explicitly triggered tag run uploads
  the archives and checksums to its GitHub release.
- Run `workflow_dispatch`. By default this only builds downloadable workflow
  artifacts (retained for 14 days). For publication, set `publish` to `true` and
  provide the exact version tag in `release_tag`. That tag must already exist
  and point at the exact dispatched commit. No tag is silently created.

Ordinary branch pushes and pull requests do not trigger this release workflow
or publish anything. A manually dispatched build on a version tag still needs
`publish: true` to publish. Build jobs have read-only repository permissions;
only the explicitly gated publish job has `contents: write`. No package registry,
OIDC permission, external signing service, or hidden installer is used.

The workflow explicitly provisions Node through `actions/setup-node`, then
runs `node --test apps/cli/test/*.test.mjs` before dependency provisioning and
build. It installs only the CLI package's declared build dependencies with
lifecycle scripts disabled, using `npm ci` when a CLI lockfile exists, otherwise
`npm install`. A reviewed, committed CLI lockfile is recommended for predictable
resolution; it is not fabricated by the build script. Archive checksums are
verified again before release upload. Upload does not overwrite existing release
assets; if a release already exists, its description is preserved.

For downloaded assets, verify from the directory containing both files:

```sh
# macOS
shasum -a 256 -c dsh-link-0.1.0-macos-arm64.tar.gz.sha256
```

```powershell
# Windows: compare this hash with the matching .sha256 text file.
Get-FileHash .\dsh-link-0.1.0-windows-x64.zip -Algorithm SHA256
```

Extract the correct archive for your CPU and invoke the extracted executable
explicitly. No installation or PATH modification occurs automatically.
