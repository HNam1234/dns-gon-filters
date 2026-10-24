import { concat, encodeFields, encodeLengthDelimited, encodeVarint, parseFields, readVarint } from './protobuf.js';
import { aesCtr, signHmac, verifyHmac } from './crypto.js';

export const PART_ONESIE_HEADER = 10;
export const PART_ONESIE_DATA = 11;
export const ONESIE_PLAYER_RESPONSE = 0;

export function parseUmp(bytes) {
  const parts = []; let pos = 0;
  while (pos < bytes.length) {
    const type = readVarint(bytes, pos); pos = type.next;
    const length = readVarint(bytes, pos); pos = length.next;
    const size = Number(length.value);
    if (!Number.isSafeInteger(size) || size < 0 || pos + size > bytes.length) throw new Error('invalid-ump-length');
    parts.push({ type: Number(type.value), data: bytes.slice(pos, pos + size) }); pos += size;
  }
  return parts;
}

export function encodeUmp(parts) {
  return concat(...parts.map(p => concat(encodeVarint(p.type), encodeVarint(p.data.length), p.data)));
}

function getBytes(fields, no) {
  const field = fields.find(f => f.no === no && f.wire === 2);
  return field?.payload;
}

function setBytes(fields, no, value) {
  const index = fields.findIndex(f => f.no === no && f.wire === 2);
  const next = { no, wire: 2, raw: encodeLengthDelimited(no, value), payload: value };
  if (index < 0) fields.push(next); else fields[index] = next;
}

function parseOnesieHeader(bytes) {
  const fields = parseFields(bytes);
  const typeField = fields.find(f => f.no === 1 && f.wire === 0);
  const cryptoField = fields.find(f => f.no === 4 && f.wire === 2);
  const crypto = cryptoField ? parseFields(cryptoField.payload) : [];
  const hmac = getBytes(crypto, 4), iv = getBytes(crypto, 5);
  const compressionField = crypto.find(f => f.no === 6 && f.wire === 0);
  return { type: typeField ? Number(readVarint(typeField.payload).value) : 0, hmac, iv, compression: compressionField ? Number(readVarint(compressionField.payload).value) : 0 };
}

function parseEncryptedPart(bytes) {
  const fields = parseFields(bytes);
  const encrypted = getBytes(fields, 1), hmac = getBytes(fields, 2), iv = getBytes(fields, 3);
  const compressionField = fields.find(f => f.no === 4 && f.wire === 0);
  if (!encrypted || !hmac || !iv) throw new Error('missing-encrypted-response-fields');
  return { fields, encrypted, hmac, iv, compression: compressionField ? Number(readVarint(compressionField.payload).value) : 0 };
}

function encodeEncryptedPart(info, encrypted, hmac) {
  const fields = info.fields.slice(); setBytes(fields, 1, encrypted); setBytes(fields, 2, hmac);
  return encodeFields(fields);
}

function removePlayerAds(playerBytes) {
  const fields = parseFields(playerBytes);
  const filtered = fields.filter(f => f.no !== 7 && f.no !== 68);
  return filtered.length === fields.length ? playerBytes : encodeFields(filtered);
}

function removeAdsFromOnesie(bytes) {
  const outer = parseFields(bytes); let changed = false;
  const nextOuter = outer.map(field => {
    if (field.no !== 4 || field.wire !== 2) return field;
    const contents = parseFields(field.payload);
    const nextContents = contents.map(content => {
      if (content.no !== 2 || content.wire !== 2) return content;
      const nextPlayer = removePlayerAds(content.payload);
      if (nextPlayer === content.payload) return content;
      changed = true; return { ...content, raw: encodeLengthDelimited(content.no, nextPlayer), payload: nextPlayer };
    });
    if (nextContents.every((f, i) => f.raw === contents[i].raw)) return field;
    return { ...field, raw: encodeLengthDelimited(field.no, encodeFields(nextContents)), payload: encodeFields(nextContents) };
  });
  return { bytes: changed ? encodeFields(nextOuter) : bytes, changed };
}

async function gzip(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('gzip-unavailable');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes) {
  if (typeof CompressionStream === 'undefined') throw new Error('gzip-compression-unavailable');
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function filterUmpResponse(responseBytes, clientKey, maxBytes = 8 * 1024 * 1024) {
  if (responseBytes.length > maxBytes) return { bytes: responseBytes, changed: false, reason: 'body-limit' };
  let parts; try { parts = parseUmp(responseBytes); } catch { return { bytes: responseBytes, changed: false, reason: 'filter-fallback' }; }
  let header = null, changed = false;
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].type === PART_ONESIE_HEADER) { header = parseOnesieHeader(parts[i].data); continue; }
    if (parts[i].type !== PART_ONESIE_DATA || !header || header.type !== ONESIE_PLAYER_RESPONSE) continue;
    const encryptedPart = parseEncryptedPart(parts[i].data);
    if (encryptedPart.compression !== 0 && encryptedPart.compression !== 1) continue;
    if (!(await verifyHmac(clientKey, encryptedPart.encrypted, encryptedPart.iv, encryptedPart.hmac))) continue;
    let plaintext = await aesCtr(clientKey.slice(0, 16), encryptedPart.iv, encryptedPart.encrypted, 'decrypt');
    const plainBeforeCompression = plaintext;
    if (encryptedPart.compression === 1) plaintext = await gzip(plaintext);
    const edited = removeAdsFromOnesie(plaintext);
    if (!edited.changed) continue;
    let compressed = edited.bytes;
    if (encryptedPart.compression === 1) compressed = await gunzip(edited.bytes);
    const reencrypted = await aesCtr(clientKey.slice(0, 16), encryptedPart.iv, compressed, 'encrypt');
    const newHmac = await signHmac(clientKey, reencrypted, encryptedPart.iv);
    parts[i] = { type: parts[i].type, data: encodeEncryptedPart(encryptedPart, reencrypted, newHmac) };
    changed = true;
    void plainBeforeCompression;
  }
  return { bytes: changed ? encodeUmp(parts) : responseBytes, changed, reason: changed ? 'player-ad-fields-removed' : 'no-supported-player-response' };
}
