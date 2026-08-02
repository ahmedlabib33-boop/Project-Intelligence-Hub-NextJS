@echo off
setlocal EnableExtensions

rem Next.js/Vercel application launcher.
rem Default: local website plus the 10-second GitHub/Vercel publisher.
rem Optional: RUN_VERCEL.bat --no-sync starts only the local website.

set "ROOT=%~dp0"
set "WEBSITE=%ROOT%website"
set "PORT=3000"
set "START_SYNC=1"

if /I "%~1"=="--no-sync" set "START_SYNC=0"

if not exist "%WEBSITE%\package.json" (
  echo [ERROR] Next.js website folder was not found: "%WEBSITE%"
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Install Node.js, then run this file again.
  pause
  exit /b 1
)

echo.
echo Project Intelligence Hub - Next.js/Vercel
echo Local website: http://127.0.0.1:%PORT%
echo.

powershell.exe -NoProfile -Command "$listener = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue; if ($listener) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/k','npm run dev -- --port %PORT%' -WorkingDirectory '%WEBSITE%'"
) else (
  echo Local website is already running on port %PORT%.
)

if "%START_SYNC%"=="1" (
  powershell.exe -NoProfile -Command "$publisher = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'vercel_project_pipeline\.ps1' -and $_.CommandLine -match 'Mode Watch' }; if ($publisher) { exit 0 } else { exit 1 }"
  if errorlevel 1 (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/k','call RUN_LIVE_VERCEL_SYNC.bat' -WorkingDirectory '%ROOT%'"
  ) else (
    echo Live Vercel publisher is already running.
  )
) else (
  echo Live Vercel publisher skipped by --no-sync.
)

timeout /t 4 /nobreak >nul
start "" "http://127.0.0.1:%PORT%"

echo Launcher complete. Keep the opened command windows running while you work.
exit /b 0
