// Public-registry read helpers per spec/v1/registry-operations.md.
//
// The OpenWOP host SDK targets the host wire surface (/.well-known/
// openwop + /v1/runs/* etc). The public node-pack registry at
// packs.openwop.dev is a separate wire surface with its own
// discovery + per-pack-version reads. This file exposes a thin typed
// client for that surface so adopters fetching pack manifests /
// indices / signature material don't roll their own HTTP plumbing.
//
// Read-only by design — the public registry uses pull-request-driven
// publishing per spec/v1/registry-operations.md §"Submission flow".
// There is no write API.
//
// No auth required for public reads.

package openwopclient

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// RegistryDiscovery is the public registry's discovery payload at
// /.well-known/openwop-registry.
type RegistryDiscovery struct {
	RegistryVersion         string            `json:"registryVersion"`
	ProtocolVersion         string            `json:"protocolVersion"`
	Name                    string            `json:"name,omitempty"`
	Operator                string            `json:"operator,omitempty"`
	URL                     string            `json:"url,omitempty"`
	SupportedNamespaces     []string          `json:"supportedNamespaces"`
	SupportedSigningMethods []string          `json:"supportedSigningMethods"`
	SupportedTrustModes     []string          `json:"supportedTrustModes,omitempty"`
	Endpoints               map[string]string `json:"endpoints"`
	SigningKeys             []map[string]any  `json:"signingKeys,omitempty"`
}

// RegistryIndexEntry is one row in the registry-wide index.
type RegistryIndexEntry struct {
	Name          string `json:"name"`
	LatestVersion string `json:"latestVersion"`
	Description   string `json:"description,omitempty"`
}

// RegistryIndex is the response from GET /v1/index.json.
type RegistryIndex struct {
	Packs     []RegistryIndexEntry `json:"packs"`
	Generated string               `json:"generated,omitempty"`
	PackCount int                  `json:"packCount,omitempty"`
}

// RegistryPackMetadata is the response from GET /v1/packs/{name}/index.json.
type RegistryPackMetadata struct {
	Name          string   `json:"name"`
	Description   string   `json:"description,omitempty"`
	Versions      []string `json:"versions"`
	LatestVersion string   `json:"latestVersion,omitempty"`
}

// RegistryVersionManifest is the response from
// GET /v1/packs/{name}/-/{version}.json.
type RegistryVersionManifest struct {
	Name        string `json:"name"`
	Version     string `json:"version"`
	Description string `json:"description,omitempty"`
	// Integrity is the SRI hash (sha256-<43-char-b64>=). Caller MUST
	// verify the downloaded tarball matches before trusting.
	Integrity string         `json:"integrity,omitempty"`
	Signing   map[string]any `json:"signing,omitempty"`
}

// RegistryClient is a typed read-only client for the public OpenWOP
// node-pack registry. For host-side install-time verification
// (SRI + Ed25519 + lockfile), see
// examples/hosts/postgres/src/pack-consumer.ts — this client is the
// fetch surface; the consumer is the security surface.
type RegistryClient struct {
	baseURL string
	httpc   *http.Client
}

// NewRegistryClient constructs a registry client. baseURL defaults
// to "https://packs.openwop.dev" if empty.
func NewRegistryClient(baseURL string, httpc *http.Client) *RegistryClient {
	if baseURL == "" {
		baseURL = "https://packs.openwop.dev"
	}
	if httpc == nil {
		httpc = http.DefaultClient
	}
	return &RegistryClient{baseURL: strings.TrimRight(baseURL, "/"), httpc: httpc}
}

// Discovery calls GET /.well-known/openwop-registry.
func (r *RegistryClient) Discovery(ctx context.Context) (*RegistryDiscovery, error) {
	var out RegistryDiscovery
	if err := r.getJSON(ctx, "/.well-known/openwop-registry", &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Index calls GET /v1/index.json.
func (r *RegistryClient) Index(ctx context.Context) (*RegistryIndex, error) {
	var out RegistryIndex
	if err := r.getJSON(ctx, "/v1/index.json", &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Pack calls GET /v1/packs/{name}/index.json.
func (r *RegistryClient) Pack(ctx context.Context, name string) (*RegistryPackMetadata, error) {
	var out RegistryPackMetadata
	if err := r.getJSON(ctx, "/v1/packs/"+name+"/index.json", &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Version calls GET /v1/packs/{name}/-/{version}.json.
func (r *RegistryClient) Version(ctx context.Context, name, version string) (*RegistryVersionManifest, error) {
	var out RegistryVersionManifest
	if err := r.getJSON(ctx, "/v1/packs/"+name+"/-/"+version+".json", &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Tarball fetches raw tarball bytes for a pack version. Caller MUST
// verify SRI + signature before trusting.
func (r *RegistryClient) Tarball(ctx context.Context, name, version string) ([]byte, error) {
	return r.getBinary(ctx, "/v1/packs/"+name+"/-/"+version+".tgz")
}

// Signature fetches the raw 64-byte Ed25519 signature bytes.
func (r *RegistryClient) Signature(ctx context.Context, name, version string) ([]byte, error) {
	return r.getBinary(ctx, "/v1/packs/"+name+"/-/"+version+".sig")
}

// PublicKey fetches a publisher's public key as PEM text.
func (r *RegistryClient) PublicKey(ctx context.Context, keyID string) (string, error) {
	body, err := r.getBinary(ctx, "/keys/"+keyID+".pub")
	if err != nil {
		return "", err
	}
	return string(body), nil
}

func (r *RegistryClient) getJSON(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, r.baseURL+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := r.httpc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("registry: GET %s returned %d", path, resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (r *RegistryClient) getBinary(ctx context.Context, path string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, r.baseURL+path, nil)
	if err != nil {
		return nil, err
	}
	resp, err := r.httpc.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("registry: GET %s returned %d", path, resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}
