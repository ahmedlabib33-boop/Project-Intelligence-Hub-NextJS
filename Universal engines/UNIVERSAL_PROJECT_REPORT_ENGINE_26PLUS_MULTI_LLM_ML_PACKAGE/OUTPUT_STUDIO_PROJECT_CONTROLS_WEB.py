#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Drop-in Output Studio web module for the governed 30-report + ML engine.

Python AI Programming by Eng. Ahmed Labib

Integration options:
1) Existing FastAPI app: app.include_router(create_router())
2) Standalone: uvicorn OUTPUT_STUDIO_SERVER:app --host 0.0.0.0 --port 8755
3) UI registry: register_output_studio_reports(existing_cards)

The host website remains responsible for authentication/authorization. This module never
accepts arbitrary server-side filesystem paths from HTTP callers; evidence arrives as uploads.
"""
from __future__ import annotations
import hashlib, importlib.util, json, os, re, shutil, sys, uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

ATTRIBUTION="Python AI Programming by Eng. Ahmed Labib"
AUTHOR="Eng. Ahmed Labib"
VERSION="2.0.0"
ROOT=Path(__file__).resolve().parent


def _load(path:Path,name:str):
    spec=importlib.util.spec_from_file_location(name,str(path))
    if spec is None or spec.loader is None:raise ImportError(path)
    mod=importlib.util.module_from_spec(spec);sys.modules[name]=mod;spec.loader.exec_module(mod);return mod

ENGINE=_load(ROOT/"UNIVERSAL_PROJECT_REPORT_ENGINE_26PLUS_ML.py","output_studio_engine")
ML=ENGINE.ML
REGMOD=_load(ROOT/"PROJECT_CONTROLS_MODEL_REGISTRY.py","output_studio_model_registry")
RUNTIME=_load(ROOT/"INSTALL_FULL_RUNTIME.py","output_studio_runtime")
LLM=_load(ROOT/"PROJECT_CONTROLS_MULTI_LLM_ORCHESTRATOR.py","output_studio_multi_llm")
ADVML=_load(ROOT/"PROJECT_CONTROLS_ADVANCED_ENSEMBLE_ML.py","output_studio_advanced_ml")


def _sha(path:Path)->str:
    h=hashlib.sha256()
    with path.open("rb") as f:
        for c in iter(lambda:f.read(1024*1024),b""):h.update(c)
    return h.hexdigest()

def _safe_name(name:str)->str:
    base=Path(name or "upload.bin").name
    return re.sub(r"[^A-Za-z0-9_.() -]+","_",base)[:180] or "upload.bin"

def output_studio_manifest()->Dict[str,Any]:
    reports=ENGINE.list_report_families()
    return {
        "attribution":ATTRIBUTION,"author":AUTHOR,"module":"Project Controls Intelligence / Reporting Engine",
        "module_version":VERSION,"report_family_count":len(reports),"reports":reports,
        "ml_task_count":len(ML.TASK_REGISTRY),"ml_tasks":ML.TASK_REGISTRY,
        "multi_llm":{"providers":["claude","kimi","deepseek"],"advisory_only":True,"routing_modes":["fast","balanced","assurance","auto"]},
        "advanced_ensemble_ml":{"enabled":True,"quality_latency_weighting":True,"project_aware_validation":True},
        "governance":{"global_rule_count":ENGINE.GOVERNANCE["global_governance_layer"]["rule_count"],"native_schedule_supremacy":True,"ml_decision_support_only":True},
    }

def register_output_studio_reports(existing_cards:Optional[List[Dict[str,Any]]]=None)->List[Dict[str,Any]]:
    """Append 30 governed report cards without modifying the caller's existing four cards."""
    cards=list(existing_cards or [])
    known={str(x.get("key")) for x in cards}
    for r in ENGINE.list_report_families():
        key=f"project_controls::{r['key']}"
        if key in known:continue
        cards.append({
            "key":key,"id":r["id"],"title":r["title"],"group":"Project Controls Intelligence",
            "engine_report_type":r["key"],"native_schedule_required":r["native_schedule_required"],
            "rule_count":r["rule_count"],"attribution":ATTRIBUTION,"enabled":True,
        })
    return cards

class OutputStudioService:
    def __init__(self,run_root:Optional[str|Path]=None,model_registry:Optional[str|Path]=None):
        self.run_root=Path(run_root or os.getenv("PROJECT_CONTROLS_WEB_RUNS") or (ROOT/"WEB_RUNS")).expanduser().resolve();self.run_root.mkdir(parents=True,exist_ok=True)
        self.registry=REGMOD.ModelRegistry(model_registry or os.getenv("PROJECT_CONTROLS_MODEL_REGISTRY") or (ROOT/"MODEL_REGISTRY"))
    def health(self,run_framework_test:bool=False)->Dict[str,Any]:
        runtime=RUNTIME.check();ml=ML.capability_status(run_framework_test,[self.registry.resolve(x["model_id"]) for x in self.registry.list()] if self.registry.list() else None)
        reg=self.registry.readiness()
        llm=LLM.provider_runtime_status()
        return {
            "attribution":ATTRIBUTION,"status":"READY" if runtime["core_ready"] and runtime["web_ready"] else "NOT_READY",
            "website_module":"READY" if runtime["web_ready"] else "MISSING_WEB_DEPENDENCIES",
            "core_ml_runtime":"READY" if runtime["core_ready"] else "NOT_READY",
            "full_optional_ml_backends":"READY" if runtime["full_ml_backend_ready"] else "PARTIAL",
            "multi_llm_runtime":"READY" if llm["all_configured"] else "PARTIAL_KEYS_REQUIRED",
            "actual_trained_machine_learning":reg["actual_trained_machine_learning"],
            "runtime":runtime,"ml":ml,"advanced_ensemble_ml":{"enabled":True,"version":ADVML.VERSION},"multi_llm":llm,"model_registry":reg,
            "truthful_readiness_note":"Runtime self-tests and external LLM availability are not real-project trained accuracy. Actual trained ML becomes YES only after a validated real-project model is registered/promoted. LLM consensus remains advisory and cannot override native P6/XER CPM/TIA.",
        }
    def new_run(self,prefix:str)->Path:
        rid=f"{prefix}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}";p=self.run_root/rid;p.mkdir(parents=True,exist_ok=False);return p
    def artifact(self,run_id:str,name:str)->Path:
        root=(self.run_root/run_id).resolve();p=(root/Path(name).name).resolve()
        if self.run_root not in root.parents or root not in p.parents:raise ValueError("Invalid artifact path")
        if not p.exists():raise FileNotFoundError(name)
        return p


def create_router(prefix:str="/api/project-controls",run_root:Optional[str|Path]=None,model_registry:Optional[str|Path]=None):
    try:
        from fastapi import APIRouter, File, Form, HTTPException, UploadFile
        from fastapi.responses import FileResponse
        from starlette.concurrency import run_in_threadpool
    except Exception as e:raise RuntimeError("FastAPI web dependencies are missing. Run: python INSTALL_FULL_RUNTIME.py --install") from e
    # FastAPI/Pydantic resolves postponed annotations from module globals.
    globals().update({"UploadFile":UploadFile,"FileResponse":FileResponse})
    service=OutputStudioService(run_root,model_registry)
    router=APIRouter(prefix=prefix,tags=["Project Controls Output Studio"])
    max_bytes=int(os.getenv("PROJECT_CONTROLS_MAX_UPLOAD_BYTES",str(512*1024*1024)))

    async def save_upload(upload:UploadFile,dest:Path)->Path:
        dest.parent.mkdir(parents=True,exist_ok=True);total=0
        with dest.open("wb") as f:
            while True:
                chunk=await upload.read(1024*1024)
                if not chunk:break
                total+=len(chunk)
                if total>max_bytes:
                    f.close();dest.unlink(missing_ok=True);raise HTTPException(413,f"Upload exceeds {max_bytes} bytes")
                f.write(chunk)
        return dest

    @router.get("/health")
    async def health(run_framework_test:bool=False):return await run_in_threadpool(service.health,run_framework_test)

    @router.get("/output-studio/manifest")
    async def manifest():return output_studio_manifest()

    @router.get("/output-studio/reports")
    async def reports():return {"attribution":ATTRIBUTION,"count":len(ENGINE.list_report_families()),"reports":register_output_studio_reports([])}

    @router.get("/ml/tasks")
    async def ml_tasks():return {"attribution":ATTRIBUTION,"count":len(ML.TASK_REGISTRY),"tasks":ML.TASK_REGISTRY}

    @router.get("/ml/models")
    async def models():return service.registry.readiness()

    @router.get("/llm/providers")
    async def llm_providers():return LLM.provider_runtime_status()

    @router.post("/llm/consensus")
    async def llm_consensus(
        question:str=Form(...), evidence_json:str=Form(...), context_json:str=Form("{}"),
        mode:str=Form("auto"), risk_level:str=Form("medium"), project_id:Optional[str]=Form(None),
        report_family:Optional[str]=Form(None), conflict_count:int=Form(0), ml_confidence:Optional[float]=Form(None),
    ):
        try:evidence=json.loads(evidence_json)
        except Exception as e:raise HTTPException(400,f"Invalid evidence_json: {e}")
        try:context=json.loads(context_json or "{}")
        except Exception as e:raise HTTPException(400,f"Invalid context_json: {e}")
        if not isinstance(evidence,dict) or not isinstance(context,dict):raise HTTPException(400,"evidence_json and context_json must be JSON objects")
        if mode not in {"auto","fast","balanced","assurance"}:raise HTTPException(400,"Invalid mode")
        run=service.new_run("llm")
        try:
            result=await LLM.MultiLLMOrchestrator().analyze(question=question,evidence_packet=evidence,task_context=context,mode=mode,risk_level=risk_level,conflict_count=conflict_count,ml_confidence=ml_confidence,project_id=project_id,report_family=report_family)
        except Exception as e:raise HTTPException(422,f"Multi-LLM analysis failed: {type(e).__name__}: {e}")
        outp=run/"multi_llm_consensus.json";outp.write_text(json.dumps(result,indent=2,ensure_ascii=False,default=str),encoding="utf-8")
        return {"attribution":ATTRIBUTION,"run_id":run.name,"consensus":result.get("consensus"),"metadata":result.get("metadata"),"download_url":f"{prefix}/artifacts/{run.name}/{outp.name}","governing_control":"Multi-LLM output is advisory only; native P6/XER CPM/TIA and verified evidence remain governing."}

    @router.post("/ml/train-ensemble")
    async def train_ensemble(
        data:UploadFile=File(...),task:str=Form(...),target:str=Form(...),project_column:str=Form("project_id"),
        data_origin:str=Form(...),project_scope:Optional[str]=Form(None),full_load:bool=Form(True),max_ensemble_models:int=Form(3),promote:bool=Form(False),
    ):
        if task not in ML.TASK_REGISTRY or ML.TASK_REGISTRY[task]["type"] not in {"classification","regression"}:raise HTTPException(400,"Task is not a supervised ML task")
        if data_origin not in {"real_project","synthetic_benchmark","external_reference","unspecified"}:raise HTTPException(400,"Invalid data_origin")
        run=service.new_run("ensemble-train");dp=await save_upload(data,run/_safe_name(data.filename));modeldir=run/"MODEL"
        try:
            df=await run_in_threadpool(ML.load_table,dp)
            card=await run_in_threadpool(ADVML.train_efficient_ensemble,df,task,target,modeldir,project_column,None,full_load,.2,data_origin,project_scope,max_ensemble_models)
            card["training_dataset_sha256"]=_sha(dp);(modeldir/"model_card.json").write_text(json.dumps(card,indent=2,ensure_ascii=False,default=str),encoding="utf-8")
            reg=await run_in_threadpool(service.registry.register,modeldir,None,promote)
        except Exception as e:raise HTTPException(422,f"Ensemble training failed: {type(e).__name__}: {e}")
        return {"attribution":ATTRIBUTION,"run_id":run.name,"model":reg,"model_card":card,"governance_note":"Ensemble metrics are measured validation results only. Native schedule and evidence supremacy remain unchanged."}

    @router.post("/ml/predict-ensemble")
    async def predict_ensemble(model_id:str=Form(...),data:UploadFile=File(...)):
        try:modeldir=service.registry.resolve(model_id)
        except Exception as e:raise HTTPException(404,str(e))
        if not (modeldir/"ensemble_bundle.joblib").exists():raise HTTPException(400,"Selected model is not an advanced ensemble bundle")
        run=service.new_run("ensemble-predict");dp=await save_upload(data,run/_safe_name(data.filename));outp=run/"ensemble_predictions.csv"
        try:
            df=await run_in_threadpool(ML.load_table,dp);pred=await run_in_threadpool(ADVML.predict_efficient_ensemble,modeldir,df);pred.to_csv(outp,index=False)
        except Exception as e:raise HTTPException(422,f"Ensemble inference failed: {type(e).__name__}: {e}")
        return {"attribution":ATTRIBUTION,"run_id":run.name,"model_id":model_id,"rows":len(pred),"download_url":f"{prefix}/artifacts/{run.name}/{outp.name}","governing_control":"ML is decision support only; native P6/XER CPM/TIA remains governing where applicable."}

    @router.post("/reports/generate")
    async def generate_report(
        files:List[UploadFile]=File(...), report_type:str=Form("auto"), context_json:str=Form("{}"),
        model_ids:str=Form("[]"), ml_inference_file:Optional[UploadFile]=File(None), strict:bool=Form(False),
    ):
        allowed={r["key"] for r in ENGINE.list_report_families()}|{"auto","tia"}
        if report_type not in allowed:raise HTTPException(400,"Unsupported report_type")
        try:context=json.loads(context_json or "{}")
        except Exception as e:raise HTTPException(400,f"Invalid context_json: {e}")
        if not isinstance(context,dict):raise HTTPException(400,"context_json must be an object")
        try:mids=json.loads(model_ids or "[]")
        except Exception as e:raise HTTPException(400,f"Invalid model_ids: {e}")
        if not isinstance(mids,list):raise HTTPException(400,"model_ids must be a JSON list")
        run=service.new_run("report");evidence=run/"evidence";evidence.mkdir()
        inputs=[]
        for u in files:inputs.append(str(await save_upload(u,evidence/_safe_name(u.filename))))
        inference=None
        if ml_inference_file:inference=str(await save_upload(ml_inference_file,run/_safe_name(ml_inference_file.filename)))
        model_dirs=[]
        try:model_dirs=[str(service.registry.resolve(str(mid))) for mid in mids]
        except Exception as e:raise HTTPException(400,f"Unknown model: {e}")
        cp=run/"context.json";cp.write_text(json.dumps(context,indent=2,ensure_ascii=False),encoding="utf-8")
        out=run/"REPORT_OUTPUT"
        try:
            result=await run_in_threadpool(ENGINE.generate_report,inputs,out,report_type,None,None,cp,strict,False,model_dirs,inference,False)
        except Exception as e:raise HTTPException(422,f"Report generation failed: {type(e).__name__}: {e}")
        zip_path=Path(result["package_zip"]);local=run/zip_path.name
        if zip_path.resolve()!=local.resolve():shutil.copy2(zip_path,local)
        summary={"attribution":ATTRIBUTION,"run_id":run.name,"report_type":result.get("report_type"),"release_status":result.get("release_status"),"ml_release_status":result.get("ml_release_status"),"download_url":f"{prefix}/artifacts/{run.name}/{local.name}","result":result}
        (run/"WEB_RUN_SUMMARY.json").write_text(json.dumps(summary,indent=2,ensure_ascii=False,default=str),encoding="utf-8")
        return summary

    @router.post("/ml/train")
    async def train_model(
        data:UploadFile=File(...),task:str=Form(...),target:str=Form(...),project_column:str=Form("project_id"),
        data_origin:str=Form(...),project_scope:Optional[str]=Form(None),promote:bool=Form(False),full_load:bool=Form(True),
    ):
        if task not in ML.TASK_REGISTRY or ML.TASK_REGISTRY[task]["type"] not in {"classification","regression"}:raise HTTPException(400,"Task is not a supervised ML task")
        if data_origin not in {"real_project","synthetic_benchmark","external_reference","unspecified"}:raise HTTPException(400,"Invalid data_origin")
        run=service.new_run("train");dp=await save_upload(data,run/_safe_name(data.filename));modeldir=run/"MODEL"
        try:
            df=await run_in_threadpool(ML.load_table,dp)
            card=await run_in_threadpool(ML.train_supervised,df,task,target,modeldir,project_column,None,full_load,.2,data_origin,project_scope)
            card["training_dataset_sha256"]=_sha(dp);(modeldir/"model_card.json").write_text(json.dumps(card,indent=2,ensure_ascii=False,default=str),encoding="utf-8")
            reg=await run_in_threadpool(service.registry.register,modeldir,None,promote)
        except Exception as e:raise HTTPException(422,f"Training failed: {type(e).__name__}: {e}")
        return {"attribution":ATTRIBUTION,"run_id":run.name,"model":reg,"model_card":card,"production_note":"Promotion requires a model explicitly identified as real_project. Metrics remain measured validation results, not a universal accuracy guarantee."}

    @router.post("/ml/predict")
    async def predict(model_id:str=Form(...),data:UploadFile=File(...)):
        try:modeldir=service.registry.resolve(model_id)
        except Exception as e:raise HTTPException(404,str(e))
        run=service.new_run("predict");dp=await save_upload(data,run/_safe_name(data.filename));outp=run/"predictions.csv"
        try:
            df=await run_in_threadpool(ML.load_table,dp);task=ML._load_bundle_task(modeldir);typ=ML.TASK_REGISTRY.get(task,{}).get("type")
            pred=await run_in_threadpool(ML.anomaly_predict,modeldir,df) if typ=="anomaly" else await run_in_threadpool(ML.predict,modeldir,df)
            pred.to_csv(outp,index=False)
        except Exception as e:raise HTTPException(422,f"Inference failed: {type(e).__name__}: {e}")
        return {"attribution":ATTRIBUTION,"run_id":run.name,"model_id":model_id,"task":task,"rows":len(pred),"download_url":f"{prefix}/artifacts/{run.name}/{outp.name}","governing_control":"ML is decision support only; native P6/XER CPM/TIA remains governing where applicable."}

    @router.post("/ml/drift")
    async def drift(model_id:str=Form(...),data:UploadFile=File(...)):
        try:modeldir=service.registry.resolve(model_id)
        except Exception as e:raise HTTPException(404,str(e))
        run=service.new_run("drift");dp=await save_upload(data,run/_safe_name(data.filename))
        try:report=await run_in_threadpool(ML.drift_from_model,modeldir,ML.load_table(dp))
        except Exception as e:raise HTTPException(422,f"Drift calculation failed: {type(e).__name__}: {e}")
        p=run/"drift.json";p.write_text(json.dumps(report,indent=2,ensure_ascii=False,default=str),encoding="utf-8")
        return {"attribution":ATTRIBUTION,"run_id":run.name,"model_id":model_id,"drift":report,"download_url":f"{prefix}/artifacts/{run.name}/{p.name}"}

    @router.get("/artifacts/{run_id}/{filename}")
    async def artifact(run_id:str,filename:str):
        try:p=service.artifact(run_id,filename)
        except FileNotFoundError:raise HTTPException(404,"Artifact not found")
        except Exception as e:raise HTTPException(400,str(e))
        return FileResponse(str(p),filename=p.name)

    return router
