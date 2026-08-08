@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem The only publisher for this self-contained D: workspace.
rem Flow: local workspace -> GitHub main -> Vercel Git integration.
rem Double-click: publish immediately, then watch for all later workspace changes.
rem Use "once" only when one publish pass is required without keeping the watcher open.
set "MODE=Watch"
if /I "%~1"=="watch" set "MODE=Watch"
if /I "%~1"=="once" set "MODE=Once"
if /I "%~1"=="test" set "MODE=Test"
if /I "%~1"=="dryrun" set "MODE=DryRun"

set "PIH_SOURCE_ROOT=%CD%"
echo.
echo Project Intelligence Hub GitHub-to-Vercel Sync
echo Source: %CD%
echo Mode: %MODE%
echo Flow: local changes ^> GitHub main ^> Vercel automatic deployment
echo.

if /I "%MODE%"=="Watch" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\vercel_project_pipeline.ps1" -Mode Watch -IntervalSeconds 10
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\vercel_project_pipeline.ps1" -Mode "%MODE%" -IntervalSeconds 10
)
exit /b %ERRORLEVEL%
