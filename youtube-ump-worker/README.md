# DNSGon private YouTube UMP Worker

This is an independent Cloudflare Worker prototype for the encrypted
`googlevideo.com/initplayback` path used by recent YouTube clients. It was
written from the public UMP/Onesie protocol descriptions and the public
request flow; it does not copy the Maasea Worker implementation.

The Worker:

1. accepts only a token-prefixed POST route;
2. validates the `target` URL as HTTPS `*.googlevideo.com/initplayback`;
3. forwards the original binary request with identity encoding;
4. parses UMP parts 10/11;
5. verifies the response HMAC and decrypts the Onesie player response with the
   supplied 32-byte client key (AES-CTR key half + HMAC key half);
6. removes only Player protobuf fields 7 (`adPlacements`) and 68 (`adSlots`);
7. re-encrypts the edited response with the same IV and a new HMAC; and
8. passes unsupported, malformed or oversized responses through unchanged.

The Worker has no analytics, durable storage, external fetches, or fallback
proxy destinations. Cloudflare still handles the request while the Worker is
running, so this is private to the user's account at the application layer,
not a claim that Cloudflare cannot observe traffic.

## Current boundary

This is a protocol-tested prototype, not an iPhone runtime certification. It
does not yet handle every Onesie response type, gzip/brotli variants on every
Cloudflare runtime, SABR follow-up requests, or all YouTube ad renderers. A
failed filter is deliberately passed through to preserve playback.

The module that redirects Shadowrocket `initplayback` requests to this Worker
must be generated only after deployment, with the Worker URL and route token
kept in the local configuration. Do not put a reusable production token in a
public GitHub module.

## Local checks

```text
npm test
node --check src/index.js
node --check src/core.js
```

The tests cover AES-CTR/HMAC verification, UMP wrapping, Player field removal,
malformed/oversized fallback, target allowlisting and no-open-proxy behavior.

## Deployment shape

Copy `wrangler.toml.example` to `wrangler.toml`, set a Worker name, and create
the secret with `wrangler secret put AUTH_TOKEN`. Deploy only after reviewing
the code and deciding how the private module will carry the route token. The
source does not contain a Cloudflare account ID, API token, DNS token or user
credentials.
