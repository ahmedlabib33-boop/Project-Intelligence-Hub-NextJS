# SAMCO Project Intelligence Hub - Competitive and Weakness Handoff Report
Generated: 2026-07-28 15:21

## Purpose
This report is prepared so another developer, product advisor, or investor can quickly understand the SAMCO Project Intelligence Hub, where the strongest features are located, where the weaknesses exist, and what must be improved before commercial publishing.

## Executive Competitive Score
| Area | Current Level | Competitor Reference | Score | Main Location |
|---|---:|---|---:|---|
| Executive dashboards | Strong | Power BI / Procore analytics style | 80% | D:\Project Intelligence Hub NextJS\website\src\app\page.tsx |
| Multi-project portfolio view | Good | Enterprise portfolio tools stronger | 75% | D:\Project Intelligence Hub NextJS\tools\generate_nextjs_website_data.py |
| Delay Analysis / TIA | Very strong niche | Most dashboards weak here | 85% | D:\Project Intelligence Hub NextJS\src\construction_system\steel_delay_tia.py |
| Claims / contract intelligence | Strong niche | Specialized claims tools stronger | 78% | D:\Project Intelligence Hub NextJS\contract_claims_center.py |
| Letters intelligence | Strong differentiator | Many competitors do not focus here | 82% | D:\Project Intelligence Hub NextJS\src\construction_system\letters_auto_ingest.py |
| AI advisor | Promising | Needs reliability and paid provider limits | 72% | D:\Project Intelligence Hub NextJS\website\src\lib\ai |
| Mobile performance | Improving | Competitors stronger | 65% | D:\Project Intelligence Hub NextJS\website\src\app\globals.css |
| Enterprise security / permissions | Weak | Commercial SaaS much stronger | 45% | D:\Project Intelligence Hub NextJS\website\src\app |
| Data governance / audit trail | Medium-good | Needs stronger lineage and blocking workflow | 70% | D:\Project Intelligence Hub NextJS\tools\pih_data_guardrails.py |
| Product polish / commercial readiness | Medium | Needs packaging and onboarding | 68% | D:\Project Intelligence Hub NextJS\reports |

Overall internal-use score: 82/100. Commercial publishing score today: 65-70/100. Target after the improvements below: 90+/100.

## System Map and Exact Locations
| System Area | Exact Name / Location | Purpose |
|---|---|---|
| Main Next.js website | D:\Project Intelligence Hub NextJS\website | Public web app intended for Vercel deployment. |
| Decision Making Dashboard | D:\Project Intelligence Hub NextJS\website\src\app\page.tsx | Portfolio / top-management dashboard and same-page project workspace shell. |
| Project deep-link page | D:\Project Intelligence Hub NextJS\website\src\app\project\[projectKey]\page.tsx | Project route support; should remain consistent with same-page project selection. |
| Global web styling | D:\Project Intelligence Hub NextJS\website\src\app\globals.css | Main UI/UX styling, mobile layout, cards, tabs, responsive behavior. |
| Generated portfolio data | D:\Project Intelligence Hub NextJS\website\public\data\portfolio.json | Portfolio-level data consumed by the website. |
| Generated project JSON | D:\Project Intelligence Hub NextJS\website\public\data\projects\*.json | Project-isolated data files used by the website. |
| Data generator | D:\Project Intelligence Hub NextJS\tools\generate_nextjs_website_data.py | Builds portfolio.json and each project JSON from project folders. |
| Project discovery | D:\Project Intelligence Hub NextJS\src\construction_system\project_catalog.py | Discovers sectors/projects, creates standard folders, reads project metadata. |
| Project context | D:\Project Intelligence Hub NextJS\src\construction_system\project_context.py | Python-side project path and context handling. |
| AI gateway | D:\Project Intelligence Hub NextJS\website\src\lib\ai\gateway.ts | Chooses Groq/OpenAI provider and returns safe AI responses. |
| Groq provider | D:\Project Intelligence Hub NextJS\website\src\lib\ai\groq.ts | Groq chat completion integration; currently defaulted to llama-3.1-8b-instant. |
| OpenAI provider | D:\Project Intelligence Hub NextJS\website\src\lib\ai\openai.ts | OpenAI Responses API fallback; currently subject to API billing/quota. |
| AI Director prompt | D:\Project Intelligence Hub NextJS\website\src\lib\ai\samco-director.ts | Controls board-level answer structure and no-fabrication rules. |
| Unified intelligence endpoint | D:\Project Intelligence Hub NextJS\website\src\app\api\intelligence\search\route.ts | Searches project/portfolio intelligence and uses AI synthesis when configured. |
| Technical Advisor endpoint | D:\Project Intelligence Hub NextJS\website\src\app\api\technical-knowledge\ask\route.ts | Answers from technical question bank plus project/portfolio context. |
| Technical question bank | D:\Project Intelligence Hub NextJS\knowledge\technical_question_bank | Central DOCX knowledge bank and generated index. |
| Guardrails | D:\Project Intelligence Hub NextJS\tools\pih_data_guardrails.py | Flags suspicious SPI/CPI/progress/contract/letters data before dashboard trust. |
| Guardrail logs | D:\Project Intelligence Hub NextJS\12-logs\guardrail_report_latest.md | Latest data-quality findings for management and developers. |
| Auto outputs | D:\Project Intelligence Hub NextJS\src\construction_system\auto_project_outputs.py | Generates four HTML outputs per project. |
| Root HTML outputs | D:\Project Intelligence Hub NextJS\11-outputs\{ProjectName} | One folder per project with generated HTML reports. |
| Sync launcher | D:\Project Intelligence Hub NextJS\RUN_FULL_PROJECT_NO_GIT_SYNC.bat | Starts no-Git GitHub sync in Once or Watch mode. |
| Sync engine | D:\Project Intelligence Hub NextJS\tools\github_no_git_sync.ps1 | Uploads local files to GitHub using API token from environment. |
| Sync config | D:\Project Intelligence Hub NextJS\tools\github_sync_config.json | Controls target repo, branch, excludes, deletion policy, interval. |
| Validation | D:\Project Intelligence Hub NextJS\tools\validate_project_isolation.py | Checks project discovery, isolation, outputs, sync config, lineage. |
| Legacy Streamlit app | D:\Project Intelligence Hub NextJS\dashboard.py | Original Streamlit app; still useful but separate from Next.js website. |
| Claims module | D:\Project Intelligence Hub NextJS\contract_claims_center.py | Contract and claims intelligence logic used by Streamlit side. |
| Python tests | D:\Project Intelligence Hub NextJS\tests | pytest checks for analytics, letters ingestion, OpenAI gateway, project catalog. |

## Main Strengths
| Feature | Why Powerful | Exact Location |
|---|---|---|
| Folder-driven multi-project model | New sector/project folders can be detected without hardcoded registration. | D:\Project Intelligence Hub NextJS\src\construction_system\project_catalog.py |
| Portfolio JSON pipeline | The website can run on Vercel using generated JSON instead of local Windows paths. | D:\Project Intelligence Hub NextJS\tools\generate_nextjs_website_data.py |
| Delay/TIA niche capability | Construction delay analysis, fragnet thinking, evidence, concurrency and EOT logic are rare in generic dashboards. | D:\Project Intelligence Hub NextJS\src\construction_system\steel_delay_tia.py |
| Claims and letters intelligence | Connects contract, correspondence, claims and evidence workflows. | D:\Project Intelligence Hub NextJS\contract_claims_center.py; D:\Project Intelligence Hub NextJS\src\construction_system\letters_auto_ingest.py |
| AI Director | Gives structured board-level answers from app data, with no-fabrication rules. | D:\Project Intelligence Hub NextJS\website\src\lib\ai\samco-director.ts |
| Technical Knowledge Advisor | Combines central technical question bank with project/portfolio context. | D:\Project Intelligence Hub NextJS\website\src\components\ai\TechnicalKnowledgeAdvisor.tsx |
| Guardrails | Detects suspicious executive data before publishing decisions. | D:\Project Intelligence Hub NextJS\tools\pih_data_guardrails.py |
| HTML auto outputs | Each project can receive generated executive/master/SVG/linked HTML outputs. | D:\Project Intelligence Hub NextJS\11-outputs\{ProjectName} |

## Weaknesses To Improve - Exact Names and Locations
| Priority | Weakness | Why It Matters | Exact Location | Recommended Fix |
|---:|---|---|---|---|
| 1 | No enterprise authentication / permissions | A public client-facing app needs login, user roles, project-level permissions, and admin controls before paid publishing. | D:\Project Intelligence Hub NextJS\website\src\app; no dedicated auth folder found | Add NextAuth/Auth.js or Clerk. Create roles: Owner, Executive, Project Manager, Planning Engineer, Viewer. Enforce project_key access in every API route. |
| 2 | AI depends on free/on-demand Groq limits | Groq works, but heavy prompts can hit token-per-minute limits. OpenAI fallback may fail if billing/quota is unavailable. | D:\Project Intelligence Hub NextJS\website\src\lib\ai\groq.ts; D:\Project Intelligence Hub NextJS\website\src\lib\ai\openai.ts | Add paid Groq/OpenAI tier, prompt compression, caching, and provider health status in the UI. |
| 3 | Large generated JSON files | portfolio.json and project JSON are large; this can slow low-quality mobile devices and increase AI prompt size. | D:\Project Intelligence Hub NextJS\website\public\data\portfolio.json; D:\Project Intelligence Hub NextJS\website\public\data\projects\*.json | Split JSON by feature: overview, risks, letters, claims, delay, outputs. Lazy-load only the active tab. |
| 4 | Streamlit and Next.js feature duplication risk | Some capabilities exist in legacy Streamlit/Python and may not be fully mirrored in Next.js. | D:\Project Intelligence Hub NextJS\dashboard.py vs D:\Project Intelligence Hub NextJS\website\src\app\page.tsx | Create a feature parity checklist. Treat Python as data/report engine and Next.js as main UI. Avoid adding new UI features only to one side. |
| 5 | Contract Claims Center project isolation needs continuous validation | User observed same values across projects. A paid app must prove no cross-project leakage. | D:\Project Intelligence Hub NextJS\contract_claims_center.py; D:\Project Intelligence Hub NextJS\website\public\data\projects\*.json | Add tests that compare claims values for two projects and fail if identical fallback data is shown without source proof. |
| 6 | Output HTML tab behavior on mobile | Downloaded HTML tabs previously failed on mobile; reports must be tested on iOS/Android browsers. | D:\Project Intelligence Hub NextJS\src\construction_system\auto_project_outputs.py; D:\Project Intelligence Hub NextJS\11-outputs\{ProjectName}\*.html | Use hash-free button tabs with inline JS, no blocked modules/CDNs, and browser test saved HTML locally and on mobile. |
| 7 | Action tracker is not yet enterprise-persistent | Management decisions should persist with owners, due dates, status, and audit history. | D:\Project Intelligence Hub NextJS\website\src\components\executive\ActionTracker.tsx | Move from frontend/local state to database/API storage. Add project_id, user_id, created_at, updated_at, audit log. |
| 8 | Guardrails are warning-first | Warnings are useful, but dangerous values may still publish unless block mode is used. | D:\Project Intelligence Hub NextJS\tools\pih_data_guardrails.py; D:\Project Intelligence Hub NextJS\12-logs | Add BLOCK mode for publish/sync after current data issues are cleaned. Show top guardrail issues in dashboard. |
| 9 | Sync is token/API based and operationally sensitive | If token env is missing or expired, GitHub sync fails. Secrets must never be stored in repo. | D:\Project Intelligence Hub NextJS\RUN_FULL_PROJECT_NO_GIT_SYNC.bat; D:\Project Intelligence Hub NextJS\tools\github_no_git_sync.ps1 | Add Streamlit/Next visible sync status from logs, dry-run button, and clear instructions for GITHUB_TOKEN/GH_TOKEN. |
| 10 | Testing is not enough for commercial UI | Build and pytest pass, but UI visual regression, mobile, auth, and output download tests are still missing. | D:\Project Intelligence Hub NextJS\tests; D:\Project Intelligence Hub NextJS\website | Add Playwright tests for tabs, project switch, mobile viewport, AI panel, and downloaded HTML reports. |
| 11 | Some old folders/artifacts remain | Old packages and pycache can confuse maintainers and repo sync. | D:\Project Intelligence Hub NextJS\__pycache__; D:\Project Intelligence Hub NextJS\Master_Construction_Dashboard (1); D:\Project Intelligence Hub NextJS\PIH_Groq_AI_Complete_Package | Move retired packages to archive/ or delete after confirming not imported. Exclude cache/build artifacts from sync. |
| 12 | Commercial packaging not complete | To sell, the app needs demo data, onboarding, documentation, license, privacy, support process, and pricing model. | D:\Project Intelligence Hub NextJS\reports; D:\Project Intelligence Hub NextJS\website\README.md | Create client onboarding pack, deployment guide, data template guide, sales demo, and support checklist. |

## Recommended Developer Work Packages
| Work Package | Files To Touch | Acceptance Test |
|---|---|---|
| Authentication and project permissions | website/src/app, website/src/lib/auth, website/src/app/api/* | A user can only see assigned project keys; unauthorized API calls return 403. |
| JSON splitting and lazy loading | tools/generate_nextjs_website_data.py, website/src/app/page.tsx | Mobile page loads quickly and each tab fetches only its own dataset. |
| Claims isolation validation | contract_claims_center.py, tools/generate_nextjs_website_data.py, tests | Two projects with different claims data show different claims outputs and source files. |
| Mobile downloadable HTML repair | src/construction_system/auto_project_outputs.py, 11-outputs/{ProjectName}/*.html | All four HTML files have working tabs on desktop, Android, and iOS. |
| Persistent decision/action log | website/src/components/executive/ActionTracker.tsx, website/src/app/api/actions, 12-logs/actions.db or cloud DB | Actions survive browser reload and are isolated by project_id. |
| AI cost/reliability hardening | website/src/lib/ai/*, website/src/app/api/* | Groq and OpenAI fallback are visible; token-limit errors return controlled messages. |
| Guardrail block mode | tools/pih_data_guardrails.py, tools/generate_nextjs_website_data.py | Publish can be blocked only when configured and every blocked issue has project_id/source. |
| Visual QA | website/src/app/globals.css, website/src/components | Playwright screenshots pass desktop and mobile without overlap. |

## Publishing and Money Potential
The app can make money fastest as a private consulting/productized service for contractors, not as a broad public SaaS yet. Recommended commercial path: pilot internally at SAMCO, then sell project setup packages for claims, delay, executive reporting, and AI project controls. Public SaaS should wait until authentication, permissions, data isolation tests, security, onboarding, and support are production-ready.

## What Other Developers Must Not Break
- Do not bypass project_id/project_key isolation.
- Do not make Vercel read local Windows folders directly; it must use generated JSON under website/public/data.
- Do not hardcode project names, dashboard values, delay days, claims amounts, SPI, CPI, or EOT conclusions.
- Do not expose GROQ_API_KEY, OPENAI_API_KEY, GITHUB_TOKEN, or GH_TOKEN in UI, logs, generated HTML, or repo files.
- Do not remove legacy Streamlit/Python features unless a tested Next.js replacement exists.

## Minimum Validation Before Handoff
```powershell
cd /d "D:\Project Intelligence Hub NextJS\website"
npm run build
cd /d "D:\Project Intelligence Hub NextJS"
python -m pytest -q tests -p no:cacheprovider
python tools\validate_project_isolation.py
cmd /c RUN_FULL_PROJECT_NO_GIT_SYNC.bat Once 30
```

## Immediate Next Move
Make security and project isolation the next sprint. The app already has strong functionality. The fastest way to increase commercial value is to prove that every project is separated, every displayed value has source lineage, and every user has controlled access.