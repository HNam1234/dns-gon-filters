// DNS Gon, GPL-3.0-or-later. Ad metadata only, for JSON/HTML on YouTube Web.
// No requests, storage, logging, credentials, licence or account-state changes.
(function () {
  'use strict';
  var body = $response.body;
  if (typeof body !== 'string' || body.length > 2097152) return $done({});
  var adKeys = new Set(['playerAds', 'adPlacements', 'adSlots', 'adBreakHeartbeatParams']);
  var adRenderers = new Set(['adSlotRenderer', 'adPlacementRenderer', 'displayAdRenderer',
    'promotedVideoRenderer', 'promotedSparklesWebRenderer', 'promotedSparklesTextSearchRenderer',
    'inFeedAdLayoutRenderer', 'adActionInterstitialRenderer']);
  var removed = 0, visited = 0;

  function adItem(item) {
    return item && typeof item === 'object' && Object.keys(item).some(function (key) { return adRenderers.has(key); });
  }
  function clean(value, depth) {
    if (depth > 80 || ++visited > 100000) throw new Error('Bounded traversal exceeded');
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      return value.filter(function (item) { if (adItem(item)) { removed++; return false; } return true; })
        .map(function (item) { return clean(item, depth + 1); });
    }
    Object.keys(value).forEach(function (key) {
      if (adKeys.has(key)) { delete value[key]; removed++; }
      else value[key] = clean(value[key], depth + 1);
    });
    return value;
  }
  function objectEnd(text, start) {
    var depth = 0, quoted = false, escaped = false;
    for (var i = start; i < text.length; i++) {
      var c = text[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') { if (--depth === 0) return i + 1; }
    }
    return -1;
  }
  try {
    var result;
    if (/^\s*[\[{]/.test(body)) {
      result = JSON.stringify(clean(JSON.parse(body), 0));
    } else if (/<html|<!doctype\s+html/i.test(body)) {
      var re = /(?:\b(?:var|let|const)\s+(?:ytInitialPlayerResponse|ytInitialData)|window\[['"](?:ytInitialPlayerResponse|ytInitialData)['"]\])\s*=\s*/g;
      var match, cursor = 0, chunks = [], changed = 0;
      while ((match = re.exec(body)) && changed < 8) {
        var start = re.lastIndex;
        if (body[start] !== '{') continue;
        var end = objectEnd(body, start);
        if (end < 0) break;
        var parsed;
        try { parsed = JSON.parse(body.slice(start, end)); } catch (_) { continue; }
        var before = removed;
        var replacement = JSON.stringify(clean(parsed, 0)).replace(/</g, '\\u003c');
        if (removed !== before) {
          chunks.push(body.slice(cursor, start), replacement); cursor = end; changed++;
        }
        re.lastIndex = end;
      }
      result = chunks.length ? chunks.join('') + body.slice(cursor) : body;
    } else return $done({});
    return $done(removed ? { body: result } : {});
  } catch (_) {
    // On malformed/unsupported payloads, keep the original response intact.
    return $done({});
  }
})();
