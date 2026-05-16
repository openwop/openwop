/**
 * BYOK secret-management routes.
 *
 *   GET    /v1/byok/secrets             — list stored refs (NEVER values)
 *   POST   /v1/byok/secrets             — { credentialRef, value } → stored
 *   DELETE /v1/byok/secrets/:credentialRef
 *
 * Sample-grade: keys live in the in-process `secretResolver` map and
 * vanish on restart. Real deployers wire KMS-wrapped storage behind
 * the same routes. The response payloads MUST NOT echo the secret
 * value back to the caller, even on success.
 *
 * Authed: every route requires a valid Bearer token (handled by the
 * global auth middleware).
 */

import type { Express } from 'express';
import { OpenwopError } from '../types.js';
import { listSecretRefs, removeSecret, setSecret } from '../byok/secretResolver.js';

interface SetSecretRequest {
  credentialRef?: unknown;
  value?: unknown;
}

const REF_PATTERN = /^[a-zA-Z0-9_.\-:]{1,128}$/;

export function registerByokRoutes(app: Express): void {
  app.get('/v1/byok/secrets', (_req, res) => {
    res.json({ credentialRefs: listSecretRefs() });
  });

  app.post('/v1/byok/secrets', (req, res, next) => {
    try {
      const body = req.body as SetSecretRequest;
      if (!body || typeof body !== 'object') {
        throw new OpenwopError('validation_error', 'Request body MUST be a JSON object.', 400);
      }
      if (typeof body.credentialRef !== 'string' || !REF_PATTERN.test(body.credentialRef)) {
        throw new OpenwopError(
          'validation_error',
          'Field `credentialRef` MUST match [a-zA-Z0-9_.-:]{1,128}.',
          400,
          { field: 'credentialRef' },
        );
      }
      if (typeof body.value !== 'string' || body.value.length === 0) {
        throw new OpenwopError(
          'validation_error',
          'Field `value` MUST be a non-empty string.',
          400,
          { field: 'value' },
        );
      }
      setSecret(body.credentialRef, body.value);
      // Echo back ONLY the ref + a masked preview. Never the value.
      res.status(201).json({
        credentialRef: body.credentialRef,
        masked: maskInline(body.value),
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/v1/byok/secrets/:credentialRef', (req, res, next) => {
    try {
      const ref = req.params.credentialRef;
      if (!REF_PATTERN.test(ref)) {
        throw new OpenwopError('validation_error', 'Invalid credentialRef.', 400, { credentialRef: ref });
      }
      removeSecret(ref);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });
}

function maskInline(value: string): string {
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
