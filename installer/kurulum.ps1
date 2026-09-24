# Terrarium - tek tik kurulum
# Bu klasordeki Terrarium-Setup-*.exe'yi kurar, gereken araclari (Git, Python,
# Claude Code) yukler ve Terrarium MCP sunucusunu Claude Code'a kaydeder.
# Tekrar calistirmak guvenlidir: kurulu olanlari atlar.

$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "    $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    $msg" -ForegroundColor Yellow }
function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path', 'User') + ';' +
              "$env:USERPROFILE\.local\bin"
}
function Winget-Install($id, $name) {
  if (-not (Has 'winget')) { Warn "winget yok - $name'i elle kur."; return }
  Write-Host "    $name kuruluyor (winget $id)..."
  winget install --id $id -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
  Refresh-Path
}

Step 'Git'
if (Has 'git') { Ok 'zaten kurulu' } else { Winget-Install 'Git.Git' 'Git' }

Step 'Python (ses/dikte ozelligi icin)'
$py = $null
foreach ($c in 'python', 'py') {
  try { $v = & $c -c "import sys;print(sys.version_info[:2]>=(3,10))" 2>$null; if ($v -eq 'True') { $py = $c; break } } catch {}
}
if ($py) { Ok "zaten kurulu ($py)" } else { Winget-Install 'Python.Python.3.12' 'Python 3.12' }

Step 'Claude Code'
Refresh-Path
if (Has 'claude') { Ok 'zaten kurulu' } else {
  Write-Host '    resmi kurulum betigi calisiyor...'
  Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression
  Refresh-Path
  if (Has 'claude') { Ok 'kuruldu' } else { Warn 'claude bulunamadi - yeni bir terminal acip tekrar dene.' }
}

Step 'Terrarium uygulamasi'
$exe = "$env:LOCALAPPDATA\Programs\Terrarium\Terrarium.exe"
$setup = Get-ChildItem $here -Filter 'Terrarium-Setup-*.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($setup) {
  Get-Process Terrarium -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Write-Host "    $($setup.Name) kuruluyor..."
  Start-Process $setup.FullName -ArgumentList '/S' -Wait
} elseif (-not (Test-Path $exe)) {
  Warn 'Terrarium-Setup-*.exe bu klasorde yok.'
}
if (Test-Path $exe) { Ok "kurulu: $exe" } else { Warn 'Terrarium.exe bulunamadi.' }

Step 'Terrarium ilk acilis (MCP sunucusu ~/.terrarium/bin altina kopyalanir)'
$mcp = "$env:USERPROFILE\.terrarium\bin\terrarium-mcp.exe"
if ((Test-Path $exe) -and -not (Test-Path $mcp)) {
  Start-Process $exe
  for ($i = 0; $i -lt 60 -and -not (Test-Path $mcp); $i++) { Start-Sleep 1 }
}
if (Test-Path $mcp) { Ok "hazir: $mcp" } else { Warn 'terrarium-mcp.exe olusmadi - Terrarium''i bir kez acip bu betigi tekrar calistir.' }

Step 'Terrarium MCP -> Claude Code'
if ((Has 'claude') -and (Test-Path $mcp)) {
  $list = (claude mcp list 2>$null) -join "`n"
  if ($list -match '(?m)^terrarium:') { Ok 'zaten kayitli' } else {
    claude mcp add -s user terrarium -- $mcp
    Ok 'kaydedildi (tum projelerde gecerli)'
  }
} else { Warn 'atlandi (claude veya terrarium-mcp.exe yok)' }

Write-Host "`nBitti." -ForegroundColor Green
Write-Host 'Siradaki adimlar:'
Write-Host '  1) Yeni bir terminalde:  claude   -> kendi Claude hesabinla giris yap'
Write-Host '  2) Terrarium''u Baslat menusunden ac, ilk ekranda proje klasorunu sec'
Write-Host '  3) (istege bagli) OKU-BENI.txt icindeki prompt''u Claude Code''a yapistir'
Read-Host "`nKapatmak icin Enter"
