import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EndpointBar } from "./components/EndpointBar";
import { ProbePanel } from "./components/ProbePanel";
import { ModelsPanel, type BatchResult } from "./components/ModelsPanel";
import { ChatPanel, type RunParams } from "./components/ChatPanel";
import { LogPanel, type LogEntry } from "./components/LogPanel";
import { Badge } from "./components/ui";
import { pingSeries, scanEndpoint, type ScanReport } from "./lib/probe";
import { deriveSdkBase, runChatTest, runChatTestAtUrl, type ChatTestResult } from "./lib/chat";
import { storage } from "./lib/storage";
import {
  detectProxy,
  isLocalHost,
  pageEnv,
  proxyBaseUrl,
  transportAdvice,
  type Transport,
  type TransportMode,
} from "./lib/transport";

const LS_ENDPOINT = "llm-tester.endpoint";
const LS_KEY = "llm-tester.key";
const LS_REMEMBER = "llm-tester.remember";
const LS_MODE = "llm-tester.mode";

export default function App() {
  const [endpoint, setEndpoint] = useState(() => storage.get(LS_ENDPOINT) || "http://localhost:11434/v1");
  const [remember, setRemember] = useState(() => storage.get(LS_REMEMBER) === "1");
  const [apiKey, setApiKey] = useState(() => (storage.get(LS_REMEMBER) === "1" ? storage.get(LS_KEY) : ""));
  const [mode, setMode] = useState<TransportMode>(() => (storage.get(LS_MODE) === "proxy" ? "proxy" : "direct"));
  const [proxyAvailable, setProxyAvailable] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [report, setReport] = useState<ScanReport | null>(null);
  const [samples, setSamples] = useState<(number | null)[]>([]);
  const [pinging, setPinging] = useState(false);
  const [model, setModel] = useState("");
  const [batch, setBatch] = useState<Record<string, BatchResult>>({});
  const [batching, setBatching] = useState(false);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState("");
  const [result, setResult] = useState<ChatTestResult | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [chatUrlOverride, setChatUrlOverride] = useState("");
  const stopBatch = useRef(false);
  // Read once on first render, before the persistence effect writes a default.
  const hadSavedMode = useRef(storage.get(LS_MODE) !== "");
  const autoRetried = useRef(false);

  useEffect(() => storage.set(LS_ENDPOINT, endpoint), [endpoint]);
  useEffect(() => storage.set(LS_MODE, mode), [mode]);
  useEffect(() => {
    storage.set(LS_REMEMBER, remember ? "1" : "0");
    if (remember) storage.set(LS_KEY, apiKey);
    else storage.remove(LS_KEY);
  }, [remember, apiKey]);

  const log = useCallback((level: LogEntry["level"], msg: string) => {
    setLogs((l) => [...l.slice(-199), { t: Date.now(), level, msg }]);
  }, []);

  // Detect whether this deployment ships the server relay (Docker Space) and
  // auto-select the smartest default mode.
  useEffect(() => {
    let cancelled = false;
    detectProxy().then((ok) => {
      if (cancelled) return;
      setProxyAvailable(ok);
      log(
        ok ? "ok" : "info",
        ok
          ? "server relay detected at /api/proxy — CORS-free mode available"
          : "no server relay on this host — direct browser mode only",
      );
      if (ok && !hadSavedMode.current) {
        setMode(isLocalHost(endpoint) ? "direct" : "proxy");
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const transport: Transport = useMemo(
    () => ({
      mode: mode === "proxy" && proxyAvailable ? "proxy" : "direct",
      proxyBase: proxyAvailable ? proxyBaseUrl() : null,
    }),
    [mode, proxyAvailable],
  );

  const env = useMemo(() => pageEnv(proxyAvailable), [proxyAvailable]);
  const advice = useMemo(() => transportAdvice(endpoint, env, transport.mode), [endpoint, env, transport.mode]);

  const pingTarget = useCallback(() => {
    if (!report) return null;
    const good = report.probes.find((p) => p.kind === "models" && p.status !== null);
    const any = report.probes.find((p) => p.status !== null);
    return good?.url || any?.url || null;
  }, [report]);

  const runScan = useCallback(
    async (t: Transport, isRetry = false) => {
      setScanning(true);
      setReport(null);
      setSamples([]);
      setBatch({});
      setResult(null);
      setOutput("");
      if (!isRetry) setChatUrlOverride("");
      log("info", `scan → ${endpoint} · ${t.mode} mode${apiKey ? " · with key" : " · keyless"}`);
      try {
        const r = await scanEndpoint(
          endpoint,
          apiKey,
          (p) => {
            log(
              p.status === null ? "err" : p.status < 300 ? "ok" : p.status < 500 ? "warn" : "err",
              `${p.label} → ${p.status ?? "network error"} ${p.error ?? ""} (${p.latencyMs} ms)`,
            );
          },
          t,
        );

        // Direct call blocked by CORS but a relay is available → retry once via proxy.
        const canFallback =
          r.corsBlocked && !isRetry && proxyAvailable && t.mode === "direct" && !isLocalHost(endpoint);
        if (canFallback) {
          log("warn", "direct call blocked (CORS) — retrying through the server relay…");
          setMode("proxy");
          await runScan({ mode: "proxy", proxyBase: proxyBaseUrl() }, true);
          return;
        }

        setReport(r);
        if (r.models.length) {
          log(
            "ok",
            `discovered ${r.models.length} model(s): ${r.models.slice(0, 6).map((m) => m.id).join(", ")}${r.models.length > 6 ? "…" : ""}`,
          );
          setModel((m) => m || r.models[0].id);
        } else if (r.corsBlocked) {
          log("err", "no route answered — CORS, wrong URL, or host unreachable");
          if (isLocalHost(endpoint) && env.https)
            log("warn", "https page → http://localhost is blocked by the browser; run this app locally instead");
        } else if (r.needsKey) {
          log("warn", "host is up but requires authentication");
        } else {
          log("warn", "reachable, but no model list returned");
        }
        if (r.workingBase) log("ok", `resolved models base URL: ${r.workingBase}`);
        if (r.chatBase) {
          const usedV1 = /\/v\d+$/i.test(r.chatBase);
          log(
            "ok",
            `resolved chat completions endpoint: ${r.chatBase}/chat/completions${usedV1 ? "" : "  ⚠ no /v1 segment — unusual, double-check with the edit button if it 404s"}`,
          );
        } else {
          log("warn", "couldn't verify a working /chat/completions route — defaulting to /v1, edit it manually if needed");
        }
      } catch (e: any) {
        log("err", `scan failed: ${e?.message || e}`);
      } finally {
        setScanning(false);
      }
    },
    [endpoint, apiKey, log, proxyAvailable, env.https],
  );

  const handleScan = useCallback(() => {
    autoRetried.current = false;
    void runScan(transport);
  }, [runScan, transport]);

  const handlePing = useCallback(async () => {
    const url = pingTarget();
    if (!url) return;
    setPinging(true);
    setSamples([]);
    log("info", `ping ×12 → ${url}`);
    await pingSeries(url, apiKey, 12, (ms) => setSamples((s) => [...s, ms]), transport);
    setPinging(false);
    log("ok", "ping series complete");
  }, [pingTarget, apiKey, log, transport]);

  // Resolved default = /v1/chat/completions of whichever base actually answered the
  // dedicated chat-route probe (falls back to the /models base if that check failed).
  const defaultChatUrl = useMemo(() => {
    const base = report?.chatBase || report?.workingBase;
    return base ? `${base}/chat/completions` : null;
  }, [report]);

  const handleRun = useCallback(
    async (p: RunParams) => {
      const url = chatUrlOverride.trim() || defaultChatUrl;
      if (!url || !model) return;
      setRunning(true);
      setOutput("");
      setResult(null);
      const sdkBase = deriveSdkBase(url);
      log(
        "info",
        `POST ${url} · model=${model} · stream=${p.stream} · ${transport.mode} · ${sdkBase ? "openai-sdk" : "raw fetch (custom path)"}`,
      );
      const r = sdkBase
        ? await runChatTest({
            baseURL: sdkBase,
            apiKey,
            model,
            prompt: p.prompt,
            system: p.system,
            stream: p.stream,
            temperature: p.temperature,
            maxTokens: p.maxTokens,
            transport,
            onDelta: (d) => setOutput((o) => o + d),
          })
        : await runChatTestAtUrl({
            url,
            apiKey,
            model,
            prompt: p.prompt,
            system: p.system,
            stream: p.stream,
            temperature: p.temperature,
            maxTokens: p.maxTokens,
            transport,
            onDelta: (d) => setOutput((o) => o + d),
          });
      setResult(r);
      setRunning(false);
      if (r.ok) log("ok", `200 OK · ttft ${r.ttftMs ?? "-"} ms · total ${r.totalMs} ms · ${r.tokensPerSec ?? "-"} tok/s`);
      else {
        log("err", `${r.status ?? "network"} · ${r.error}`);
        if (r.status === 404)
          log("warn", "404 at this exact path — try the ✎ edit button on the endpoint bar to toggle /v1 or use a custom route");
      }
    },
    [chatUrlOverride, defaultChatUrl, model, apiKey, log, transport],
  );

  const handleBatch = useCallback(
    async (ids: string[]) => {
      const base = report?.chatBase || report?.workingBase;
      if (!base) return;
      stopBatch.current = false;
      setBatching(true);
      setBatch(Object.fromEntries(ids.map((id) => [id, { state: "queued" } as BatchResult])));
      log("info", `batch test of ${ids.length} model(s) against ${base}/chat/completions`);

      const queue = [...ids];
      const worker = async () => {
        while (queue.length && !stopBatch.current) {
          const id = queue.shift()!;
          setBatch((b) => ({ ...b, [id]: { state: "running" } }));
          const r = await runChatTest({
            baseURL: base,
            apiKey,
            model: id,
            prompt: "Say OK",
            stream: false,
            maxTokens: 5,
            temperature: 0,
            timeoutMs: 30000,
            transport,
          });
          setBatch((b) => ({
            ...b,
            [id]: r.ok
              ? { state: "pass", ms: r.totalMs }
              : { state: "fail", status: r.status, note: (r.error || "").slice(0, 60) },
          }));
          log(r.ok ? "ok" : "err", `${id} → ${r.ok ? `pass ${r.totalMs} ms` : `${r.status ?? "network"} ${r.error}`}`);
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      setBatching(false);
      log("info", "batch complete");
    },
    [report, apiKey, log, transport],
  );

  const workingBase = report?.workingBase ?? null;

  return (
    <div className="grid-bg min-h-screen bg-[#06080d] text-slate-200">
      <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-white">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-teal-600 text-slate-950">
                ⚡
              </span>
              LLM Endpoint Tester
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Paste any OpenAI-compatible base URL → ping it, auto-discover models, and stream a real completion.
              Works keyless.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="good">openai sdk v5</Badge>
            <Badge tone="info">/v1/models</Badge>
            <Badge tone="violet">SSE streaming</Badge>
            <Badge tone={proxyAvailable ? "good" : "muted"}>
              {proxyAvailable ? "server relay" : "client-side"}
            </Badge>
          </div>
        </header>

        <EndpointBar
          endpoint={endpoint}
          setEndpoint={setEndpoint}
          apiKey={apiKey}
          setApiKey={setApiKey}
          onScan={handleScan}
          scanning={scanning}
          report={report}
          mode={transport.mode}
          setMode={setMode}
          proxyAvailable={proxyAvailable}
          advice={advice}
          remember={remember}
          setRemember={setRemember}
        />

        <div className="mt-4 grid gap-4 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-5">
            <ProbePanel report={report} scanning={scanning} samples={samples} pinging={pinging} onPing={handlePing} />
            <ModelsPanel
              models={report?.models ?? []}
              selected={model}
              onSelect={setModel}
              batch={batch}
              onBatch={handleBatch}
              batching={batching}
              onStopBatch={() => {
                stopBatch.current = true;
              }}
              hasBase={!!workingBase}
              scanned={!!report}
            />
          </div>
          <div className="space-y-4 lg:col-span-7">
            <ChatPanel
              model={model}
              defaultUrl={defaultChatUrl}
              overrideUrl={chatUrlOverride}
              onOverrideChange={setChatUrlOverride}
              apiKey={apiKey}
              onRun={handleRun}
              running={running}
              output={output}
              result={result}
            />
            <LogPanel logs={logs} onClear={() => setLogs([])} />
          </div>
        </div>

        <footer className="mt-6 grid gap-3 rounded-xl border border-slate-800/70 bg-slate-900/30 p-4 text-xs leading-relaxed text-slate-500 sm:grid-cols-2">
          <div>
            <div className="mb-1 font-semibold text-slate-300">🖥 Direct mode &amp; CORS</div>
            Requests leave your browser, so the endpoint must send{" "}
            <code className="text-emerald-400">Access-Control-Allow-Origin</code>. Local servers need a flag:{" "}
            <code className="text-slate-300">OLLAMA_ORIGINS='*' ollama serve</code> ·{" "}
            <code className="text-slate-300">llama-server --cors</code> ·{" "}
            <code className="text-slate-300">vllm serve --allowed-origins '["*"]'</code>.
          </div>
          <div>
            <div className="mb-1 font-semibold text-slate-300">🛰 Proxy mode &amp; privacy</div>
            The relay forwards your request server-side (no CORS, no logging of keys) but it can only reach{" "}
            <em>public</em> URLs — never your machine's localhost. Keys stay in this browser and are only sent to the
            endpoint you type. {storage.persistent ? "" : "Storage is blocked in this iframe, so nothing is persisted."}
          </div>
        </footer>
      </div>
    </div>
  );
}
