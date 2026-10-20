import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { applyCustomRules } from "../scripts/custom-rules.mjs";
import { compile, isBlocked } from "../src/filter.js";

const base = () => ({ version: 1, block: Array.from({ length: 110 }, (_, i) => `ad${i}.test`).sort(), allow: [], sources: [] });

test("owner rules block the missed advertising hosts without blocking their siblings or shared media hosts", async () => {
  const block = JSON.parse(await readFile(new URL("../custom-blocklist.json", import.meta.url), "utf8"));
  assert.ok(block.includes("cdn2.vietadx.net"));
  assert.ok(block.includes("shortlink.linkroyal.workers.dev"));
  const state = compile(applyCustomRules(base(), block, []));
  for (const domain of block) assert.equal(isBlocked(domain, state), true);
  for (const domain of ["other.vietadx.net", "other.linkroyal.workers.dev", "qph.cf2.quoracdn.net", "streamvl.online", "graph.facebook.com"])
    assert.equal(isBlocked(domain, state), false, domain);
});

test("owner allowlist can recover a blocked domain and invalid entries cannot expand blocking", () => {
  const data = applyCustomRules(base(), ["ads.test", "ads.test"], ["ads.test"]);
  assert.equal(isBlocked("child.ads.test", compile(data, data.customAllow)), false);
  assert.equal(data.block.filter(domain => domain === "ads.test").length, 1);
  for (const invalid of [["com"], ["*.example.com"], ["https://example.com/path"], ["EXAMPLE.COM"], [null], Array(201).fill("ads.test")])
    assert.throws(() => applyCustomRules(base(), invalid, []), /Custom rules/);
  assert.throws(() => applyCustomRules(base(), [], {}), /Custom rules/);
});
