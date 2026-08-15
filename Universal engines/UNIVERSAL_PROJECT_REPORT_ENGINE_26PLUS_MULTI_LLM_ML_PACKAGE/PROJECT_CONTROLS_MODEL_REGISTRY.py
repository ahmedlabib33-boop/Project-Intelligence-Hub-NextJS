#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Filesystem-backed governed model registry.

Python AI Programming by Eng. Ahmed Labib
"""
from __future__ import annotations
import hashlib, json, os, re, shutil, uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

ATTRIBUTION="Python AI Programming by Eng. Ahmed Labib"
AUTHOR="Eng. Ahmed Labib"

def _json(path:Path):return json.loads(path.read_text(encoding="utf-8"))
def _save(path:Path,value):path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value,indent=2,ensure_ascii=False,default=str),encoding="utf-8")
def _sha(path:Path):
    h=hashlib.sha256()
    with path.open("rb") as f:
        for c in iter(lambda:f.read(1024*1024),b""):h.update(c)
    return h.hexdigest()
def _slug(x:str):return re.sub(r"[^A-Za-z0-9_.-]+","_",x).strip("_") or "model"

class ModelRegistry:
    def __init__(self,root:Optional[str|Path]=None):
        self.root=Path(root or os.getenv("PROJECT_CONTROLS_MODEL_REGISTRY") or "MODEL_REGISTRY").expanduser().resolve()
        self.root.mkdir(parents=True,exist_ok=True)
    def register(self,model_dir:str|Path,name:Optional[str]=None,promote:bool=False)->Dict[str,Any]:
        src=Path(model_dir).resolve();cardp=src/"model_card.json"
        if not cardp.exists():raise ValueError("model_card.json is required")
        if not (src/"model_bundle.joblib").exists() and not (src/"retrieval_index.joblib").exists():raise ValueError("No saved model artifact found")
        card=_json(cardp);task=str(card.get("task") or "unknown")
        model_id=f"{_slug(task)}-{uuid.uuid4().hex[:10]}"
        dest=self.root/model_id;shutil.copytree(src,dest)
        real=card.get("data_origin")=="real_project"
        requested=bool(promote);promoted=bool(requested and real)
        registry={
            "attribution":ATTRIBUTION,"author":AUTHOR,"model_id":model_id,"name":name or task,"task":task,
            "data_origin":card.get("data_origin","unspecified"),"project_scope":card.get("project_scope"),
            "registered_at":datetime.now(timezone.utc).isoformat(),"promotion_status":"PROMOTED" if promoted else "DRAFT",
            "promotion_reason":"Real-project model explicitly promoted" if promoted else "Promotion requires data_origin=real_project" if requested and not real else "Not promoted",
            "model_card_sha256":_sha(dest/"model_card.json"),
            "artifact_sha256":_sha(dest/"model_bundle.joblib") if (dest/"model_bundle.joblib").exists() else _sha(dest/"retrieval_index.joblib"),
        }
        _save(dest/"registry_record.json",registry);return registry
    def list(self)->List[Dict[str,Any]]:
        rows=[]
        for d in sorted(self.root.iterdir()):
            p=d/"registry_record.json"
            if d.is_dir() and p.exists():
                try:rows.append(_json(p))
                except Exception:pass
        return rows
    def resolve(self,model_id:str)->Path:
        d=(self.root/model_id).resolve()
        if self.root!=d and self.root not in d.parents:raise ValueError("Invalid model id")
        if not d.exists():raise FileNotFoundError(model_id)
        return d
    def production_models(self)->List[Dict[str,Any]]:
        return [r for r in self.list() if r.get("promotion_status")=="PROMOTED" and r.get("data_origin")=="real_project"]
    def readiness(self)->Dict[str,Any]:
        rows=self.list();prod=self.production_models()
        return {"attribution":ATTRIBUTION,"registered_model_count":len(rows),"real_project_promoted_model_count":len(prod),"actual_trained_machine_learning":"YES" if prod else "NO — AWAITING VALIDATED REAL-PROJECT MODEL","models":rows}
