Python AI Programming by Eng. Ahmed Labib

# Universal XER Adaptive ML Schedule Engine v3.1.0 — Validation Report

Generated: 2026-08-11

## Technical validation

- Python compilation: PASS
- Self-test: PASS
- Native XER parsing: PASS
- Multiple-project selection: PASS
- Cached DAG topological order / shadow CPM: PASS
- Project-local ML training: PASS
- Ensemble persistence to Joblib: PASS
- Evolutionary optimization: PASS
- Exact CPM final verification: PASS
- Mitigation mode: PASS
- Recovery mode: PASS
- Revised mode: PASS

## No-project-hardcoding audit

The clean v3.1 decision source was scanned for SAMCO / The Big / B01-B04 and prior construction-category terms. Result: {"SAMCO": false, "The Big": false, "B01": false, "B02": false, "B03": false, "B04": false, "reinforcement": false, "formwork": false, "MEP": false, "steel fixing": false}. No project-specific identifiers are embedded in the decision path.

## Multi-XER recognition validation

Four independent uploaded after-fragnet XER schedules were recognized from native PROJECT/TASK/TASKPRED data. Native data dates detected:

- 31-Oct-2025 — 1,371 activities / 3,046 relationships.
- 26-Nov-2025 — 1,387 activities / 3,141 relationships.
- 25-Dec-2025 — 1,368 activities / 3,022 relationships.
- 17-Mar-2026 — 1,398 activities / 3,141 relationships.

The Event 03 filename contains `DD25-13-2025`, but the engine correctly used the internal XER data date **25-Dec-2025**, proving filename-independent recognition.

## Recovery end-to-end validation — Event 02

- Project: UPD-TheBIG-PH01upto 17-MAR (FR)-IFC
- Native data date: 2026-03-17 00:00
- Project Finish forecast: 2027-09-20 16:00
- Required finish: 2027-04-10 16:00
- Recovery requirement: 163.0 days
- Project-local training scenarios: 150
- Candidate actions tested: 160 (validation profile)
- Exact scenario combinations verified during optimization: 27
- ML predicted selected-scenario recovery: 10.545 days
- Exact shadow-CPM selected-scenario recovery: 18.0 days
- Remaining gap: 145.0 days

### Local surrogate holdout metrics

{
  "extra_trees": {
    "mae": 0.01273,
    "rmse": 0.06148,
    "r2": 0.99445
  },
  "random_forest": {
    "mae": 0.03389,
    "rmse": 0.07845,
    "r2": 0.99097
  },
  "hist_gradient_boosting": {
    "mae": 0.37693,
    "rmse": 0.66645,
    "r2": 0.34833
  },
  "gradient_boosting": {
    "mae": 0.00309,
    "rmse": 0.0175,
    "r2": 0.99955
  },
  "xgboost": {
    "mae": 0.00388,
    "rmse": 0.0192,
    "r2": 0.99946
  },
  "lightgbm": {
    "mae": 0.40694,
    "rmse": 0.6919,
    "r2": 0.2976
  },
  "catboost": {
    "mae": 0.03122,
    "rmse": 0.04813,
    "r2": 0.9966
  }
}

These metrics measure approximation of the **same project's CPM-generated scenario response surface**; they are not represented as universal real-world productivity accuracy.

## Mitigation mode validation

- Exact verified recovery: 1.0 days under the compact validation search profile.
- Mode logic and output generation: PASS.

## Revised mode validation

- Exact verified optimized gain: 10.0 days under the compact validation search profile.
- `REVISED_SCHEDULE_PROPOSAL.csv`: generated.
- `P6_CHANGE_REGISTER.csv`: generated.

## Engineering control

The engine is ML-native and algorithmic, but deterministic CPM is intentionally retained as the final schedule-physics layer. A credible schedule engine cannot replace FS/SS/FF/SF precedence equations, lags, durations and constraints with probabilistic predictions and still guarantee a valid network. Native Primavera P6 recalculation remains mandatory before execution or contractual reliance.
