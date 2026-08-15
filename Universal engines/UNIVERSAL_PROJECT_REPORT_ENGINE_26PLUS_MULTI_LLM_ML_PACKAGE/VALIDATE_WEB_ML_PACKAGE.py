#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Deployment validator for the Web + Governed ML package.
Python AI Programming by Eng. Ahmed Labib
"""
from __future__ import annotations
import argparse, hashlib, importlib.util, json, py_compile, sys, tempfile
from pathlib import Path

ATTRIBUTION="Python AI Programming by Eng. Ahmed Labib"
ROOT=Path(__file__).resolve().parent
EXPECTED_RULE_HASH="50a3f033cafc0530d58f34e3c3674277d0f844569e8dc92531ea7762c8c021b2"
PY_FILES=[
 "UNIVERSAL_PROJECT_REPORT_ENGINE.py","UNIVERSAL_PROJECT_REPORT_ENGINE_26PLUS.py","PROJECT_CONTROLS_ML_DECISION_SUPPORT.py",
 "UNIVERSAL_PROJECT_REPORT_ENGINE_26PLUS_ML.py","CHATGPT_PROJECT_REPORT_WORKFLOW_26PLUS_ML.py","PROJECT_CONTROLS_MODEL_REGISTRY.py",
 "INSTALL_FULL_RUNTIME.py","OUTPUT_STUDIO_PROJECT_CONTROLS_WEB.py","OUTPUT_STUDIO_SERVER.py",
 "PROJECT_CONTROLS_MULTI_LLM_ORCHESTRATOR.py","PROJECT_CONTROLS_ADVANCED_ENSEMBLE_ML.py",
]

def load(path,name):
    spec=importlib.util.spec_from_file_location(name,str(path));m=importlib.util.module_from_spec(spec);sys.modules[name]=m;spec.loader.exec_module(m);return m

def main():
    ap=argparse.ArgumentParser();ap.add_argument("--deep",action="store_true");args=ap.parse_args()
    checks=[];warnings=[];errors=[]
    for fn in PY_FILES:
        try:py_compile.compile(str(ROOT/fn),doraise=True);checks.append(f"COMPILE PASS: {fn}")
        except Exception as e:errors.append(f"Compile failed {fn}: {e}")
    try:
        g=json.loads((ROOT/"UNIVERSAL_GOVERNANCE_26_RULES_AND_30_REPORT_RULEBOOKS.json").read_text(encoding="utf-8"));rules=g["global_governance_layer"]["rules"]
        rh=hashlib.sha256(json.dumps(rules,sort_keys=True,ensure_ascii=False,separators=(",",":")).encode()).hexdigest()
        if len(rules)!=26:errors.append("Global rule count != 26")
        if rh!=EXPECTED_RULE_HASH:errors.append("Preserved 26-rule text changed")
        if len(g["report_families"])<26:errors.append("Report family count < 26")
        if g.get("pipeline_layer_count",0)<26:errors.append("Pipeline layer count < 26")
        checks += [f"GLOBAL RULES: {len(rules)}",f"REPORT FAMILIES: {len(g['report_families'])}",f"PIPELINE LAYERS: {g.get('pipeline_layer_count')}"]
    except Exception as e:errors.append(f"Governance check failed: {e}")
    try:
        runtime=load(ROOT/"INSTALL_FULL_RUNTIME.py","validator_runtime").check()
        if not runtime["core_ready"]:errors.append("Core runtime dependencies missing")
        if not runtime["web_ready"]:errors.append("Web runtime dependencies missing")
        if not runtime["full_ml_backend_ready"]:warnings.append("One or more optional ML backends are unavailable; core ML remains deployable")
        checks += [f"CORE RUNTIME: {'PASS' if runtime['core_ready'] else 'FAIL'}",f"WEB RUNTIME: {'PASS' if runtime['web_ready'] else 'FAIL'}",f"FULL OPTIONAL ML BACKENDS: {'PASS' if runtime['full_ml_backend_ready'] else 'PARTIAL'}"]
    except Exception as e:errors.append(f"Runtime check failed: {e}")
    try:
        llm=load(ROOT/"PROJECT_CONTROLS_MULTI_LLM_ORCHESTRATOR.py","validator_llm")
        lst=llm.offline_self_test()
        if lst.get("status")!="PASS":errors.append("Multi-LLM offline consensus self-test failed")
        if set(llm.PROVIDERS)!={"claude","kimi","deepseek"}:errors.append("Multi-LLM provider registry is incomplete")
        checks += [f"MULTI-LLM PROVIDERS: {len(llm.PROVIDERS)}",f"MULTI-LLM OFFLINE SELF-TEST: {lst.get('status')}"]
    except Exception as e:errors.append(f"Multi-LLM validation failed: {type(e).__name__}: {e}")
    try:
        adv=load(ROOT/"PROJECT_CONTROLS_ADVANCED_ENSEMBLE_ML.py","validator_advml")
        with tempfile.TemporaryDirectory() as td:
            ast=adv.offline_self_test(td)
        if ast.get("status")!="PASS":errors.append("Advanced ensemble ML self-test failed")
        checks.append(f"ADVANCED ENSEMBLE ML: {ast.get('status')}")
    except Exception as e:errors.append(f"Advanced ensemble ML validation failed: {type(e).__name__}: {e}")
    try:
        meta=json.loads((ROOT/"MULTI_LLM_AND_ADVANCED_ML_METADATA_SCHEMA.json").read_text(encoding="utf-8"))
        required={"attribution","author","engine_component","component_version","run_id","generated_at_utc","global_governance_rule_count","governance_sha256","native_schedule_supremacy","ml_role","llm_role","evidence_sha256","secrets_persisted"}
        if not required.issubset(set(meta.get("mandatory_fields",[]))):errors.append("Metadata governance schema is missing required fields")
        pol=json.loads((ROOT/"MULTI_LLM_ORCHESTRATION_POLICY.json").read_text(encoding="utf-8"))
        if set(pol.get("providers",{}))!={"claude","kimi","deepseek"}:errors.append("Orchestration policy provider set is incomplete")
        checks += [f"METADATA REQUIRED FIELDS: {len(meta.get('mandatory_fields',[]))}","ORCHESTRATION POLICY: PASS"]
    except Exception as e:errors.append(f"Metadata/orchestration policy validation failed: {e}")
    try:
        eng=load(ROOT/"UNIVERSAL_PROJECT_REPORT_ENGINE_26PLUS_ML.py","validator_engine")
        res=eng.self_test(run_framework_test=args.deep)
        if res.get("status")!="PASS":errors.append("Integrated governed engine self-test failed")
        ft=(res.get("ml") or {}).get("framework_test")
        if args.deep and ft and ft.get("status")=="PASS_PARTIAL":warnings.append("Deep framework self-test passed core but optional backends are partial")
        if args.deep and ft and ft.get("status")=="FAIL_CORE":errors.append("Core ML framework self-test failed")
        checks.append(f"INTEGRATED ENGINE: {res.get('status')}")
    except Exception as e:errors.append(f"Integrated engine validation failed: {type(e).__name__}: {e}")
    try:
        from fastapi.testclient import TestClient
        web=load(ROOT/"OUTPUT_STUDIO_SERVER.py","validator_server")
        c=TestClient(web.app);h=c.get("/api/project-controls/health");r=c.get("/api/project-controls/output-studio/reports");lp=c.get("/api/project-controls/llm/providers")
        if h.status_code!=200:errors.append("Web health endpoint failed")
        if r.status_code!=200 or r.json().get("count")!=30:errors.append("Output Studio 30-report registry endpoint failed")
        if lp.status_code!=200 or len((lp.json() or {}).get("providers",{}))!=3:errors.append("Multi-LLM provider endpoint failed")
        checks += [f"WEB HEALTH: {h.status_code}",f"OUTPUT STUDIO REPORTS: {r.json().get('count') if r.status_code==200 else 'FAIL'}",f"LLM PROVIDER ENDPOINT: {lp.status_code}"]
    except Exception as e:errors.append(f"Web module validation failed: {type(e).__name__}: {e}")
    status="PASS" if not errors else "FAIL"
    out={"attribution":ATTRIBUTION,"status":status,"checks":checks,"warnings":warnings,"errors":errors,
         "real_project_model_note":"Validator does not fabricate or require a real-project model. Production model readiness becomes YES only after actual labelled project data is trained, validated and promoted."}
    print(ATTRIBUTION);print(json.dumps(out,indent=2,ensure_ascii=False));return 0 if not errors else 1
if __name__=="__main__":raise SystemExit(main())
