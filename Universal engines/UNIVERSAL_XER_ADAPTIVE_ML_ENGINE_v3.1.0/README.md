Python AI Programming by Eng. Ahmed Labib

# Universal XER Adaptive ML Schedule Engine v3.1.0

## Objective

This engine is designed to recognize, understand and optimize **any valid Primavera P6 XER schedule** without project-specific hardcoding. It reads the project and data date from the XER itself, reconstructs the native activity/relationship network, learns project-local activity semantics, generates CPM-labelled training scenarios, trains a local machine-learning ensemble, and produces one of three controlled schedule strategies:

- **Mitigation** — limited, risk-aware prevention/reduction of further schedule slippage.
- **Recovery** — optimize toward the schedule's evidenced finish requirement, an entered target date, or a specified number of recovery days.
- **Revised** — optimize the remaining network without forcing an external recovery target and issue a proposed revised schedule/change register.

## What “100% ML / algorithmic” means here

The **decision path contains no project name, activity ID, building, discipline, or construction-method dictionary**. The engine learns from the uploaded schedule. XER parsing and CPM propagation are deterministic because they are schedule mathematics, not prediction problems. ML cannot safely replace precedence equations or calendar/constraint arithmetic; therefore exact CPM is the governing truth layer while ML performs representation learning, scenario learning, prediction, uncertainty assessment, ranking and optimization.

## Universal recognition

The engine automatically reads and reconstructs:

- PROJECT and native `last_recalc_date` / data date;
- TASK activities, status, durations, actual/early/late dates, constraints and float;
- TASKPRED FS/SS/FF/SF relationships and lags, preserving multiple native relationships between the same pair;
- PROJWBS hierarchy;
- CALENDAR hours/day basis;
- RSRC / TASKRSRC assignments;
- activity codes when present;
- terminal Project Finish milestone or best structural terminal candidate;
- controlling/near-critical corridor to Project Finish.

## Machine-learning architecture

### 1. Self-learned activity representation

The engine builds text representations directly from each schedule's own activity names, WBS paths, resources and activity codes. TF-IDF + unsupervised clustering learns repetitive/similar activity families without a fixed construction vocabulary.

### 2. Project-local self-supervised training

The engine generates hundreds/thousands of legal what-if perturbations from the current schedule. Each scenario is solved by the exact shadow-CPM engine to create a real recovery label. Therefore **a new project can train its own recovery model immediately even when no historical project dataset exists**.

### 3. Ensemble learning

The local surrogate supports:

- Extra Trees
- Random Forest
- HistGradientBoosting
- Gradient Boosting
- XGBoost (when installed)
- LightGBM (when installed)
- CatBoost (when installed)

Validation MAE controls ensemble weighting. Poorer models automatically receive low influence rather than equal voting.

### 4. Viability classifier

A separate classifier predicts whether a scenario is likely to produce material Project Finish recovery.

### 5. Evolutionary optimization

The optimizer uses the learned recovery surrogate to search combinations of:

- remaining-duration compression;
- relationship-lag optimization;
- partial FS overlap / fast-track hypotheses;
- learned repetitive-cycle compression.

Top solutions are re-solved by exact CPM. **The exact CPM value, not the ML prediction, governs the final selected recovery.**

### 6. Revised schedule implementation layer

The engine creates:

- proposed remaining durations;
- estimated revised early start/finish dates;
- relationship-lag changes;
- a P6 change register;
- the final optimized shadow path;
- the remaining recovery gap.

The source XER is never modified.

## Installation

```powershell
python -m pip install -r requirements.txt
```

## Run — Recovery

```powershell
python .\UNIVERSAL_XER_ADAPTIVE_ML_ENGINE_v3.1.0.py run .\schedule.xer `
  --mode recovery `
  --output .\Recovery_Output
```

## Run — Mitigation

```powershell
python .\UNIVERSAL_XER_ADAPTIVE_ML_ENGINE_v3.1.0.py run .\schedule.xer `
  --mode mitigation `
  --output .\Mitigation_Output
```

## Run — Revised

```powershell
python .\UNIVERSAL_XER_ADAPTIVE_ML_ENGINE_v3.1.0.py run .\schedule.xer `
  --mode revised `
  --output .\Revised_Output
```

## Force a recovery target

```powershell
python .\UNIVERSAL_XER_ADAPTIVE_ML_ENGINE_v3.1.0.py run .\schedule.xer `
  --mode recovery `
  --target-recovery-days 60
```

or:

```powershell
python .\UNIVERSAL_XER_ADAPTIVE_ML_ENGINE_v3.1.0.py run .\schedule.xer `
  --mode recovery `
  --target-date 2027-04-10
```

## Runtime profiles

- `STANDARD_CONFIG.json` — balanced production profile.
- `DEEP_CONFIG.json` — larger training/search space for maximum scenario exploration.
- `VALIDATION_CONFIG.json` — compact reproducible profile used for package validation.

Use:

```powershell
python .\UNIVERSAL_XER_ADAPTIVE_ML_ENGINE_v3.1.0.py `
  --config .\DEEP_CONFIG.json `
  run .\schedule.xer --mode recovery --output .\Deep_Recovery
```

## Output files

Each run creates:

- `schedule_profile.json`
- `learned_activity_clusters.csv`
- `activity_cluster_model.json`
- `universal_ml_candidates.csv`
- `project_local_ml_training.csv`
- `project_local_ml_manifest.json`
- `local_ml_models/*.joblib`
- `optimized_scenario.json`
- `REVISED_SCHEDULE_PROPOSAL.csv`
- `P6_CHANGE_REGISTER.csv`
- `UNIVERSAL_SCHEDULE_ML_REPORT.md`
- `analysis_manifest.json`

## Critical governance rule

The engine can propose and quantify a revised/recovery schedule but **native Primavera P6 recalculation remains mandatory** before execution or contractual reliance. Calendars, exceptions, external relationships, constraints, resource leveling and approved technical changes must be checked in the controlled P6 programme.
