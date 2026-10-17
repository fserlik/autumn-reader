param([switch]$Force)

$ErrorActionPreference = 'Stop'

$sherpaVersion = '1.13.8'
$archiveName = "sherpa-onnx-$sherpaVersion.aar"
$archiveUrl = "https://github.com/k2-fsa/sherpa-onnx/releases/download/v$sherpaVersion/$archiveName"
$archiveSha256 = '633c24321e06b1fe79feafa03ea16cbc0f8a286641e2da3559bac91bdb13bd96'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$jniRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'src-tauri\gen\android\app\src\main\jniLibs'))
$destination = Join-Path $jniRoot 'arm64-v8a'
$marker = Join-Path $destination '.sherpa-onnx-version'
$requiredLibraries = @(
    'libonnxruntime.so',
    'libsherpa-onnx-c-api.so',
    'libsherpa-onnx-cxx-api.so',
    'libsherpa-onnx-jni.so'
)

$isPrepared = (Test-Path -LiteralPath $marker -PathType Leaf) -and
    ((Get-Content -LiteralPath $marker -Raw).Trim() -eq "sherpa-onnx-v$sherpaVersion-android")
foreach ($library in $requiredLibraries) {
    $libraryPath = Join-Path $destination $library
    $isPrepared = $isPrepared -and (Test-Path -LiteralPath $libraryPath -PathType Leaf) -and
        ((Get-Item -LiteralPath $libraryPath).Length -gt 0)
}

if ($isPrepared -and -not $Force) {
    Write-Output "sherpa-onnx Android $sherpaVersion ya esta preparado."
    exit 0
}

$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$workDirectory = [System.IO.Path]::GetFullPath((Join-Path $tempRoot ("autumn-reader-sherpa-" + [guid]::NewGuid().ToString('N'))))
if (-not $workDirectory.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Directorio temporal fuera de la ruta esperada: $workDirectory"
}

try {
    New-Item -ItemType Directory -Path $workDirectory -Force | Out-Null
    $archivePath = Join-Path $workDirectory $archiveName
    $extractPath = Join-Path $workDirectory 'extracted'
    New-Item -ItemType Directory -Path $extractPath -Force | Out-Null

    Write-Output "Descargando sherpa-onnx Android $sherpaVersion..."
    Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath -UseBasicParsing
    $actualSha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSha256 -ne $archiveSha256) {
        throw "SHA-256 invalido para $archiveName. Esperado $archiveSha256; recibido $actualSha256."
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($archivePath, $extractPath)

    $source = Join-Path $extractPath 'jni\arm64-v8a'
    foreach ($library in $requiredLibraries) {
        $sourcePath = Join-Path $source $library
        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf) -or (Get-Item -LiteralPath $sourcePath).Length -eq 0) {
            throw "El paquete Android no contiene una biblioteca valida: $library"
        }
    }

    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    foreach ($library in $requiredLibraries) {
        Copy-Item -LiteralPath (Join-Path $source $library) -Destination (Join-Path $destination $library) -Force
    }
    Set-Content -LiteralPath $marker -Value "sherpa-onnx-v$sherpaVersion-android" -Encoding Ascii
    Write-Output "sherpa-onnx Android $sherpaVersion preparado y verificado."
}
finally {
    if (Test-Path -LiteralPath $workDirectory) {
        $resolvedWorkDirectory = [System.IO.Path]::GetFullPath($workDirectory)
        if (-not $resolvedWorkDirectory.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Se rechazo limpiar una ruta fuera del directorio temporal: $resolvedWorkDirectory"
        }
        Remove-Item -LiteralPath $resolvedWorkDirectory -Recurse -Force
    }
}
