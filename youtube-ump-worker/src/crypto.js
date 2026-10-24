function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function base64Decode(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - String(value).length % 4) % 4);
  const binary = atob(normalized);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

export async function aesCtr(keyBytes, iv, data, mode = 'decrypt') {
  if (keyBytes.length !== 16 || iv.length !== 16) throw new Error('invalid-aes-input');
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CTR', length: 128 }, false, [mode]);
  return new Uint8Array(await crypto.subtle[mode === 'encrypt' ? 'encrypt' : 'decrypt'](
    { name: 'AES-CTR', counter: iv, length: 128 }, key, data));
}

export async function verifyHmac(clientKey, encrypted, iv, expected) {
  const key = await crypto.subtle.importKey('raw', clientKey.slice(16, 32), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, expected, new Uint8Array([...encrypted, ...iv]));
}

export async function signHmac(clientKey, encrypted, iv) {
  const key = await crypto.subtle.importKey('raw', clientKey.slice(16, 32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new Uint8Array([...encrypted, ...iv])));
}
