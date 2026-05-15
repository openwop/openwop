/**
 * Public-registry read helpers per
 * `spec/v1/registry-operations.md`.
 *
 * The OpenWOP host SDK targets the host wire surface
 * (`/.well-known/openwop` + `/v1/runs/*` + `/v1/interrupts/*` etc).
 * The **public node-pack registry** at `packs.openwop.dev` is a
 * separate wire surface with its own discovery payload and pack-
 * versioned read endpoints. This module exposes a thin typed client
 * for that surface so adopters fetching pack manifests, indices, or
 * signature material don't roll their own HTTP plumbing.
 *
 * Read-only by design — the public registry uses pull-request-driven
 * publishing per `spec/v1/registry-operations.md` §"Submission flow"
 * + the `registry-publish.yml` GitHub workflow. There is no write API.
 *
 * No auth required for public reads.
 *
 * @module @openwop/openwop/registry-helpers
 */

/** Public registry discovery payload per `registry-operations.md` §"Discovery". */
export interface RegistryDiscovery {
  registryVersion: string;
  protocolVersion: string;
  name?: string;
  operator?: string;
  url?: string;
  supportedNamespaces: readonly string[];
  supportedSigningMethods: readonly string[];
  supportedTrustModes?: readonly string[];
  endpoints: {
    registryIndex: string;
    packMetadata: string;
    versionManifest: string;
    versionTarball: string;
    versionSignature: string;
    publicKey: string;
  };
  signingKeys?: ReadonlyArray<{
    keyId: string;
    algorithm: string;
    publicKeyUrl?: string;
    permittedNamespaces?: readonly string[];
    operator?: string;
    status?: string;
  }>;
  [key: string]: unknown;
}

/** Registry-wide index entry per `/v1/index.json` rows. */
export interface RegistryIndexEntry {
  name: string;
  latestVersion: string;
  description?: string;
  scope?: string;
  [key: string]: unknown;
}

export interface RegistryIndex {
  packs: ReadonlyArray<RegistryIndexEntry>;
  generated?: string;
  packCount?: number;
  [key: string]: unknown;
}

/** Per-pack metadata document at `/v1/packs/{name}/index.json`. */
export interface RegistryPackMetadata {
  name: string;
  description?: string;
  versions: ReadonlyArray<string>;
  latestVersion?: string;
  [key: string]: unknown;
}

/** Version manifest at `/v1/packs/{name}/-/{version}.json`. */
export interface RegistryVersionManifest {
  name: string;
  version: string;
  description?: string;
  /** SRI hash: `sha256-<43-char-b64>=`. */
  integrity?: string;
  signing?: {
    method: 'ed25519' | 'manual' | string;
    keyId: string;
    publicKeyUrl?: string;
  };
  [key: string]: unknown;
}

export interface RegistryClientOptions {
  /** Base URL for the registry. Defaults to `https://packs.openwop.dev`. */
  baseUrl?: string;
  /** Custom fetch implementation; defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
}

/**
 * Typed client for the public OpenWOP node-pack registry. Read-only;
 * no auth required for the canonical public read surface.
 *
 * For host-side install-time verification (SRI + Ed25519 + lockfile),
 * see `examples/hosts/postgres/src/pack-consumer.ts` — the registry
 * client is the fetch surface; the consumer is the security surface.
 */
export class RegistryClient {
  readonly baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(options: RegistryClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'https://packs.openwop.dev').replace(/\/$/, '');
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** `GET /.well-known/openwop-registry` — discovery + endpoint catalog. */
  async discovery(): Promise<RegistryDiscovery> {
    return this.#getJson<RegistryDiscovery>('/.well-known/openwop-registry');
  }

  /** `GET /v1/index.json` — registry-wide pack index. */
  async index(): Promise<RegistryIndex> {
    return this.#getJson<RegistryIndex>('/v1/index.json');
  }

  /** `GET /v1/packs/{name}/index.json` — per-pack metadata. */
  async pack(name: string): Promise<RegistryPackMetadata> {
    return this.#getJson<RegistryPackMetadata>(
      `/v1/packs/${encodeURIComponent(name)}/index.json`,
    );
  }

  /** `GET /v1/packs/{name}/-/{version}.json` — version manifest. */
  async version(name: string, version: string): Promise<RegistryVersionManifest> {
    return this.#getJson<RegistryVersionManifest>(
      `/v1/packs/${encodeURIComponent(name)}/-/${encodeURIComponent(version)}.json`,
    );
  }

  /** Fetch raw tarball bytes. Caller MUST verify SRI + signature before trust. */
  async tarball(name: string, version: string): Promise<Buffer> {
    return this.#getBinary(
      `/v1/packs/${encodeURIComponent(name)}/-/${encodeURIComponent(version)}.tgz`,
    );
  }

  /** Fetch raw 64-byte Ed25519 signature bytes. */
  async signature(name: string, version: string): Promise<Buffer> {
    return this.#getBinary(
      `/v1/packs/${encodeURIComponent(name)}/-/${encodeURIComponent(version)}.sig`,
    );
  }

  /** Fetch a publisher's public key as PEM text. */
  async publicKey(keyId: string): Promise<string> {
    const res = await this.#fetch(`${this.baseUrl}/keys/${encodeURIComponent(keyId)}.pub`);
    if (!res.ok) throw new Error(`registry: GET /keys/${keyId}.pub returned ${res.status}`);
    return res.text();
  }

  async #getJson<T>(path: string): Promise<T> {
    const res = await this.#fetch(`${this.baseUrl}${path}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`registry: GET ${path} returned ${res.status}`);
    return (await res.json()) as T;
  }

  async #getBinary(path: string): Promise<Buffer> {
    const res = await this.#fetch(`${this.baseUrl}${path}`);
    if (!res.ok) throw new Error(`registry: GET ${path} returned ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
}
