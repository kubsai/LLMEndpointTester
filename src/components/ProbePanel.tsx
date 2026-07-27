import { Badge, Button, Card, Sparkline, Spinner, Stat } from "./ui";
import { describeStatus, stats, type ScanReport } from "../lib/probe";

export function ProbePanel({
  report,
  scanning,
  samples,
  pinging,
  onPing,
}: {
  report: ScanReport | null;
  scanning: boolean;
  samples: (number | null)[];
  pinging: boolean;
  onPing: () => void;
}) {
  const okSamples = samples.filter((s): s is number => s !== null);
  const s = stats(okSamples);
  const loss = samples.length ? Math.round(((samples.length - okSamples.length) / samples.length) * 100) : 0;

  return (
    <Card
      title="Reachability probes"
      subtitle="Well-known OpenAI-compatible routes, tried in parallel"
      right={
        <Button onClick={onPing} disabled={!report?.workingBase || pinging}>
          {pinging ? (
            <>
              <Spinner /> pinging
            </>
          ) : (
            <>📡 Ping ×12</>
          )}
        </Button>
      }
    >
      {!report && !scanning && (
        <p className="py-6 text-center text-sm text-slate-500">
          Paste an endpoint above and hit <span className="text-emerald-400">Test endpoint</span>. No key required —
          keyless servers (Ollama, LM Studio, llama.cpp, vLLM) work out of the box.
        </p>
      )}

      {scanning && !report && (
        <div className="space-y-2 py-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded-lg bg-slate-800/40" style={{ animationDelay: `${i * 90}ms` }} />
          ))}
        </div>
      )}

      {report && (
        <div className="space-y-3">
          {report.corsBlocked && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-200">
              <div className="mb-1 font-semibold">Nothing answered from the browser</div>
              <p className="text-rose-200/80">{report.probes[0]?.hint}</p>
            </div>
          )}
          {report.needsKey && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
              <span className="font-semibold">Endpoint is alive but authenticated.</span> It answered 401/403 — that
              still proves the host is up. Add a key to list models.
            </div>
          )}

          <div className="overflow-hidden rounded-lg border border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Route</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {report.probes.map((p) => {
                  const d = describeStatus(p.status);
                  return (
                    <tr key={p.id} className="slide-up transition hover:bg-slate-800/30">
                      <td className="max-w-[1px] truncate px-3 py-2 font-mono text-slate-300" title={p.url}>
                        {p.label}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <Badge tone={d.tone}>
                          {p.status ?? "—"} {d.label}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-slate-400">
                        {p.status === null ? <span className="text-rose-400">fail</span> : `${p.latencyMs} ms`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {(samples.length > 0 || pinging) && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500">
                <span>Latency over {samples.length} pings</span>
                <span className={loss ? "text-rose-400" : "text-emerald-400"}>{loss}% loss</span>
              </div>
              <Sparkline data={samples} />
              {s && (
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="min" value={s.min} unit="ms" />
                  <Stat label="avg" value={s.avg} unit="ms" />
                  <Stat label="p95" value={s.p95} unit="ms" />
                  <Stat label="jitter" value={s.jitter} unit="ms" />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
