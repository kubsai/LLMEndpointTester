import type { ReactNode } from "react";
import { cn } from "../utils/cn";

export function Card({
  title,
  subtitle,
  right,
  children,
  className,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-slate-800/80 bg-slate-900/40 backdrop-blur-sm shadow-lg shadow-black/20",
        className,
      )}
    >
      {(title || right) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-800/80 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold tracking-tight text-slate-100">{title}</h2>
            {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const toneMap = {
  good: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  warn: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  bad: "bg-rose-500/10 text-rose-300 border-rose-500/30",
  info: "bg-sky-500/10 text-sky-300 border-sky-500/30",
  muted: "bg-slate-500/10 text-slate-400 border-slate-600/40",
  violet: "bg-violet-500/10 text-violet-300 border-violet-500/30",
} as const;

export function Badge({
  tone = "muted",
  children,
  className,
}: {
  tone?: keyof typeof toneMap;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider",
        toneMap[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  variant = "default",
  disabled,
  className,
  type = "button",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "ghost" | "danger";
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
  title?: string;
}) {
  const variants = {
    default:
      "bg-slate-800/80 text-slate-200 hover:bg-slate-700/80 border border-slate-700 hover:border-slate-600",
    primary:
      "bg-emerald-500 text-slate-950 hover:bg-emerald-400 border border-emerald-400 font-semibold shadow-lg shadow-emerald-500/20",
    ghost: "text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 border border-transparent",
    danger: "bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 border border-rose-500/40",
  };
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40",
        variants[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("h-3.5 w-3.5 animate-spin", className)} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z"
      />
    </svg>
  );
}

export function Dot({ tone }: { tone: "good" | "warn" | "bad" | "idle" }) {
  const colors = {
    good: "bg-emerald-400",
    warn: "bg-amber-400",
    bad: "bg-rose-400",
    idle: "bg-slate-600",
  };
  return (
    <span
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", colors[tone], tone === "good" && "pulse-ring")}
    />
  );
}

export function Stat({ label, value, unit }: { label: string; value: ReactNode; unit?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="font-mono text-lg leading-tight text-slate-100">
        {value}
        {unit && <span className="ml-0.5 text-xs text-slate-500">{unit}</span>}
      </div>
    </div>
  );
}

export function Sparkline({ data, height = 44 }: { data: (number | null)[]; height?: number }) {
  const valid = data.filter((d): d is number => d !== null);
  const max = Math.max(1, ...valid);
  const w = 100;
  const step = data.length > 1 ? w / (data.length - 1) : w;
  const pts = data.map((d, i) => {
    const y = d === null ? height : height - (d / max) * (height - 6) - 3;
    return `${i * step},${y}`;
  });
  const area = `0,${height} ${pts.join(" ")} ${(data.length - 1) * step},${height}`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="h-11 w-full">
      <defs>
        <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#34d399" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
        </linearGradient>
      </defs>
      {data.length > 1 && <polygon points={area} fill="url(#spark)" />}
      {data.length > 1 && (
        <polyline
          points={pts.join(" ")}
          fill="none"
          stroke="#34d399"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
      )}
      {data.map((d, i) =>
        d === null ? (
          <circle key={i} cx={i * step} cy={height - 3} r="1.6" fill="#f43f5e" vectorEffect="non-scaling-stroke" />
        ) : null,
      )}
    </svg>
  );
}
