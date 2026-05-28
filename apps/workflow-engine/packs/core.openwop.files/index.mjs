/**
 * core.openwop.files — fs / image / pdf / archive / transport.
 *
 * fs / image / pdf / archive / ftp / sftp / ssh delegate to ctx.fs.* and
 * its cousins (host.fs RFC 0014). The pure utilities (to-base64,
 * from-base64, detect-mime) run inline with stdlib only.
 *
 * Security: host MUST enforce sandbox root + path-traversal protection
 * per SECURITY/invariants.yaml.
 */

function delegate(surface, method) {
  return async function (ctx) {
    const target = ctx.fs?.[surface] ?? ctx[surface];
    const fn = target?.[method];
    if (typeof fn !== 'function') {
      throw Object.assign(new Error(`host does not implement ctx.fs.${surface}.${method}`), { code: 'HOST_CAPABILITY_MISSING' });
    }
    const result = await fn.call(target, { ...ctx.config, ...ctx.inputs });
    return { status: 'success', outputs: result };
  };
}

function fsOp(method) {
  return async function (ctx) {
    const fn = ctx.fs?.[method];
    if (typeof fn !== 'function') {
      throw Object.assign(new Error(`host does not implement ctx.fs.${method}`), { code: 'HOST_CAPABILITY_MISSING' });
    }
    const result = await fn.call(ctx.fs, { ...ctx.config, ...ctx.inputs });
    return { status: 'success', outputs: result };
  };
}

export async function toBase64(ctx) {
  return { status: 'success', outputs: { base64: Buffer.from(ctx.inputs.text, 'utf8').toString('base64') } };
}

export async function fromBase64(ctx) {
  const out = Buffer.from(ctx.inputs.base64, 'base64').toString(ctx.config.outputEncoding || 'utf8');
  return { status: 'success', outputs: { text: out } };
}

const MAGIC = [
  { sig: [0xff, 0xd8, 0xff], mime: 'image/jpeg' },
  { sig: [0x89, 0x50, 0x4e, 0x47], mime: 'image/png' },
  { sig: [0x47, 0x49, 0x46, 0x38], mime: 'image/gif' },
  { sig: [0x25, 0x50, 0x44, 0x46], mime: 'application/pdf' },
  { sig: [0x50, 0x4b, 0x03, 0x04], mime: 'application/zip' },
  { sig: [0x1f, 0x8b], mime: 'application/gzip' },
];

export async function detectMime(ctx) {
  const buf = ctx.inputs.contentBase64 ? Buffer.from(ctx.inputs.contentBase64, 'base64') : null;
  if (buf) {
    for (const m of MAGIC) {
      if (m.sig.every((b, i) => buf[i] === b)) return { status: 'success', outputs: { mimeType: m.mime, confidence: 0.95 } };
    }
  }
  // fall back to filename extension
  const ext = (ctx.inputs.filename || '').toLowerCase().split('.').pop();
  const extMap = { json: 'application/json', txt: 'text/plain', html: 'text/html', csv: 'text/csv', xml: 'application/xml', md: 'text/markdown' };
  if (extMap[ext]) return { status: 'success', outputs: { mimeType: extMap[ext], confidence: 0.5 } };
  return { status: 'success', outputs: { mimeType: 'application/octet-stream', confidence: 0 } };
}

export const nodes = {
  'core.files.read':                  fsOp('read'),
  'core.files.write':                 fsOp('write'),
  'core.files.delete':                fsOp('delete'),
  'core.files.stat':                  fsOp('stat'),
  'core.files.list':                  fsOp('list'),
  'core.files.to-base64':             toBase64,
  'core.files.from-base64':           fromBase64,
  'core.files.detect-mime':           detectMime,
  'core.files.image-resize':          delegate('image', 'resize'),
  'core.files.image-crop':            delegate('image', 'crop'),
  'core.files.image-format-convert':  delegate('image', 'formatConvert'),
  'core.files.pdf-extract-text':      delegate('pdf', 'extractText'),
  'core.files.pdf-split':             delegate('pdf', 'split'),
  'core.files.pdf-merge':             delegate('pdf', 'merge'),
  'core.files.archive-create':        delegate('archive', 'create'),
  'core.files.archive-extract':       delegate('archive', 'extract'),
  'core.files.ftp':                   delegate('ftp', 'invoke'),
  'core.files.sftp':                  delegate('sftp', 'invoke'),
  'core.files.ssh-run':               delegate('ssh', 'run'),
};

export default nodes;
