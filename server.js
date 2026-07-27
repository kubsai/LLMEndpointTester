/**
 * LLM Endpoint Tester — static host + CORS-bypass relay.
 * Zero runtime dependencies (Node 18+). Listens on 7860 for Hugging Face Spaces.
 *
 *   GET  /api/healthz                 -> { ok: true, proxy: true }
 *   ANY  /api/proxy?target=<url>      -> forwards to <url>
 *   ANY  /api/proxy/<path>            -> forwards to <x-target-base header> + /<path>
 *   *                                 -> static files from ./dist (SPA fallback)
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import dns from "node:dns/promises";
import net from "node:net";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "dist");
const PORT = Number(process.env.PORT || 7860);
const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE_NETWORK === "1";
const MAX_BODY = 4 * 1024 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

/** Hop-by-hop + browser-controlled headers we must not forward upstream. */
const STRIP_REQUEST = new Set([
  "host",
  "origin",
  "referer",
  "connection",
  "keep-alive",
  "upgrade",
  "content-length",
  "transfer-encoding",
  "x-target-base",
  "sec-fetch-site",
  "sec-fetch-mode",
  "sec-fetch-dest",
  "cookie",
]);

const STRIP_RESPONSE = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "set-cookie",
  "access-control-allow-origin",
  "access-control-allow-headers",
]);

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) || // link-local + cloud metadata (169.254.169.254)
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

async function assertPublicTarget(url) {
  if (!/^https?:$/.test(url.protocol)) throw new Error("Only http/https targets are allowed");
  if (ALLOW_PRIVATE) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) {
    throw new Error(
      "Blocked: the relay runs on the server, so it cannot reach localhost. Use Direct mode for local endpoints.",
    );
  }
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error(`DNS lookup failed for ${host}`);
  if (addrs.some((a) => isPrivateIp(a.address))) {
    throw new Error("Blocked: target resolves to a private/link-local address (SSRF protection)");
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function json(res, code, payload) {
  const body = JSON.stringify(payload);
  cors(res);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(body);
}

async function handleProxy(req, res, url) {
  const started = Date.now();
  let target;
  try {
    const explicit = url.searchParams.get("target");
    if (explicit) {
      target = new URL(explicit);
    } else {
      const base = req.headers["x-target-base"];
      if (!base) throw new Error("Missing ?target= or x-target-base header");
      const suffix = url.pathname.replace(/^\/api\/proxy/, "") || "";
      target = new URL(String(base).replace(/\/+$/, "") + suffix + url.search);
    }
    await assertPublicTarget(target);
  } catch (e) {
    return json(res, 400, { error: { message: e.message, type: "proxy_error" } });
  }

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!STRIP_REQUEST.has(k.toLowerCase()) && typeof v === "string") headers[k] = v;
  }
  headers["accept-encoding"] = "identity";

  const method = req.method || "GET";
  let body;
  if (!["GET", "HEAD"].includes(method)) {
    try {
      body = await readBody(req);
      if (!body.length) body = undefined;
    } catch (e) {
      return json(res, 413, { error: { message: e.message, type: "proxy_error" } });
    }
  }

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), Number(process.env.PROXY_TIMEOUT_MS || 120000));
  req.on("close", () => ctrl.abort());

  try {
    const upstream = await fetch(target, { method, headers, body, signal: ctrl.signal, redirect: "follow" });
    const out = {};
    upstream.headers.forEach((v, k) => {
      if (!STRIP_RESPONSE.has(k.toLowerCase())) out[k] = v;
    });
    cors(res);
    out["x-proxy-latency-ms"] = String(Date.now() - started);
    out["x-proxy-target"] = target.origin + target.pathname;
    res.writeHead(upstream.status, out);
    if (upstream.body) {
      // Stream through so SSE (stream:true) arrives token by token.
      Readable.fromWeb(upstream.body).pipe(res);
    } else {
      res.end();
    }
  } catch (e) {
    const aborted = e?.name === "AbortError";
    json(res, aborted ? 504 : 502, {
      error: {
        message: aborted ? "Upstream timed out" : `Relay could not reach the endpoint: ${e.message}`,
        type: "proxy_error",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function serveStatic(req, res, url) {
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(DIST, rel);
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = join(file, "index.html");
  } catch {
    file = join(DIST, "index.html"); // SPA fallback
  }
  try {
    const data = await readFile(file);
    const type = MIME[extname(file).toLowerCase()] || "application/octet-stream";
    const immutable = /\/assets\//.test(file);
    res.writeHead(200, {
      "content-type": type,
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      "x-content-type-options": "nosniff",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found — did you run `npm run build`?");
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    return res.end();
  }
  if (url.pathname === "/api/healthz") {
    return json(res, 200, { ok: true, proxy: true, version: 1, uptime: Math.round(process.uptime()) });
  }
  if (url.pathname === "/api/proxy" || url.pathname.startsWith("/api/proxy/")) {
    return handleProxy(req, res, url);
  }
  return serveStatic(req, res, url);
}).listen(PORT, "0.0.0.0", () => {
  console.log(`▲ LLM Endpoint Tester on http://0.0.0.0:${PORT} (relay ${ALLOW_PRIVATE ? "unrestricted" : "public-only"})`);
});
