import { processInitplayback } from './core.js';

const MAX_REQUEST = 4 * 1024 * 1024;

function unauthorized() { return new Response('unauthorized', { status: 401, headers: { 'cache-control': 'no-store' } }); }

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const token = url.pathname.split('/').filter(Boolean)[0] || '';
    if (!env.AUTH_TOKEN || token !== env.AUTH_TOKEN) return unauthorized();
    if (request.method === 'GET' && url.pathname === `/${token}/health`) {
      return new Response(JSON.stringify({ ok: true, service: 'dnsgon-youtube-ump' }), {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
      });
    }
    if (request.method !== 'POST') return new Response('method-not-allowed', { status: 405, headers: { allow: 'POST' } });
    const target = url.searchParams.get('target'); const clientKey = url.searchParams.get('ck');
    if (!target || !clientKey) return new Response('missing-parameters', { status: 400 });
    let bytes;
    try { bytes = new Uint8Array(await request.arrayBuffer()); } catch { return new Response('invalid-body', { status: 400 }); }
    if (bytes.length > MAX_REQUEST) return new Response('request-too-large', { status: 413 });
    let result;
    try {
      result = await processInitplayback({ target, clientKey, body: { bytes, headers: Object.fromEntries(request.headers) } });
    } catch {
      return new Response('upstream-failure', { status: 502, headers: { 'cache-control': 'no-store' } });
    }
    if (result.bytes) return new Response(result.bytes, { status: result.status, headers: result.headers });
    return new Response(result.body, { status: result.status, headers: result.headers });
  }
};
