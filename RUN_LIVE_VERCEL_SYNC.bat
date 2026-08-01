@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Project Intelligence Hub - Live Vercel Publisher

echo.
echo Project Intelligence Hub live Vercel publisher
echo Watches local project data, source code, templates, and website files every 10 seconds.
echo Each detected change runs data generation, validation, production build, GitHub publish, and Vercel verification.
echo Keep this window open while working. Press Ctrl+C to stop it.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\vercel_project_pipeline.ps1" -Mode Watch -IntervalSeconds 10
set "exitCode=%ERRORLEVEL%"
echo.
echo Live publisher stopped with exit code %exitCode%.
pause
exit /b %exitCode%
