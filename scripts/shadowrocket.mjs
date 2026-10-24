import { readFile, writeFile } from 'node:fs/promises';
import { parseRules, DEFAULT_ALLOW, validDomain } from '../src/filter.js';

// Keep the much larger HaGeZi data in the DNS service. This mobile rule set
// uses only unconditional domain rules from uBlock, EasyList and ABPVN.
export async function makeShadowrocketList() {
  const block = new Set(), allow = new Set(DEFAULT_ALLOW);
  const seed = JSON.parse(await readFile('data/seed.json', 'utf8'));
  for (const index of [1, 2, 3, 4, 7]) {
    const { block: hosts, allow: exceptions } = parseRules(await readFile(`source-lists/${index}.txt`, 'utf8'), index === 3);
    hosts.forEach(h => block.add(h));
    exceptions.forEach(h => allow.add(h));
  }
  for (const h of seed.customBlock || []) if (validDomain(h)) block.add(h);
  for (const h of seed.customAllow || []) if (validDomain(h)) allow.add(h);
  // Shared player/banner host: never turn a path-specific fix into a DNS block.
  allow.add('streamvl.online');
  const hosts = [...block].sort();
  const lines = [
    '# DNS Gon - domain rules for Shadowrocket; GPL-3.0-or-later',
    '# Derived from the attributed inputs in source-lists/. See COPYING-uAssets.txt.',
    `# Updated: ${seed.updated}`, `# Domain rules: ${hosts.length}`,
    ...hosts.map(h => `DOMAIN-SUFFIX,${h}`),
  ];
  await writeFile('data/shadowrocket-ads.list', lines.join('\n') + '\n');
  const exceptions = [...allow].sort();
  await writeFile('data/shadowrocket-allow.list',
    '# Apply DIRECT before the advertising REJECT rule set.\n' + exceptions.map(h => `DOMAIN-SUFFIX,${h}`).join('\n') + '\n');
  return { domains: hosts.length, exceptions: exceptions.length };
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('scripts/shadowrocket.mjs'))
  console.log(JSON.stringify(await makeShadowrocketList()));
