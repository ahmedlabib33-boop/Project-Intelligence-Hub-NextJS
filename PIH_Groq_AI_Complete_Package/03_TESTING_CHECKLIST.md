# Testing Checklist for PIH AI Integration
# ========================================

## Pre-Deployment Tests (Local)

### Next.js API Routes
```bash
# 1. Health check
curl http://localhost:3000/api/health/ai
# Expected: {"providers":[{"name":"groq","available":true,"latency_ms":...}]}

# 2. Ask AI - portfolio level
curl -X POST http://localhost:3000/api/ask-ai   -H "Content-Type: application/json"   -d '{"question": "How many projects are in the portfolio?"}'
# Expected: JSON with answer, provider="groq", model, status="success"

# 3. Ask AI - project level
curl -X POST http://localhost:3000/api/ask-ai   -H "Content-Type: application/json"   -d '{"question": "What is the SPI?", "projectId": "suez-tunnel"}'
# Expected: JSON with answer referencing project data

# 4. Ask AI - Arabic
curl -X POST http://localhost:3000/api/ask-ai   -H "Content-Type: application/json"   -d '{"question": "ما هي المشاريع المتأخرة؟"}'
# Expected: Arabic answer

# 5. Summarize project
curl -X POST http://localhost:3000/api/summarize-project   -H "Content-Type: application/json"   -d '{"projectId": "sophia-mall"}'
# Expected: JSON with summary, actions[], risks[], health

# 6. Analyze letters
curl -X POST http://localhost:3000/api/analyze-letters   -H "Content-Type: application/json"   -d '{"projectId": "roya-big-project"}'
# Expected: JSON with themes, criticalLetters, actionItems, deadlines

# 7. Analyze contract
curl -X POST http://localhost:3000/api/analyze-contract   -H "Content-Type: application/json"   -d '{"projectId": "suez-tunnel", "clauseQuery": "FIDIC clause 20.1"}'
# Expected: JSON with summary, keyClauses, claimExposure, recommendations

# 8. Analyze delay
curl -X POST http://localhost:3000/api/analyze-delay   -H "Content-Type: application/json"   -d '{"projectId": "lmd-bridge"}'
# Expected: JSON with delayEvents, criticalPathImpact, recoveryOptions, riskExposure
```

### Streamlit Tests
```python
# In a Python shell or Jupyter:
from src.construction_system.groq_service import *

# 1. Health check
print(check_groq_health())
# Expected: {"available": True, "latency_ms": ..., "model": "llama-3.1-8b-instant"}

# 2. Ask AI
result = ask_ai("What is EVM?")
print(result.answer)
print(result.provider, result.model, result.status)
# Expected: answer text, provider="groq", status="success"

# 3. Summarize project
summary = summarize_project({"project_name": "Test", "spi": 0.8, "cpi": 0.9})
print(summary.summary, summary.health)
# Expected: summary text, health="Yellow" or "Red"

# 4. Analyze letters
letters = analyze_letters(letters_summary={"count": 5, "recent": ["Claim notice", "Extension request"]})
print(letters.themes)
# Expected: list of themes

# 5. Fallback test (temporarily rename GROQ_API_KEY)
# Expected: graceful fallback with status="error" and friendly message
```

## Post-Deployment Tests (Vercel)

Replace `http://localhost:3000` with your Vercel URL and run all API tests again.

### UI Tests
- [ ] AiChatPanel opens/closes on button click
- [ ] Typing indicator shows while loading
- [ ] Provider badge shows "groq" and model name
- [ ] Arabic questions produce Arabic answers
- [ ] Offline state shows red dot when Groq unavailable
- [ ] "Verify before acting" disclaimer visible
- [ ] AiInsightCard loads on Overview tab
- [ ] AiInsightCard refresh button works

## Security Tests
- [ ] API response does NOT contain gsk_ or any API key
- [ ] Log files do NOT contain API key
- [ ] .env file is in .gitignore
- [ ] Rate limiting works (send 15 rapid requests, expect 429)
- [ ] AI cannot modify project data via API

## Acceptance Criteria
- [ ] All 6 API endpoints respond correctly
- [ ] AiChatPanel functional on dashboard
- [ ] AiInsightCard on Overview, Risk, Delay tabs
- [ ] Streamlit sidebar AI section works
- [ ] Arabic input produces Arabic output
- [ ] Graceful fallback when Groq unavailable
- [ ] No API keys exposed anywhere
- [ ] "Verify before acting" on all AI outputs
- [ ] AI is read-only on website
- [ ] AI drafts in Streamlit require human approval
