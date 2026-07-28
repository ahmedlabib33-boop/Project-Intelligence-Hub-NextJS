# Security Rules for PIH AI Integration
# =====================================

## ABSOLUTE RULES (Never Break These)

1. NEVER hardcode GROQ_API_KEY in any source file
   - Use process.env.GROQ_API_KEY (Next.js)
   - Use os.environ.get("GROQ_API_KEY") (Python)

2. NEVER log API keys
   - Sanitize logs: replace gsk_... with [REDACTED]
   - No stack traces containing the key

3. NEVER return API keys in API responses
   - Health check returns: available, latency, model name
   - Never returns: key, partial key, or key hash

4. NEVER commit .env files
   - .env must be in .gitignore
   - Add .env.example with placeholder values for documentation

5. NEVER send full contract text to AI without user confirmation
   - Show dialog: "This will send contract data to Groq Cloud. Confirm?"
   - Only send after explicit user action

## Input Sanitization

- Strip HTML/JS from user questions before sending to API
- Limit question length to 2000 characters
- Reject questions containing code injection patterns
- Log suspicious inputs (without sending to AI)

## Rate Limiting

- Next.js: Use Vercel's built-in rate limiting or simple middleware
- Maximum 10 requests per minute per IP for /api/ask-ai
- Maximum 5 requests per minute per IP for structured endpoints
- Return 429 with Retry-After header if exceeded

## Data Isolation

- AI is READ-ONLY on the website
- AI never modifies project JSON files
- AI never writes to project folders
- Streamlit AI generates drafts only — human approval required before saving
- Show "AI-generated — verify before acting" on every output

## Environment Separation

| Environment | Key Source | Key Scope |
|-------------|-----------|-----------|
| Local dev | .env file | Developer only |
| Vercel prod | Environment Variables | Deployment only |
| Vercel preview | Environment Variables | Preview deployments |
| Streamlit local | .env file | Local only |
| Streamlit server | Streamlit secrets | Server only |

## Audit Trail

- Log all AI requests (question length, endpoint, model used, status)
- Never log the actual question content if it contains sensitive data
- Log: timestamp, endpoint, model, status, latency
