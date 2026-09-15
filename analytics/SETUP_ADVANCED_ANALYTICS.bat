@echo off
setlocal
set "ROOT=%~dp0.."
set "PYTHON311=C:\Users\pc\AppData\Local\Programs\Python\Python311\python.exe"
set "VENV=%ROOT%\.venv-analytics"
set "PIP_CACHE_DIR=%ROOT%\.pip-cache"
set "TMP=%ROOT%\.pip-tmp"
set "TEMP=%ROOT%\.pip-tmp"

if not exist "%PYTHON311%" (
  echo Python 3.11 was not found at %PYTHON311%.
  echo Install Python 3.11, then run this file again.
  exit /b 1
)

if not exist "%VENV%\Scripts\python.exe" (
  "%PYTHON311%" -m venv "%VENV%"
)

if not exist "%PIP_CACHE_DIR%" mkdir "%PIP_CACHE_DIR%"
if not exist "%TMP%" mkdir "%TMP%"

"%VENV%\Scripts\python.exe" -m pip install --upgrade pip
"%VENV%\Scripts\python.exe" -m pip install "pandas>=2.2,<3.0" "numpy>=1.26,<2.3" "matplotlib>=3.8,<3.11" "seaborn>=0.13,<0.14" "scikit-learn>=1.5,<1.8" "statsmodels>=0.14,<0.15" "xgboost>=2.1,<3.0"
"%VENV%\Scripts\python.exe" -m pip install "spacy>=3.8,<3.9" "click>=8.1,<9.0"
"%VENV%\Scripts\python.exe" -m pip install torch --index-url https://download.pytorch.org/whl/cpu
"%VENV%\Scripts\python.exe" -m pip install tensorflow
"%VENV%\Scripts\python.exe" -c "import pandas, numpy, matplotlib, seaborn, sklearn, statsmodels, spacy, xgboost, torch, tensorflow; print('Advanced analytics runtime is ready in D drive.')"
endlocal
