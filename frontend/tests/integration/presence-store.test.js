// Path: tests/integration/presence-store.test.js

/**
 * @fileoverview Unit tests for the pure presence/awareness store.
 *
 * Covers membership lifecycle (setInitial/join/left/away/back), cursor and
 * selection updates, self-exclusion via getOthers, dedupe by clientId, and the
 * event-bus emissions (PRESENCE_CHANGED / PRESENCE_CURSORS_CHANGED).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ============================================================================
// Mocks
// ============================================================================

const emitSpy = vi.fn();

vi.mock('@store/services.js', () => ({
    getEventBus: () => ({ emit: emitSpy }),
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { PresenceStore } from '@js/presence/presence-store.js';
import { EventTypes } from '@events/event_types.js';

// ============================================================================
// Helpers
// ============================================================================

/** @returns {Array} payloads emitted for a given event type */
function emitsFor(type) {
    return emitSpy.mock.calls.filter(([t]) => t === type).map(([, p]) => p);
}

// ============================================================================
// Tests
// ============================================================================

describe('PresenceStore', () => {
    /** @type {PresenceStore} */
    let store;

    beforeEach(() => {
        emitSpy.mockClear();
        store = new PresenceStore();
    });

    describe('event types', () => {
        it('exposes the new presence events', () => {
            expect(EventTypes.PRESENCE_CHANGED).toBe('presence:changed');
            expect(EventTypes.PRESENCE_CURSORS_CHANGED).toBe('presence:cursorsChanged');
            expect(EventTypes.PRESENCE_SELECTIONS_CHANGED).toBe('presence:selectionsChanged');
        });
    });

    describe('setInitial', () => {
        it('replaces membership and normalizes entries', () => {
            store.setInitial([
                { userId: 'u1', clientId: 'c1', userName: 'Alice' },
                { userId: 'u2', clientId: 'c2' },
            ]);

            expect(store.count()).toBe(2);
            const users = store.getUsers();
            expect(users.find((u) => u.clientId === 'c1')).toMatchObject({
                userId: 'u1',
                clientId: 'c1',
                userName: 'Alice',
                cursor: null,
                selection: null,
                away: false,
            });
            expect(users.find((u) => u.clientId === 'c2').userName).toBeNull();
        });

        it('falls back to userId as the key when clientId is missing', () => {
            store.setInitial([{ userId: 'u1', userName: 'Alice' }]);
            expect(store.count()).toBe(1);
            expect(store.getUsers()[0].clientId).toBe('u1');
        });

        it('skips entries with neither clientId nor userId', () => {
            store.setInitial([{ userName: 'ghost' }, { clientId: 'c1' }]);
            expect(store.count()).toBe(1);
        });

        it('tolerates non-array input and clears previous state', () => {
            store.setInitial([{ clientId: 'c1' }]);
            store.setInitial(undefined);
            expect(store.count()).toBe(0);
        });

        it('emits PRESENCE_CHANGED with the user list', () => {
            store.setInitial([{ clientId: 'c1', userId: 'u1' }]);
            const payloads = emitsFor(EventTypes.PRESENCE_CHANGED);
            expect(payloads).toHaveLength(1);
            expect(payloads[0].users).toHaveLength(1);
        });

        it('ingests awareness state from the join snapshot (mapId/temporalState/selectedFeatures/status)', () => {
            // Snapshot items key on `id` + `nome` and carry awareness fields.
            store.setInitial([
                {
                    id: 'u1',
                    nome: 'Alice',
                    posto_graduacao: 'Cap',
                    mapId: 'm1',
                    cursorPosition: { lng: 10, lat: 20 },
                    status: 'away',
                    temporalState: { cursor: 1000, label: 'D+2' },
                    selectedFeatures: ['f1', 'f2'],
                },
            ]);

            const user = store.getUsers()[0];
            expect(user.clientId).toBe('u1');
            expect(user.userId).toBe('u1');
            expect(user.userName).toBe('Alice');
            expect(user.currentMap).toBe('m1');
            expect(user.cursor).toMatchObject({ lng: 10, lat: 20, mapId: 'm1' });
            expect(user.away).toBe(true);
            expect(user.temporal).toEqual({ cursor: 1000, label: 'D+2' });
            // Legacy snapshot (selectedFeatures, no selectionContext) → 2D selection.
            expect(user.selection).toEqual({
                surface: '2d', featureIds: ['f1', 'f2'], featureMeta: null,
                mapId: 'm1', tilesetId: null, photoName: null,
            });
        });

        it('defaults snapshot awareness to empty when fields are absent', () => {
            store.setInitial([{ id: 'u1', nome: 'Bob', status: 'online' }]);
            const user = store.getUsers()[0];
            expect(user.away).toBe(false);
            expect(user.currentMap).toBeNull();
            expect(user.temporal).toBeNull();
            expect(user.selection).toBeNull();
            expect(user.cursor).toBeNull();
            expect(user.briefingEdit).toBeNull();
        });
    });

    describe('userJoined / userLeft', () => {
        it('adds a user and emits', () => {
            store.userJoined({ userId: 'u1', clientId: 'c1', userName: 'Alice' });
            expect(store.count()).toBe(1);
            expect(emitsFor(EventTypes.PRESENCE_CHANGED)).toHaveLength(1);
        });

        it('dedupes by clientId on re-join, preserving awareness state', () => {
            store.userJoined({ userId: 'u1', clientId: 'c1', userName: 'Alice' });
            store.setCursor({ clientId: 'c1', position: { lng: 1, lat: 2 }, mapId: 'm1' });
            store.userJoined({ userId: 'u1', clientId: 'c1', userName: 'Alice Renamed' });

            expect(store.count()).toBe(1);
            const user = store.getUsers()[0];
            expect(user.userName).toBe('Alice Renamed');
            // Cursor survives the re-join.
            expect(user.cursor).toMatchObject({ lng: 1, lat: 2, mapId: 'm1' });
        });

        it('ignores joins with no usable id', () => {
            store.userJoined({ userName: 'ghost' });
            expect(store.count()).toBe(0);
            expect(emitSpy).not.toHaveBeenCalled();
        });

        it('removes a user by clientId', () => {
            store.userJoined({ clientId: 'c1', userId: 'u1' });
            emitSpy.mockClear();
            store.userLeft({ clientId: 'c1' });
            expect(store.count()).toBe(0);
            expect(emitsFor(EventTypes.PRESENCE_CHANGED)).toHaveLength(1);
        });

        it('removes a user by userId fallback', () => {
            store.userJoined({ userId: 'u1' });
            store.userLeft({ userId: 'u1' });
            expect(store.count()).toBe(0);
        });

        it('does not emit when leaving an unknown user', () => {
            store.userLeft({ clientId: 'nope' });
            expect(emitSpy).not.toHaveBeenCalled();
        });
    });

    describe('userAway / userBack', () => {
        beforeEach(() => {
            store.userJoined({ clientId: 'c1', userId: 'u1' });
            emitSpy.mockClear();
        });

        it('marks away and back, emitting only on change', () => {
            store.userAway({ clientId: 'c1' });
            expect(store.getUsers()[0].away).toBe(true);
            expect(emitsFor(EventTypes.PRESENCE_CHANGED)).toHaveLength(1);

            // Idempotent: already away → no further emit.
            store.userAway({ clientId: 'c1' });
            expect(emitsFor(EventTypes.PRESENCE_CHANGED)).toHaveLength(1);

            store.userBack({ clientId: 'c1' });
            expect(store.getUsers()[0].away).toBe(false);
            expect(emitsFor(EventTypes.PRESENCE_CHANGED)).toHaveLength(2);
        });

        it('ignores away/back for unknown users', () => {
            store.userAway({ clientId: 'unknown' });
            expect(emitSpy).not.toHaveBeenCalled();
        });
    });

    describe('setCursor', () => {
        it('stores the cursor and emits PRESENCE_CURSORS_CHANGED with mapId', () => {
            store.userJoined({ clientId: 'c1', userId: 'u1' });
            emitSpy.mockClear();

            store.setCursor({ clientId: 'c1', position: { lng: 10, lat: 20 }, mapId: 'm1' });
            expect(store.getUsers()[0].cursor).toMatchObject({ lng: 10, lat: 20, mapId: 'm1' });

            const payloads = emitsFor(EventTypes.PRESENCE_CURSORS_CHANGED);
            expect(payloads).toHaveLength(1);
            expect(payloads[0]).toEqual({ mapId: 'm1' });
        });

        it('creates a transient entry when the user is not yet known', () => {
            store.setCursor({ clientId: 'c9', userId: 'u9', position: { lng: 1, lat: 2 }, mapId: 'm1' });
            expect(store.count()).toBe(1);
            expect(store.getCursors('m1')).toHaveLength(1);
        });

        it('clears the cursor when position is malformed', () => {
            store.userJoined({ clientId: 'c1' });
            store.setCursor({ clientId: 'c1', position: { lng: 1, lat: 2 }, mapId: 'm1' });
            store.setCursor({ clientId: 'c1', position: { x: 5 }, mapId: 'm1' });
            expect(store.getUsers()[0].cursor).toBeNull();
        });

        it('ignores cursor messages with no usable id', () => {
            store.setCursor({ position: { lng: 1, lat: 2 } });
            expect(store.count()).toBe(0);
        });
    });

    describe('setSelection', () => {
        it('stores a non-empty selection and emits PRESENCE_CHANGED', () => {
            store.userJoined({ clientId: 'c1' });
            emitSpy.mockClear();

            store.setSelection({ clientId: 'c1', featureIds: ['f1', 'f2'], mapId: 'm1' });
            expect(store.getUsers()[0].selection).toEqual({
                surface: '2d', featureIds: ['f1', 'f2'], featureMeta: null,
                mapId: 'm1', tilesetId: null, photoName: null,
            });
            expect(emitsFor(EventTypes.PRESENCE_CHANGED)).toHaveLength(1);
        });

        it('clears the selection when featureIds is empty', () => {
            store.userJoined({ clientId: 'c1' });
            store.setSelection({ clientId: 'c1', featureIds: ['f1'], mapId: 'm1' });
            store.setSelection({ clientId: 'c1', featureIds: [], mapId: 'm1' });
            expect(store.getUsers()[0].selection).toBeNull();
        });

        it('updates currentMap from the selection mapId (case C)', () => {
            store.userJoined({ clientId: 'c1' });
            store.setSelection({ clientId: 'c1', featureIds: ['f1'], mapId: 'm9' });
            expect(store.getUsers()[0].currentMap).toBe('m9');
        });
    });

    // ===== Multi-surface selection (2D / 3D / 360) =====
    describe('setSelection — surface + scope (2D / 3D / 360)', () => {
        it('stores the 2D surface, featureMeta and emits PRESENCE_SELECTIONS_CHANGED', () => {
            store.userJoined({ clientId: 'c1', userId: 'u1' });
            emitSpy.mockClear();

            store.setSelection({
                clientId: 'c1', surface: '2d', featureIds: ['f1'], mapId: 'm1',
                featureMeta: [{ id: 'f1', type: 'point' }],
            });

            expect(store.getUsers()[0].selection).toEqual({
                surface: '2d', featureIds: ['f1'], featureMeta: [{ id: 'f1', type: 'point' }],
                mapId: 'm1', tilesetId: null, photoName: null,
            });
            expect(emitsFor(EventTypes.PRESENCE_SELECTIONS_CHANGED)).toEqual([{ surface: '2d' }]);
        });

        it('stores the 3D surface scope (tilesetId)', () => {
            store.userJoined({ clientId: 'c1' });
            store.setSelection({ clientId: 'c1', surface: '3d', featureIds: ['m-3d'], mapId: 'm1', tilesetId: 't1' });
            const sel = store.getUsers()[0].selection;
            expect(sel.surface).toBe('3d');
            expect(sel.tilesetId).toBe('t1');
            expect(sel.photoName).toBeNull();
        });

        it('stores the 360 surface scope (photoName)', () => {
            store.userJoined({ clientId: 'c1' });
            store.setSelection({ clientId: 'c1', surface: '360', featureIds: ['poi1'], mapId: 'm1', photoName: 'foto.jpg' });
            const sel = store.getUsers()[0].selection;
            expect(sel.surface).toBe('360');
            expect(sel.photoName).toBe('foto.jpg');
        });

        it('emits PRESENCE_SELECTIONS_CHANGED for the cleared surface on deselect', () => {
            store.userJoined({ clientId: 'c1' });
            store.setSelection({ clientId: 'c1', surface: '3d', featureIds: ['m1'], tilesetId: 't1' });
            emitSpy.mockClear();
            // Deselect carries the surface so the overlay knows which surface to clear.
            store.setSelection({ clientId: 'c1', surface: '3d', featureIds: [], tilesetId: 't1' });
            expect(store.getUsers()[0].selection).toBeNull();
            expect(emitsFor(EventTypes.PRESENCE_SELECTIONS_CHANGED)).toEqual([{ surface: '3d' }]);
        });
    });

    // ===== getSelections accessor =====
    describe('getSelections', () => {
        beforeEach(() => {
            store.userJoined({ clientId: 'c1', userId: 'u1', userName: 'Alice' });
            store.userJoined({ clientId: 'c2', userId: 'u2', userName: 'Bob' });
        });

        it('filters by surface AND scope key (2D mapId, 3D tilesetId, 360 photoName)', () => {
            store.setSelection({ clientId: 'c1', surface: '2d', featureIds: ['f1'], mapId: 'mapaA' });
            store.setSelection({ clientId: 'c2', surface: '2d', featureIds: ['f2'], mapId: 'mapaB' });

            const onA = store.getSelections('2d', 'mapaA');
            expect(onA).toHaveLength(1);
            expect(onA[0]).toMatchObject({ clientId: 'c1', userName: 'Alice', featureIds: ['f1'] });

            // 3D scope: only the matching tilesetId.
            store.setSelection({ clientId: 'c1', surface: '3d', featureIds: ['m1'], tilesetId: 't1' });
            expect(store.getSelections('3d', 't1')).toHaveLength(1);
            expect(store.getSelections('3d', 'tOTHER')).toHaveLength(0);
            // Switching c1 to 3D drops its 2D selection — only c2 remains on 2D.
            expect(store.getSelections('2d', 'mapaA')).toHaveLength(0);

            // 360 scope by photoName.
            store.setSelection({ clientId: 'c2', surface: '360', featureIds: ['p1'], photoName: 'foto.jpg' });
            expect(store.getSelections('360', 'foto.jpg')).toHaveLength(1);
            expect(store.getSelections('360', 'outra.jpg')).toHaveLength(0);
        });

        it('skips empty selections and does NOT exclude self (overlay filters self)', () => {
            store.setSelection({ clientId: 'c1', surface: '2d', featureIds: [], mapId: 'mapaA' });
            expect(store.getSelections('2d', 'mapaA')).toHaveLength(0);

            store.setSelection({ clientId: 'c1', surface: '2d', featureIds: ['f1'], mapId: 'mapaA' });
            // Self exclusion is the overlay's responsibility — getSelections returns all.
            expect(store.getSelections('2d', 'mapaA').map((s) => s.clientId)).toEqual(['c1']);
        });
    });

    // ===== Snapshot rehydrate via selectionContext (late-joiner) =====
    describe('setInitial — rehydrates 3D/360 selection from selectionContext', () => {
        it('reconstructs a peer 3D selection from the join snapshot', () => {
            store.setInitial([
                {
                    id: 'u1', nome: 'Alice',
                    selectionContext: { surface: '3d', featureIds: ['m1'], mapId: 'mapaA', tilesetId: 't1' },
                },
            ]);
            const sel = store.getUsers()[0].selection;
            expect(sel).toMatchObject({ surface: '3d', featureIds: ['m1'], tilesetId: 't1' });
            expect(store.getSelections('3d', 't1')).toHaveLength(1);
        });
    });

    // ===== Case C — active-map indicator =====
    describe('setCurrentMap', () => {
        it('sets currentMap and emits PRESENCE_CHANGED only on change', () => {
            store.userJoined({ clientId: 'c1' });
            emitSpy.mockClear();

            store.setCurrentMap({ clientId: 'c1', mapId: 'm1' });
            expect(store.getUsers()[0].currentMap).toBe('m1');
            expect(emitsFor(EventTypes.PRESENCE_CHANGED)).toHaveLength(1);

            // Idempotent: same map → no further emit.
            store.setCurrentMap({ clientId: 'c1', mapId: 'm1' });
            expect(emitsFor(EventTypes.PRESENCE_CHANGED)).toHaveLength(1);

            store.setCurrentMap({ clientId: 'c1', mapId: 'm2' });
            expect(store.getUsers()[0].currentMap).toBe('m2');
            expect(emitsFor(EventTypes.PRESENCE_CHANGED)).toHaveLength(2);
        });

        it('creates a transient entry when the user is unknown', () => {
            store.setCurrentMap({ clientId: 'c9', userId: 'u9', mapId: 'm1' });
            expect(store.count()).toBe(1);
            expect(store.getUsers()[0].currentMap).toBe('m1');
        });

        it('ignores messages with no usable id or no mapId', () => {
            store.setCurrentMap({ mapId: 'm1' });
            expect(store.count()).toBe(0);
            store.userJoined({ clientId: 'c1' });
            emitSpy.mockClear();
            store.setCurrentMap({ clientId: 'c1' });
            expect(emitsFor(EventTypes.PRESENCE_CHANGED)).toHaveLength(0);
        });
    });

    describe('setCursor — currentMap piggyback', () => {
        it('updates currentMap from the cursor mapId and emits PRESENCE_CHANGED on change', () => {
            store.userJoined({ clientId: 'c1' });
            emitSpy.mockClear();

            store.setCursor({ clientId: 'c1', position: { lng: 1, lat: 2 }, mapId: 'm5' });
            expect(store.getUsers()[0].currentMap).toBe('m5');
            // One cursors event + one membership event (currentMap changed).
            expect(emitsFor(EventTypes.PRESENCE_CURSORS_CHANGED)).toHaveLength(1);
            expect(emitsFor(EventTypes.PRESENCE_CHANGED)).toHaveLength(1);
        });

        it('does not emit a membership change when the map is unchanged', () => {
            store.setCursor({ clientId: 'c1', position: { lng: 1, lat: 2 }, mapId: 'm5' });
            emitSpy.mockClear();
            store.setCursor({ clientId: 'c1', position: { lng: 3, lat: 4 }, mapId: 'm5' });
            expect(emitsFor(EventTypes.PRESENCE_CHANGED)).toHaveLength(0);
            expect(emitsFor(EventTypes.PRESENCE_CURSORS_CHANGED)).toHaveLength(1);
        });

        it('reads currentMap even when the position is malformed (positionless map frame)', () => {
            store.userJoined({ clientId: 'c1' });
            store.setCursor({ clientId: 'c1', position: null, mapId: 'm7' });
            expect(store.getUsers()[0].cursor).toBeNull();
            expect(store.getUsers()[0].currentMap).toBe('m7');
        });
    });

    // ===== Case E — temporal presence =====
    describe('setTemporal', () => {
        it('stores the temporal state blob and emits PRESENCE_CHANGED', () => {
            store.userJoined({ clientId: 'c1' });
            emitSpy.mockClear();

            const tState = { cursor: 1000, label: 'D+3', playing: true };
            store.setTemporal({ clientId: 'c1', state: tState, mapId: 'm1' });
            expect(store.getUsers()[0].temporal).toEqual(tState);
            expect(store.getUsers()[0].currentMap).toBe('m1');
            expect(emitsFor(EventTypes.PRESENCE_CHANGED)).toHaveLength(1);
        });

        it('clears the temporal state when state is null', () => {
            store.userJoined({ clientId: 'c1' });
            store.setTemporal({ clientId: 'c1', state: { cursor: 1 } });
            store.setTemporal({ clientId: 'c1', state: null });
            expect(store.getUsers()[0].temporal).toBeNull();
        });

        it('ignores temporal messages with no usable id', () => {
            store.setTemporal({ state: { cursor: 1 } });
            expect(store.count()).toBe(0);
        });
    });

    // ===== Case D — briefing-edit indicator =====
    describe('setBriefingEdit', () => {
        it('marks a user as editing a briefing and emits PRESENCE_CHANGED', () => {
            store.userJoined({ clientId: 'c1' });
            emitSpy.mockClear();

            store.setBriefingEdit({ clientId: 'c1', briefingId: 'b1', userName: 'Alice', editing: true });
            expect(store.getUsers()[0].briefingEdit).toEqual({ briefingId: 'b1', userName: 'Alice' });
            expect(emitsFor(EventTypes.PRESENCE_CHANGED)).toHaveLength(1);
        });

        it('clears the briefing-edit flag when editing is false', () => {
            store.userJoined({ clientId: 'c1' });
            store.setBriefingEdit({ clientId: 'c1', briefingId: 'b1', editing: true });
            store.setBriefingEdit({ clientId: 'c1', briefingId: 'b1', editing: false });
            expect(store.getUsers()[0].briefingEdit).toBeNull();
        });

        it('ignores messages with no usable id', () => {
            store.setBriefingEdit({ briefingId: 'b1', editing: true });
            expect(store.count()).toBe(0);
        });
    });

    describe('getCursors', () => {
        beforeEach(() => {
            store.setInitial([
                { clientId: 'c1', userId: 'u1', userName: 'Alice' },
                { clientId: 'c2', userId: 'u2', userName: 'Bob' },
                { clientId: 'c3', userId: 'u3', userName: 'Carol' },
            ]);
            store.setCursor({ clientId: 'c1', position: { lng: 1, lat: 1 }, mapId: 'm1' });
            store.setCursor({ clientId: 'c2', position: { lng: 2, lat: 2 }, mapId: 'm2' });
            // c3 has no cursor.
        });

        it('returns only cursors for the requested map', () => {
            const cursors = store.getCursors('m1');
            expect(cursors).toHaveLength(1);
            expect(cursors[0]).toMatchObject({
                clientId: 'c1',
                userName: 'Alice',
                position: { lng: 1, lat: 1, mapId: 'm1' },
            });
        });

        it('returns all cursors when no map filter is given', () => {
            expect(store.getCursors()).toHaveLength(2);
        });
    });

    describe('getOthers', () => {
        beforeEach(() => {
            store.setInitial([
                { clientId: 'c1', userId: 'u1' },
                { clientId: 'c2', userId: 'u2' },
            ]);
        });

        it('excludes self by clientId', () => {
            const others = store.getOthers('c1');
            expect(others).toHaveLength(1);
            expect(others[0].clientId).toBe('c2');
        });

        it('excludes self by userId fallback', () => {
            const others = store.getOthers('u2');
            expect(others).toHaveLength(1);
            expect(others[0].clientId).toBe('c1');
        });

        it('returns everyone when self id is null/unknown', () => {
            expect(store.getOthers(null)).toHaveLength(2);
            expect(store.getOthers('nobody')).toHaveLength(2);
        });
    });

    describe('clear', () => {
        it('empties the store and emits once', () => {
            store.setInitial([{ clientId: 'c1' }]);
            emitSpy.mockClear();
            store.clear();
            expect(store.count()).toBe(0);
            expect(emitsFor(EventTypes.PRESENCE_CHANGED)).toHaveLength(1);
        });

        it('does not emit when already empty', () => {
            store.clear();
            expect(emitSpy).not.toHaveBeenCalled();
        });
    });

    describe('returned snapshots are copies', () => {
        it('does not leak internal references through getUsers', () => {
            store.userJoined({ clientId: 'c1', userId: 'u1' });
            const users = store.getUsers();
            users[0].away = true;
            expect(store.getUsers()[0].away).toBe(false);
        });
    });
});
