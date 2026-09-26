param([switch]$UseExistingApk)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$localBuilds = Join-Path $projectRoot 'local-builds'
$savedApk = Join-Path $localBuilds 'AutumnReader-Android-ARM64-debug.apk'
$generatedApk = Join-Path $projectRoot 'src-tauri\gen\android\app\build\outputs\apk\universal\debug\app-universal-debug.apk'

if (-not $UseExistingApk) {
    & npm run tauri -- android build --debug --target aarch64 --apk --ci
    if ($LASTEXITCODE -ne 0) { throw 'La compilación de Android falló; no se borró ningún archivo.' }
    if (-not (Test-Path -LiteralPath $generatedApk -PathType Leaf)) {
        throw "No se encontró el APK compilado: $generatedApk"
    }
    New-Item -ItemType Directory -Path $localBuilds -Force | Out-Null
    Copy-Item -LiteralPath $generatedApk -Destination $savedApk -Force
}

if (-not (Test-Path -LiteralPath $savedApk -PathType Leaf)) {
    throw "No se encontró el APK que se debe conservar: $savedApk"
}

$apkInfo = Get-Item -LiteralPath $savedApk
if ($apkInfo.Length -eq 0) { throw 'El APK está vacío; no se borró ningún archivo.' }

# Conservar un único instalador local y liberar los compilados y cachés del proyecto.
Get-ChildItem -LiteralPath $localBuilds -File | Where-Object {
    $_.FullName -ne $apkInfo.FullName -and $_.Extension -in @('.apk', '.aab', '.exe', '.msi', '.msix', '.dmg', '.deb', '.AppImage')
} | Remove-Item -Force

$generatedDirectories = @(
    'src-tauri\target',
    'src-tauri\gen\android\app\build',
    'src-tauri\gen\android\build',
    'src-tauri\gen\android\buildSrc\build',
    'src-tauri\gen\android\.gradle',
    'src-tauri\gen\android\buildSrc\.gradle',
    'dist'
)

foreach ($relative in $generatedDirectories) {
    $candidate = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $relative))
    if (-not $candidate.StartsWith($projectRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Ruta fuera del proyecto: $candidate"
    }
    if (Test-Path -LiteralPath $candidate) {
        $item = Get-Item -LiteralPath $candidate -Force
        if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw "Ruta enlazada: $candidate" }
        Remove-Item -LiteralPath $candidate -Recurse -Force
    }
}

Write-Output "APK conservado: $savedApk ($([math]::Round($apkInfo.Length / 1MB, 1)) MB)"
