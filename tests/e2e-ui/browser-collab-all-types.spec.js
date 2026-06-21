// Path: e2e-ui/browser-collab-all-types.spec.js

/**
 * EVERY FEATURE TYPE syncs cross-client — TWO real browsers + real backend. Client A
 * creates ONE feature of EACH of the 18 backend-valid types (ALL_FEATURE_SOURCES),
 * each via the app's OWN store op (addFeature on the real store facade), and client B
 * asserts NATIVE sync carried every one of them through — no workarounds.
 *
 * The gotcha this spec pins down is the STORAGE-TYPE vs SOURCE split:
 *   - realFeature(source) builds a feature keyed by its SOURCE (singular, e.g. 'point',
 *     'military_symbol', 'processed_los');
 *   - addFeature(storageType, feature) wants the STORAGE bucket (plural, e.g. 'points',
 *     'military_symbols') — the same key under which getCurrentMapFeatures() returns it.
 * The store's own getStorageTypeFromSource() is the source of truth for that map. The two
 * analysis-result types ('processed_los'/'processed_visibility') are NOT in the store's
 * source→storage table (their bucket name IS the source), so they are special-cased to
 * match the real store buckets (see repository.utils.js / local.repository.js).
 *
 * Flow (kept under the 60s Playwright timeout): seed + open A and B, then BATCH all 18
 * creates on A first, and only THEN poll B for each (short per-poll timeout once every
 * op has been pushed — so we don't pay 18 sequential long polls). Any source the app
 * refuses (addFeature returns nothing / never lands in B's store) is collected and the
 * test fails at the end listing exactly which of the 18 did not sync.
 *
 * The seed/login/open plumbing and poll helpers come from ./helpers/collab-helpers.js;
 * structure mirrors browser-collab-shared-atlas.spec.js.
 *
 * Run headed:  npx playwright test browser-collab-all-types --headed
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, openClient, pollPeerFeature, readFeatures } from './helpers/collab-helpers.js';
import { realFeature, ALL_FEATURE_SOURCES } from '../helpers/real-fixtures.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/**
 * Source → storage-bucket map, matching the real store (FEATURE_TYPE_MAPPINGS via
 * getStorageTypeFromSource in src/js/store/store.constants.js). The analysis-result
 * types are NOT in that table — their store bucket equals the source itself
 * (repository.utils.js / local.repository.js seed `processed_los`/`processed_visibility`
 * buckets verbatim), so the store fallback (`+ 's'`) would point at the wrong bucket.
 */
const SOURCE_TO_STORAGE = Object.freeze({
    point: 'points',
    line: 'lines',
    polygon: 'polygons',
    text: 'texts',
    image: 'images',
    circle: 'circles',
    rectangle: 'rectangles',
    ellipse: 'ellipses',
    brush: 'brushes',
    arrow: 'arrows',
    boundary: 'boundarys',
    occupied_front: 'occupied_fronts',
    military_symbol: 'military_symbols',
    coordination_measure: 'coordination_measures',
    los: 'los',
    visibility: 'visibility',
    processed_los: 'processed_los',
    processed_visibility: 'processed_visibility',
});

/** Resolves a source to its store bucket. */
function sourceToStorage(source) {
    const storage = SOURCE_TO_STORAGE[source];
    if (!storage) throw new Error(`No storage bucket mapped for source "${source}"`);
    return storage;
}

describeOrSkip('All 18 feature types sync cross-client (two real browsers, real store ops)', () => {
    test('A creates one feature of every type via addFeature → B receives every one', async ({ browser }) => {
        // Assert against the store's OWN source→storage map so this spec can never drift
        // from the app silently: for every non-processed source, our table must agree with
        // getStorageTypeFromSource(); the processed_* pair is intentionally hard-mapped.
        const seedPage = await browser.newPage();
        await seedPage.goto('/');
        const storeMap = await seedPage.evaluate(async (sources) => {
            const store = await import('/src/js/store/index.js');
            return Object.fromEntries(sources.map((s) => [s, store.getStorageTypeFromSource(s)]));
        }, [...ALL_FEATURE_SOURCES]);
        await seedPage.close();
        for (const source of ALL_FEATURE_SOURCES) {
            if (source === 'processed_los' || source === 'processed_visibility') continue;
            expect(storeMap[source], `store getStorageTypeFromSource('${source}')`).toBe(sourceToStorage(source));
        }

        const seed = await seedSharedAtlas(browser, state.baseUrl);
        const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
        const B = await openClient(browser, state.baseUrl, seed.atlasId, seed.userB);

        try {
            // BATCH: A creates one feature of each type, recording (source, storage, id).
            // addFeature is retried a few times: under full-suite load A's write guard can
            // momentarily block (a transient online/permission re-check), and the op simply
            // needs to be re-issued — it is NOT a "type refused" condition. We only mark a
            // type as refused if it never lands after several attempts.
            const created = [];
            for (const source of ALL_FEATURE_SOURCES) {
                const id = crypto.randomUUID();
                const f = realFeature(source, { id });
                const storage = sourceToStorage(source);
                let landedOnA = false;
                for (let attempt = 0; attempt < 5 && !landedOnA; attempt++) {
                    if (attempt > 0) await A.waitForTimeout(500);
                    landedOnA = await A.evaluate(async ({ s, feat }) => {
                        const store = await import('/src/js/store/index.js');
                        const out = await store.addFeature(s, feat);
                        // Confirm it actually entered A's own bucket (not just "returned something").
                        const all = await store.getCurrentMapFeatures();
                        const inBucket = (all[s] || []).some((x) => x.properties?.id === feat.properties.id);
                        return !!out && inBucket;
                    }, { s: storage, feat: f });
                }
                created.push({ source, storage, id, landedOnA });
            }

            // Any source the app refused to even store locally on A is already a failure;
            // record it as "missing" so the final assertion lists it.
            const missing = [];
            for (const item of created) {
                if (!item.landedOnA) {
                    missing.push(`${item.source} (refused by addFeature on A)`);
                    continue;
                }
                try {
                    // Short per-poll timeout: every op was pushed before we started polling,
                    // so native sync has been in flight for all of them already.
                    await pollPeerFeature(B, item.storage, item.id, 15000);
                } catch {
                    missing.push(`${item.source} → ${item.storage} (not received by B)`);
                }
            }

            expect(created).toHaveLength(18);
            expect(
                missing,
                `These feature types did NOT sync to peer B: ${missing.join(', ') || 'none'}`,
            ).toEqual([]);

            // Sanity: B really holds 18 distinct features across the expected buckets.
            const totalOnB = [];
            for (const item of created) {
                const onB = await readFeatures(B, item.storage);
                if (onB.some((x) => x.id === item.id)) totalOnB.push(item.id);
            }
            expect(totalOnB).toHaveLength(18);
        } finally {
            await A.context().close();
            await B.context().close();
        }
    });
});
