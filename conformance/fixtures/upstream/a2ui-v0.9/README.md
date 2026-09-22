# Vendored upstream: A2UI v0.9 (RFC 0209)

These three files are copied **byte for byte** from a2ui.org. They are the
upstream half of RFC 0209 §B.4 ("profile ⊂ upstream"): the corpus gate
(`conformance/src/coherence/a2ui-v09-profile.test.ts`) validates every message of
every `fixtures/a2ui-v09/positive-*.json` surface against them, and checks each
file's SHA-256 against the pins below. Do not edit them; a re-vendor is a new
RFC 0209 pin.

| File | Source URL | SHA-256 |
| --- | --- | --- |
| `server_to_client.json` | `https://a2ui.org/specification/v0_9/json/server_to_client.json` | `77080edd7d15077e5d345682c7bedec27b59c6df13ed3a72fd3de66318acb2d6` |
| `catalog.json` | `https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json` | `8cc94d0a482e67048f9fc989964ca5da56fe42f531d919315a508989fb22e13e` |
| `common_types.json` | `https://a2ui.org/specification/v0_9/json/common_types.json` | `ac79788e95e5bdf0a39808953593a53c1bc9fcdcdb55480f4610613c6591e94c` |

Fetched 2026-09-22 and re-fetched 2026-09-22 for this vendoring; all three hashes
matched the RFC's pins, as did `json/client_to_server.json`
(`76c9a6f54e40bbcc1ed7b36b0d56563b82122ea7f9d8379787c4afcf29cc95e0`), which is not
vendored because no server-to-client check reads it. The a2ui.org copies differ
from the repository's `v0.9` git tag, which predates the 0.9.1 patch; these are
the served bytes.

`server_to_client.json` references `catalog.json` relative to its own `$id`
(`https://a2ui.org/specification/v0_9/catalog.json`). The gate binds that
reference to the basic catalog, which is what "the basic catalog bound" means in
RFC 0209 §B.4.

## Licence

A2UI is published by the A2UI project authors under the Apache License,
Version 2.0 (<https://www.apache.org/licenses/LICENSE-2.0>). The files are
redistributed unmodified under that licence; source:
<https://github.com/a2ui-project/a2ui>.
