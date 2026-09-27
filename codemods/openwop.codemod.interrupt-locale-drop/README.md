# openwop.codemod.interrupt-locale-drop

RFC 0171 row `C4.17`: v2 closes interrupt data, so the optional v1 `data.locale` on an `InterruptPayload` has no v2 place. This codemod drops `data.locale` from an `InterruptPayload`. It refuses a `locale` value that is not a string. Negative control: a payload without `data.locale` is unchanged. Idempotent.

A client that sent `locale` on a v1 resume payload drops that key; the v2 resume body is `{ resumeValue }`. The locale a host rendered in is request-scoped `Content-Language` (`spec/v2/core/i18n.md`).
