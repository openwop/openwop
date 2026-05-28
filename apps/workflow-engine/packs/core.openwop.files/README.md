# core.openwop.files

File + binary primitives. Capability-gated on `host.fs` (RFC 0014). Hosts MUST enforce a sandbox root and path-traversal protection per `SECURITY/invariants.yaml`.

| typeId | host capability | purpose |
|---|---|---|
| `core.files.read` / `write` / `delete` / `stat` / `list` | `host.fs` | Filesystem CRUD inside the sandbox root. |
| `core.files.to-base64` / `from-base64` | none (pure) | Encode helpers. |
| `core.files.detect-mime` | none (pure) | Sniff content type from first bytes / file extension. |
| `core.files.image-resize` / `image-crop` / `image-format-convert` | `host.fs.image` | Image processing. |
| `core.files.pdf-extract-text` / `pdf-split` / `pdf-merge` | `host.fs.pdf` | PDF processing. |
| `core.files.archive-create` / `archive-extract` | none (pure, uses zlib) | zip / tar / gzip. |
| `core.files.ftp` / `sftp` / `ssh-run` | `host.fs.transport` | Network file I/O. |
