"""Public-registry read helpers per ``spec/v1/registry-operations.md``.

The OpenWOP host SDK targets the host wire surface
(``/.well-known/openwop`` + ``/v1/runs/*`` etc). The **public node-pack
registry** at ``packs.openwop.dev`` is a separate wire surface with its
own discovery + per-pack-version reads. This module exposes a thin typed
client for that surface so adopters fetching pack manifests / indices /
signature material don't roll their own HTTP plumbing.

Read-only by design — the public registry uses pull-request-driven
publishing per ``spec/v1/registry-operations.md`` §"Submission flow".
There is no write API.

No auth required for public reads.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from urllib.request import Request, urlopen


@dataclass(frozen=True)
class RegistryDiscovery:
    registryVersion: str
    protocolVersion: str
    supportedNamespaces: list[str]
    supportedSigningMethods: list[str]
    endpoints: dict[str, str]
    name: str | None = None
    operator: str | None = None
    url: str | None = None
    supportedTrustModes: list[str] = field(default_factory=list)
    signingKeys: list[dict[str, Any]] = field(default_factory=list)


@dataclass(frozen=True)
class RegistryIndexEntry:
    name: str
    latestVersion: str
    description: str | None = None


@dataclass(frozen=True)
class RegistryIndex:
    packs: list[RegistryIndexEntry]
    generated: str | None = None
    packCount: int | None = None


@dataclass(frozen=True)
class RegistryPackMetadata:
    name: str
    versions: list[str]
    description: str | None = None
    latestVersion: str | None = None


@dataclass(frozen=True)
class RegistryVersionManifest:
    name: str
    version: str
    integrity: str | None = None
    description: str | None = None
    signing: dict[str, Any] | None = None


class RegistryClient:
    """Typed read-only client for the public OpenWOP node-pack registry.

    For host-side install-time verification (SRI + Ed25519 + lockfile),
    see ``examples/hosts/postgres/src/pack-consumer.ts`` — the registry
    client is the fetch surface; the consumer is the security surface.
    """

    def __init__(self, *, base_url: str = "https://packs.openwop.dev") -> None:
        self.base_url = base_url.rstrip("/")

    def discovery(self) -> RegistryDiscovery:
        d = self._get_json("/.well-known/openwop-registry")
        return RegistryDiscovery(
            registryVersion=str(d["registryVersion"]),
            protocolVersion=str(d["protocolVersion"]),
            supportedNamespaces=list(d.get("supportedNamespaces", [])),
            supportedSigningMethods=list(d.get("supportedSigningMethods", [])),
            endpoints=dict(d.get("endpoints", {})),
            name=d.get("name"),
            operator=d.get("operator"),
            url=d.get("url"),
            supportedTrustModes=list(d.get("supportedTrustModes", [])),
            signingKeys=list(d.get("signingKeys", [])),
        )

    def index(self) -> RegistryIndex:
        d = self._get_json("/v1/index.json")
        packs = [
            RegistryIndexEntry(
                name=str(p["name"]),
                latestVersion=str(p["latestVersion"]),
                description=p.get("description"),
            )
            for p in d.get("packs", [])
        ]
        return RegistryIndex(packs=packs, generated=d.get("generated"), packCount=d.get("packCount"))

    def pack(self, name: str) -> RegistryPackMetadata:
        d = self._get_json(f"/v1/packs/{name}/index.json")
        return RegistryPackMetadata(
            name=str(d["name"]),
            versions=list(d.get("versions", [])),
            description=d.get("description"),
            latestVersion=d.get("latestVersion"),
        )

    def version(self, name: str, version: str) -> RegistryVersionManifest:
        d = self._get_json(f"/v1/packs/{name}/-/{version}.json")
        return RegistryVersionManifest(
            name=str(d["name"]),
            version=str(d["version"]),
            integrity=d.get("integrity"),
            description=d.get("description"),
            signing=d.get("signing"),
        )

    def tarball(self, name: str, version: str) -> bytes:
        """Fetch raw tarball bytes. Caller MUST verify SRI + signature before trust."""

        return self._get_binary(f"/v1/packs/{name}/-/{version}.tgz")

    def signature(self, name: str, version: str) -> bytes:
        """Fetch raw 64-byte Ed25519 signature bytes."""

        return self._get_binary(f"/v1/packs/{name}/-/{version}.sig")

    def public_key(self, key_id: str) -> str:
        """Fetch a publisher's public key as PEM text."""

        url = f"{self.base_url}/keys/{key_id}.pub"
        with urlopen(url) as resp:  # noqa: S310 — public registry, no host-controlled URL
            return resp.read().decode("utf-8")

    def _get_json(self, path: str) -> dict[str, Any]:
        import json

        req = Request(f"{self.base_url}{path}", headers={"Accept": "application/json"})
        with urlopen(req) as resp:  # noqa: S310
            return json.loads(resp.read().decode("utf-8"))

    def _get_binary(self, path: str) -> bytes:
        url = f"{self.base_url}{path}"
        with urlopen(url) as resp:  # noqa: S310
            return resp.read()
