param([switch]$UseExistingApk)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$localBuilds = Join-Path $projectRoot 'local-builds'
$savedApk = Join-Path $localBuilds 'AutumnReader-Android-ARM64-debug.apk'
$generatedApk = Join-Path $projectRoot 'src-tauri\gen\android\app\build\outputs\apk\universal\debug\app-universal-debug.apk'

if (-not $UseExistingApk) {
    $java17 = @($env:JAVA_HOME) + @(Get-ChildItem -LiteralPath (Join-Path $env:ProgramFiles 'Java') -Directory -Filter 'jdk-17*' -ErrorAction SilentlyContinue | ForEach-Object FullName) |
        Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ 'release') -PathType Leaf) -and (Select-String -LiteralPath (Join-Path $_ 'release') -Pattern '^JAVA_VERSION="17\.' -Quiet) } |
        Select-Object -First 1
    if (-not $java17) { throw 'Se necesita Java 17 para compilar Android.' }
    $env:JAVA_HOME = $java17
    $env:PATH = "$(Join-Path $java17 'bin');$env:PATH"
    if ($env:NDK_HOME -and -not (Test-Path -LiteralPath (Join-Path $env:NDK_HOME 'source.properties') -PathType Leaf)) {
        $installedNdk = Get-ChildItem -LiteralPath $env:NDK_HOME -Directory -ErrorAction SilentlyContinue |
            Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'source.properties') -PathType Leaf } |
            Sort-Object Name -Descending | Select-Object -First 1
        if (-not $installedNdk) { throw 'No se encontro una version instalada del Android NDK.' }
        $env:NDK_HOME = $installedNdk.FullName
    }
    & npm run tauri -- android build --debug --target aarch64 --apk --ci
    if ($LASTEXITCODE -ne 0) { throw 'La compilacion de Android fallo; no se borro ningun archivo.' }
    if (-not (Test-Path -LiteralPath $generatedApk -PathType Leaf)) {
        throw "No se encontro el APK compilado: $generatedApk"
    }
    New-Item -ItemType Directory -Path $localBuilds -Force | Out-Null
    Copy-Item -LiteralPath $generatedApk -Destination $savedApk -Force
}

if (-not (Test-Path -LiteralPath $savedApk -PathType Leaf)) {
    throw "No se encontro el APK que se debe conservar: $savedApk"
}

$apkInfo = Get-Item -LiteralPath $savedApk
if ($apkInfo.Length -eq 0) { throw 'El APK esta vacio; no se borro ningun archivo.' }

# Conservar el APK actual y el ejecutable portable de Windows.
Get-ChildItem -LiteralPath $localBuilds -File | Where-Object {
    $_.FullName -ne $apkInfo.FullName -and $_.Extension -in @('.apk', '.aab', '.msi', '.msix', '.dmg', '.deb', '.AppImage')
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
