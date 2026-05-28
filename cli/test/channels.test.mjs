// Run via `npm test` (builds dist/ first) — these import the esbuild bundle at ../dist/cli.js.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseSignalEnvelope,
  parseImessageRow,
  parseWhatsappMessage,
  parseDiscordMessage,
  decodeAttributedBodyHex,
  getChannelPlugin,
  startInboundReceive,
} from '../dist/cli.js';

/** Build a hex `attributedBody` BLOB: …NSString + <len-prefix> + UTF-8 text. */
function attributedBodyHex(text) {
  const t = Buffer.from(text, 'utf8');
  let prefix;
  if (t.length < 0x80) prefix = Buffer.from([0x2b, t.length]);
  else prefix = Buffer.from([0x2b, 0x81, t.length & 0xff, (t.length >> 8) & 0xff]);
  return Buffer.concat([Buffer.from('streamtyped\x81\xe8\x03\x84\x01\x40\x84\x84\x84NSString', 'latin1'), prefix, t, Buffer.from([0x86])]).toString('hex');
}

describe('channel normalizers (B4 parsing core)', () => {
  it('signal: DM envelope → InboundMessage', () => {
    const m = parseSignalEnvelope({
      envelope: { source: '+15551234', sourceName: 'Ada', timestamp: 1716800000000, dataMessage: { message: 'hi there' } },
    });
    assert.equal(m.conversationId, '+15551234');
    assert.equal(m.peerId, '+15551234');
    assert.equal(m.peerDisplay, 'Ada');
    assert.equal(m.text, 'hi there');
    assert.match(m.timestamp, /^20/);
  });
  it('signal: group routes on groupId; receipts/empty → null', () => {
    const g = parseSignalEnvelope({ envelope: { source: '+1', timestamp: 1, dataMessage: { message: 'yo', groupInfo: { groupId: 'GRP==' } } } });
    assert.equal(g.conversationId, 'group:GRP==');
    assert.equal(parseSignalEnvelope({ envelope: { source: '+1', receiptMessage: {} } }), null);
    assert.equal(parseSignalEnvelope({ envelope: { source: '+1', dataMessage: { message: '' } } }), null);
  });

  it('imessage: inbound row → InboundMessage; is_from_me skipped', () => {
    const m = parseImessageRow({ ROWID: 42, text: 'pong', is_from_me: 0, dateUtc: '2026-05-27T00:00:00.000Z', handle_id_str: '+15559999' });
    assert.equal(m.platformMessageId, '42');
    assert.equal(m.peerId, '+15559999');
    assert.equal(m.text, 'pong');
    assert.equal(parseImessageRow({ ROWID: 43, text: 'mine', is_from_me: 1, handle_id_str: '+1' }), null);
  });

  it('imessage: decodes attributedBody when text is NULL (modern macOS)', () => {
    // text NULL/empty + attributedBody hex → text comes from the BLOB.
    const m = parseImessageRow({
      ROWID: 44, text: null, is_from_me: 0, handle_id_str: '+15550000',
      attributed_body_hex: attributedBodyHex('hello from attributedBody'),
    });
    assert.equal(m.text, 'hello from attributedBody');
    // Long string (>127 bytes) uses the 0x81 2-byte length path.
    const long = 'x'.repeat(200);
    assert.equal(decodeAttributedBodyHex(attributedBodyHex(long)), long);
    // Unrecognized blob → null (we never guess).
    assert.equal(decodeAttributedBodyHex('00ff00ff'), null);
    // Still null when neither text nor a decodable body is present.
    assert.equal(parseImessageRow({ ROWID: 45, text: '', is_from_me: 0, handle_id_str: '+1', attributed_body_hex: 'deadbeef' }), null);
  });

  it('imessage: Apple ns/seconds date both decode to a 20xx ISO', () => {
    // ns since 2001 for a 2024-ish date (~7.4e17) and seconds since 2001 (~7.6e8).
    const ns = parseImessageRow({ ROWID: 46, text: 'a', is_from_me: 0, handle_id_str: '+1', date: 740000000000000000 });
    assert.match(ns.timestamp, /^20\d\d-/);
    const secs = parseImessageRow({ ROWID: 47, text: 'b', is_from_me: 0, handle_id_str: '+1', date: 760000000 });
    assert.match(secs.timestamp, /^20\d\d-/);
  });

  it('whatsapp: Baileys message → InboundMessage; fromMe skipped', () => {
    const m = parseWhatsappMessage({ key: { remoteJid: '1@s.whatsapp.net', fromMe: false, id: 'ABC' }, message: { conversation: 'hello wa' }, pushName: 'Grace', messageTimestamp: 1716800000 });
    assert.equal(m.conversationId, '1@s.whatsapp.net');
    assert.equal(m.text, 'hello wa');
    assert.equal(m.peerDisplay, 'Grace');
    assert.equal(parseWhatsappMessage({ key: { remoteJid: '1@x', fromMe: true }, message: { conversation: 'mine' } }), null);
  });

  it('discord: message → InboundMessage (guild meta, attachments Collection); bot skipped', () => {
    // attachments as a discord.js-style Collection (has .values()).
    const attachments = { values: () => [{ url: 'https://cdn/x.png', contentType: 'image/png', name: 'x.png' }] };
    const m = parseDiscordMessage({
      id: '999', content: 'hey bot', channelId: 'chan-1', guildId: 'guild-1',
      author: { id: 'u-1', username: 'Ada', bot: false },
      createdTimestamp: 1716800000000, reference: { messageId: 'm-parent' }, attachments,
    });
    assert.equal(m.conversationId, 'chan-1');
    assert.equal(m.peerId, 'u-1');
    assert.equal(m.peerDisplay, 'Ada');
    assert.equal(m.text, 'hey bot');
    assert.equal(m.quotedMessageId, 'm-parent');
    assert.deepEqual(m.channelMeta, { guildId: 'guild-1' });
    assert.equal(m.media[0].filename, 'x.png');
    // bot author dropped; empty (no text, no media) dropped.
    assert.equal(parseDiscordMessage({ id: '1', content: 'x', channelId: 'c', author: { id: 'b', bot: true } }), null);
    assert.equal(parseDiscordMessage({ id: '2', content: '', channelId: 'c', author: { id: 'u' }, attachments: [] }), null);
  });
});

describe('channel registry + availability', () => {
  it('returns a plugin per channel; whatsapp unavailable in core CLI', () => {
    assert.equal(getChannelPlugin('signal').channel, 'signal');
    assert.equal(getChannelPlugin('whatsapp').isAvailable({}).available, false);
    assert.equal(getChannelPlugin('imessage').isAvailable({ OPENWOP_FORCE_PLATFORM: 'darwin' }).available, true);
    assert.throws(() => getChannelPlugin('telegram'));
  });

  it('signal: daemon URL makes it available without the local binary', () => {
    const a = getChannelPlugin('signal').isAvailable({ OPENWOP_SIGNAL_DAEMON_URL: 'http://127.0.0.1:8080' });
    assert.equal(a.available, true);
    assert.match(a.detail, /daemon/);
  });

  it('discord: registered; unavailable without discord.js / token', () => {
    const p = getChannelPlugin('discord');
    assert.equal(p.channel, 'discord');
    // discord.js not installed in the core CLI build → unavailable with a hint.
    assert.equal(p.isAvailable({ OPENWOP_DISCORD_BOT_TOKEN: 't' }).available, false);
  });

  it('discord: deliver() attempts discord.js (clean error, not a hard stub)', async () => {
    await assert.rejects(
      getChannelPlugin('discord').deliver({ conversationId: 'chan', text: 'hi' }),
      /OPENWOP_DISCORD_BOT_TOKEN|discord\.js/,
    );
  });

  it('whatsapp: deliver() attempts Baileys (clean install error, not a hard stub)', async () => {
    // Baileys isn't installed in the core CLI build, so deliver should fail
    // with a clear "install @whiskeysockets/baileys" message — proving the
    // path now genuinely loads the lib instead of throwing "not bundled".
    await assert.rejects(
      getChannelPlugin('whatsapp').deliver({ conversationId: '1@s.whatsapp.net', text: 'hi' }),
      /@whiskeysockets\/baileys/,
    );
  });
});

describe('signal daemon transport (SSE receive)', () => {
  it('parses SSE frames from the signal-cli daemon and forwards normalized messages', async () => {
    // Stream two SSE frames: a JSON-RPC `receive` notification + a noise frame.
    const frames = [
      'data: ' + JSON.stringify({ jsonrpc: '2.0', method: 'receive', params: { envelope: { source: '+15551234', sourceName: 'Ada', timestamp: 1716800000000, dataMessage: { message: 'via daemon' } } } }) + '\n\n',
      'data: ' + JSON.stringify({ jsonrpc: '2.0', method: 'receive', params: { envelope: { source: '+1', receiptMessage: {} } } }) + '\n\n',
    ];
    const enc = new TextEncoder();
    const body = new ReadableStream({
      start(c) { for (const f of frames) c.enqueue(enc.encode(f)); c.close(); },
    });
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    try {
      const got = [];
      const done = new Promise((resolve) => {
        const onInbound = async (m) => { got.push(m); resolve(); };
        getChannelPlugin('signal')
          .startReceive(onInbound, { env: { OPENWOP_SIGNAL_DAEMON_URL: 'http://127.0.0.1:8080' } })
          .then((stop) => { setTimeout(stop, 60); });
      });
      await Promise.race([done, new Promise((r) => setTimeout(r, 500))]);
      assert.equal(got.length, 1, 'one deliverable message (receipt skipped)');
      assert.equal(got[0].text, 'via daemon');
      assert.equal(got[0].peerId, '+15551234');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe('startInboundReceive forwards normalized messages to /device/inbound (B4 wiring)', () => {
  it('POSTs each inbound message from the plugin to the host', async () => {
    const posted = [];
    const fetchImpl = async (url, init) => {
      posted.push({ path: new URL(url).pathname, body: JSON.parse(init.body), devTok: init.headers['x-openwop-device-token'] });
      return new Response(JSON.stringify({ accepted: true, sessionKey: 'signal:c1' }), { status: 202, headers: { 'content-type': 'application/json' } });
    };
    // Fake plugin: synchronously emits two inbound messages, then resolves a stop fn.
    const fakePlugin = {
      channel: 'signal',
      isAvailable: () => ({ channel: 'signal', available: true, detail: 'fake' }),
      deliver: async () => {},
      startReceive: async (onInbound) => {
        await onInbound({ platformMessageId: 'm1', conversationId: '+1', peerId: '+1', text: 'one', timestamp: 'now' });
        await onInbound({ platformMessageId: 'm2', conversationId: '+1', peerId: '+1', text: 'two', timestamp: 'now' });
        return () => {};
      },
    };
    let out = '';
    const ctx = {
      baseUrl: 'http://mock.local',
      apiKey: 'k',
      fetchImpl,
      env: {},
      relayPlugin: fakePlugin,
      io: { stdout: { write: (s) => { out += s; } }, stderr: { write: () => {} } },
    };
    const stop = await startInboundReceive(ctx, { channel: 'signal', deviceToken: 'dtok_x' }, { 'x-openwop-device-token': 'dtok_x' });
    assert.equal(typeof stop, 'function');
    assert.equal(posted.length, 2);
    assert.deepEqual(posted.map((p) => p.body.text), ['one', 'two']);
    assert.equal(posted[0].path, '/v1/host/sample/messaging/device/inbound');
    assert.equal(posted[0].devTok, 'dtok_x');
    assert.match(out, /Inbound receive active/);
  });

  it('skips (no stop fn) when the channel is unavailable', async () => {
    const ctx = {
      baseUrl: 'http://mock.local', apiKey: 'k', env: {},
      fetchImpl: async () => { throw new Error('should not fetch'); },
      relayPlugin: { channel: 'signal', isAvailable: () => ({ channel: 'signal', available: false, detail: 'no signal-cli' }), deliver: async () => {}, startReceive: async () => () => {} },
      io: { stdout: { write: () => {} }, stderr: { write: () => {} } },
    };
    const stop = await startInboundReceive(ctx, { channel: 'signal', deviceToken: 'd' }, {});
    assert.equal(stop, undefined);
  });
});
