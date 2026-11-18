# kokoro-reader for Windows: installs and manages the local Kokoro voice server used by the Kokoro Reader extension.
# Everything lives in %LOCALAPPDATA%\KokoroReader. CPU only.
param(
  [Parameter(Position = 0)][string]$Command = 'help',
  [Parameter(Position = 1)][string]$Arg = ''
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Version = '0.3.8'
$KR = if ($env:KOKORO_READER_HOME) { $env:KOKORO_READER_HOME } else { Join-Path $env:LOCALAPPDATA 'KokoroReader' }
$Src = Join-Path $KR 'Kokoro-FastAPI'
$Port = if ($env:KOKORO_PORT) { $env:KOKORO_PORT } else { '8880' }
$Log = Join-Path $KR 'server.log'
$Ref = '3c0d616d75ad542a4ff87fa6a3026720888f809a'   # tested version
$Startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'KokoroReaderServer.vbs'
$Runner = Join-Path $KR 'run-server.cmd'
$Hidden = Join-Path $KR 'run-hidden.vbs'

function Say($m) { Write-Host "> $m" -ForegroundColor DarkYellow }
function Die($m) { Write-Host "Error: $m" -ForegroundColor Red; exit 1 }

function Find-Uv {
  $c = Get-Command uv -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($p in @("$env:USERPROFILE\.local\bin\uv.exe", "$env:USERPROFILE\.cargo\bin\uv.exe")) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

function Run($exe, [string[]]$a) {
  & $exe @a
  if ($LASTEXITCODE -ne 0) { Die "$exe failed with exit code $LASTEXITCODE" }
}

function Test-Server {
  try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "http://127.0.0.1:$Port/v1/audio/voices" | Out-Null; return $true } catch { return $false }
}

function Wait-Ready {
  for ($i = 0; $i -lt 60; $i++) { if (Test-Server) { return $true }; Start-Sleep -Seconds 2 }
  return $false
}

function Write-Runner($uv) {
  $s = $Src -replace '\\', '/'
  @"
@echo off
cd /d "$Src"
set USE_GPU=false
set DEVICE_TYPE=cpu
set PYTHONPATH=$s;$s/api
set MODEL_DIR=src/models
set VOICES_DIR=src/voices/v1_0
set WEB_PLAYER_PATH=$s/web
"$uv" run --no-sync uvicorn api.src.main:app --host 127.0.0.1 --port $Port >> "$Log" 2>&1
"@ | Set-Content -Encoding ASCII $Runner
  # wscript runs the batch file with no console window
  "CreateObject(""Wscript.Shell"").Run """"""$Runner"""""", 0, False" | Set-Content -Encoding ASCII $Hidden
}

function Cmd-Install {
  Say "Kokoro Reader server installer v$Version (Windows)"
  New-Item -ItemType Directory -Force $KR | Out-Null

  $uv = Find-Uv
  if (-not $uv) {
    Say 'Installing uv (fast Python manager)...'
    Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
    $uv = Find-Uv
    if (-not $uv) { Die 'uv install failed. See https://docs.astral.sh/uv/' }
  }

  if (-not (Test-Path (Join-Path $Src 'pyproject.toml'))) {
    Say 'Downloading the Kokoro server...'
    $zip = Join-Path $KR 'server.zip'
    Invoke-WebRequest -UseBasicParsing "https://github.com/remsky/Kokoro-FastAPI/archive/$Ref.zip" -OutFile $zip
    $tmp = Join-Path $KR 'unzip'
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    if (Test-Path $Src) { Remove-Item -Recurse -Force $Src }
    Move-Item (Get-ChildItem $tmp | Select-Object -First 1).FullName $Src
    Remove-Item -Recurse -Force $tmp, $zip
  }

  Say 'Setting up Python and dependencies (cpu). This takes a few minutes the first time...'
  Push-Location $Src
  try {
    & $uv venv --python 3.12 --quiet
    if ($LASTEXITCODE -ne 0) { Run $uv @('venv', '--quiet') }
    Run $uv @('pip', 'install', '--quiet', '-e', '.[cpu]')
    Say 'Downloading the voice model (about 330 MB)...'
    $env:USE_GPU = 'false'
    $env:PYTHONPATH = "$Src;$Src\api"
    Run $uv @('run', '--no-sync', 'python', 'docker/scripts/download_model.py', '--output', 'api/src/models/v1_0')
  } finally { Pop-Location }

  Write-Runner $uv
  Cmd-Autostart 'on'
  if (Wait-Ready) { Say "Done. Voice server is running at http://localhost:$Port" }
  else { Say 'Server is still warming up. Check with: kokoro-reader.ps1 status' }
  Write-Host ''
  Write-Host 'Next: load the extension in Chrome (chrome://extensions, Developer mode, Load unpacked) and open a Google Doc.'
}

function Cmd-Autostart($mode) {
  if (-not (Test-Path $Runner)) { $uv = Find-Uv; if (-not $uv) { Die 'Not installed yet. Run the install first.' }; Write-Runner $uv }
  if ($mode -eq 'off') {
    Remove-Item -Force $Startup -ErrorAction SilentlyContinue
    Say 'Autostart is off.'
    return
  }
  Copy-Item -Force $Hidden $Startup
  Start-Process wscript.exe -ArgumentList "`"$Hidden`""
  Say 'Autostart is on. The server starts when you sign in.'
}

function Cmd-Start {
  if (-not (Test-Path $Runner)) { Die 'Not installed yet. Run the installer first.' }
  if (-not (Test-Server)) { Start-Process wscript.exe -ArgumentList "`"$Hidden`"" }
  if (Wait-Ready) { Say "Server running at http://localhost:$Port" } else { Say 'Still starting. Check: kokoro-reader.ps1 logs' }
}

function Cmd-Stop {
  Get-NetTCPConnection -LocalPort ([int]$Port) -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  Say 'Stopped. (Autostart will bring it back at next sign in. Turn off with: kokoro-reader.ps1 autostart off)'
}

function Cmd-Status {
  if (Test-Server) { Say "Running at http://localhost:$Port" } else { Say 'Not running. Start it with: kokoro-reader.ps1 start' }
}

function Cmd-Logs {
  if (-not (Test-Path $Log)) { Die 'No log yet.' }
  Get-Content $Log -Tail 80 -Wait
}

function Cmd-Uninstall {
  Cmd-Stop
  Remove-Item -Force $Startup -ErrorAction SilentlyContinue
  if (Test-Path $KR) { Remove-Item -Recurse -Force $KR -ErrorAction SilentlyContinue }
  Say "Removed $KR. The Chrome extension can be removed from chrome://extensions."
}

switch ($Command.ToLower()) {
  'install'   { Cmd-Install }
  'start'     { Cmd-Start }
  'stop'      { Cmd-Stop }
  'restart'   { Cmd-Stop; Cmd-Start }
  'status'    { Cmd-Status }
  'logs'      { Cmd-Logs }
  'autostart' { Cmd-Autostart $(if ($Arg) { $Arg } else { 'on' }) }
  'uninstall' { Cmd-Uninstall }
  'version'   { "kokoro-reader $Version" }
  default {
    @"
kokoro-reader $Version (local Kokoro voice server for the Kokoro Reader extension)

  install              download the voice server and model, start it at sign in
  start | stop | restart
  status               is it running?
  logs                 follow the server log
  autostart on|off     start at sign in
  uninstall            remove everything this tool installed

Run with: powershell -ExecutionPolicy Bypass -File kokoro-reader.ps1 <command>
"@
  }
}
