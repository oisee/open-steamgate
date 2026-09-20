# Private draft bundle launcher. Content stays in this directory; SQLite does not.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$instance = if ($env:INSTANCE) { $env:INSTANCE } else { '11' }
if ($instance -notmatch '^\d{2}$') { throw 'INSTANCE must be two digits' }
$port = if ($env:STG_PORT) { $env:STG_PORT } else { "80$instance" }
$dataDir = if ($env:OSD_DATA_DIR) { $env:OSD_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'open-steamgate' }
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$env:OSD_ROOT = $PSScriptRoot
$env:OSD_PACKS = Join-Path $PSScriptRoot 'packs'
$env:STG_DB = 'file'
if (-not $env:STG_TLS) { $env:STG_TLS = '0' }
$env:STG_PORT = $port
$env:OSD_WORKERS = '1'
if (-not $env:STG_DB_PATH) { $env:STG_DB_PATH = Join-Path $dataDir 'osd.sqlite' }
$osd = $null
$bridge = $null
try {
  $osd = Start-Process -FilePath (Join-Path $PSScriptRoot 'osd.exe') -ArgumentList 'up' -NoNewWindow -PassThru
  $ready = $false
  for ($attempt = 0; $attempt -lt 120; $attempt++) {
    if ($osd.HasExited) { throw 'OSD exited before ready' }
    try {
      $status = Invoke-RestMethod -Uri "http://127.0.0.1:$port/sap/bc/adt/core/http/build" -TimeoutSec 2
      if ($status.system.serving) { $ready = $true; break }
    } catch { Start-Sleep -Seconds 1 }
  }
  if (-not $ready) { throw 'OSD did not become ready in 120 seconds' }
  $bridge = Start-Process -FilePath (Join-Path $PSScriptRoot 'osd-up.exe') -ArgumentList @('-instance', [string][int]$instance, '-attach', "http://127.0.0.1:$port", '-stub', 'tape') -NoNewWindow -PassThru
  Write-Host "OSD on http://127.0.0.1:$port/; DIAG 32$instance; RFC 33$instance; SQLite $env:STG_DB_PATH"
  while (-not $osd.HasExited -and -not $bridge.HasExited) { Start-Sleep -Seconds 2 }
  if ($bridge.HasExited -and -not $osd.HasExited) { throw 'DIAG/RFC bridge exited' }
  exit $osd.ExitCode
} finally {
  if ($bridge -and -not $bridge.HasExited) { Stop-Process -Id $bridge.Id -ErrorAction SilentlyContinue }
  if ($osd -and -not $osd.HasExited) {
    # OSD starts a serving child. Stop-Process alone leaves that child alive.
    & taskkill.exe /PID $osd.Id /T /F | Out-Null
  }
}
