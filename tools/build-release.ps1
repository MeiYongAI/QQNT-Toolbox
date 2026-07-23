[CmdletBinding()]
param(
    [string]$Version
)

$ErrorActionPreference = 'Stop'

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$manifest = Get-Content -LiteralPath (Join-Path $repoRoot 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$package = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json

if (-not $Version) {
    $Version = [string]$manifest.version
}
if ($Version -ne [string]$manifest.version -or $Version -ne [string]$package.version) {
    throw "Release version does not match manifest.json and package.json."
}

$releaseRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot 'release'))
$distRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot 'dist'))
$rootPrefix = $repoRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
foreach ($target in @($releaseRoot, $distRoot)) {
    if (-not $target.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Release path escaped the repository: $target"
    }
}

if (Test-Path -LiteralPath $releaseRoot) {
    Remove-Item -LiteralPath $releaseRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $releaseRoot, $distRoot -Force | Out-Null

$pluginRoot = Join-Path $releaseRoot 'QQNT-Toolbox'
New-Item -ItemType Directory -Path $pluginRoot -Force | Out-Null

function Copy-ReleaseFile {
    param([string]$RelativePath)

    $source = Join-Path $repoRoot $RelativePath
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Missing release file: $RelativePath"
    }
    $destination = Join-Path $pluginRoot $RelativePath
    New-Item -ItemType Directory -Path (Split-Path $destination) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
}

$runtimeFiles = @(
    'LICENSE',
    'README.md',
    'manifest.json',
    'package.json',
    'native/poke-bridge.win32-x64.node',
    'node_modules/@saltify/typeproto/LICENSE',
    'node_modules/@saltify/typeproto/package.json',
    'node_modules/@saltify/typeproto/dist/index.mjs',
    'node_modules/@zip.js/zip.js/LICENSE',
    'node_modules/@zip.js/zip.js/index.cjs',
    'node_modules/@zip.js/zip.js/package.json',
    'node_modules/silk-wasm/LICENSE',
    'node_modules/silk-wasm/package.json',
    'node_modules/silk-wasm/lib/index.cjs',
    'node_modules/silk-wasm/lib/silk_wasm.wasm'
)
$runtimeFiles | ForEach-Object { Copy-ReleaseFile $_ }
Get-ChildItem -LiteralPath (Join-Path $repoRoot 'src') -Recurse -File | ForEach-Object {
    if (-not $_.FullName.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Source file escaped the repository: $($_.FullName)"
    }
    Copy-ReleaseFile $_.FullName.Substring($rootPrefix.Length)
}

$assetPath = Join-Path $distRoot "QQNT-Toolbox-v$Version.zip"
if (Test-Path -LiteralPath $assetPath) {
    Remove-Item -LiteralPath $assetPath -Force
}
Compress-Archive -LiteralPath $pluginRoot -DestinationPath $assetPath -CompressionLevel Optimal

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($assetPath)
try {
    $entries = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
    $forbidden = @($entries | Where-Object {
        $_ -match '^QQNT-Toolbox/(dist|release)/' -or
        $_ -match '\.(log|tmp)$' -or
        $_ -match 'poke-bridge\.(cpp|obj)$' -or
        $_ -match '(^|/)build\.cmd$'
    })
    if ($forbidden.Count) {
        throw "Forbidden files in release: $($forbidden -join ', ')"
    }
    foreach ($required in @(
        'QQNT-Toolbox/manifest.json',
        'QQNT-Toolbox/src/ipc-channels.js',
        'QQNT-Toolbox/src/qr-scan.js',
        'QQNT-Toolbox/src/qr-result-dialog.js',
        'QQNT-Toolbox/src/media-session.js',
        'QQNT-Toolbox/src/media-viewer.html',
        'QQNT-Toolbox/src/media-viewer.css',
        'QQNT-Toolbox/src/media-viewer.js',
        'QQNT-Toolbox/src/media-viewer-preload.js',
        'QQNT-Toolbox/src/media-pip.html',
        'QQNT-Toolbox/src/media-pip.css',
        'QQNT-Toolbox/src/media-pip.js',
        'QQNT-Toolbox/src/media-pip-preload.js',
        'QQNT-Toolbox/src/media-pip-window.js',
        'QQNT-Toolbox/src/media-player-icons/player_fullscreen.png',
        'QQNT-Toolbox/src/media-player-icons/player_minimize.png',
        'QQNT-Toolbox/src/media-player-icons/player_pause_big.png',
        'QQNT-Toolbox/src/media-player-icons/player_pip.png',
        'QQNT-Toolbox/src/media-player-icons/player_pip_close.png',
        'QQNT-Toolbox/src/media-player-icons/player_pip_enlarge.png',
        'QQNT-Toolbox/src/media-player-icons/player_pip_pause.png',
        'QQNT-Toolbox/src/media-player-icons/player_pip_play.png',
        'QQNT-Toolbox/src/media-player-icons/player_play_big.png',
        'QQNT-Toolbox/src/media-player-icons/player_settings.png',
        'QQNT-Toolbox/src/media-player-icons/player_volume_off.png',
        'QQNT-Toolbox/src/media-player-icons/player_volume_on.png',
        'QQNT-Toolbox/src/media-player-icons/player_volume_small.png',
        'QQNT-Toolbox/src/media-player-icons/README.txt',
        'QQNT-Toolbox/src/fake-forward-editor.css',
        'QQNT-Toolbox/src/fake-forward-editor.js',
        'QQNT-Toolbox/src/fake-forward.js',
        'QQNT-Toolbox/src/file-retry.js',
        'QQNT-Toolbox/src/native-ipc.js',
        'QQNT-Toolbox/src/plugin-updater.js',
        'QQNT-Toolbox/src/prevent-recall.js',
        'QQNT-Toolbox/src/recall-filter-editor.js',
        'QQNT-Toolbox/src/qq-data-root.js',
        'QQNT-Toolbox/src/recall-image-url.js',
        'QQNT-Toolbox/src/recall-viewer.html',
        'QQNT-Toolbox/src/recall-viewer.js',
        'QQNT-Toolbox/src/recall-viewer-preload.js',
        'QQNT-Toolbox/src/reaction-catalog.js',
        'QQNT-Toolbox/src/reaction-limit.js',
        'QQNT-Toolbox/src/repeat-message.js',
        'QQNT-Toolbox/src/single-forward-window.js',
        'QQNT-Toolbox/src/settings.css',
        'QQNT-Toolbox/src/voice/media.js',
        'QQNT-Toolbox/src/voice/ptt-source.js',
        'QQNT-Toolbox/src/voice/renderer-ui.js',
        'QQNT-Toolbox/native/poke-bridge.win32-x64.node',
        'QQNT-Toolbox/node_modules/@saltify/typeproto/package.json',
        'QQNT-Toolbox/node_modules/@saltify/typeproto/dist/index.mjs',
        'QQNT-Toolbox/node_modules/silk-wasm/lib/silk_wasm.wasm'
    )) {
        if ($required -notin $entries) {
            throw "Required release file is missing: $required"
        }
    }
}
finally {
    $archive.Dispose()
}

$hash = Get-FileHash -LiteralPath $assetPath -Algorithm SHA256
[PSCustomObject]@{
    Asset = $assetPath
    Size = (Get-Item -LiteralPath $assetPath).Length
    SHA256 = $hash.Hash
}
