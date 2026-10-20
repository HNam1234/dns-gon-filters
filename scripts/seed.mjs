import { mkdir, readFile, writeFile } from "node:fs/promises";
import { downloadRules, SOURCES, validDomain } from "../src/filter.js";
const originals = new Map();
const data = await downloadRules(async (url, options) => {
  const response = await fetch(url, options);
  originals.set(url, response.clone().text());
  return response;
});
data.customAllow = JSON.parse(await readFile("custom-allowlist.json", "utf8"));
if (!Array.isArray(data.customAllow) || data.customAllow.length > 200 || !data.customAllow.every(validDomain))
  throw new Error("Invalid custom allowlist");
await mkdir("data", { recursive: true });
await writeFile("data/seed.json", JSON.stringify(data));
await mkdir("source-lists", { recursive: true });
for (let index = 0; index < SOURCES.length; index++) {
  await writeFile(`source-lists/${index + 1}.txt`, await originals.get(SOURCES[index].url));
}
console.log(JSON.stringify({ updated: data.updated, rules: data.block.length, exceptions: data.allow.length, sources: data.sources }));
