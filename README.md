---
title: LLM Endpoint Tester
emoji: ⚡
colorFrom: green
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
license: mit
short_description: Ping, discover models and test OpenAI-compatible APIs
---

# ⚡ LLM Endpoint Tester

Paste **any OpenAI-compatible base URL** → it pings the endpoint, auto-discovers the model list, and streams a real chat completion with TTFT / tok-s metrics. **No API key required** for keyless servers (Ollama, LM Studio, llama.cpp, vLLM, text-generation-webui).

| Feature | Detail |
| --- | --- |
| Reachability probes | `/v1/models`, `/models`, `/openai/v1/models`, `/api/tags`, `/health`, `/` in parallel — auto-resolves the real base URL |
| Latency ping | 12 timed samples, sparkline, min / avg / p95 / jitter / loss |
| Model discovery | Parses `data[]`, `models[]`, plain arrays and Ollama `name` fields |
| Batch test | Fires a 5-token prompt at up to 25 models, 3 in parallel, pass/fail per model |
| Chat playground | Official **`openai` JS SDK v5** with SSE streaming, TTFT, tok/s, token usage, finish reason, copyable `curl` |
| Two transports | **Direct** (browser → endpoint) and **Proxy** (browser → this Space → endpoint, ignores CORS) |

---

## 🚀 Deploy to Hugging Face Spaces

### Option A — Docker Space (recommended, works on the free CPU tier)

This repo is already configured for it: the frontmatter above sets `sdk: docker` + `app_port: 7860`, and `server.js` serves the built app **plus** the `/api/proxy` relay.

```bash
# 1. create the Space
hf repos create <your-username>/llm-endpoint-tester --type space --space-sdk docker

# 2. push the code (Dockerfile, server.js, src/, package.json, README.md …)
git init && git remote add space https://huggingface.co/spaces/<your-username>/llm-endpoint-tester
git add . && git commit -m "LLM endpoint tester"
git push space main
```

The build installs deps (`npm ci`, falling back to `npm install` if you haven't committed `package-lock.json`) and runs `npm run build` inside the container, then starts `node server.js` on port 7860. Nothing else to configure.

**Why Docker over Static?** The relay only exists here. Without it, browsers refuse to call endpoints that don't return `Access-Control-Allow-Origin` — which is most hosted inference APIs.

### Option B — Static Space (no relay, Direct mode only)

The Vite build inlines everything into a single `dist/index.html` (`vite-plugin-singlefile`), so a static Space works too:

```yaml
---
title: LLM Endpoint Tester
emoji: ⚡
colorFrom: green
colorTo: gray
sdk: static
app_file: dist/index.html
# app_build_command: npm run build   # optional; build Spaces have been paid-gated at times
---
```

Then commit the generated `dist/` folder. Safest path: build locally (`npm run build`) and push `dist/` so you never depend on the hosted build step.

---

## 🖥 Direct vs 🛰 Proxy mode

| | Direct | Proxy |
| --- | --- | --- |
| Path | browser → endpoint | browser → this app's server → endpoint |
| CORS | endpoint **must** send `Access-Control-Allow-Origin` | not applicable |
| Reaches `http://localhost:11434` | ✅ (only when the page itself is local/HTTP) | ❌ the relay lives on the server, not your laptop |
| Reaches `https://api.groq.com/…` | only if the vendor allows browser origins | ✅ always |
| Your API key | browser → endpoint | forwarded through the relay, never logged or stored |

The app auto-detects the relay via `GET /api/healthz` and shows `relay online / off`, then explains what will happen for the URL you typed.

### ⚠️ Testing `localhost` from a hosted Space

You generally **can't**. An HTTPS page calling `http://localhost:…` is blocked by Chrome's Private Network Access preflight and Safari's mixed-content rules. Options:

1. Run this app locally (see below) — best for local models.
2. Tunnel your server: `cloudflared tunnel --url http://localhost:11434` and paste the HTTPS URL.
3. Enable CORS on your server anyway, since Direct mode needs it:
   ```bash
   OLLAMA_ORIGINS='*' ollama serve          # Ollama
   llama-server --cors -m model.gguf        # llama.cpp
   vllm serve <model> --allowed-origins '["*"]'
   ```

---

## 🧑‍💻 Run locally

```bash
npm install
npm run dev          # Vite dev server, Direct mode only

# or the full experience with the relay:
npm run build && node server.js   # → http://localhost:7860
```

### Environment variables (server)

| Var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `7860` | HTTP port |
| `ALLOW_PRIVATE_NETWORK` | unset | Set to `1` to let the relay reach private/loopback IPs. Only do this when running on **your own** machine — on a public Space it enables SSRF. |
| `PROXY_TIMEOUT_MS` | `120000` | Upstream timeout |

---

## 🔒 Security notes

- **Keys stay client-side.** They live only in memory unless you tick *"remember key in this browser"* (off by default, `localStorage`, easy to clear). The relay forwards the `Authorization` header upstream and never persists it.
- **SSRF protection.** The relay refuses `localhost`, `*.internal`, and anything resolving to `10/172.16/192.168/127/169.254` ranges (that last one is the cloud metadata endpoint) unless `ALLOW_PRIVATE_NETWORK=1`.
- **Cookies stripped** on both directions; hop-by-hop headers removed.
- **Iframe-safe storage.** HF renders Spaces in a cross-origin iframe where Safari/Firefox throw on `localStorage`; all access is wrapped with an in-memory fallback so the app never white-screens.
- If you make the Space public, remember anyone can use your relay's bandwidth — it's stateless and keyless, but consider a private Space for team use.

## 🧱 Stack

React 19 · TypeScript · Vite 7 · Tailwind CSS 4 · `openai` SDK v5 · zero-dependency Node relay.
