import { Buffer } from 'node:buffer';
import { ECDH } from 'node:crypto';

// Deliberately independent of the CLI entry point: planning never executes commands.
const KEY_TYPES = new Set(['ssh-ed25519', 'ssh-rsa', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521']);

/** Parse an unadorned, single-line OpenSSH public key (not authorized_keys options). */
export function parsePublicKey(publicKey) {
  if (typeof publicKey !== 'string' || publicKey.length > 32768 || /[\r\n\0]/u.test(publicKey)) throw new TypeError('Expected one SSH public key line');
  const match = /^([\w-]+)[ \t]+([A-Za-z0-9+/]+={0,2})(?:[ \t]+([^\x00-\x1f\x7f]*))?$/u.exec(publicKey.trim());
  if (!match || !KEY_TYPES.has(match[1])) throw new TypeError('Unsupported or malformed SSH public key');
  const [, type, encoded, comment = ''] = match;
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64').replace(/=+$/u, '') !== encoded.replace(/=+$/u, '') || encoded.length % 4 === 1 || (encoded.includes('=') && encoded.length % 4 !== 0)) throw new TypeError('Invalid SSH public key base64');
  let offset = 0;
  const field = () => {
    if (offset + 4 > bytes.length) throw new TypeError('Truncated SSH public key');
    const length = bytes.readUInt32BE(offset); offset += 4;
    if (length > bytes.length - offset) throw new TypeError('Truncated SSH public key');
    const value = bytes.subarray(offset, offset + length); offset += length; return value;
  };
  if (!field().equals(Buffer.from(type, 'ascii'))) throw new TypeError('SSH public key type mismatch');
  const mpint = () => {
    const n = field();
    if (!n.length || (n[0] & 128) || (n[0] === 0 && (n.length === 1 || !(n[1] & 128)))) throw new TypeError('Invalid RSA public key integer');
    return n;
  };
  if (type === 'ssh-ed25519') {
    if (field().length !== 32) throw new TypeError('Invalid Ed25519 public key length');
  } else if (type === 'ssh-rsa') {
    const exponent = mpint(); const modulus = mpint();
    if (exponent.length > 8 || (exponent.length === 1 && exponent[0] < 3) || modulus.length < 128 || !(exponent.at(-1) & 1) || !(modulus.at(-1) & 1)) throw new TypeError('Invalid RSA public key');
  } else {
    const curve = type.slice('ecdsa-sha2-'.length);
    if (!field().equals(Buffer.from(curve, 'ascii'))) throw new TypeError('ECDSA curve mismatch');
    const point = field(); const length = { nistp256: 65, nistp384: 97, nistp521: 133 }[curve];
    if (point.length !== length || point[0] !== 4) throw new TypeError('Invalid ECDSA public point');
    try { ECDH.convertKey(point, { nistp256: 'prime256v1', nistp384: 'secp384r1', nistp521: 'secp521r1' }[curve]); }
    catch { throw new TypeError('Invalid ECDSA public point'); }
  }
  if (offset !== bytes.length) throw new TypeError('Unexpected SSH public key payload');
  const blob = bytes.toString('base64');
  return { type, blob, comment, publicKey: `${type} ${blob}${comment ? ` ${comment}` : ''}` };
}

function text(value, label) {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f\x7f]/u.test(value)) throw new TypeError(`Invalid ${label}`);
  return value;
}
const psQuote = value => `'${value.replaceAll("'", "''")}'`;
const shQuote = value => `'${value.replaceAll("'", "'\\''")}'`;
function username(value) {
  text(value, 'username');
  if (value.length > 256 || /[/]/u.test(value) || value.startsWith('-') || value !== value.trim()) throw new TypeError('Invalid username');
  return value;
}

/** Return a PowerShell plan for the current Windows account only. */
export function planWindowsAuthorize({ username: user, publicKey, path } = {}) {
  user = username(user);
  const key = parsePublicKey(publicKey);
  if (path !== undefined) {
    text(path, 'Windows authorized keys path');
    if (!/^[A-Za-z]:\\/u.test(path) || /[<>"|?*]/u.test(path) || path.slice(2).includes(':') || path.split('\\').some(p => p === '..' || p === '.' || /[ .]$/u.test(p))) throw new TypeError('Expected an absolute local Windows path');
  }
  const script = `# Reviewed plan only; run explicitly in PowerShell as the CURRENT account.
$ErrorActionPreference = 'Stop'
$requestedUser = ${psQuote(user)}
$keyLine = ${psQuote(key.publicKey)}
$keyBlob = ${psQuote(key.blob)}
$requestedPath = ${path === undefined ? '$null' : psQuote(path)}
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$currentName = $identity.Name
$shortName = ($currentName -split '\\\\')[-1]
if (($requestedUser -ine $currentName) -and ($requestedUser -ine $shortName)) { throw 'Only the CURRENT Windows account may be authorized' }
$userSid = $identity.User
$systemSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$adminSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
$isAdmin = @($identity.Groups | ForEach-Object { $_.Value }) -contains $adminSid.Value
function Assert-NoReparse([string] $candidate) {
  $cursor = [System.IO.Path]::GetFullPath($candidate)
  while ($cursor) {
    if (Test-Path -LiteralPath $cursor) {
      $item = Get-Item -LiteralPath $cursor -Force
      if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Reparse point rejected: $cursor" }
    }
    $parent = [System.IO.Path]::GetDirectoryName($cursor)
    if ($parent -eq $cursor) { break }
    $cursor = $parent
  }
}
# Inspect the actual service invocation; custom -f/-o configurations fail closed.
$service = Get-CimInstance Win32_Service -Filter "Name='sshd'"
if (!$service) { throw 'sshd is not configured; this plan does not install or start it' }
if ($service.PathName -notmatch '(?i)^\\s*(?:"[^"\\r\\n]*\\\\sshd\\.exe"|[^"\\r\\n]*\\\\sshd\\.exe)\\s*$') { throw 'Custom sshd service arguments are unsupported' }
$configPath = Join-Path $env:ProgramData 'ssh\\sshd_config'
Assert-NoReparse $configPath
if (!(Test-Path -LiteralPath $configPath -PathType Leaf)) { throw 'Missing sshd_config' }
$inAdminMatch = $false
$seenAdminMatch = $false
$adminAuthorized = $false
$seenUserAuthorized = $false
foreach ($raw in [System.IO.File]::ReadAllLines($configPath)) {
  $line = ($raw -replace '#.*$', '').Trim()
  if (!$line) { continue }
  if ($line -match '(?i)^(Include|AuthorizedKeysCommand|AuthorizedKeysCommandUser)\\b') { throw 'Custom key configuration is unsupported' }
  if ($line -match '(?i)^Match\\s+') {
    if ($line -notmatch '(?i)^Match\\s+Group\\s+administrators$' -or $seenAdminMatch) { throw 'Unsupported sshd Match configuration' }
    $inAdminMatch = $true; $seenAdminMatch = $true; continue
  }
  if ($line -match '(?i)^AuthorizedKeysFile\\s+(.+)$') {
    $value = $Matches[1].Trim()
    if ($inAdminMatch) {
      if ($adminAuthorized -or $value -cne '__PROGRAMDATA__/ssh/administrators_authorized_keys') { throw 'Custom administrator authorized keys path is unsupported' }
      $adminAuthorized = $true
    } else {
      if ($seenUserAuthorized -or $value -cne '.ssh/authorized_keys') { throw 'Custom user authorized keys path is unsupported' }
      $seenUserAuthorized = $true
    }
  }
}
if ($seenAdminMatch -and !$adminAuthorized) { throw 'Administrator Match must specify its authorized keys path' }
# A missing administrators Match uses the normal per-user path, including for admins.
$useAdminFile = $isAdmin -and $adminAuthorized
$homePath = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
if (!$homePath) { throw 'Cannot resolve CURRENT user profile' }
$target = if ($useAdminFile) { Join-Path $env:ProgramData 'ssh\\administrators_authorized_keys' } else { Join-Path $homePath '.ssh\\authorized_keys' }
$target = [System.IO.Path]::GetFullPath($target)
if ($requestedPath -and ([System.IO.Path]::GetFullPath($requestedPath) -ine $target)) { throw 'Requested path does not match sshd_config' }
$directory = [System.IO.Path]::GetDirectoryName($target)
Assert-NoReparse $target
if ((Test-Path -LiteralPath $target) -and !(Test-Path -LiteralPath $target -PathType Leaf)) { throw 'Authorized keys must be a regular file' }
if ((Test-Path -LiteralPath $directory) -and !(Test-Path -LiteralPath $directory -PathType Container)) { throw 'Authorized keys parent must be a directory' }
$null = [System.IO.Directory]::CreateDirectory($directory)
Assert-NoReparse $target
$ownerSid = if ($useAdminFile) { $adminSid } else { $userSid }
function Set-KeyAcl([string] $candidate, [bool] $isDirectory = $false) {
  $acl = if ($isDirectory) { [System.Security.AccessControl.DirectorySecurity]::new() } else { [System.Security.AccessControl.FileSecurity]::new() }
  $acl.SetAccessRuleProtection($true, $false)
  $acl.SetOwner($ownerSid)
  foreach ($sid in @($ownerSid, $systemSid)) {
    $inheritance = if ($isDirectory) { [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' } else { [System.Security.AccessControl.InheritanceFlags]::None }
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, [System.Security.AccessControl.FileSystemRights]::FullControl, $inheritance, [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
    $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $candidate -AclObject $acl
}
if (!$useAdminFile) { Set-KeyAcl $directory $true }
$utf8 = [System.Text.UTF8Encoding]::new($false, $true)
$existing = if (Test-Path -LiteralPath $target) { [System.IO.File]::ReadAllText($target, $utf8) } else { '' }
$found = $false
foreach ($line in ($existing -split '\\r?\\n')) {
  if ($line.TrimStart().StartsWith('#')) { continue }
  if ($line -match '(?:^|\\s)(?:ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521))\\s+([A-Za-z0-9+/]+={0,2})(?:\\s|$)') {
    if ($Matches[1].TrimEnd('=') -ceq $keyBlob.TrimEnd('=')) { $found = $true; break }
  }
}
if (Test-Path -LiteralPath $target) { Set-KeyAcl $target }
if (!$found) {
  $separator = if ($existing -and !$existing.EndsWith("\`n")) { "\`r\`n" } else { '' }
  $content = $existing + $separator + $keyLine + "\`r\`n"
  $temp = Join-Path $directory ('.authorized_keys.' + [Guid]::NewGuid().ToString('N') + '.tmp')
  $backup = $target + '.backup.' + [Guid]::NewGuid().ToString('N')
  try {
    # CreateNew refuses an existing file; same-directory Replace/Move is atomic.
    $stream = [System.IO.FileStream]::new($temp, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try { $bytes = $utf8.GetBytes($content); $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    Set-KeyAcl $temp
    Assert-NoReparse $target
    if (Test-Path -LiteralPath $target) {
      if ([System.IO.File]::ReadAllText($target, $utf8) -cne $existing) { throw 'Authorized keys changed concurrently; retry after review' }
      [System.IO.File]::Replace($temp, $target, $backup)
      Set-KeyAcl $backup
    } else { [System.IO.File]::Move($temp, $target) }
    Set-KeyAcl $target
  } finally { if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force } }
}
Write-Output "Authorized public key for CURRENT account at $target; no service/config/firewall changes"
`;
  return { script, description: `Authorize the supplied public key for current Windows account ${user}; inspect sshd configuration, preserve existing keys, and restrict SID-based ACLs.` };
}

/** Return a POSIX shell plan for the current macOS user only. */
export function planMacAuthorize({ username: user, publicKey, home } = {}) {
  user = username(user);
  if (user.includes('\\')) throw new TypeError('Invalid macOS username');
  const key = parsePublicKey(publicKey);
  text(home, 'macOS home');
  if (!home.startsWith('/') || home === '/' || home.split('/').some(p => p === '.' || p === '..') || home.endsWith('/')) throw new TypeError('Expected an absolute macOS home directory');
  const script = `#!/bin/sh
# Reviewed plan only. No private key, login cache, or agent access.
set -eu
requested_user=${shQuote(user)}
requested_home=${shQuote(home)}
key_line=${shQuote(key.publicKey)}
key_blob=${shQuote(key.blob)}
current_user=$(/usr/bin/id -un)
[ "$current_user" = "$requested_user" ] || { echo 'Only the CURRENT macOS user may be authorized' >&2; exit 1; }
current_home=$(/usr/bin/dscl . -read "/Users/$current_user" NFSHomeDirectory | /usr/bin/sed -n 's/^NFSHomeDirectory: //p')
[ -n "$current_home" ] && [ "$requested_home" = "$current_home" ] || { echo 'Home does not belong to CURRENT user' >&2; exit 1; }
directory="$current_home/.ssh"
target="$directory/authorized_keys"
assert_no_symlink() {
  candidate=$1
  while [ "$candidate" != / ]; do
    [ ! -L "$candidate" ] || { echo 'Symlink rejected' >&2; exit 1; }
    candidate=$(/usr/bin/dirname "$candidate")
  done
}
assert_no_symlink "$target"
# BEGIN CONFIG VALIDATION: only the standard root-owned macOS include directory.
config_root=/private/etc/ssh/sshd_config
config_dir=/private/etc/ssh/sshd_config.d
assert_config_safe() {
  assert_no_symlink "$1"
  [ -r "$1" ] || { echo 'Cannot inspect system SSH configuration' >&2; exit 1; }
  owner=$(/usr/bin/stat -f '%u' "$1")
  mode=$(/usr/bin/stat -f '%Lp' "$1")
  [ "$owner" = 0 ] && [ $((0$mode & 0022)) = 0 ] || { echo 'SSH configuration must be root-owned and not group/world writable' >&2; exit 1; }
}
validate_apple_crypto() {
  # Only this Apple system link is supported; never follow arbitrary includes.
  crypto_link=/private/etc/ssh/crypto.conf
  crypto_dir=/private/etc/ssh/crypto
  crypto_target="$crypto_dir/apple.conf"
  assert_config_safe /private
  assert_config_safe /private/etc
  assert_config_safe /private/etc/ssh
  assert_config_safe "$crypto_dir"
  [ -d "$crypto_dir" ] || { echo 'Invalid Apple crypto directory' >&2; exit 1; }
  [ -L "$crypto_link" ] && [ "$(/usr/bin/readlink "$crypto_link")" = 'crypto/apple.conf' ] || { echo 'Unsupported Apple crypto link target' >&2; exit 1; }
  [ "$(/usr/bin/stat -f '%u' "$crypto_link")" = 0 ] || { echo 'Apple crypto link must be root-owned' >&2; exit 1; }
  assert_config_safe "$crypto_target"
  [ -f "$crypto_target" ] || { echo 'Apple crypto target must be a regular file' >&2; exit 1; }
  /usr/bin/awk '
    { sub(/#.*/, ""); directive=tolower($1) }
    NF == 0 { next }
    directive != "ciphers" && directive != "kexalgorithms" && directive != "macs" { bad=1 }
    NF != 2 { bad=1 }
    END { exit bad }
  ' "$crypto_target" || { echo 'Unsupported Apple crypto directives; no changes made' >&2; exit 1; }
}
assert_no_symlink /private/etc/ssh/sshd_config
assert_config_safe /private/etc/ssh
assert_config_safe "$config_root"
[ -f "$config_root" ] || { echo 'Missing system SSH configuration' >&2; exit 1; }
# Reject alternate/multiple include patterns, Matches and delegated key commands.
/usr/bin/awk '
  { sub(/#.*/, ""); directive=tolower($1) }
  directive == "include" { if (NF != 2 || $2 != "/etc/ssh/sshd_config.d/*") bad=1 }
  directive == "match" || directive == "authorizedkeyscommand" || directive == "authorizedkeyscommanduser" { bad=1 }
  directive == "authorizedkeysfile" { if (NF != 2 || $2 != ".ssh/authorized_keys") bad=1 }
  END { exit bad }
' "$config_root" || { echo 'Custom SSH configuration requires manual review; no changes made' >&2; exit 1; }
set -- "$config_root"
if /usr/bin/awk 'tolower($1) == "include" { found=1 } END { exit !found }' "$config_root"; then
  if [ -e "$config_dir" ] || [ -L "$config_dir" ]; then
    assert_config_safe "$config_dir"
    [ -d "$config_dir" ] || { echo 'Include path is not a directory' >&2; exit 1; }
    count=0
    for config in "$config_dir"/*; do
      [ -e "$config" ] || [ -L "$config" ] || continue
      count=$((count + 1))
      [ "$count" -le 64 ] || { echo 'Too many SSH include files' >&2; exit 1; }
      assert_config_safe "$config"
      [ -f "$config" ] || { echo 'SSH include is not a regular file' >&2; exit 1; }
      /usr/bin/awk '
        { sub(/#.*/, ""); directive=tolower($1) }
        directive == "include" { if (NF != 2 || $2 != "/etc/ssh/crypto.conf" || FILENAME != "/private/etc/ssh/sshd_config.d/100-macos.conf") bad=1 }
        directive == "match" || directive == "authorizedkeyscommand" || directive == "authorizedkeyscommanduser" { bad=1 }
        directive == "authorizedkeysfile" { if (NF != 2 || $2 != ".ssh/authorized_keys") bad=1 }
        END { exit bad }
      ' "$config" || { echo 'Custom SSH include requires manual review; no changes made' >&2; exit 1; }
      if /usr/bin/awk '{ sub(/#.*/, "") } tolower($1) == "include" { found=1 } END { exit !found }' "$config"; then
        validate_apple_crypto
      fi
      set -- "$@" "$config"
    done
  fi
fi
# END CONFIG VALIDATION
[ -d "$current_home" ] || { echo 'Missing user home' >&2; exit 1; }
[ ! -e "$directory" ] || [ -d "$directory" ] || { echo 'SSH parent is not a directory' >&2; exit 1; }
[ ! -e "$target" ] || [ -f "$target" ] || { echo 'Authorized keys is not a regular file' >&2; exit 1; }
umask 077
/bin/mkdir -p "$directory"
assert_no_symlink "$target"
/bin/chmod 700 "$directory"
if [ -f "$target" ]; then
  /bin/chmod 600 "$target"
  if /usr/bin/awk -v blob="$key_blob" 'BEGIN { sub(/=+$/, "", blob) } /^[[:space:]]*#/ { next } { for (i=1; i<NF; i++) if ($i ~ /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521))$/) { value=$(i+1); sub(/=+$/, "", value); if (value == blob) found=1 } } END { exit !found }' "$target"; then
    echo 'Public key already authorized'; exit 0
  fi
fi
temp=$(/usr/bin/mktemp "$directory/.authorized_keys.XXXXXXXX")
snapshot=$(/usr/bin/mktemp "$directory/.authorized_keys.snapshot.XXXXXXXX")
trap '/bin/rm -f "$temp" "$snapshot"' EXIT HUP INT TERM
existed=false
if [ -f "$target" ]; then
  existed=true
  /bin/cp -p "$target" "$snapshot"
  /bin/cat "$snapshot" > "$temp"
  if [ -s "$temp" ]; then
    last=$(/usr/bin/tail -c 1 "$temp" | /usr/bin/od -An -tu1 | /usr/bin/tr -d '[:space:]')
    [ "$last" = 10 ] || printf '\\n' >> "$temp"
  fi
fi
printf '%s\\n' "$key_line" >> "$temp"
/bin/chmod 600 "$temp"
assert_no_symlink "$target"
if [ "$existed" = true ]; then
  /usr/bin/cmp -s "$target" "$snapshot" || { echo 'Authorized keys changed concurrently; retry after review' >&2; exit 1; }
  backup=$(/usr/bin/mktemp "$directory/authorized_keys.backup.XXXXXXXX")
  /bin/cp -p "$snapshot" "$backup"
  /bin/chmod 600 "$backup"
else
  [ ! -e "$target" ] || { echo 'Authorized keys appeared concurrently' >&2; exit 1; }
fi
# Same-directory rename preserves all prior key lines and is atomic.
/bin/mv -f "$temp" "$target"
/bin/chmod 600 "$target"
echo 'Authorized public key for CURRENT user; no service/config/firewall changes'
`;
  return { script, description: `Authorize the supplied public key for current macOS user ${user} in ~/.ssh/authorized_keys, preserving existing keys with permissions 700/600.` };
}

/** Read-only diagnostics, suitable for display/review; no login/cache inspection. */
export function diagnosticCommands(platform) {
  if (platform === 'win32') return [
    { label: 'SSH service', command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', "Get-Service -Name sshd -ErrorAction SilentlyContinue | Select-Object Name,Status,StartType"] },
    { label: 'TCP listeners', command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', "Get-NetTCPConnection -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess"] },
    { label: 'Dev Tunnel CLI version (explicit check only)', requiresExplicitCheck: true, command: 'devtunnel', args: ['--version'] },
  ];
  if (platform === 'darwin') return [
    { label: 'SSH service', command: '/bin/launchctl', args: ['print', 'system/com.openssh.sshd'] },
    { label: 'TCP listeners', command: '/usr/sbin/lsof', args: ['-nP', '-iTCP', '-sTCP:LISTEN'] },
    { label: 'Dev Tunnel CLI version (explicit check only)', requiresExplicitCheck: true, command: 'devtunnel', args: ['--version'] },
  ];
  throw new TypeError(`Unsupported platform: ${String(platform)}`);
}
