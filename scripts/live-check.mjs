import { readFile, writeFile } from "node:fs/promises";
import { parseQuery, inspectAnswer, readName } from "../src/dns.js";
const token = JSON.parse(await readFile("secrets/deployment.json", "utf8")).DNS_TOKEN;
const origin = "https://dns-gon-private.myfavblueone.workers.dev";
const url = `${origin}/${token}/dns-query`;
const queries = [
  ["googleads.g.doubleclick.net", 1, "blocked"], ["ads.pubmatic.com", 1, "blocked"],
  ["pagead2.googlesyndication.com", 1, "blocked"], ["securepubads.g.doubleclick.net", 1, "blocked"],
  ["cdn.adxcontent.com", 1, "blocked"], ["bidgear-syndication.com", 1, "blocked"],
  ["cdn2.vietadx.net", 1, "blocked"], ["shortlink.linkroyal.workers.dev", 1, "blocked"],
  ["example.com", 1, "resolved"], ["apple.com", 28, "resolved"],
  ["graph.facebook.com", 1, "resolved"], ["web.whatsapp.com", 1, "resolved"],
  ["accounts.google.com", 1, "resolved"], ["login.microsoftonline.com", 1, "resolved"],
  ["streamvl.online", 1, "resolved"], ["qph.cf2.quoracdn.net", 1, "resolved"], ["cdn.viedn.net", 1, "resolved"],
  ["cloudflare.com", 65, "answered"],
];
function makeQuery(name, type) {
  return Uint8Array.from([0x12, 0x34, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0,
    ...name.split(".").flatMap(label => [label.length, ...Buffer.from(label)]), 0, type >> 8, type & 255, 0, 1]);
}
const results = [];
for (const [domain, type, expected] of queries) {
  const query = makeQuery(domain, type), started = performance.now();
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/dns-message", Accept: "application/dns-message" },
      body: query, signal: AbortSignal.timeout(12000), redirect: "error" });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!response.ok || response.headers.get("Content-Type")?.split(";")[0] !== "application/dns-message") {
      results.push({ domain, type, expected, http: response.status, pass: false, error: response.headers.get("X-DNS-Error-Type") || "HTTP failure", diagnostic: decodeURIComponent(response.headers.get("X-DNS-Diagnostic") || "") }); continue;
    }
    inspectAnswer(bytes, parseQuery(query));
    const rcode = bytes[3] & 15, answers = (bytes[6] << 8) | bytes[7];
    const pass = expected === "blocked" ? rcode === 3 : expected === "resolved" ? rcode === 0 && answers > 0 : rcode === 0;
    results.push({ domain, type, expected, http: response.status, rcode, answers, pass, milliseconds: Math.round(performance.now() - started) });
  } catch (error) { results.push({ domain, type, expected, pass: false, error: error.name }); }
}
for (const path of ["/", "/wrong/dns-query", "/" + "b".repeat(64) + "/dns-query"]) {
  const response = await fetch(origin + path, { method: "POST", headers: { "Content-Type": "application/dns-message" }, body: makeQuery("example.com", 1) });
  results.push({ check: "unauthorized request", http: response.status, pass: response.status === 404 });
}
const malformed = await fetch(url, { method: "POST", headers: { "Content-Type": "application/dns-message" }, body: Uint8Array.of(1, 2, 3) });
results.push({ check: "malformed DNS", http: malformed.status, pass: malformed.status === 400 });
const message = Buffer.from(makeQuery("example.com", 1)).toString("base64url");
const get = await fetch(`${url}?dns=${message}`);
results.push({ check: "GET DoH", http: get.status, pass: get.status === 200 });
const healthResponse = await fetch(origin + "/health");
const healthText = await healthResponse.text();
const health = JSON.parse(healthText);
results.push({ check: "health hides DNS key", pass: !healthText.includes(token) && health.queryLogs === false });
results.push({ check: "production accepts larger feeds and includes Vietnamese filters", pass: health.version === "1.0.2" && health.filterRuleLimit === 300000 && health.domainRules > 200000 && health.sources.includes("ABPVN") });
const report = { time: new Date().toISOString(), origin, scope: "synthetic DNS queries from the Windows PC, not full iPhone app testing", health, results, allPassed: results.every(result => result.pass) };
await writeFile("secrets/live-check.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
if (!report.allPassed) process.exitCode = 1;
