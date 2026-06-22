// Path: e2e-ui/_backend-required.spec.js

/**
 * @fileoverview Anti-"green-but-skipped" guard for the browser-e2e (Playwright) layer.
 *
 * Every browser-* spec is `describe.skipIf(state.skip)`, so if the backend can't come up the whole
 * suite SKIPS and `npm run test:e2e:ui` reports GREEN having driven nothing. This guard is NOT gated:
 * it FAILS when the backend was unavailable, so a passing run provably means the browser suite ran.
 *
 * Opt out only when you genuinely have no backend:  EBGEO_E2E_ALLOW_SKIP=1 npm run test:e2e:ui
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

test('the real backend came up — the browser-e2e suite did not silently skip', () => {
    if (process.env.EBGEO_E2E_ALLOW_SKIP === '1') return; // explicit, deliberate opt-out
    const state = readState();
    expect(
        state.skip,
        `Backend/Postgres unavailable — every browser-e2e spec SKIPPED${state.reason ? ` (${state.reason})` : ''}, `
        + 'so a "green" run drove NOTHING. Start Postgres (DB_USER=postgres DB_PASSWORD=postgres) '
        + 'or set EBGEO_E2E_ALLOW_SKIP=1 to opt out deliberately.',
    ).toBeFalsy();
});
