import { useState } from "react";
import { Badge, Button, Dot, Spinner } from "./ui";
import { PRESETS, normalizeEndpoint, type ScanReport } from "../lib/probe";
import type { TransportMode } from "../lib/transport";

const adviceStyles = {
  ok: "border-emerald-500/30 bg-emerald-500/5 text-emerald-200",
  info: "border-sky-500/30 bg-sky-500/5 text-sky-200",
  warn: "border-amber-500/30 bg-amber-500/5 text-amber-200",
  error: "border-rose-500/30 bg-rose-500/5 text-rose-200",
};

export function EndpointBar({
  endpoint,
  setEndpoint,
  apiKey,
  setApiKey,
  onScan,
  scanning,
  report,
  mode,
  setMode,
  proxyAvailable,
  advice,
  remember,
  setRemember,
}: {
  endpoint: string;
  setEndpoint: (v: string) => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  onScan: () => void;
  scanning: boolean;
  report: ScanReport | null;
  mode: TransportMode;
  setMode: (m: TransportMode) => void;
  proxyAvailable: boolean;
  advice: { level: keyof typeof adviceStyles; text: string };
  remember: boolean;
  setRemember: (v: boolean) => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const normalized = normalizeEndpoint(endpoint);

  const tone: "good" | "warn" | "bad" | "idle" = !report
    ? "idle"
    : report.corsBlocked
      ? "bad"
      : report.models.length
        ? "good"
        : "warn";

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-2xl shadow-black/40 backdrop-blur">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onScan();
        }}
        className="flex flex-col gap-3 lg:flex-row"
      >
        <div className="relative flex-1">
          <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
            <Dot tone={tone} />
          </div>
          <input
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            spellCheck={false}
            placeholder="Paste an endpoint — http://localhost:11434/v1 or https://api.groq.com/openai/v1"
            className="w-full rounded-lg border border-slate-700 bg-slate-950/80 py-2.5 pl-8 pr-3 font-mono text-sm text-slate-100 placeholder-slate-600 outline-none transition focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20"
          />
        </div>
        <div className="relative w-full lg:w-72">
          <input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            spellCheck={false}
            type={showKey ? "text" : "password"}
            autoComplete="off"
            placeholder="API key (optional — leave blank)"
            className="w-full rounded-lg border border-slate-700 bg-slate-950/80 py-2.5 pl-3 pr-16 font-mono text-sm text-slate-100 placeholder-slate-600 outline-none transition focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20"
          />
          <button
            type="button"
            onClick={() => setShowKey((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1.5 py-1 text-[10px] uppercase tracking-wider text-slate-500 hover:text-slate-300"
          >
            {showKey ? "hide" : "show"}
          </button>
        </div>
        <Button type="submit" variant="primary" disabled={scanning || !endpoint.trim()} className="h-[42px] px-5 text-sm">
          {scanning ? (
            <>
              <Spinner /> Scanning…
            </>
          ) : (
            <>▶ Test endpoint</>
          )}
        </Button>
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">Mode</span>
          <div className="flex rounded-lg border border-slate-800 bg-slate-950/60 p-0.5">
            {(["direct", "proxy"] as TransportMode[]).map((m) => {
              const disabled = m === "proxy" && !proxyAvailable;
              return (
                <button
                  key={m}
                  onClick={() => !disabled && setMode(m)}
                  disabled={disabled}
                  title={
                    disabled
                      ? "No server relay on this deployment (static hosting). Run the Docker Space / `npm run serve` to enable it."
                      : m === "direct"
                        ? "Browser → endpoint. Needs CORS. Works with localhost."
                        : "Browser → this app's server → endpoint. Ignores CORS. Cannot see your localhost."
                  }
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                    mode === m
                      ? "bg-slate-700/80 text-slate-100"
                      : disabled
                        ? "cursor-not-allowed text-slate-700"
                        : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {m === "direct" ? "🖥 Direct" : "🛰 Proxy"}
                </button>
              );
            })}
          </div>
          <Badge tone={proxyAvailable ? "good" : "muted"}>
            relay {proxyAvailable ? "online" : "off"}
          </Badge>
        </div>

        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-400">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="h-3.5 w-3.5 accent-emerald-500"
          />
          remember key in this browser
        </label>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">Presets</span>
          {PRESETS.map((p) => (
            <button
              key={p.url}
              title={`${p.url} · ${p.note}`}
              onClick={() => setEndpoint(p.url)}
              className="rounded-md border border-slate-800 bg-slate-950/60 px-2 py-1 text-[11px] text-slate-400 transition hover:border-emerald-500/40 hover:text-emerald-300"
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <div className={`mt-3 rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${adviceStyles[advice.level]}`}>
        {advice.text}
      </div>

      {normalized && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-800/70 pt-3 font-mono text-[11px] text-slate-500">
          <Badge tone="info">base</Badge>
          <span className="text-slate-300">{normalized}</span>
          {report?.workingBase && (
            <>
              <span className="text-slate-700">→</span>
              <Badge tone="good">resolved</Badge>
              <span className="text-emerald-300">{report.workingBase}</span>
            </>
          )}
          {!apiKey.trim() && <Badge tone="violet">keyless mode</Badge>}
        </div>
      )}
    </div>
  );
}
