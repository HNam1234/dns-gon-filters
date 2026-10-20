import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRules, compile, isBlocked, validDomain } from "../src/filter.js";
import { parseQuery, upstreamQuery, blockedResponse, inspectAnswer, readName } from "../src/dns.js";
import { createHandler } from "../src/index.js";

const token = "a".repeat(64);
const endpoint = `https://test.workers.dev/${token}/dns-query`;
function query(name, type = 1) {
  const labels = name ? name.split(".").flatMap(label => [label.length, ...Buffer.from(label)]) : [];
  return Uint8Array.from([0x12, 0x34, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, ...labels, 0, type >> 8, type & 255, 0, 1]);
}
function fixture() {
  const data = { version: 1, updated: new Date().toISOString(), block: ["ads.test", "graph.facebook.com", ...Array.from({ length: 110 }, (_, i) => `ad${i}.test`)].sort(), allow: [], sources: [{ name: "fixture" }] };
  const storage = new Map([["filters-v1", data]]);
  return { DNS_TOKEN: token, FILTERS: {
    async get(key) { return storage.get(key) ?? null; },
    async put(key, value) { storage.set(key, JSON.parse(value)); },
  } };
}
const request = (name, extra = {}) => new Request(endpoint, { method: "POST",
  headers: { "Content-Type": "application/dns-message", "X-Forwarded-For": "192.0.2.55", Cookie: "private=value" }, body: query(name), ...extra });
function answer(queryBytes) {
  const output = new Uint8Array(queryBytes.length); output.set(queryBytes); output[2] = 0x81; output[3] = 0x80;
  return output;
}

test("browser-context rules, regexes, scripts and conditionals never become domain blocks", () => {
  const rules = parseRules("||ads.test^\n||needed.test^$third-party\n||media.test/path\n!#if env_firefox\n||conditional.test^\n!#else\n||other.test^\n!#endif\nexample.test##.ad\n@@||ads.test^$domain=example.test");
  assert.deepEqual(rules.block, ["ads.test"]);
  assert.deepEqual(rules.allow, ["ads.test"]);
});

test("unbreak sources only contribute exceptions; suffix matches honor label boundaries", () => {
  assert.deepEqual(parseRules("||ads.test^\n@@||needed.test^", true).block, []);
  const state = compile(fixtureData());
  assert.equal(isBlocked("sub.ads.test", state), true);
  assert.equal(isBlocked("notads.test", state), false);
  assert.equal(isBlocked("graph.facebook.com", state), false);
});
function fixtureData() { return { version: 1, block: ["ads.test", "graph.facebook.com", ...Array.from({ length: 100 }, (_, i) => `ad${i}.test`)].sort(), allow: [], sources: [] }; }

test("compression loops and truncation are rejected with bounded work", () => {
  assert.throws(() => readName(Uint8Array.of(0xc0, 0), 0), /pointer/);
  const data = query("example.com");
  for (let size = 0; size < data.length; size++) assert.throws(() => parseQuery(data.slice(0, size)));
  const multiple = data.slice(); multiple[5] = 2; assert.throws(() => parseQuery(multiple));
});

test("rebuilding strips EDNS client subnet and retains DNSSEC DO and question types", () => {
  const original = query("example.com", 65), extended = new Uint8Array(original.length + 19);
  extended.set(original); extended[11] = 1;
  extended.set([0, 0, 41, 4, 208, 0, 0, 128, 0, 0, 8, 0, 8, 0, 4, 0, 1, 2, 3], original.length);
  const parsed = parseQuery(extended), rebuilt = upstreamQuery(parsed);
  assert.equal(parsed.type, 65); assert.equal(parsed.dnssec, true);
  assert.equal(rebuilt.length, original.length + 11);
  assert.equal(parseQuery(rebuilt).dnssec, true);
  assert.equal(parseQuery(query("", 48)).name, "");
});

test("wrong credentials and missing setup cannot trigger DNS or read filter storage", async () => {
  let calls = 0;
  const handler = createHandler(async () => { calls++; throw new Error("must not run"); });
  const env = fixture(); env.FILTERS.get = async () => { throw new Error("must not read"); };
  assert.equal((await handler(new Request("https://test.workers.dev/wrong/dns-query"), env)).status, 404);
  assert.equal((await handler(request("example.com"), {})).status, 503);
  assert.equal(calls, 0);
});

test("blocked domains do not leave the Worker; NXDOMAIN retains transaction ID", async () => {
  const handler = createHandler(async () => { throw new Error("blocked query leaked"); });
  const response = await handler(request("ads.test"), fixture());
  assert.equal(response.status, 200);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(bytes[0], 0x12); assert.equal(bytes[1], 0x34); assert.equal(bytes[3] & 15, 3);
});

test("allowed app domains reach only the fixed encrypted upstream without identifying headers", async () => {
  let calls = 0;
  const handler = createHandler(async (url, options) => {
    calls++; assert.equal(url, "https://cloudflare-dns.com/dns-query");
    assert.equal(options.method, "POST"); assert.equal(options.redirect, "manual");
    assert.deepEqual(Object.keys(options.headers).sort(), ["Accept", "Content-Type"]);
    return new Response(answer(options.body), { headers: { "Content-Type": "application/dns-message" } });
  });
  assert.equal((await handler(request("graph.facebook.com"), fixture())).status, 200);
  assert.equal(calls, 1);
});

test("GET is supported and does not enable arbitrary proxy destinations", async () => {
  let calls = 0;
  const handler = createHandler(async (url, options) => {
    calls++; assert.equal(url, "https://cloudflare-dns.com/dns-query");
    return new Response(answer(options.body), { headers: { "Content-Type": "application/dns-message" } });
  });
  const dns = Buffer.from(query("example.com")).toString("base64url");
  assert.equal((await handler(new Request(`${endpoint}?dns=${dns}`), fixture())).status, 200);
  assert.equal((await handler(new Request(`${endpoint}?dns=${dns}&upstream=http://127.0.0.1`), fixture())).status, 400);
  assert.equal(calls, 1);
});

test("a blocked CNAME is filtered but app allowlist takes priority", async () => {
  const cnameAnswer = (body) => {
    const prefix = answer(body), target = query("ads.test").slice(12, -4), result = new Uint8Array(prefix.length + 12 + target.length);
    result.set(prefix); result[7] = 1;
    result.set([0xc0, 0x0c, 0, 5, 0, 1, 0, 0, 0, 60, 0, target.length], prefix.length);
    result.set(target, prefix.length + 12); return result;
  };
  const handler = createHandler(async (_, options) => new Response(cnameAnswer(options.body), { headers: { "Content-Type": "application/dns-message" } }));
  let response = await handler(request("example.com"), fixture());
  assert.equal(new Uint8Array(await response.arrayBuffer())[3] & 15, 3);
  response = await handler(request("graph.facebook.com"), fixture());
  assert.equal(new Uint8Array(await response.arrayBuffer())[3] & 15, 0);
});

test("upstream errors, redirects and mismatched answers fail without plaintext fallback", async () => {
  const handler = createHandler(async () => new Response("bad", { status: 302 }));
  assert.equal((await handler(request("example.com"), fixture())).status, 502);
  const packet = answer(query("other.test"));
  assert.throws(() => inspectAnswer(packet, parseQuery(query("example.com"))), /mismatch/);
});

test("private allowlist validates domains and takes effect without changing blocklists", async () => {
  const env = fixture();
  const handler = createHandler(async (_, options) => new Response(answer(options.body), { headers: { "Content-Type": "application/dns-message" } }));
  const url = `https://test.workers.dev/${token}/allowlist`;
  assert.equal((await handler(new Request(url, { method: "PUT", body: JSON.stringify(["ads.test"]) }), env)).status, 200);
  const response = await handler(request("ads.test"), env);
  assert.equal(new Uint8Array(await response.arrayBuffer())[3] & 15, 0);
  assert.equal((await handler(new Request(url, { method: "PUT", body: JSON.stringify(["com"]) }), env)).status, 400);
  assert.equal(validDomain("http://127.0.0.1"), false);
});

test("health exposes status only, not token, queried domain or request headers", async () => {
  const response = await createHandler()(new Request("https://test.workers.dev/health"), fixture());
  const body = await response.text();
  assert.equal(response.status, 200); assert.equal(body.includes(token), false);
  assert.equal(body.includes("graph.facebook.com"), false); assert.equal(body.includes("192.0.2.55"), false);
  assert.equal(JSON.parse(body).queryLogs, false);
});
