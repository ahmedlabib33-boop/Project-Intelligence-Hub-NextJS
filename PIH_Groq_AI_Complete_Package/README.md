# Project Intelligence Hub — Complete Groq AI Integration Package
# ================================================================
# Generated: 2026-07-27
# Purpose: Give this ENTIRE folder to your AI coding agent.
#          The agent reads these files and implements Groq Cloud AI for PIH.
#
# APP OVERVIEW:
#   Project Intelligence Hub is a project-controls, delay-analysis,
#   claims-intelligence, and executive-reporting system with TWO surfaces:
#     1. Next.js/Vercel website — public executive dashboard
#     2. Streamlit original app — local Python app with deep calculations
#
# CURRENT AI STATE:
#   - OpenAI gateway exists in src/construction_system but is blocked by quota
#   - No working AI for general questions, summaries, or analysis
#
# SOLUTION: Groq Cloud — free tier, no credit card, works from Vercel AND local
#
# GROQ FREE TIER:
#   - llama-3.1-8b-instant:     14,400 req/day (fast, high quota)
#   - llama-4-maverick:          1,000 req/day (Arabic support)
#   - whisper-large-v3:          2,000 req/day (STT, future use)
#   Sign up: https://console.groq.com
#
# FOLDER STRUCTURE (this package):
#   pih_complete_package/
#   ├── README.md                          ← START HERE
#   ├── 00_AI_AGENT_PROMPT.md              ← MAIN PROMPT: paste into AI agent
#   ├── 01_GROQ_SETUP.md                   ← How to get key, env vars, install
#   ├── 02_SECURITY_RULES.md               ← Security checklist
#   ├── 03_TESTING_CHECKLIST.md            ← Acceptance criteria
#   │
#   ├── nextjs/                            ← Next.js/Vercel Website Files
#   │   ├── lib_groq.ts                    ← Shared Groq client
#   │   ├── lib_project_data.ts            ← JSON data loader
#   │   ├── api_ask_ai_route.ts            ← POST /api/ask-ai
#   │   ├── api_summarize_route.ts         ← POST /api/summarize-project
#   │   ├── api_analyze_letters_route.ts   ← POST /api/analyze-letters
#   │   ├── api_analyze_contract_route.ts  ← POST /api/analyze-contract
#   │   ├── api_analyze_delay_route.ts     ← POST /api/analyze-delay
#   │   ├── api_health_ai_route.ts         ← GET /api/health/ai
#   │   ├── AiChatPanel.tsx                ← Floating chat UI
#   │   ├── AiInsightCard.tsx              ← Inline insight card
#   │   └── page_integration_example.tsx   ← How to wire into existing page
#   │
#   └── streamlit/                         ← Streamlit Python App Files
#       ├── groq_service.py                ← Unified Python service
#       └── sidebar_integration.py         ← Streamlit sidebar code
#
# HOW TO USE:
#   1. Read README.md (this file)
#   2. Read 00_AI_AGENT_PROMPT.md — this is the MAIN instruction for the agent
#   3. The agent reads the code files and implements them
#   4. Follow 01_GROQ_SETUP.md for credentials
#   5. Follow 03_TESTING_CHECKLIST.md to verify
