import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aesCtr, signHmac } from '../src/crypto.js';
import { filterUmpResponse } from '../src/ump.js';
import { concat, encodeFields, encodeLengthDelimited, encodeVarint } from '../src/protobuf.js';

const key = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const iv = Uint8Array.from({ length: 16 }, (_, i) => 100 + i);
function field(no, bytes) { return encodeLengthDelimited(no, bytes); }
function playerWithAds() { return concat(field(7, Uint8Array.from([1, 2])), field(9, field(1, Uint8Array.from([3]))), field(68, Uint8Array.from([4, 5])), field(2, Uint8Array.from([9]))); }
function umpPart(type, data) { return concat(encodeVarint(type), encodeVarint(data.length), data); }

test('decrypts, removes player ad fields, re-encrypts and preserves unknown playback fields', async () => {
  const player = playerWithAds();
  const content = field(2, player);
  const onesie = field(4, content);
  const encrypted = await aesCtr(key.slice(0, 16), iv, onesie, 'encrypt');
  const hmac = await signHmac(key, encrypted, iv);
  const encryptedPart = concat(field(1, encrypted), field(2, hmac), field(3, iv));
  const header = concat(encodeVarint(8), encodeVarint(0)); // field 1, enum 0
  const ump = concat(umpPart(10, header), umpPart(11, encryptedPart));
  const result = await filterUmpResponse(ump, key);
  assert.equal(result.changed, true);
  assert.notDeepEqual(Array.from(result.bytes), Array.from(ump));
  const outParts = [];
  let pos = 0;
  while (pos < result.bytes.length) { const t = read(result.bytes, pos); pos = t.next; const n = read(result.bytes, pos); pos = n.next; outParts.push(result.bytes.slice(pos, pos + Number(n.value))); pos += Number(n.value); }
  const outFields = parse(outParts[1]); const outEncrypted = outFields.find(f => f.no === 1).payload; const outIv = outFields.find(f => f.no === 3).payload;
  const plain = await aesCtr(key.slice(0, 16), outIv, outEncrypted, 'decrypt');
  const outer = parse(plain), contentOut = parse(outer.find(f => f.no === 4).payload), playerOut = parse(contentOut.find(f => f.no === 2).payload);
  assert.equal(playerOut.some(f => f.no === 7 || f.no === 68), false);
  assert.equal(playerOut.some(f => f.no === 2), true);
});

test('malformed or oversized responses fall back without throwing', async () => {
  const malformed = await filterUmpResponse(Uint8Array.from([0xff, 0xff]), key);
  assert.equal(malformed.changed, false);
  assert.equal(malformed.reason, 'filter-fallback');
  const oversized = await filterUmpResponse(new Uint8Array(100), key, 10);
  assert.equal(oversized.reason, 'body-limit');
});

function read(bytes, pos) { let value = 0n, shift = 0n; for (;;) { const b = bytes[pos++]; value |= BigInt(b & 127) << shift; if (!(b & 128)) return { value, next: pos }; shift += 7n; } }
function parse(bytes) { const out = []; let pos = 0; while (pos < bytes.length) { const tag = read(bytes, pos); pos = tag.next; const no = Number(tag.value >> 3n), wire = Number(tag.value & 7n); assert.equal(wire, 2); const len = read(bytes, pos); pos = len.next; const n = Number(len.value); out.push({ no, payload: bytes.slice(pos, pos + n) }); pos += n; } return out; }
