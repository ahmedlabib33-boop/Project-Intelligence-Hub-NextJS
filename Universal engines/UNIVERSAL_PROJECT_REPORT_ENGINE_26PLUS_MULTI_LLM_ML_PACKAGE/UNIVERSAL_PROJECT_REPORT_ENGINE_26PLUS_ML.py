#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
UNIVERSAL PROJECT REPORT ENGINE 26+ — REAL ML EDITION

Python AI Programming by Eng. Ahmed Labib

Extends the governed 26+ report engine with a real ML decision-support layer while
preserving all 26 global governance rules and all independent report-family rulebooks.

The native Primavera P6/XER network remains governing technical schedule evidence.
Machine learning is analytical decision support and cannot overwrite native CPM/TIA.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
import sys
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

VERSION="3.1.0"
ATTRIBUTION="Python AI Programming by Eng. Ahmed Labib"
AUTHOR="Eng. Ahmed Labib"
ROOT=Path(__file__).resolve().parent


def _load(path: Path,name: str):
    spec=importlib.util.spec_from_file_location(name,str(path))
    if spec is None or spec.loader is None:raise ImportError(path)
    mod=importlib.util.module_from_spec(spec);sys.modules[name]=mod;spec.loader.exec_module(mod);return mod

GOV=_load(ROOT/"UNIVERSAL_PROJECT_REPORT_ENGINE_26PLUS.py","governed_report_engine_26plus")
ML=_load(ROOT/"PROJECT_CONTROLS_ML_DECISION_SUPPORT.py","project_controls_ml_decision_support")
GOVERNANCE=GOV.GOVERNANCE
REPORT_FAMILIES=GOV.REPORT_FAMILIES
ALLOWED_REPORT_TYPES=GOV.ALLOWED_REPORT_TYPES

# Preserve public analysis APIs.
analyze_inputs=GOV.analyze_inputs
list_report_families=GOV.list_report_families


def save_json(path: str|Path,value: Any)->Path:
    p=Path(path);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(value,indent=2,ensure_ascii=False,default=str),encoding="utf-8");return p


def _emit(value: Any)->None:
    print(ATTRIBUTION)
    print(json.dumps(value,indent=2,ensure_ascii=False,default=str) if isinstance(value,(dict,list)) else value)


def _model_dirs(paths: Optional[Sequence[str|Path]])->List[Path]:
    out=[]
    for p0 in paths or []:
        p=Path(p0).expanduser().resolve()
        if not p.exists():raise FileNotFoundError(p)
        if (p/"model_bundle.joblib").exists() or (p/"retrieval_index.joblib").exists():out.append(p)
        elif p.is_dir():
            out.extend(x for x in p.iterdir() if x.is_dir() and ((x/"model_bundle.joblib").exists() or (x/"retrieval_index.joblib").exists()))
    seen=set();result=[]
    for p in out:
        k=str(p).casefold()
        if k not in seen:seen.add(k);result.append(p)
    return result


def _model_card(model_dir: Path)->Dict[str,Any]:
    p=model_dir/"model_card.json"
    if p.exists():return json.loads(p.read_text(encoding="utf-8"))
    task=ML._load_bundle_task(model_dir)
    return {"attribution":ATTRIBUTION,"task":task,"model_dir":str(model_dir),"status":"MODEL_CARD_MISSING"}


def _assess_ml_release(cards: List[Dict[str,Any]], drift_reports: List[Dict[str,Any]], framework_status: Dict[str,Any]) -> Dict[str,Any]:
    """Independent ML release gate. Optional backend absence is a warning, not a false package failure."""
    reasons=[]
    runtime=(framework_status or {}).get("runtime") or {}
    if runtime and not runtime.get("core_ml_ready"):
        return {"status":"FAIL_VALIDATION_ERROR","reasons":["Core scikit-learn ML runtime is unavailable."]}
    ft=(framework_status or {}).get("framework_test")
    if ft and ft.get("status")=="FAIL_CORE":
        return {"status":"FAIL_VALIDATION_ERROR","reasons":["Core scikit-learn fit/predict runtime validation failed."]}
    if ft and ft.get("status")=="PASS_PARTIAL":
        missing=ft.get("missing_optional_backends") or []
        failed=ft.get("failed_backends") or []
        if missing: reasons.append("Optional ML backends unavailable: "+", ".join(missing)+". Core ML remains operational.")
        if failed: reasons.append("Optional ML backend self-test failure: "+", ".join(failed)+".")
    if not cards:
        return {"status":"DRAFT_EVIDENCE_INCOMPLETE","reasons":reasons+["No trained project/portfolio model artifact was attached. Runtime readiness is not the same as a trained project model."]}
    real_cards=[c for c in cards if c.get("data_origin")=="real_project"]
    if not real_cards:
        reasons.append("No attached model is identified as trained from real project data; synthetic/reference models remain validation/support artifacts only.")
    required_class={"accuracy","precision","recall","f1","confidence","ood_score"}
    for c in cards:
        typ=c.get("task_type")
        m=c.get("metrics") or {}
        if typ=="classification":
            missing=sorted(required_class-set(m))
            if missing:reasons.append(f"{c.get('task')}: missing validation metrics {', '.join(missing)}")
        if typ=="regression":
            missing=sorted({"mae","rmse","r2","confidence","ood_score"}-set(m))
            if missing:reasons.append(f"{c.get('task')}: missing regression metrics {', '.join(missing)}")
        isolation=c.get("training_isolation") or {}
        if isolation and not isolation.get("project_aware"):
            reasons.append(f"{c.get('task')}: validation is row-level, not project-isolated; cross-project generalization is unverified.")
    for d in drift_reports:
        if d.get("status")=="HIGH":reasons.append(f"{d.get('model_task')}: high population drift detected.")
    if not real_cards:status="DRAFT_EVIDENCE_INCOMPLETE"
    elif any("missing validation metrics" in x.lower() for x in reasons):status="DRAFT_EVIDENCE_INCOMPLETE"
    elif reasons:status="PASS_WITH_WARNINGS"
    else:status="PASS"
    return {"status":status,"reasons":reasons,"real_project_model_count":len(real_cards)}


def _write_ml_html(path: Path,status: Dict[str,Any],cards: List[Dict[str,Any]],inference_rows: List[Dict[str,Any]],drift_reports: List[Dict[str,Any]])->None:
    def esc(x):
        import html
        return html.escape(str(x))
    card_html="".join(
        f"<tr><td>{esc(c.get('task'))}</td><td>{esc(c.get('selected_framework',c.get('selected_model','')))}</td><td>{esc(c.get('training_records',''))}</td><td>{esc((c.get('metrics') or {}).get('accuracy',(c.get('metrics') or {}).get('r2','')))}</td><td>{esc((c.get('metrics') or {}).get('f1',''))}</td><td>{esc((c.get('metrics') or {}).get('confidence',''))}</td></tr>" for c in cards
    ) or "<tr><td colspan='6'>No project-specific trained model was attached to this report run.</td></tr>"
    inf_html="".join(f"<tr><td>{esc(r.get('task'))}</td><td>{esc(r.get('rows'))}</td><td>{esc(r.get('output'))}</td></tr>" for r in inference_rows) or "<tr><td colspan='3'>No inference dataset supplied.</td></tr>"
    drift_html="".join(f"<tr><td>{esc(r.get('model_task'))}</td><td>{esc(r.get('drift_score'))}</td><td>{esc(r.get('status'))}</td></tr>" for r in drift_reports) or "<tr><td colspan='3'>No drift run supplied.</td></tr>"
    html=f"""<!doctype html><html><head><meta charset='utf-8'><title>ML Decision Support</title><style>
body{{font-family:Arial,sans-serif;margin:28px;color:#102A43}}h1,h2{{color:#06294F}}.banner{{background:#06294F;color:white;padding:18px;border-radius:10px}}.gold{{color:#F8B915;font-weight:700}}table{{border-collapse:collapse;width:100%;margin:14px 0 26px}}th,td{{border:1px solid #BED0E2;padding:9px;text-align:left}}th{{background:#06294F;color:white}}.rule{{padding:12px;background:#FFF2E3;border-left:5px solid #D76A00}}code{{background:#eef2f5;padding:2px 5px}}</style></head><body>
<div class='banner'><div class='gold'>{esc(ATTRIBUTION)}</div><h1>Project Controls ML Decision-Support Report</h1><div>Engine v{esc(VERSION)} | Author: {esc(AUTHOR)}</div></div>
<p class='rule'><b>Governing control:</b> Native Primavera P6/XER CPM/TIA results govern formal schedule conclusions. ML is decision support only and cannot create missing evidence or entitlement.</p>
<h2>Capability Status</h2><pre>{esc(json.dumps(status,indent=2,ensure_ascii=False,default=str))}</pre>
<h2>Attached Trained Models</h2><table><tr><th>Task</th><th>Framework / Model</th><th>Training Records</th><th>Accuracy / R²</th><th>F1</th><th>Confidence</th></tr>{card_html}</table>
<h2>Inference Runs</h2><table><tr><th>Task</th><th>Rows</th><th>Output</th></tr>{inf_html}</table>
<h2>Drift Monitoring</h2><table><tr><th>Task</th><th>Drift Score</th><th>Status</th></tr>{drift_html}</table>
<h2>Accuracy Control</h2><p>No universal 100% predictive accuracy is claimed. Accuracy, Precision, Recall, F1, confidence, OOD and drift values are measured from the applicable model/data and remain subject to project-aware validation.</p>
</body></html>"""
    path.parent.mkdir(parents=True,exist_ok=True);path.write_text(html,encoding="utf-8")


def _rebuild_package(out: Path,zip_path: Path)->None:
    zip_path.unlink(missing_ok=True)
    with zipfile.ZipFile(zip_path,"w",zipfile.ZIP_DEFLATED) as zf:
        for f in out.rglob("*"):
            if f.is_file():zf.write(f,f.relative_to(out.parent))


def generate_report(
    input_files: Sequence[str|Path],
    output_directory: str|Path,
    report_type: str="auto",
    config_path: Optional[str|Path]=None,
    context: Optional[Dict[str,Any]]=None,
    context_path: Optional[str|Path]=None,
    strict: bool=False,
    keep_working: bool=False,
    ml_model_dirs: Optional[Sequence[str|Path]]=None,
    ml_inference_data: Optional[str|Path]=None,
    run_ml_framework_test: bool=True,
)->Dict[str,Any]:
    result=GOV.generate_report(input_files,output_directory,report_type,config_path,context,context_path,strict,keep_working)
    out=Path(output_directory).expanduser().resolve();mldir=out/"ML_DECISION_SUPPORT";mldir.mkdir(parents=True,exist_ok=True)
    models=_model_dirs(ml_model_dirs)
    status=ML.capability_status(run_ml_framework_test,models)
    cards=[];inference_runs=[];drift_reports=[]
    for i,d in enumerate(models,1):
        card=_model_card(d);card["attached_model_dir"]=str(d);cards.append(card)
        task=card.get("task") or ML._load_bundle_task(d)
        dest=mldir/f"MODEL_{i:02d}_{task}"
        dest.mkdir(parents=True,exist_ok=True)
        for fn in ["model_card.json","training_metrics.json","feature_schema.json","confusion_matrix.csv","training_manifest.json"]:
            src=d/fn
            if src.exists():shutil.copy2(src,dest/fn)
        if ml_inference_data and (d/"model_bundle.joblib").exists():
            data=ML.load_table(ml_inference_data);typ=ML.TASK_REGISTRY.get(task,{}).get("type")
            try:
                pred=ML.anomaly_predict(d,data) if typ=="anomaly" else ML.predict(d,data)
                pp=dest/"CURRENT_INFERENCE.csv";pred.to_csv(pp,index=False)
                inference_runs.append({"task":task,"rows":len(pred),"output":str(pp.relative_to(out)),"ood_count":int(pred["ood_flag"].sum()) if "ood_flag" in pred else None})
                drift=ML.drift_from_model(d,data);drift_reports.append(drift);save_json(dest/"CURRENT_DRIFT.json",drift)
            except Exception as e:
                inference_runs.append({"task":task,"status":"INFERENCE_NOT_RUN","reason":f"{type(e).__name__}: {e}"})
    # Avoid a pandas dependency in this wrapper when not needed.
    ml_release=_assess_ml_release(cards,drift_reports,status)
    summary={
        "attribution":ATTRIBUTION,"author":AUTHOR,"engine_version":VERSION,"governed_engine_version":getattr(GOV,"VERSION","unknown"),
        "ml_release_status":ml_release["status"],"ml_release_reasons":ml_release["reasons"],
        "global_governance_rules_preserved":GOVERNANCE["global_governance_layer"]["rule_count"],"report_family_rulebooks_preserved":len(REPORT_FAMILIES),
        "ml_status":status,"attached_trained_model_count":len(models),"model_cards":cards,"inference_runs":inference_runs,"drift_reports":drift_reports,
        "governance_statement":"Native Primavera P6/XER CPM/TIA governs formal schedule conclusions; ML remains analytical decision support.",
        "accuracy_statement":"Measured validation metrics govern. No universal 100% predictive accuracy claim is permitted.",
    }
    save_json(mldir/"ML_CAPABILITY_AND_RUN_STATUS.json",summary)
    save_json(mldir/"ML_TASK_REGISTRY.json",{"attribution":ATTRIBUTION,"task_count":len(ML.TASK_REGISTRY),"tasks":ML.TASK_REGISTRY})
    _write_ml_html(mldir/"ML_DECISION_SUPPORT_REPORT.html",status,cards,inference_runs,drift_reports)
    if run_ml_framework_test and status.get("framework_test"):save_json(mldir/"FRAMEWORK_FIT_PREDICT_SELF_TEST.json",status["framework_test"])

    # Enrich manifest/package identity without weakening the governed release status.
    manifest_path=Path(result["manifest"]);manifest=json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest.update({
        "package_identity":"Universal Project Report Engine 26+ Real ML Edition","ml_engine_version":ML.VERSION,"integrated_engine_version":VERSION,
        "ml_task_count":len(ML.TASK_REGISTRY),"actual_ml_fit_predict_runtime_verified":bool(status.get("framework_test") and status["framework_test"].get("status") in {"PASS_FULL","PASS_PARTIAL"}),
        "ml_implementation_completeness_percent":status.get("ML implementation completeness percent"),"attached_trained_model_count":len(models),
        "ml_accuracy_policy":"No universal 100% accuracy claim; per-model measured validation metrics govern.",
    })
    # Rebuild file manifest so ML outputs receive SHA-256 traceability as well.
    manifest["files"]=[]
    for f in sorted(out.rglob("*")):
        if f.is_file() and f!=manifest_path:manifest["files"].append({"path":str(f.relative_to(out)),"size_bytes":f.stat().st_size,"sha256":GOV.file_sha256(f)})
    save_json(manifest_path,manifest)
    zip_path=Path(result["package_zip"]);_rebuild_package(out,zip_path)
    result.update({
        "engine_version":VERSION,"ml_engine_version":ML.VERSION,"ml_decision_support":"enabled","ml_task_count":len(ML.TASK_REGISTRY),
        "actual_trained_machine_learning_runtime":"YES" if any(c.get("data_origin")=="real_project" for c in cards) else "NO_REAL_PROJECT_MODEL_ATTACHED",
        "ml_implementation_completeness_percent":status.get("ML implementation completeness percent"),"attached_trained_model_count":len(models),
        "ml_release_status":ml_release["status"],"ml_release_reasons":ml_release["reasons"],
        "ml_directory":str(mldir),"ml_status_file":str(mldir/"ML_CAPABILITY_AND_RUN_STATUS.json"),"package_zip":str(zip_path),
    })
    return result


def self_test(run_framework_test: bool=True)->Dict[str,Any]:
    governed=GOV.self_test();ml=ML.capability_status(run_framework_test)
    errors=[]
    if governed.get("status")!="PASS":errors.append("Governed 26+ engine self-test failed")
    if GOVERNANCE["global_governance_layer"]["rule_count"]!=26:errors.append("26 universal rules not preserved")
    if len(ML.TASK_REGISTRY)!=15:errors.append("ML task registry is not 15 capabilities")
    if ml.get("ML implementation completeness percent")!=100.0:errors.append("ML capability implementation is incomplete")
    if run_framework_test and (not ml.get("framework_test") or ml["framework_test"].get("status")=="FAIL_CORE"):errors.append("Core scikit-learn fit/predict validation failed")
    return {"attribution":ATTRIBUTION,"author":AUTHOR,"status":"PASS" if not errors else "FAIL","engine_version":VERSION,"governance":governed,"ml":ml,"errors":errors}


def main(argv=None)->int:
    ap=argparse.ArgumentParser(description=f"Universal Project Report Engine 26+ Real ML Edition v{VERSION}")
    ap.add_argument("--version",action="version",version=VERSION);sp=ap.add_subparsers(dest="cmd",required=True)
    st=sp.add_parser("self-test");st.add_argument("--skip-framework-test",action="store_true")
    ms=sp.add_parser("ml-status");ms.add_argument("--run-framework-test",action="store_true")
    lf=sp.add_parser("list-reports")
    lr=sp.add_parser("list-ml-tasks")
    g=sp.add_parser("generate");g.add_argument("--input",nargs="+",required=True);g.add_argument("--output",required=True);g.add_argument("--report-type",default="auto",choices=sorted(ALLOWED_REPORT_TYPES));g.add_argument("--config");g.add_argument("--context-json");g.add_argument("--strict",action="store_true");g.add_argument("--keep-working",action="store_true");g.add_argument("--ml-model-dir",nargs="*");g.add_argument("--ml-inference-data");g.add_argument("--skip-ml-framework-test",action="store_true")
    # Delegate full ML lifecycle commands to ML module by exposing common commands here.
    tr=sp.add_parser("ml-train");tr.add_argument("--task",required=True,choices=sorted(k for k,v in ML.TASK_REGISTRY.items() if v["type"] in {"classification","regression"}));tr.add_argument("--data",required=True);tr.add_argument("--target",required=True);tr.add_argument("--output",required=True);tr.add_argument("--project-column",default="project_id");tr.add_argument("--exclude",nargs="*");tr.add_argument("--fast",action="store_true");tr.add_argument("--data-origin",default="unspecified",choices=["unspecified","real_project","synthetic_benchmark","external_reference"]);tr.add_argument("--project-scope")
    an=sp.add_parser("ml-train-anomaly");an.add_argument("--task",required=True,choices=sorted(k for k,v in ML.TASK_REGISTRY.items() if v["type"]=="anomaly"));an.add_argument("--data",required=True);an.add_argument("--output",required=True);an.add_argument("--exclude",nargs="*")
    pr=sp.add_parser("ml-predict");pr.add_argument("--model-dir",required=True);pr.add_argument("--data",required=True);pr.add_argument("--output",required=True)
    dr=sp.add_parser("ml-drift");dr.add_argument("--model-dir",required=True);dr.add_argument("--data",required=True);dr.add_argument("--output",required=True)
    args=ap.parse_args(argv)
    if args.cmd=="self-test":_emit(self_test(not args.skip_framework_test));return 0
    if args.cmd=="ml-status":_emit(ML.capability_status(args.run_framework_test));return 0
    if args.cmd=="list-reports":_emit({"report_family_count":len(REPORT_FAMILIES),"reports":GOV.list_report_families()});return 0
    if args.cmd=="list-ml-tasks":_emit({"task_count":len(ML.TASK_REGISTRY),"tasks":ML.TASK_REGISTRY});return 0
    if args.cmd=="generate":
        r=generate_report(args.input,args.output,args.report_type,args.config,context_path=args.context_json,strict=args.strict,keep_working=args.keep_working,ml_model_dirs=args.ml_model_dir,ml_inference_data=args.ml_inference_data,run_ml_framework_test=not args.skip_ml_framework_test);_emit(r);return 0
    if args.cmd=="ml-train":_emit(ML.train_supervised(ML.load_table(args.data),args.task,args.target,args.output,args.project_column,args.exclude,not args.fast,data_origin=args.data_origin,project_scope=args.project_scope));return 0
    if args.cmd=="ml-train-anomaly":_emit(ML.train_anomaly(ML.load_table(args.data),args.task,args.output,args.exclude));return 0
    if args.cmd=="ml-predict":
        task=ML._load_bundle_task(Path(args.model_dir));df=ML.load_table(args.data);typ=ML.TASK_REGISTRY.get(task,{}).get("type");out=ML.anomaly_predict(args.model_dir,df) if typ=="anomaly" else ML.predict(args.model_dir,df);out.to_csv(args.output,index=False);_emit({"status":"completed","task":task,"rows":len(out),"output":str(Path(args.output).resolve())});return 0
    if args.cmd=="ml-drift":save_json(args.output,ML.drift_from_model(args.model_dir,ML.load_table(args.data)));_emit({"status":"completed","output":str(Path(args.output).resolve())});return 0
    return 1


if __name__=="__main__":raise SystemExit(main())
