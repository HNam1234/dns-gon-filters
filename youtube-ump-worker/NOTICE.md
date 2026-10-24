# Protocol and source notes

The implementation is original code based on public protocol documentation:

- [LuanRT/googlevideo](https://github.com/LuanRT/googlevideo) — UMP/SABR
  structures and Onesie request/response crypto examples, MIT License.
- [davidzeng0/innertube](https://github.com/davidzeng0/innertube) — public UMP
  protocol notes.
- YouTube/Shadowrocket community modules were used only to understand the
  request redirect shape. No Maasea Worker source was available or copied.

The Worker does not import or execute third-party JavaScript at runtime.
