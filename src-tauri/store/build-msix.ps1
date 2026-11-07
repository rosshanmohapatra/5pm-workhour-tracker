# Builds the Microsoft Store package: src-tauri/target/msix/5pm_<version>.0_x64.msix
#
#   powershell -File src-tauri/store/build-msix.ps1            build and pack
#   powershell -File src-tauri/store/build-msix.ps1 -Install   also install it on this PC to test
#
# Tauri can't bundle MSIX, so this builds the plain exe and packs it with
# Microsoft's makeappx. The package is unsigned: the Store signs it on upload.
# -Install registers the unpacked folder instead, which Windows allows without
# a signature only when Developer Mode is on (Settings › System › For developers).
param([switch]$Install)
$ErrorActionPreference = 'Stop'

$tauri  = Split-Path $PSScriptRoot -Parent
$repo   = Split-Path $tauri -Parent
$out    = Join-Path $tauri 'target\msix'
$layout = Join-Path $out 'layout'

# The Store wants four parts with the last one 0: 1.2.27 -> 1.2.27.0
$version = (Get-Content (Join-Path $tauri 'tauri.conf.json') -Raw | ConvertFrom-Json).version + '.0'

Push-Location $repo
try { npm run tauri -- build --no-bundle; if ($LASTEXITCODE) { throw 'tauri build failed' } }
finally { Pop-Location }

if (Test-Path $layout) { Remove-Item $layout -Recurse -Force }
New-Item -ItemType Directory -Force (Join-Path $layout 'Assets') | Out-Null
Copy-Item (Join-Path $tauri 'target\release\app.exe') (Join-Path $layout '5pm.exe')
foreach ($icon in 'StoreLogo', 'Square44x44Logo', 'Square71x71Logo', 'Square150x150Logo') {
  Copy-Item (Join-Path $tauri "icons\$icon.png") (Join-Path $layout 'Assets')
}
(Get-Content (Join-Path $PSScriptRoot 'AppxManifest.xml') -Raw).Replace('{VERSION}', $version) |
  Set-Content (Join-Path $layout 'AppxManifest.xml') -Encoding utf8

$makeappx = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\*\x64\makeappx.exe' |
  Sort-Object FullName | Select-Object -Last 1
if (-not $makeappx) { throw 'makeappx.exe not found. Install the Windows SDK.' }
$msix = Join-Path $out "5pm_${version}_x64.msix"
& $makeappx.FullName pack /o /d $layout /p $msix
if ($LASTEXITCODE) { throw 'makeappx failed' }
Write-Host "`nStore package: $msix"

if ($Install) {
  Add-AppxPackage -Register (Join-Path $layout 'AppxManifest.xml')
  Write-Host 'Installed. Open 5pm from the Start menu.'
}
