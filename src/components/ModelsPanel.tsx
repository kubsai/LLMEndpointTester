import { useMemo, useState } from "react";
import { Badge, Button, Card, Spinner } from "./ui";
import type { DiscoveredModel } from "../lib/probe";

export type BatchResult = {
  state: "queued" | "running" | "pass" | "fail";
  ms?: number;
  status?: number | null;
  note?: string;
};

export function ModelsPanel({
  models,
  selected,
  onSelect,
  batch,
  onBatch,
  batching,
  onStopBatch,
  hasBase,
  scanned,
}: {
  models: DiscoveredModel[];
  selected: string;
  onSelect: (id: string) => void;
  batch: Record<string, BatchResult>;
  onBatch: (ids: string[]) => void;
  batching: boolean;
  onStopBatch: () => void;
  hasBase: boolean;
  scanned: boolean;
}) {
  const [q, setQ] = useState("");
  const [manual, setManual] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return models;
    return models.filter((m) => m.id.toLowerCase().includes(needle));
  }, [models, q]);

  const passCount = Object.values(batch).filter((b) => b.state === "pass").length;
  const failCount = Object.values(batch).filter((b) => b.state === "fail").length;

  return (
    <Card
      title={`Discovered models ${models.length ? `(${models.length})` : ""}`}
      subtitle={models.length ? "Click one to load it into the playground" : "GET /models · GET /api/tags"}
      right={
        batching ? (
          <Button variant="danger" onClick={onStopBatch}>
            <Spinner /> stop
          </Button>
        ) : (
          <Button
            disabled={!filtered.length || !hasBase}
            onClick={() => onBatch(filtered.slice(0, 25).map((m) => m.id))}
            title="Send a 1-token ping prompt to each model"
          >
            ⚡ Test {Math.min(filtered.length, 25) || ""} models
          </Button>
        )
      }
    >
      <div className="space-y-3">
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter models…"
            className="flex-1 rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-1.5 font-mono text-xs text-slate-100 placeholder-slate-600 outline-none focus:border-emerald-500/60"
          />
          {(passCount > 0 || failCount > 0) && (
            <div className="flex items-center gap-1.5">
              <Badge tone="good">{passCount} pass</Badge>
              <Badge tone="bad">{failCount} fail</Badge>
            </div>
          )}
        </div>

        {!models.length && (
          <div className="rounded-lg border border-dashed border-slate-800 p-4 text-center text-xs text-slate-500">
            {scanned
              ? "No model list returned. Some gateways hide /models — type a model id below and test it directly."
              : "Run a scan to auto-discover models."}
            <div className="mt-3 flex gap-2">
              <input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="e.g. llama3.2 · gpt-4o-mini · qwen2.5-coder"
                className="flex-1 rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-1.5 text-left font-mono text-xs text-slate-100 placeholder-slate-600 outline-none focus:border-emerald-500/60"
              />
              <Button onClick={() => manual.trim() && onSelect(manual.trim())}>use</Button>
            </div>
          </div>
        )}

        {!!models.length && (
          <ul className="max-h-[320px] space-y-1 overflow-y-auto pr-1">
            {filtered.map((m) => {
              const b = batch[m.id];
              const active = selected === m.id;
              return (
                <li key={m.id}>
                  <button
                    onClick={() => onSelect(m.id)}
                    className={`group flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition ${
                      active
                        ? "border-emerald-500/50 bg-emerald-500/10"
                        : "border-slate-800 bg-slate-950/40 hover:border-slate-700 hover:bg-slate-800/40"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        b?.state === "pass"
                          ? "bg-emerald-400"
                          : b?.state === "fail"
                            ? "bg-rose-400"
                            : b?.state === "running"
                              ? "animate-ping bg-sky-400"
                              : "bg-slate-700"
                      }`}
                    />
                    <span
                      className={`min-w-0 flex-1 truncate font-mono text-xs ${active ? "text-emerald-200" : "text-slate-300"}`}
                    >
                      {m.id}
                    </span>
                    {m.owned_by && (
                      <span className="hidden shrink-0 text-[10px] text-slate-600 sm:inline">{m.owned_by}</span>
                    )}
                    {b?.state === "pass" && <Badge tone="good">{b.ms} ms</Badge>}
                    {b?.state === "fail" && (
                      <Badge tone="bad" className="max-w-[140px] truncate">
                        {b.status ?? "err"} {b.note}
                      </Badge>
                    )}
                  </button>
                </li>
              );
            })}
            {!filtered.length && <li className="py-4 text-center text-xs text-slate-600">no match</li>}
          </ul>
        )}
      </div>
    </Card>
  );
}
