// DNSGon v0.3 private Worker bridge. No fetches, raw captures or credential logs.
(function () {
  'use strict';
  var VERSION = '0.3.0', STATUS = 'dnsgon.private-worker.status.v1';
  function done(value) { $done(value || {}); }
  function storeRead(key) { return typeof $persistentStore !== 'undefined' && $persistentStore.read ? $persistentStore.read(key) : null; }
  function readJson(key) { try { var raw = storeRead(key); return raw && raw.length < 16384 ? JSON.parse(raw) : null; } catch (_) { return null; } }
  function record(reason) {
    // One local overwritten status only; never keys, URLs, video IDs, or headers.
    try { $persistentStore.write(JSON.stringify({ version: VERSION, reason: reason, time: Date.now() }), STATUS); } catch (_) {}
  }
  function getEntry() {
    // teaoea/shell uses this schema; the old bridge accidentally read Maasea's key.
    var entry = readJson('ytads.onesie.youtube.v1');
    if (entry && entry.schema === 1 && entry.platform === 'youtube' && entry.expiresAt > Date.now()) return entry;
    var legacy = readJson('YouTubeConfig');
    return legacy && legacy.youtube || null;
  }
  function readVarint(bytes, pos) {
    var value = 0, factor = 1;
    for (var i = 0; i < 10; i++) {
      if (pos >= bytes.length) throw Error('truncated');
      var b = bytes[pos++]; value += (b & 127) * factor;
      if (!Number.isSafeInteger(value)) throw Error('unsafe-integer');
      if (!(b & 128)) return { value: value, next: pos };
      factor *= 128;
    }
    throw Error('varint');
  }
  function fields(bytes) {
    var out = [], pos = 0;
    while (pos < bytes.length) {
      if (out.length >= 30000) throw Error('field-limit');
      var tag = readVarint(bytes, pos); pos = tag.next;
      var no = Math.floor(tag.value / 8), wire = tag.value % 8;
      if (!no) throw Error('tag');
      if (wire === 0) { pos = readVarint(bytes, pos).next; continue; }
      if (wire === 1 || wire === 5) { pos += wire === 1 ? 8 : 4; if (pos > bytes.length) throw Error('fixed'); continue; }
      if (wire !== 2) throw Error('wire');
      var len = readVarint(bytes, pos); pos = len.next;
      var end = pos + len.value; if (end > bytes.length) throw Error('length');
      out.push({ no: no, value: bytes.subarray(pos, end) }); pos = end;
    }
    return out;
  }
  function bytesOf(value) {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return null;
  }
  function b64(value) {
    var s = String(value).replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    var raw = atob(s), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function equal(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    var d = 0; for (var i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0;
  }
  try {
    var target = String($request.url || ''), args = typeof $argument === 'string' ? $argument : '';
    var entry = getEntry();
    if (/^https:\/\/www\.youtube\.com\/robots\.txt\?dnsgon-check=1$/i.test(target)) {
      var status = readJson(STATUS), report = {
        module: 'DNSGon Private Worker', version: VERSION, https_interception: 'working',
        cache: entry && entry.clientKey && entry.encryptKey ? 'present' : 'missing-or-expired',
        last_init: status || { reason: 'not-observed' }
      };
      return done({ response: { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify(report, null, 2) } });
    }
    if (!/^https:\/\/(?:[a-z0-9-]+\.)*googlevideo\.com\/initplayback(?:\?|$)/i.test(target)) return done({});
    var worker = (args.match(/(?:^|&)worker_url=([^&]+)/) || [])[1];
    worker = worker ? decodeURIComponent(worker) : '';
    if (!/^https:\/\/[a-z0-9.-]+\/[^\s?#]+$/i.test(worker)) { record('invalid-worker-url'); return done({}); }
    if (!entry || !entry.clientKey || !entry.encryptKey) { record('missing-or-expired-cache'); return done({}); }
    var clientKey = b64(entry.clientKey);
    if (clientKey.length !== 32) { record('invalid-cache-key'); return done({}); }
    var body = bytesOf($request.body || $request.bodyBytes);
    if (!body || !body.length || body.length > 4194304) { record('unsupported-body'); return done({}); }
    var outer = fields(body), innerField = outer.find(function (f) { return f.no === 3; });
    var inner = innerField ? fields(innerField.value) : [];
    var encryptedKey = inner.find(function (f) { return f.no === 5; });
    if (!encryptedKey || !equal(encryptedKey.value, b64(entry.encryptKey))) { record('cache-key-mismatch'); return done({}); }
    var headers = {};
    Object.keys($request.headers || {}).forEach(function (key) {
      if (!/^(host|cookie|authorization|proxy-authorization|x-goog-authuser|x-youtube-identity-token)$/i.test(key)) headers[key] = $request.headers[key];
    });
    record('redirected-to-private-worker');
    done({ url: worker + '?ck=' + encodeURIComponent(entry.clientKey) + '&target=' + encodeURIComponent(target), headers: headers });
  } catch (_) { record('parse-fallback'); done({}); }
})();
