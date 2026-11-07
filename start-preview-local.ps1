<#
.SYNOPSIS
  Startet die SnappyMail-Vorschau ohne Docker: PHP-Eingebauter-Server auf http://localhost:8888.

.DESCRIPTION
  Benoetigt PHP 8.2 oder neuer. Ist PHP nicht vorhanden, bietet das Skript eine Installation
  per winget an (PHP 8.4) und aktiviert die noetigen Erweiterungen in der php.ini.
  Die Oberflaeche und der Admin laufen. Ein Postfach braucht einen IMAP-/SMTP-Server.
  Ohne Docker gibt es keinen Testmailserver. Die Anmeldung schlaegt dann fehl.

.EXAMPLE
  .\start-preview-local.ps1            # starten
  .\start-preview-local.ps1 -Build     # Frontend vorher bauen (npm run build in ui/)
  .\start-preview-local.ps1 -Stop      # beenden
#>
[CmdletBinding()]
param(
    [switch]$Build,
    [switch]$Stop,
    [int]$Port = 8888
)

$ErrorActionPreference = "Stop"

$root      = $PSScriptRoot
$stateDir  = Join-Path $root "data\preview-local"
$pidFile   = Join-Path $stateDir "php.pid"
$logOut    = Join-Path $stateDir "php-out.log"
$logErr    = Join-Path $stateDir "php-err.log"
$routerFile = Join-Path $stateDir "router.php"
$url       = "http://localhost:$Port/"
$minPhpId  = 80200
$phpModulesRequired    = @("curl", "mbstring", "openssl", "iconv", "json")
$phpModulesRecommended = @("intl", "gd", "zip", "fileinfo", "dom")

function Stop-Preview {
    if (-not (Test-Path $pidFile)) {
        Write-Host "Keine von diesem Skript gestartete Vorschau gefunden." -ForegroundColor Yellow
        return
    }
    $pidValue = (Get-Content $pidFile | Select-Object -First 1)
    $proc = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
    if ($proc) {
        # /T beendet auch den PHP-Server, der unter dem cmd-Prozess laeuft
        taskkill /PID $proc.Id /T /F | Out-Null
        Write-Host "Vorschau gestoppt (PID $($proc.Id))." -ForegroundColor Green
    } else {
        Write-Host "Der Prozess $pidValue laeuft nicht mehr." -ForegroundColor Yellow
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

if ($Stop) {
    Stop-Preview
    exit 0
}

function Find-Php {
    $cmd = Get-Command php -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    if ($env:PHP_PATH -and (Test-Path $env:PHP_PATH)) { return $env:PHP_PATH }
    return $null
}

function Get-PhpModules {
    param([string]$Php)
    return @(& $Php -m 2>$null | ForEach-Object { $_.Trim().ToLowerInvariant() })
}

function Install-PhpWithWinget {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { return $false }
    $answer = Read-Host "PHP ist nicht installiert. PHP 8.4 jetzt per winget installieren? (j/n)"
    if ($answer -notmatch '^(j|ja|y|yes)$') { return $false }
    winget install --id PHP.PHP.8.4 -e --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { Write-Host "winget konnte PHP nicht installieren." -ForegroundColor Red; return $false }
    # PATH in dieser Sitzung auffrischen
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
    return $true
}

function Enable-PhpExtensions {
    param([string]$Php, [string[]]$Names)
    $iniLine = (& $Php --ini | Select-String 'Loaded Configuration File').ToString()
    $iniPath = ($iniLine -replace '^.*:\s*', '').Trim()
    $phpDir = Split-Path $Php -Parent
    if (-not $iniPath -or $iniPath -eq "(none)") {
        $dev = Join-Path $phpDir "php.ini-development"
        if (-not (Test-Path $dev)) { return $false }
        Copy-Item $dev (Join-Path $phpDir "php.ini")
        $iniPath = Join-Path $phpDir "php.ini"
    }
    Write-Host "Aktiviere PHP-Erweiterungen in $iniPath ..." -ForegroundColor Cyan
    $text = Get-Content $iniPath -Raw
    $extDir = Join-Path $phpDir "ext"
    $text = $text -replace '(?m)^\s*;?\s*extension_dir\s*=.*$', "extension_dir = `"$extDir`""
    foreach ($name in $Names) {
        $pattern = "(?m)^\s*;\s*extension\s*=\s*(php_)?$name(\.dll)?\s*$"
        $text = $text -replace $pattern, "extension=$name"
    }
    Set-Content -Path $iniPath -Value $text -Encoding ASCII
    return $true
}

# Frontend zuerst: der Build braucht kein PHP
if ($Build) {
    $uiDir = Join-Path $root "ui"
    Push-Location $uiDir
    try {
        if (-not (Test-Path (Join-Path $uiDir "node_modules"))) {
            Write-Host "Abhaengigkeiten werden installiert (npm install) ..." -ForegroundColor Cyan
            npm install
            if ($LASTEXITCODE -ne 0) { Write-Error "npm install ist fehlgeschlagen."; exit 1 }
        }
        Write-Host "Frontend wird gebaut (npm run build) ..." -ForegroundColor Cyan
        npm run build
        if ($LASTEXITCODE -ne 0) { Write-Error "npm run build ist fehlgeschlagen."; exit 1 }
    }
    finally {
        Pop-Location
    }
}

$appJs = Join-Path $root "snappymail\v\0.0.0\static\js\app.js"
if (-not (Test-Path $appJs)) {
    Write-Error "Die Oberflaeche fehlt ($appJs). Bitte mit -Build bauen."
    exit 1
}

$php = Find-Php
if (-not $php -and (Install-PhpWithWinget)) {
    $php = Find-Php
}
if (-not $php) {
    Write-Error ("PHP wurde nicht gefunden. Bitte PHP 8.2 oder neuer installieren " +
        "(winget install PHP.PHP.8.4 oder Thread-Safe-ZIP von https://windows.php.net/download/), " +
        "dann das Terminal neu oeffnen, oder PHP_PATH auf php.exe setzen.")
    exit 1
}

$versionId = [int](& $php -r "echo PHP_VERSION_ID;")
$versionText = & $php -r "echo PHP_VERSION;"
if ($versionId -lt $minPhpId) {
    Write-Error "PHP $versionText ist zu alt. Benoetigt wird PHP 8.2 oder neuer."
    exit 1
}
Write-Host "PHP $versionText gefunden: $php" -ForegroundColor Cyan

$modules = Get-PhpModules $php
$missing = @($phpModulesRequired | Where-Object { $modules -notcontains $_ })
if ($missing) {
    Enable-PhpExtensions -Php $php -Names ($phpModulesRequired + $phpModulesRecommended) | Out-Null
    $modules = Get-PhpModules $php
    $missing = @($phpModulesRequired | Where-Object { $modules -notcontains $_ })
}
if ($missing) {
    Write-Error ("Diese PHP-Erweiterungen fehlen: " + ($missing -join ", ") +
        ". Bitte in der php.ini aktivieren (extension=...), dann erneut starten.")
    exit 1
}
$recommended = @($phpModulesRecommended | Where-Object { $modules -notcontains $_ })
if ($recommended) {
    Write-Host ("Empfohlen, aber nicht aktiv: " + ($recommended -join ", ")) -ForegroundColor Yellow
}

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listener) {
    Write-Error "Port $Port ist bereits belegt (PID $($listener[0].OwningProcess)). Mit -Stop beenden oder -Port aendern."
    exit 1
}

New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

# Router: vorhandene statische Dateien direkt ausliefern, alles andere an index.php.
# Dateien unter data/ und snappymail/ (ausser static) bleiben gesperrt.
$router = @'
<?php
$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));
$root = $_SERVER['DOCUMENT_ROOT'];
if (preg_match('#^/snappymail/v/[^/]+/static/#', $path) && !preg_match('#\.php$#i', $path) && is_file($root . $path)) {
    return false;
}
if (preg_match('#^/favicon\.ico$#', $path) && is_file($root . $path)) {
    return false;
}
require $root . '/index.php';
'@
Set-Content -Path $routerFile -Value $router -Encoding UTF8

Remove-Item $logOut, $logErr -Force -ErrorAction SilentlyContinue

Write-Host "SnappyMail-Vorschau wird gestartet ..." -ForegroundColor Cyan
# Eigene, unsichtbare Konsole (CreateNoWindow): der Server stirbt nicht, wenn das
# Startfenster geschlossen wird. Die Logs laufen ueber cmd in die Logdateien.
$cmdLine = "`"`"$php`" -S 127.0.0.1:$Port -t `"$root`" `"$routerFile`" > `"$logOut`" 2> `"$logErr`"`""
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "cmd.exe"
$psi.Arguments = "/c $cmdLine"
$psi.WorkingDirectory = $root
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$proc = [System.Diagnostics.Process]::Start($psi)
Set-Content -Path $pidFile -Value $proc.Id

$ready = $false
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if ($proc.HasExited) { break }
    try {
        $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
        if ($resp.StatusCode -eq 200) { $ready = $true; break }
    } catch {
        # noch nicht bereit
    }
}

if (-not $ready) {
    Write-Host "Der Server ist nicht gestartet. Log:" -ForegroundColor Red
    if (Test-Path $logErr) { Get-Content $logErr -Tail 30 }
    if (-not $proc.HasExited) { taskkill /PID $proc.Id /T /F | Out-Null }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    exit 1
}

Write-Host ""
Write-Host "Die Vorschau laeuft:" -ForegroundColor Green
Write-Host "  Postfach:  $url"
Write-Host "  Admin:     ${url}?admin"
Write-Host "  Hinweis:   Ohne IMAP-Server ist keine Anmeldung moeglich (Testkonto test@example.com nur mit Docker-Mailserver)."
Write-Host ""
Write-Host "Log:       $logErr"
Write-Host "Beenden:   .\start-preview-local.ps1 -Stop"
