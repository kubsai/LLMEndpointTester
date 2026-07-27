/**
 * Two ways to reach an endpoint:
 *  - "direct"  → fetch() straight from the browser. Fast, works with localhost,
 *                but the target must send CORS headers.
 *  - "proxy"   → relay through this app's own server (/api/proxy). Bypasses CORS
 *                completely, but only reaches endpoints the *server* can see
 *                (i.e. public URLs — never the visitor's localhost).
 *
 * The proxy exists when the app is deployed as a Docker Space (server.js).
 * In a purely static deployment it simply isn't there and we stay direct.
 */

export type TransportMode = "direct" | "proxy";

export type Transport = {
  mode: TransportMode;
  proxyBase: string | null;
};

export const DIRECT: Transport = { mode: "direct", proxyBase: null };

function origin(): string {
  return typeof location !== "undefined" ? location.origin : "";
}

export function proxyBaseUrl(): string {
  return `${origin()}/api/proxy`;
}

/** Ask the host whether a relay is available (Docker Space = yes, static = no). */
export async function detectProxy(timeoutMs = 3500): Promise<boolean> {
  if (typeof fetch === "undefined") return false;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${origin()}/api/healthz`, { signal: ctrl.signal });
    if (!res.ok) return false;
    const j = await res.json().catch(() => null);
    return !!j?.proxy;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** Rewrite an absolute target URL so it goes through the relay. */
export function viaProxy(targetUrl: string, t: Transport): string {
  if (t.mode !== "proxy" || !t.proxyBase) return targetUrl;
  return `${t.proxyBase}?target=${encodeURIComponent(targetUrl)}`;
}

export function isLocalHost(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1|.*\.local)(:|\/|$)/i.test(url.trim());
}

export function isPrivateHost(url: string): boolean {
  return (
    isLocalHost(url) ||
    /^https?:\/\/(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/i.test(url.trim())
  );
}

export type EnvInfo = {
  https: boolean;
  hosted: boolean;
  proxyAvailable: boolean;
};

export function pageEnv(proxyAvailable: boolean): EnvInfo {
  const https = typeof location !== "undefined" && location.protocol === "https:";
  const hosted = typeof location !== "undefined" && !isLocalHost(location.origin);
  return { https, hosted, proxyAvailable };
}

/**
 * Explains, in plain language, what will happen for this endpoint from this page.
 */
export function transportAdvice(endpoint: string, env: EnvInfo, mode: TransportMode) {
  const local = isLocalHost(endpoint);
  if (local && mode === "proxy") {
    return {
      level: "error" as const,
      text: "Proxy mode can't reach your localhost — the relay runs on the server, not your machine. Switch to Direct for local endpoints.",
    };
  }
  if (local && env.https && env.hosted) {
    return {
      level: "warn" as const,
      text: "This page is served over HTTPS, so Chrome's Private Network Access rules (and Safari's mixed-content block) usually stop calls to http://localhost. Run this app locally to test local servers, or expose your server over HTTPS (ngrok/cloudflared).",
    };
  }
  if (!local && mode === "direct") {
    return {
      level: "info" as const,
      text: "Direct mode requires the endpoint to send Access-Control-Allow-Origin. If it doesn't, switch to Proxy mode.",
    };
  }
  if (!local && mode === "proxy") {
    return {
      level: "ok" as const,
      text: "Relaying through this app's server — CORS no longer applies, and your key is forwarded but never stored server-side.",
    };
  }
  return { level: "ok" as const, text: "Direct browser requests — best for local servers." };
}
