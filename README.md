# Obsidian Crypto Trader

Crypto scanner, simulator, risk plan, and AI decision-support cockpit.

## Local Setup

```bash
npm install
npm run dev
```

For Netlify functions locally, run through your Netlify dev command if that is how you normally start `localhost:8888`.

## Real AI Advisor

The real AI brief runs server-side through `netlify/functions/aiAdvisor.ts`, so your API key is not exposed in browser code.

Create a local `.env` from `.env.example`:

```bash
OPENAI_API_KEY=sk-your-key-here
OPENAI_MODEL=gpt-5.2
```

Restart the dev server after adding the key.

The app will show a setup message if `OPENAI_API_KEY` is missing. Once configured, the Simulator tab can generate:

- Daily market trend brief
- Current market/news catalysts using OpenAI web search
- Trade ideas fitted to your plan
- Portfolio review
- Simulator ticket loading from AI trade ideas

This is decision support and simulator guidance, not financial advice or guaranteed profit.
