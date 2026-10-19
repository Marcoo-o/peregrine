@echo off
rem Builds before launching, so the desktop shortcut can never start a stale version.
rem The console window stays open only while building - and stays put if the build fails,
rem because a shortcut that silently launches yesterday's code is the failure worth avoiding.
cd /d "%~dp0"

echo Peregrine wird gebaut...
call npm run build
if errorlevel 1 (
  echo.
  echo Build fehlgeschlagen - die App wird nicht gestartet.
  pause
  exit /b 1
)

start "" "%~dp0node_modules\electron\dist\electron.exe" .
exit /b 0
