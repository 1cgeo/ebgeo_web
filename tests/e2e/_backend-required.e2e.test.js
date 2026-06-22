// Path: tests/e2e/_backend-required.e2e.test.js

/**
 * @fileoverview Anti-"green-but-skipped" guard for the real-backend e2e layer.
 *
 * Every other spec is `describe.skipIf(E2E_SKIP)`, so if Postgres / the backend does NOT come up,
 * they all SKIP and `npm run test:e2e` reports GREEN having tested nothing. This guard is NOT gated:
 * it FAILS when the backend was unavailable, so a passing run provably means the suite actually ran.
 *
 * Opt out only when you genuinely have no backend (e.g. a CI lane without Postgres):
 *   EBGEO_E2E_ALLOW_SKIP=1 npm run test:e2e
 */

import { describe, it, expect } from 'vitest';
import { E2E_SKIP } from './helpers/harness.js';

describe('E2E backend prerequisite', () => {
    it('the real backend came up — the e2e suite did not silently skip', () => {
        if (process.env.EBGEO_E2E_ALLOW_SKIP === '1') return; // explicit, deliberate opt-out
        expect(
            E2E_SKIP,
            'Backend/Postgres unavailable — every e2e suite SKIPPED, so a "green" run tested NOTHING. '
            + 'Start Postgres (e.g. DB_USER=postgres DB_PASSWORD=postgres npm run test:e2e) '
            + 'or set EBGEO_E2E_ALLOW_SKIP=1 to opt out deliberately.',
        ).toBe(false);
    });
});
