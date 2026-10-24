// Manual anonymous public-protocol probe, not an iPhone ad-removal certification.
// Does not read a browser session, cookies, account credentials, or viewing history.
import Innertube from 'youtubei.js';
import { OnesieRequest, OnesieInnertubeRequest, OnesieHeader, OnesieInnertubeResponse } from 'googlevideo/protos';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { aesCtr, base64Decode, signHmac, verifyHmac } from './src/crypto.js';
import { parseUmp } from './src/ump.js';
import { parseFields } from './src/protobuf.js';
import { processInitplayback } from './src/core.js';

const videoId = 'hzGmbwS_Drs'; // Public example ID from LuanRT/GoogleVideo.
const text = await (await fetch('https://www.youtube.com/tv_config?action_get_config=true&client=lb4&theme=cl')).text();
const config = JSON.parse(text.slice(4)).webPlayerContextConfig.WEB_PLAYER_CONTEXT_CONFIG_ID_LIVING_ROOM_WATCH.onesieHotConfig;
const key = base64Decode(config.clientKey), iv = crypto.getRandomValues(new Uint8Array(16));
const yt = await Innertube.create({ retrieve_player: false });
const context = structuredClone(yt.session.context);
const request = OnesieInnertubeRequest.encode({
  url: 'https://youtubei.googleapis.com/youtubei/v1/player', headers: [{ name: 'Content-Type', value: 'application/json' }],
  body: JSON.stringify({ context, videoId }), proxiedByTrustedBandaid: true, skipResponseEncryption: false
}).finish();
const encrypted = await aesCtr(key.slice(0, 16), iv, request, 'encrypt');
const body = OnesieRequest.encode({ urls: [], bufferedRanges: [],
  onesieUstreamerConfig: base64Decode(config.onesieUstreamerConfig),
  innertubeRequest: { encryptedClientKey: base64Decode(config.encryptedClientKey), encryptedOnesieInnertubeRequest: encrypted,
    iv, hmac: await signHmac(key, encrypted, iv), serializeResponseAsJson: false, enableAdPlacementsPreroll: true,
    enableCompression: true, useJsonformatterToParsePlayerResponse: false }
}).finish();
const redirect = await fetch('https://redirector.googlevideo.com/initplayback?source=youtube&itag=0&pvi=0&pai=0&owc=yes&alr=yes&id=12345');
const redirected = (await redirect.text()).trim();
if (!redirected.startsWith('https://')) throw Error('No public redirector endpoint');
const target = new URL(config.baseUrl, new URL(redirected).origin);
for (const [k, v] of Object.entries({ id: Buffer.from(videoId, 'base64url').toString('hex'), opr: '1', osts: '0', por: '1', rn: '0' })) target.searchParams.set(k, v);
const token = (await readFile(new URL('../secrets/youtube-worker-auth-token.txt', import.meta.url), 'utf8')).trim();
const endpoint = new URL('https://dnsgon-youtube-ump.myfavblueone.workers.dev/' + token);
endpoint.searchParams.set('ck', config.clientKey); endpoint.searchParams.set('target', target.href);
const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body });
const result = { status: response.status, version: response.headers.get('x-dnsgon-version'), filter: response.headers.get('x-dnsgon-filter') };
result.redirectCheck = response.headers.get('x-dnsgon-redirect-check');
const local = await processInitplayback({ target: target.href, clientKey: config.clientKey, body: { bytes: body, headers: { 'Content-Type': 'application/octet-stream' } } });
result.direct = { status: local.status, filter: local.reason, error: typeof local.body === 'string' ? local.body : undefined };
if (local.bytes) {
  const parts = parseUmp(local.bytes); result.direct.partTypes = parts.map(p => p.type);
  let header;
  for (const part of parts) {
    if (part.type === 10) header = OnesieHeader.decode(part.data);
    if (part.type !== 11 || header?.type !== 0) continue;
    let plain = part.data; const params = header.cryptoParams;
    if (params?.iv?.length) {
      result.direct.macValid = await verifyHmac(key, plain, params.iv, params.hmac);
      plain = await aesCtr(key.slice(0, 16), params.iv, plain, 'decrypt');
    }
    if (params?.compressionType === 1) plain = gunzipSync(plain);
    const envelope = OnesieInnertubeResponse.decode(plain);
    result.direct.innerStatus = envelope.httpStatus; result.direct.proxyStatus = envelope.onesieProxyStatus;
    result.direct.playerFields = parseFields(envelope.body || new Uint8Array()).length;
  }
}
if (!response.ok && response.status !== 307) {
  const error = await response.text();
  result.error = /^[a-z-]{1,64}$/.test(error) ? error : 'upstream-non-success';
}
if (response.ok || response.status === 307) {
  const parts = parseUmp(new Uint8Array(await response.arrayBuffer())); result.partTypes = parts.map(p => p.type);
  result.headerTypes = parts.filter(p => p.type === 10).map(p => OnesieHeader.decode(p.data).type);
  let header;
  for (const part of parts) {
    if (part.type === 10) header = OnesieHeader.decode(part.data);
    if (part.type !== 11 || header?.type !== 0) continue;
    const params = header.cryptoParams;
    let plain = part.data;
    if (params?.iv?.length) {
      result.macValid = await verifyHmac(key, plain, params.iv, params.hmac);
      plain = await aesCtr(key.slice(0, 16), params.iv, plain, 'decrypt');
    }
    if (params?.compressionType === 1) plain = gunzipSync(plain);
    const envelope = OnesieInnertubeResponse.decode(plain);
    result.innerStatus = envelope.httpStatus; result.proxyStatus = envelope.onesieProxyStatus;
    const fields = parseFields(envelope.body || new Uint8Array());
    result.playerFields = fields.length;
    result.adFieldsRemaining = fields.filter(f => f.no === 7 || f.no === 68).length;
  }
}
console.log(JSON.stringify(result, null, 2));
