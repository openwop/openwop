import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseSignalEnvelope,
  parseImessageRow,
  parseWhatsappMessage,
  getChannelPlugin,
  startInboundReceive,
} from '../dist/cli.js';

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

  it('whatsapp: Baileys message → InboundMessage; fromMe skipped', () => {
    const m = parseWhatsappMessage({ key: { remoteJid: '1@s.whatsapp.net', fromMe: false, id: 'ABC' }, message: { conversation: 'hello wa' }, pushName: 'Grace', messageTimestamp: 1716800000 });
    assert.equal(m.conversationId, '1@s.whatsapp.net');
    assert.equal(m.text, 'hello wa');
    assert.equal(m.peerDisplay, 'Grace');
    assert.equal(parseWhatsappMessage({ key: { remoteJid: '1@x', fromMe: true }, message: { conversation: 'mine' } }), null);
  });
});

describe('channel registry + availability', () => {
  it('returns a plugin per channel; whatsapp unavailable in core CLI', () => {
    assert.equal(getChannelPlugin('signal').channel, 'signal');
    assert.equal(getChannelPlugin('whatsapp').isAvailable({}).available, false);
    assert.equal(getChannelPlugin('imessage').isAvailable({ OPENWOP_FORCE_PLATFORM: 'darwin' }).available, true);
    assert.throws(() => getChannelPlugin('telegram'));
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
