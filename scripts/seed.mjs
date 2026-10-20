import { mkdir, readFile, writeFile } from "node:fs/promises";
import { downloadRules, SOURCES } from "../src/filter.js";
import { applyCustomRules } from "./custom-rules.mjs";
const originals = new Map();
let data = await downloadRules(async (url, options) => {
  const response = await fetch(url, options);
  originals.set(url, response.clone().text());
  return response;
});
data = applyCustomRules(data,
  JSON.parse(await readFile("custom-blocklist.json", "utf8")),
  JSON.parse(await readFile("custom-allowlist.json", "utf8")));
await mkdir("data", { recursive: true });
await writeFile("data/seed.json", JSON.stringify(data));
await mkdir("source-lists", { recursive: true });
for (let index = 0; index < SOURCES.length; index++) {
  await writeFile(`source-lists/${index + 1}.txt`, await originals.get(SOURCES[index].url));
}
console.log(JSON.stringify({ updated: data.updated, rules: data.block.length, exceptions: data.allow.length, sources: data.sources }));
