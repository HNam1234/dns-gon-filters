import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const env = { AUTH_TOKEN: 'test-token' };

test('health endpoint is token-gated and does not expose deployment details', async () => {
  const ok = await worker.fetch(new Request('https://worker.test/test-token/health'), env);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, service: 'dnsgon-youtube-ump', version: '0.3.0' });

  const denied = await worker.fetch(new Request('https://worker.test/wrong/health'), env);
  assert.equal(denied.status, 401);
});

