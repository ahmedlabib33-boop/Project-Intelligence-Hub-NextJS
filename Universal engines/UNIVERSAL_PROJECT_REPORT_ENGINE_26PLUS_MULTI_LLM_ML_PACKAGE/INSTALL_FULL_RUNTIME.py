#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Runtime dependency checker/installer.

Python AI Programming by Eng. Ahmed Labib

Does not silently install packages. Use --install to invoke pip explicitly.
"""
from __future__ import annotations
import argparse, importlib.util, json, subprocess, sys
from importlib import metadata
from pathlib import Path

ATTRIBUTION="Python AI Programming by Eng. Ahmed Labib"
ROOT=Path(__file__).resolve().parent
PACKAGES={
    "core":{
        "numpy":"numpy","pandas":"pandas","scipy":"scipy","joblib":"joblib","scikit-learn":"sklearn",
        "pypdf":"pypdf","pdfplumber":"pdfplumber","python-docx":"docx","openpyxl":"openpyxl","python-pptx":"pptx","Pillow":"PIL","reportlab":"reportlab",
    },
    "ml_backends":{"xgboost":"xgboost","lightgbm":"lightgbm","catboost":"catboost","torch":"torch"},
    "web":{"fastapi":"fastapi","uvicorn":"uvicorn","pydantic":"pydantic","python-multipart":"multipart","httpx":"httpx"},
    "llm_sdk":{"anthropic":"anthropic","openai":"openai"},
    "optimization_optional":{"optuna":"optuna","shap":"shap"},
}

def _ver(pkg:str):
    try:return metadata.version(pkg)
    except Exception:return None

def check():
    sections={};missing=[]
    for section,items in PACKAGES.items():
        rows={}
        for pkg,mod in items.items():
            ok=importlib.util.find_spec(mod) is not None
            rows[pkg]={"installed":ok,"version":_ver(pkg) if ok else None,"module":mod}
            if not ok:missing.append(pkg)
        sections[section]=rows
    return {
        "attribution":ATTRIBUTION,
        "python":sys.version.split()[0],
        "core_ready":all(v["installed"] for v in sections["core"].values()),
        "full_ml_backend_ready":all(v["installed"] for v in sections["ml_backends"].values()),
        "web_ready":all(v["installed"] for v in sections["web"].values()),
        "llm_sdk_ready":all(v["installed"] for v in sections["llm_sdk"].values()),
        "optimization_extensions_ready":all(v["installed"] for v in sections["optimization_optional"].values()),
        "missing":missing,
        "sections":sections,
    }

def install(requirements:Path):
    cmd=[sys.executable,"-m","pip","install","--upgrade","-r",str(requirements)]
    print(ATTRIBUTION);print("Executing:"," ".join(cmd),flush=True)
    return subprocess.call(cmd)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--install",action="store_true",help="Explicitly install/upgrade from the package requirements file")
    ap.add_argument("--requirements",default=str(ROOT/"UNIVERSAL_PROJECT_REPORT_ENGINE_requirements.txt"))
    ap.add_argument("--output")
    args=ap.parse_args()
    if args.install:
        rc=install(Path(args.requirements))
        if rc:return rc
    result=check()
    if args.output:Path(args.output).write_text(json.dumps(result,indent=2),encoding="utf-8")
    print(ATTRIBUTION);print(json.dumps(result,indent=2))
    return 0 if result["core_ready"] and result["web_ready"] else 2
if __name__=="__main__":raise SystemExit(main())
