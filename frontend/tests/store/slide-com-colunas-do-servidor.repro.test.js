// Path: tests/store/slide-com-colunas-do-servidor.repro.test.js

/**
 * REPRO: a slide that came back from the server carries the server's column names next to the
 * client's (`base_layer` and `baseLayer`, `temporal_enabled` and `temporalEnabled`, `map_id` and
 * `mapId`, ...), because both the canonical receipt and the snapshot spread every row column
 * before adding the camelCase aliases. The next edit of that slide logged the whole slide, so the
 * op carried the NEW value under the camelCase key and the STALE value under the snake_case key,
 * and `normalizeSlidePayload` (backend `sync.service.js`) let the server dialect win whenever
 * both were present (it prefers the client's since 2026-09-26). Result: after the first acknowledgement, or after any F5, changing a slide's
 * base layer, timeline switch, instant, map, 3D model or 360 photo stayed on the author's screen
 * and never reached the server, the colleague or the author's own next F5
 * (`frontend/tests/e2e-ui/briefing-vista-do-slide-cobertura.spec.js`).
 *
 * The rule now: a slide op never carries a server column that has a client twin, and the local
 * document stops carrying them at the next write.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ briefings: new Map(), intents: [] }));

vi.mock('../../src/js/store/repositories/local.repository.js', () => ({
    localRepository: {
        forScope() { return this; },
        getAllBriefings: vi.fn(async () => [...h.briefings.values()]),
        getBriefing: vi.fn(async (id) => h.briefings.get(id) || null),
        saveBriefing: vi.fn(async (id, data) => { h.briefings.set(id, data); }),
        deleteBriefing: vi.fn(async (id) => { h.briefings.delete(id); }),
    },
}));

vi.mock('../../src/js/store/sync/operation-dispatcher.js', () => ({
    persistOperationIntents: vi.fn(async (descriptions) => {
        h.intents.push(...descriptions);
        return async () => {};
    }),
}));

vi.mock('../../src/js/store/sync/permission-guard.js', () => ({
    checkPermission: vi.fn(() => ({ allowed: true })),
    GuardAction: {
        CREATE_BRIEFING: 'CREATE_BRIEFING',
        UPDATE_BRIEFING: 'UPDATE_BRIEFING',
        DELETE_BRIEFING: 'DELETE_BRIEFING',
    },
}));

vi.mock('../../src/js/store/store-errors.js', () => ({
    emitStoreError: vi.fn(),
    StoreErrorEvents: { STORE_OPERATION_BLOCKED: 'store:operationBlocked' },
}));

import { applyBriefingEdits, updateSlide } from '../../src/js/store/briefing.operations.js';
import { SERVER_SLIDE_ALIASES } from '../../src/js/store/sync/slide-shape.js';

const BRIEFING = '11111111-1111-4111-8111-111111111111';
const SLIDE = '22222222-2222-4222-8222-222222222222';
const MAPA_UUID = '33333333-3333-4333-8333-333333333333';

/** The slide as the canonical receipt and the snapshot leave it: row columns plus aliases. */
function slideDoServidor() {
    return {
        id: SLIDE,
        briefing_id: BRIEFING,
        title: 'Base',
        content: '',
        mode: '2d',
        map_id: MAPA_UUID,
        model_id: null,
        photo_id: null,
        position: { center: [-43, -22], zoom: 10, bearing: 0, pitch: 0 },
        orientation: null,
        temporal_cursor: 1790000000000,
        base_layer: 'carta-topografica',
        temporal_enabled: true,
        controls: {},
        is_broken: false,
        broken_reason: null,
        version: 3,
        mapId: 'Mapa Tatico',
        modelId: null,
        photoId: null,
        temporalCursor: 1790000000000,
        baseLayer: 'carta-topografica',
        temporalEnabled: true,
        order: 0,
        sync: { createdAt: 1, updatedAt: 1, version: 3, ownerId: null, dirty: false, deleted: false, deletedAt: null },
    };
}

function semear() {
    h.briefings.set(BRIEFING, {
        id: BRIEFING,
        name: 'Vista',
        description: '',
        slides: [slideDoServidor()],
        settings: {},
        sync: { createdAt: 1, updatedAt: 1, version: 2, ownerId: null, dirty: false, deleted: false, deletedAt: null },
        createdAt: 1,
        updatedAt: 1,
    });
}

const opDoSlide = () => h.intents.find((op) => op.entityType === 'slide');

beforeEach(() => {
    h.briefings.clear();
    h.intents.length = 0;
    semear();
});

describe('a slide op never carries a stale server column next to the client field', () => {
    it('the editor path (applyBriefingEdits): base and timeline switch reach the payload alone', async () => {
        await applyBriefingEdits(BRIEFING, { slides: { [SLIDE]: { baseLayer: 'carta-ortoimagem', temporalEnabled: false } } });

        const op = opDoSlide();
        expect(op, 'the edit is logged as a slide op').toBeTruthy();
        expect(op.data.baseLayer).toBe('carta-ortoimagem');
        expect(op.data.temporalEnabled).toBe(false);
        for (const key of SERVER_SLIDE_ALIASES) {
            expect(Object.hasOwn(op.data, key), `payload carries no "${key}"`).toBe(false);
            expect(Object.hasOwn(op.previousData ?? {}, key), `previousData carries no "${key}"`).toBe(false);
        }
        // The client fields that have no server twin travel untouched.
        expect(op.data).toMatchObject({ title: 'Base', mapId: 'Mapa Tatico', temporalCursor: 1790000000000 });
    });

    it('the stored briefing sheds the server columns at the same write', async () => {
        await applyBriefingEdits(BRIEFING, { slides: { [SLIDE]: { baseLayer: 'carta-ortoimagem' } } });
        const stored = h.briefings.get(BRIEFING).slides[0];
        for (const key of SERVER_SLIDE_ALIASES) expect(Object.hasOwn(stored, key), `stored slide carries no "${key}"`).toBe(false);
        expect(stored.baseLayer).toBe('carta-ortoimagem');
    });

    it('the envelope of the briefing carries the same clean slides', async () => {
        await applyBriefingEdits(BRIEFING, { slides: { [SLIDE]: { temporalCursor: 1791000000000 } } });
        const envelope = h.intents.find((op) => op.entityType === 'briefing');
        expect(envelope.data.slides).toHaveLength(1);
        for (const key of SERVER_SLIDE_ALIASES) expect(Object.hasOwn(envelope.data.slides[0], key)).toBe(false);
        expect(envelope.data.slides[0].temporalCursor).toBe(1791000000000);
    });

    it('updateSlide (the other editor door) follows the same rule', async () => {
        await updateSlide(BRIEFING, SLIDE, { mapId: 'Outro mapa' });
        const op = opDoSlide();
        expect(op.data.mapId).toBe('Outro mapa');
        expect(Object.hasOwn(op.data, 'map_id'), 'a stale map_id would pin the old map on the server').toBe(false);
    });

    it('EDGE: shedding the server columns alone is not an edit (no slide op, no churn)', async () => {
        await applyBriefingEdits(BRIEFING, { fields: { name: 'Outro nome' } });
        expect(h.intents.filter((op) => op.entityType === 'slide'), 'renaming the briefing logs no slide op').toEqual([]);
    });
});
