# SAMCO SMART CHARTS — AI AGENT ASSIGNMENT GUIDE
# =============================================================================
# This document tells any AI agent exactly which charts belong to which tab
# in the SAMCO Project Intelligence Dashboard.
# =============================================================================

## DASHBOARD STRUCTURE

The SAMCO dashboard has 9 tabs. Each tab has its own set of charts.
Charts are organized by tab in both the HTML and Python files.

---

## TAB 1: OVERVIEW (id="overview")
**Purpose:** Executive summary with KPIs and high-level intelligence
**Charts to render (11 total):**

| # | Chart Name | Canvas ID | Type | Data Source |
|---|-----------|-----------|------|-------------|
| 1 | Schedule Performance (S-Curve) | ovScurveChart | Line | Planned vs Actual vs Forecast progress |
| 2 | Overall Completion Gauge | ovGaugeChart | Doughnut | Actual 30.7% vs Planned 65.3% |
| 3 | Phase Progress Bars | (CSS bars) | Horizontal Bars | Engineering 42%, Procurement 28%, Construction 18% |
| 4 | Activity Status Donut | ovStatusChart | Doughnut | Complete 412, In Progress 298, Not Started 653 |
| 5 | Discipline Health Radar | ovRadarChart | Radar | Civil, Structural, MEP, Architectural, Finishes |
| 6 | Earned Value Trend | ovEvmChart | Line | PV, EV, AC in EGP Millions |
| 7 | Performance Indices | ovIndicesChart | Line | SPI declining, CPI stable, threshold 1.0 |
| 8 | Data Quality Meters | (CSS bars) | Horizontal Bars | Completeness 100%, Accuracy 98%, etc. |
| 9 | Top Delay Events | (CSS list) | List Cards | 4 highest delay events with severity |
| 10 | Contract vs Payment | (CSS bars) | Horizontal Bars | Contract 367.3M, Paid 110.3M, etc. |
| 11 | Key Milestones Timeline | (CSS timeline) | Timeline | 6 milestones with status dots |

**KPI Cards (6):** Contract Value, Actual Progress, SPI, CPI, Total Delay, Risk Score

---

## TAB 2: WBS (id="wbs")
**Purpose:** Work Breakdown Structure hierarchy and progress
**Charts to render (2 total):**

| # | Chart Name | Canvas ID | Type | Data Source |
|---|-----------|-----------|------|-------------|
| 1 | WBS Progress Distribution | wbsProgressChart | Bar | Progress % by WBS element |
| 2 | WBS Duration Breakdown | wbsDurationChart | Horizontal Bar | Duration in days by WBS |

**Additional:** WBS Hierarchy tree (CSS component showing 8 WBS levels with progress)

---

## TAB 3: ACTIVITIES (id="activities")
**Purpose:** Activity register analysis
**Charts to render (5 total):**

| # | Chart Name | Canvas ID | Type | Data Source |
|---|-----------|-----------|------|-------------|
| 1 | Status Distribution | actStatusChart | Pie | Complete, In Progress, Not Started, On Hold |
| 2 | Critical Path Activities | actCriticalChart | Doughnut | Critical Path, Near Critical, Normal Float |
| 3 | Float Distribution | actFloatChart | Bar | Activities by float range |
| 4 | Monthly Activity Completion | actMonthlyChart | Grouped Bar | Completed vs Started per month |
| 5 | Responsible Party Workload | actPartyChart | Horizontal Bar | Activities by responsible party |

---

## TAB 4: MILESTONES (id="milestones")
**Purpose:** Milestone register and schedule health
**Charts to render (3 total):**

| # | Chart Name | Canvas ID | Type | Data Source |
|---|-----------|-----------|------|-------------|
| 1 | Milestone Timeline | (CSS timeline) | Timeline | 4 milestones with status |
| 2 | Schedule Health | msHealthChart | Doughnut | On Track, Delayed, At Risk |
| 3 | Milestone Variance Trend | msVarianceChart | Line | Cumulative delay days over time |
| 4 | Milestone Type Breakdown | msTypeChart | Bar | Start, Finish, Interim counts |

---

## TAB 5: S-CURVE (id="scurve")
**Purpose:** Detailed S-curve analysis
**Charts to render (3 total):**

| # | Chart Name | Canvas ID | Type | Data Source |
|---|-----------|-----------|------|-------------|
| 1 | Master S-Curve | scMasterChart | Line | Planned, Actual, Forecast with variance band |
| 2 | S-Curve by Discipline | scDisciplineChart | Multi-Line | Civil, Structural, MEP, Arch, Finishes |
| 3 | Progress Variance Over Time | scVarianceChart | Bar | Monthly variance percentage |

---

## TAB 6: EVM ANALYSIS (id="evm")
**Purpose:** Earned Value Management deep dive
**Charts to render (4 total):**

| # | Chart Name | Canvas ID | Type | Data Source |
|---|-----------|-----------|------|-------------|
| 1 | EVM Burn-Up Chart | evmBurnupChart | Line | PV, EV, AC, EAC over time |
| 2 | EVM Variance Waterfall | evmWaterfallChart | Bar | BAC, PV, EV, AC, SV, CV, EAC, VAC |
| 3 | SPI Trend | evmSpiChart | Line | SPI with threshold line |
| 4 | CPI Trend | evmCpiChart | Line | CPI with threshold line |

**KPI Cards (6):** BAC, PV, EV, AC, SV, ETC

---

## TAB 7: CONTRACTS (id="contracts")
**Purpose:** Contract and payment intelligence
**Charts to render (4 total):**

| # | Chart Name | Canvas ID | Type | Data Source |
|---|-----------|-----------|------|-------------|
| 1 | Payment History | conPaymentChart | Bar | 8 payment periods |
| 2 | Contract Cash Flow | conCashflowChart | Line | Planned vs Actual cash out |
| 3 | Payment Status Breakdown | conStatusChart | Doughnut | Paid, Under Payment, Pending, Disputed |
| 4 | Contract vs Variations | conVariationChart | Bar | Original, Approved, Pending, Total |

**KPI Cards (6):** Contract Value, Paid Amount, Spent Amount, Remaining, Payment Rows, Retention

---

## TAB 8: RISKS (id="risks")
**Purpose:** Risk register and heatmap analysis
**Charts to render (4 total):**

| # | Chart Name | Canvas ID | Type | Data Source |
|---|-----------|-----------|------|-------------|
| 1 | Risk Heatmap | (CSS grid) | 5x5 Matrix | Probability-Impact matrix with active risks |
| 2 | Risk Category Breakdown | riskCategoryChart | Bar | Schedule, Cost, Quality, Safety, External |
| 3 | Risk Status | riskStatusChart | Doughnut | Open, Closed, Mitigated |
| 4 | Risk Trend Over Time | riskTrendChart | Line | Aggregate risk score trend |
| 5 | Mitigation Effectiveness | riskMitigationChart | Grouped Bar | Before vs After mitigation scores |

**KPI Cards (6):** Risk Score, Risk Records, High Risk, Decision Required, Delay Exposure, Mitigation

---

## TAB 9: DELAY ANALYSIS (id="delay")
**Purpose:** Time impact analysis and delay events
**Charts to render (5 total):**

| # | Chart Name | Canvas ID | Type | Data Source |
|---|-----------|-----------|------|-------------|
| 1 | Delay Events Timeline | delayTimelineChart | Bar | 7 root causes by delay days |
| 2 | Delay by Root Cause | delayCauseChart | Horizontal Bar | Pareto of delay causes |
| 3 | Delay Type Distribution | delayTypeChart | Doughnut | Excusable, Non-Excusable, Compensable, Concurrent |
| 4 | Monthly Delay Accumulation | delayAccumChart | Line | Cumulative delay over time |
| 5 | Time Impact Analysis | delayTiaChart | Line | Baseline vs Impacted vs Recovery plan |

**KPI Cards (6):** Total Delay Events, Total Delay Days, Critical Path Impact, Excusable Delay, Non-Excusable, Compensable

---

## INTEGRATION INSTRUCTIONS FOR AI AGENT

### For React/Vue/Angular Dashboard:
1. Copy the JavaScript chart initialization code from the HTML file
2. Place each tab's charts inside the corresponding tab component
3. Use the Canvas IDs to target the correct chart containers
4. Match the CSS variables to your existing theme

### For Python Backend (matplotlib):
1. Run: `python samco_charts.py --all`
2. Charts saved to `./samco_charts_output/`
3. Naming convention: `{tab}_{chart_name}.png`
4. Serve images statically or embed as base64

### Design Tokens to Match:
```css
--bg-primary: #0B1120;
--bg-card: #0F172A;
--border: rgba(255,255,255,0.06);
--text-primary: #f1f5f9;
--text-secondary: #94a3b8;
--accent-teal: #06b6d4;
--accent-green: #10b981;
--accent-red: #f43f5e;
--accent-amber: #f59e0b;
--accent-purple: #8b5cf6;
```

### Card Styling Rules:
- Background: `rgba(15, 23, 42, 0.88)` with `backdrop-filter: blur(12px)`
- Border: `1px solid rgba(255,255,255,0.06)`
- Top glow: `linear-gradient(90deg, transparent, rgba(6,182,212,0.15), transparent)`
- Border radius: `16px`
- Padding: `20px`
- Title: uppercase, 12px, 600 weight, with 3px teal accent bar
- Badge: pill shape with colored background at 12% opacity

---

## FILE REFERENCE

| File | Purpose | Size |
|------|---------|------|
| samco_dashboard_charts.html | Working HTML with all 36 Chart.js charts | ~90 KB |
| samco_charts.py | Python matplotlib generator for all charts | ~47 KB |
| This guide | AI agent assignment instructions | — |

---

Generated for: ROYA-BIG PROJECT PHASE01 (B1-4)
Dashboard URL: samcoegyptdashboard.vercel.app
