@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem The only publisher for this self-contained D: workspace.
rem Double-click: one immediate publish.  "watch": detect changes every 10 seconds.
set "MODE=Once"
if /I "%~1"=="watch" set "MODE=Watch"
if /I "%~1"=="once" set "MODE=Once"
if /I "%~1"=="test" set "MODE=Test"
if /I "%~1"=="dryrun" set "MODE=DryRun"

set "PIH_SOURCE_ROOT=%CD%"
echo.
echo Project Intelligence Hub Vercel Sync
echo Source: %CD%
echo Mode: %MODE%
echo.

if /I "%MODE%"=="Watch" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\vercel_project_pipeline.ps1" -Mode Watch -IntervalSeconds 10 -SkipInitialPublish
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\vercel_project_pipeline.ps1" -Mode "%MODE%" -IntervalSeconds 10
)
exit /b %ERRORLEVEL%
