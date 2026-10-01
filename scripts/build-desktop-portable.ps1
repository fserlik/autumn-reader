$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$localBuilds = Join-Path $projectRoot 'local-builds'
$generatedExe = Join-Path $projectRoot 'src-tauri\target\release\autumn-reader.exe'
$portableExe = Join-Path $localBuilds 'AutumnReader-PC-portable.exe'

$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
$env:PATH = "$cargoBin;$env:PATH"

& npm run tauri -- build --no-bundle --ci
if ($LASTEXITCODE -ne 0) { throw 'La compilación de Windows falló; no se borró ningún archivo.' }
if (-not (Test-Path -LiteralPath $generatedExe -PathType Leaf)) {
    throw "No se encontró el ejecutable compilado: $generatedExe"
}

New-Item -ItemType Directory -Path $localBuilds -Force | Out-Null
if (Test-Path -LiteralPath $portableExe -PathType Leaf) {
    $previousBuilds = Join-Path $localBuilds 'previous-builds'
    New-Item -ItemType Directory -Path $previousBuilds -Force | Out-Null
    $previousExe = Join-Path $previousBuilds "AutumnReader-PC-$(Get-Date -Format 'yyyyMMdd-HHmmss').exe"
    Copy-Item -LiteralPath $portableExe -Destination $previousExe
}
try {
    Copy-Item -LiteralPath $generatedExe -Destination $portableExe -Force
} catch {
    $runningPortable = Get-Process -Name 'AutumnReader-PC-portable' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -eq $portableExe }
    if (-not $runningPortable) { throw }
    # Windows locks running executables. Preserve the open app and stage a new version.
    $portableExe = Join-Path $localBuilds "AutumnReader-PC-portable-$(Get-Date -Format 'yyyyMMdd-HHmmss').exe"
    Copy-Item -LiteralPath $generatedExe -Destination $portableExe
    Write-Output 'La aplicación está abierta; se creó otra versión portable y se actualizará el acceso directo.'
}
$portableInfo = Get-Item -LiteralPath $portableExe
if ($portableInfo.Length -eq 0) { throw 'El ejecutable está vacío; no se borró ningún archivo.' }

$builtHash = (Get-FileHash -LiteralPath $generatedExe -Algorithm SHA256).Hash
$portableHash = (Get-FileHash -LiteralPath $portableExe -Algorithm SHA256).Hash
if ($builtHash -ne $portableHash) { throw 'La copia portable no coincide con el ejecutable compilado.' }
$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $localBuilds 'Autumn Reader.lnk'))
$shortcut.TargetPath = $portableExe
$shortcut.WorkingDirectory = $localBuilds
$shortcut.IconLocation = "$portableExe,0"
$shortcut.Save()

Write-Output "Ejecutable portable: $portableExe ($([math]::Round($portableInfo.Length / 1MB, 1)) MB)"
