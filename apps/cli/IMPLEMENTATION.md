# Implementation checkpoint — 2026-10-14

## Implemented

- Independent Node 22 CLI, Windows/macOS platform plans, interactive `host` and `pair` entry points.
- One-hour versioned invitation, target-bound response and trusted-channel verification code.
- Dedicated Ed25519 key generation through system ssh-keygen, no private key content reads.
- Current-account-only, explicitly confirmed public-key authorization plans. Preserve keys, backup and atomic replacement; SID-based Windows ACLs.
- `verify`: system ssh + sftp, pinned host key, dedicated identity, no agent/password fallback.
- Manual DSH handoff export (not automatic import).
- Saved stable tunnel target, explicit foreground host/connect by ID; no implicit tunnel creation/anonymous ACL, owned-child signal forwarding with bounded TERM/KILL escalation.
- Lockfile and native Node SEA builder; gated GitHub Actions release pipeline for three OS/arch combinations.

## Actual evidence

| Check | Result |
|---|---|
| Standalone CLI tests | PASS 22; SKIP 1 Windows-only AST test (23 total) |
| Native executable version/help/invalid-command smoke | PASS macOS arm64 |
| Existing plugin regression suite | PASS 232/232 |
| Dedicated test key generation and invitation/response flow in isolated temp HOME | PASS |
| macOS arm64 SEA build (latest public-key input gate) | PASS |
| Built executable --version | PASS 0.1.0 |
| Latest round-1 executable --help (includes tunnel commands) | PASS |
| Isolated fake ssh/sftp verification arguments + successful DSH handoff export | PASS |
| Generated macOS authorization script shell syntax | PASS (parse only) |
| git diff --check | PASS |
| Windows PowerShell execution / real ACL updates | NOT RUN |
| Real macOS authorized_keys updates | NOT RUN |
| Real private Dev Tunnel + dual-PC SSH/SFTP | NOT RUN |
| Windows/macOS x64 native SEA builds | NOT RUN locally; CI definition only |
| GitHub upload, Release downloads | NOT RUN |
| Publisher signatures, Apple notarization | NOT RUN / not configured |

No plugin/profile deployment, GUI replacement, Git commit/tag/push, real SSH configuration mutation or account login performed. Preexisting modified plugin/client tests and contract were left unchanged.

## Remaining before intended first-release acceptance

- Private tunnel creation/port configuration remains manual; add official CLI capability detection before automating these persistent operations. Saved-target host/connect implemented, actual CLI integration NOT RUN.
- More convenient accept/verify wizard and useful failure detail without exposing credentials.
- macOS standard root-owned Include directory validation implemented; actual macOS application and Windows default service/config runtime validation remain NOT RUN.
- Established local pairing receipt implemented: verify/export survive invitation expiry only after successful first SSH+SFTP verification, bound to immutable invitation/response digests. Safe revocation of only owned keys remains to implement.
- Full isolated fake-process verification tests for ssh/SFTP arguments and failures, then real dual-PC acceptance.
- Authenticated DSH import remains a separate versioned public-interface task; no internal JSON writes.
- Real native CI builds and release distribution qualification, followed by explicit publication authorization.

## Naming update — 2026-10-19

- Product/package: `dsh-remote-devtunnel-link`; short command and SEA executable: `dsh-rdl` (`dsh-rdl.exe` on Windows). Source package exposes both command names.
- Release tag/archive prefix: `dsh-remote-devtunnel-link`.
- Existing `.dsh-link` state directory, v1 pairing kinds and `.dshlink` extension remain unchanged for compatibility; no key migration or authorization changes.
- Earlier build evidence above predates the rename; renamed native binaries and release distribution require fresh qualification.
