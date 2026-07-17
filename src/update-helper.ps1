[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PlanPath
)

$ErrorActionPreference = 'Stop'

function Get-FullPath {
    param([string]$Value)
    return [IO.Path]::GetFullPath($Value)
}

function Assert-ChildPath {
    param([string]$Root, [string]$Candidate)
    $rootPath = (Get-FullPath $Root).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $candidatePath = Get-FullPath $Candidate
    $prefix = $rootPath + [IO.Path]::DirectorySeparatorChar
    if (-not $candidatePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'unsafe-path'
    }
    return $candidatePath
}

function Write-InstallStatus {
    param([string]$Status, [string]$Reason = '')
    $value = @{
        status = $Status
        reason = $Reason
        version = [string]$plan.version
        updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    } | ConvertTo-Json
    $temporaryPath = "$statusPath.tmp"
    [IO.File]::WriteAllText($temporaryPath, $value, [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporaryPath -Destination $statusPath -Force
}

$plan = Get-Content -LiteralPath $PlanPath -Raw -Encoding UTF8 | ConvertFrom-Json
$updateRoot = Get-FullPath ([string]$plan.updateRoot)
$pluginRoot = Get-FullPath ([string]$plan.pluginRoot)
$pluginParent = Split-Path -Parent $pluginRoot
$stagedPluginRoot = Assert-ChildPath $updateRoot ([string]$plan.stagedPluginRoot)
$backupRoot = Assert-ChildPath $updateRoot ([string]$plan.backupRoot)
$pendingPath = Assert-ChildPath $updateRoot ([string]$plan.pendingPath)
$statusPath = Assert-ChildPath $updateRoot ([string]$plan.statusPath)
$lockPath = Join-Path $updateRoot 'install.lock'
$nonce = [string]$plan.nonce
if ($nonce -notmatch '^[0-9]+-[0-9]+$' -or -not (Split-Path -Leaf $pluginRoot)) {
    throw 'invalid-plan'
}
$newRoot = Join-Path $pluginParent ".qqnt-toolbox-update-$nonce"
$oldRoot = Join-Path $pluginParent ".qqnt-toolbox-old-$nonce"
$oldManifest = Join-Path $oldRoot 'manifest.json'
$disabledOldManifest = Join-Path $oldRoot 'manifest.json.disabled'

New-Item -ItemType Directory -Path $updateRoot -Force | Out-Null
try {
    New-Item -ItemType Directory -Path $lockPath -ErrorAction Stop | Out-Null
} catch {
    exit 0
}

try {
    Write-InstallStatus 'waiting'
    $processId = [int]$plan.processId
    if ($processId -gt 0) {
        Wait-Process -Id $processId -ErrorAction SilentlyContinue
    }

    $hostExecutable = Get-FullPath ([string]$plan.hostExecutable)
    $hostName = [IO.Path]::GetFileNameWithoutExtension($hostExecutable)
    $deadline = [DateTime]::UtcNow.AddMinutes(3)
    do {
        $running = @(Get-Process -Name $hostName -ErrorAction SilentlyContinue | Where-Object {
            try {
                (Get-FullPath $_.Path) -ieq $hostExecutable
            } catch {
                $true
            }
        })
        if (-not $running.Count) {
            break
        }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    if ($running.Count) {
        throw 'host-still-running'
    }

    $stagedManifest = Get-Content -LiteralPath (Join-Path $stagedPluginRoot 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([string]$stagedManifest.slug -ne [string]$plan.slug -or
        [string]$stagedManifest.version -ne [string]$plan.version) {
        throw 'staged-plugin-mismatch'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $pluginRoot 'manifest.json') -PathType Leaf)) {
        throw 'installed-plugin-missing'
    }

    foreach ($target in @($newRoot, $oldRoot)) {
        if (Test-Path -LiteralPath $target) {
            Remove-Item -LiteralPath $target -Recurse -Force
        }
    }
    New-Item -ItemType Directory -Path $newRoot -Force | Out-Null
    Get-ChildItem -LiteralPath $stagedPluginRoot -Force | Copy-Item -Destination $newRoot -Recurse -Force
    $newManifest = Get-Content -LiteralPath (Join-Path $newRoot 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([string]$newManifest.slug -ne [string]$plan.slug -or
        [string]$newManifest.version -ne [string]$plan.version) {
        throw 'copied-plugin-mismatch'
    }

    if (Test-Path -LiteralPath $backupRoot) {
        Remove-Item -LiteralPath $backupRoot -Recurse -Force
    }
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    Get-ChildItem -LiteralPath $pluginRoot -Force | Copy-Item -Destination $backupRoot -Recurse -Force

    Move-Item -LiteralPath $pluginRoot -Destination $oldRoot
    Move-Item -LiteralPath $oldManifest -Destination $disabledOldManifest
    try {
        Move-Item -LiteralPath $newRoot -Destination $pluginRoot
    } catch {
        if (Test-Path -LiteralPath $disabledOldManifest) {
            Move-Item -LiteralPath $disabledOldManifest -Destination $oldManifest
        }
        if (-not (Test-Path -LiteralPath $pluginRoot) -and (Test-Path -LiteralPath $oldRoot)) {
            Move-Item -LiteralPath $oldRoot -Destination $pluginRoot
        }
        throw
    }

    Remove-Item -LiteralPath $pendingPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $stagedPluginRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $oldRoot -Recurse -Force -ErrorAction SilentlyContinue
    Write-InstallStatus 'installed'
} catch {
    if (-not (Test-Path -LiteralPath $pluginRoot) -and (Test-Path -LiteralPath $oldRoot)) {
        if (Test-Path -LiteralPath $disabledOldManifest) {
            Move-Item -LiteralPath $disabledOldManifest -Destination $oldManifest -Force
        }
        Move-Item -LiteralPath $oldRoot -Destination $pluginRoot -Force
    }
    Write-InstallStatus 'failed' ([string]$_.Exception.Message)
} finally {
    if (Test-Path -LiteralPath $newRoot) {
        Remove-Item -LiteralPath $newRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}
