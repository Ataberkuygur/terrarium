# Builds release/Terrarium-Kurulum.zip (setup exe + installer scripts).
# Run via `pnpm dist:share` (which runs dist:win first).
$root = Split-Path -Parent $PSScriptRoot
$rel = Join-Path $root 'release'
$ver = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$stage = Join-Path $rel 'Terrarium-Kurulum'
New-Item -ItemType Directory -Force $stage | Out-Null
Get-ChildItem $stage -Filter 'Terrarium-Setup-*.exe' | ForEach-Object { $_.Delete() }
Copy-Item (Join-Path $rel "Terrarium-Setup-$ver.exe") $stage
Copy-Item (Join-Path $PSScriptRoot 'KUR.cmd'), (Join-Path $PSScriptRoot 'kurulum.ps1'), (Join-Path $PSScriptRoot 'OKU-BENI.txt') $stage
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath (Join-Path $rel 'Terrarium-Kurulum.zip') -Force
Write-Host "ready: $(Join-Path $rel 'Terrarium-Kurulum.zip')"
