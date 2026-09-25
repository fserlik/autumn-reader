param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]*$')]
  [string]$IdentityName,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^CN=.+')]
  [string]$Publisher,

  [string]$PublisherDisplayName = 'Facundo Serlik',
  [string]$PackageVersion = '1.0.0.0',
  [switch]$SkipBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$version = [Version]$PackageVersion
if ($version.Major -lt 1 -or $version.Revision -ne 0) {
  throw 'La versión de Microsoft Store debe empezar en 1 o más y terminar en .0 (por ejemplo, 1.0.0.0).'
}

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if (Test-Path -LiteralPath $cargoBin) {
  $env:PATH = "$cargoBin;$env:PATH"
}

if (-not $SkipBuild) {
  $envFile = Join-Path $projectRoot '.env'
  if (-not $env:AUTUMN_GOOGLE_CLIENT_SECRET -and (Test-Path -LiteralPath $envFile)) {
    $secretLine = Get-Content -LiteralPath $envFile -Encoding UTF8 |
      Where-Object { $_ -match '^\s*AUTUMN_GOOGLE_CLIENT_SECRET\s*=' } |
      Select-Object -Last 1
    if ($secretLine) {
      $env:AUTUMN_GOOGLE_CLIENT_SECRET = ($secretLine -replace '^\s*AUTUMN_GOOGLE_CLIENT_SECRET\s*=\s*', '').Trim().Trim('"', "'")
    }
  }
  if (-not $env:AUTUMN_GOOGLE_CLIENT_SECRET) {
    throw 'Falta AUTUMN_GOOGLE_CLIENT_SECRET para compilar la conexión con Google Drive.'
  }
  Push-Location $projectRoot
  try {
    & npm run tauri -- build --no-bundle
    if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación de Autumn Reader.' }
  } finally {
    Pop-Location
  }
}

$executable = Join-Path $projectRoot 'src-tauri\target\release\autumn-reader.exe'
if (-not (Test-Path -LiteralPath $executable)) {
  throw 'No se encontró el ejecutable de Autumn Reader. Compila la aplicación antes de empaquetarla.'
}

$sdkBin = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
$makeAppx = Get-ChildItem -LiteralPath $sdkBin -Filter MakeAppx.exe -Recurse -File |
  Where-Object { $_.FullName -match '\\x64\\MakeAppx\.exe$' } |
  Sort-Object FullName -Descending |
  Select-Object -First 1
if (-not $makeAppx) { throw 'No se encontró MakeAppx.exe. Instala el Windows SDK.' }

$outputRoot = Join-Path $projectRoot 'dist\store-msix'
$stage = Join-Path $outputRoot ([guid]::NewGuid().ToString('N'))
$assets = Join-Path $stage 'Assets'
New-Item -ItemType Directory -Path $assets -Force | Out-Null
Copy-Item -LiteralPath $executable -Destination (Join-Path $stage 'autumn-reader.exe')

$icons = @('StoreLogo.png', 'Square150x150Logo.png', 'Square44x44Logo.png')
foreach ($icon in $icons) {
  Copy-Item -LiteralPath (Join-Path $projectRoot "src-tauri\icons\$icon") -Destination (Join-Path $assets $icon)
}

function XmlEscape([string]$value) {
  return [System.Security.SecurityElement]::Escape($value)
}

$manifest = @'
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
         xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
         xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10"
         xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities">
  <Identity Name="__IDENTITY__" Publisher="__PUBLISHER__" Version="__VERSION__" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>Autumn Reader</DisplayName>
    <PublisherDisplayName>__PUBLISHER_DISPLAY__</PublisherDisplayName>
    <Description>Lector de libros de escritorio</Description>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>
  <Resources>
    <Resource Language="es-AR" />
  </Resources>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Applications>
    <Application Id="AutumnReader" Executable="autumn-reader.exe"
                 uap10:RuntimeBehavior="packagedClassicApp" uap10:TrustLevel="mediumIL">
      <uap:VisualElements DisplayName="Autumn Reader" Description="Lector de libros de escritorio"
                          Square150x150Logo="Assets\Square150x150Logo.png"
                          Square44x44Logo="Assets\Square44x44Logo.png"
                          BackgroundColor="#351b1f" />
    </Application>
  </Applications>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
'@
$manifest = $manifest.Replace('__IDENTITY__', (XmlEscape $IdentityName))
$manifest = $manifest.Replace('__PUBLISHER__', (XmlEscape $Publisher))
$manifest = $manifest.Replace('__VERSION__', (XmlEscape $PackageVersion))
$manifest = $manifest.Replace('__PUBLISHER_DISPLAY__', (XmlEscape $PublisherDisplayName))
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText((Join-Path $stage 'AppxManifest.xml'), $manifest, $utf8)

$package = Join-Path $outputRoot "AutumnReader_${PackageVersion}_x64.msix"
& $makeAppx.FullName pack /d $stage /p $package /o
if ($LASTEXITCODE -ne 0) { throw 'MakeAppx no pudo crear el paquete MSIX.' }

$file = Get-Item -LiteralPath $package
$hash = Get-FileHash -LiteralPath $package -Algorithm SHA256
Write-Output "MSIX: $($file.FullName)"
Write-Output "Tamaño: $($file.Length) bytes"
Write-Output "SHA256: $($hash.Hash)"
Write-Output 'El paquete queda sin firmar; Microsoft Store lo firma tras la certificación.'
