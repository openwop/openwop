/**
 * @openwop/cli — installation, quickstart, and command catalog.
 *
 * This page is the in-app surface for discovering the OpenWOP CLI: how to
 * install it, how to point it at this host, and what every subcommand does.
 * Linked from the homepage hero (see site/src/build.mjs) and the header nav.
 *
 * Static-content page (no API calls) so it renders identically against any
 * host, including hosts that haven't deployed CLI-specific endpoints yet.
 */

import { PageHeader } from './ui/PageHeader.js';

function Cmd({ children }: { children: string }) {
  return <code>{children}</code>;
}

function Block({ children }: { children: string }) {
  return <pre>{children}</pre>;
}

export function CliPage() {
  return (
    <section className="cli-page">
      <PageHeader
        eyebrow="CLI"
        title="OpenWOP CLI"
        lede={<>The <Cmd>openwop</Cmd> command operates this host (and any OpenWOP-compatible host) from the terminal — auth onboarding, capabilities discovery, run submission + streaming, prompts + memory + agents, channel messaging, and host doctor.</>}
      />
      <div className="card">

        <h2>Install</h2>
        <p>Global (recommended for daily use):</p>
        <Block>{`npm install -g @openwop/cli
openwop --version`}</Block>
        <p>
          One-off (no install) — useful in CI or scratch shells:
        </p>
        <Block>{`npx -y @openwop/cli@latest --help`}</Block>
        <p className="muted">
          Requires Node ≥ 20. Channel adapters for Discord and WhatsApp are
          declared as <em>optional</em> peer dependencies; install them only
          if you actually use those channels.
        </p>

        <h2>Point it at this host</h2>
        <p>
          The CLI reads <Cmd>OPENWOP_BASE_URL</Cmd> (or <Cmd>--base-url</Cmd>)
          and <Cmd>OPENWOP_API_KEY</Cmd> (or the interactive onboard flow).
          Against this deployment:
        </p>
        <Block>{`export OPENWOP_BASE_URL=https://app.openwop.dev/api
openwop onboard           # interactive auth + key issuance
openwop doctor            # check connectivity + capability surface
openwop capabilities      # read /.well-known/openwop`}</Block>

        <h2>Command catalog</h2>
        <table className="cap-table">
          <thead>
            <tr><th>Group</th><th>Commands</th><th>What it does</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><Cmd>onboard</Cmd></td>
              <td><Cmd>--non-interactive</Cmd></td>
              <td>Stores a tenant API key + writes <Cmd>~/.openwop/config.json</Cmd>.</td>
            </tr>
            <tr>
              <td><Cmd>doctor</Cmd></td>
              <td><Cmd>--json</Cmd></td>
              <td>Connectivity + auth + advertised capability check; non-zero exit on hard failure.</td>
            </tr>
            <tr>
              <td><Cmd>capabilities</Cmd></td>
              <td>—</td>
              <td>Print this host's <Cmd>/.well-known/openwop</Cmd> document.</td>
            </tr>
            <tr>
              <td><Cmd>runs</Cmd></td>
              <td><Cmd>create</Cmd> · <Cmd>get</Cmd> · <Cmd>events</Cmd> · <Cmd>annotations</Cmd> · <Cmd>debug-bundle</Cmd></td>
              <td>Submit a workflow run, stream its events (<Cmd>values</Cmd>/<Cmd>updates</Cmd>/<Cmd>messages</Cmd>/<Cmd>debug</Cmd>), and pull the diagnostic bundle.</td>
            </tr>
            <tr>
              <td><Cmd>prompts</Cmd></td>
              <td><Cmd>list</Cmd> · <Cmd>render</Cmd></td>
              <td>Browse the host's prompt library (RFC 0027) and render a template with variables locally.</td>
            </tr>
            <tr>
              <td><Cmd>memory</Cmd></td>
              <td><Cmd>list</Cmd> · <Cmd>get</Cmd> · <Cmd>write</Cmd></td>
              <td>Inspect and write tenant-scoped agent memory (with SR-1 redaction).</td>
            </tr>
            <tr>
              <td><Cmd>agents</Cmd></td>
              <td><Cmd>list</Cmd> · <Cmd>get</Cmd> · <Cmd>dispatch</Cmd></td>
              <td>List the host's manifest-runtime agent inventory (RFC 0070/0072) and dispatch directly.</td>
            </tr>
            <tr>
              <td><Cmd>interrupts</Cmd></td>
              <td><Cmd>list</Cmd> · <Cmd>resume</Cmd></td>
              <td>Browse open HITL interrupts and answer them via the signed-token callback.</td>
            </tr>
            <tr>
              <td><Cmd>messaging</Cmd></td>
              <td><Cmd>connectors</Cmd> · <Cmd>routing</Cmd> · <Cmd>policy</Cmd> · <Cmd>pairing</Cmd> · <Cmd>allowlist</Cmd> · <Cmd>logs</Cmd></td>
              <td>Manage the messaging relay-gateway: list connectors, route a channel + peer to a workflow or agent, enforce pairing + allowlist + mention policy.</td>
            </tr>
            <tr>
              <td><Cmd>relay</Cmd></td>
              <td><Cmd>signal</Cmd> · <Cmd>imessage</Cmd> · <Cmd>whatsapp</Cmd> · <Cmd>discord</Cmd></td>
              <td>Run a channel-adapter daemon locally that bridges the named channel into this host (non-normative host extension).</td>
            </tr>
            <tr>
              <td><Cmd>notifications</Cmd></td>
              <td><Cmd>list</Cmd> · <Cmd>ack</Cmd></td>
              <td>Read + acknowledge the per-tenant inbox feed.</td>
            </tr>
          </tbody>
        </table>

        <h2>Channel relay (optional)</h2>
        <p>
          The <Cmd>messaging</Cmd> and <Cmd>relay</Cmd> commands are a
          non-normative host extension under <Cmd>/v1/host/sample/messaging/*</Cmd>:
          they let the CLI act as a local bridge between a chat channel
          (Signal, iMessage, WhatsApp, Discord) and a workflow or agent on
          this host. Each adapter is opt-in — install only what you use:
        </p>
        <Block>{`# Signal (signal-cli must be installed and registered separately)
openwop relay signal --account +15555550100

# Discord (npm install discord.js)
DISCORD_TOKEN=… openwop relay discord

# WhatsApp (npm install @whiskeysockets/baileys; first run prompts QR scan)
openwop relay whatsapp`}</Block>
        <p className="muted">
          The CLI never sees a user's primary credentials directly. It pairs
          with the host via a 6-character code over an authenticated session,
          and channel-side auth lives only in the local adapter process.
        </p>

        <h2>Source &amp; issues</h2>
        <p>
          The CLI is <a href="https://www.npmjs.com/package/@openwop/cli">@openwop/cli</a> on
          npm. Source, docs, and issue tracker live in
          {' '}<a href="https://github.com/openwop/openwop-cli">github.com/openwop/openwop-cli</a>.
          Bug reports especially welcome — the CLI is new (v0.2.x) and
          additive changes will land throughout v1.x.
        </p>
      </div>
    </section>
  );
}
