@echo off
setlocal EnableExtensions

rem Next.js local application launcher.
rem Use VERCEL_SYNC.bat separately to publish local changes to GitHub and Vercel.

set "ROOT=%~dp0"
set "WEBSITE=%ROOT%website"
set "PORT=3000"

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

timeout /t 4 /nobreak >nul
start "" "http://127.0.0.1:%PORT%"

echo Local site started. Run VERCEL_SYNC.bat to publish immediately, or VERCEL_SYNC.bat watch to publish changes automatically.
exit /b 0
