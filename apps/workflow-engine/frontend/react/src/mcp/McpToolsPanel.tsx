/**
 * McpToolsPanel — lists the MCP tools the connected host advertises
 * (RFC 0020), via a `tools/list` JSON-RPC call. Embedded on the
 * Capabilities page as another host-discovery surface.
 *
 * The host's MCP mount is opt-in (`OPENWOP_MCP_SERVER_ENABLED`), so the
 * panel renders a clear "not enabled" state rather than an error when
 * the seam is off.
 */

import { useEffect, useState } from 'react';
import { listMcpTools, type McpTool } from './mcpClient.js';

export function McpToolsPanel() {
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'disabled' } | { status: 'error'; message: string } | { status: 'ready'; tools: McpTool[] }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    listMcpTools().then((r) => {
      if (cancelled) return;
      if (!r.enabled) setState({ status: 'disabled' });
      else if (r.error) setState({ status: 'error', message: r.error });
      else setState({ status: 'ready', tools: r.tools });
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="card">
      <h2>MCP tools <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>(RFC 0020)</span></h2>
      {state.status === 'loading' && <div className="muted">Probing host MCP seam…</div>}
      {state.status === 'disabled' && (
        <p className="muted" style={{ fontSize: 13 }}>
          This host doesn&apos;t expose an MCP server mount (<code>OPENWOP_MCP_SERVER_ENABLED</code> is off).
          When enabled, the host advertises its registered workflows as MCP tools here.
        </p>
      )}
      {state.status === 'error' && <div className="alert error">{state.message}</div>}
      {state.status === 'ready' && state.tools.length === 0 && (
        <p className="muted" style={{ fontSize: 13 }}>MCP mount is enabled, but no tools are advertised.</p>
      )}
      {state.status === 'ready' && state.tools.length > 0 && (
        <ul className="mcp-tool-list">
          {state.tools.map((t) => (
            <li key={t.name} className="mcp-tool">
              <div className="mcp-tool-head">
                <code className="mcp-tool-name">{t.name}</code>
              </div>
              {t.description && <p className="mcp-tool-desc muted">{t.description}</p>}
              {t.inputSchema && Object.keys(t.inputSchema).length > 0 && (
                <details>
                  <summary className="muted">input schema</summary>
                  <pre>{JSON.stringify(t.inputSchema, null, 2)}</pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
