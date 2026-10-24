# DNSGon AdsOnly

Import `DNSGon-AdsOnly.sgmodule` through Shadowrocket's Modules interface and
enable it with Config routing. Keep the owner's existing private DNS config
and unique CA; this module contains no CA or private DNS endpoint.

The module combines automatically maintained network ad rules, a new bounded
YouTube **Web JSON/HTML** ad filter, and a supplemental HeoVL banner fix.
The network list refreshes in the daily filter workflow. Refresh remote rule
sets in Shadowrocket after upstream updates; iOS scheduling is not guaranteed.

HTTPS decryption must already be enabled with the device's own trusted CA.
MITM adds only `heovl.im`, `www.heovl.im`, `m.youtube.com`, `www.youtube.com`.
UDP/443 rejection is limited to these hosts to encourage TCP for HTTPS rewriting.
It does not decrypt all apps, disable upstream certificate validation, install a
shared CA, set a proxy, change subscriptions, grant Premium, or capture logs.

The script URL pins an audited repository commit. It performs no external
requests or persistence; payload errors, unsupported types and traversal limits
pass through unchanged. The script does **not** support the native YouTube app's
protobuf traffic, server-side ad insertion, or every ad renderer.

The HeoVL rule is a supplemental site fix, not a universal cosmetic engine.
Maintained domain lists cover other sites' separate ad hosts. Same-host banners,
novel scripts and unknown layouts can remain. This is not full uBlock Origin.
Runtime ad removal, normal navigation/video and background stability still need
verification on the owner's iPhone; successful import is not runtime proof.

Owner feedback on 2026-10-24: module imported/enabled, VPN connected, but many
ads remain. HTTPS rewriting has not yet been observed on the device. Version
0.2 removes whitespace inside an unquoted HeoVL replacement which could split
the rewrite into extra fields. This is a parser fix, not proof of the cause.
Open `https://heovl.im/robots.txt?dnsgon-check=1` after updating: the first text
should start `DNSGON_REWRITE_OK-` if this module's HTTPS body rewrite runs.

## Native YouTube community trial

`DNSGon-YouTubeApp-Community.sgmodule` is a separate API-only adapter using
[teaoea/shell](https://github.com/teaoea/shell/tree/3fbf89da6615d2dfdd34fd0f3ffbd2edd3aa80c1/plugins/YouTube)
scripts last changed 2026-10-07 (MIT). The two URLs are pinned to that reviewed
commit. Attribution and license remain in the upstream source.

It handles known JSON/Protobuf ads on `youtubei.googleapis.com`,
`youtubei-att.googleapis.com`, `youtube.com`, `www.youtube.com`, `m.youtube.com`
and `music.youtube.com`, with binary mode, WebView execution and a 2 MiB body limit. It does
not overlap the existing YouTube Web response script. No new CA or proxy is
included. Logging, capture, subtitles, background playback and channel lists
are disabled. The upstream config handler may keep protocol keys in local
Shadowrocket storage; the selected routes do not intentionally upload them.

This is not the complete Loon plugin. Its Loon-specific initplayback empty-video
workaround is not ported, and there is no media-host decryption. Ads using that
path or another host may remain. Shadowrocket compatibility and playback need
real-device verification. Disable this separate module if YouTube playback or
sign-in fails. A synthetic JSON/Protobuf check is not a security certification.

The module leaves `background_playback=false` and does not change entitlement,
receipt or subscription responses. It cannot grant YouTube Premium background
playback; use the account's official YouTube setting/subscription for that.

On breakage disable this module first; the private DNS configuration and CA
remain separate. Test normal sign-in, navigation and media after enabling it.
