[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PlanPath
)

$ErrorActionPreference = 'Stop'
$plan = $null
$statusPath = ''
$lockPath = ''
$pluginRoot = ''
$preparedPluginRoot = ''
$backupPluginRoot = ''
$newPluginInstalled = $false
$oldPluginMoved = $false
$installSucceeded = $false
$hostExitObserved = $false
$failureReason = ''

function Get-FullPath {
    param([string]$Value)
    return [IO.Path]::GetFullPath($Value)
}

function Test-PathEqual {
    param([string]$Left, [string]$Right)
    return [string]::Equals(
        (Get-FullPath $Left),
        (Get-FullPath $Right),
        [StringComparison]::OrdinalIgnoreCase
    )
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

function Assert-DirectChildPath {
    param([string]$Root, [string]$Candidate)
    $candidatePath = Assert-ChildPath $Root $Candidate
    if (-not (Test-PathEqual (Split-Path -Parent $candidatePath) $Root)) {
        throw 'unsafe-plugin-path'
    }
    return $candidatePath
}

function Get-PluginManifest {
    param([string]$Root)
    $manifestPath = Join-Path $Root 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw 'installed-plugin-missing'
    }
    return Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Assert-PluginIdentity {
    param(
        [string]$Root,
        [string]$ExpectedSlug,
        [string]$ExpectedVersion = ''
    )
    $manifest = Get-PluginManifest $Root
    if ([string]$manifest.slug -ne $ExpectedSlug -or
        ($ExpectedVersion -and [string]$manifest.version -ne $ExpectedVersion)) {
        throw 'plugin-identity-mismatch'
    }
}

function Write-InstallStatus {
    param(
        [string]$Status,
        [string]$Reason = '',
        [string]$InstalledPluginRoot = ''
    )
    if (-not $statusPath -or -not $plan) {
        return
    }
    $value = [ordered]@{
        schemaVersion = 3
        status = $Status
        reason = $Reason
        version = [string]$plan.version
        installedPluginRoot = $InstalledPluginRoot
        backupPluginRoot = $backupPluginRoot
        updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    } | ConvertTo-Json -Depth 4
    $temporaryPath = "$statusPath.$PID.tmp"
    [IO.File]::WriteAllText($temporaryPath, $value, [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporaryPath -Destination $statusPath -Force
}

try {
    $plan = Get-Content -LiteralPath $PlanPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([int]$plan.schemaVersion -ne 3) {
        throw 'unsupported-plan'
    }

    $updateRoot = Get-FullPath ([string]$plan.updateRoot)
    $pluginParent = Get-FullPath ([string]$plan.pluginParent)
    $planPath = Assert-ChildPath $updateRoot $PlanPath
    $statusPath = Assert-ChildPath $updateRoot ([string]$plan.statusPath)
    $pluginRoot = Assert-DirectChildPath $pluginParent ([string]$plan.pluginRoot)
    $preparedPluginRoot = Assert-DirectChildPath $pluginParent ([string]$plan.preparedPluginRoot)
    $backupPluginRoot = Assert-DirectChildPath $pluginParent ([string]$plan.backupPluginRoot)
    $nonce = [string]$plan.nonce
    $slug = [string]$plan.slug
    $version = [string]$plan.version
    $hostExecutable = Get-FullPath ([string]$plan.hostExecutable)
    $shouldRelaunch = [bool]$plan.relaunch
    $lockPath = Join-Path $updateRoot 'install.lock'

    if ($nonce -notmatch '^\d+-[0-9a-f]{8}$' -or $slug -ne 'qqnt_toolbox' -or
        (Split-Path -Leaf $preparedPluginRoot) -ne ".qqnt-toolbox-update-$nonce" -or
        (Split-Path -Leaf $backupPluginRoot) -ne ".qqnt-toolbox-backup-$nonce") {
        throw 'invalid-plan'
    }
    if ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -gt [long]$plan.launchDeadlineAt) {
        throw 'installer-start-expired'
    }
    if ($shouldRelaunch -and -not (Test-Path -LiteralPath $hostExecutable -PathType Leaf)) {
        throw 'host-executable-missing'
    }

    New-Item -ItemType Directory -Path $updateRoot -Force | Out-Null
    try {
        New-Item -ItemType Directory -Path $lockPath -ErrorAction Stop | Out-Null
    } catch {
        throw 'installer-already-running'
    }

    Write-InstallStatus 'waiting'
    $processIds = @($plan.processIds | ForEach-Object { [int]$_ } | Where-Object { $_ -gt 0 } | Sort-Object -Unique)
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    do {
        $runningProcessIds = @()
        foreach ($processIdentifier in $processIds) {
            if (Get-Process -Id $processIdentifier -ErrorAction SilentlyContinue) {
                $runningProcessIds += $processIdentifier
            }
        }
        if (-not $runningProcessIds.Count) {
            break
        }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $deadline)
    if ($runningProcessIds.Count) {
        throw 'host-still-running'
    }
    $hostExitObserved = $true

    Write-InstallStatus 'installing'
    Assert-PluginIdentity $pluginRoot $slug
    Assert-PluginIdentity $preparedPluginRoot $slug $version
    foreach ($relativePath in @($plan.requiredFiles)) {
        $relative = [string]$relativePath
        if (-not $relative -or [IO.Path]::IsPathRooted($relative) -or
            @($relative -split '[\\/]' | Where-Object { $_ -eq '..' }).Count) {
            throw 'unsafe-required-file'
        }
        if (-not (Test-Path -LiteralPath (Join-Path $preparedPluginRoot $relative) -PathType Leaf)) {
            throw 'incomplete-plugin-package'
        }
    }
    if (Test-Path -LiteralPath $backupPluginRoot) {
        throw 'backup-target-exists'
    }

    Move-Item -LiteralPath $pluginRoot -Destination $backupPluginRoot
    $oldPluginMoved = $true
    Move-Item -LiteralPath $preparedPluginRoot -Destination $pluginRoot
    $newPluginInstalled = $true
    Assert-PluginIdentity $pluginRoot $slug $version
    Write-InstallStatus 'installed' '' $pluginRoot
    $installSucceeded = $true
} catch {
    $failureReason = [string]$_.Exception.Message
    try {
        if ($newPluginInstalled -and (Test-Path -LiteralPath $pluginRoot)) {
            Remove-Item -LiteralPath $pluginRoot -Recurse -Force
            $newPluginInstalled = $false
        }
        if ($oldPluginMoved -and (Test-Path -LiteralPath $backupPluginRoot)) {
            if (Test-Path -LiteralPath $pluginRoot) {
                throw 'activation-rollback-target-exists'
            }
            Move-Item -LiteralPath $backupPluginRoot -Destination $pluginRoot
            $oldPluginMoved = $false
        }
    } catch {
        $failureReason = "activation-rollback-failed: $($_.Exception.Message); original: $failureReason"
    }
    try {
        Write-InstallStatus 'failed' $failureReason
    } catch {
    }
} finally {
    if ($lockPath) {
        Remove-Item -LiteralPath $lockPath -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if ($plan -and [bool]$plan.relaunch -and $hostExitObserved) {
    try {
        Start-Process -FilePath ([string]$plan.hostExecutable) -WorkingDirectory (Split-Path -Parent ([string]$plan.hostExecutable)) -WindowStyle Hidden
    } catch {
        $relaunchReason = "relaunch-failed: $($_.Exception.Message)"
        try {
            if ($installSucceeded) {
                Write-InstallStatus 'installed' $relaunchReason $pluginRoot
            } else {
                Write-InstallStatus 'failed' "$failureReason; $relaunchReason"
            }
        } catch {
        }
    }
}
