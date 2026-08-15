# Python AI Programming by Eng. Ahmed Labib

# Universal Project Report Engine 26+ — Advanced Ensemble ML + Claude/Kimi/DeepSeek Evidence Council

## Status

This package preserves the existing controlled architecture:

- 26 universal governance rules — unchanged
- 30 independent report-family rulebooks
- 32 processing layers
- native Primavera P6/XER CPM/TIA supremacy
- source inventory and SHA-256 traceability
- project-aware ML validation
- evidence-first and no-fabrication controls

It adds two new governed layers:

1. **Advanced Efficient Ensemble ML** — model competition and weighted ensemble selection using measured quality, stability, calibration and inference latency.
2. **Multi-LLM Evidence Council** — Claude, Kimi and DeepSeek can independently analyze the same evidence packet and return a deterministic, auditable consensus/disagreement record.

## External model integration

Environment variables:

```text
ANTHROPIC_API_KEY=...
MOONSHOT_API_KEY=...
DEEPSEEK_API_KEY=...
```

Optional model overrides:

```text
PROJECT_CONTROLS_CLAUDE_MODEL=claude-opus-5
PROJECT_CONTROLS_KIMI_MODEL=kimi-k3
PROJECT_CONTROLS_DEEPSEEK_MODEL=deepseek-v4-pro
```

Keys are read at runtime only and are never written to generated artifacts.

## Routing modes

- `fast`: one configured provider for low-risk analytical support.
- `balanced`: Claude + Kimi + DeepSeek in parallel, followed by deterministic consensus.
- `assurance`: all three providers in parallel plus a second cross-review pass. Intended for disputed/high-risk/contractual analysis.
- `auto`: routes high-risk, conflicting, or low-confidence cases to `assurance`; medium-risk to `balanced`; otherwise `fast`.

The router reduces unnecessary API calls without weakening high-risk review.

## Critical governance behavior

Provider agreement is never treated as proof. If all three models repeat an unsupported statement, it remains unsupported.

The external LLM layer cannot:

- create missing P6 logic, dates, activities or relationships;
- turn event duration into EOT;
- override native critical/longest-path results;
- establish contractual entitlement automatically;
- convert OCR contract wording into verified contract text;
- resolve conflicting evidence silently;
- turn synthetic ML performance into universal accuracy.

## Advanced Ensemble ML

The ensemble layer compares available backends:

- scikit-learn
- XGBoost
- LightGBM
- CatBoost
- PyTorch

External framework adapters normalize class-label and sklearn-interface differences so all backends can participate in the same controlled competition.

The selected ensemble is based on:

- project-aware cross-validation where project IDs are available;
- holdout F1/Accuracy/Precision/Recall for classification;
- MAE/RMSE/R² for regression;
- calibration error (ECE) for classification;
- cross-validation stability;
- measured inference latency;
- OOD detection;
- drift profile;
- model diversity through top-model weighted combination.

The saved ensemble contains the trained pipelines, weights, classes, OOD detector, reference drift profile and model card.

## Metadata controls

Every new multi-LLM artifact carries:

- attribution and author;
- run ID and UTC timestamp;
- project/report scope;
- governance SHA-256;
- evidence SHA-256 list;
- provider/model provenance;
- prompt/request/response hashes;
- latency and usage where returned by the provider;
- native-schedule supremacy flag;
- ML and LLM decision-support role;
- `secrets_persisted=false`.

See:

- `MULTI_LLM_AND_ADVANCED_ML_METADATA_SCHEMA.json`
- `MULTI_LLM_ORCHESTRATION_POLICY.json`

## Website endpoints

Existing endpoints remain available. New endpoints are:

```text
GET  /api/project-controls/llm/providers
POST /api/project-controls/llm/consensus
POST /api/project-controls/ml/train-ensemble
POST /api/project-controls/ml/predict-ensemble
```

The module continues to append the 30 Project Controls report cards beside existing Output Studio reports.

## CLI examples

Provider/runtime status:

```powershell
python PROJECT_CONTROLS_MULTI_LLM_ORCHESTRATOR.py status
```

Offline consensus parser/governance test:

```powershell
python PROJECT_CONTROLS_MULTI_LLM_ORCHESTRATOR.py self-test
```

Live governed three-model analysis once API keys are configured:

```powershell
python PROJECT_CONTROLS_MULTI_LLM_ORCHESTRATOR.py analyze `
  --question "Does the submitted evidence demonstrate critical delay to Project Finish?" `
  --evidence-json evidence_packet.json `
  --mode assurance `
  --risk-level contractual `
  --output multi_llm_analysis.json
```

Advanced project-aware ensemble training:

```powershell
python PROJECT_CONTROLS_ADVANCED_ENSEMBLE_ML.py train `
  --task delay_risk_prediction `
  --data REAL_PROJECT_TRAINING.csv `
  --target delay_risk `
  --output MODEL_DELAY_RISK `
  --project-column project_id `
  --data-origin real_project `
  --project-scope "Project Portfolio"
```

## Validation

Run:

```powershell
python VALIDATE_WEB_ML_PACKAGE.py --deep
```

The deep validator compiles the engine, verifies the preserved 26-rule hash, checks report families/layers, runs core and web health, validates the multi-LLM offline council, runs advanced ensemble ML and checks the web provider registry.

A live Claude/Kimi/DeepSeek call is intentionally not required by package validation because it would depend on private API credentials, network availability and paid external services. Live provider execution becomes available only when the corresponding environment keys are configured.

## Accuracy claim control

The engine may report **100%** only when an actual declared validation dataset produces 100% on the stated metric. It never changes a lower measured result to 100% and never converts synthetic benchmark performance into real-project or universal accuracy.
