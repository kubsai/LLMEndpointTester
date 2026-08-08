/**
 * Endpoint discovery + probing utilities for OpenAI-compatible APIs.
 * Everything runs in the browser, so CORS is the #1 failure mode — we detect
 * and explain it instead of showing a generic "Failed to fetch".
 */

import { DIRECT, viaProxy, type Transport } from "./transport";

export type ProbeKind = "models" | "health" | "root" | "ollama" | "chat" | "other";

export type ProbeResult = {
  id: string;
  label: string;
  url: string;
  kind: ProbeKind;
  ok: boolean;
  status: number | null;
  statusText: string;
  latencyMs: number;
  error?: string;
  hint?: string;
  bodyPreview?: string;
  json?: any;
  requiresAuth?: boolean;
};

export type DiscoveredModel = {
  id: string;
  owned_by?: string;
  created?: number;
  raw: any;
};

export const PRESETS: { name: string; url: string; note: string; key?: string }[] = [
  { name: "Ollama (local)", url: "http://localhost:11434/v1", note: "No key needed" },
  { name: "LM Studio", url: "http://localhost:1234/v1", note: "No key needed" },
  { name: "llama.cpp server", url: "http://localhost:8080/v1", note: "No key needed" },
  { name: "vLLM", url: "http://localhost:8000/v1", note: "No key needed" },
  { name: "text-gen-webui", url: "http://127.0.0.1:5000/v1", note: "No key needed" },
  { name: "OpenAI", url: "https://api.openai.com/v1", note: "Key required" },
  { name: "OpenRouter", url: "https://openrouter.ai/api/v1", note: "Models list is public" },
  { name: "Groq", url: "https://api.groq.com/openai/v1", note: "Key required" },
  { name: "Together AI", url: "https://api.together.xyz/v1", note: "Key required" },
  { name: "DeepSeek", url: "https://api.deepseek.com/v1", note: "Key required" },
  { name: "Mistral", url: "https://api.mistral.ai/v1", note: "Key required" },
  { name: "Hugging Face", url: "https://router.huggingface.co/v1", note: "Key required" },
];

const STRIP_SUFFIXES = [
  "/chat/completions",
  "/completions",
  "/responses",
  "/models",
  "/embeddings",
  "/api/tags",
];

/** Turn whatever the user pasted into a usable base URL. */
export function normalizeEndpoint(raw: string): string {
  let v = (raw || "").trim();
  if (!v) return "";
  v = v.replace(/[?#].*$/, "");
  if (!/^https?:\/\//i.test(v)) {
    const local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|192\.168\.|10\.)/i.test(v);
    v = (local ? "http://" : "https://") + v;
  }
  v = v.replace(/\/+$/, "");
  for (const s of STRIP_SUFFIXES) {
    if (v.toLowerCase().endsWith(s)) {
      v = v.slice(0, -s.length).replace(/\/+$/, "");
      break;
    }
  }
  return v;
}

/** Candidate base URLs to try, in priority order. */
export function candidateBases(base: string): string[] {
  const out: string[] = [];
  const push = (u: string) => {
    const c = u.replace(/\/+$/, "");
    if (c && !out.includes(c)) out.push(c);
  };
  if (/\/v\d+$/i.test(base)) {
    push(base);
    push(base.replace(/\/v\d+$/i, ""));
  } else {
    push(base + "/v1");
    push(base);
    push(base + "/openai/v1");
    push(base + "/api/v1");
  }
  return out;
}

export function authHeaders(apiKey: string): Record<string, string> {
  const k = apiKey.trim();
  if (!k) return {};
  return { Authorization: `Bearer ${k}`, "api-key": k };
}

/**
 * Chat-completions specific candidates, most-standard-first. Most OpenAI-compatible
 * gateways only implement the `/v1/...` path — plain `/chat/completions` (no version)
 * is comparatively rare, so it must never be tried before `/v1/chat/completions`.
 */
export function chatCompletionsCandidates(rootOrBase: string): string[] {
  const root = rootOrBase.replace(/\/v\d+$/i, "").replace(/\/+$/, "");
  const out: string[] = [];
  const push = (u: string) => {
    if (!out.includes(u)) out.push(u);
  };
  // If the user's input already carried an explicit version segment, respect it first.
  if (/\/v\d+$/i.test(rootOrBase)) push(`${rootOrBase.replace(/\/+$/, "")}/chat/completions`);
  push(`${root}/v1/chat/completions`);
  push(`${root}/chat/completions`);
  push(`${root}/openai/v1/chat/completions`);
  push(`${root}/api/v1/chat/completions`);
  return out;
}

export function chatUrlToBase(url: string): string {
  return url.replace(/\/chat\/completions\/?$/i, "");
}

export type FetchOutcome = {
  ok: boolean;
  status: number | null;
  statusText: string;
  latencyMs: number;
  text: string;
  json: any;
  error?: string;
  hint?: string;
};

export async function timedFetch(
  url: string,
  opts: RequestInit = {},
  timeoutMs = 12000,
  transport: Transport = DIRECT,
): Promise<FetchOutcome> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = performance.now();
  try {
    const res = await fetch(viaProxy(url, transport), { ...opts, signal: ctrl.signal, mode: "cors" });
    const latencyMs = Math.round(performance.now() - t0);
    let text = "";
    try {
      text = await res.text();
    } catch {
      /* ignore */
    }
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not json */
    }
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText || "",
      latencyMs,
      text,
      json,
    };
  } catch (e: any) {
    const latencyMs = Math.round(performance.now() - t0);
    const aborted = e?.name === "AbortError";
    const msg = aborted ? `Timed out after ${timeoutMs} ms` : e?.message || String(e);
    return {
      ok: false,
      status: null,
      statusText: "",
      latencyMs,
      text: "",
      json: null,
      error: msg,
      hint: aborted
        ? "The server never answered. Check the host/port, or that the service is running."
        : explainNetworkError(url),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function explainNetworkError(url: string): string {
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(url);
  const pageHttps = typeof location !== "undefined" && location.protocol === "https:";
  if (isLocal && pageHttps) {
    return "Browser blocked a http://localhost call from an https:// page (mixed content) or the server has no CORS headers. Start the server with CORS enabled, e.g. OLLAMA_ORIGINS='*' ollama serve.";
  }
  if (isLocal) {
    return "Could not reach the local server. Make sure it is running and allows cross-origin requests (Ollama: OLLAMA_ORIGINS=*, llama.cpp: --cors, vLLM: --allowed-origins '[\"*\"]').";
  }
  return "Blocked by CORS or the host is unreachable. The API likely works fine from a server/CLI — switch to Proxy mode (top-right) to relay the request through this app's server and skip CORS entirely.";
}

export function describeStatus(status: number | null): { label: string; tone: "good" | "warn" | "bad" } {
  if (status === null) return { label: "no response", tone: "bad" };
  if (status >= 200 && status < 300) return { label: "reachable", tone: "good" };
  if (status === 401 || status === 403) return { label: "alive · auth required", tone: "warn" };
  if (status === 404) return { label: "not found", tone: "bad" };
  if (status === 429) return { label: "alive · rate limited", tone: "warn" };
  if (status >= 500) return { label: "server error", tone: "bad" };
  return { label: `HTTP ${status}`, tone: "warn" };
}

/** Pull a model list out of any of the common response shapes. */
export function extractModels(json: any): DiscoveredModel[] {
  if (!json) return [];
  const arr =
    (Array.isArray(json) && json) ||
    (Array.isArray(json.data) && json.data) ||
    (Array.isArray(json.models) && json.models) ||
    (Array.isArray(json.result) && json.result) ||
    [];
  return arr
    .map((m: any) => {
      if (typeof m === "string") return { id: m, raw: m };
      const id = m?.id || m?.name || m?.model || m?.slug;
      if (!id) return null;
      return {
        id: String(id),
        owned_by: m?.owned_by || m?.organization || m?.details?.family,
        created: m?.created,
        raw: m,
      };
    })
    .filter(Boolean) as DiscoveredModel[];
}

export type ScanReport = {
  base: string;
  probes: ProbeResult[];
  chatProbes: ProbeResult[];
  workingBase: string | null;
  /** Base URL to use specifically for /chat/completions — defaults to the /v1 path. */
  chatBase: string | null;
  models: DiscoveredModel[];
  needsKey: boolean;
  corsBlocked: boolean;
  bestLatency: number | null;
};

/**
 * Sends a deliberately-invalid chat.completions POST (fake model, 1 token) to see
 * whether the *route itself* exists. A 404 means "wrong path" — everything else
 * (400 bad model, 401/403 auth, 422, 429, even 500) proves the route is real.
 */
async function verifyChatRoute(
  url: string,
  apiKey: string,
  transport: Transport,
): Promise<{ status: number | null; latencyMs: number; error?: string; hint?: string }> {
  const headers = { "Content-Type": "application/json", Accept: "application/json", ...authHeaders(apiKey) };
  const body = JSON.stringify({
    model: "___endpoint-tester-probe___",
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 1,
  });
  const r = await timedFetch(url, { method: "POST", headers, body }, 8000, transport);
  return { status: r.status, latencyMs: r.latencyMs, error: r.error, hint: r.hint };
}

/** Probe a set of well-known paths and figure out which base URL actually works. */
export async function scanEndpoint(
  rawInput: string,
  apiKey: string,
  onProbe?: (p: ProbeResult) => void,
  transport: Transport = DIRECT,
): Promise<ScanReport> {
  const base = normalizeEndpoint(rawInput);
  const bases = candidateBases(base);
  const root = base.replace(/\/v\d+$/i, "");
  const headers = { Accept: "application/json", ...authHeaders(apiKey) };

  const targets: { url: string; label: string; kind: ProbeKind }[] = [];
  for (const b of bases) targets.push({ url: `${b}/models`, label: `GET ${b}/models`, kind: "models" });
  targets.push({ url: `${root}/api/tags`, label: `GET ${root}/api/tags (Ollama)`, kind: "ollama" });
  targets.push({ url: `${root}/health`, label: `GET ${root}/health`, kind: "health" });
  targets.push({ url: `${root}/`, label: `GET ${root}/`, kind: "root" });

  const probes: ProbeResult[] = [];
  const results = await Promise.all(
    targets.map(async (t, i) => {
      const r = await timedFetch(t.url, { method: "GET", headers }, 10000, transport);
      const models = t.kind === "models" || t.kind === "ollama" ? extractModels(r.json) : [];
      const p: ProbeResult = {
        id: `${i}-${t.url}`,
        label: t.label,
        url: t.url,
        kind: t.kind,
        ok: r.ok,
        status: r.status,
        statusText: r.statusText,
        latencyMs: r.latencyMs,
        error: r.error,
        hint: r.hint,
        requiresAuth: r.status === 401 || r.status === 403,
        bodyPreview: r.text ? r.text.slice(0, 400) : undefined,
        json: r.json,
      };
      (p as any)._models = models;
      onProbe?.(p);
      return p;
    }),
  );
  probes.push(...results);

  const modelProbe = results.find(
    (p) => (p.kind === "models" || p.kind === "ollama") && p.ok && ((p as any)._models?.length ?? 0) > 0,
  );
  const anyOkModels = results.find((p) => p.kind === "models" && p.ok);
  const authProbe = results.find((p) => p.kind === "models" && p.requiresAuth);

  let workingBase: string | null = null;
  if (modelProbe && modelProbe.kind === "models") workingBase = modelProbe.url.replace(/\/models$/, "");
  else if (anyOkModels) workingBase = anyOkModels.url.replace(/\/models$/, "");
  else if (authProbe) workingBase = authProbe.url.replace(/\/models$/, "");
  else if (modelProbe && modelProbe.kind === "ollama") workingBase = `${root}/v1`;

  const models = modelProbe ? ((modelProbe as any)._models as DiscoveredModel[]) : [];
  const reachable = results.filter((p) => p.status !== null);
  const bestLatency = reachable.length ? Math.min(...reachable.map((p) => p.latencyMs)) : null;

  // Verify the actual /chat/completions route independently of /models — a gateway can
  // expose one without the other, and defaulting to whichever base answered /models first
  // (which might be the bare, un-versioned domain) is exactly what causes "worked for some
  // endpoints, 404s on others". /v1/chat/completions is tried first, always.
  const chatTargets = chatCompletionsCandidates(base);
  const chatResults = await Promise.all(
    chatTargets.map(async (url, i) => {
      const r = await verifyChatRoute(url, apiKey, transport);
      const status = r.status;
      const notFound = status === 404;
      const p: ProbeResult = {
        id: `chat-${i}-${url}`,
        label: `POST ${url}`,
        url,
        kind: "chat",
        ok: status !== null && !notFound,
        status,
        statusText: "",
        latencyMs: r.latencyMs,
        error: r.error,
        hint: notFound ? "Route not found at this path." : r.hint,
        requiresAuth: status === 401 || status === 403,
      };
      onProbe?.(p);
      return p;
    }),
  );
  probes.push(...chatResults);

  const chatHit = chatResults.find((p) => p.ok);
  const chatBase = chatHit ? chatUrlToBase(chatHit.url) : workingBase;

  return {
    base,
    probes: results,
    chatProbes: chatResults,
    workingBase,
    chatBase,
    models: dedupeModels(models),
    needsKey: !!authProbe && !modelProbe,
    corsBlocked: reachable.length === 0 && chatResults.every((p) => p.status === null),
    bestLatency,
  };
}

function dedupeModels(models: DiscoveredModel[]): DiscoveredModel[] {
  const seen = new Set<string>();
  const out: DiscoveredModel[] = [];
  for (const m of models) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Repeated latency samples against the healthiest URL we found. */
export async function pingSeries(
  url: string,
  apiKey: string,
  count: number,
  onSample: (ms: number | null, i: number) => void,
  transport: Transport = DIRECT,
): Promise<void> {
  const headers = { Accept: "application/json", ...authHeaders(apiKey) };
  for (let i = 0; i < count; i++) {
    const r = await timedFetch(
      `${url}${url.includes("?") ? "&" : "?"}_t=${Date.now()}`,
      { method: "GET", headers },
      8000,
      transport,
    );
    onSample(r.status === null ? null : r.latencyMs, i);
    await new Promise((res) => setTimeout(res, 250));
  }
}

export function stats(samples: number[]) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = samples.reduce((a, b) => a + b, 0);
  const avg = sum / samples.length;
  const jitter =
    samples.length > 1
      ? Math.sqrt(samples.reduce((a, b) => a + (b - avg) ** 2, 0) / (samples.length - 1))
      : 0;
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: Math.round(avg),
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    jitter: Math.round(jitter),
    count: samples.length,
  };
}
