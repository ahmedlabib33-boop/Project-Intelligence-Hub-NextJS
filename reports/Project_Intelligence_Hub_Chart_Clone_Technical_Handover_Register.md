# Project Intelligence Hub - Chart Clone Technical Handover Register

## Architecture
`project folder -> canonical Python calculations -> generated project JSON -> same-page Next.js workspace -> Output Studio artifacts`

## Source Precedence
1. Populated `project/vercel/<template>.csv` rows matching `project_id`.
2. Existing project-local source defined in the chart mapping.
3. Controlled awaiting-data card. No sample values, cross-project fallback, or zero placeholder.

## Chart Register

| ID | Tab | Type | Primary sources | Required columns |
|---|---|---|---|---|
| overview.schedule_performance_s_curve | Overview | line | s_curve.csv | project_id, months |
| overview.overall_completion_gauge | Overview | doughnut | projects.csv, progress_updates.csv | project_id |
| overview.activity_status | Overview | doughnut | activities.csv | project_id, actual_progress |
| overview.discipline_health | Overview | radar | vercel/discipline_progress_history.csv | project_id, discipline, actual_progress_percent |
| overview.earned_value_trend | Overview | line | evm.csv, vercel/evm_period_history.csv | project_id, period |
| overview.performance_indices | Overview | line | evm.csv, vercel/evm_period_history.csv | project_id, spi, cpi |
| wbs.progress_distribution | WBS | bar | wbs.csv | project_id, wbs_name |
| wbs.duration_breakdown | WBS | horizontal_bar | wbs.csv | project_id, wbs_name |
| activities.status_distribution | Activities | doughnut | activities.csv | project_id, actual_progress |
| activities.critical_path | Activities | doughnut | activities.csv | project_id, is_critical |
| activities.float_distribution | Activities | bar | activities.csv | project_id, total_float_days |
| activities.monthly_completion | Activities | bar | vercel/activity_completion_history.csv | project_id, period_date, completed_activity_count |
| activities.responsible_party_workload | Activities | horizontal_bar | activities.csv | project_id, responsible_party |
| milestones.schedule_health | Milestones | doughnut | milestones.csv | project_id, planned_date |
| milestones.variance_trend | Milestones | line | milestones.csv | project_id, planned_date, forecast_date |
| milestones.type_breakdown | Milestones | bar | milestones.csv | project_id, milestone_contractual_type |
| s_curve.master | S-Curve | line | s_curve.csv | project_id, months |
| s_curve.discipline | S-Curve | line | vercel/discipline_progress_history.csv | project_id, period_date, discipline |
| s_curve.variance | S-Curve | bar | s_curve.csv | project_id, months |
| evm.burnup | EVM Analysis | line | evm.csv, vercel/evm_period_history.csv | project_id, period |
| evm.variance_waterfall | EVM Analysis | bar | evm.csv, projects.csv | project_id |
| evm.spi_trend | EVM Analysis | line | evm.csv, vercel/evm_period_history.csv | project_id, spi |
| evm.cpi_trend | EVM Analysis | line | evm.csv, vercel/evm_period_history.csv | project_id, cpi |
| contracts.payment_history | Contracts | bar | payments.csv | project_id |
| contracts.planned_vs_actual_cash_flow | Contracts | line | vercel/planned_cash_flow.csv, planned_cash_flow.csv, payments.csv | project_id, period_date |
| contracts.payment_status | Contracts | doughnut | payments.csv | project_id |
| contracts.variations | Contracts | bar | contracts.csv | project_id |
| risks.category | Risks | bar | risks.csv | project_id, risk_category |
| risks.status | Risks | doughnut | risks.csv | project_id, status |
| risks.trend | Risks | line | vercel/risk_assessment_history.csv | project_id, snapshot_date |
| risks.mitigation_effectiveness | Risks | bar | vercel/risk_assessment_history.csv | project_id, score_before_mitigation, score_after_mitigation |
| delay.events_timeline | Delay Analysis - Time Impact Analysis | bar | delay_events.csv | project_id |
| delay.root_cause_pareto | Delay Analysis - Time Impact Analysis | horizontal_bar | vercel/delay_event_classification.csv, 14-delay_event_classification.csv | project_id, event_id, root_cause |
| delay.type_distribution | Delay Analysis - Time Impact Analysis | doughnut | vercel/delay_event_classification.csv, 14-delay_event_classification.csv | project_id, event_id, delay_type |
| delay.monthly_accumulation | Delay Analysis - Time Impact Analysis | line | vercel/delay_event_classification.csv, delay_events.csv | project_id |
| delay.tia_recovery_scenario | Delay Analysis - Time Impact Analysis | line | vercel/tia_recovery_scenario.csv, 15-tia_recovery_scenario.csv | project_id, scenario_id, activity_id |

## Required Vercel Templates

| File | Mandatory boundary | Purpose |
|---|---|---|
| `vercel/phase_progress.csv` | `project_id` | Phase-level progress history for executive phase and completion views. |
| `vercel/discipline_progress_history.csv` | `project_id` | Dated planned, actual, and forecast progress by discipline. |
| `vercel/activity_completion_history.csv` | `project_id` | Dated started and completed activity counts. |
| `vercel/evm_period_history.csv` | `project_id` | Dated BAC, PV, EV, AC, SPI, and CPI where the standard EVM register has no period series. |
| `vercel/planned_cash_flow.csv` | `project_id` | Planned cash out series for the cash-flow comparison; payment/certification remains in the normal payments source. |
| `vercel/risk_assessment_history.csv` | `project_id` | Dated risk snapshots and before/after mitigation scores. |
| `vercel/delay_event_classification.csv` | `project_id` | Verified delay-event classification linked to an existing event; it cannot create an event. |
| `vercel/tia_recovery_scenario.csv` | `project_id` | P6 and evidence-backed baseline, impacted, and recovery comparison scenario. |

## Deployment and Validation

- Generator: `D:\Project Intelligence Hub NextJS\tools\generate_nextjs_website_data.py`
- Chart payload builder: `D:\Project Intelligence Hub NextJS\tools\project_chart_payloads.py`
- Pipeline validator: `D:\Project Intelligence Hub NextJS\tools\validate_streamlit_vercel_pipeline.py`
- Full publisher: `D:\Project Intelligence Hub NextJS\tools\vercel_project_pipeline.ps1`
- Website chart renderer: `D:\Project Intelligence Hub NextJS\website\src\app\page.tsx`
- The dashboard only renders chart payloads matching the active project identity.
- Delay Analysis - Time Impact Analysis remains internal unless explicitly recalled.
