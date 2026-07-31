# project-intelligence-hub-website — Architecture and Feature Map

## Application

- Name: **project-intelligence-hub-website**
- Version: **1.0.0**
- Root: `D:\Project Intelligence Hub NextJS\website`
- App Router detected: **Yes**
- Pages Router detected: **No**
- TypeScript configured: **Yes**
- Vercel configuration: **vercel.json detected**

## Pages and APIs

| Type | Router | Route | Methods | File |
|---|---|---|---|---|
| API | App Router | `/api/analyze-contract` | POST | `src\app\api\analyze-contract\route.ts` |
| API | App Router | `/api/analyze-delay` | POST | `src\app\api\analyze-delay\route.ts` |
| API | App Router | `/api/analyze-letters` | POST | `src\app\api\analyze-letters\route.ts` |
| API | App Router | `/api/ask-ai` | POST | `src\app\api\ask-ai\route.ts` |
| API | App Router | `/api/health/ai` | GET | `src\app\api\health\ai\route.ts` |
| API | App Router | `/api/intelligence/search` | POST | `src\app\api\intelligence\search\route.ts` |
| API | App Router | `/api/summarize-project` | POST | `src\app\api\summarize-project\route.ts` |
| API | App Router | `/api/technical-knowledge/ask` | POST | `src\app\api\technical-knowledge\ask\route.ts` |
| Page | App Router | `/../app` |  | `src\app\page.tsx` |
| Page | App Router | `/project/:projectKey` |  | `src\app\project\[projectKey]\page.tsx` |

## Components

- **MermaidDiagram** — `src\components\MermaidDiagram.tsx`
- **AiChatPanel** — `src\components\ai\AiChatPanel.tsx`
- **AiInsightCard** — `src\components\ai\AiInsightCard.tsx`
- **TechnicalKnowledgeAdvisor** — `src\components\ai\TechnicalKnowledgeAdvisor.tsx`
- **ActionTracker** — `src\components\executive\ActionTracker.tsx`
- **AdvancedAnalyticsPanel** — `src\components\executive\AdvancedAnalyticsPanel.tsx`
- **ExecutiveLightModeToggle** — `src\components\executive\ExecutiveLightModeToggle.tsx`
- **ManagementDecisionBrief** — `src\components\executive\ManagementDecisionBrief.tsx`
- **PredictiveWarningPanel** — `src\components\executive\PredictiveWarningPanel.tsx`
- **ScenarioPlanner** — `src\components\executive\ScenarioPlanner.tsx`
- **SourceConfidenceBadge** — `src\components\executive\SourceConfidenceBadge.tsx`
- **UnifiedIntelligenceSearch** — `src\components\executive\UnifiedIntelligenceSearch.tsx`

## Environment-variable names

Only names are listed. Values are never exported.

- `GROQ_API_KEY`
- `GROQ_MODEL_FALLBACK`
- `GROQ_MODEL_PRIMARY`
- `GROQ_TIMEOUT_MS`
- `VERCEL_OIDC_TOKEN`

## npm scripts

- `generate-data` → `python ../tools/generate_nextjs_website_data.py`
- `dev` → `next dev`
- `build` → `next build`
- `start` → `next start`
- `lint` → `eslint .`
