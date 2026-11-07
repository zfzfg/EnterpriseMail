@echo off
setlocal
cd /d "%~dp0"

:menu
cls
echo SnappyMail-Vorschau ohne Docker
echo.
echo   [1] Starten
echo   [2] Frontend neu bauen und starten
echo   [3] Beenden
echo   [4] Bauen bevor docker preview
echo   [0] Abbrechen
echo.
set "choice="
set /p "choice=Auswahl: "

if "%choice%"=="1" goto start
if "%choice%"=="2" goto build
if "%choice%"=="3" goto stop
if "%choice%"=="4" goto build2
if "%choice%"=="0" goto end
goto menu

:start
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-preview-local.ps1"
goto done

:build
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-preview-local.ps1" -Build
goto done

:build2
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-preview.ps1" -Rebuild

:stop
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-preview-local.ps1" -Stop
goto done

:done
echo.
pause
goto end

:end
endlocal
