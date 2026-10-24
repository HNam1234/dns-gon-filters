import SEED from "../data/seed.json" with { type: "json" };
import { compile, downloadRules, isBlocked, matches, MAX_DOMAIN_RULES, readLimited, validDomain } from "./filter.js";
import { blockedResponse, inspectAnswer, parseQuery, upstreamQuery } from "./dns.js";

const UPSTREAM = "https://cloudflare-dns.com/dns-query";
const FILTER_KEY = "filters-v1", ALLOW_KEY = "allow-v1", UPDATE_KEY = "update-v1";
const FEED = "https://raw.githubusercontent.com/HNam1234/dns-gon-filters/refs/heads/main/data/seed.json";
let cached = null, cachedNamespace = null, cacheUntil = 0;
let lastRefresh = null;
const plain = (message, status = 200) => new Response(message, { status,
  headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
const dnsResponse = (bytes) => new Response(bytes, { headers: {
  "Content-Type": "application/dns-message", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
} });

async function state(env) {
  if (cached && cachedNamespace === env.FILTERS && Date.now() < cacheUntil) return cached;
  if (env.FILTERS) {
    // Optional KV binding is only for private allowlist edits; the Free deployment needs no KV.
    const data = await env.FILTERS.get(FILTER_KEY, "json") || SEED;
    const allow = await env.FILTERS.get(ALLOW_KEY, "json") || [];
    cached = compile(data, allow);
  } else {
    let data = SEED;
    try {
      const response = await fetch(FEED, { redirect: "manual", signal: AbortSignal.timeout(4000),
        cf: { cacheTtl: 900, cacheEverything: true } });
      if (!response.ok) throw new Error("Feed unavailable");
      const bytes = await readLimited(response.body, 8 * 1024 * 1024);
      const candidate = JSON.parse(new TextDecoder().decode(bytes));
      if (candidate.block.length > MAX_DOMAIN_RULES || !Array.isArray(candidate.customAllow) ||
          candidate.customAllow.length > 200 || !candidate.customAllow.every(validDomain)) throw new Error("Invalid feed");
      const compiled = compile(candidate, candidate.customAllow);
      // Keep a newer in-memory data set if GitHub temporarily returns an older cached version.
      if (Date.parse(candidate.updated) >= Date.parse(data.updated)) data = candidate;
      lastRefresh = { status: "ok", time: new Date().toISOString() };
    } catch (error) {
      data = cached?.data || SEED;
      lastRefresh = { status: "using-last-known-good", time: new Date().toISOString() };
    }
    cached = compile(data, data.customAllow || []);
  }
  cachedNamespace = env.FILTERS; cacheUntil = Date.now() + 900000; return cached;
}

export async function refresh(env) {
  try {
    const data = await downloadRules();
    await env.FILTERS.put(FILTER_KEY, JSON.stringify(data));
    await env.FILTERS.put(UPDATE_KEY, JSON.stringify({ status: "ok", time: data.updated }));
    cached = null; cacheUntil = 0; return data;
  } catch {
    // Retain the last known-good filter set. Never write request data or exception text to logs/storage.
    await env.FILTERS.put(UPDATE_KEY, JSON.stringify({ status: "failed", time: new Date().toISOString() }));
    throw new Error("Filter update failed");
  }
}

export function createHandler(fetcher = fetch) {
  return async function handle(request, env) {
    try {
      const url = new URL(request.url);
      if (!/^[a-f0-9]{32,128}$/.test(env.DNS_TOKEN || "")) return plain("Setup required", 503);
      if (url.pathname === "/health" && request.method === "GET") {
        const current = await state(env), update = env.FILTERS ? await env.FILTERS.get(UPDATE_KEY, "json") : lastRefresh;
        return Response.json({ service: "DNS Gon Private", version: "1.0.2", filterRuleLimit: MAX_DOMAIN_RULES, status: "ready", queryLogs: false,
          filtersUpdated: current.data.updated, filterAgeDays: Math.floor((Date.now() - Date.parse(current.data.updated)) / 86400000),
          domainRules: current.block.length, sources: current.data.sources.map(s => s.name), lastUpdate: update,
          dnsUpstream: UPSTREAM }, { headers: { "Cache-Control": "no-store" } });
      }
      const prefix = `/${env.DNS_TOKEN}/`;
      if (!url.pathname.startsWith(prefix)) return plain("Not found", 404);
      const action = url.pathname.slice(prefix.length);
      if (action === "refresh" && request.method === "POST" && !url.search) {
        if (!env.FILTERS) {
          if (lastRefresh && Date.now() - Date.parse(lastRefresh.time) < 60000) return plain("Try later", 429);
          cacheUntil = 0; await state(env); return plain("Filter feed checked");
        }
        const previous = await env.FILTERS.get(UPDATE_KEY, "json");
        if (previous && Date.now() - Date.parse(previous.time) < 1800000) return plain("Try later", 429);
        await refresh(env); return plain("Filters updated");
      }
      if (action === "allowlist" && request.method === "PUT" && !url.search) {
        if (!env.FILTERS) return plain("Edit custom-allowlist.json in your GitHub repository, then run the update workflow", 409);
        const bytes = await readLimited(request.body, 16384);
        let domains;
        try { domains = JSON.parse(new TextDecoder().decode(bytes)); } catch { return plain("Invalid JSON", 400); }
        if (!Array.isArray(domains) || domains.length > 200 || !domains.every(validDomain)) return plain("Invalid domains", 400);
        await env.FILTERS.put(ALLOW_KEY, JSON.stringify([...new Set(domains)])); cached = null; cacheUntil = 0;
        return plain("Allowlist saved");
      }
      if (action !== "dns-query") return plain("Not found", 404);
      let bytes;
      if (request.method === "POST") {
        if (url.search || request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/dns-message")
          return plain("Expected a DNS message", 415);
        bytes = await readLimited(request.body, 65535);
      } else if (request.method === "GET") {
        const encoded = url.searchParams.get("dns");
        if (!encoded || encoded.length > 87380 || [...url.searchParams].length !== 1 || !/^[a-z0-9_-]+={0,2}$/i.test(encoded))
          return plain("Invalid DNS query", 400);
        try { bytes = Uint8Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0)); }
        catch { return plain("Invalid DNS encoding", 400); }
      } else return plain("Method not allowed", 405);
      let query;
      try { query = parseQuery(bytes); } catch { return plain("Invalid DNS message", 400); }
      const current = await state(env);
      if (isBlocked(query.name, current)) return dnsResponse(blockedResponse(query));
      const upstream = await fetcher(UPSTREAM, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(6000),
        headers: { "Content-Type": "application/dns-message", Accept: "application/dns-message" }, body: upstreamQuery(query) });
      if (!upstream.ok || upstream.headers.get("Content-Type")?.split(";")[0] !== "application/dns-message")
        return plain("DNS upstream unavailable", 502);
      const answer = await readLimited(upstream.body, 65535), aliases = inspectAnswer(answer, query);
      if (!matches(query.name, current.allow) && aliases.some(alias => isBlocked(alias, current)))
        return dnsResponse(blockedResponse(query));
      return dnsResponse(answer);
    } catch { return plain("DNS temporarily unavailable", 503); }
  };
}

export default {
  fetch: createHandler(),
};
