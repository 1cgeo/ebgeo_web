// Path: tests/unit/briefing-slides-ordem-e-nomes.test.js

/**
 * @fileoverview Pins `store/briefing.operations.js` against an in-memory
 * repository, a permissive guard and a spy op-log.
 *
 * What this suite HOLDS:
 * - `createEmptySlide`: the slide SHAPE, including that a 3D slide references a
 *   model by `modelId` and there is no `tilesetId` field anywhere on it;
 * - `createEmptyBriefing`: the settings COPY (mutating the result must not
 *   poison `DEFAULT_BRIEFING_SETTINGS` for every briefing created afterwards);
 * - `generateUniqueBriefingName`: first-free scan starting at `(1)`, not max+1;
 * - `addSlide`: the three insert branches (append by default, append when
 *   `position === slides.length`, splice inside the list) and the reindex that
 *   only ONE of them performs;
 * - `reorderSlides`: multiset preservation, dense `order` 0..n-1, ids missing
 *   from the request appended at the end, a duplicate id consumed exactly once;
 * - the permission gate: when `updateBriefing` is denied, `addSlide`/
 *   `removeSlide`/`reorderSlides` must report failure AND must NOT log a sync
 *   operation (a refused op freezes the whole push queue);
 * - `importBriefings`: the skip rules and the re-identify path.
 *
 * What it does NOT reach: the real IndexedDB repository, the real permission
 * guard (held by `tests/unit/permission-guard.test.js`) and the sync envelope
 * itself; the op log here is a spy, so this suite checks WHETHER an op is
 * logged, never what the server does with it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

const repo = {
    getAllBriefings: vi.fn(),
    getBriefing: vi.fn(),
    saveBriefing: vi.fn(),
    deleteBriefing: vi.fn(),
};

const guard = { allowed: true, reason: null, required: null };

const logBriefingOperation = vi.fn();
const logOperation = vi.fn();
const emitStoreError = vi.fn();

vi.mock('../../src/js/store/repositories/local.repository.js', () => ({
    localRepository: repo,
}));

vi.mock('../../src/js/store/sync/index.js', () => ({
    logBriefingOperation: (...args) => logBriefingOperation(...args),
    logOperation: (...args) => logOperation(...args),
    EntityType: { SLIDE: 'slide', BRIEFING: 'briefing' },
    OperationType: { CREATE: 'create', UPDATE: 'update', DELETE: 'delete' },
}));

vi.mock('../../src/js/store/sync/permission-guard.js', () => ({
    checkPermission: () => ({ ...guard }),
    GuardAction: {
        CREATE_BRIEFING: 'create_briefing',
        UPDATE_BRIEFING: 'update_briefing',
        DELETE_BRIEFING: 'delete_briefing',
    },
}));

vi.mock('../../src/js/store/store-errors.js', () => ({
    emitStoreError: (...args) => emitStoreError(...args),
    StoreErrorEvents: { STORE_OPERATION_BLOCKED: 'store:operation-blocked' },
}));

const ops = await import('../../src/js/store/briefing.operations.js');

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** In-memory briefing store wired into the repository mock. */
let db;

/** Installs a briefing with slides carrying the given ids, order 0..n-1. */
function seed(id, slideIds) {
    const briefing = {
        id,
        name: 'B',
        description: '',
        slides: slideIds.map((sid, i) => ({ id: sid, order: i, title: `S${i}` })),
        settings: { ...ops.DEFAULT_BRIEFING_SETTINGS },
        sync: { version: 1 },
        createdAt: 1,
        updatedAt: 1,
    };
    db.set(id, briefing);
    return briefing;
}

beforeEach(() => {
    vi.clearAllMocks();
    guard.allowed = true;
    db = new Map();

    repo.getBriefing.mockImplementation(async (id) => db.get(id) ?? null);
    repo.getAllBriefings.mockImplementation(async () => [...db.values()]);
    repo.saveBriefing.mockImplementation(async (id, data) => { db.set(id, data); });
    repo.deleteBriefing.mockImplementation(async (id) => { db.delete(id); });
});

// ============================================================================
// createEmptySlide / createEmptyBriefing
// ============================================================================

describe('createEmptySlide', () => {
    it('carries a fresh UUID and the requested order', () => {
        const slide = ops.createEmptySlide(4);
        expect(slide.id).toMatch(UUID_V4);
        expect(slide.order).toBe(4);
    });

    it('defaults the order to 0, and 0 is a legitimate order', () => {
        expect(ops.createEmptySlide().order).toBe(0);
        expect(ops.createEmptySlide(0).order).toBe(0);
    });

    it('starts in 2D mode with a fully null position and no references', () => {
        const slide = ops.createEmptySlide();
        expect(slide.mode).toBe(ops.SlideMode.MAP_2D);
        expect(slide.mapId).toBeNull();
        expect(slide.position).toEqual({
            longitude: null, latitude: null, zoom: null, altitude: null,
        });
        expect(slide.orientation).toEqual({
            bearing: 0, pitch: 0, heading: null, lon: null, lat: null, fov: null,
        });
        expect(slide.temporalCursor).toBeNull();
    });

    it('references a 3D model by `modelId` and has NO `tilesetId` field', () => {
        const slide = ops.createEmptySlide();
        expect('modelId' in slide).toBe(true);
        expect(slide.modelId).toBeNull();
        expect('tilesetId' in slide).toBe(false);
        expect(Object.keys(slide)).not.toContain('tilesetId');
    });

    it('two slides never share an id, and never share the nested objects', () => {
        const a = ops.createEmptySlide();
        const b = ops.createEmptySlide();
        expect(a.id).not.toBe(b.id);
        expect(a.position).not.toBe(b.position);
        a.position.longitude = 10;
        expect(b.position.longitude).toBeNull();
    });

    it('declares exactly three slide modes', () => {
        expect(Object.values(ops.SlideMode).sort()).toEqual(['2d', '360', '3d'].sort());
        expect(Object.isFrozen(ops.SlideMode)).toBe(true);
    });
});

describe('createEmptyBriefing', () => {
    it('stamps createdAt and updatedAt to the same instant', () => {
        const b = ops.createEmptyBriefing('N');
        expect(b.createdAt).toBe(b.updatedAt);
    });

    it('starts with no slides and a fresh id', () => {
        const b = ops.createEmptyBriefing('N');
        expect(b.slides).toEqual([]);
        expect(b.id).toMatch(UUID_V4);
        expect(b.name).toBe('N');
        expect(b.description).toBe('');
    });

    it('COPIES the default settings, so a mutation cannot leak into the next briefing', () => {
        const first = ops.createEmptyBriefing('A');
        expect(first.settings).toEqual(ops.DEFAULT_BRIEFING_SETTINGS);
        expect(first.settings).not.toBe(ops.DEFAULT_BRIEFING_SETTINGS);

        first.settings.panelWidth = 9999;
        expect(ops.DEFAULT_BRIEFING_SETTINGS.panelWidth).toBe(350);
        expect(ops.createEmptyBriefing('B').settings.panelWidth).toBe(350);
    });

    it('keeps an explicit empty description rather than inventing one', () => {
        expect(ops.createEmptyBriefing('N', '').description).toBe('');
        expect(ops.createEmptyBriefing('N', 'texto').description).toBe('texto');
    });
});

// ============================================================================
// generateUniqueBriefingName
// ============================================================================

describe('generateUniqueBriefingName', () => {
    it('returns the base name when nothing collides', async () => {
        expect(await ops.generateUniqueBriefingName('X')).toBe('X');
    });

    it('defaults the base name to "Novo Briefing"', async () => {
        expect(await ops.generateUniqueBriefingName()).toBe('Novo Briefing');
    });

    it('starts the counter at (1), not at (2)', async () => {
        seed('b1', []); db.get('b1').name = 'X';
        expect(await ops.generateUniqueBriefingName('X')).toBe('X (1)');
    });

    it('OBSERVADO: scans for the FIRST free slot, not max + 1', async () => {
        seed('b1', []); db.get('b1').name = 'X';
        seed('b2', []); db.get('b2').name = 'X (2)';
        expect(await ops.generateUniqueBriefingName('X')).toBe('X (1)');
    });

    it('walks past a dense run', async () => {
        ['X', 'X (1)', 'X (2)'].forEach((name, i) => {
            seed(`b${i}`, []); db.get(`b${i}`).name = name;
        });
        expect(await ops.generateUniqueBriefingName('X')).toBe('X (3)');
    });

    it('the naming scheme differs from the layer/map one (parentheses, not #)', async () => {
        seed('b1', []); db.get('b1').name = 'X';
        const out = await ops.generateUniqueBriefingName('X');
        expect(out).toContain('(');
        expect(out).not.toContain('#');
    });
});

// ============================================================================
// addSlide
// ============================================================================

describe('addSlide — where the slide lands', () => {
    it('appends when no position is given, with order === previous length', async () => {
        seed('b', ['s0', 's1']);
        const slide = await ops.addSlide('b', {});
        expect(slide.order).toBe(2);
        expect(db.get('b').slides.map(s => s.id)).toEqual(['s0', 's1', slide.id]);
    });

    it('appends into an EMPTY briefing with order 0', async () => {
        seed('b', []);
        const slide = await ops.addSlide('b', {});
        expect(slide.order).toBe(0);
        expect(db.get('b').slides).toHaveLength(1);
    });

    it('OBSERVADO: position === slides.length APPENDS (it is not an off-by-one splice)', async () => {
        // The branch guard is `position < slides.length`, so the boundary value
        // falls through to the append arm and lands at the end, which is what a
        // drop after the last card should do.
        seed('b', ['s0', 's1']);
        const slide = await ops.addSlide('b', {}, 2);
        expect(db.get('b').slides.map(s => s.id)).toEqual(['s0', 's1', slide.id]);
        expect(slide.order).toBe(2);
    });

    it('splices at position 0 and reindexes everything after it', async () => {
        seed('b', ['s0', 's1']);
        const slide = await ops.addSlide('b', {}, 0);
        const slides = db.get('b').slides;
        expect(slides.map(s => s.id)).toEqual([slide.id, 's0', 's1']);
        expect(slides.map(s => s.order)).toEqual([0, 1, 2]);
    });

    it('splices in the middle', async () => {
        seed('b', ['s0', 's1', 's2']);
        const slide = await ops.addSlide('b', {}, 1);
        expect(db.get('b').slides.map(s => s.id)).toEqual(['s0', slide.id, 's1', 's2']);
        expect(db.get('b').slides.map(s => s.order)).toEqual([0, 1, 2, 3]);
    });

    it('a NEGATIVE position falls through to append', async () => {
        seed('b', ['s0']);
        const slide = await ops.addSlide('b', {}, -1);
        expect(db.get('b').slides.map(s => s.id)).toEqual(['s0', slide.id]);
    });

    it('a position PAST the end falls through to append', async () => {
        seed('b', ['s0']);
        const slide = await ops.addSlide('b', {}, 99);
        expect(db.get('b').slides.map(s => s.id)).toEqual(['s0', slide.id]);
        expect(slide.order).toBe(1);
    });

    it('OBSERVADO: the APPEND arm does not reindex, so pre-existing order gaps survive', async () => {
        // Only the splice arm calls reindexSlides. Appending trusts the length
        // as the next order, which is wrong whenever the stored orders drifted.
        seed('b', ['s0', 's1']);
        db.get('b').slides[0].order = 5;
        db.get('b').slides[1].order = 6;

        const slide = await ops.addSlide('b', {});
        expect(db.get('b').slides.map(s => s.order)).toEqual([5, 6, 2]);
        expect(slide.order).toBe(2);
    });

    it('CONTROLE: the SPLICE arm does repair the same drifted orders from the insert point on', async () => {
        seed('b', ['s0', 's1']);
        db.get('b').slides[0].order = 5;
        db.get('b').slides[1].order = 6;

        await ops.addSlide('b', {}, 1);
        expect(db.get('b').slides.map(s => s.order)).toEqual([5, 1, 2]);
    });
});

describe('addSlide — identity, payload and failure', () => {
    it('honours an explicit slide id', async () => {
        seed('b', []);
        const slide = await ops.addSlide('b', { id: 'meu-id', title: 'T' });
        expect(slide.id).toBe('meu-id');
        expect(slide.title).toBe('T');
    });

    it('replaces a FALSY explicit id with a fresh UUID', async () => {
        seed('b', []);
        expect((await ops.addSlide('b', { id: '' })).id).toMatch(UUID_V4);
        expect((await ops.addSlide('b', { id: null })).id).toMatch(UUID_V4);
    });

    it('lets slideData override the empty-slide defaults, including mode and modelId', async () => {
        seed('b', []);
        const slide = await ops.addSlide('b', { mode: '3d', modelId: 'm1' });
        expect(slide.mode).toBe('3d');
        expect(slide.modelId).toBe('m1');
    });

    it('attaches sync metadata to the new slide', async () => {
        seed('b', []);
        const slide = await ops.addSlide('b', {});
        expect(slide.sync).toBeTruthy();
        expect(typeof slide.sync).toBe('object');
    });

    it('returns null and writes nothing when the briefing does not exist', async () => {
        const slide = await ops.addSlide('nao-existe', {});
        expect(slide).toBeNull();
        expect(repo.saveBriefing).not.toHaveBeenCalled();
        expect(logOperation).not.toHaveBeenCalled();
    });

    it('logs exactly one SLIDE create on success', async () => {
        seed('b', []);
        const slide = await ops.addSlide('b', {});
        expect(logOperation).toHaveBeenCalledTimes(1);
        expect(logOperation).toHaveBeenCalledWith('slide', 'create', slide.id, 'b', slide);
    });

    it('when the guard denies, it returns null and logs NO slide op', async () => {
        seed('b', []);
        guard.allowed = false;
        guard.reason = 'somente leitura';

        expect(await ops.addSlide('b', {})).toBeNull();
        expect(logOperation).not.toHaveBeenCalled();
        expect(emitStoreError).toHaveBeenCalledTimes(1);
        expect(emitStoreError.mock.calls[0][0]).toBe('store:operation-blocked');
    });
});

// ============================================================================
// reorderSlides
// ============================================================================

describe('reorderSlides', () => {
    it('applies the requested order and renumbers 0..n-1', async () => {
        seed('b', ['a', 'b2', 'c']);
        expect(await ops.reorderSlides('b', ['c', 'a', 'b2'])).toBe(true);
        const slides = db.get('b').slides;
        expect(slides.map(s => s.id)).toEqual(['c', 'a', 'b2']);
        expect(slides.map(s => s.order)).toEqual([0, 1, 2]);
    });

    it('appends the slides omitted from the request, keeping their relative order', async () => {
        seed('b', ['a', 'b2', 'c']);
        expect(await ops.reorderSlides('b', ['c'])).toBe(true);
        expect(db.get('b').slides.map(s => s.id)).toEqual(['c', 'a', 'b2']);
        expect(db.get('b').slides.map(s => s.order)).toEqual([0, 1, 2]);
    });

    it('consumes a DUPLICATE id exactly once', async () => {
        seed('b', ['a', 'b2']);
        expect(await ops.reorderSlides('b', ['a', 'a', 'b2'])).toBe(true);
        expect(db.get('b').slides.map(s => s.id)).toEqual(['a', 'b2']);
    });

    it('ignores an id that belongs to no slide', async () => {
        seed('b', ['a', 'b2']);
        expect(await ops.reorderSlides('b', ['fantasma', 'b2', 'a'])).toBe(true);
        expect(db.get('b').slides.map(s => s.id)).toEqual(['b2', 'a']);
    });

    it('an EMPTY id list keeps every slide, in the original order', async () => {
        seed('b', ['a', 'b2']);
        expect(await ops.reorderSlides('b', [])).toBe(true);
        expect(db.get('b').slides.map(s => s.id)).toEqual(['a', 'b2']);
    });

    it('returns false for a briefing that does not exist', async () => {
        expect(await ops.reorderSlides('nao-existe', [])).toBe(false);
        expect(repo.saveBriefing).not.toHaveBeenCalled();
    });

    it('returns false when the guard denies the write', async () => {
        seed('b', ['a']);
        guard.allowed = false;
        expect(await ops.reorderSlides('b', ['a'])).toBe(false);
    });

    it('any permutation preserves the slide multiset and yields dense orders', async () => {
        await fc.assert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 7 }).chain(n =>
                    fc.shuffledSubarray(
                        Array.from({ length: n }, (_, i) => `s${i}`),
                        { minLength: n, maxLength: n }
                    ).map(order => ({ n, order }))
                ),
                async ({ n, order }) => {
                    db = new Map();
                    seed('b', Array.from({ length: n }, (_, i) => `s${i}`));
                    await ops.reorderSlides('b', order);
                    const slides = db.get('b').slides;
                    expect(slides).toHaveLength(n);
                    expect([...slides.map(s => s.id)].sort())
                        .toEqual(Array.from({ length: n }, (_, i) => `s${i}`).sort());
                    expect(slides.map(s => s.order))
                        .toEqual(Array.from({ length: n }, (_, i) => i));
                }
            ),
            { numRuns: 120 }
        );
    });
});

// ============================================================================
// removeSlide / updateSlide
// ============================================================================

describe('removeSlide', () => {
    it('removes the slide and renumbers the survivors', async () => {
        seed('b', ['a', 'b2', 'c']);
        expect(await ops.removeSlide('b', 'b2')).toBe(true);
        expect(db.get('b').slides.map(s => s.id)).toEqual(['a', 'c']);
        expect(db.get('b').slides.map(s => s.order)).toEqual([0, 1]);
    });

    it('returns false for an unknown slide and writes nothing', async () => {
        seed('b', ['a']);
        expect(await ops.removeSlide('b', 'fantasma')).toBe(false);
        expect(repo.saveBriefing).not.toHaveBeenCalled();
    });

    it('returns false for an unknown briefing', async () => {
        expect(await ops.removeSlide('nao-existe', 'a')).toBe(false);
    });

    it('returns false and logs no delete op when the guard denies', async () => {
        seed('b', ['a']);
        guard.allowed = false;
        expect(await ops.removeSlide('b', 'a')).toBe(false);
        expect(logOperation).not.toHaveBeenCalled();
    });

    it('emptying the briefing leaves an empty array, not a hole', async () => {
        seed('b', ['a']);
        await ops.removeSlide('b', 'a');
        expect(db.get('b').slides).toEqual([]);
    });
});

describe('updateSlide', () => {
    it('merges the patch and keeps the slide id', async () => {
        seed('b', ['a']);
        const out = await ops.updateSlide('b', 'a', { title: 'novo', id: 'tentativa' });
        expect(out.id).toBe('a');
        expect(out.title).toBe('novo');
    });

    it('returns null for an unknown slide or briefing', async () => {
        seed('b', ['a']);
        expect(await ops.updateSlide('b', 'fantasma', {})).toBeNull();
        expect(await ops.updateSlide('nao-existe', 'a', {})).toBeNull();
    });

    it('logs the previous slide alongside the new one', async () => {
        seed('b', ['a']);
        await ops.updateSlide('b', 'a', { title: 'novo' });
        expect(logOperation).toHaveBeenCalledTimes(1);
        const call = logOperation.mock.calls[0];
        expect(call[1]).toBe('update');
        expect(call[5].title).toBe('S0');
    });
});

// ============================================================================
// importBriefings
// ============================================================================

describe('importBriefings', () => {
    it('skips entries without an id or without a name', async () => {
        const out = await ops.importBriefings([
            { name: 'sem id' },
            { id: 'sem-nome' },
            { id: 'ok', name: 'Ok' },
        ]);
        expect(out).toEqual({ imported: 1, skipped: 2 });
        expect(db.size).toBe(1);
    });

    it('re-identifies and renames a colliding briefing when overwrite is off', async () => {
        seed('existente', []);
        db.get('existente').name = 'Plano';

        const out = await ops.importBriefings([{ id: 'existente', name: 'Plano', slides: [] }]);
        expect(out).toEqual({ imported: 1, skipped: 0 });
        expect(db.size).toBe(2);

        const novo = [...db.values()].find(b => b.id !== 'existente');
        expect(novo.id).toMatch(UUID_V4);
        expect(novo.name).toBe('Plano (1)');
    });

    it('keeps the id and replaces the row when overwrite is on', async () => {
        seed('existente', []);
        db.get('existente').name = 'Plano';

        const out = await ops.importBriefings(
            [{ id: 'existente', name: 'Plano', slides: [{ id: 's' }] }],
            { overwrite: true }
        );
        expect(out).toEqual({ imported: 1, skipped: 0 });
        expect(db.size).toBe(1);
        expect(db.get('existente').slides).toHaveLength(1);
    });

    it('supplies sync metadata when the import carries none', async () => {
        await ops.importBriefings([{ id: 'novo', name: 'N' }]);
        expect(db.get('novo').sync).toBeTruthy();
    });

    it('stamps updatedAt on every imported row', async () => {
        await ops.importBriefings([{ id: 'novo', name: 'N', updatedAt: 1 }]);
        expect(db.get('novo').updatedAt).toBeGreaterThan(1);
    });

    it('an empty list is a no-op', async () => {
        expect(await ops.importBriefings([])).toEqual({ imported: 0, skipped: 0 });
        expect(repo.saveBriefing).not.toHaveBeenCalled();
    });
});
