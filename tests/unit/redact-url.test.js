// Path: tests/unit/redact-url.test.js
// Pins that credential-bearing query params are masked before URLs are logged.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redactUrl } from '../../src/utils/redact-url.js';

describe('redactUrl', () => {
  it('masks ?api_key= while preserving path and other params', () => {
    const out = redactUrl('/api/v1/nomes/busca?q=rio&api_key=3f2a1b4c-0000-4000-8000-000000000000');
    assert.match(out, /q=rio/);
    assert.doesNotMatch(out, /3f2a1b4c/);
    assert.match(out, /api_key=REDACTED/);
  });

  it('masks token / access_token / refresh_token (case-insensitive)', () => {
    assert.match(redactUrl('/x?token=abc'), /token=REDACTED/);
    assert.match(redactUrl('/x?Access_Token=abc'), /Access_Token=REDACTED/i);
    assert.match(redactUrl('/x?refresh_token=abc'), /refresh_token=REDACTED/);
    assert.doesNotMatch(redactUrl('/x?token=supersecret'), /supersecret/);
  });

  it('returns the URL unchanged when there is no query string', () => {
    assert.equal(redactUrl('/api/v1/atlas/123'), '/api/v1/atlas/123');
  });

  it('leaves non-sensitive query strings untouched', () => {
    assert.equal(redactUrl('/a?page=2&size=10'), '/a?page=2&size=10');
  });

  it('handles undefined / empty input without throwing', () => {
    assert.equal(redactUrl(undefined), undefined);
    assert.equal(redactUrl(''), '');
  });

  it('never leaks the secret even for a repeated key', () => {
    const out = redactUrl('/x?api_key=secret1&api_key=secret2');
    assert.doesNotMatch(out, /secret1|secret2/);
  });
});
