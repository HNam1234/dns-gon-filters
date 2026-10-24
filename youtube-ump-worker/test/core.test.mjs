import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processInitplayback, validTarget } from '../src/core.js';

test('target validation prevents the Worker becoming an open proxy', () => {
  assert.ok(validTarget('https://rr1.googlevideo.com/initplayback?x=1'));
  assert.equal(validTarget('https://googlevideo.com.evil.test/initplayback'), null);
  assert.equal(validTarget('https://example.com/initplayback'), null);
  assert.equal(validTarget('http://rr1.googlevideo.com/initplayback'), null);
  assert.equal(validTarget('https://rr1.googlevideo.com/other/initplayback'), null);
  assert.equal(validTarget('https://rr1.googlevideo.com:444/initplayback'), null);
  assert.equal(validTarget('https://user:password@rr1.googlevideo.com/initplayback'), null);
});

test('follows only bounded Google-video initplayback redirects', async () => {
  const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
  let calls = 0;
  const result = await processInitplayback({ target: 'https://rr1.googlevideo.com/initplayback', clientKey: key,
    body: { bytes: Uint8Array.of(1) }, fetchImpl: async () => ++calls === 1
      ? new Response(null, { status: 307, headers: { location: 'https://rr2.googlevideo.com/initplayback?x=1' } })
      : new Response(Uint8Array.of(1, 2, 3)) });
  assert.equal(calls, 2); assert.equal(result.status, 200);
  const rejected = await processInitplayback({ target: 'https://rr1.googlevideo.com/initplayback', clientKey: key,
    body: { bytes: Uint8Array.of(1) }, fetchImpl: async () => new Response(null, { status: 307,
      headers: { location: 'https://outside.example/initplayback' } }) });
  assert.equal(rejected.status, 502); assert.equal(rejected.body, 'upstream-redirect-rejected');
});

test('upstream request uses identity encoding and passes through safely when body is unsupported', async () => {
  let seen;
  const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
  const result = await processInitplayback({
    target: 'https://rr1.googlevideo.com/initplayback?x=1', clientKey: key,
    body: { bytes: Uint8Array.from([0xff, 0xff]), headers: { 'content-type': 'application/octet-stream', host: 'evil', cookie: 'session=secret', authorization: 'Bearer secret', 'proxy-authorization': 'Basic secret' } },
    fetchImpl: async (url, init) => { seen = { url: String(url), init }; return new Response(Uint8Array.from([1, 2, 3]), { status: 200, headers: { 'content-type': 'application/octet-stream' } }); }
  });
  assert.equal(result.status, 200);
  assert.deepEqual(Array.from(result.bytes), [1, 2, 3]);
  assert.equal(seen.init.headers.get('accept-encoding'), 'identity');
  assert.equal(seen.init.headers.has('host'), false);
  assert.equal(seen.init.headers.has('cookie'), false);
  assert.equal(seen.init.headers.has('authorization'), false);
  assert.equal(seen.init.headers.has('proxy-authorization'), false);
  assert.equal(seen.init.redirect, 'manual');
  assert.equal(result.headers.get('x-dnsgon-version'), '0.3.0');
});

test('a 307 without a Location remains a passthrough response', async () => {
  const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
  const result = await processInitplayback({ target: 'https://rr1.googlevideo.com/initplayback', clientKey: key,
    body: { bytes: Uint8Array.of(1) }, fetchImpl: async () => new Response(null, { status: 307 }) });
  assert.equal(result.status, 307); assert.equal(result.bytes.length, 0);
});
