import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { OnesieRequest } from 'googlevideo/protos';

const code = readFileSync(new URL('../../shadowrocket/youtube-private-worker-request.js', import.meta.url), 'utf8');
const client = new Uint8Array(32).fill(7), encryptedClientKey = new Uint8Array(256).fill(88);
const state = { schema: 1, platform: 'youtube', expiresAt: Date.now() + 3600000,
  clientKey: Buffer.from(client).toString('base64'), encryptKey: Buffer.from(encryptedClientKey).toString('base64') };
const requestBody = OnesieRequest.encode({ urls: [], bufferedRanges: [], innertubeRequest: {
  encryptedClientKey, encryptedOnesieInnertubeRequest: new Uint8Array(300).fill(42),
  iv: new Uint8Array(16), hmac: new Uint8Array(32), enableAdPlacementsPreroll: true
} }).finish();

function run({ entry = state, body = requestBody, url = 'https://rr1---sn-test.googlevideo.com/initplayback?x=1' } = {}) {
  let result; const cache = new Map();
  if (entry) cache.set('ytads.onesie.youtube.v1', JSON.stringify(entry));
  vm.runInNewContext(code, { Uint8Array, ArrayBuffer, atob, Date, Number,
    $request: { url, body, headers: { 'User-Agent': 'com.google.ios.youtube/21', Cookie: 'secret', Authorization: 'secret' } },
    $argument: 'worker_url=https://worker.example/token', $done(value) { result = value; },
    $persistentStore: { read(key) { return cache.get(key); }, write(value, key) { cache.set(key, value); return true; } }
  });
  return { result, status: JSON.parse(cache.get('dnsgon.private-worker.status.v1') || 'null') };
}

test('bridge uses actual upstream cache key and handles multi-byte protobuf lengths', () => {
  const { result, status } = run();
  assert.equal(new URL(result.url).hostname, 'worker.example');
  assert.equal(new URL(result.url).searchParams.get('ck'), state.clientKey);
  assert.equal(new URL(result.url).searchParams.get('target'), 'https://rr1---sn-test.googlevideo.com/initplayback?x=1');
  assert.equal(Object.keys(result.headers).some(k => /cookie|authorization/i.test(k)), false);
  assert.equal(status.reason, 'redirected-to-private-worker');
  assert.equal(JSON.stringify(status).includes(state.clientKey), false);
});

test('bridge handles typed-array subviews without including unrelated bytes', () => {
  const wrapped = new Uint8Array(requestBody.length + 10); wrapped.set(requestBody, 5);
  assert.ok(run({ body: wrapped.subarray(5, -5) }).result.url);
});

for (const [name, options, reason] of [
  ['missing cache', { entry: null }, 'missing-or-expired-cache'],
  ['expired cache', { entry: { ...state, expiresAt: 1 } }, 'missing-or-expired-cache'],
  ['mismatched key', { entry: { ...state, encryptKey: Buffer.from(new Uint8Array(256).fill(99)).toString('base64') } }, 'cache-key-mismatch'],
  ['truncated request', { body: requestBody.subarray(0, 5) }, 'parse-fallback']
]) test(`bridge passes through ${name} with sanitized local status`, () => {
  const { result, status } = run(options); assert.equal(result.url, undefined); assert.equal(status.reason, reason);
});

test('diagnostic route reports interception/cache status without keys, token or request contents', () => {
  const { result } = run({ url: 'https://www.youtube.com/robots.txt?dnsgon-check=1' });
  const body = JSON.parse(result.response.body);
  assert.equal(body.https_interception, 'working'); assert.equal(body.cache, 'present');
  assert.equal(result.response.body.includes(state.clientKey), false);
  assert.equal(result.response.body.includes(state.encryptKey), false);
  assert.equal(result.response.body.includes('worker.example'), false);
});
