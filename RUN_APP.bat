@echo off
setlocal EnableExtensions

rem Original Streamlit application launcher.
set "APP_ROOT=D:\one drive data\OneDrive\Documents\Project Intelligence Hub"
set "PORT=8755"
set "PY=%APP_ROOT%\.venv\Scripts\python.exe"

if not exist "%APP_ROOT%\dashboard.py" (
  echo [ERROR] Streamlit dashboard was not found: "%APP_ROOT%\dashboard.py"
  pause
  exit /b 1
)

if not exist "%PY%" (
  echo [ERROR] Streamlit Python environment was not found: "%PY%"
  pause
  exit /b 1
)

for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do (
  taskkill /PID %%P /F >nul 2>nul
)

echo Starting the original Streamlit application at http://127.0.0.1:%PORT%
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%PY%' -ArgumentList @('-m','streamlit','run','dashboard.py','--server.address','127.0.0.1','--server.port','%PORT%') -WorkingDirectory '%APP_ROOT%' -WindowStyle Hidden"

timeout /t 8 /nobreak >nul
start "" "http://127.0.0.1:%PORT%"
exit /b 0
