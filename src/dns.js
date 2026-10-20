const u16 = (data, offset) => {
  if (offset + 2 > data.length) throw new Error("Truncated DNS");
  return (data[offset] << 8) | data[offset + 1];
};
const put16 = (data, offset, value) => { data[offset] = value >> 8; data[offset + 1] = value & 255; };

export function readName(data, start) {
  const labels = [], visited = new Set();
  let position = start, end = null, length = 0;
  for (let step = 0; step < 128; step++) {
    if (position >= data.length || visited.has(position)) throw new Error("Invalid DNS pointer");
    visited.add(position);
    const size = data[position++];
    if (!size) return { name: labels.join("."), next: end ?? position, labels };
    if ((size & 0xc0) === 0xc0) {
      if (position >= data.length) throw new Error("Truncated DNS pointer");
      end ??= position + 1;
      position = ((size & 63) << 8) | data[position];
      continue;
    }
    if (size > 63 || position + size > data.length) throw new Error("Invalid DNS label");
    const label = data.slice(position, position + size);
    if (label.some(byte => byte < 33 || byte > 126 || byte === 46)) throw new Error("Unsupported DNS label");
    labels.push(String.fromCharCode(...label));
    position += size; length += size + 1;
    if (length > 254) throw new Error("DNS name too long");
  }
  throw new Error("Too many DNS pointers");
}

function nameBytes(labels) {
  const result = [];
  for (const label of labels) result.push(label.length, ...[...label].map(char => char.charCodeAt(0)));
  result.push(0); return Uint8Array.from(result);
}

export function parseQuery(data) {
  if (data.length < 17 || data.length > 65535) throw new Error("Invalid DNS size");
  const flags = u16(data, 2);
  if ((flags & 0xf800) || u16(data, 4) !== 1 || u16(data, 6) || u16(data, 8) || u16(data, 10) > 8) throw new Error("Unsupported DNS query");
  const parsed = readName(data, 12), type = u16(data, parsed.next), qclass = u16(data, parsed.next + 2);
  if (qclass !== 1) throw new Error("Unsupported DNS question");
  let offset = parsed.next + 4, dnssec = false;
  for (let index = 0; index < u16(data, 10); index++) {
    const owner = readName(data, offset); offset = owner.next;
    const rtype = u16(data, offset), length = u16(data, offset + 8);
    if (offset + 10 + length > data.length) throw new Error("Truncated DNS additional");
    if (rtype === 41) dnssec ||= Boolean(data[offset + 6] & 0x80);
    offset += 10 + length;
  }
  if (offset !== data.length) throw new Error("Trailing DNS data");
  const qname = nameBytes(parsed.labels), question = new Uint8Array(qname.length + 4);
  question.set(qname); put16(question, qname.length, type); put16(question, qname.length + 2, 1);
  return { id: u16(data, 0), flags, type, name: parsed.name.toLowerCase(), question, dnssec };
}

export function upstreamQuery(query) {
  // Rebuild the question and only preserve DNSSEC's DO bit, removing client ECS/identity options.
  const data = new Uint8Array(12 + query.question.length + (query.dnssec ? 11 : 0));
  put16(data, 0, query.id); put16(data, 2, query.flags & 0x0110); put16(data, 4, 1);
  data.set(query.question, 12);
  if (query.dnssec) {
    put16(data, 10, 1); const p = 12 + query.question.length;
    put16(data, p + 1, 41); put16(data, p + 3, 1232); data[p + 7] = 0x80;
  }
  return data;
}

export function blockedResponse(query) {
  const data = new Uint8Array(12 + query.question.length);
  put16(data, 0, query.id); put16(data, 2, 0x8083 | (query.flags & 0x0110)); put16(data, 4, 1);
  data.set(query.question, 12); return data;
}

export function inspectAnswer(data, query) {
  if (data.length < 17 || data.length > 65535 || u16(data, 0) !== query.id || !(u16(data, 2) & 0x8000) ||
      (u16(data, 2) & 0x7800) || u16(data, 4) !== 1) throw new Error("Invalid upstream DNS response");
  const question = readName(data, 12);
  if (question.name.toLowerCase() !== query.name || u16(data, question.next) !== query.type || u16(data, question.next + 2) !== 1)
    throw new Error("Upstream question mismatch");
  const total = u16(data, 6) + u16(data, 8) + u16(data, 10);
  if (total > 256) throw new Error("Too many DNS records");
  const aliases = []; let offset = question.next + 4;
  for (let index = 0; index < total; index++) {
    const owner = readName(data, offset); offset = owner.next;
    const type = u16(data, offset), length = u16(data, offset + 8), start = offset + 10;
    if (start + length > data.length) throw new Error("Truncated DNS record");
    if (type === 5 && index < u16(data, 6)) {
      const alias = readName(data, start);
      if (alias.next > start + length) throw new Error("Invalid CNAME");
      aliases.push(alias.name.toLowerCase());
    }
    offset = start + length;
  }
  if (offset !== data.length) throw new Error("Trailing upstream data");
  return aliases;
}
