// Only unconditional domain rules can safely be represented by a DNS blocker.
export const SOURCES = [
  { name: "uBlock filters", url: "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt" },
  { name: "uBlock Quick fixes", url: "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/quick-fixes.txt" },
  { name: "uBlock Unbreak", url: "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/unbreak.txt", exceptionsOnly: true },
  { name: "EasyList", url: "https://easylist.to/easylist/easylist.txt" },
  { name: "HaGeZi Multi NORMAL", url: "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/multi.txt" },
  { name: "HaGeZi Pop-Up Ads", url: "https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/popupads.txt" },
  { name: "ABPVN", url: "https://raw.githubusercontent.com/abpvn/abpvn/master/filter/abpvn.txt" },
];

export const MAX_DOMAIN_RULES = 300000;

export const DEFAULT_ALLOW = [
  "graph.facebook.com", "graph.instagram.com", "whatsapp.com", "whatsapp.net",
  "accounts.google.com", "oauth2.googleapis.com", "login.microsoftonline.com",
  "login.live.com", "apple.com", "icloud.com",
];

export function validDomain(domain) {
  if (typeof domain !== "string" || domain.length > 253) return false;
  const labels = domain.split(".");
  return labels.length >= 2 && /[a-z]/.test(labels.at(-1)) && labels.every(
    (label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
  );
}

export function parseRules(text, exceptionsOnly = false) {
  const block = new Set(), allow = new Set();
  let conditionalDepth = 0, skipped = 0;
  for (const original of text.split(/\r?\n/)) {
    const line = original.trim();
    if (line.startsWith("!#if ")) { conditionalDepth++; continue; }
    if (line.startsWith("!#endif")) { conditionalDepth = Math.max(0, conditionalDepth - 1); continue; }
    if (conditionalDepth || !line || line.startsWith("!") || line.startsWith("[")) continue;
    // DNS cannot scope an exception to a page, resource type or first-party context.
    // Promoting such an exception globally disables unrelated advertising blocks.
    const exception = /^@@\|\|([a-z0-9.-]+)\^$/i.exec(line);
    if (exception && validDomain(exception[1].toLowerCase())) {
      allow.add(exception[1].toLowerCase()); continue;
    }
    const rule = /^\|\|([a-z0-9.-]+)\^$/i.exec(line);
    if (!exceptionsOnly && rule && validDomain(rule[1].toLowerCase())) block.add(rule[1].toLowerCase());
    else skipped++;
  }
  return { block: [...block], allow: [...allow], skipped };
}

export function matches(domain, set) {
  let remaining = domain.toLowerCase().replace(/\.$/, "");
  while (remaining.includes(".")) {
    if (set instanceof Set ? set.has(remaining) : containsSorted(set, remaining)) return true;
    remaining = remaining.slice(remaining.indexOf(".") + 1);
  }
  return false;
}

function containsSorted(domains, target) {
  let low = 0, high = domains.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1, value = domains[mid];
    if (value === target) return true;
    if (value < target) low = mid + 1; else high = mid - 1;
  }
  return false;
}

export function compile(data, customAllow = []) {
  if (!data || data.version !== 1 || !Array.isArray(data.block) || data.block.length < 100 ||
      !Array.isArray(data.allow) || !Array.isArray(data.sources)) throw new Error("Invalid filter data");
  // Binary search avoids rebuilding a large Set inside the Free plan's CPU budget.
  return { data, block: data.block, allow: new Set([...DEFAULT_ALLOW, ...data.allow, ...customAllow]) };
}

export function isBlocked(domain, state) {
  return !matches(domain, state.allow) && matches(domain, state.block);
}

export async function readLimited(body, limit) {
  if (!body) return new Uint8Array();
  const reader = body.getReader(), chunks = [];
  let length = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    length += result.value.byteLength;
    if (length > limit) { await reader.cancel(); throw new Error("Body too large"); }
    chunks.push(result.value);
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

export async function downloadRules(fetcher = fetch) {
  const block = new Set(), allow = new Set(), sources = [];
  // Fixed official URLs: no user-controlled URL, redirects, or scripts.
  for (const source of SOURCES) {
    const response = await fetcher(source.url, { redirect: "manual", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("Filter download failed");
    const bytes = await readLimited(response.body, 8 * 1024 * 1024);
    if (bytes.length < 200) throw new Error("Filter file too small");
    const text = new TextDecoder().decode(bytes), parsed = parseRules(text, source.exceptionsOnly);
    if (!/!.*(?:title|ublock|easylist)/i.test(text.slice(0, 10000))) throw new Error("Unexpected filter format");
    for (const domain of parsed.block) block.add(domain);
    for (const domain of parsed.allow) allow.add(domain);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    sources.push({ name: source.name, url: source.url, sha256: [...digest].map(n => n.toString(16).padStart(2, "0")).join(""),
      bytes: bytes.length, domainRules: parsed.block.length, exceptions: parsed.allow.length, skipped: parsed.skipped });
  }
  if (block.size < 100 || block.size > MAX_DOMAIN_RULES) throw new Error("Unexpected filter size");
  return { version: 1, updated: new Date().toISOString(), block: [...block].sort(), allow: [...allow].sort(), sources };
}
