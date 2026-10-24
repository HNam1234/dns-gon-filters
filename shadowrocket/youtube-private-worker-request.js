// DNSGon private Worker redirector.
// Original implementation: DNSGon. It only reads the local YouTubeConfig key
// cache and redirects matching initplayback requests; it never fetches or logs.
(function () {
  'use strict';
  function readVarint(bytes, pos) {
    var value = 0, shift = 0;
    for (var i = 0; i < 5; i++) { if (pos >= bytes.length) throw Error('truncated'); var b = bytes[pos++]; value += (b & 127) * Math.pow(128, shift / 7); if (!(b & 128)) return { value: value, next: pos }; shift += 7; }
    throw Error('varint');
  }
  function fields(bytes) {
    var out = [], pos = 0;
    while (pos < bytes.length) {
      var tag = readVarint(bytes, pos); pos = tag.next; var no = Math.floor(tag.value / 8), wire = tag.value % 8;
      if (wire !== 2) { if (wire !== 0) throw Error('wire'); pos = readVarint(bytes, pos).next; out.push({ no: no, value: null }); continue; }
      var len = readVarint(bytes, pos); pos = len.next; var end = pos + len.value; if (end > bytes.length) throw Error('length');
      out.push({ no: no, value: bytes.slice(pos, end) }); pos = end;
    }
    return out;
  }
  function b64(value) {
    var s = String(value).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    var raw = atob(s), out = new Uint8Array(raw.length); for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i); return out;
  }
  function equal(a, b) { if (!a || !b || a.length !== b.length) return false; var d = 0; for (var i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }
  function done(value) { if (typeof $done === 'function') $done(value || {}); }
  try {
    var args = typeof $argument === 'string' ? $argument : '';
    var worker = (args.match(/(?:^|&)worker_url=([^&]+)/) || [])[1];
    worker = worker ? decodeURIComponent(worker) : '';
    if (!/^https:\/\/[a-z0-9.-]+\/[^\s?#]+$/i.test(worker)) return done({});
    var configRaw = typeof $persistentStore !== 'undefined' && $persistentStore.read ? $persistentStore.read('YouTubeConfig') : null;
    var config = configRaw ? JSON.parse(configRaw) : {};
    var ua = String(($request && $request.headers && ($request.headers['User-Agent'] || $request.headers['user-agent'])) || '').toLowerCase();
    var platform = ua.indexOf('music') >= 0 ? 'youtubeMusic' : 'youtube';
    var entry = config[platform];
    if (!entry || !entry.clientKey || !entry.encryptKey || !$request || !$request.body) return done({});
    var outer = fields(new Uint8Array($request.body));
    var innerField = outer.find(function (f) { return f.no === 3 && f.value; });
    var inner = innerField ? fields(innerField.value) : [];
    var encryptedKeyField = inner.find(function (f) { return f.no === 5 && f.value; });
    if (!encryptedKeyField || !equal(encryptedKeyField.value, b64(entry.encryptKey))) return done({});
    var target = String($request.url || '');
    if (!/^https:\/\/(?:[a-z0-9-]+\.)*googlevideo\.com\/initplayback(?:\?|$)/i.test(target)) return done({});
    var sep = worker.indexOf('?') >= 0 ? '&' : '?';
    done({ url: worker + sep + 'ck=' + encodeURIComponent(entry.clientKey) + '&target=' + encodeURIComponent(target) });
  } catch (_) { done({}); }
})();
