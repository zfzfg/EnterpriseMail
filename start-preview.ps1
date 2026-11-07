[CmdletBinding()]
param(
    [switch]$Rebuild
)

$ErrorActionPreference = "Stop"

# Haelt das Fenster offen, wenn das Skript per Doppelklick oder Rechtsklick gestartet wurde.
function Exit-Preview {
    param([int]$Code = 0)
    if ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
        Write-Host ""
        Read-Host "Enter zum Schliessen" | Out-Null
    }
    exit $Code
}

trap {
    Write-Host $_ -ForegroundColor Red
    Exit-Preview 1
}

function Test-Command {
    param([Parameter(Mandatory)][string]$Name)
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

if (-not (Test-Command "docker")) {
    Write-Error "Docker wurde nicht gefunden. Bitte Docker Desktop installieren und starten: https://www.docker.com/products/docker-desktop/"
    Exit-Preview 1
}

try {
    docker info --format "{{.ServerVersion}}" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker antwortet nicht."
    }
}
catch {
    Write-Error "Docker ist nicht bereit. Bitte Docker Desktop starten und anschliessend dieses Skript erneut ausfuehren."
    Exit-Preview 1
}

$composeFile = Join-Path $PSScriptRoot "plugins\ai-copilot\dev\docker-compose.yml"
if (-not (Test-Path $composeFile)) {
    Write-Error "Die Compose-Datei wurde nicht gefunden: $composeFile"
    Exit-Preview 1
}

Write-Host "SnappyMail-Vorschau wird vorbereitet ..." -ForegroundColor Cyan

$arguments = @("compose", "--file", $composeFile, "up", "--detach")
if ($Rebuild) {
    $arguments += "--build"
}

& docker @arguments
if ($LASTEXITCODE -ne 0) {
    Write-Error "Die Vorschau konnte nicht gestartet werden."
    Exit-Preview $LASTEXITCODE
}

Write-Host ""
Write-Host "Die Vorschau ist bereit:" -ForegroundColor Green
Write-Host "  Postfach:  http://localhost:8888"
Write-Host "  E-Mail:    test@example.com"
Write-Host "  Passwort:  test1234"
Write-Host ""
Write-Host "Logs anzeigen:  docker compose --file `"$composeFile`" logs --follow"
Write-Host "Vorschau stoppen: docker compose --file `"$composeFile`" down"
Write-Host ""
Write-Host "Zum erneuten Bauen nach PHP- oder Dockerfile-Aenderungen: .\start-preview.ps1 -Rebuild"

Exit-Preview 0
