# DNS Gọn Private

Personal DNS-over-HTTPS on Cloudflare Workers Free, using the DNS-compatible domain rules from official uBlock filters, uBlock Quick fixes, uBlock Unbreak exceptions, EasyList, HaGeZi Multi NORMAL, HaGeZi Pop-Up Ads and ABPVN for Vietnamese sites. GitHub Actions refreshes the filter data daily. No runtime npm dependencies.

This is a newly written minimal DNS service. It is **not** the uBlockDNS server, an official uBlock Origin product, or the full uBlock browser engine. The public uBlockDNS repository only provides desktop clients; its server implementation was not available to download. Its client source was downloaded separately at commit `359f6ed99bed9cce7c7acc0654972ddb5d2706b6` for review. No uBlockDNS server binary or client daemon is run here.

## What gets blocked

Only unconditional `||domain^` rules are converted into DNS blocks, and only unconditional `@@||domain^` exceptions become global allow rules. Browser-specific options, paths, cosmetic filters, scriptlets, regex rules and conditional preprocessor branches are excluded. Page-scoped exceptions cannot be represented by DNS and must not disable an advertising block globally. The owner allowlist and built-in app compatibility allowlist retain priority. Unbreak contributes unconditional exceptions only. HaGeZi Multi NORMAL is the balanced tier; its dedicated Pop-Up Ads list extends coverage for advertising redirect hosts. This deliberately cannot reproduce full uBlock behavior or guarantee that every normal app feature will work.

`custom-blocklist.json` supplements the upstream lists with reviewed advertising hosts that they miss. These are merged into the daily feed, so they take effect without reinstalling the iOS profile or app. Match the narrowest advertising host: do not add an entire shared hosting platform, image CDN or content site just to block one ad URL. DNS cannot distinguish URL paths or stop a page's inline JavaScript from opening a new tab; a blocked destination can still leave an empty tab or overlay.

Do not block `streamvl.online`: the inspected QMH page serves both banner images under `/file/` and its video player under `/watch.php` from that same hostname. DNS sees only the hostname, so blocking it removes the ads and the video together.

DNS blocks apply across apps using the iOS system resolver, subject to VPN/application-specific DNS precedence. YouTube/sponsored ads sharing content domains cannot be separated by DNS alone. Rewarded ads in games may stop working. Source data includes rule counts, hashes, skipped rule counts and attribution. A large rule count does not measure ad-blocking effectiveness.

## Privacy and access

- A private random DNS_TOKEN is required in the URL. The real token belongs only in a Cloudflare Secret and the owner's private device profile; never put it in this repository.
- No query log, browser history, analytics, ads, third-party SDK, remote executable code or user database.
- Worker logs, Logpush and observability are disabled in `wrangler.toml`; verify the same settings when deploying through the dashboard.
- Only necessary DNS packets go to the fixed HTTPS upstream `https://cloudflare-dns.com/dns-query`. HTTP cookies, original client IP headers, and EDNS client subnet/identity options are not forwarded.
- Cloudflare still processes connections and DNS queries. Self-hosting on Cloudflare does not hide DNS data from Cloudflare or provide a guarantee about its internal infrastructure.
- GitHub and filter maintainers receive filter-download requests; they do not receive DNS questions from this application. The filter feed is public data, not a secret or a place for browsing data.

## Long-term updates without a paid server

The scheduled workflow fetches the official filter sources daily, tests, and commits compiled data to this repository. Heavy filter parsing stays on GitHub Actions rather than inside the Cloudflare Free CPU budget. Runtime refreshes the feed at most every 15 minutes per active isolate. On network/feed failure it retains a known-good data set and publishes the filter date at `/health`. Review that date if filtering looks stale; GitHub schedules and free platform availability are not guaranteed.

Cloudflare Workers Free currently permits 100,000 Worker requests/account/day, resetting at midnight UTC, and has a low CPU budget. Exceeding the free request quota can interrupt DNS until reset; use iOS DNS Automatic if needed. There is no promise of a permanent free service or uptime SLA. This project does not enable a paid plan or paid bindings. [Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/).

## Allow normal app features

Built-in exceptions protect common sign-in and messaging hosts. To add your own exception:

1. Edit `custom-allowlist.json` to a JSON array of lower-case domains, for example `["api.example.com"]`. A domain also allows its subdomains. Do not put passwords, keys or private browsing history in this public file.
2. Run **Update ad filters** in GitHub Actions. Wait for success and allow runtime/feed caches to refresh.
3. If needed temporarily select DNS Automatic on iPhone. Do not stack multiple DNS profiles.

An optional KV binding enables a private runtime allowlist API, but is not needed by the Free deployment. This optional feature is not configured by default.

## Build and deployment

Use Node.js 24 or newer. No `npm install` is needed.

```sh
npm run seed
npm test
npm run build
node --check dist/worker.js
```

Upload `dist/worker.js` as an ES module Worker, set `DNS_TOKEN` as a Secret, disable Workers Logs/observability, and keep Workers Free. The DNS endpoint is `https://<worker-host>/<private-token>/dns-query`. iOS can use this in a DNS-only profile or the native settings app client. `/health` is public status only, with no token or query data.

Builds include a filter snapshot as a fallback. Keep the source package and `dist/worker.js` to recover the service on another account/provider. No deployment credentials are included.

## Verification and limits

Tests cover access control, malformed/compressed DNS, EDNS identity stripping, upstream header minimization, blocked-query containment, CNAME filtering, allowlist priority and upstream failure behavior. They do not prove that the service is vulnerability-free, that Cloudflare is private, or that all iPhone app functions work. Check the actual deployment separately.

## Sources and licensing

- [uBlock filter sources](https://github.com/uBlockOrigin/uAssets): GPLv3. Exact original inputs accompany the compiled data in `source-lists/`.
- [EasyList](https://easylist.to/): preserve its original header/license in `source-lists/4.txt`.
- [uBlock filter-list documentation](https://github.com/gorhill/uBlock/wiki/Dashboard:-Filter-lists).

Code in this project is offered under GPL-3.0-or-later. The original filters retain their own notices. See `COPYING-uAssets.txt` and the source headers.
