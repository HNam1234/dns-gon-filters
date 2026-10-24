import { base64Decode } from './crypto.js';
import { filterUmpResponse } from './ump.js';

const MAX_RESPONSE = 12 * 1024 * 1024;

export function validTarget(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /(?:^|\.)googlevideo\.com$/i.test(url.hostname) && /\/initplayback(?:$|[?])/i.test(url.pathname + url.search) ? url : null;
  } catch { return null; }
}

export async function processInitplayback({ target, clientKey, body, fetchImpl = fetch }) {
  const targetUrl = validTarget(target); if (!targetUrl) return { status: 400, body: 'invalid-target' };
  let key; try { key = base64Decode(clientKey); } catch { return { status: 400, body: 'invalid-client-key' }; }
  if (key.length !== 32) return { status: 400, body: 'invalid-client-key-length' };
  const headers = new Headers();
  for (const [name, value] of Object.entries(body.headers || {})) {
    if (!/^(host|content-length|connection|transfer-encoding|accept-encoding)$/i.test(name)) headers.set(name, value);
  }
  headers.set('accept-encoding', 'identity');
  let upstream;
  try { upstream = await fetchImpl(targetUrl, { method: 'POST', headers, body: body.bytes }); }
  catch { return { status: 502, body: 'upstream-failure', headers: { 'cache-control': 'no-store' } }; }
  const bytes = new Uint8Array(await upstream.arrayBuffer());
  if (bytes.length > MAX_RESPONSE) {
    const passthroughHeaders = new Headers(upstream.headers);
    passthroughHeaders.delete('content-length');
    passthroughHeaders.set('cache-control', 'no-store');
    return { status: upstream.status, headers: passthroughHeaders, bytes, changed: false, reason: 'response-too-large' };
  }
  let result;
  try { result = await filterUmpResponse(bytes, key); } catch { result = { bytes, changed: false, reason: 'filter-fallback' }; }
  const outHeaders = new Headers(upstream.headers); outHeaders.delete('content-length'); outHeaders.set('cache-control', 'no-store');
  return { status: upstream.status, headers: outHeaders, bytes: result.bytes, changed: result.changed, reason: result.reason };
}
