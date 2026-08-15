"""Split legacy project_input_bundle.csv into ten project-local canonical inputs."""
from __future__ import annotations
import argparse,csv,hashlib,json,re,shutil
from datetime import datetime,timezone
from pathlib import Path

BUNDLE_HEADERS=["bundle_version","source_scope","source_file","row_kind","row_order","payload_json"]
INPUTS=(
"01_project_contract.csv","02_schedule_activities.csv","03_schedule_logic.csv","04_progress_evm.csv","05_milestones_scurve.csv","06_delay_events.csv","07_tia_evidence_scenarios.csv","08_commercial_payments_claims.csv","09_risks_rfi_interfaces.csv","10_letters_intelligence.csv")

def digest(path:Path)->str:
 h=hashlib.sha256()
 with path.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()

def category(scope:str)->str:
 s=scope.casefold()
 if s in {'data/projects.csv','data/contracts.csv'}: return INPUTS[0]
 if any(x in s for x in ('activity_master','activities.csv','p6_activity_export','p6_activity_register')): return INPUTS[1]
 if any(x in s for x in ('wbs.csv','relationship','native_xer_pair')): return INPUTS[2]
 if any(x in s for x in ('evm.csv','progress_updates')): return INPUTS[3]
 if any(x in s for x in ('milestones.csv','s_curve.csv')): return INPUTS[4]
 if any(x in s for x in ('delay_events.csv','delay_event_classification')): return INPUTS[5]
 if any(x in s for x in ('claims.csv','payments.csv','planned_cash_flow')): return INPUTS[7]
 if any(x in s for x in ('risks.csv','rfi','ifc_conflict')): return INPUTS[8]
 return INPUTS[6]

def records(path:Path):
 with path.open('r',encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))

def write(path:Path, rows:list[dict[str,str]]):
 with path.open('w',encoding='utf-8',newline='') as f:
  w=csv.DictWriter(f,fieldnames=BUNDLE_HEADERS);w.writeheader();w.writerows(rows)

def project_key(project:Path)->str:
 try:return str(json.loads((project/'project_manifest.json').read_text(encoding='utf-8')).get('project_key') or '')
 except Exception:return ''

def tree_hashes(folder:Path):
 return [{'relative_path':str(path.relative_to(folder)).replace('\\','/'),'sha256':digest(path)} for path in sorted(folder.rglob('*')) if path.is_file()]

def payload_filename(value:str)->str:
 return re.sub(r'[^a-z0-9]+','-',str(value or '').casefold()).strip('-')+'.json'

def main():
 p=argparse.ArgumentParser();p.add_argument('--projects-root',type=Path,required=True);p.add_argument('--payload-root',type=Path,required=True);p.add_argument('--archive-root',type=Path,required=True);p.add_argument('--apply',action='store_true');a=p.parse_args()
 manifest={'created_at':datetime.now(timezone.utc).isoformat(),'projects':[]}
 for mf in sorted(a.projects_root.rglob('project_manifest.json')):
  project=mf.parent;data=project/'01-data'/'import_templates'; old=data/'project_input_bundle.csv'
  if not old.exists():raise SystemExit(f'Missing legacy bundle {old}')
  old_rows=records(old); groups={name:[] for name in INPUTS}
  for row in old_rows: groups[category(str(row.get('source_scope') or ''))].append(row)
  key=project_key(project); payload={}
  pp=a.payload_root/payload_filename(key)
  if pp.exists(): payload=json.loads(pp.read_text(encoding='utf-8')).get('features',{}).get('letters_intelligence',{})
  groups[INPUTS[9]].append({'bundle_version':'2026-08-15.ten-input.v1','source_scope':'letters/payload','source_file':'07-letters_intelligence','row_kind':'snapshot','row_order':'0','payload_json':json.dumps(payload,ensure_ascii=False,separators=(',',':'))})
  stages=[]
  for name,rows in groups.items():
   stage=data/(name+'.staging');write(stage,rows);stages.append(stage)
  # exact record parity for all former planning/TIA scopes
  rebuilt=[]
  for stage in stages:
   rebuilt.extend([r for r in records(stage) if r.get('source_scope')!='letters/payload'])
  def sig(rows):return [(r.get('source_scope'),r.get('source_file'),r.get('row_kind'),r.get('row_order'),r.get('payload_json')) for r in rows]
  if sorted(sig(old_rows))!=sorted(sig(rebuilt)):raise SystemExit(f'Parity failure {project}')
  details={'project':str(project.relative_to(a.projects_root)).replace('\\','/'),'inputs':INPUTS,'legacy_bundle_sha256':digest(old)}
  if a.apply:
   target_archive=a.archive_root/'ten-input-project-redesign'/project.relative_to(a.projects_root)
   target_archive.mkdir(parents=True,exist_ok=True)
   old_dest=target_archive/'01-data'/'import_templates'/'project_input_bundle.csv';old_dest.parent.mkdir(parents=True,exist_ok=True);shutil.move(str(old),str(old_dest));details['archived_bundle_sha256']=digest(old_dest)
   letters=project/'07-letters_intelligence'
   if letters.exists():
    details['archived_letters_sha256']=tree_hashes(letters)
    letter_dest=target_archive/'07-letters_intelligence'
    if letter_dest.exists():raise SystemExit(f'Archive exists {letter_dest}')
    shutil.move(str(letters),str(letter_dest))
   for stage in stages:stage.replace(data/stage.name.removesuffix('.staging'))
  else:
   for stage in stages:stage.unlink()
  manifest['projects'].append(details)
 if a.apply:
  root=a.archive_root/'ten-input-project-redesign';root.mkdir(parents=True,exist_ok=True);(root/'TEN_INPUT_MANIFEST.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
 print(json.dumps({'projects':len(manifest['projects']),'inputs_per_project':10,'applied':a.apply}))
if __name__=='__main__':main()