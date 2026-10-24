import { base64Decode } from './crypto.js';
import { filterUmpResponse } from './ump.js';

const MAX_RESPONSE = 12 * 1024 * 1024;

export function validTarget(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && /(?:^|\.)googlevideo\.com$/i.test(url.hostname) && url.pathname === '/initplayback' ? url : null;
  } catch { return null; }
}

export async function processInitplayback({ target, clientKey, body, fetchImpl = fetch }) {
  const targetUrl = validTarget(target); if (!targetUrl) return { status: 400, body: 'invalid-target' };
  let key; try { key = base64Decode(clientKey); } catch { return { status: 400, body: 'invalid-client-key' }; }
  if (key.length !== 32) return { status: 400, body: 'invalid-client-key-length' };
  const headers = new Headers();
  for (const [name, value] of Object.entries(body.headers || {})) {
    if (!/^(host|content-length|connection|transfer-encoding|accept-encoding|cookie|authorization|proxy-authorization)$/i.test(name)) headers.set(name, value);
  }
  headers.set('accept-encoding', 'identity');
  let upstream, current = targetUrl;
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      upstream = await fetchImpl(current, { method: 'POST', headers, body: body.bytes, redirect: 'manual' });
      if (upstream.status !== 307 && upstream.status !== 308) break;
      const location = upstream.headers.get('location') || upstream.headers.get('x-redirect-location');
      // Some initplayback 307s carry binary protocol control parts, not an HTTP
      // Location. Preserve that response for the client instead of inventing a URL.
      if (!location) break;
      const next = location && validTarget(new URL(location, current).href);
      if (!next) {
        let check = 'missing-location';
        if (location) {
          const candidate = new URL(location, current);
          check = candidate.protocol !== 'https:' ? 'non-https' : candidate.pathname !== '/initplayback' ? 'different-path' : 'non-allowlisted-host-or-port';
        }
        return { status: 502, body: 'upstream-redirect-rejected', headers: { 'x-dnsgon-redirect-check': check } };
      }
      if (redirects === 3) return { status: 502, body: 'upstream-redirect-limit' };
      void upstream.body?.cancel().catch(() => {});
      current = next;
    }
  }
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
  outHeaders.set('x-dnsgon-filter', result.reason);
  outHeaders.set('x-dnsgon-version', '0.3.0');
  return { status: upstream.status, headers: outHeaders, bytes: result.bytes, changed: result.changed, reason: result.reason };
}
