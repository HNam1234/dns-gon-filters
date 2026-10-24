import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderPrivateModule } from '../render-private-module.mjs';

test('private module includes concrete token and diagnostic route with no unresolved variables', () => {
  const template = readFileSync(new URL('../../shadowrocket/DNSGon-YouTubeApp-PrivateWorker.template.sgmodule', import.meta.url), 'utf8');
  const endpoint = 'https://worker.example/' + 'x'.repeat(43);
  const output = renderPrivateModule(template, endpoint);
  assert.ok(output.includes('argument="worker_url=' + endpoint + '"'));
  assert.ok(output.includes('DNSGon.PrivateStatus'));
  assert.equal(/\{\{\{|REPLACE-WITH|\$token/.test(output), false);
});

test('private module refuses literal shell variable as a token', () => {
  assert.throws(() => renderPrivateModule('', 'https://worker.example/$token'));
});
