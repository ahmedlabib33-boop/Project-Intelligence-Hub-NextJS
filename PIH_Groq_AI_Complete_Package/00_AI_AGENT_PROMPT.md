# PROJECT INTELLIGENCE HUB — AI AGENT IMPLEMENTATION PROMPT
# ================================================================
# Paste this ENTIRE file into your AI coding agent (Cursor, Copilot, etc.)
# This is the MASTER instruction. The agent must read ALL files in this package
# and implement Groq Cloud AI for the Project Intelligence Hub application.
#
# APP CONTEXT:
#   Project Intelligence Hub (PIH) is a project-controls, delay-analysis,
#   claims-intelligence, and executive-reporting system.
#   It has TWO working surfaces:
#     1. Next.js/Vercel website — public executive dashboard
#     2. Streamlit original app — local Python app with deep calculations
#
#   Current AI: OpenAI gateway in src/construction_system is BLOCKED by quota.
#   No working AI for general questions, summaries, or analysis.
#
#   Solution: Groq Cloud — free tier, no credit card, works from Vercel and local.
#
#   Target users: SAMCO executives, project managers, claims managers, delay analysts
#   Languages: English primary, Arabic (Egyptian) for correspondence and claims
#
#   Project data lives in: projects/{Sector}/{Project}/
#   Website JSON outputs: website/public/data/portfolio.json and projects/*.json
#   Streamlit reads directly from project folders and Excel/CSV/SQLite.
#
# GROQ DETAILS:
#   - Signup: https://console.groq.com
#   - Free tier:
#       llama-3.1-8b-instant:     14,400 req/day (fast, high quota)
#       llama-4-maverick:          1,000 req/day (Arabic + multilingual support)
#       whisper-large-v3:          2,000 req/day (STT, for future use)
#   - API key: starts with gsk_...
#   - Python SDK: pip install groq
#   - Node SDK: npm install groq-sdk
#
# ================================================================
# PART 1: NEXT.JS WEBSITE (VERCEL)
# ================================================================
#
# Create these files in the website/ folder:
#
# A. website/lib/groq.ts
#    - Export groq client initialized with process.env.GROQ_API_KEY
#    - Export GROQ_MODEL_PRIMARY and GROQ_MODEL_FALLBACK constants
#    - Export askGroq() helper function that:
#        * Takes systemPrompt, userPrompt, optional model
#        * Tries primary model first, falls back to fallback model on 429
#        * Returns { answer, provider, model, status, error? }
#        * Handles missing key gracefully
#
# B. website/lib/project-data.ts
#    - getProjectData(projectId): reads website/public/data/projects/{projectId}.json
#    - getPortfolioData(): reads website/public/data/portfolio.json
#    - Both return parsed JSON or null
#
# C. website/app/api/ask-ai/route.ts
#    - POST handler
#    - Body: { question: string, projectId?: string, sector?: string }
#    - If projectId: load project JSON, build context string with:
#        project name, status, progress%, SPI, CPI, contract value,
#        decisions required, risk count, letter count
#    - If no projectId: load portfolio.json, build portfolio context
#    - System prompt: Executive Project Intelligence Analyst
#    - Call askGroq() with context + question
#    - Return JSON: { answer, provider, model, status }
#    - Rate limit: max 10 requests per minute (use simple in-memory or middleware)
#
# D. website/app/api/summarize-project/route.ts
#    - POST handler, body: { projectId: string }
#    - Load project data, send to Groq with structured JSON prompt
#    - Expected output keys: summary, actions[], risks[], health (Green/Yellow/Red)
#    - Parse JSON response, return structured object
#    - Cache result for 5 minutes
#
# E. website/app/api/analyze-letters/route.ts
#    - POST handler, body: { projectId: string }
#    - Load letters data from project JSON
#    - Send to Groq with Letters Intelligence Analyst prompt
#    - Expected output: themes[], criticalLetters[], actionItems[], deadlines[]
#    - If no letters data, return friendly "No letters detected"
#
# F. website/app/api/analyze-contract/route.ts
#    - POST handler, body: { projectId: string, clauseQuery?: string }
#    - Load contract data from project JSON
#    - If clauseQuery provided, include in prompt
#    - Expected output: summary, keyClauses[], claimExposure, recommendations[]
#
# G. website/app/api/analyze-delay/route.ts
#    - POST handler, body: { projectId: string }
#    - Load delay/TIA data from project JSON
#    - Expected output: delayEvents[], criticalPathImpact, recoveryOptions[], riskExposure
#
# H. website/app/api/health/ai/route.ts
#    - GET handler
#    - Make tiny Groq chat completion ("say ok")
#    - Return: { providers: [{ name, available, latency_ms?, model?, error? }] }
#    - NEVER expose API key
#
# I. website/components/AiChatPanel.tsx
#    - Floating chat panel (bottom-right) on dashboard
#    - Collapsible, mobile-friendly
#    - Shows AI status badge (online/offline) with green/red dot
#    - User can ask questions about selected project or portfolio
#    - Shows typing indicator, provider/model metadata on assistant messages
#    - "AI-generated — verify before acting" disclaimer at bottom
#    - Arabic input supported (Groq handles it)
#    - Uses /api/ask-ai endpoint
#
# J. website/components/AiInsightCard.tsx
#    - Inline card for Overview, Risk Matrix, Delay Analysis tabs
#    - Auto-fetches insight on page load (calls summarize or analyze API)
#    - Shows: "AI Insight: Based on current data..."
#    - Refresh button to regenerate
#    - Loading skeleton state
#
# K. Wire into existing pages
#    - Add <AiChatPanel projectId={selectedProjectId} sector={selectedSector} />
#      to the Decision Making Dashboard layout
#    - Add <AiInsightCard type="summary" projectId={selectedProjectId} />
#      to Overview tab
#    - Add <AiInsightCard type="risk" projectId={selectedProjectId} />
#      to Risk Matrix tab
#    - Add <AiInsightCard type="delay" projectId={selectedProjectId} />
#      to Delay Analysis tab
#
# ================================================================
# PART 2: STREAMLIT APP (PYTHON)
# ================================================================
#
# Create this file:
#
# A. src/construction_system/groq_service.py
#    - Unified Python service with these functions:
#        ask_ai(question, project_context=None) -> AiResult
#        summarize_project(project_data: dict) -> ProjectSummary
#        analyze_letters(letters_df=None, letters_summary=None) -> LettersAnalysis
#        analyze_contracts(contract_data=None, clause_query="") -> ContractAnalysis
#        analyze_delays(delay_data=None, tia_df=None) -> DelayAnalysis
#        draft_claim_rebuttal(claim_data: dict) -> AiResult
#        check_groq_health() -> dict
#    - All functions return dataclass objects with answer/provider/model/status
#    - All functions gracefully fallback to rule-based if Groq unavailable
#    - Uses Groq Python SDK
#    - Models: primary=llama-4-maverick, fallback=llama-3.1-8b-instant
#    - Temperature 0.2-0.3 for factual PMO tasks
#    - Max tokens 2048-4096 depending on task
#    - JSON mode (response_format={"type": "json_object"}) for structured outputs
#
# B. Modify dashboard.py
#    - Add AI sidebar section with:
#        * Groq health status indicator
#        * Text input for questions
#        * Buttons: "Ask AI", "Summarize Project", "Analyze Letters",
#                   "Analyze Contract", "Analyze Delays", "Draft Rebuttal"
#        * Output in expandable st.expander containers
#        * Show provider/model metadata
#        * "Verify before acting" warning on all outputs
#    - Pass current project data as context to ask_ai()
#
# ================================================================
# PART 3: SYSTEM PROMPTS (USE EXACTLY AS WRITTEN)
# ================================================================
#
# Executive Project Analyst (for Ask AI):
# "You are SAMCO's Executive Project Intelligence Analyst. You analyze
# construction project data including EVM (SPI, CPI), delays, risks, contracts,
# and correspondence. Answer concisely in executive language. If data is
# insufficient, say so honestly. Always cite the data source in your reasoning."
#
# Project Summary Generator:
# "You are SAMCO's Executive Project Intelligence Analyst. Given project data,
# generate a structured executive summary. Respond in JSON with keys: summary,
# actions, risks, health. health must be one of: Green, Yellow, Red.
# Output ONLY valid JSON."
#
# Letters Intelligence Analyst:
# "You are a construction claims correspondence analyst. Review project letters
# and identify: claim-critical correspondence, missing responses, action items,
# and deadline risks. Flag any letter that may trigger notice requirements or
# time-bar clauses. Respond in JSON with keys: themes, criticalLetters,
# actionItems, deadlines. Output ONLY valid JSON."
#
# Contract & Claims Analyst:
# "You are a FIDIC and construction contract specialist. Analyze contract
# clauses, identify claim entitlement, suggest evidence requirements, and draft
# professional rebuttal language. Be precise and reference clause numbers when
# available. Respond in JSON with keys: summary, keyClauses, claimExposure,
# recommendations. Output ONLY valid JSON."
#
# Delay Analyst:
# "You are a construction delay analyst specializing in Time Impact Analysis
# (TIA). Review delay events, assess critical path impact, and recommend
# recovery schedules or acceleration options. Respond in JSON with keys:
# delayEvents, criticalPathImpact, recoveryOptions, riskExposure.
# Output ONLY valid JSON."
#
# Claim Rebuttal Drafter:
# "You are a FIDIC contract specialist drafting a professional claim rebuttal.
# Draft a formal response to the following claim. Be precise, reference
# applicable clauses, and maintain professional tone."
#
# ================================================================
# PART 4: SECURITY RULES (MANDATORY)
# ================================================================
#
# - NEVER hardcode GROQ_API_KEY in any source file
# - NEVER log API keys
# - NEVER return API keys in any API response
# - NEVER send full contract text or confidential claim details to AI
#   without explicit user confirmation (show warning dialog)
# - Sanitize all user inputs before sending to API
# - For Vercel: GROQ_API_KEY in Environment Variables only
# - For Streamlit: GROQ_API_KEY in .env file (gitignored) only
# - Show "AI-generated — verify before acting" on every AI output
# - AI is READ-ONLY on the website. Never let AI modify project data.
# - In Streamlit, AI can generate drafts but human approval required before saving.
#
# ================================================================
# PART 5: ERROR HANDLING
# ================================================================
#
# - Groq rate limit (429): wait 2s, retry with fallback model, then degrade
# - Groq timeout: retry once, then degrade
# - Network error: degrade to fallback immediately
# - Missing GROQ_API_KEY: return friendly "AI not configured" message
# - Project data not found: return "Select a project first"
# - All errors logged but sanitized before user-facing messages
#
# ================================================================
# PART 6: ACCEPTANCE CRITERIA
# ================================================================
#
# - [ ] /api/ask-ai returns accurate answers about project data
# - [ ] /api/summarize-project generates coherent executive summaries
# - [ ] /api/analyze-letters extracts themes and action items
# - [ ] /api/analyze-contract provides clause insights
# - [ ] /api/analyze-delay summarizes delay impact
# - [ ] AiChatPanel works on Decision Making Dashboard
# - [ ] AiInsightCard appears on Overview, Risk, and Delay tabs
# - [ ] Streamlit AI sidebar answers project questions
# - [ ] Arabic questions return Arabic answers
# - [ ] No API keys exposed anywhere in code, logs, or responses
# - [ ] Graceful fallback when Groq unavailable
# - [ ] All tests use mocked Groq (no real API calls in tests)
# - [ ] "Verify before acting" disclaimer visible on all AI outputs
# - [ ] AI is read-only on website, draft-only in Streamlit
