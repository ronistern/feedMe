# FeedMe Today

Funny family meal board for kids and parents.

## Local run

```powershell
$env:OPENAI_API_KEY="your_key_here"
node server.js
```

Open `http://127.0.0.1:3000`.

If `OPENAI_API_KEY` is missing, the app still works and uses built-in joke fallbacks.

## Deploy to Render

This repo includes a `render.yaml` Blueprint config for a free Node web service.

Required environment variable:

- `OPENAI_API_KEY`

Optional environment variable:

- `OPENAI_MODEL` default is `gpt-5`

## Notes

- Render free web services may spin down after idle time, so the first request can be slow.
- Do not commit secrets such as `.env` files or API keys.
