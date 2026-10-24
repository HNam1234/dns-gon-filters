# DNSGon private YouTube UMP Worker v0.3

Independent Cloudflare Worker prototype for `googlevideo.com/initplayback`.
It follows public UMP/Onesie protocol descriptions; it does not copy or call
the Maasea Worker implementation.

## Processing and privacy

- Token-protected route; only HTTPS Google video `/initplayback` destinations.
- Forwards the binary POST; strips Cookie/Authorization/Proxy-Authorization.
- Follows at most three 307/308 redirects, each independently allowlisted to
  HTTPS Google video `/initplayback`; other redirect destinations are rejected.
- UMP uses prefix-length integers, separate from protobuf varints.
- Part 10 contains the Onesie header and crypto parameters; part 11 contains
  raw encrypted response bytes. HMAC is verified before AES-CTR decryption.
- `OnesieInnertubeResponse.body` (field 4) contains Player directly. The filter
  removes protobuf fields 7/68, or known top-level JSON Player ad fields.
- Supports clear and AES-CTR responses, uncompressed/gzip payloads. Rewrites
  header HMAC after editing and preserves unrelated media parts byte for byte.
- Unsupported or invalid payloads pass through. The filter limit is 8 MiB;
  upstream responses are currently buffered before applying that limit.
- No analytics or durable server storage. Worker Logs/Traces are disabled.
  Only the validated Google endpoint is fetched. Cloudflare remains the host
  and can observe traffic under its own infrastructure policies.
- The iPhone bridge stores one overwritten local status (reason/version/time)
  without keys, URLs, video IDs, headers or raw payloads. Requests may contain
  sensitive metadata inside their encrypted envelope; this is not a promise
  that no account-related information can reach the Worker's memory.

## Correction to the initial prototype

Version 0.3 fixes four errors: the bridge read Maasea's cache name instead of
teaoea's `ytads.onesie.youtube.v1`; its protobuf decoder used the wrong
multiplier; the Worker confused UMP integers with protobuf varints; and it
expected crypto parameters and Player bytes at incorrect schema paths.
The initial private module also contained a literal `$token` instead of the
secret value. `render-private-module.mjs` now validates and renders the actual
endpoint into the ignored local module, rejecting unresolved variables.

The earlier 5 tests shared that incorrect fixture layout. They were not
adequate evidence of protocol compatibility or on-device ad removal.

Current result on 2026-10-24: 35 tests pass. An anonymous live probe from the
PC received a real UMP response, verified HMAC, decrypted the Player and decoded
an inner HTTP 200. The same public probe through Cloudflare returned an empty
HTTP 307 without a Location, which remains unresolved. No real iPhone ad-removal
success is established. Health 200 only proves that the Worker is running.

## Verification

```
npm ci
npm test
npm run build
```

The tests use `googlevideo@5.0.1`'s independently maintained UMP codecs and
generated Onesie schemas as an oracle. They cover long lengths, encrypted,
gzip, JSON and clear Player payloads, HMAC verification after editing, media
preservation, and bridge cache/expiry/mismatch behavior.

With the v0.3 module enabled, open
`https://www.youtube.com/robots.txt?dnsgon-check=1` in Chrome on the iPhone.
It reports interception, cache presence and last initplayback status. Normal
robots.txt means this script's interception has not been proven. No keys or
route token are displayed by the diagnostic response.

`live-probe.mjs` performs a separate anonymous public YouTube protocol check
using a fresh TV config and the owner's existing local route token. It never
reads browser cookies, account credentials or viewing history. Success only
proves that one public probe path, not iPhone interception or ad removal.

## Deployment

Set the Worker name in `wrangler.toml`, set `AUTH_TOKEN` via Wrangler secret,
then build and deploy. Keep route tokens only in the ignored `secrets/`
directory and private iPhone modules; never publish them to GitHub. Public
source, bundles and tests have no account/API credentials or production token.

This remains a prototype, not a security certification. It does not implement
all Onesie response types, Brotli, SABR follow-ups, every YouTube ad renderer,
browser cosmetic filtering or Premium/background-playback entitlements.
On-device interception and playback must still be verified.
