# Python AI Programming by Eng. Ahmed Labib
$ErrorActionPreference = 'Stop'
Write-Host 'Python AI Programming by Eng. Ahmed Labib' -ForegroundColor Cyan
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
python -m pip install --upgrade pip
python .\INSTALL_FULL_RUNTIME.py --install
python .\INSTALL_FULL_RUNTIME.py
python .\VALIDATE_WEB_ML_PACKAGE.py --deep
