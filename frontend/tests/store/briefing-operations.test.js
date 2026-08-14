import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Hoisted shared state (available to vi.mock factories)
// ============================================================================

const h = vi.hoisted(() => {
    return {
        // In-memory briefing store keyed by id.
        briefings: new Map(),
        // Deterministic UUID generator: monotonic counter.
        uuidCounter: 0,
        // Permission gate toggle (mirrors offline-always-allowed behavior).
        permissionAllowed: true,
        permissionReason: 'denied for test'
    };
});

// ============================================================================
// Mock dependencies (paths mirror the import block of briefing.operations.js)
// ============================================================================

// localRepository is the briefing persistence layer (in-memory Map here).
vi.mock('../../src/js/store/repositories/local.repository.js', () => ({
    localRepository: {
        getAllBriefings: vi.fn(async () => {
            const list = [...h.briefings.values()];
            list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
            return list;
        }),
        getBriefing: vi.fn(async (id) => h.briefings.get(id) || null),
        saveBriefing: vi.fn(async (id, data) => {
            h.briefings.set(id, data);
        }),
        deleteBriefing: vi.fn(async (id) => {
            h.briefings.delete(id);
        })
    }
}));

// Deterministic UUIDs so op-shape assertions are exact.
vi.mock('../../src/js/utilities/uuid.js', () => ({
    generateUUID: vi.fn(() => `uuid-${++h.uuidCounter}`)
}));

// Sync module: spy on the two emitters + provide the real enum values.
vi.mock('../../src/js/store/sync/index.js', () => ({
    logBriefingOperation: vi.fn(),
    logOperation: vi.fn(),
    OperationType: { CREATE: 'create', UPDATE: 'update', DELETE: 'delete' },
    EntityType: { BRIEFING: 'briefing', SLIDE: 'slide' }
}));

// Permission guard: drive allow/deny from hoisted state.
vi.mock('../../src/js/store/sync/permission-guard.js', () => ({
    checkPermission: vi.fn(() => (
        h.permissionAllowed
            ? { allowed: true }
            : { allowed: false, reason: h.permissionReason }
    )),
    GuardAction: {
        CREATE_BRIEFING: 'CREATE_BRIEFING',
        UPDATE_BRIEFING: 'UPDATE_BRIEFING',
        DELETE_BRIEFING: 'DELETE_BRIEFING'
    }
}));

// Store error emitter: just a spy.
vi.mock('../../src/js/store/store-errors.js', () => ({
    emitStoreError: vi.fn(),
    StoreErrorEvents: { STORE_OPERATION_BLOCKED: 'store:operationBlocked' }
}));

// Sync metadata: deterministic, real-ish implementations (no Date.now flake
// for the version bump; createdAt/updatedAt are checked structurally).
vi.mock('../../src/js/store/sync/sync-metadata.js', () => ({
    createSyncMetadata: vi.fn(() => ({
        createdAt: 1000,
        updatedAt: 1000,
        version: 1,
        ownerId: null,
        dirty: true,
        deleted: false,
        deletedAt: null
    })),
    touchSyncMetadata: vi.fn((sync) => ({
        ...(sync || { version: 0 }),
        updatedAt: 2000,
        version: (sync ? sync.version : 0) + 1,
        dirty: true
    }))
}));

// deepClone: keep it real (structuredClone-equivalent) so previousData is a
// genuine snapshot decoupled from the live object.
vi.mock('../../src/js/utilities/deep-utils.js', () => ({
    deepClone: vi.fn((obj) => JSON.parse(JSON.stringify(obj)))
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import {
    createEmptySlide,
    createEmptyBriefing,
    createBriefing,
    updateBriefing,
    deleteBriefing,
    generateUniqueBriefingName,
    addSlide,
    updateSlide,
    removeSlide,
    reorderSlides,
    importBriefings,
    getAllBriefings,
    getBriefingById,
    DEFAULT_BRIEFING_SETTINGS,
    SlideMode
} from '../../src/js/store/briefing.operations.js';

import { localRepository } from '../../src/js/store/repositories/local.repository.js';
import { logBriefingOperation, logOperation } from '../../src/js/store/sync/index.js';
import { emitStoreError } from '../../src/js/store/store-errors.js';

// ============================================================================
// Helpers
// ============================================================================

/** Seeds a fully-formed briefing into the in-memory store. */
function seedBriefing(overrides = {}) {
    const id = overrides.id || `seed-${h.uuidCounter++}`;
    const briefing = {
        id,
        name: overrides.name || `Briefing ${id}`,
        description: overrides.description || '',
        slides: overrides.slides || [],
        settings: { ...DEFAULT_BRIEFING_SETTINGS, ...(overrides.settings || {}) },
        sync: overrides.sync || {
            createdAt: 1, updatedAt: 1, version: 1,
            ownerId: null, dirty: true, deleted: false, deletedAt: null
        },
        createdAt: overrides.createdAt ?? 1,
        updatedAt: overrides.updatedAt ?? 1
    };
    h.briefings.set(id, briefing);
    return briefing;
}

function makeSlide(id, order = 0, extra = {}) {
    return {
        id,
        order,
        title: `Slide ${id}`,
        content: '',
        mode: SlideMode.MAP_2D,
        mapId: null,
        sync: { createdAt: 1, updatedAt: 1, version: 1, ownerId: null, dirty: true, deleted: false, deletedAt: null },
        ...extra
    };
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
    vi.clearAllMocks();
    h.briefings.clear();
    h.uuidCounter = 0;
    h.permissionAllowed = true;
});

// ============================================================================
// createEmptySlide / createEmptyBriefing (pure structure)
// ============================================================================

// These field names are half of a CROSS-PACKAGE contract, not a local detail. The
// backend's sync-slide-client-payload.repro.test.js rebuilds this exact payload by hand
// to prove the server accepts what the client really sends; if the names below change,
// that file must change with them or it silently stops proving anything.
//
// The seam is worth naming because it already failed once: this suite asserted camelCase
// with no briefing_id, the backend suite asserted snake_case WITH briefing_id, both were
// green, and slides never reached Postgres for years. Each side pinned itself correctly
// and nothing pinned the contract between them.
describe('createEmptySlide', () => {
    it('returns a fully-shaped slide with the given order and 2D defaults', () => {
        const slide = createEmptySlide(3);

        expect(slide.id).toBe('uuid-1');
        expect(slide.order).toBe(3);
        expect(slide.title).toBe('');
        expect(slide.content).toBe('');
        expect(slide.mode).toBe(SlideMode.MAP_2D);
        expect(slide.mapId).toBeNull();
        expect(slide.modelId).toBeNull();
        expect(slide.photoId).toBeNull();
        expect(slide.temporalCursor).toBeNull();
    });

    it('defaults order to 0 and nests position/orientation with null fields', () => {
        const slide = createEmptySlide();

        expect(slide.order).toBe(0);
        expect(slide.position).toEqual({
            longitude: null, latitude: null, zoom: null, altitude: null
        });
        expect(slide.orientation).toEqual({
            bearing: 0, pitch: 0, heading: null, lon: null, lat: null, fov: null
        });
    });
});

describe('createEmptyBriefing', () => {
    it('returns id, name, description, empty slides, default settings, sync metadata', () => {
        const b = createEmptyBriefing('My Plan', 'desc here');

        expect(b.id).toBe('uuid-1');
        expect(b.name).toBe('My Plan');
        expect(b.description).toBe('desc here');
        expect(b.slides).toEqual([]);
        // Settings is a COPY of the defaults, not the same reference.
        expect(b.settings).toEqual(DEFAULT_BRIEFING_SETTINGS);
        expect(b.settings).not.toBe(DEFAULT_BRIEFING_SETTINGS);
        expect(b.sync).toMatchObject({ version: 1, dirty: true, deleted: false });
        expect(typeof b.createdAt).toBe('number');
        expect(b.updatedAt).toBe(b.createdAt);
    });

    it('defaults description to empty string', () => {
        const b = createEmptyBriefing('NoDesc');
        expect(b.description).toBe('');
    });
});

// ============================================================================
// createBriefing
// ============================================================================

describe('createBriefing', () => {
    it('persists the briefing and emits a CREATE op with the full entity', async () => {
        const result = await createBriefing({ name: 'Operação Alfa', description: 'd' });

        // Persisted under its own id.
        expect(localRepository.saveBriefing).toHaveBeenCalledOnce();
        expect(localRepository.saveBriefing).toHaveBeenCalledWith(result.id, result);
        expect(h.briefings.get(result.id)).toBe(result);

        // Emits CREATE with id + the full briefing entity (no previousData).
        expect(logBriefingOperation).toHaveBeenCalledOnce();
        expect(logBriefingOperation).toHaveBeenCalledWith('create', result.id, result);
        const [, , entity] = logBriefingOperation.mock.calls[0];
        expect(entity).toMatchObject({
            name: 'Operação Alfa',
            description: 'd',
            slides: [],
            settings: DEFAULT_BRIEFING_SETTINGS
        });
        expect(entity.sync).toBeDefined();
    });

    it('uses provided slides and merges custom settings over defaults', async () => {
        const slides = [makeSlide('s1', 0)];
        const result = await createBriefing({
            name: 'B',
            slides,
            settings: { panelWidth: 500 }
        });

        expect(result.slides).toBe(slides);
        expect(result.settings.panelWidth).toBe(500);
        // Untouched defaults survive the merge.
        expect(result.settings.panelPosition).toBe(DEFAULT_BRIEFING_SETTINGS.panelPosition);
    });

    it('blocks (returns null, no persist, no op) when permission denied', async () => {
        h.permissionAllowed = false;

        const result = await createBriefing({ name: 'Blocked' });

        expect(result).toBeNull();
        expect(localRepository.saveBriefing).not.toHaveBeenCalled();
        expect(logBriefingOperation).not.toHaveBeenCalled();
        expect(emitStoreError).toHaveBeenCalledWith(
            'store:operationBlocked',
            expect.objectContaining({ operation: 'createBriefing' })
        );
    });
});

// ============================================================================
// updateBriefing
// ============================================================================

describe('updateBriefing', () => {
    it('merges fields, preserves id/createdAt, bumps sync, emits UPDATE with prev', async () => {
        const existing = seedBriefing({
            id: 'b1', name: 'Old', description: 'olddesc',
            createdAt: 111,
            sync: { createdAt: 1, updatedAt: 1, version: 5, ownerId: null, dirty: false, deleted: false, deletedAt: null }
        });

        const updated = await updateBriefing('b1', { name: 'New' });

        expect(updated.id).toBe('b1');
        expect(updated.name).toBe('New');
        // Untouched field preserved from existing.
        expect(updated.description).toBe('olddesc');
        // createdAt preserved, updatedAt refreshed.
        expect(updated.createdAt).toBe(111);
        expect(updated.updatedAt).not.toBe(existing.updatedAt);
        // Sync version bumped via touchSyncMetadata.
        expect(updated.sync.version).toBe(6);

        // Persisted.
        expect(localRepository.saveBriefing).toHaveBeenCalledWith('b1', updated);

        // Emits UPDATE with updated entity + previous snapshot.
        expect(logBriefingOperation).toHaveBeenCalledWith('update', 'b1', updated, expect.any(Object));
        const prev = logBriefingOperation.mock.calls[0][3];
        expect(prev.name).toBe('Old');
        expect(prev.description).toBe('olddesc');
    });

    it('deep-merges settings (custom over existing) without dropping other keys', async () => {
        seedBriefing({ id: 'b1', settings: { panelWidth: 350, panelPosition: 'left' } });

        const updated = await updateBriefing('b1', { settings: { panelWidth: 999 } });

        expect(updated.settings.panelWidth).toBe(999);
        expect(updated.settings.panelPosition).toBe('left');
    });

    it('keeps existing settings reference when no settings passed', async () => {
        const existing = seedBriefing({ id: 'b1', settings: { panelWidth: 350 } });

        const updated = await updateBriefing('b1', { name: 'x' });

        expect(updated.settings).toEqual(existing.settings);
    });

    it('returns null without persisting when briefing is missing', async () => {
        const result = await updateBriefing('ghost', { name: 'x' });

        expect(result).toBeNull();
        expect(localRepository.saveBriefing).not.toHaveBeenCalled();
        expect(logBriefingOperation).not.toHaveBeenCalled();
    });

    it('blocks (returns null) when permission denied', async () => {
        seedBriefing({ id: 'b1' });
        h.permissionAllowed = false;

        const result = await updateBriefing('b1', { name: 'x' });

        expect(result).toBeNull();
        expect(localRepository.saveBriefing).not.toHaveBeenCalled();
        expect(emitStoreError).toHaveBeenCalledWith(
            'store:operationBlocked',
            expect.objectContaining({ operation: 'updateBriefing' })
        );
    });

    it('cannot override id even if passed in data', async () => {
        seedBriefing({ id: 'b1' });

        const updated = await updateBriefing('b1', { id: 'hacked', name: 'x' });

        expect(updated.id).toBe('b1');
    });
});

// ============================================================================
// deleteBriefing
// ============================================================================

describe('deleteBriefing', () => {
    it('deletes from store and emits DELETE with null current + existing as before', async () => {
        const existing = seedBriefing({ id: 'b1', name: 'ToDelete' });

        const ok = await deleteBriefing('b1');

        expect(ok).toBe(true);
        expect(localRepository.deleteBriefing).toHaveBeenCalledWith('b1');
        expect(h.briefings.has('b1')).toBe(false);

        expect(logBriefingOperation).toHaveBeenCalledWith('delete', 'b1', null, existing);
    });

    it('returns false without deleting/emitting when briefing is missing', async () => {
        const ok = await deleteBriefing('ghost');

        expect(ok).toBe(false);
        expect(localRepository.deleteBriefing).not.toHaveBeenCalled();
        expect(logBriefingOperation).not.toHaveBeenCalled();
    });

    it('blocks (returns false) when permission denied', async () => {
        seedBriefing({ id: 'b1' });
        h.permissionAllowed = false;

        const ok = await deleteBriefing('b1');

        expect(ok).toBe(false);
        expect(localRepository.deleteBriefing).not.toHaveBeenCalled();
        expect(emitStoreError).toHaveBeenCalledWith(
            'store:operationBlocked',
            expect.objectContaining({ operation: 'deleteBriefing' })
        );
    });
});

// ============================================================================
// generateUniqueBriefingName
// ============================================================================

describe('generateUniqueBriefingName', () => {
    it('returns the base name when nothing is taken', async () => {
        const name = await generateUniqueBriefingName('Novo Briefing');
        expect(name).toBe('Novo Briefing');
    });

    it('defaults base name to "Novo Briefing"', async () => {
        const name = await generateUniqueBriefingName();
        expect(name).toBe('Novo Briefing');
    });

    it('suffixes (1) when the base is taken', async () => {
        seedBriefing({ id: 'b1', name: 'Novo Briefing' });

        const name = await generateUniqueBriefingName('Novo Briefing');
        expect(name).toBe('Novo Briefing (1)');
    });

    it('skips already-used suffixes and returns the first free one', async () => {
        seedBriefing({ id: 'b1', name: 'Plano' });
        seedBriefing({ id: 'b2', name: 'Plano (1)' });
        seedBriefing({ id: 'b3', name: 'Plano (2)' });

        const name = await generateUniqueBriefingName('Plano');
        expect(name).toBe('Plano (3)');
    });
});

// ============================================================================
// addSlide
// ============================================================================

describe('addSlide', () => {
    it('appends a slide, sets order to end, persists, emits SLIDE CREATE', async () => {
        seedBriefing({ id: 'b1', slides: [makeSlide('s0', 0)] });

        const slide = await addSlide('b1', { title: 'Intro' });

        // New slide got a generated id and append order. Note: createEmptySlide()
        // burns the first UUID for the spread base, so the slide's own id is the
        // second generated value.
        expect(slide.id).toBe('uuid-2');
        expect(slide.title).toBe('Intro');
        expect(slide.order).toBe(1);
        expect(slide.mode).toBe(SlideMode.MAP_2D);
        expect(slide.sync).toBeDefined();

        // Persisted through updateBriefing (briefing now has 2 slides).
        const stored = h.briefings.get('b1');
        expect(stored.slides).toHaveLength(2);
        expect(stored.slides[1].id).toBe('uuid-2');

        // Emits the slide-level CREATE op (entity, briefing context).
        expect(logOperation).toHaveBeenCalledWith('slide', 'create', slide.id, 'b1', slide);
    });

    it('honors an explicit insert position and reindexes', async () => {
        seedBriefing({
            id: 'b1',
            slides: [makeSlide('s0', 0), makeSlide('s1', 1), makeSlide('s2', 2)]
        });

        const slide = await addSlide('b1', { title: 'Inserted' }, 1);

        const stored = h.briefings.get('b1');
        expect(stored.slides.map(s => s.id)).toEqual(['s0', slide.id, 's1', 's2']);
        // Orders reindexed from the insert point.
        expect(stored.slides.map(s => s.order)).toEqual([0, 1, 2, 3]);
    });

    it('appends (not inserts) when position is out of range', async () => {
        seedBriefing({ id: 'b1', slides: [makeSlide('s0', 0)] });

        const slide = await addSlide('b1', {}, 99);

        const stored = h.briefings.get('b1');
        expect(stored.slides[stored.slides.length - 1].id).toBe(slide.id);
        expect(slide.order).toBe(1);
    });

    it('uses an explicit slide id when provided in slideData', async () => {
        seedBriefing({ id: 'b1' });

        const slide = await addSlide('b1', { id: 'explicit-id' });

        // The explicit id wins for the slide. createEmptySlide() still calls
        // generateUUID once for its base id (discarded), so we assert the final
        // id rather than zero UUID calls.
        expect(slide.id).toBe('explicit-id');
    });

    it('returns null without persisting when the briefing is missing', async () => {
        const result = await addSlide('ghost', { title: 'x' });

        expect(result).toBeNull();
        expect(localRepository.saveBriefing).not.toHaveBeenCalled();
        expect(logOperation).not.toHaveBeenCalled();
    });
});

// ============================================================================
// updateSlide
// ============================================================================

describe('updateSlide', () => {
    it('merges into the target slide and emits SLIDE UPDATE with prev', async () => {
        seedBriefing({
            id: 'b1',
            slides: [makeSlide('s0', 0), makeSlide('s1', 1, { title: 'Old Title' })]
        });

        const result = await updateSlide('b1', 's1', { title: 'New Title' });

        expect(result.id).toBe('s1');
        expect(result.title).toBe('New Title');

        const stored = h.briefings.get('b1');
        expect(stored.slides[1].title).toBe('New Title');
        // Other slide untouched.
        expect(stored.slides[0].title).toBe('Slide s0');

        // Slide-level UPDATE op carries new slide + previous snapshot.
        expect(logOperation).toHaveBeenCalledWith(
            'slide', 'update', 's1', 'b1',
            expect.objectContaining({ title: 'New Title' }),
            expect.objectContaining({ title: 'Old Title' })
        );
    });

    it('bumps the slide sync version via touchSyncMetadata', async () => {
        seedBriefing({
            id: 'b1',
            slides: [makeSlide('s1', 0, {
                sync: { createdAt: 1, updatedAt: 1, version: 7, ownerId: null, dirty: false, deleted: false, deletedAt: null }
            })]
        });

        const result = await updateSlide('b1', 's1', { title: 'x' });

        expect(result.sync.version).toBe(8);
    });

    it('cannot override slide id even if passed in slideData', async () => {
        seedBriefing({ id: 'b1', slides: [makeSlide('s1', 0)] });

        const result = await updateSlide('b1', 's1', { id: 'hacked' });

        expect(result.id).toBe('s1');
    });

    it('returns null when the briefing is missing', async () => {
        const result = await updateSlide('ghost', 's1', { title: 'x' });

        expect(result).toBeNull();
        expect(logOperation).not.toHaveBeenCalled();
    });

    it('returns null when the slide is missing', async () => {
        seedBriefing({ id: 'b1', slides: [makeSlide('s0', 0)] });

        const result = await updateSlide('b1', 'ghost', { title: 'x' });

        expect(result).toBeNull();
        expect(localRepository.saveBriefing).not.toHaveBeenCalled();
        expect(logOperation).not.toHaveBeenCalled();
    });
});

// ============================================================================
// removeSlide
// ============================================================================

describe('removeSlide', () => {
    it('removes the slide, reindexes survivors, emits SLIDE DELETE with removed', async () => {
        seedBriefing({
            id: 'b1',
            slides: [makeSlide('s0', 0), makeSlide('s1', 1), makeSlide('s2', 2)]
        });

        const ok = await removeSlide('b1', 's1');

        expect(ok).toBe(true);

        const stored = h.briefings.get('b1');
        expect(stored.slides.map(s => s.id)).toEqual(['s0', 's2']);
        // Survivors reindexed contiguously.
        expect(stored.slides.map(s => s.order)).toEqual([0, 1]);

        // DELETE op: null current, removed slide as "before".
        expect(logOperation).toHaveBeenCalledWith(
            'slide', 'delete', 's1', 'b1', null,
            expect.objectContaining({ id: 's1' })
        );
    });

    it('returns false when the briefing is missing', async () => {
        const ok = await removeSlide('ghost', 's1');

        expect(ok).toBe(false);
        expect(logOperation).not.toHaveBeenCalled();
    });

    it('returns false when the slide is missing', async () => {
        seedBriefing({ id: 'b1', slides: [makeSlide('s0', 0)] });

        const ok = await removeSlide('b1', 'ghost');

        expect(ok).toBe(false);
        expect(localRepository.saveBriefing).not.toHaveBeenCalled();
        expect(logOperation).not.toHaveBeenCalled();
    });
});

// ============================================================================
// reorderSlides
// ============================================================================

describe('reorderSlides', () => {
    it('reorders slides to match the given id order and reindexes', async () => {
        seedBriefing({
            id: 'b1',
            slides: [makeSlide('a', 0), makeSlide('b', 1), makeSlide('c', 2)]
        });

        const ok = await reorderSlides('b1', ['c', 'a', 'b']);

        expect(ok).toBe(true);
        const stored = h.briefings.get('b1');
        expect(stored.slides.map(s => s.id)).toEqual(['c', 'a', 'b']);
        expect(stored.slides.map(s => s.order)).toEqual([0, 1, 2]);
    });

    it('appends slides omitted from the id list at the end', async () => {
        seedBriefing({
            id: 'b1',
            slides: [makeSlide('a', 0), makeSlide('b', 1), makeSlide('c', 2)]
        });

        // 'b' omitted -> appended after the listed ones.
        const ok = await reorderSlides('b1', ['c', 'a']);

        expect(ok).toBe(true);
        const stored = h.briefings.get('b1');
        expect(stored.slides.map(s => s.id)).toEqual(['c', 'a', 'b']);
        expect(stored.slides.map(s => s.order)).toEqual([0, 1, 2]);
    });

    it('ignores unknown ids in the order list', async () => {
        seedBriefing({ id: 'b1', slides: [makeSlide('a', 0), makeSlide('b', 1)] });

        const ok = await reorderSlides('b1', ['ghost', 'b', 'a']);

        expect(ok).toBe(true);
        const stored = h.briefings.get('b1');
        expect(stored.slides.map(s => s.id)).toEqual(['b', 'a']);
    });

    it('returns false when the briefing is missing', async () => {
        const ok = await reorderSlides('ghost', ['a']);

        expect(ok).toBe(false);
        expect(localRepository.saveBriefing).not.toHaveBeenCalled();
    });
});

// ============================================================================
// importBriefings
// ============================================================================

describe('importBriefings', () => {
    it('imports new briefings and reports the count', async () => {
        const result = await importBriefings([
            { id: 'i1', name: 'One' },
            { id: 'i2', name: 'Two' }
        ]);

        expect(result).toEqual({ imported: 2, skipped: 0 });
        expect(h.briefings.has('i1')).toBe(true);
        expect(h.briefings.has('i2')).toBe(true);
        // updatedAt stamped on save.
        expect(typeof h.briefings.get('i1').updatedAt).toBe('number');
    });

    it('attaches sync metadata when missing on import', async () => {
        await importBriefings([{ id: 'i1', name: 'One' }]);

        expect(h.briefings.get('i1').sync).toBeDefined();
        expect(h.briefings.get('i1').sync.version).toBe(1);
    });

    it('skips entries missing id or name', async () => {
        const result = await importBriefings([
            { name: 'NoId' },
            { id: 'noName' },
            { id: 'ok', name: 'Valid' }
        ]);

        expect(result).toEqual({ imported: 1, skipped: 2 });
        expect(h.briefings.has('ok')).toBe(true);
    });

    it('reassigns id and dedupes name on collision when overwrite=false', async () => {
        seedBriefing({ id: 'dup', name: 'Existing' });

        const result = await importBriefings([{ id: 'dup', name: 'Existing' }]);

        expect(result.imported).toBe(1);
        // Original kept; the import got a fresh id and a deduped name.
        const all = [...h.briefings.values()];
        expect(all).toHaveLength(2);
        const imported = all.find(b => b.id !== 'dup');
        expect(imported.id).not.toBe('dup');
        expect(imported.name).toBe('Existing (1)');
    });

    it('overwrites in place when overwrite=true', async () => {
        seedBriefing({ id: 'dup', name: 'Old' });

        const result = await importBriefings(
            [{ id: 'dup', name: 'Replaced' }],
            { overwrite: true }
        );

        expect(result.imported).toBe(1);
        expect(h.briefings.size).toBe(1);
        expect(h.briefings.get('dup').name).toBe('Replaced');
    });

    it('handles an empty array as a no-op', async () => {
        const result = await importBriefings([]);

        expect(result).toEqual({ imported: 0, skipped: 0 });
        expect(localRepository.saveBriefing).not.toHaveBeenCalled();
    });
});

// ============================================================================
// Atomicity: persistence failure must NOT fire sync logging
// ============================================================================

describe('atomicity (persist rejects → no sync log)', () => {
    it('createBriefing: save rejects, CREATE op never logged', async () => {
        localRepository.saveBriefing.mockRejectedValueOnce(new Error('IndexedDB write failed'));

        await expect(createBriefing({ name: 'X' })).rejects.toThrow('IndexedDB write failed');

        expect(logBriefingOperation).not.toHaveBeenCalled();
    });

    it('updateBriefing: save rejects, UPDATE op never logged', async () => {
        seedBriefing({ id: 'b1' });
        localRepository.saveBriefing.mockRejectedValueOnce(new Error('IndexedDB write failed'));

        await expect(updateBriefing('b1', { name: 'X' })).rejects.toThrow('IndexedDB write failed');

        expect(logBriefingOperation).not.toHaveBeenCalled();
    });

    it('deleteBriefing: delete rejects, DELETE op never logged', async () => {
        seedBriefing({ id: 'b1' });
        localRepository.deleteBriefing.mockRejectedValueOnce(new Error('IndexedDB delete failed'));

        await expect(deleteBriefing('b1')).rejects.toThrow('IndexedDB delete failed');

        expect(logBriefingOperation).not.toHaveBeenCalled();
    });

    it('addSlide: underlying save rejects, SLIDE CREATE op never logged', async () => {
        seedBriefing({ id: 'b1' });
        localRepository.saveBriefing.mockRejectedValueOnce(new Error('IndexedDB write failed'));

        await expect(addSlide('b1', { title: 'x' })).rejects.toThrow('IndexedDB write failed');

        expect(logOperation).not.toHaveBeenCalled();
    });
});

// ============================================================================
// Read passthroughs
// ============================================================================

describe('read passthroughs', () => {
    it('getAllBriefings returns store contents sorted by updatedAt desc', async () => {
        seedBriefing({ id: 'old', updatedAt: 100 });
        seedBriefing({ id: 'new', updatedAt: 900 });

        const all = await getAllBriefings();

        expect(all.map(b => b.id)).toEqual(['new', 'old']);
    });

    it('getBriefingById returns the briefing or null', async () => {
        seedBriefing({ id: 'b1' });

        expect(await getBriefingById('b1')).toMatchObject({ id: 'b1' });
        expect(await getBriefingById('ghost')).toBeNull();
    });
});

// ============================================================================
// Slide ops must honour the briefing write result
// ============================================================================

describe('slide ops when the briefing write is refused', () => {
    beforeEach(() => {
        seedBriefing({ id: 'b1', slides: [makeSlide('s1', 0), makeSlide('s2', 1)] });
        // The gate lives in updateBriefing; the slide ops must observe its refusal.
        h.permissionAllowed = false;
        vi.clearAllMocks();
    });

    it('addSlide returns null, persists nothing and enqueues NO slide op', async () => {
        const result = await addSlide('b1', { title: 'Novo slide' });

        expect(result).toBeNull();
        expect(localRepository.saveBriefing).not.toHaveBeenCalled();
        expect(logOperation).not.toHaveBeenCalled();
    });

    it('updateSlide returns null and enqueues NO slide op', async () => {
        const result = await updateSlide('b1', 's1', { title: 'X' });

        expect(result).toBeNull();
        expect(localRepository.saveBriefing).not.toHaveBeenCalled();
        expect(logOperation).not.toHaveBeenCalled();
    });

    it('removeSlide returns false and enqueues NO slide op', async () => {
        const result = await removeSlide('b1', 's1');

        expect(result).toBe(false);
        expect(localRepository.saveBriefing).not.toHaveBeenCalled();
        expect(logOperation).not.toHaveBeenCalled();
    });

    it('reorderSlides returns false (it used to return true unconditionally)', async () => {
        const result = await reorderSlides('b1', ['s2', 's1']);

        expect(result).toBe(false);
        expect(localRepository.saveBriefing).not.toHaveBeenCalled();
    });

    it('edge: a VANISHED briefing is refused the same way (updateBriefing → null)', async () => {
        // Permission is fine, but the briefing is deleted between the read and the write.
        h.permissionAllowed = true;
        h.briefings.delete('b1');
        // getBriefingById must still resolve, so re-seed under a different id and
        // delete only the one updateBriefing will look for.
        h.briefings.set('b1', { id: 'b1', name: 'b', slides: [makeSlide('s1', 0)], settings: {}, sync: {} });
        localRepository.getBriefing.mockImplementationOnce(async (id) => h.briefings.get(id) || null)
            .mockImplementationOnce(async () => null); // the read INSIDE updateBriefing

        const result = await addSlide('b1', { title: 'Novo slide' });

        expect(result).toBeNull();
        expect(logOperation).not.toHaveBeenCalled();
    });
});
