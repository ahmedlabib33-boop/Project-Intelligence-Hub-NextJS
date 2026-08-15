/* Python AI Programming by Eng. Ahmed Labib
 * Framework-neutral ES module client for the Project Controls Output Studio API.
 */
export const ATTRIBUTION = "Python AI Programming by Eng. Ahmed Labib";
export class ProjectControlsOutputStudio {
  constructor(baseUrl = "/api/project-controls") { this.baseUrl = baseUrl.replace(/\/$/, ""); }
  async json(path, options={}) { const r=await fetch(this.baseUrl+path, options); const body=await r.json().catch(()=>({})); if(!r.ok) throw new Error(body.detail || `HTTP ${r.status}`); return body; }
  health(runFrameworkTest=false){ return this.json(`/health?run_framework_test=${runFrameworkTest}`); }
  reports(){ return this.json("/output-studio/reports"); }
  models(){ return this.json("/ml/models"); }
  tasks(){ return this.json("/ml/tasks"); }
  async generate({files, reportType="auto", context={}, modelIds=[], mlInferenceFile=null, strict=false}) {
    const f=new FormData(); files.forEach(x=>f.append("files",x)); f.append("report_type",reportType); f.append("context_json",JSON.stringify(context)); f.append("model_ids",JSON.stringify(modelIds)); f.append("strict",String(strict)); if(mlInferenceFile)f.append("ml_inference_file",mlInferenceFile);
    return this.json("/reports/generate",{method:"POST",body:f});
  }
  async train({data,task,target,projectColumn="project_id",dataOrigin,projectScope="",promote=false,fullLoad=true}) {
    const f=new FormData(); f.append("data",data);f.append("task",task);f.append("target",target);f.append("project_column",projectColumn);f.append("data_origin",dataOrigin);f.append("project_scope",projectScope);f.append("promote",String(promote));f.append("full_load",String(fullLoad));
    return this.json("/ml/train",{method:"POST",body:f});
  }
  async predict(modelId,data){ const f=new FormData();f.append("model_id",modelId);f.append("data",data);return this.json("/ml/predict",{method:"POST",body:f}); }
  async drift(modelId,data){ const f=new FormData();f.append("model_id",modelId);f.append("data",data);return this.json("/ml/drift",{method:"POST",body:f}); }

  llmProviders(){ return this.json("/llm/providers"); }
  async llmConsensus({question,evidence,context={},mode="auto",riskLevel="medium",projectId="",reportFamily="",conflictCount=0,mlConfidence=null}) {
    const f=new FormData();f.append("question",question);f.append("evidence_json",JSON.stringify(evidence));f.append("context_json",JSON.stringify(context));f.append("mode",mode);f.append("risk_level",riskLevel);f.append("project_id",projectId);f.append("report_family",reportFamily);f.append("conflict_count",String(conflictCount));if(mlConfidence!==null)f.append("ml_confidence",String(mlConfidence));
    return this.json("/llm/consensus",{method:"POST",body:f});
  }
  async trainEnsemble({data,task,target,projectColumn="project_id",dataOrigin,projectScope="",promote=false,fullLoad=true,maxEnsembleModels=3}) {
    const f=new FormData();f.append("data",data);f.append("task",task);f.append("target",target);f.append("project_column",projectColumn);f.append("data_origin",dataOrigin);f.append("project_scope",projectScope);f.append("promote",String(promote));f.append("full_load",String(fullLoad));f.append("max_ensemble_models",String(maxEnsembleModels));
    return this.json("/ml/train-ensemble",{method:"POST",body:f});
  }
  async predictEnsemble(modelId,data){ const f=new FormData();f.append("model_id",modelId);f.append("data",data);return this.json("/ml/predict-ensemble",{method:"POST",body:f}); }
  async mountReportCards(container){
    const host=typeof container==="string"?document.querySelector(container):container; if(!host)throw new Error("Container not found");
    const payload=await this.reports(); host.innerHTML=`<div class="pc-attribution">${ATTRIBUTION}</div>`+payload.reports.map(r=>`<button type="button" data-report-type="${r.engine_report_type}" class="pc-report-card"><strong>${r.id}</strong><span>${r.title}</span></button>`).join(""); return payload;
  }
}
