export function readVarint(bytes, start = 0) {
  let value = 0n, shift = 0n, pos = start;
  for (let i = 0; i < 10; i++) {
    if (pos >= bytes.length) throw new Error('truncated-varint');
    const b = bytes[pos++];
    value |= BigInt(b & 0x7f) << shift;
    if (!(b & 0x80)) return { value, next: pos };
    shift += 7n;
  }
  throw new Error('varint-overflow');
}

export function encodeVarint(value) {
  let n = typeof value === 'bigint' ? value : BigInt(value);
  if (n < 0n) throw new Error('negative-varint');
  const out = [];
  do { const b = Number(n & 0x7fn); n >>= 7n; out.push(n ? b | 0x80 : b); } while (n);
  return Uint8Array.from(out);
}

export function concat(...parts) {
  const size = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size); let pos = 0;
  for (const part of parts) { out.set(part, pos); pos += part.length; }
  return out;
}

function skip(bytes, pos, wire) {
  if (wire === 0) return readVarint(bytes, pos).next;
  if (wire === 1) { if (pos + 8 > bytes.length) throw new Error('truncated-fixed64'); return pos + 8; }
  if (wire === 2) { const n = readVarint(bytes, pos); const len = Number(n.value); if (!Number.isSafeInteger(len) || len < 0 || n.next + len > bytes.length) throw new Error('truncated-length'); return n.next + len; }
  if (wire === 5) { if (pos + 4 > bytes.length) throw new Error('truncated-fixed32'); return pos + 4; }
  throw new Error('unsupported-wire');
}

export function parseFields(bytes) {
  const fields = []; let pos = 0;
  while (pos < bytes.length) {
    const tagStart = pos; const tag = readVarint(bytes, pos); pos = tag.next;
    const no = Number(tag.value >> 3n), wire = Number(tag.value & 7n);
    if (!no || no > 536870911) throw new Error('invalid-field-number');
    let payloadStart = pos; let end;
    if (wire === 2) {
      const length = readVarint(bytes, pos); const size = Number(length.value);
      if (!Number.isSafeInteger(size) || size < 0 || length.next + size > bytes.length) throw new Error('truncated-length');
      payloadStart = length.next; end = payloadStart + size;
    } else end = skip(bytes, pos, wire);
    fields.push({ no, wire, raw: bytes.slice(tagStart, end), payload: bytes.slice(payloadStart, end), payloadStart, end });
    pos = end;
  }
  return fields;
}

export function encodeLengthDelimited(no, payload) {
  return concat(encodeVarint(BigInt(no) << 3n | 2n), encodeVarint(payload.length), payload);
}

export function encodeFields(fields) { return concat(...fields.map(f => f.raw)); }

export function rewriteLengthDelimited(field, fn) {
  if (field.wire !== 2) return field;
  const next = fn(field.payload);
  return next === field.payload ? field : { ...field, raw: encodeLengthDelimited(field.no, next), payload: next };
}
