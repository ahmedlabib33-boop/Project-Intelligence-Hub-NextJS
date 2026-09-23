@echo off
setlocal EnableExtensions

rem Starts the Project Controls Output Studio ML/report FastAPI service used by
rem Schedule Intelligence's Learning tab. Local only; never publishes anywhere.
set "ROOT=%~dp0"
set "ENGINE=%ROOT%Universal engines\UNIVERSAL_PROJECT_REPORT_ENGINE_26PLUS_MULTI_LLM_ML_PACKAGE"
set "HOST=127.0.0.1"
set "PORT=8767"

if not exist "%ENGINE%\OUTPUT_STUDIO_SERVER.py" (
  echo [ERROR] Output Studio engine package was not found: "%ENGINE%"
  pause
  exit /b 1
)

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] python was not found on PATH.
  pause
  exit /b 1
)

powershell.exe -NoProfile -Command "$listener = Get-NetTCPConnection -LocalAddress '%HOST%' -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue; if ($listener) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo Starting Project Controls Output Studio API on http://%HOST%:%PORT% ...
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'python.exe' -ArgumentList '-m','uvicorn','OUTPUT_STUDIO_SERVER:app','--host','%HOST%','--port','%PORT%' -WorkingDirectory '%ENGINE%' -WindowStyle Hidden"
) else (
  echo Project Controls Output Studio API is already listening on port %PORT%.
)

exit /b 0
