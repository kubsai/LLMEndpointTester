import { useEffect, useRef } from "react";
import { Button, Card } from "./ui";

export type LogEntry = { t: number; level: "info" | "ok" | "warn" | "err"; msg: string };

const colors = {
  info: "text-slate-400",
  ok: "text-emerald-400",
  warn: "text-amber-400",
  err: "text-rose-400",
};

export function LogPanel({ logs, onClear }: { logs: LogEntry[]; onClear: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [logs]);

  return (
    <Card
      title="Console"
      subtitle="Raw request/response trace"
      right={
        <Button variant="ghost" onClick={onClear}>
          clear
        </Button>
      }
    >
      <div ref={ref} className="max-h-64 overflow-y-auto rounded-lg border border-slate-800 bg-black/60 p-2.5">
        {!logs.length && <div className="p-2 text-xs text-slate-700">no activity yet…</div>}
        {logs.map((l, i) => (
          <div key={i} className="flex gap-2 font-mono text-[11px] leading-relaxed">
            <span className="shrink-0 text-slate-700">
              {new Date(l.t).toLocaleTimeString([], { hour12: false })}
            </span>
            <span className={`min-w-0 flex-1 break-words ${colors[l.level]}`}>{l.msg}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
