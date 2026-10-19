#requires -Version 5.1
<#
.SYNOPSIS
Installs the standalone dsh-rdl executable for the current Windows user.
.EXAMPLE
.\install-windows.ps1 -Version 0.1.0
.EXAMPLE
.\install-windows.ps1 -Version 0.1.0 -Force -AddToPath
.NOTES
Only Windows x64 is supported. No elevation, runtime installation, login,
service changes, machine PATH changes, or execution-policy changes are made.
SHA256 is checked against the companion GitHub release asset (not a signature).
Run from an account whose local profile and temporary directories are trusted;
path checks are not a defense against concurrent writes by that same account.
#>
[CmdletBinding()]
param(
    [ValidatePattern('\A[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\z')]
    [string] $Version = '0.1.0',
    [switch] $AddToPath,
    [switch] $Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-SafePath {
    param([Parameter(Mandatory = $true)][string] $Path, [switch] $File)
    # Walk from the volume root, including every existing ancestor and leaf.
    # Do not resolve links: resolving first would hide the reparse point.
    $full = [IO.Path]::GetFullPath($Path)
    if ($full -notmatch '^[A-Za-z]:\\' -or $full.Substring(3).Contains(':')) {
        throw "Only local, absolute drive paths are allowed: $Path"
    }
    $root = [IO.Path]::GetPathRoot($full)
    $parts = @($full.Substring($root.Length).Split([char]'\') | Where-Object { $_ -ne '' })
    $current = $root
    for ($i = -1; $i -lt $parts.Count; $i++) {
        if ($i -ge 0) { $current = [IO.Path]::Combine($current, $parts[$i]) }
        $item = $null
        try {
            $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        } catch [System.Management.Automation.ItemNotFoundException] {
            continue
        }
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Reparse points and symlinks are not allowed: $current"
        }
        $isLeafFile = $File -and ($i -eq ($parts.Count - 1))
        if ($isLeafFile) {
            if ($item.PSIsContainer) { throw "Expected a regular file: $current" }
        } elseif (-not $item.PSIsContainer) {
            throw "Expected a directory: $current"
        }
    }
}

function Assert-ExecutableVersion {
    param([string] $Executable, [string] $Expected)
    Assert-SafePath -Path $Executable -File
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $Executable
    $start.Arguments = '--version'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.WorkingDirectory = [IO.Path]::GetDirectoryName($Executable)
    # Do not let inherited Node options inject external code into a SEA binary.
    $start.EnvironmentVariables.Remove('NODE_OPTIONS')
    $start.EnvironmentVariables.Remove('NODE_PATH')
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $start
    try {
        if (-not $process.Start()) { throw 'Could not start downloaded executable.' }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(15000)) {
            $process.Kill()
            $process.WaitForExit()
            throw 'Downloaded executable --version timed out.'
        }
        $output = $stdout.GetAwaiter().GetResult().Trim()
        $errorOutput = $stderr.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0 -or $output -cne $Expected) {
            throw "Downloaded executable version check failed (expected $Expected; exit $($process.ExitCode))."
        }
    } finally {
        $process.Dispose()
    }
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'This installer supports Windows x64 only.'
}
# Machine-scoped architecture also rejects x64 emulation on ARM64 Windows.
$machineArchitecture = [Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITECTURE', 'Machine')
if (-not [Environment]::Is64BitOperatingSystem -or
    -not [Environment]::Is64BitProcess -or $machineArchitecture -ne 'AMD64') {
    throw 'Only native x64 Windows and a 64-bit PowerShell process are supported.'
}
$localAppData = [Environment]::GetFolderPath('LocalApplicationData')
if ([string]::IsNullOrWhiteSpace($localAppData)) { throw 'LocalAppData is unavailable.' }
$installDirectory = [IO.Path]::GetFullPath([IO.Path]::Combine($localAppData, 'Programs', 'dsh-rdl'))
$destination = [IO.Path]::Combine($installDirectory, 'dsh-rdl.exe')
Assert-SafePath -Path $installDirectory
Assert-SafePath -Path $destination -File
if ([IO.File]::Exists($destination) -and -not $Force) {
    throw 'dsh-rdl.exe already exists. Re-run with -Force to explicitly replace it.'
}

$asset = "dsh-remote-devtunnel-link-$Version-windows-x64.zip"
$tag = "dsh-remote-devtunnel-link-v$Version"
$baseUrl = "https://github.com/havoc-rao/dsh-devtunnel-ssh/releases/download/$tag"
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
Assert-SafePath -Path $tempRoot
$tempDirectory = [IO.Path]::Combine($tempRoot, ('dsh-rdl-install-' + [Guid]::NewGuid().ToString('N')))
$ownedTemp = $false
$archivePath = [IO.Path]::Combine($tempDirectory, $asset)
$checksumPath = $archivePath + '.sha256'
$candidate = [IO.Path]::Combine($tempDirectory, 'dsh-rdl.exe')
try {
    # No -Force: never reuse or claim ownership of an existing directory.
    New-Item -ItemType Directory -Path $tempDirectory -ErrorAction Stop | Out-Null
    $ownedTemp = $true
    Assert-SafePath -Path $tempDirectory
    # Keep platform TLS and certificate validation defaults; never bypass them.
    Invoke-WebRequest -Uri "$baseUrl/$asset" -OutFile $archivePath -UseBasicParsing -ErrorAction Stop
    Invoke-WebRequest -Uri "$baseUrl/$asset.sha256" -OutFile $checksumPath -UseBasicParsing -ErrorAction Stop
    Assert-SafePath -Path $archivePath -File
    Assert-SafePath -Path $checksumPath -File
    $checksumText = [IO.File]::ReadAllText($checksumPath).Trim()
    $checksumPattern = '\A([0-9a-fA-F]{64})(?:[ \t]+\*?' + [regex]::Escape($asset) + ')?\z'
    $checksumMatch = [regex]::Match($checksumText, $checksumPattern)
    if (-not $checksumMatch.Success) { throw 'Invalid SHA256 file or unexpected archive filename.' }
    $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
    if ($actualHash -ine $checksumMatch.Groups[1].Value) { throw 'Archive SHA256 mismatch.' }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        if ($zip.Entries.Count -ne 1 -or $zip.Entries[0].FullName -cne 'dsh-rdl.exe') {
            throw 'Archive must contain exactly one root entry named dsh-rdl.exe.'
        }
        $entry = $zip.Entries[0]
        # Reject Unix symlink/device/directory metadata and Windows reparse flags.
        $attributes = [int64]$entry.ExternalAttributes -band [int64]4294967295
        $unixType = ($attributes -shr 16) -band 0xf000
        if (($unixType -ne 0 -and $unixType -ne 0x8000) -or
            ($attributes -band 0x410) -ne 0 -or $entry.Length -le 0 -or
            $entry.Length -gt 536870912) {
            throw 'Archive entry must be a nonempty regular executable no larger than 512 MiB.'
        }
        # Never use ExtractToDirectory: no archive pathname is used as a target.
        Assert-SafePath -Path $candidate -File
        $inputStream = $entry.Open()
        try {
            $outputStream = [IO.File]::Open($candidate, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose() }
        } finally { $inputStream.Dispose() }
    } finally { $zip.Dispose() }

    Assert-ExecutableVersion -Executable $candidate -Expected $Version
    $candidateHash = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash
    # Recheck after network/process work, immediately before creating/copying.
    Assert-SafePath -Path $installDirectory
    Assert-SafePath -Path $destination -File
    if ([IO.File]::Exists($destination) -and -not $Force) {
        throw 'Destination appeared during installation; -Force is required to replace it.'
    }
    [IO.Directory]::CreateDirectory($installDirectory) | Out-Null
    Assert-SafePath -Path $installDirectory
    Assert-SafePath -Path $destination -File
    [IO.File]::Copy($candidate, $destination, [bool]$Force)
    Assert-SafePath -Path $destination -File
    if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ine $candidateHash) {
        throw 'Installed executable SHA256 does not match the verified candidate.'
    }

    if ($AddToPath) {
        # Only the persistent current-user PATH, never the Machine target.
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        $alreadyPresent = $false
        foreach ($segment in @($userPath -split ';')) {
            $expanded = [Environment]::ExpandEnvironmentVariables($segment.Trim().Trim('"')).TrimEnd('\')
            if ($expanded -ieq $installDirectory.TrimEnd('\')) { $alreadyPresent = $true }
        }
        if (-not $alreadyPresent) {
            $newPath = $installDirectory
            if (-not [string]::IsNullOrEmpty($userPath)) {
                $separator = ';'
                if ($userPath.EndsWith(';')) { $separator = '' }
                $newPath = $userPath + $separator + $installDirectory
            }
            [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
        }
        Write-Host 'User PATH includes the install directory. Open a new terminal to use it.'
    }
    Write-Host "Installed dsh-rdl $Version to $destination"
    if (-not $AddToPath) { Write-Host 'PATH was not changed. Use the full executable path, or opt in with -AddToPath.' }
} finally {
    if ($ownedTemp) {
        # Only our GUID directory and three known files; no recursive deletion.
        # Unexpected content is left untouched, never traversed or removed.
        try {
            if ([IO.Path]::GetDirectoryName($tempDirectory) -cne $tempRoot.TrimEnd('\') -or
                [IO.Path]::GetFileName($tempDirectory) -notmatch '^dsh-rdl-install-[0-9a-f]{32}$') {
                throw 'Refusing cleanup outside the owned temporary directory.'
            }
            Assert-SafePath -Path $tempDirectory
            foreach ($file in @($archivePath, $checksumPath, $candidate)) {
                Assert-SafePath -Path $file -File
                if ([IO.File]::Exists($file)) { [IO.File]::Delete($file) }
            }
            [IO.Directory]::Delete($tempDirectory, $false)
        } catch {
            Write-Warning "Temporary cleanup refused or failed: $($_.Exception.Message)"
        }
    }
}
