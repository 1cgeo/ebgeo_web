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

    it.each([
        ['2d', { lng: 1, lat: 2 }, 'Mapa'],
        ['3d', { lng: 1, lat: 2, alt: 3 }, 'museum'],
        ['360', { heading: 1, pitch: 0 }, 'photo'],
        ['fp', { x: 1, y: 2, z: 3 }, 'museum'],
    ])('shows abbreviated rank and registered name at the %s position, for joins and snapshots', (surface, position, scope) => {
        store.setInitial([{ id: 'u1', clientId: 'c1', nome: 'Felipe de Carvalho Diniz', nome_guerra: 'Diniz', posto_graduacao: 'Maj' }]);
        store.setCursor({ clientId: 'c1', surface, position, mapId: 'Mapa', tilesetId: 'museum', photoName: 'photo' });
        expect(store.getCursors(surface, scope)[0].userName).toBe('Maj Diniz');
        store.userJoined({ id: 'u1', clientId: 'c1', nome: 'Diniz' });
        expect(store.getCursors(surface, scope)[0].userName).toBe('Maj Diniz');
        store.userJoined({ id: 'u1', clientId: 'c1', nome: 'Diniz', posto_graduacao: null });
        expect(store.getCursors(surface, scope)[0].userName).toBe('Diniz');
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

        it('ingests awareness state from the join snapshot (mapId/selectedFeatures/status)', () => {
            // Snapshot items key on `id` + `nome` and carry awareness fields.
            store.setInitial([
                {
                    id: 'u1',
                    nome: 'Alice',
                    posto_graduacao: 'Cap',
                    mapId: 'm1',
                    cursorPosition: { lng: 10, lat: 20 },
                    status: 'away',
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
            // A superficie viaja no evento desde 2026-09-16, e um quadro sem ela e do mapa.
            expect(payloads[0]).toEqual({ mapId: 'm1', surface: '2d' });
        });

        it('creates a transient entry when the user is not yet known', () => {
            store.setCursor({ clientId: 'c9', userId: 'u9', position: { lng: 1, lat: 2 }, mapId: 'm1' });
            expect(store.count()).toBe(1);
            expect(store.getCursors('2d', 'm1')).toHaveLength(1);
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

    // ===== O instante da linha do tempo SAIU do roster (dono, 2026-09-21) =====
    describe('o instante da linha do tempo não é estado de presença', () => {
        it('não há mutação para ele, e o retrato de entrada que o carregue é ignorado', () => {
            // A superfície: o store não expõe mais mutação de instante temporal.
            expect(store.setTemporal).toBeUndefined();

            // E um servidor ANTIGO ainda pode mandar o campo no retrato de entrada. Ele não vira
            // estado nenhum: a entrada nasce sem campo de instante, e os vizinhos do MESMO
            // retrato (PISO) continuam sendo ingeridos, então a ausência é do campo removido e
            // não de uma ingestão quebrada.
            store.setInitial([
                {
                    id: 'u1',
                    nome: 'Alice',
                    mapId: 'm1',
                    status: 'away',
                    temporalState: { cursor: 1000, label: 'D+2' },
                },
            ]);
            const user = store.getUsers()[0];
            expect(user.temporal).toBeUndefined();
            expect('temporal' in user).toBe(false);
            expect(user.currentMap).toBe('m1');
            expect(user.away).toBe(true);
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
            const cursors = store.getCursors('2d', 'm1');
            expect(cursors).toHaveLength(1);
            expect(cursors[0]).toMatchObject({
                clientId: 'c1',
                userName: 'Alice',
                surface: '2d',
                position: { lng: 1, lat: 1, mapId: 'm1' },
            });
        });

        it('returns all cursors when no filter is given', () => {
            expect(store.getCursors()).toHaveLength(2);
        });
    });

    // ===== Cursor por superficie (2026-09-16) =====
    //
    // O QUE ESTES CASOS EXISTEM PARA PEGAR: um cursor de panorama desenhado sobre o mapa, e um
    // cursor de mapa desenhado dentro do panorama. Os dois sao invisiveis para qualquer teste que
    // so pergunte "guardou o cursor?", porque nos dois o cursor E guardado.
    describe('setCursor — superficies 3D e 360', () => {
        it('guarda o cursor do 360 em coordenada de esfera, escopado pela foto', () => {
            store.userJoined({ clientId: 'c1', userId: 'u1', userName: 'Alice' });
            store.setCursor({
                clientId: 'c1', surface: '360', photoName: 'foto-7', mapId: 'm1',
                position: { heading: 187.5, pitch: -0.2 },
            });

            const cursors = store.getCursors('360', 'foto-7');
            expect(cursors).toHaveLength(1);
            expect(cursors[0].position).toMatchObject({
                surface: '360', heading: 187.5, pitch: -0.2, photoName: 'foto-7',
            });
        });

        it('guarda o cursor do 3D com altura, escopado pelo tileset', () => {
            store.userJoined({ clientId: 'c1', userId: 'u1' });
            store.setCursor({
                clientId: 'c1', surface: '3d', tilesetId: 'modelo-2', mapId: 'm1',
                position: { lng: -43.1, lat: -22.9, alt: 15.5 },
            });

            const cursors = store.getCursors('3d', 'modelo-2');
            expect(cursors).toHaveLength(1);
            expect(cursors[0].position).toMatchObject({
                surface: '3d', lng: -43.1, lat: -22.9, alt: 15.5, tilesetId: 'modelo-2',
            });
        });

        it('NAO entrega o cursor do 360 a quem pergunta pelo mapa 2D', () => {
            store.userJoined({ clientId: 'c1', userId: 'u1' });
            store.setCursor({
                clientId: 'c1', surface: '360', photoName: 'foto-7', mapId: 'm1',
                position: { heading: 10, pitch: 0 },
            });

            // O overlay do mapa pergunta assim, e o mapId do quadro CASA ('m1'): se o filtro fosse
            // so por mapa, o par apareceria no mapa 2D numa coordenada que nao existe.
            expect(store.getCursors('2d', 'm1')).toHaveLength(0);
        });

        it('recusa a posicao da superficie errada, em vez de guardar meia coordenada', () => {
            store.userJoined({ clientId: 'c1', userId: 'u1' });
            // Forma de mapa (lng/lat) declarada como 360.
            store.setCursor({
                clientId: 'c1', surface: '360', photoName: 'foto-7',
                position: { lng: 1, lat: 2 },
            });
            expect(store.getUsers()[0].cursor).toBeNull();

            // Forma de esfera declarada como mapa.
            store.setCursor({ clientId: 'c1', surface: '2d', mapId: 'm1', position: { heading: 1, pitch: 0 } });
            expect(store.getUsers()[0].cursor).toBeNull();

            // 3D sem altura: o ponto picado sem `alt` nao situa nada na cena.
            store.setCursor({
                clientId: 'c1', surface: '3d', tilesetId: 't1', position: { lng: 1, lat: 2 },
            });
            expect(store.getUsers()[0].cursor).toBeNull();
        });

        it('emite a superficie do quadro no evento, para a cena certa repintar', () => {
            store.userJoined({ clientId: 'c1', userId: 'u1' });
            emitSpy.mockClear();
            store.setCursor({
                clientId: 'c1', surface: '360', photoName: 'f1', mapId: 'm1',
                position: { heading: 1, pitch: 0 },
            });
            expect(emitsFor(EventTypes.PRESENCE_CURSORS_CHANGED)[0]).toEqual({ mapId: 'm1', surface: '360' });
        });

        it('le a superficie do snapshot de quem entra depois (cursorContext)', () => {
            store.setInitial([{
                id: 'u1', clientId: 'c1', nome: 'Alice', mapId: 'm1',
                cursorPosition: { heading: 42, pitch: 0.1 },
                cursorContext: { surface: '360', mapId: 'm1', photoName: 'foto-9', tilesetId: null },
            }]);

            expect(store.getCursors('360', 'foto-9')).toHaveLength(1);
            // E o late-joiner nao o desenha no mapa.
            expect(store.getCursors('2d', 'm1')).toHaveLength(0);
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
