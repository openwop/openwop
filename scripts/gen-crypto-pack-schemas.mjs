#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PACK = 'core.openwop.crypto';
const VER = '1.0.0';
const OUT = join('packs', PACK, 'schemas');
mkdirSync(OUT, { recursive: true });
const $id = (f) => `https://packs.openwop.dev/${PACK}/${VER}/${f}`;
const obj = (title, required, properties) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title, type: 'object',
  ...(required && required.length ? { required } : {}),
  properties, additionalProperties: false,
});

const ENC = { type: 'string', enum: ['utf8','hex','base64','base64url'] };
const OUT_ENC = { type: 'string', enum: ['hex','base64','base64url'] };

const M = {
  hash: {
    c: obj('HashConfig', [], {
      algorithm: { type: 'string', enum: ['sha256','sha384','sha512','sha1','md5','blake2b512'], default: 'sha256' },
      inputEncoding: ENC, outputEncoding: OUT_ENC,
    }),
    i: obj('HashInput', ['data'], { data: { type: 'string' } }),
    o: obj('HashOutput', ['digest','algorithm'], { digest: { type: 'string' }, algorithm: { type: 'string' } }),
  },
  'hmac-sign': {
    c: obj('HmacSignConfig', [], {
      algorithm: { type: 'string', enum: ['sha256','sha384','sha512'], default: 'sha256' },
      keyEncoding: ENC, inputEncoding: ENC, outputEncoding: OUT_ENC,
    }),
    i: obj('HmacSignInput', ['key','data'], { key: { type: 'string' }, data: { type: 'string' } }),
    o: obj('HmacSignOutput', ['signature','algorithm'], { signature: { type: 'string' }, algorithm: { type: 'string' } }),
  },
  'hmac-verify': {
    c: obj('HmacVerifyConfig', [], {
      algorithm: { type: 'string', enum: ['sha256','sha384','sha512'], default: 'sha256' },
      keyEncoding: ENC, inputEncoding: ENC, signatureEncoding: OUT_ENC,
    }),
    i: obj('HmacVerifyInput', ['key','data','signature'], { key: { type: 'string' }, data: { type: 'string' }, signature: { type: 'string' } }),
    o: obj('HmacVerifyOutput', ['valid'], { valid: { type: 'boolean' } }),
  },
  'aead-encrypt': {
    c: obj('AeadEncryptConfig', [], {
      algorithm: { type: 'string', enum: ['aes-256-gcm','chacha20-poly1305'], default: 'aes-256-gcm' },
      keyEncoding: ENC, inputEncoding: ENC, aadEncoding: ENC, outputEncoding: OUT_ENC,
    }),
    i: obj('AeadEncryptInput', ['key','plaintext'], { key: { type: 'string' }, plaintext: { type: 'string' }, aad: { type: 'string' } }),
    o: obj('AeadEncryptOutput', ['ciphertext','iv','authTag','algorithm'], {
      ciphertext: { type: 'string' }, iv: { type: 'string' }, authTag: { type: 'string' }, algorithm: { type: 'string' },
    }),
  },
  'aead-decrypt': {
    c: obj('AeadDecryptConfig', [], {
      algorithm: { type: 'string', enum: ['aes-256-gcm','chacha20-poly1305'], default: 'aes-256-gcm' },
      keyEncoding: ENC, inputEncoding: OUT_ENC, aadEncoding: ENC, outputEncoding: ENC,
    }),
    i: obj('AeadDecryptInput', ['key','ciphertext','iv','authTag'], {
      key: { type: 'string' }, ciphertext: { type: 'string' }, iv: { type: 'string' }, authTag: { type: 'string' }, aad: { type: 'string' },
    }),
    o: obj('AeadDecryptOutput', ['plaintext','algorithm'], { plaintext: { type: 'string' }, algorithm: { type: 'string' } }),
  },
  sign: {
    c: obj('SignConfig', [], {
      algorithm: { type: 'string', enum: ['ed25519','rs256','ps256','es256'], default: 'ed25519' },
      inputEncoding: ENC, outputEncoding: OUT_ENC,
    }),
    i: obj('SignInput', ['data','privateKeyPem'], { data: { type: 'string' }, privateKeyPem: { type: 'string' } }),
    o: obj('SignOutput', ['signature','algorithm'], { signature: { type: 'string' }, algorithm: { type: 'string' } }),
  },
  verify: {
    c: obj('VerifyConfig', [], {
      algorithm: { type: 'string', enum: ['ed25519','rs256','ps256','es256'], default: 'ed25519' },
      inputEncoding: ENC, signatureEncoding: OUT_ENC,
    }),
    i: obj('VerifyInput', ['data','signature','publicKeyPem'], { data: { type: 'string' }, signature: { type: 'string' }, publicKeyPem: { type: 'string' } }),
    o: obj('VerifyOutput', ['valid'], { valid: { type: 'boolean' } }),
  },
  'jwt-mint': {
    c: obj('JwtMintConfig', [], {
      algorithm: { type: 'string', enum: ['HS256','HS384','HS512','RS256','PS256','ES256','EdDSA'], default: 'HS256' },
      keyEncoding: ENC,
      ttlSeconds: { type: 'integer', minimum: 0, default: 3600 },
      headerExtras: { type: 'object', additionalProperties: true },
    }),
    i: obj('JwtMintInput', ['key','claims'], { key: { type: 'string' }, claims: { type: 'object', additionalProperties: true }, kid: { type: 'string' } }),
    o: obj('JwtMintOutput', ['token','algorithm'], { token: { type: 'string' }, algorithm: { type: 'string' }, expiresAt: { type: ['integer','null'] } }),
  },
  'jwt-verify': {
    c: obj('JwtVerifyConfig', [], {
      keyEncoding: ENC,
      expectedIssuer: { type: 'string' },
      expectedAudience: { type: 'string' },
    }),
    i: obj('JwtVerifyInput', ['token'], {
      token: { type: 'string' },
      key: { type: 'string' },
      jwks: { type: 'object', properties: { keys: { type: 'array' } }, additionalProperties: true },
    }),
    o: obj('JwtVerifyOutput', ['valid'], {
      valid: { type: 'boolean' },
      reason: { type: 'string' },
      claims: { type: 'object', additionalProperties: true },
    }),
  },
  'totp-generate': {
    c: obj('TotpGenerateConfig', [], {
      algorithm: { type: 'string', enum: ['sha1','sha256','sha512'], default: 'sha1' },
      digits: { type: 'integer', enum: [6,7,8], default: 6 },
      stepSeconds: { type: 'integer', minimum: 1, default: 30 },
      secretEncoding: { type: 'string', enum: ['utf8','hex','base64','base32'], default: 'base32' },
    }),
    i: obj('TotpGenerateInput', ['secret'], { secret: { type: 'string' }, at: { type: 'string', format: 'date-time' } }),
    o: obj('TotpGenerateOutput', ['code','at','step','digits','algorithm'], {
      code: { type: 'string' }, at: { type: 'integer' }, step: { type: 'integer' }, digits: { type: 'integer' }, algorithm: { type: 'string' },
    }),
  },
  'totp-verify': {
    c: obj('TotpVerifyConfig', [], {
      algorithm: { type: 'string', enum: ['sha1','sha256','sha512'], default: 'sha1' },
      digits: { type: 'integer', enum: [6,7,8], default: 6 },
      stepSeconds: { type: 'integer', minimum: 1, default: 30 },
      secretEncoding: { type: 'string', enum: ['utf8','hex','base64','base32'], default: 'base32' },
      driftWindow: { type: 'integer', minimum: 0, maximum: 10, default: 1 },
    }),
    i: obj('TotpVerifyInput', ['secret','code'], { secret: { type: 'string' }, code: { type: 'string' }, at: { type: 'string', format: 'date-time' } }),
    o: obj('TotpVerifyOutput', ['valid'], { valid: { type: 'boolean' }, drift: { type: ['integer','null'] } }),
  },
  'x509-parse': {
    c: obj('X509ParseConfig', [], {}),
    i: obj('X509ParseInput', ['pem'], { pem: { type: 'string' } }),
    o: obj('X509ParseOutput', ['subject','issuer','fingerprint256','validFrom','validTo','serialNumber'], {
      subject: { type: 'string' }, issuer: { type: 'string' }, san: { type: ['string','null'] },
      fingerprint256: { type: 'string' }, validFrom: { type: 'string' }, validTo: { type: 'string' },
      serialNumber: { type: 'string' }, ca: { type: 'boolean' }, keyUsage: {},
    }),
  },
  'x509-verify-chain': {
    c: obj('X509VerifyChainConfig', [], {}),
    i: obj('X509VerifyChainInput', ['leafPem','trustRootsPem'], {
      leafPem: { type: 'string' },
      intermediatesPem: { type: 'array', items: { type: 'string' } },
      trustRootsPem: { type: 'array', items: { type: 'string' } },
    }),
    o: obj('X509VerifyChainOutput', ['valid'], {
      valid: { type: 'boolean' }, reason: { type: 'string' }, failedAt: { type: 'integer' },
      chain: { type: 'array', items: { type: 'object', additionalProperties: true } },
    }),
  },
};

let count = 0;
for (const [node, parts] of Object.entries(M)) {
  for (const [k, schema] of [['config', parts.c], ['input', parts.i], ['output', parts.o]]) {
    const f = `${node}.${k}.json`;
    const ordered = { $schema: schema.$schema, $id: $id(f), ...Object.fromEntries(Object.entries(schema).filter(([x]) => x !== '$schema' && x !== '$id')) };
    writeFileSync(join(OUT, f), JSON.stringify(ordered, null, 2) + '\n');
    count++;
  }
}
console.log(`wrote ${count} schemas to ${OUT}`);
