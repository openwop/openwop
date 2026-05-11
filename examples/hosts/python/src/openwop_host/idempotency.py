"""Layer-1 idempotency cache.

Per `spec/v1/idempotency.md` §"Cache key composition":
    cache_key = sha256(tenantId + endpoint + idempotency_key)

This reference host uses a single hardcoded tenant; production hosts
key by the authenticated tenantId. 24-hour TTL per spec recommendation.

Body hashing: when an Idempotency-Key is reused with a *different*
body, hosts MUST return 409 (caller misuse — a key pins one logical
operation). We store the body hash alongside the cached response so
the conflict check is constant-time.
"""

from __future__ import annotations

import hashlib
import threading
import time
from dataclasses import dataclass

_TTL_SECONDS = 24 * 60 * 60  # 24 hours per idempotency.md


@dataclass
class IdempotencyEntry:
    status: int
    body: str
    content_type: str
    body_hash: str
    stored_at: float


class IdempotencyCache:
    """Thread-safe Layer-1 cache. All mutations hold `_lock`."""

    def __init__(self) -> None:
        self._entries: dict[str, IdempotencyEntry] = {}
        self._lock = threading.Lock()

    @staticmethod
    def cache_key(endpoint: str, idempotency_key: str, tenant_id: str = "single-tenant") -> str:
        material = f"{tenant_id}:{endpoint}:{idempotency_key}".encode("utf-8")
        return hashlib.sha256(material).hexdigest()

    @staticmethod
    def hash_body(body: str) -> str:
        return hashlib.sha256(body.encode("utf-8")).hexdigest()

    def get(self, key: str) -> IdempotencyEntry | None:
        with self._lock:
            self._prune_locked()
            return self._entries.get(key)

    def put(self, key: str, entry: IdempotencyEntry) -> None:
        with self._lock:
            self._entries[key] = entry

    def _prune_locked(self) -> None:
        cutoff = time.time() - _TTL_SECONDS
        stale = [k for k, v in self._entries.items() if v.stored_at < cutoff]
        for k in stale:
            del self._entries[k]
