import { concat, encodeFields, encodeLengthDelimited, parseFields, readVarint } from './protobuf.js';
import { aesCtr, signHmac, verifyHmac } from './crypto.js';

export const PART_ONESIE_HEADER = 10;
export const PART_ONESIE_DATA = 11;
const MAX_PLAINTEXT = 8 * 1024 * 1024;

// UMP uses a prefix-length integer, NOT a protobuf/LEB128 varint.
export function readUmpInt(bytes, pos) {
  if (pos >= bytes.length) throw Error('truncated-ump-integer');
  const first = bytes[pos];
  const size = first < 128 ? 1 : first < 192 ? 2 : first < 224 ? 3 : first < 240 ? 4 : 5;
  if (pos + size > bytes.length) throw Error('truncated-ump-integer');
  if (size === 1) return { value: first, next: pos + 1 };
  let value = size === 5 ? 0 : first & (0x7f >> (size - 1));
  let factor = size === 5 ? 1 : 2 ** (8 - size);
  for (let i = 1; i < size; i++) { value += bytes[pos + i] * factor; factor *= 256; }
  return { value, next: pos + size };
}

export function encodeUmpInt(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw Error('invalid-ump-integer');
  if (value < 128) return Uint8Array.of(value);
  if (value < 16384) return Uint8Array.of(0x80 | (value & 0x3f), value >> 6);
  if (value < 2097152) return Uint8Array.of(0xc0 | (value & 0x1f), value >> 5, value >> 13);
  if (value < 268435456) return Uint8Array.of(0xe0 | (value & 0x0f), value >> 4, value >> 12, value >> 20);
  return Uint8Array.of(0xf0, value, value >>> 8, value >>> 16, value >>> 24);
}

export function parseUmp(bytes) {
  const parts = []; let pos = 0;
  while (pos < bytes.length) {
    if (parts.length >= 10000) throw Error('ump-part-limit');
    const start = pos, type = readUmpInt(bytes, pos); pos = type.next;
    const length = readUmpInt(bytes, pos); pos = length.next;
    if (pos + length.value > bytes.length) throw Error('invalid-ump-length');
    const end = pos + length.value;
    parts.push({ type: type.value, data: bytes.slice(pos, end), raw: bytes.slice(start, end) }); pos = end;
  }
  return parts;
}

export function encodeUmp(parts) {
  return concat(...parts.map(p => p.raw || concat(encodeUmpInt(p.type), encodeUmpInt(p.data.length), p.data)));
}

function get(fields, no, wire = 2) { return fields.find(f => f.no === no && f.wire === wire); }
function scalar(fields, no, fallback) { const f = get(fields, no, 0); return f ? Number(readVarint(f.payload).value) : fallback; }
function replaceBytes(fields, no, value) {
  const found = get(fields, no);
  const next = { no, wire: 2, raw: encodeLengthDelimited(no, value), payload: value };
  return found ? fields.map(f => f === found ? next : f) : [...fields, next];
}

function headerInfo(data) {
  const fields = parseFields(data), cryptoField = get(fields, 4);
  const params = cryptoField ? parseFields(cryptoField.payload) : [];
  return { fields, params, type: scalar(fields, 1, 0), iv: get(params, 5)?.payload,
    hmac: get(params, 4)?.payload, compression: scalar(params, 6, 0) };
}

function editPlayer(bytes) {
  const prefix = new TextDecoder().decode(bytes.slice(0, 32)).trimStart();
  if (prefix.startsWith('{')) {
    const player = JSON.parse(new TextDecoder().decode(bytes));
    if (!player || typeof player !== 'object' || Array.isArray(player)) return { bytes, changed: false };
    let changed = false;
    for (const field of ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams']) {
      if (Object.hasOwn(player, field)) { delete player[field]; changed = true; }
    }
    return { bytes: changed ? new TextEncoder().encode(JSON.stringify(player)) : bytes, changed };
  }
  const fields = parseFields(bytes), filtered = fields.filter(f => f.no !== 7 && f.no !== 68);
  return { bytes: filtered.length === fields.length ? bytes : encodeFields(filtered), changed: filtered.length !== fields.length };
}

function editOnesie(bytes) {
  const fields = parseFields(bytes);
  // OnesieInnertubeResponse.body (#4) is the Player itself, not a content wrapper.
  if (scalar(fields, 1, 1) !== 1 || scalar(fields, 2, 200) !== 200) return { bytes, changed: false };
  const body = get(fields, 4); if (!body) return { bytes, changed: false };
  const edited = editPlayer(body.payload);
  return { bytes: edited.changed ? encodeFields(replaceBytes(fields, 4, edited.bytes)) : bytes, changed: edited.changed };
}

async function transformCompression(bytes, decompress) {
  const Transform = decompress ? DecompressionStream : CompressionStream;
  const reader = new Blob([bytes]).stream().pipeThrough(new Transform('gzip')).getReader();
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.length; if (length > MAX_PLAINTEXT) throw Error('plaintext-limit');
      chunks.push(part.value);
    }
  } catch (error) { void reader.cancel().catch(() => {}); throw error; }
  return concat(...chunks);
}

export async function filterUmpResponse(responseBytes, clientKey, maxBytes = MAX_PLAINTEXT) {
  if (responseBytes.length > maxBytes) return { bytes: responseBytes, changed: false, reason: 'body-limit' };
  try {
    const parts = parseUmp(responseBytes); let header = null, headerIndex = -1, changed = false;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].type === PART_ONESIE_HEADER) { header = headerInfo(parts[i].data); headerIndex = i; continue; }
      if (parts[i].type !== PART_ONESIE_DATA) continue;
      const info = header; header = null;
      if (!info || info.type !== 0 || (info.compression !== 0 && info.compression !== 1)) continue;
      // Ciphertext is the raw data of part 11. Its MAC and IV live in part 10.
      const encrypted = !!(info.iv?.length || info.hmac?.length);
      if (encrypted && (info.iv?.length !== 16 || info.hmac?.length !== 32)) continue;
      const data = parts[i].data;
      if (encrypted && !await verifyHmac(clientKey, data, info.iv, info.hmac)) continue;
      let plain = encrypted ? await aesCtr(clientKey.slice(0, 16), info.iv, data, 'decrypt') : data;
      if (info.compression === 1) plain = await transformCompression(plain, true);
      const edited = editOnesie(plain); if (!edited.changed) continue;
      let output = info.compression === 1 ? await transformCompression(edited.bytes, false) : edited.bytes;
      if (encrypted) {
        output = await aesCtr(clientKey.slice(0, 16), info.iv, output, 'encrypt');
        const mac = await signHmac(clientKey, output, info.iv);
        const newParams = encodeFields(replaceBytes(info.params, 4, mac));
        parts[headerIndex] = { type: PART_ONESIE_HEADER, data: encodeFields(replaceBytes(info.fields, 4, newParams)) };
      }
      parts[i] = { type: PART_ONESIE_DATA, data: output }; changed = true;
    }
    return { bytes: changed ? encodeUmp(parts) : responseBytes, changed,
      reason: changed ? 'player-ad-fields-removed' : 'no-supported-player-response' };
  } catch { return { bytes: responseBytes, changed: false, reason: 'filter-fallback' }; }
}
