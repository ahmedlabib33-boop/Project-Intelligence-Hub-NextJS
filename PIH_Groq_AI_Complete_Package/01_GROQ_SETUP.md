# Groq Setup Guide for Project Intelligence Hub
# =============================================

## Step 1: Get Your Free Groq API Key

1. Open browser: https://console.groq.com
2. Click "Sign Up" (use email or Google account)
3. Verify your email
4. Go to "API Keys" in the left sidebar
5. Click "Create API Key"
6. Give it a name: "PIH-Production"
7. Copy the key (starts with `gsk_...`)
   IMPORTANT: This is the ONLY time you see the full key. Save it securely.

## Step 2: Add to Vercel (Next.js Website)

1. Go to your Vercel dashboard: https://vercel.com/dashboard
2. Select your PIH project
3. Go to **Settings** → **Environment Variables**
4. Add new variable:
   - Key: `GROQ_API_KEY`
   - Value: `gsk_your_key_here` (paste your actual key)
5. Click **Save**
6. Redeploy your project (Vercel will prompt you, or trigger manually)

## Step 3: Add to Local Streamlit

1. Open your project folder
2. Open `.env` file (create if it doesn't exist)
3. Add:
   ```
   GROQ_API_KEY=gsk_your_key_here
   AI_PROVIDER=groq
   ```
4. Make sure `.env` is in your `.gitignore` file
5. Install the Groq Python SDK:
   ```bash
   pip install groq
   ```

## Step 4: Install Next.js Dependency

```bash
cd website
npm install groq-sdk
```

## Step 5: Verify Installation

### Test Python (Streamlit):
```python
from groq import Groq
import os

client = Groq(api_key=os.environ["GROQ_API_KEY"])
response = client.chat.completions.create(
    model="llama-3.1-8b-instant",
    messages=[{"role": "user", "content": "Say hello"}],
    max_tokens=10
)
print(response.choices[0].message.content)
```

### Test Node.js (Next.js):
```javascript
import Groq from "groq-sdk";
const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
const response = await client.chat.completions.create({
  model: "llama-3.1-8b-instant",
  messages: [{ role: "user", content: "Say hello" }],
  max_tokens: 10,
});
console.log(response.choices[0].message.content);
```

## Free Tier Limits

| Model | Daily Requests | Best For |
|-------|-------------|----------|
| llama-3.1-8b-instant | 14,400 | Fast Q&A, health checks |
| llama-4-maverick | 1,000 | Arabic, complex reasoning |
| whisper-large-v3 | 2,000 | Speech-to-text (future) |

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "API key not found" | Check env var name is exactly `GROQ_API_KEY` |
| "Rate limit exceeded" | Switch to fallback model or wait 1 minute |
| "Model not found" | Check model name spelling exactly as listed |
| Arabic answers in English | Use `llama-4-maverick` model explicitly |
| Slow responses | Use `llama-3.1-8b-instant` (faster, higher quota) |
