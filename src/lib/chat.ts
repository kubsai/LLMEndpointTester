import OpenAI from "openai";
import { authHeaders, explainNetworkError } from "./probe";
import { DIRECT, viaProxy, type Transport } from "./transport";

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
  transport: "sdk-stream" | "sdk-json";
  requestBody: any;
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

/** Raw fetch fallback — useful when the SDK's shape assumptions break. */
export async function rawChatTest(opts: Omit<ChatOptions, "onDelta">) {
  const url = viaProxy(`${opts.baseURL}/chat/completions`, opts.transport ?? DIRECT);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(opts.apiKey) },
    body: JSON.stringify({
      model: opts.model,
      messages: [{ role: "user", content: opts.prompt }],
      max_tokens: opts.maxTokens ?? 64,
      stream: false,
    }),
  });
  return { status: res.status, body: await res.text() };
}

export function curlFor(o: { baseURL: string; apiKey: string; model: string; prompt: string }) {
  const auth = o.apiKey.trim() ? `\\\n  -H "Authorization: Bearer ${o.apiKey.trim()}" ` : "";
  return `curl ${o.baseURL}/chat/completions \\
  -H "Content-Type: application/json" ${auth}\\
  -d '${JSON.stringify({ model: o.model, messages: [{ role: "user", content: o.prompt }] })}'`;
}
