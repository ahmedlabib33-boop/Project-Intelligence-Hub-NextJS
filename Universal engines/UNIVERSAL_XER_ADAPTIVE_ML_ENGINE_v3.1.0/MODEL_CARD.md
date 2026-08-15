Python AI Programming by Eng. Ahmed Labib

# Model Card — Universal XER Adaptive ML Schedule Engine v3.1.0

## Model purpose

Project-local prediction and optimization of schedule-recovery combinations from arbitrary Primavera XER networks.

## Learning design

The system is self-supervised at project level. Candidate schedule perturbations are generated from the uploaded XER. Exact shadow-CPM recovery is used as the target label. The trained surrogate therefore learns the interaction between multiple recovery actions rather than assuming individual gains are additive.

## Features

Scenario features include action count, nominal compression, individual CPM gains, action-family mix, learned-cluster diversity, path position, resource-support coverage and risk/uncertainty statistics.

Activity families are not fixed labels. They are learned by unsupervised TF-IDF clustering from the uploaded schedule's own activity/WBS/resource/code text.

## Learners

Extra Trees, Random Forest, HistGradientBoosting, Gradient Boosting, XGBoost, LightGBM and CatBoost when available. Ensemble weights are inverse-validation-MAE normalized. A separate Random Forest classifier estimates scenario viability.

## Acceptance control

ML is never permitted to determine the official schedule finish directly. The highest-ranked scenarios are recomputed through exact network precedence equations. The exact CPM result controls final recovery selection.

## Limitations

A local synthetic holdout measures how accurately the surrogate approximates that schedule's CPM response surface; it is **not** a claim of universal real-world productivity accuracy. Constructability, resource availability, procurement, HSE, QA/QC, technical waiting periods and contractual approval requirements still require project evidence and native P6 verification.

No model can credibly guarantee 100% forecast accuracy on unseen real-world delays. The design goal is deterministic traceability and high-quality optimization, not an artificial 100% accuracy claim.
