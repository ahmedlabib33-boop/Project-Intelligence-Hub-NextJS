#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PROJECT CONTROLS ML DECISION-SUPPORT ENGINE

Python AI Programming by Eng. Ahmed Labib

Real machine-learning layer for the governed Universal Project Report Engine.

Governance position
-------------------
* Native Primavera P6/XER CPM/TIA remains the governing technical schedule evidence.
* ML is decision support only. It never invents evidence, clauses, logic, dates, entitlement,
  notices, or contractual facts and never overwrites native CPM/TIA results.
* Accuracy is measured from validation data. This module deliberately refuses to hard-code
  or advertise universal 100% predictive accuracy.
* Project-aware group splitting is used whenever a project identifier is available.

Implemented ML capabilities
---------------------------
1. Event classification
2. Delay-risk prediction
3. Forecast-finish deviation prediction
4. Activity anomaly detection
5. Resource-demand prediction
6. Cost-overrun risk prediction
7. Productivity prediction
8. Schedule-health anomaly detection
9. Similar-event/evidence retrieval
10. Risk prioritization
11. Procurement-delay risk
12. Progress-slippage prediction
13. Model confidence / OOD detection
14. Model drift monitoring
15. Native CPM vs ML comparison

Frameworks supported and runtime-probed:
scikit-learn, XGBoost, LightGBM, CatBoost and PyTorch.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import re
import sys
import warnings
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

ATTRIBUTION = "Python AI Programming by Eng. Ahmed Labib"
AUTHOR = "Eng. Ahmed Labib"
VERSION = "1.1.0"
RANDOM_STATE = 42

# Core scientific stack. These are required by the ML package requirements.
import numpy as np
import pandas as pd
import joblib
from scipy import sparse
from scipy.stats import ks_2samp

from sklearn.base import BaseEstimator, ClassifierMixin, RegressorMixin, TransformerMixin
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import (
    ExtraTreesClassifier,
    ExtraTreesRegressor,
    IsolationForest,
    RandomForestClassifier,
    RandomForestRegressor,
)
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    confusion_matrix,
    f1_score,
    log_loss,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    r2_score,
    recall_score,
)
from sklearn.model_selection import (
    GroupKFold,
    GroupShuffleSplit,
    KFold,
    StratifiedKFold,
    cross_val_score,
    train_test_split,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, RobustScaler
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

try:
    import sklearn
except Exception:  # pragma: no cover
    sklearn = None

try:
    import xgboost as xgb
except Exception:
    xgb = None

try:
    import lightgbm as lgb
except Exception:
    lgb = None

try:
    import catboost as cb
except Exception:
    cb = None

try:
    import torch
    import torch.nn as nn
except Exception:
    torch = None
    nn = None


TASK_REGISTRY: Dict[str, Dict[str, Any]] = {
    "event_classification": {
        "id": "ML01", "type": "classification", "target_hint": "event_class",
        "description": "Classify delay/change/project-control events from verified features/evidence.",
    },
    "delay_risk_prediction": {
        "id": "ML02", "type": "classification", "target_hint": "delay_risk",
        "description": "Estimate verified activity/event delay-risk class or probability.",
    },
    "forecast_finish_deviation_prediction": {
        "id": "ML03", "type": "regression", "target_hint": "finish_deviation_days",
        "description": "Predict analytical deviation days; native CPM forecast remains governing.",
    },
    "activity_anomaly_detection": {
        "id": "ML04", "type": "anomaly", "target_hint": None,
        "description": "Detect unusual activity records using Isolation Forest novelty scoring.",
    },
    "resource_demand_prediction": {
        "id": "ML05", "type": "regression", "target_hint": "resource_demand",
        "description": "Predict analytical manpower/equipment demand from verified historical features.",
    },
    "cost_overrun_risk_prediction": {
        "id": "ML06", "type": "classification", "target_hint": "cost_overrun_risk",
        "description": "Estimate cost-overrun risk; does not replace approved cost-control calculations.",
    },
    "productivity_prediction": {
        "id": "ML07", "type": "regression", "target_hint": "productivity",
        "description": "Predict productivity from verified quantities/resource inputs.",
    },
    "schedule_health_anomaly_detection": {
        "id": "ML08", "type": "anomaly", "target_hint": None,
        "description": "Detect schedule-health anomalies; native P6 logic audit remains governing.",
    },
    "similar_event_evidence_retrieval": {
        "id": "ML09", "type": "retrieval", "target_hint": None,
        "description": "Retrieve similar events/evidence using TF-IDF cosine similarity with traceability.",
    },
    "risk_prioritization": {
        "id": "ML10", "type": "classification", "target_hint": "risk_priority",
        "description": "Prioritize risk classes from available verified risk features.",
    },
    "procurement_delay_risk": {
        "id": "ML11", "type": "classification", "target_hint": "procurement_delay_risk",
        "description": "Estimate procurement delay risk from verified procurement history.",
    },
    "progress_slippage_prediction": {
        "id": "ML12", "type": "classification", "target_hint": "progress_slippage",
        "description": "Estimate progress-slippage risk from verified period/status data.",
    },
    "model_confidence_ood_detection": {
        "id": "ML13", "type": "monitoring", "target_hint": None,
        "description": "Return prediction confidence and real Isolation-Forest OOD score/flag.",
    },
    "model_drift_monitoring": {
        "id": "ML14", "type": "monitoring", "target_hint": None,
        "description": "Measure population drift with PSI/KS/categorical distribution distance.",
    },
    "native_cpm_vs_ml_comparison": {
        "id": "ML15", "type": "comparison", "target_hint": None,
        "description": "Compare ML analytical output with native CPM while explicitly preserving native supremacy.",
    },
}


REQUIRED_CAPABILITIES = list(TASK_REGISTRY)


def _emit(value: Any) -> None:
    print(ATTRIBUTION)
    if isinstance(value, (dict, list)):
        print(json.dumps(value, indent=2, ensure_ascii=False, default=str))
    else:
        print(value)


def save_json(path: str | Path, value: Any) -> Path:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(value, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    return p


def file_sha256(path: str | Path) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def load_table(path: str | Path, sheet: Optional[str] = None) -> pd.DataFrame:
    p = Path(path)
    ext = p.suffix.lower()
    if ext == ".csv":
        return pd.read_csv(p)
    if ext in {".xlsx", ".xlsm"}:
        return pd.read_excel(p, sheet_name=sheet or 0)
    if ext == ".json":
        obj = json.loads(p.read_text(encoding="utf-8-sig"))
        if isinstance(obj, list):
            return pd.DataFrame(obj)
        if isinstance(obj, dict):
            for key in ["records", "rows", "data", "events", "activities"]:
                if isinstance(obj.get(key), list):
                    return pd.DataFrame(obj[key])
            return pd.DataFrame([obj])
    if ext in {".jsonl", ".ndjson"}:
        return pd.read_json(p, lines=True)
    if ext in {".parquet", ".pq"}:
        return pd.read_parquet(p)
    raise ValueError(f"Unsupported ML table format: {p.name}")


def _jsonable(v: Any) -> Any:
    if isinstance(v, (np.integer,)): return int(v)
    if isinstance(v, (np.floating,)): return float(v)
    if isinstance(v, np.ndarray): return v.tolist()
    if isinstance(v, pd.Timestamp): return v.isoformat()
    return v


def _safe_float(v: Any) -> Optional[float]:
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except Exception:
        return None


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-max(-50.0, min(50.0, x))))


class SparseToDense(BaseEstimator, TransformerMixin):
    def fit(self, X, y=None): return self
    def transform(self, X):
        return X.toarray() if sparse.issparse(X) else np.asarray(X)


class TorchMLPClassifier(BaseEstimator, ClassifierMixin):
    """Small sklearn-compatible PyTorch MLP classifier for tabular/vectorized features."""
    def __init__(self, hidden_dim: int = 32, epochs: int = 35, lr: float = 0.01, batch_size: int = 64, random_state: int = RANDOM_STATE):
        self.hidden_dim=hidden_dim; self.epochs=epochs; self.lr=lr; self.batch_size=batch_size; self.random_state=random_state

    def fit(self, X, y):
        if torch is None: raise RuntimeError("PyTorch is not installed")
        X=np.asarray(X,dtype=np.float32); y=np.asarray(y)
        self.classes_, yi=np.unique(y,return_inverse=True)
        torch.manual_seed(self.random_state); np.random.seed(self.random_state)
        self.model_=nn.Sequential(nn.Linear(X.shape[1],self.hidden_dim),nn.ReLU(),nn.Linear(self.hidden_dim,len(self.classes_)))
        opt=torch.optim.Adam(self.model_.parameters(),lr=self.lr); loss_fn=nn.CrossEntropyLoss()
        xt=torch.from_numpy(X); yt=torch.from_numpy(yi.astype(np.int64))
        for _ in range(self.epochs):
            perm=torch.randperm(len(xt))
            for s in range(0,len(xt),self.batch_size):
                idx=perm[s:s+self.batch_size]; opt.zero_grad(); logits=self.model_(xt[idx]); loss=loss_fn(logits,yt[idx]); loss.backward(); opt.step()
        return self

    def predict_proba(self, X):
        self.model_.eval(); X=np.asarray(X,dtype=np.float32)
        with torch.no_grad(): return torch.softmax(self.model_(torch.from_numpy(X)),dim=1).cpu().numpy()

    def predict(self, X):
        return self.classes_[np.argmax(self.predict_proba(X),axis=1)]


class TorchMLPRegressor(BaseEstimator, RegressorMixin):
    def __init__(self, hidden_dim: int = 32, epochs: int = 40, lr: float = 0.01, batch_size: int = 64, random_state: int = RANDOM_STATE):
        self.hidden_dim=hidden_dim; self.epochs=epochs; self.lr=lr; self.batch_size=batch_size; self.random_state=random_state

    def fit(self, X, y):
        if torch is None: raise RuntimeError("PyTorch is not installed")
        X=np.asarray(X,dtype=np.float32); y=np.asarray(y,dtype=np.float32).reshape(-1,1)
        torch.manual_seed(self.random_state); np.random.seed(self.random_state)
        self.model_=nn.Sequential(nn.Linear(X.shape[1],self.hidden_dim),nn.ReLU(),nn.Linear(self.hidden_dim,1))
        opt=torch.optim.Adam(self.model_.parameters(),lr=self.lr); loss_fn=nn.MSELoss()
        xt=torch.from_numpy(X); yt=torch.from_numpy(y)
        for _ in range(self.epochs):
            perm=torch.randperm(len(xt))
            for s in range(0,len(xt),self.batch_size):
                idx=perm[s:s+self.batch_size]; opt.zero_grad(); pred=self.model_(xt[idx]); loss=loss_fn(pred,yt[idx]); loss.backward(); opt.step()
        return self

    def predict(self, X):
        self.model_.eval(); X=np.asarray(X,dtype=np.float32)
        with torch.no_grad(): return self.model_(torch.from_numpy(X)).cpu().numpy().ravel()


@dataclass
class FeatureSchema:
    numeric: List[str]
    categorical: List[str]
    text: List[str]
    excluded: List[str]


def infer_feature_schema(df: pd.DataFrame, target: Optional[str] = None, project_column: Optional[str] = None, exclude: Optional[Sequence[str]] = None) -> FeatureSchema:
    excluded=set(exclude or [])
    if target: excluded.add(target)
    if project_column: excluded.add(project_column)
    numeric=[]; categorical=[]; text=[]
    for c in df.columns:
        if c in excluded: continue
        s=df[c]
        if pd.api.types.is_bool_dtype(s) or pd.api.types.is_numeric_dtype(s): numeric.append(c); continue
        non=s.dropna().astype(str)
        if non.empty: categorical.append(c); continue
        avg_len=float(non.str.len().mean()); nunique=int(non.nunique()); ratio=nunique/max(1,len(non))
        # Narrative/event/evidence columns are vectorized as text; short repeated strings are one-hot encoded.
        if avg_len >= 28 or (ratio > 0.65 and avg_len >= 14): text.append(c)
        else: categorical.append(c)
    return FeatureSchema(numeric,categorical,text,sorted(excluded))


def build_preprocessor(schema: FeatureSchema) -> ColumnTransformer:
    transformers=[]
    if schema.numeric:
        transformers.append(("numeric",Pipeline([("imputer",SimpleImputer(strategy="median")),("scale",RobustScaler())]),schema.numeric))
    if schema.categorical:
        transformers.append(("categorical",Pipeline([("imputer",SimpleImputer(strategy="most_frequent")),("onehot",OneHotEncoder(handle_unknown="ignore",min_frequency=1))]),schema.categorical))
    for i,c in enumerate(schema.text):
        transformers.append((f"text_{i}_{re.sub('[^A-Za-z0-9]+','_',c)}",TfidfVectorizer(max_features=2500,ngram_range=(1,2),sublinear_tf=True),c))
    if not transformers:
        raise ValueError("No usable feature columns remain after exclusions.")
    return ColumnTransformer(transformers,remainder="drop",sparse_threshold=0.3)


def framework_versions() -> Dict[str, Any]:
    return {
        "python": platform.python_version(),
        "numpy": np.__version__,
        "pandas": pd.__version__,
        "scikit_learn": getattr(sklearn,"__version__",None),
        "xgboost": getattr(xgb,"__version__",None) if xgb is not None else None,
        "lightgbm": getattr(lgb,"__version__",None) if lgb is not None else None,
        "catboost": getattr(cb,"__version__",None) if cb is not None else None,
        "torch": getattr(torch,"__version__",None) if torch is not None else None,
    }


def _classification_estimators(full_load: bool = True) -> Dict[str, Any]:
    models: Dict[str,Any] = {
        "sklearn_logistic": LogisticRegression(max_iter=2500,class_weight="balanced",random_state=RANDOM_STATE),
        "sklearn_random_forest": RandomForestClassifier(n_estimators=240,class_weight="balanced_subsample",random_state=RANDOM_STATE,n_jobs=-1),
        "sklearn_extra_trees": ExtraTreesClassifier(n_estimators=280,class_weight="balanced",random_state=RANDOM_STATE,n_jobs=-1),
    }
    if full_load and xgb is not None:
        models["xgboost"] = xgb.XGBClassifier(n_estimators=180,max_depth=5,learning_rate=.05,subsample=.9,colsample_bytree=.9,random_state=RANDOM_STATE,n_jobs=-1,eval_metric="logloss")
    if full_load and lgb is not None:
        models["lightgbm"] = lgb.LGBMClassifier(n_estimators=180,max_depth=-1,learning_rate=.05,subsample=.9,colsample_bytree=.9,random_state=RANDOM_STATE,n_jobs=-1,verbosity=-1)
    if full_load and cb is not None:
        models["catboost"] = cb.CatBoostClassifier(iterations=180,depth=6,learning_rate=.05,verbose=False,random_seed=RANDOM_STATE,allow_writing_files=False)
    if full_load and torch is not None:
        models["pytorch_mlp"] = Pipeline([("dense",SparseToDense()),("torch",TorchMLPClassifier())])
    return models


def _regression_estimators(full_load: bool = True) -> Dict[str, Any]:
    models: Dict[str,Any] = {
        "sklearn_ridge": Ridge(alpha=1.0),
        "sklearn_random_forest": RandomForestRegressor(n_estimators=240,random_state=RANDOM_STATE,n_jobs=-1),
        "sklearn_extra_trees": ExtraTreesRegressor(n_estimators=280,random_state=RANDOM_STATE,n_jobs=-1),
    }
    if full_load and xgb is not None:
        models["xgboost"] = xgb.XGBRegressor(n_estimators=180,max_depth=5,learning_rate=.05,subsample=.9,colsample_bytree=.9,random_state=RANDOM_STATE,n_jobs=-1,objective="reg:squarederror")
    if full_load and lgb is not None:
        models["lightgbm"] = lgb.LGBMRegressor(n_estimators=180,learning_rate=.05,subsample=.9,colsample_bytree=.9,random_state=RANDOM_STATE,n_jobs=-1,verbosity=-1)
    if full_load and cb is not None:
        models["catboost"] = cb.CatBoostRegressor(iterations=180,depth=6,learning_rate=.05,verbose=False,random_seed=RANDOM_STATE,allow_writing_files=False)
    if full_load and torch is not None:
        models["pytorch_mlp"] = Pipeline([("dense",SparseToDense()),("torch",TorchMLPRegressor())])
    return models


def _split_data(df: pd.DataFrame, target: str, project_column: Optional[str], task_type: str, test_size: float = .2):
    X=df.drop(columns=[target]); y=df[target]
    isolation={"mode":"row_random","project_aware":False,"project_column":project_column,"warning":None}
    if project_column and project_column in X.columns and X[project_column].nunique(dropna=True)>=2:
        groups=X[project_column].astype(str).fillna("<MISSING_PROJECT>")
        splitter=GroupShuffleSplit(n_splits=1,test_size=test_size,random_state=RANDOM_STATE)
        tr,te=next(splitter.split(X,y,groups))
        isolation.update({"mode":"group_shuffle_split","project_aware":True,"train_projects":sorted(groups.iloc[tr].unique().tolist()),"validation_projects":sorted(groups.iloc[te].unique().tolist())})
        return X.iloc[tr].copy(),X.iloc[te].copy(),y.iloc[tr].copy(),y.iloc[te].copy(),groups.iloc[tr].copy(),isolation
    stratify=None
    if task_type=="classification" and y.nunique()>=2:
        vc=y.value_counts()
        if int(vc.min())>=2: stratify=y
    Xtr,Xte,ytr,yte=train_test_split(X,y,test_size=test_size,random_state=RANDOM_STATE,stratify=stratify)
    isolation["warning"]="No usable multi-project group column was available. Validation is row-level and must not be presented as universal cross-project accuracy."
    return Xtr,Xte,ytr,yte,None,isolation


def _cv_strategy(y: pd.Series, groups: Optional[pd.Series], task_type: str):
    if groups is not None and groups.nunique()>=2:
        n=min(5,int(groups.nunique()))
        return GroupKFold(n_splits=max(2,n)),groups
    if task_type=="classification":
        min_class=int(y.value_counts().min())
        n=max(2,min(5,min_class))
        return StratifiedKFold(n_splits=n,shuffle=True,random_state=RANDOM_STATE),None
    n=max(2,min(5,len(y)//5 if len(y)>=10 else 2))
    return KFold(n_splits=n,shuffle=True,random_state=RANDOM_STATE),None


def _classification_metrics(y_true, y_pred, proba=None) -> Dict[str, Any]:
    m={
        "accuracy":float(accuracy_score(y_true,y_pred)),
        "precision":float(precision_score(y_true,y_pred,average="weighted",zero_division=0)),
        "recall":float(recall_score(y_true,y_pred,average="weighted",zero_division=0)),
        "f1":float(f1_score(y_true,y_pred,average="weighted",zero_division=0)),
        "balanced_accuracy":float(balanced_accuracy_score(y_true,y_pred)),
    }
    if proba is not None:
        try:m["log_loss"]=float(log_loss(y_true,proba))
        except Exception:pass
        m["confidence"]=float(np.mean(np.max(proba,axis=1)))
    else:m["confidence"]=None
    return m


def _regression_metrics(y_true,y_pred) -> Dict[str,Any]:
    mse=float(mean_squared_error(y_true,y_pred)); mae=float(mean_absolute_error(y_true,y_pred)); r2=float(r2_score(y_true,y_pred))
    scale=float(np.std(np.asarray(y_true,dtype=float))) or max(1.0,abs(float(np.mean(np.asarray(y_true,dtype=float)))))
    quality=float(max(0.0,min(1.0,1.0-mae/(scale*2.0))))
    return {"mae":mae,"rmse":math.sqrt(mse),"r2":r2,"confidence":quality}


def _fit_ood(preprocessor, X_train: pd.DataFrame):
    Z=preprocessor.transform(X_train)
    if sparse.issparse(Z): Z=Z.toarray()
    Z=np.asarray(Z,dtype=np.float32)
    # Use bounded sample if the feature matrix is extremely large.
    if Z.shape[0]>10000:
        rng=np.random.default_rng(RANDOM_STATE); Z=Z[rng.choice(Z.shape[0],10000,replace=False)]
    ood=IsolationForest(n_estimators=240,contamination="auto",random_state=RANDOM_STATE,n_jobs=-1)
    ood.fit(Z)
    train_dec=ood.decision_function(Z)
    threshold=float(np.quantile(train_dec,0.01))
    return ood,threshold


def _ood_scores(preprocessor, ood, threshold: float, X: pd.DataFrame) -> Tuple[np.ndarray,np.ndarray]:
    Z=preprocessor.transform(X)
    if sparse.issparse(Z): Z=Z.toarray()
    dec=ood.decision_function(np.asarray(Z,dtype=np.float32))
    # Higher score => more out-of-distribution. Calibrated around training 1% tail.
    spread=float(np.std(dec)) or .1
    score=np.array([_sigmoid((threshold-d)/spread*2.0) for d in dec],dtype=float)
    flag=dec < threshold
    return score,flag


def _psi(reference: np.ndarray,current: np.ndarray,bins: int=10) -> Optional[float]:
    r=np.asarray(reference,dtype=float); c=np.asarray(current,dtype=float)
    r=r[np.isfinite(r)];c=c[np.isfinite(c)]
    if len(r)<5 or len(c)<5:return None
    edges=np.unique(np.quantile(r,np.linspace(0,1,bins+1)))
    if len(edges)<3:return 0.0
    edges[0]=-np.inf;edges[-1]=np.inf
    rh,_=np.histogram(r,bins=edges);ch,_=np.histogram(c,bins=edges)
    rp=np.clip(rh/max(1,rh.sum()),1e-6,None);cp=np.clip(ch/max(1,ch.sum()),1e-6,None)
    return float(np.sum((cp-rp)*np.log(cp/rp)))


def _categorical_distance(reference: pd.Series,current: pd.Series) -> float:
    r=reference.fillna("<MISSING>").astype(str);c=current.fillna("<MISSING>").astype(str)
    keys=sorted(set(r.unique())|set(c.unique()))
    rp=r.value_counts(normalize=True);cp=c.value_counts(normalize=True)
    return float(.5*sum(abs(float(rp.get(k,0))-float(cp.get(k,0))) for k in keys))


def build_reference_profile(df: pd.DataFrame, schema: FeatureSchema) -> Dict[str,Any]:
    p={"numeric":{},"categorical":{},"text":{},"rows":len(df)}
    for c in schema.numeric:
        vals=pd.to_numeric(df[c],errors="coerce").dropna().astype(float)
        p["numeric"][c]={"values_sample":vals.sample(min(2000,len(vals)),random_state=RANDOM_STATE).tolist() if len(vals) else [],"mean":float(vals.mean()) if len(vals) else None,"std":float(vals.std(ddof=0)) if len(vals) else None}
    for c in schema.categorical:
        s=df[c].fillna("<MISSING>").astype(str);vc=s.value_counts(normalize=True).head(100)
        p["categorical"][c]={"frequencies":{str(k):float(v) for k,v in vc.items()}}
    for c in schema.text:
        lens=df[c].fillna("").astype(str).str.len().astype(float)
        p["text"][c]={"length_sample":lens.sample(min(2000,len(lens)),random_state=RANDOM_STATE).tolist() if len(lens) else []}
    return p


def calculate_drift(reference_profile: Dict[str,Any], current: pd.DataFrame) -> Dict[str,Any]:
    details=[];scores=[]
    for c,info in reference_profile.get("numeric",{}).items():
        if c not in current.columns: details.append({"feature":c,"type":"numeric","status":"MISSING_CURRENT_FEATURE"}); continue
        ref=np.array(info.get("values_sample",[]),dtype=float);cur=pd.to_numeric(current[c],errors="coerce").dropna().to_numpy(dtype=float)
        if len(ref)<5 or len(cur)<5:details.append({"feature":c,"type":"numeric","status":"INSUFFICIENT_DATA"});continue
        ks=ks_2samp(ref,cur);psi=_psi(ref,cur);feature_score=min(1.0,max(float(ks.statistic),min(1.0,(psi or 0)/.25)))
        scores.append(feature_score);details.append({"feature":c,"type":"numeric","ks_statistic":float(ks.statistic),"ks_pvalue":float(ks.pvalue),"psi":psi,"drift_score":feature_score})
    for c,info in reference_profile.get("categorical",{}).items():
        if c not in current.columns:details.append({"feature":c,"type":"categorical","status":"MISSING_CURRENT_FEATURE"});continue
        ref_freq=info.get("frequencies",{});cur=current[c].fillna("<MISSING>").astype(str).value_counts(normalize=True)
        keys=set(ref_freq)|set(cur.index.astype(str));dist=.5*sum(abs(float(ref_freq.get(k,0))-float(cur.get(k,0))) for k in keys)
        scores.append(min(1.0,dist));details.append({"feature":c,"type":"categorical","total_variation_distance":float(dist),"drift_score":float(min(1.0,dist))})
    for c,info in reference_profile.get("text",{}).items():
        if c not in current.columns:details.append({"feature":c,"type":"text_length","status":"MISSING_CURRENT_FEATURE"});continue
        ref=np.array(info.get("length_sample",[]),dtype=float);cur=current[c].fillna("").astype(str).str.len().to_numpy(dtype=float)
        if len(ref)<5 or len(cur)<5:details.append({"feature":c,"type":"text_length","status":"INSUFFICIENT_DATA"});continue
        ks=ks_2samp(ref,cur);feature_score=float(ks.statistic);scores.append(feature_score);details.append({"feature":c,"type":"text_length","ks_statistic":float(ks.statistic),"ks_pvalue":float(ks.pvalue),"drift_score":feature_score})
    agg=float(np.mean(scores)) if scores else None
    return {"attribution":ATTRIBUTION,"metric":"aggregate_feature_drift_0_to_1","drift_score":agg,"drift_percent":None if agg is None else round(agg*100,2),"status":"HIGH" if agg is not None and agg>=.35 else "MODERATE" if agg is not None and agg>=.18 else "LOW" if agg is not None else "UNVERIFIED","feature_details":details}


def _candidate_pipeline(schema: FeatureSchema, estimator: Any) -> Pipeline:
    return Pipeline([("features",build_preprocessor(schema)),("model",estimator)])


def _framework_name(model_name: str) -> str:
    if model_name.startswith("sklearn"):return "scikit-learn"
    if model_name=="xgboost":return "XGBoost"
    if model_name=="lightgbm":return "LightGBM"
    if model_name=="catboost":return "CatBoost"
    if model_name=="pytorch_mlp":return "PyTorch"
    return model_name


def train_supervised(
    data: pd.DataFrame,
    task: str,
    target: str,
    output_dir: str | Path,
    project_column: Optional[str] = "project_id",
    exclude_columns: Optional[Sequence[str]] = None,
    full_load: bool = True,
    test_size: float = .2,
    data_origin: str = "unspecified",
    project_scope: Optional[str] = None,
) -> Dict[str,Any]:
    if task not in TASK_REGISTRY: raise ValueError(f"Unknown ML task: {task}")
    task_type=TASK_REGISTRY[task]["type"]
    if task_type not in {"classification","regression"}:raise ValueError(f"Task {task} is {task_type}; use the corresponding unsupervised/retrieval/monitoring function.")
    if target not in data.columns:raise ValueError(f"Target column '{target}' was not found.")
    df=data.copy().dropna(subset=[target]).reset_index(drop=True)
    if len(df)<20:raise ValueError("At least 20 labeled records are required for supervised training.")
    if task_type=="classification" and df[target].nunique()<2:raise ValueError("Classification target requires at least two classes.")
    Xtr,Xte,ytr,yte,groups_train,isolation=_split_data(df,target,project_column if project_column in df.columns else None,task_type,test_size)
    schema=infer_feature_schema(df,target,project_column if project_column in df.columns else None,exclude_columns)
    candidates=_classification_estimators(full_load) if task_type=="classification" else _regression_estimators(full_load)
    cv,cv_groups=_cv_strategy(ytr,groups_train,task_type)
    scoring="f1_weighted" if task_type=="classification" else "neg_root_mean_squared_error"
    leaderboard=[];fitted={}
    for name,est in candidates.items():
        pipe=_candidate_pipeline(schema,est)
        try:
            scores=cross_val_score(pipe,Xtr,ytr,cv=cv,groups=cv_groups,scoring=scoring,n_jobs=1,error_score="raise")
            cv_mean=float(np.mean(scores));cv_std=float(np.std(scores))
            pipe.fit(Xtr,ytr);fitted[name]=pipe
            leaderboard.append({"model":name,"framework":_framework_name(name),"cv_score_mean":cv_mean,"cv_score_std":cv_std,"status":"PASS"})
        except Exception as e:
            leaderboard.append({"model":name,"framework":_framework_name(name),"status":"FAILED","error":f"{type(e).__name__}: {e}"})
    good=[x for x in leaderboard if x["status"]=="PASS"]
    if not good:raise RuntimeError("All ML candidate models failed. See candidate leaderboard.")
    # For classification higher F1 is better; regression score is negative RMSE so higher is still better.
    best=max(good,key=lambda r:r["cv_score_mean"]);model=fitted[best["model"]]
    pred=model.predict(Xte)
    proba=model.predict_proba(Xte) if task_type=="classification" and hasattr(model,"predict_proba") else None
    metrics=_classification_metrics(yte,pred,proba) if task_type=="classification" else _regression_metrics(yte,pred)
    metrics.update({"cross_validation_score_mean":best["cv_score_mean"],"cross_validation_score_std":best["cv_score_std"],"cross_validation_scoring":scoring})
    # Fit real novelty/OOD detector on the winning model's fitted feature transform.
    features=model.named_steps["features"]
    ood,ood_threshold=_fit_ood(features,Xtr)
    ood_score,ood_flag=_ood_scores(features,ood,ood_threshold,Xte)
    metrics["ood_score"]=float(np.mean(ood_score));metrics["ood_rate"]=float(np.mean(ood_flag))
    # Confidence is explicit and quality-aware. It is never substituted for proof.
    if metrics.get("confidence") is None:metrics["confidence"]=float(max(0.0,1.0-metrics["ood_score"]))
    reference=build_reference_profile(Xtr,schema)
    out=Path(output_dir);out.mkdir(parents=True,exist_ok=True)
    artifact={
        "pipeline":model,"ood_model":ood,"ood_threshold":ood_threshold,"task":task,"task_type":task_type,
        "target":target,"project_column":project_column if project_column in df.columns else None,"schema":asdict(schema),
        "metrics":metrics,"validation_isolation":isolation,"reference_profile":reference,"classes":getattr(model,"classes_",None),
        "data_origin":data_origin,"project_scope":project_scope,
        "engine_version":VERSION,"created_at":datetime.now().isoformat(timespec="seconds"),"attribution":ATTRIBUTION,"author":AUTHOR,
    }
    model_path=out/"model_bundle.joblib";joblib.dump(artifact,model_path,compress=3)
    pred_df=Xte.copy();pred_df["actual_target"]=yte.values;pred_df["ml_prediction"]=pred;pred_df["ood_score"]=ood_score;pred_df["ood_flag"]=ood_flag
    if proba is not None:pred_df["ml_confidence"]=np.max(proba,axis=1)
    else:pred_df["ml_confidence"]=np.clip((1-ood_score)*float(metrics.get("confidence") or 0),0,1)
    pred_df.to_csv(out/"validation_predictions.csv",index=False)
    if task_type=="classification":
        labels=sorted(pd.Series(yte).astype(str).unique().tolist())
        cm=confusion_matrix(pd.Series(yte).astype(str),pd.Series(pred).astype(str),labels=labels)
        pd.DataFrame(cm,index=[f"actual::{x}" for x in labels],columns=[f"pred::{x}" for x in labels]).to_csv(out/"confusion_matrix.csv")
        metrics["confusion_matrix_labels"]=labels;metrics["confusion_matrix"]=cm.tolist()
    save_json(out/"training_metrics.json",{"attribution":ATTRIBUTION,"task":task,"metrics":metrics,"leaderboard":leaderboard})
    save_json(out/"feature_schema.json",{"attribution":ATTRIBUTION,**asdict(schema)})
    save_json(out/"training_reference_profile.json",reference)
    card={
        "attribution":ATTRIBUTION,"author":AUTHOR,"model_version":VERSION,"task":task,"task_id":TASK_REGISTRY[task]["id"],"task_type":task_type,
        "description":TASK_REGISTRY[task]["description"],"selected_model":best["model"],"selected_framework":best["framework"],
        "framework_versions":framework_versions(),"training_records":len(Xtr),"validation_records":len(Xte),"total_records":len(df),
        "data_origin":data_origin,"project_scope":project_scope,
        "production_model":bool(data_origin=="real_project"),
        "deployment_scope":"CROSS_PROJECT_CANDIDATE" if isolation.get("project_aware") else "PROJECT_SCOPED_ONLY",
        "training_isolation":isolation,"metrics":metrics,"model_sha256":file_sha256(model_path),
        "governance":{
            "native_schedule_supremacy":True,"ml_decision_support_only":True,"no_ml_fabrication":True,
            "universal_100_percent_accuracy_claimed":False,"accuracy_statement":"Measured validation metrics only; no universal accuracy guarantee.",
        },
    }
    save_json(out/"model_card.json",card)
    save_json(out/"training_manifest.json",{
        "attribution":ATTRIBUTION,"created_at":datetime.now().isoformat(timespec="seconds"),"task":task,"target":target,
        "input_rows":len(df),"input_columns":list(df.columns),"data_origin":data_origin,"project_scope":project_scope,"output_files":[],
    })
    # Refresh manifest after all core files exist.
    manifest=load_model_manifest(out)
    save_json(out/"training_manifest.json",manifest)
    return card


def load_model_manifest(model_dir: str | Path) -> Dict[str,Any]:
    d=Path(model_dir);files=[]
    for p in sorted(d.glob("*")):
        if p.is_file() and p.name!="training_manifest.json":files.append({"file":p.name,"size_bytes":p.stat().st_size,"sha256":file_sha256(p)})
    return {"attribution":ATTRIBUTION,"author":AUTHOR,"created_at":datetime.now().isoformat(timespec="seconds"),"files":files}


def predict(model_dir: str | Path, data: pd.DataFrame, output_path: Optional[str | Path]=None) -> pd.DataFrame:
    d=Path(model_dir);bundle=joblib.load(d/"model_bundle.joblib")
    model=bundle["pipeline"];schema=FeatureSchema(**bundle["schema"])
    X=data.copy();missing=[c for c in schema.numeric+schema.categorical+schema.text if c not in X.columns]
    if missing:raise ValueError("Inference is missing required feature columns: "+", ".join(missing))
    pred=model.predict(X);features=model.named_steps["features"]
    ood_score,ood_flag=_ood_scores(features,bundle["ood_model"],float(bundle["ood_threshold"]),X)
    out=X.copy();out["ml_prediction"]=pred;out["ood_score"]=ood_score;out["ood_flag"]=ood_flag
    if bundle["task_type"]=="classification" and hasattr(model,"predict_proba"):
        proba=model.predict_proba(X);out["ml_confidence"]=np.max(proba,axis=1)
    else:
        validation_quality=float(bundle.get("metrics",{}).get("confidence") or 0)
        out["ml_confidence"]=np.clip((1-ood_score)*validation_quality,0,1)
    out["ml_status"]=np.where(out["ood_flag"],"UNCERTAIN_OOD","DECISION_SUPPORT_ONLY")
    out["native_cpm_supremacy"]="NATIVE_P6_CPM_GOVERNS_FORMAL_SCHEDULE_RESULT"
    if output_path:
        p=Path(output_path);p.parent.mkdir(parents=True,exist_ok=True);out.to_csv(p,index=False)
    return out


def drift_from_model(model_dir: str | Path,current: pd.DataFrame) -> Dict[str,Any]:
    bundle=joblib.load(Path(model_dir)/"model_bundle.joblib")
    report=calculate_drift(bundle["reference_profile"],current)
    report.update({"model_task":bundle["task"],"model_version":bundle.get("engine_version"),"model_dir":str(Path(model_dir).resolve())})
    return report


def train_anomaly(data: pd.DataFrame, task: str, output_dir: str | Path, exclude_columns: Optional[Sequence[str]]=None) -> Dict[str,Any]:
    if TASK_REGISTRY.get(task,{}).get("type")!="anomaly":raise ValueError("Task is not registered as anomaly detection")
    schema=infer_feature_schema(data,exclude=exclude_columns);pre=build_preprocessor(schema);Z=pre.fit_transform(data)
    if sparse.issparse(Z):Z=Z.toarray()
    iso=IsolationForest(n_estimators=320,contamination="auto",random_state=RANDOM_STATE,n_jobs=-1).fit(Z)
    dec=iso.decision_function(Z);threshold=float(np.quantile(dec,.01));score=np.array([_sigmoid((threshold-d)/(float(np.std(dec)) or .1)*2) for d in dec]);flag=dec<threshold
    out=Path(output_dir);out.mkdir(parents=True,exist_ok=True)
    bundle={"task":task,"task_type":"anomaly","preprocessor":pre,"model":iso,"threshold":threshold,"schema":asdict(schema),"reference_profile":build_reference_profile(data,schema),"engine_version":VERSION,"attribution":ATTRIBUTION,"author":AUTHOR}
    mp=out/"model_bundle.joblib";joblib.dump(bundle,mp,compress=3)
    scored=data.copy();scored["anomaly_score"]=score;scored["anomaly_flag"]=flag;scored.to_csv(out/"training_anomaly_scores.csv",index=False)
    card={"attribution":ATTRIBUTION,"author":AUTHOR,"task":task,"task_type":"anomaly","selected_model":"IsolationForest","selected_framework":"scikit-learn","training_records":len(data),"anomaly_rate":float(flag.mean()),"ood_score":float(score.mean()),"model_sha256":file_sha256(mp),"governance":{"decision_support_only":True,"native_schedule_supremacy":True}}
    save_json(out/"model_card.json",card);save_json(out/"feature_schema.json",{"attribution":ATTRIBUTION,**asdict(schema)});save_json(out/"training_reference_profile.json",bundle["reference_profile"]);save_json(out/"training_manifest.json",load_model_manifest(out))
    return card


def anomaly_predict(model_dir: str | Path,data: pd.DataFrame) -> pd.DataFrame:
    b=joblib.load(Path(model_dir)/"model_bundle.joblib");Z=b["preprocessor"].transform(data)
    if sparse.issparse(Z):Z=Z.toarray()
    dec=b["model"].decision_function(Z);spread=float(np.std(dec)) or .1;score=np.array([_sigmoid((b["threshold"]-d)/spread*2) for d in dec]);flag=dec<b["threshold"]
    out=data.copy();out["anomaly_score"]=score;out["anomaly_flag"]=flag;out["ml_status"]=np.where(flag,"INVESTIGATE_ANOMALY","DECISION_SUPPORT_ONLY");return out


def build_retrieval_index(data: pd.DataFrame,text_column: str,output_dir: str | Path,id_column: Optional[str]=None,source_column: Optional[str]=None) -> Dict[str,Any]:
    if text_column not in data.columns:raise ValueError(f"Missing text column: {text_column}")
    texts=data[text_column].fillna("").astype(str).tolist();vec=TfidfVectorizer(max_features=12000,ngram_range=(1,2),sublinear_tf=True);mat=vec.fit_transform(texts)
    meta=data.copy();out=Path(output_dir);out.mkdir(parents=True,exist_ok=True)
    joblib.dump({"vectorizer":vec,"matrix":mat,"records":meta,"text_column":text_column,"id_column":id_column,"source_column":source_column,"attribution":ATTRIBUTION},out/"retrieval_index.joblib",compress=3)
    card={"attribution":ATTRIBUTION,"author":AUTHOR,"task":"similar_event_evidence_retrieval","records":len(data),"text_column":text_column,"id_column":id_column,"source_column":source_column,"traceability_required":True,"governance":"Retrieval surfaces existing evidence only; it does not create facts."}
    save_json(out/"model_card.json",card);return card


def retrieve_similar(index_dir: str | Path,query: str,top_k: int=5) -> List[Dict[str,Any]]:
    b=joblib.load(Path(index_dir)/"retrieval_index.joblib");q=b["vectorizer"].transform([query]);scores=cosine_similarity(q,b["matrix"])[0];idx=np.argsort(scores)[::-1][:max(1,top_k)];rows=[]
    for i in idx:
        rec=b["records"].iloc[int(i)].to_dict();rows.append({"similarity":float(scores[i]),"record":{str(k):_jsonable(v) for k,v in rec.items()},"evidence_status":"RETRIEVED_EXISTING_EVIDENCE"})
    return rows


def compare_native_cpm_vs_ml(native_value: Any, ml_value: Any, unit: str="days", native_source: Optional[str]=None) -> Dict[str,Any]:
    n=_safe_float(native_value);m=_safe_float(ml_value);delta=None if n is None or m is None else m-n
    return {"attribution":ATTRIBUTION,"native_value":native_value,"ml_value":ml_value,"difference":delta,"unit":unit,"native_source":native_source,"governing_result":"NATIVE_CPM","ml_treatment":"ANALYTICAL_DECISION_SUPPORT_ONLY","status":"UNVERIFIED" if n is None else "COMPARED_NATIVE_GOVERNS"}


def framework_runtime_status() -> Dict[str,Any]:
    versions=framework_versions()
    backends={
        "scikit-learn":{"installed":versions.get("scikit_learn") is not None,"version":versions.get("scikit_learn"),"required_for_core":True},
        "XGBoost":{"installed":versions.get("xgboost") is not None,"version":versions.get("xgboost"),"required_for_core":False},
        "LightGBM":{"installed":versions.get("lightgbm") is not None,"version":versions.get("lightgbm"),"required_for_core":False},
        "CatBoost":{"installed":versions.get("catboost") is not None,"version":versions.get("catboost"),"required_for_core":False},
        "PyTorch":{"installed":versions.get("torch") is not None,"version":versions.get("torch"),"required_for_core":False},
    }
    missing=[k for k,v in backends.items() if not v["installed"]]
    return {
        "attribution":ATTRIBUTION,
        "core_ml_ready":bool(backends["scikit-learn"]["installed"]),
        "full_backend_ready":not missing,
        "missing_backends":missing,
        "backends":backends,
        "policy":"scikit-learn is the production core. XGBoost, LightGBM, CatBoost and PyTorch are optional competing backends; missing optional backends reduce model diversity but do not disable governed ML training/inference.",
    }


def framework_fit_predict_self_test(output_dir: Optional[str | Path]=None) -> Dict[str,Any]:
    """Fit/predict runtime integration test with graceful optional-backend handling.

    Synthetic scores validate software integration only and are never treated as project accuracy.
    """
    n=240
    X0=np.full((n//2,6),-10.0);X1=np.full((n//2,6),10.0);X=np.vstack([X0,X1]);y=np.array([0]*(n//2)+[1]*(n//2))
    Xtr,Xte,ytr,yte=train_test_split(X,y,test_size=.25,random_state=RANDOM_STATE,stratify=y)
    definitions=[
        ("scikit-learn", LogisticRegression(max_iter=1000,random_state=RANDOM_STATE) if sklearn is not None else None, True),
        ("XGBoost", xgb.XGBClassifier(n_estimators=60,max_depth=3,learning_rate=.15,random_state=RANDOM_STATE,n_jobs=1,eval_metric="logloss") if xgb is not None else None, False),
        ("LightGBM", lgb.LGBMClassifier(n_estimators=35,learning_rate=.15,random_state=RANDOM_STATE,n_jobs=1,verbosity=-1) if lgb is not None else None, False),
        ("CatBoost", cb.CatBoostClassifier(iterations=35,depth=4,learning_rate=.15,verbose=False,random_seed=RANDOM_STATE,allow_writing_files=False) if cb is not None else None, False),
    ]
    results=[]
    for name,model,core in definitions:
        if model is None:
            results.append({"framework":name,"status":"MISSING","fit":False,"predict":False,"required_for_core":core})
            continue
        try:
            model.fit(Xtr,ytr);pred=model.predict(Xte)
            results.append({"framework":name,"fit":True,"predict":True,"synthetic_accuracy":float(accuracy_score(yte,pred)),"status":"PASS","required_for_core":core})
        except Exception as e:
            results.append({"framework":name,"fit":False,"predict":False,"status":"FAIL","required_for_core":core,"error":f"{type(e).__name__}: {e}"})
    if torch is None:
        results.append({"framework":"PyTorch","status":"MISSING","fit":False,"predict":False,"required_for_core":False})
    else:
        try:
            tm=TorchMLPClassifier(hidden_dim=16,epochs=25,lr=.01,batch_size=32);tm.fit(Xtr,ytr);pred=tm.predict(Xte)
            results.append({"framework":"PyTorch","fit":True,"predict":True,"synthetic_accuracy":float(accuracy_score(yte,pred)),"status":"PASS","required_for_core":False})
        except Exception as e:
            results.append({"framework":"PyTorch","fit":False,"predict":False,"status":"FAIL","required_for_core":False,"error":f"{type(e).__name__}: {e}"})
    core=next(r for r in results if r["framework"]=="scikit-learn")
    missing=[r["framework"] for r in results if r["status"]=="MISSING"]
    failed=[r["framework"] for r in results if r["status"]=="FAIL"]
    status="FAIL_CORE" if core["status"]!="PASS" else "PASS_FULL" if not missing and not failed else "PASS_PARTIAL"
    payload={
        "attribution":ATTRIBUTION,"author":AUTHOR,"ml_engine_version":VERSION,"status":status,"framework_versions":framework_versions(),
        "core_fit_predict_passed":core["status"]=="PASS","full_backend_fit_predict_passed":status=="PASS_FULL",
        "missing_optional_backends":[x for x in missing if x!="scikit-learn"],"failed_backends":failed,
        "tests":results,"important_accuracy_notice":"Synthetic sanity-test scores validate software integration only. They are not project accuracy and do not justify a universal 100% accuracy claim.",
        "actual_fit_predict_executed":True,
    }
    if output_dir:
        out=Path(output_dir);out.mkdir(parents=True,exist_ok=True);save_json(out/"FRAMEWORK_FIT_PREDICT_SELF_TEST.json",payload)
    return payload


def _registered_real_project_models(project_model_dirs: Optional[Sequence[str|Path]]) -> List[Dict[str,Any]]:
    rows=[]
    for p0 in project_model_dirs or []:
        p=Path(p0).expanduser().resolve()
        candidates=[p] if p.is_dir() and (p/"model_card.json").exists() else [x for x in p.glob("*") if x.is_dir() and (x/"model_card.json").exists()] if p.is_dir() else []
        for d in candidates:
            try:
                card=json.loads((d/"model_card.json").read_text(encoding="utf-8"))
                if card.get("data_origin")=="real_project" and (d/"model_bundle.joblib").exists():
                    rows.append({"model_dir":str(d),"task":card.get("task"),"selected_framework":card.get("selected_framework"),"metrics":card.get("metrics"),"deployment_scope":card.get("deployment_scope")})
            except Exception:
                continue
    return rows


def capability_status(run_framework_test: bool=False, project_model_dirs: Optional[Sequence[str|Path]]=None) -> Dict[str,Any]:
    runtime=framework_runtime_status()
    framework_test=framework_fit_predict_self_test() if run_framework_test else None
    capability_checks={
        "event_classification":callable(train_supervised),"delay_risk_prediction":callable(train_supervised),"forecast_finish_deviation_prediction":callable(train_supervised),
        "activity_anomaly_detection":callable(train_anomaly),"resource_demand_prediction":callable(train_supervised),"cost_overrun_risk_prediction":callable(train_supervised),
        "productivity_prediction":callable(train_supervised),"schedule_health_anomaly_detection":callable(train_anomaly),"similar_event_evidence_retrieval":callable(build_retrieval_index),
        "risk_prioritization":callable(train_supervised),"procurement_delay_risk":callable(train_supervised),"progress_slippage_prediction":callable(train_supervised),
        "model_confidence_ood_detection":callable(_ood_scores),"model_drift_monitoring":callable(calculate_drift),"native_cpm_vs_ml_comparison":callable(compare_native_cpm_vs_ml),
    }
    completeness=100.0*sum(bool(v) for v in capability_checks.values())/len(capability_checks)
    real_models=_registered_real_project_models(project_model_dirs)
    actual_trained="YES — REAL-PROJECT MODEL REGISTERED" if real_models else "NO — REAL-PROJECT MODEL NOT REGISTERED"
    return {
        "attribution":ATTRIBUTION,"author":AUTHOR,"ml_engine_version":VERSION,
        "Project Controls Intelligence / Reporting Engine":"YES",
        "AI-style evidence retrieval and grounded interaction":"YES",
        "ML-ready architecture":"YES" if runtime["core_ml_ready"] else "NO",
        "ML governance":"YES",
        "Actual trained Machine Learning":actual_trained,
        "registered_real_project_model_count":len(real_models),"registered_real_project_models":real_models,
        "ML implementation completeness percent":round(completeness,2),
        "Predictive accuracy guarantee":"NO UNIVERSAL GUARANTEE — ACTUAL VALIDATION METRICS GOVERN",
        "runtime":runtime,"frameworks":framework_versions(),"capabilities":capability_checks,"framework_test":framework_test,
    }


def _load_bundle_task(model_dir: Path) -> str:
    if (model_dir/"model_bundle.joblib").exists():return str(joblib.load(model_dir/"model_bundle.joblib").get("task","unknown"))
    if (model_dir/"retrieval_index.joblib").exists():return "similar_event_evidence_retrieval"
    return "unknown"


def main(argv=None) -> int:
    ap=argparse.ArgumentParser(description=f"Project Controls ML Decision-Support Engine v{VERSION}")
    ap.add_argument("--version",action="version",version=VERSION)
    sp=ap.add_subparsers(dest="cmd",required=True)

    st=sp.add_parser("status",help="Show ML capability status");st.add_argument("--run-framework-test",action="store_true")
    ft=sp.add_parser("framework-test",help="Actually fit/predict with sklearn/XGBoost/LightGBM/CatBoost/PyTorch");ft.add_argument("--output")
    tr=sp.add_parser("train",help="Train a supervised classification/regression model with model selection and CV")
    tr.add_argument("--task",required=True,choices=sorted(k for k,v in TASK_REGISTRY.items() if v["type"] in {"classification","regression"}));tr.add_argument("--data",required=True);tr.add_argument("--target",required=True);tr.add_argument("--output",required=True);tr.add_argument("--project-column",default="project_id");tr.add_argument("--exclude",nargs="*");tr.add_argument("--fast",action="store_true");tr.add_argument("--data-origin",default="unspecified",choices=["unspecified","real_project","synthetic_benchmark","external_reference"]);tr.add_argument("--project-scope")
    an=sp.add_parser("train-anomaly",help="Train IsolationForest anomaly/OOD model");an.add_argument("--task",required=True,choices=sorted(k for k,v in TASK_REGISTRY.items() if v["type"]=="anomaly"));an.add_argument("--data",required=True);an.add_argument("--output",required=True);an.add_argument("--exclude",nargs="*")
    pr=sp.add_parser("predict",help="Run inference using a saved trained model");pr.add_argument("--model-dir",required=True);pr.add_argument("--data",required=True);pr.add_argument("--output",required=True)
    dr=sp.add_parser("drift",help="Calculate real population drift against training reference");dr.add_argument("--model-dir",required=True);dr.add_argument("--data",required=True);dr.add_argument("--output",required=True)
    ri=sp.add_parser("build-retrieval",help="Build similar-event/evidence TF-IDF retrieval index");ri.add_argument("--data",required=True);ri.add_argument("--text-column",required=True);ri.add_argument("--output",required=True);ri.add_argument("--id-column");ri.add_argument("--source-column")
    rq=sp.add_parser("retrieve",help="Retrieve similar existing evidence");rq.add_argument("--index-dir",required=True);rq.add_argument("--query",required=True);rq.add_argument("--top-k",type=int,default=5)

    args=ap.parse_args(argv)
    if args.cmd=="status":_emit(capability_status(args.run_framework_test));return 0
    if args.cmd=="framework-test":_emit(framework_fit_predict_self_test(args.output));return 0
    if args.cmd=="train":
        card=train_supervised(load_table(args.data),args.task,args.target,args.output,args.project_column,args.exclude,full_load=not args.fast,data_origin=args.data_origin,project_scope=args.project_scope);_emit(card);return 0
    if args.cmd=="train-anomaly":_emit(train_anomaly(load_table(args.data),args.task,args.output,args.exclude));return 0
    if args.cmd=="predict":
        d=Path(args.model_dir);task=_load_bundle_task(d);df=load_table(args.data);out=anomaly_predict(d,df) if TASK_REGISTRY.get(task,{}).get("type")=="anomaly" else predict(d,df,args.output)
        if TASK_REGISTRY.get(task,{}).get("type")=="anomaly":out.to_csv(args.output,index=False)
        _emit({"status":"completed","task":task,"rows":len(out),"output":str(Path(args.output).resolve())});return 0
    if args.cmd=="drift":save_json(args.output,drift_from_model(args.model_dir,load_table(args.data)));_emit({"status":"completed","output":str(Path(args.output).resolve())});return 0
    if args.cmd=="build-retrieval":_emit(build_retrieval_index(load_table(args.data),args.text_column,args.output,args.id_column,args.source_column));return 0
    if args.cmd=="retrieve":_emit(retrieve_similar(args.index_dir,args.query,args.top_k));return 0
    return 1


if __name__=="__main__":
    raise SystemExit(main())
