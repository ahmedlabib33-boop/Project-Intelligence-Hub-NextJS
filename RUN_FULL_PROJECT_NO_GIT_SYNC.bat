@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "MODE=Watch"
set "INTERVAL_SECONDS=30"
if not "%~1"=="" set "MODE=%~1"
if not "%~2"=="" set "INTERVAL_SECONDS=%~2"

echo Project Intelligence Hub validated local-to-Vercel pipeline
echo Mode: %MODE%  Interval: %INTERVAL_SECONDS% second(s)
echo A project or website change is generated, validated, built, published, deployed, then publicly verified.
echo GitHub publishing uses the no-Git API sync configured in tools\github_sync_config.json.
echo Credentials are read only from GITHUB_TOKEN or GH_TOKEN; Vercel uses the existing local Vercel login.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\vercel_project_pipeline.ps1" -Mode "%MODE%" -IntervalSeconds %INTERVAL_SECONDS%
exit /b %ERRORLEVEL%
