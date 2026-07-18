// Path: tests/e2e/nomes-busca-anon.e2e.test.js

/**
 * @fileoverview E2E: anonymous gazetteer search (`GET /api/v1/nomes/busca`).
 *
 * The frontend's gazetteer (config.search.apiUrl) must work for the ANONYMOUS
 * path: no `auth` middleware guards `/nomes/busca`. The route returns a FROZEN
 * contract — a bare JSON array (up to 5 results), NOT the `{ data }` envelope.
 *
 * This suite hits the live backend with a plain `fetch` and NO Authorization
 * header to prove the public path round-trips, and adds negative assertions for
 * the Joi query schema (`q` min 3, `lat`/`lon` required).
 */

import { describe, it, expect } from 'vitest';
import { getBaseUrl, E2E_SKIP } from './helpers/harness.js';

describe.skipIf(E2E_SKIP)('e2e: nomes-busca-anon', () => {
    const url = (qs) => `${getBaseUrl()}/api/v1/nomes/busca?${qs}`;

    it('returns HTTP 200 and a bare JSON array with no auth header', async () => {
        const res = await fetch(url('q=rio&lat=-22.9&lon=-43.2'), {
            headers: { Accept: 'application/json' },
        });

        expect(res.status).toBe(200);

        const body = await res.json();
        // Frozen contract: a bare array (NOT a `{ data: [...] }` envelope).
        expect(Array.isArray(body)).toBe(true);
        expect(body).not.toHaveProperty('data');
        // Up to 5 results; may be empty in a freshly migrated DB.
        expect(body.length).toBeLessThanOrEqual(5);
        // Any returned entry must be an object (gazetteer record), never null.
        for (const entry of body) {
            expect(entry).toBeTypeOf('object');
            expect(entry).not.toBeNull();
        }
    });

    it('rejects a too-short query (`q` min 3) with HTTP 422', async () => {
        const res = await fetch(url('q=ri&lat=-22.9&lon=-43.2'), {
            headers: { Accept: 'application/json' },
        });
        // Joi validation at the border fails before the handler runs.
        expect(res.status).toBe(422);
    });

    it('rejects a missing required coordinate (`lon`) with HTTP 422', async () => {
        const res = await fetch(url('q=rio&lat=-22.9'), {
            headers: { Accept: 'application/json' },
        });
        expect(res.status).toBe(422);
    });
});
