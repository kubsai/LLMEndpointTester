import OpenAI from "openai";
import { authHeaders, chatUrlToBase, explainNetworkError } from "./probe";
import { DIRECT, viaProxy, type Transport } from "./transport";

/**
 * When a (possibly user-edited) chat-completions URL still ends in the standard
 * `/chat/completions` suffix, we can route it through the OpenAI SDK by handing
 * it the base URL — same request, but we get SDK parsing/retry semantics for free.
 * Anything else (custom path, different suffix, extra segment) falls back to a
 * plain fetch that hits the URL byte-for-byte.
 */
export function deriveSdkBase(url: string): string | null {
  if (!/\/chat\/completions\/?(\?.*)?$/i.test(url)) return null;
  return chatUrlToBase(url.replace(/\?.*$/, ""));
}

export type ChatTestResult = {
  model: string;
  ok: boolean;
  status?: number | null;
  text: string;
  error?: string;
  hint?: string;
  ttftMs: number | null;
  totalMs: number;
  chunks: number;
  tokensPerSec: number | null;
  usage?: { prompt?: number; completion?: number; total?: number };
  finishReason?: string | null;
  transport: "sdk-stream" | "sdk-json" | "raw-stream" | "raw-json";
  requestBody: any;
  url?: string;
};

/** The SDK requires a non-empty key; keyless servers ignore it. */
export const PLACEHOLDER_KEY = "sk-no-key-required";

export function makeClient(baseURL: string, apiKey: string, transport: Transport = DIRECT) {
  const proxied = transport.mode === "proxy" && transport.proxyBase;
  return new OpenAI({
    // In proxy mode the SDK talks to our own relay; the real target travels
    // in the x-target-base header and the relay re-appends the SDK's path.
    baseURL: proxied ? transport.proxyBase! : baseURL,
    apiKey: apiKey.trim() || PLACEHOLDER_KEY,
    dangerouslyAllowBrowser: true,
    maxRetries: 0,
    defaultHeaders: {
      "HTTP-Referer": typeof location !== "undefined" ? location.origin : "",
      "X-Title": "LLM Endpoint Tester",
      ...(proxied ? { "x-target-base": baseURL } : {}),
    },
  });
}

export type ChatOptions = {
  baseURL: string;
  apiKey: string;
  model: string;
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  stream: boolean;
  timeoutMs?: number;
  transport?: Transport;
  onDelta?: (chunk: string) => void;
};

export async function runChatTest(opts: ChatOptions): Promise<ChatTestResult> {
  const client = makeClient(opts.baseURL, opts.apiKey, opts.transport ?? DIRECT);
  const messages: any[] = [];
  if (opts.system?.trim()) messages.push({ role: "system", content: opts.system.trim() });
  messages.push({ role: "user", content: opts.prompt });

  const requestBody: any = {
    model: opts.model,
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 128,
    stream: opts.stream,
  };

  const t0 = performance.now();
  let ttft: number | null = null;
  let chunks = 0;
  let text = "";
  let usage: ChatTestResult["usage"] | undefined;
  let finishReason: string | null = null;

  try {
    if (opts.stream) {
      const stream = await client.chat.completions.create(
        { ...requestBody, stream: true, stream_options: undefined },
        { timeout: opts.timeoutMs ?? 60000 },
      );
      for await (const part of stream as any) {
        const delta = part?.choices?.[0]?.delta?.content ?? "";
        if (part?.usage) {
          usage = {
            prompt: part.usage.prompt_tokens,
            completion: part.usage.completion_tokens,
            total: part.usage.total_tokens,
          };
        }
        if (part?.choices?.[0]?.finish_reason) finishReason = part.choices[0].finish_reason;
        if (delta) {
          if (ttft === null) ttft = Math.round(performance.now() - t0);
          chunks++;
          text += delta;
          opts.onDelta?.(delta);
        }
      }
    } else {
      const res: any = await client.chat.completions.create(
        { ...requestBody, stream: false },
        { timeout: opts.timeoutMs ?? 60000 },
      );
      text = res?.choices?.[0]?.message?.content ?? "";
      finishReason = res?.choices?.[0]?.finish_reason ?? null;
      chunks = 1;
      if (res?.usage) {
        usage = {
          prompt: res.usage.prompt_tokens,
          completion: res.usage.completion_tokens,
          total: res.usage.total_tokens,
        };
      }
      opts.onDelta?.(text);
    }

    const totalMs = Math.round(performance.now() - t0);
    const completionTokens = usage?.completion ?? Math.max(1, Math.round(text.length / 4));
    const genMs = ttft !== null ? totalMs - ttft : totalMs;
    return {
      model: opts.model,
      ok: true,
      status: 200,
      text,
      ttftMs: ttft,
      totalMs,
      chunks,
      tokensPerSec: genMs > 0 ? Math.round((completionTokens / genMs) * 1000 * 10) / 10 : null,
      usage,
      finishReason,
      transport: opts.stream ? "sdk-stream" : "sdk-json",
      requestBody,
    };
  } catch (e: any) {
    const totalMs = Math.round(performance.now() - t0);
    const status = e?.status ?? null;
    let error = e?.error?.message || e?.message || String(e);
    let hint: string | undefined;
    if (status === 401 || status === 403) hint = "Endpoint is alive but rejected the credentials — paste a valid API key.";
    else if (status === 404) hint = "Model or route not found. Try another model id, or check the base URL includes /v1.";
    else if (status === 429) hint = "Rate limited — the endpoint works, just throttled.";
    else if (status === 400) hint = "Endpoint responded but rejected the payload (unsupported param or bad model id).";
    else if (status === null) hint = explainNetworkError(opts.baseURL);
    return {
      model: opts.model,
      ok: false,
      status,
      text,
      error,
      hint,
      ttftMs: ttft,
      totalMs,
      chunks,
      tokensPerSec: null,
      transport: opts.stream ? "sdk-stream" : "sdk-json",
      requestBody,
    };
  }
}

export type RawChatOptions = {
  url: string;
  apiKey: string;
  model: string;
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  stream: boolean;
  timeoutMs?: number;
  transport?: Transport;
  onDelta?: (chunk: string) => void;
};

/**
 * Hits an exact URL directly with fetch — used whenever the user overrides the
 * endpoint with a path the OpenAI SDK can't express (i.e. it doesn't end in
 * `/chat/completions`). Parses SSE by hand so streaming still works.
 */
export async function runChatTestAtUrl(opts: RawChatOptions): Promise<ChatTestResult> {
  const messages: any[] = [];
  if (opts.system?.trim()) messages.push({ role: "system", content: opts.system.trim() });
  messages.push({ role: "user", content: opts.prompt });

  const requestBody: any = {
    model: opts.model,
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 128,
    stream: opts.stream,
  };

  const url = viaProxy(opts.url, opts.transport ?? DIRECT);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 60000);
  const t0 = performance.now();
  let ttft: number | null = null;
  let chunks = 0;
  let text = "";
  let usage: ChatTestResult["usage"];
  let finishReason: string | null = null;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: opts.stream ? "text/event-stream" : "application/json",
        ...authHeaders(opts.apiKey),
      },
      body: JSON.stringify(requestBody),
      signal: ctrl.signal,
    });

    if (opts.stream && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const raw of lines) {
          const line = raw.trim();
          if (!line || !line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const j = JSON.parse(payload);
            if (j?.usage) {
              usage = {
                prompt: j.usage.prompt_tokens,
                completion: j.usage.completion_tokens,
                total: j.usage.total_tokens,
              };
            }
            const delta = j?.choices?.[0]?.delta?.content ?? j?.choices?.[0]?.text ?? "";
            if (j?.choices?.[0]?.finish_reason) finishReason = j.choices[0].finish_reason;
            if (delta) {
              if (ttft === null) ttft = Math.round(performance.now() - t0);
              chunks++;
              text += delta;
              opts.onDelta?.(delta);
            }
          } catch {
            /* partial/non-JSON SSE event, skip */
          }
        }
      }
      if (!res.ok) throw Object.assign(new Error(text || res.statusText || "request failed"), { status: res.status });
    } else {
      const bodyText = await res.text();
      let j: any = null;
      try {
        j = bodyText ? JSON.parse(bodyText) : null;
      } catch {
        /* non-JSON body */
      }
      if (!res.ok) {
        throw Object.assign(new Error(j?.error?.message || bodyText || res.statusText), { status: res.status });
      }
      text = j?.choices?.[0]?.message?.content ?? j?.choices?.[0]?.text ?? "";
      finishReason = j?.choices?.[0]?.finish_reason ?? null;
      chunks = 1;
      if (j?.usage) {
        usage = { prompt: j.usage.prompt_tokens, completion: j.usage.completion_tokens, total: j.usage.total_tokens };
      }
      opts.onDelta?.(text);
    }

    const totalMs = Math.round(performance.now() - t0);
    const completionTokens = usage?.completion ?? Math.max(1, Math.round(text.length / 4));
    const genMs = ttft !== null ? totalMs - ttft : totalMs;
    return {
      model: opts.model,
      ok: true,
      status: res.status,
      url: opts.url,
      text,
      ttftMs: ttft,
      totalMs,
      chunks,
      tokensPerSec: genMs > 0 ? Math.round((completionTokens / genMs) * 1000 * 10) / 10 : null,
      usage,
      finishReason,
      transport: opts.stream ? "raw-stream" : "raw-json",
      requestBody,
    };
  } catch (e: any) {
    const totalMs = Math.round(performance.now() - t0);
    const status = e?.status ?? null;
    let hint: string | undefined;
    if (status === 401 || status === 403) hint = "Endpoint is alive but rejected the credentials — paste a valid API key.";
    else if (status === 404) hint = "Route not found at this exact URL — try resetting to the auto-detected endpoint or toggling /v1.";
    else if (status === 429) hint = "Rate limited — the endpoint works, just throttled.";
    else if (status === 400) hint = "Endpoint responded but rejected the payload (unsupported param or bad model id).";
    else if (status === null) hint = e?.name === "AbortError" ? "Timed out waiting for a response." : explainNetworkError(opts.url);
    return {
      model: opts.model,
      ok: false,
      status,
      url: opts.url,
      text,
      error: e?.error?.message || e?.message || String(e),
      hint,
      ttftMs: ttft,
      totalMs,
      chunks,
      tokensPerSec: null,
      transport: opts.stream ? "raw-stream" : "raw-json",
      requestBody,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function curlFor(o: { url: string; apiKey: string; model: string; prompt: string }) {
  const auth = o.apiKey.trim() ? `\\\n  -H "Authorization: Bearer ${o.apiKey.trim()}" ` : "";
  return `curl ${o.url} \\
  -H "Content-Type: application/json" ${auth}\\
  -d '${JSON.stringify({ model: o.model, messages: [{ role: "user", content: o.prompt }] })}'`;
}
