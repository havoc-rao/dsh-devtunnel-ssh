# Saved Dev Tunnel carrier retarget backend (staged; NOT applied)

Sibling repository writes were denied by the sandbox. No deployment/profile/GUI action was run. The accompanying staged module, patch builder and tests are deliverables only; applying them requires reopening a session with the sibling checkout as writable root.

## Transaction model

Do NOT rewrite many mirror metadata files and then registry: no atomic commit spans those files, and rollback can destroy concurrent edits. Commit the new connector and precise mirror rebinding allowlist in one atomic replacement of machines.json. Old schema3 metadata remains physically unchanged; all metadata readers project a new canonical identity only if the registry allowlist matches absolute meta filename, SHA256 of the full original bytes, original strict identity, current machine identity, and pinned fingerprint. machineForMirror remains unchanged and exact. Unlisted, tampered, malformed, moved, or newly created old-target metadata never gains authority. On repeated retarget, resolve already projected metadata then replace allowlist entries for this machine; keep their original byte digests and original on-disk identity. Empty directory selections are retained unchanged. mirrorDirFor must check projected existing mirrors first to retain idempotent original-directory reuse.

All registry writes must preserve the internal carrierMirrorBindings top-level field and use the same synchronous, lock-protected atomic write helper. All machine mutators must respect the per-machine retarget exclusion gate. Lock files reject contention rather than waiting; stale lock files are a recoverable fail-closed error and must not be automatically deleted.

## API

POST /dsh-remote/machines body: {action:'retarget-carrier', id, connector, expectedConnector, confirmed:true, expectedHostFingerprint}. experimentalSshCarrier must be true. Both connectors must be devtunnel, transport ssh. expectedConnector is full structural equality, including mode, channelId and external endpoint. expectedHostFingerprint must exactly equal the saved valid pin. Normalize/validate the proposed connector through installed carrier; preserve all other machine fields. No SSH, preflight, acquire, tunnel start, trust replacement, or credential write.

400 validation/confirmation/pin failure; 404 missing id; 409 stale/exclusion/registry concurrency; 500 filesystem failure. Success standard machine/machines/currentId plus retargetedMirrors count. No fresh connection occurs: the existing authoritative pin is verified normally on the next explicit connection.

## Required integration points (all discovered by read-only grep)

- index.js mirrorDirFor (313), mirrorEntries (396), mirrorRegistry (2001): replace JSON meta reads with readCarrierMirrorMeta(root, metaPath). mirrorDirFor first searches projected strict identity+normalized remotePath.
- binding.js resolveMirror (80): same read helper. This protects sessions and workspaceConnection.
- route-machine.js findMirrorsForRemotePath (66): same read helper. machineForMirror untouched.
- index.js ensureMirror: when reusing mapped directory, do not overwrite original metadata; retaining original exact bytes retains allowlist validity. Verify effective identity and remotePath before returning early.
- registry.js saveMachines: preserve carrierMirrorBindings from prior document and write via atomic registry helper; loadMachines may continue returning its existing projection.
- index.js normal carrier update: preserve other previous fields (notably recentWorkspaces), reject when retarget gate locked; ordinary normalizeCarrierMachine(previous) target immutability stays unchanged. delete must also reject the gate.
- ssh-carrier-cache.js: block(machineId) synchronously excludes get() before invalidate's await and return unblock; invalidate aborts acquisitions and closes live pools. Keep gate through atomic commit and in-memory publication, then unblock in finally.
- index.js retarget route: synchronously capture entire previous record and persisted registry bytes, block cache and gate machine writes; await invalidate; re-check complete live previous record and persisted registry bytes; synchronously enumerate mirrors + create plan + atomic commit + replace machines[index], finally release both gates. No await between final CAS and memory publication. If commit fails, old registry and metadata still resolve; connection remains closed (never restore/replay).

## Caveats

Registry atomic writes require fsync of temp file before rename and cleanup of temp on precommit failure. Parent directory fsync errors after rename must not produce an apparent rollback: rename is commit point. Registry lock protects cooperating writers; hostile/external processes ignoring the lock remain outside the supported concurrency contract. Retarget should fail closed for symlink registry/root/mirror paths; only exact two-level real directory layout beneath configured remoteWorkspacesRoot is eligible. Per-machine in-memory gate must be respected by HTTP and rw_connect save paths; otherwise pending unrelated record writes can erase a committed connector.

## Evidence status

Sibling backend source applied: NOT RUN (sandbox DENIED). Integration tests against modified sibling: NOT RUN. Staged pure-module tests: see parent result. Real SSH/devtunnel migration: NOT RUN. Deployment, profile changes, replacement GUI: NOT RUN by design.
