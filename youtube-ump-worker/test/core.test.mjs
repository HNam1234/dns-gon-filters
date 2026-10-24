import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processInitplayback, validTarget } from '../src/core.js';

test('target validation prevents the Worker becoming an open proxy', () => {
  assert.ok(validTarget('https://rr1.googlevideo.com/initplayback?x=1'));
  assert.equal(validTarget('https://googlevideo.com.evil.test/initplayback'), null);
  assert.equal(validTarget('https://example.com/initplayback'), null);
  assert.equal(validTarget('http://rr1.googlevideo.com/initplayback'), null);
});

test('upstream request uses identity encoding and passes through safely when body is unsupported', async () => {
  let seen;
  const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
  const result = await processInitplayback({
    target: 'https://rr1.googlevideo.com/initplayback?x=1', clientKey: key,
    body: { bytes: Uint8Array.from([0xff, 0xff]), headers: { 'content-type': 'application/octet-stream', host: 'evil' } },
    fetchImpl: async (url, init) => { seen = { url: String(url), init }; return new Response(Uint8Array.from([1, 2, 3]), { status: 200, headers: { 'content-type': 'application/octet-stream' } }); }
  });
  assert.equal(result.status, 200);
  assert.deepEqual(Array.from(result.bytes), [1, 2, 3]);
  assert.equal(seen.init.headers.get('accept-encoding'), 'identity');
  assert.equal(seen.init.headers.has('host'), false);
});
