import { MAX_DOMAIN_RULES, validDomain } from "../src/filter.js";

export function applyCustomRules(data, block, allow) {
  for (const domains of [block, allow]) {
    if (!Array.isArray(domains) || domains.length > 200 || !domains.every(validDomain))
      throw new Error("Custom rules must contain at most 200 lower-case domain names");
  }
  const merged = [...new Set([...data.block, ...block])].sort();
  if (merged.length > MAX_DOMAIN_RULES) throw new Error("Too many domain rules");
  // Keep owner exceptions separate: runtime allow rules always take priority.
  return { ...data, block: merged, customBlock: [...new Set(block)].sort(), customAllow: [...new Set(allow)].sort() };
}
