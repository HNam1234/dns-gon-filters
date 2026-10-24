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

On breakage disable this module first; the private DNS configuration and CA
remain separate. Test normal sign-in, navigation and media after enabling it.
