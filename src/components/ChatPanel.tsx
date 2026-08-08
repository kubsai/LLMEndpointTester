import { useState } from "react";
import { Badge, Button, Card, Spinner, Stat } from "./ui";
import type { ChatTestResult } from "../lib/chat";
import { curlFor } from "../lib/chat";

export type RunParams = {
  prompt: string;
  system: string;
  stream: boolean;
  temperature: number;
  maxTokens: number;
};

export function ChatPanel({
  model,
  defaultUrl,
  overrideUrl,
  onOverrideChange,
  apiKey,
  onRun,
  running,
  output,
  result,
}: {
  model: string;
  defaultUrl: string | null;
  overrideUrl: string;
  onOverrideChange: (v: string) => void;
  apiKey: string;
  onRun: (p: RunParams) => void;
  running: boolean;
  output: string;
  result: ChatTestResult | null;
}) {
  const [prompt, setPrompt] = useState("Reply with exactly: pong");
  const [system, setSystem] = useState("");
  const [stream, setStream] = useState(true);
  const [temperature, setTemperature] = useState(0.2);
  const [maxTokens, setMaxTokens] = useState(128);
  const [showCurl, setShowCurl] = useState(false);
  const [editingUrl, setEditingUrl] = useState(false);
  const [copied, setCopied] = useState(false);

  const isCustom = overrideUrl.trim().length > 0 && overrideUrl.trim() !== defaultUrl;
  const effectiveUrl = overrideUrl.trim() || defaultUrl;
  const ready = !!effectiveUrl && !!model;
  const curl = curlFor({ url: effectiveUrl || "<endpoint-url>", apiKey, model: model || "<model>", prompt });

  return (
    <Card
      title="Chat completion test"
      subtitle={
        ready ? (
          <span className="font-mono">
            POST {effectiveUrl} · {model}
          </span>
        ) : (
          "Pick a model first"
        )
      }
      right={
        <div className="flex items-center gap-1.5">
          <Button onClick={() => setShowCurl((s) => !s)} variant="ghost">
            {"</>"} curl
          </Button>
          <Button
            variant="primary"
            disabled={!ready || running || !prompt.trim()}
            onClick={() => onRun({ prompt, system, stream, temperature, maxTokens })}
          >
            {running ? (
              <>
                <Spinner /> running
              </>
            ) : (
              <>▶ Send</>
            )}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Chat completions endpoint</span>
            <div className="flex items-center gap-1.5">
              <Badge tone={isCustom ? "violet" : "good"}>{isCustom ? "custom" : "auto · /v1"}</Badge>
              {isCustom && (
                <button
                  onClick={() => onOverrideChange("")}
                  title="Revert to the auto-detected endpoint"
                  className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-500 hover:text-emerald-300"
                >
                  ↺ reset
                </button>
              )}
              <button
                onClick={() => setEditingUrl((s) => !s)}
                title="Edit the exact URL used for this test"
                className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-500 hover:text-slate-200"
              >
                {editingUrl ? "done" : "✎ edit"}
              </button>
            </div>
          </div>
          {editingUrl ? (
            <input
              autoFocus
              value={overrideUrl || defaultUrl || ""}
              onChange={(e) => onOverrideChange(e.target.value)}
              spellCheck={false}
              placeholder="https://host/v1/chat/completions"
              className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-1.5 font-mono text-xs text-slate-100 placeholder-slate-600 outline-none focus:border-emerald-500/60"
            />
          ) : (
            <div className="truncate rounded-lg border border-slate-800/70 bg-black/40 px-3 py-1.5 font-mono text-xs text-slate-300">
              {effectiveUrl || <span className="text-slate-600">— run a scan to auto-detect —</span>}
            </div>
          )}
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-slate-600">
            Defaults to <code className="text-slate-400">/v1/chat/completions</code> (the standard almost every
            OpenAI-compatible host uses). Edit it if this gateway needs a different path — e.g. no{" "}
            <code className="text-slate-400">/v1</code>, a custom prefix, or the legacy{" "}
            <code className="text-slate-400">/v1/completions</code> route.
          </p>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="space-y-2">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="User prompt"
              className="w-full resize-y rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 font-mono text-xs text-slate-100 placeholder-slate-600 outline-none focus:border-emerald-500/60"
            />
            <input
              value={system}
              onChange={(e) => setSystem(e.target.value)}
              placeholder="System prompt (optional)"
              className="w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-1.5 font-mono text-xs text-slate-100 placeholder-slate-600 outline-none focus:border-emerald-500/60"
            />
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={stream}
                  onChange={(e) => setStream(e.target.checked)}
                  className="h-3.5 w-3.5 accent-emerald-500"
                />
                stream (SSE)
              </label>
              <label className="flex items-center gap-1.5">
                temp
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.1}
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  className="w-20 accent-emerald-500"
                />
                <span className="w-6 font-mono text-slate-300">{temperature.toFixed(1)}</span>
              </label>
              <label className="flex items-center gap-1.5">
                max_tokens
                <input
                  type="number"
                  min={1}
                  max={4096}
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(parseInt(e.target.value) || 1)}
                  className="w-16 rounded border border-slate-700 bg-slate-950/70 px-1.5 py-0.5 font-mono text-slate-200 outline-none focus:border-emerald-500/60"
                />
              </label>
            </div>
          </div>

          <div className="relative min-h-[132px] rounded-lg border border-slate-800 bg-black/50 p-3">
            <div className="mb-1.5 flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-600">
              response
              {running && <Spinner className="text-emerald-400" />}
              {result?.transport && <Badge tone="info">{result.transport}</Badge>}
            </div>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-slate-200">
              {output || <span className="text-slate-700">— awaiting tokens —</span>}
              {running && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-emerald-400 align-middle" />}
            </pre>
          </div>
        </div>

        {showCurl && (
          <div className="relative rounded-lg border border-slate-800 bg-black/60 p-3">
            <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed text-emerald-300/90">{curl}</pre>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(curl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
              className="absolute right-2 top-2 rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] text-slate-400 hover:text-slate-100"
            >
              {copied ? "copied" : "copy"}
            </button>
          </div>
        )}

        {result && (
          <div className="space-y-2 slide-up">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Stat label="status" value={result.ok ? "OK" : (result.status ?? "ERR")} />
              <Stat label="ttft" value={result.ttftMs ?? "—"} unit={result.ttftMs !== null ? "ms" : ""} />
              <Stat label="total" value={result.totalMs} unit="ms" />
              <Stat label="tok/s" value={result.tokensPerSec ?? "—"} />
              <Stat label="tokens" value={result.usage?.total ?? result.usage?.completion ?? result.chunks} />
            </div>
            {result.usage && (
              <div className="flex flex-wrap gap-1.5">
                <Badge tone="muted">prompt {result.usage.prompt ?? "?"}</Badge>
                <Badge tone="muted">completion {result.usage.completion ?? "?"}</Badge>
                {result.finishReason && <Badge tone="info">finish: {result.finishReason}</Badge>}
              </div>
            )}
            {!result.ok && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-xs">
                <div className="font-mono text-rose-300">{result.error}</div>
                {result.hint && <div className="mt-1 text-rose-200/70">{result.hint}</div>}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
