@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo Project Intelligence Hub full pipeline verification
echo Tests watcher detection, source generation, parity validation, build, GitHub publish, Vercel deployment, and public data parity.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\vercel_project_pipeline.ps1" -Mode Test -IntervalSeconds 30
exit /b %ERRORLEVEL%
