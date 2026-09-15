# Python AI Programming by Eng. Ahmed Labib

# Universal Project Report Engine 26+ — Drop-in Web + Governed ML Edition

## What this fixes

This edition converts the local report package into a website-loadable Output Studio module while retaining the local/CLI engine. It adds a FastAPI router, a standalone API host, a framework-neutral JavaScript client, a governed model registry, runtime dependency diagnostics, ML training/inference/drift endpoints, and additive registration of all 30 report families beside any existing Output Studio report cards.

It also corrects ML readiness semantics. A successful framework self-test proves runtime integration only. **Actual trained Machine Learning becomes YES only when a model trained from evidence explicitly identified as `real_project` is registered and promoted.** Synthetic benchmarks cannot satisfy that gate.

## Governance retained

- All 26 universal governance rules remain unchanged and hash-validated.
- 30 independent report-family rulebooks remain available.
- 32 governed processing layers remain available.
- Native Primavera P6/XER CPM/TIA remains governing technical schedule evidence.
- ML remains decision support and cannot invent missing evidence or overwrite native CPM/TIA.
- Missing evidence, conflicting values, unverified contract wording and missing real-project training labels remain explicitly unresolved.

## Drop-in integration with an existing FastAPI website

```python
from OUTPUT_STUDIO_PROJECT_CONTROLS_WEB import create_router

# existing FastAPI app
app.include_router(create_router())
```

This adds routes under `/api/project-controls` without removing the website's current report routes.

To append the 30 report cards beside existing Output Studio cards:

```python
from OUTPUT_STUDIO_PROJECT_CONTROLS_WEB import register_output_studio_reports

output_studio_cards = register_output_studio_reports(output_studio_cards)
```

## Standalone web host

```powershell
python -m uvicorn OUTPUT_STUDIO_SERVER:app --host 0.0.0.0 --port 8755
```

Open `/docs` for the generated API interface.

## Front-end module

`OUTPUT_STUDIO_PROJECT_CONTROLS.js` provides a framework-neutral ES client:

```javascript
import { ProjectControlsOutputStudio } from './OUTPUT_STUDIO_PROJECT_CONTROLS.js';
const studio = new ProjectControlsOutputStudio('/api/project-controls');
const reports = await studio.reports();
```

## Main API endpoints

- `GET /api/project-controls/health`
- `GET /api/project-controls/output-studio/reports`
- `POST /api/project-controls/reports/generate`
- `GET /api/project-controls/ml/tasks`
- `GET /api/project-controls/ml/models`
- `POST /api/project-controls/ml/train`
- `POST /api/project-controls/ml/predict`
- `POST /api/project-controls/ml/drift`
- `GET /api/project-controls/artifacts/{run_id}/{filename}`

The host application should apply its existing authentication/authorization middleware to this router.

## Runtime installation and verification

```powershell
.\install_full_runtime.ps1
```

or:

```powershell
python INSTALL_FULL_RUNTIME.py --install
python INSTALL_FULL_RUNTIME.py
python VALIDATE_WEB_ML_PACKAGE.py --deep
```

The engine distinguishes:

- **Core ML runtime:** scikit-learn and the scientific/data stack required for training/inference.
- **Optional competing ML backends:** XGBoost, LightGBM, CatBoost and PyTorch.
- **Full backend ready:** all optional backends are installed and pass runtime probing.

If one optional backend is missing, the engine remains operational with the available governed candidates and reports the missing backend. It does not falsely report total failure. The main requirements file still requests all five ML frameworks.

## Real-project model training

A real-project trained model cannot be generated honestly without real labelled project records. Use the API or CLI once such data is available.

CLI example:

```powershell
python UNIVERSAL_PROJECT_REPORT_ENGINE_26PLUS_ML.py ml-train `
  --task event_classification `
  --data .\project_training.csv `
  --target event_class `
  --output .\trained_event_model `
  --project-column project_id `
  --data-origin real_project `
  --project-scope "PROJECT-001"
```

Website training requires an explicit `data_origin`. `synthetic_benchmark` and `external_reference` models are stored as support/draft models and cannot be promoted as real-project production models.

`REAL_PROJECT_ML_DATA_CONTRACT.json` defines the supervised task targets and evidence requirements. `REAL_PROJECT_TRAINING_TEMPLATE.csv` is a blank structural starter only; it contains no fabricated project history.

## Readiness interpretation

The health endpoint may report:

- `website_module = READY`
- `core_ml_runtime = READY`
- `full_optional_ml_backends = READY` or `PARTIAL`
- `actual_trained_machine_learning = NO — AWAITING VALIDATED REAL-PROJECT MODEL`

That final status is correct until genuine labelled project evidence is supplied. Once a real-project model is trained, validated, registered and promoted, it changes to YES with its measured metrics, model hash, project scope and provenance.

## Evidence-first release

A report can be generated while remaining draft. For example, a Progress report without a native XER is correctly released as `DRAFT_NATIVE_SCHEDULE_VERIFICATION_REQUIRED`. The system does not manufacture schedule evidence merely to obtain a PASS.

---

## Advanced multi-LLM + ensemble upgrade

The current package also includes `PROJECT_CONTROLS_MULTI_LLM_ORCHESTRATOR.py` and `PROJECT_CONTROLS_ADVANCED_ENSEMBLE_ML.py`. See `README_MULTI_LLM_ADVANCED_ML.md` for the governed Claude/Kimi/DeepSeek evidence-council workflow, ensemble model competition, metadata schema, new web endpoints and validation controls.
