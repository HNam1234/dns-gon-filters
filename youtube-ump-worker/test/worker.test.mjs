import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import { CompositeBuffer, UmpReader, UmpWriter } from 'googlevideo/ump';
import { OnesieHeader, OnesieInnertubeResponse, OnesieProxyStatus } from 'googlevideo/protos';
import { aesCtr, signHmac, verifyHmac } from '../src/crypto.js';
import { filterUmpResponse, parseUmp, encodeUmp, encodeUmpInt, readUmpInt } from '../src/ump.js';
import { concat, encodeLengthDelimited, parseFields } from '../src/protobuf.js';

// Independent oracle: the upstream codecs encode/decode the test envelope and UMP.
const key = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const iv = Uint8Array.from({ length: 16 }, (_, i) => 100 + i);
const field = encodeLengthDelimited;
const playback = field(9, field(1, new Uint8Array(300).fill(42)));
const player = concat(field(7, Uint8Array.of(1)), playback, field(68, Uint8Array.of(4)), field(2, Uint8Array.of(9)));

function referenceUmp(parts) {
  const buffer = new CompositeBuffer(), writer = new UmpWriter(buffer);
  for (const p of parts) writer.write(p.type, p.data);
  return concat(...buffer.chunks);
}

async function fixture({ gzip = false, json = false, tamper = false, status = 200, encrypted = true, type = 0 } = {}) {
  const body = json ? new TextEncoder().encode(JSON.stringify({ adPlacements: [{}], adSlots: [{}], videoDetails: { title: 'fixture' } })) : player;
  let plain = OnesieInnertubeResponse.encode({ onesieProxyStatus: OnesieProxyStatus.OK, httpStatus: status, headers: [], body }).finish();
  if (gzip) plain = gzipSync(plain);
  const ciphertext = encrypted ? await aesCtr(key.slice(0, 16), iv, plain, 'encrypt') : plain;
  const mac = encrypted ? await signHmac(key, ciphertext, iv) : undefined;
  if (tamper) mac[0] ^= 1;
  const header = OnesieHeader.encode({ type, restrictedFormats: [], cryptoParams: { iv: encrypted ? iv : undefined, hmac: mac, compressionType: gzip ? 1 : 0 } }).finish();
  const media = { type: 20, data: Uint8Array.of(0xde, 0xad, 0xbe, 0xef) };
  return { input: referenceUmp([{ type: 10, data: header }, { type: 11, data: ciphertext }, media]), media };
}

for (const value of [0, 127, 128, 150, 16383, 16384, 20000, 2097151, 2097152, 10000000, 268435456, 300000000, 4294967295]) {
  test(`UMP integer agrees with upstream codec for ${value}`, async () => {
    const actual = encodeUmp([{ type: value, data: Uint8Array.of(42) }]);
    assert.deepEqual(actual, referenceUmp([{ type: value, data: Uint8Array.of(42) }]));
    const encoded = encodeUmpInt(value);
    assert.equal(readUmpInt(encoded, 0).value, value);
    assert.equal(parseUmp(actual)[0].type, value);
  });
}

for (const options of [{}, { gzip: true }, { json: true }, { encrypted: false }]) {
  test(`filters a real-schema Onesie envelope ${JSON.stringify(options)}`, async () => {
    const { input, media } = await fixture(options);
    const result = await filterUmpResponse(input, key);
    assert.equal(result.changed, true, result.reason);
    const parts = [];
    await new UmpReader({ onPart(type, data) { parts.push({ type, data: concat(...data.chunks) }); } }).feed(result.bytes);
    const header = OnesieHeader.decode(parts[0].data), params = header.cryptoParams;
    assert.deepEqual(parts[2], media);
    let plain = parts[1].data;
    if (options.encrypted !== false) {
      assert.equal(await verifyHmac(key, plain, params.iv, params.hmac), true);
      plain = await aesCtr(key.slice(0, 16), params.iv, plain, 'decrypt');
    }
    if (options.gzip) plain = gunzipSync(plain);
    const envelope = OnesieInnertubeResponse.decode(plain);
    assert.equal(envelope.httpStatus, 200);
    if (options.json) {
      const body = JSON.parse(new TextDecoder().decode(envelope.body));
      assert.equal(body.adPlacements, undefined); assert.equal(body.adSlots, undefined);
      assert.deepEqual(body.videoDetails, { title: 'fixture' });
    } else {
      const fields = parseFields(envelope.body);
      assert.equal(fields.some(f => f.no === 7 || f.no === 68), false);
      assert.deepEqual(new Uint8Array(fields.find(f => f.no === 9).raw), playback);
      assert.equal(fields.some(f => f.no === 2), true);
    }
  });
}

for (const options of [{ tamper: true }, { status: 403 }, { type: 1 }]) {
  test(`passes through without mutation ${JSON.stringify(options)}`, async () => {
    const { input } = await fixture(options), result = await filterUmpResponse(input, key);
    assert.equal(result.changed, false); assert.deepEqual(result.bytes, input);
  });
}

test('malformed UMP and oversized responses pass through', async () => {
  assert.equal((await filterUmpResponse(Uint8Array.of(0xff), key)).reason, 'filter-fallback');
  assert.equal((await filterUmpResponse(new Uint8Array(100), key, 10)).reason, 'body-limit');
});
