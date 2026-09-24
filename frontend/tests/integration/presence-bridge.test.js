// Path: tests/integration/presence-bridge.test.js

/**
 * @fileoverview Unit tests for the presence bridge (Slice 2 wiring).
 *
 * Pins the inbound routing (WS 'connected'/'presence'/'cursor'/'selection' ->
 * presence store), the throttled outbound cursor broadcast on map 'mousemove',
 * idempotent start/stop, and teardown (map unbind + store clear).
 *
 * O "CASO E" SAIU EM 2026-09-21, por decisão do dono: o instante da linha do tempo de uma
 * pessoa não se propaga. Este arquivo tinha um caso de entrada e um de saída para ele, e os
 * dois foram removidos. O que ficou no lugar é a AUSÊNCIA afirmada: a ponte não registra
 * manipulador para o quadro e não envia nada quando a linha do tempo anda. A varredura
 * estrutural que impede a volta do símbolo está em
 * `tests/unit/presenca-temporal-nao-volta.test.js`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================================
// Mocks (declared before importing the module under test)
// ============================================================================

// vi.mock factories are hoisted above the file, so the shared mocks they close
// over must be created with vi.hoisted (also hoisted) to avoid a TDZ error.
const {
    wsHandlers,
    busHandlers,
    wsClientMock,
    presenceStoreMock,
    eventBusMock,
    stateManagerMock,
    getCurrentMapNameSyncMock,
} = vi.hoisted(() => {
    /** Single-handler-per-event registry, mirroring ws-client.on(). */
    const handlers = {};
    // OS DUPLOS NÃO TÊM O MÉTODO DO QUADRO DE LINHA DO TEMPO, e essa ausência é metade do
    // guarda: religar o envio na ponte não falha uma asserção, LANÇA aqui dentro (chamar
    // `undefined`), que é o vermelho mais barato de ler.
    const ws = {
        on: vi.fn((event, handler) => {
            handlers[event] = handler;
            return ws;
        }),
        isConnected: vi.fn(() => true),
        sendCursor: vi.fn(),
        sendSelection: vi.fn(),
        sendBriefingEditStart: vi.fn(),
        sendBriefingEditEnd: vi.fn(),
        sendViewer: vi.fn(() => true),
    };
    const store = {
        setInitial: vi.fn(),
        userJoined: vi.fn(),
        userLeft: vi.fn(),
        userAway: vi.fn(),
        userBack: vi.fn(),
        setCursor: vi.fn(),
        setSelection: vi.fn(),
        setBriefingEdit: vi.fn(),
        setCurrentMap: vi.fn(),
        setViewer: vi.fn(),
        clear: vi.fn(),
    };

    // Multi-handler event bus stand-in (records by event for firing in tests).
    const bus = {
        on: vi.fn((event, handler) => {
            if (!handlers.__bus) handlers.__bus = {};
            if (!handlers.__bus[event]) handlers.__bus[event] = new Set();
            handlers.__bus[event].add(handler);
            // Mirror real EventBus.on() which returns an unsubscribe function.
            return () => handlers.__bus[event].delete(handler);
        }),
        off: vi.fn(),
        emit: vi.fn(),
    };

    // StateManager mock: records the selection.features subscriber so the test
    // can drive selection changes, and returns a configurable selection list.
    const selectionListeners = new Set();
    const stateManager = {
        _selected: [],
        subscribe: vi.fn((path, cb) => {
            if (path === 'selection.features') selectionListeners.add(cb);
            return () => selectionListeners.delete(cb);
        }),
        getSelectedFeatures: vi.fn(() => stateManager._selected),
        /** Test helper: simulate a selection change. */
        _fireSelection() {
            for (const cb of selectionListeners) cb(stateManager._selected);
        },
    };

    const getMapName = vi.fn(() => 'mapa-1');
    return {
        wsHandlers: handlers,
        busHandlers: handlers,
        wsClientMock: ws,
        presenceStoreMock: store,
        eventBusMock: bus,
        stateManagerMock: stateManager,
        getCurrentMapNameSyncMock: getMapName,
    };
});

vi.mock('@store/sync/ws-client.js', () => ({ wsClient: wsClientMock }));
vi.mock('@js/presence/presence-store.js', () => ({ presenceStore: presenceStoreMock }));
// O duplo de `@store` NÃO expõe `getControl`, e isso é deliberado: era por ele que a ponte
// alcançava o controlador da linha do tempo para montar o rótulo do par. Reintroduzir aquele
// import faz o vitest recusar o módulo ("No getControl export is defined on the mock").
vi.mock('@store', () => ({
    getCurrentMapNameSync: getCurrentMapNameSyncMock,
    getStateManager: () => stateManagerMock,
}));
vi.mock('@store/services.js', () => ({ getEventBus: () => eventBusMock }));

/** Fire a bus event registered via getEventBus().on(event, ...). */
function fireBus(event, payload) {
    for (const cb of busHandlers.__bus?.[event] || []) cb(payload);
}

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { startPresence, stopPresence, CURSOR_THROTTLE_MS } from '@js/presence/presence-bridge.js';
import { EventTypes } from '@events/event_types.js';
import { sessionContext } from '@store/sync/session-context.js';

// ============================================================================
// Helpers
// ============================================================================

/** Minimal MapLibre Evented stand-in (on/off only). */
function createFakeMap() {
    const listeners = new Map();
    return {
        on: vi.fn((event, handler) => {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event).add(handler);
        }),
        off: vi.fn((event, handler) => {
            listeners.get(event)?.delete(handler);
        }),
        /** Test helper: fire a map event. */
        fire(event, payload) {
            for (const h of listeners.get(event) || []) h(payload);
        },
        /** Test helper: count active listeners for an event. */
        count(event) {
            return listeners.get(event)?.size ?? 0;
        },
    };
}

function resetMocks() {
    for (const key of Object.keys(wsHandlers)) delete wsHandlers[key];
    wsClientMock.on.mockClear();
    wsClientMock.isConnected.mockClear();
    wsClientMock.isConnected.mockReturnValue(true);
    wsClientMock.sendCursor.mockClear();
    wsClientMock.sendSelection.mockClear();
    wsClientMock.sendBriefingEditStart.mockClear();
    wsClientMock.sendBriefingEditEnd.mockClear();
    wsClientMock.sendViewer.mockClear();
    wsClientMock.sendViewer.mockReturnValue(true);
    for (const fn of Object.values(presenceStoreMock)) fn.mockClear();
    eventBusMock.on.mockClear();
    eventBusMock.off.mockClear();
    eventBusMock.emit.mockClear();
    stateManagerMock.subscribe.mockClear();
    stateManagerMock.getSelectedFeatures.mockClear();
    stateManagerMock._selected = [];
    getCurrentMapNameSyncMock.mockClear();
    getCurrentMapNameSyncMock.mockReturnValue('mapa-1');
}

// ============================================================================
// Tests
// ============================================================================

describe('presence-bridge', () => {
    /** @type {ReturnType<typeof createFakeMap>} */
    let map;

    beforeEach(() => {
        resetMocks();
        vi.useFakeTimers();
        map = createFakeMap();
    });

    afterEach(() => {
        stopPresence();
        vi.useRealTimers();
    });

    describe('startPresence — inbound routing', () => {
        beforeEach(() => {
            startPresence({ map });
        });

        it('registers handlers for connected/presence/cursor/selection/briefingEdit', () => {
            expect(wsHandlers.connected).toBeTypeOf('function');
            expect(wsHandlers.presence).toBeTypeOf('function');
            expect(wsHandlers.cursor).toBeTypeOf('function');
            expect(wsHandlers.selection).toBeTypeOf('function');
            expect(wsHandlers.briefingEdit).toBeTypeOf('function');
        });

        it('NÃO registra manipulador para o quadro da linha do tempo (dono, 2026-09-21)', () => {
            // O quadro deixou de existir nos dois pacotes. Um SERVIDOR antigo ainda pode mandá-lo,
            // e sem manipulador registrado ele morre no cliente sem tocar a lista de quem está
            // online. O piso ao lado prova que a varredura olha o registro certo: o vizinho
            // `selection`, que continua vivo, está lá.
            expect(wsHandlers.temporal).toBeUndefined();
            expect(wsHandlers.selection).toBeTypeOf('function');
        });

        it("routes 'connected' to presenceStore.setInitial with usersOnline", () => {
            const users = [{ userId: 'u1', clientId: 'c1' }];
            wsHandlers.connected({ usersOnline: users });
            expect(presenceStoreMock.setInitial).toHaveBeenCalledWith(users);
        });

        it("routes 'connected' with no usersOnline to setInitial([])", () => {
            wsHandlers.connected({});
            expect(presenceStoreMock.setInitial).toHaveBeenCalledWith([]);
        });

        it("routes 'presence' subtypes to the matching store mutation", () => {
            // user_joined nests the descriptor under `user` (backend shape); the bridge must
            // UNWRAP it so the store keys on the real id/nome. The others carry a top-level userId.
            wsHandlers.presence({ type: 'user_joined', user: { id: 'u1', nome: 'Alice' } });
            wsHandlers.presence({ type: 'user_left', userId: 'u1' });
            wsHandlers.presence({ type: 'user_away', userId: 'u1' });
            wsHandlers.presence({ type: 'user_back', userId: 'u1' });

            expect(presenceStoreMock.userJoined).toHaveBeenCalledWith({ id: 'u1', nome: 'Alice' });
            expect(presenceStoreMock.userLeft).toHaveBeenCalledWith({ type: 'user_left', userId: 'u1' });
            expect(presenceStoreMock.userAway).toHaveBeenCalledWith({ type: 'user_away', userId: 'u1' });
            expect(presenceStoreMock.userBack).toHaveBeenCalledWith({ type: 'user_back', userId: 'u1' });
        });

        it("ignores unknown 'presence' subtypes", () => {
            wsHandlers.presence({ type: 'user_dancing', clientId: 'c1' });
            expect(presenceStoreMock.userJoined).not.toHaveBeenCalled();
            expect(presenceStoreMock.userLeft).not.toHaveBeenCalled();
        });

        it("routes 'cursor' to presenceStore.setCursor", () => {
            const msg = { userId: 'u1', position: { lng: 1, lat: 2 }, mapId: 'm1' };
            wsHandlers.cursor(msg);
            expect(presenceStoreMock.setCursor).toHaveBeenCalledWith(msg);
        });

        it("routes 'selection' to presenceStore.setSelection", () => {
            const msg = { userId: 'u1', featureIds: ['f1'], mapId: 'm1' };
            wsHandlers.selection(msg);
            expect(presenceStoreMock.setSelection).toHaveBeenCalledWith(msg);
        });

        it("routes 'briefingEdit' started/ended to presenceStore.setBriefingEdit (case D inbound)", () => {
            wsHandlers.briefingEdit({ type: 'briefing_edit_started', userId: 'u1', userName: 'Alice', briefingId: 'b1' });
            expect(presenceStoreMock.setBriefingEdit).toHaveBeenLastCalledWith(
                expect.objectContaining({ userId: 'u1', userName: 'Alice', briefingId: 'b1', editing: true }),
            );

            wsHandlers.briefingEdit({ type: 'briefing_edit_ended', userId: 'u1', userName: 'Alice', briefingId: 'b1' });
            expect(presenceStoreMock.setBriefingEdit).toHaveBeenLastCalledWith(
                expect.objectContaining({ userId: 'u1', briefingId: 'b1', editing: false }),
            );
        });
    });

    // ===== Outbound awareness (cases C/D/F) =====
    describe('outbound awareness — bus + state triggers', () => {
        beforeEach(() => {
            startPresence({ map });
        });

        it('case C: re-announces the current map on MAP_LOCK_CHANGED via a positionless cursor', () => {
            fireBus(EventTypes.MAP_LOCK_CHANGED, { mapName: 'mapa-1', locked: false });
            expect(wsClientMock.sendCursor).toHaveBeenCalledWith({ position: null, mapId: 'mapa-1', surface: '2d' });
        });

        it('O INSTANTE DA LINHA DO TEMPO NÃO VIAJA, e a ponte nem assina o evento (dono, 2026-09-21)', () => {
            // A ponte não tem assinante de TEMPORAL_CURSOR_CHANGED, então disparar o evento (e
            // deixar toda janela de estrangulamento fechar) não produz envio nenhum. Se alguém
            // religar o envio, o duplo do socket não tem o método e a chamada LANÇA aqui.
            expect(busHandlers.__bus?.[EventTypes.TEMPORAL_CURSOR_CHANGED]?.size ?? 0).toBe(0);
            fireBus(EventTypes.TEMPORAL_CURSOR_CHANGED, { cursor: 3 });
            vi.advanceTimersByTime(200);
            expect(wsClientMock.sendCursor).not.toHaveBeenCalled();
            expect(wsClientMock.sendSelection).not.toHaveBeenCalled();

            // PISO: o MESMO barramento continua carregando o caso C, então a ausência acima é do
            // quadro removido e não de um barramento morto neste teste.
            fireBus(EventTypes.MAP_LOCK_CHANGED, { mapName: 'mapa-1', locked: false });
            expect(wsClientMock.sendCursor).toHaveBeenCalledWith({ position: null, mapId: 'mapa-1', surface: '2d' });
        });

        it('case D: forwards briefing edit start/end to the ws client', () => {
            fireBus(EventTypes.BRIEFING_EDIT_STARTED, { briefingId: 'b1' });
            expect(wsClientMock.sendBriefingEditStart).toHaveBeenCalledWith('b1');

            fireBus(EventTypes.BRIEFING_EDIT_ENDED, { briefingId: 'b1' });
            expect(wsClientMock.sendBriefingEditEnd).toHaveBeenCalledWith('b1');
        });

        it('case F: subscribes to selection.features and sends the live selection on change', () => {
            expect(stateManagerMock.subscribe).toHaveBeenCalledWith('selection.features', expect.any(Function));

            stateManagerMock._selected = [
                { type: 'point', id: 'f1' },
                { type: 'line', id: 'f2' },
            ];
            stateManagerMock._fireSelection();

            // 2D selection frame now carries the surface + per-feature type (featureMeta)
            // so a peer can rebuild the highlight without a store lookup.
            expect(wsClientMock.sendSelection).toHaveBeenCalledWith({
                surface: '2d',
                featureIds: ['f1', 'f2'],
                featureMeta: [
                    { id: 'f1', type: 'point' },
                    { id: 'f2', type: 'line' },
                ],
                mapId: 'mapa-1',
            });
        });

        // Selecao por caixa: `selection.features` muda UMA VEZ POR FEICAO, e cada quadro leva a
        // selecao INTEIRA. Medido em 2026-09-24 no Chromium: 4 000 pontos selecionados por caixa
        // mandavam 4 000 quadros e 782 MB; 1 000 mandavam 48 MB. A rajada vira o quadro de ponta
        // mais um de arrasto por janela, e o de arrasto leva a selecao como ela esta no fim.
        it('case F: a burst of selection changes sends the leading frame and ONE trailing frame', () => {
            wsClientMock.sendSelection.mockClear();
            for (let i = 1; i <= 1000; i++) {
                stateManagerMock._selected = Array.from({ length: i }, (_, k) => ({ type: 'point', id: `f${k}` }));
                stateManagerMock._fireSelection();
            }
            expect(wsClientMock.sendSelection).toHaveBeenCalledTimes(1);
            expect(wsClientMock.sendSelection.mock.calls[0][0].featureIds).toEqual(['f0']);

            vi.advanceTimersByTime(100);
            expect(wsClientMock.sendSelection).toHaveBeenCalledTimes(2);
            expect(wsClientMock.sendSelection.mock.calls[1][0].featureIds).toHaveLength(1000);

            // A janela seguinte, sem mudanca nova, nao manda nada.
            vi.advanceTimersByTime(1000);
            expect(wsClientMock.sendSelection).toHaveBeenCalledTimes(2);
        });

        it('case F: stopping presence cancels a pending trailing selection frame', () => {
            wsClientMock.sendSelection.mockClear();
            stateManagerMock._selected = [{ type: 'point', id: 'a' }];
            stateManagerMock._fireSelection();
            stateManagerMock._selected = [{ type: 'point', id: 'a' }, { type: 'point', id: 'b' }];
            stateManagerMock._fireSelection();
            expect(wsClientMock.sendSelection).toHaveBeenCalledTimes(1);
            stopPresence();
            vi.advanceTimersByTime(500);
            expect(wsClientMock.sendSelection).toHaveBeenCalledTimes(1);
        });

        it('does not send awareness frames while the socket is disconnected', () => {
            wsClientMock.isConnected.mockReturnValue(false);
            fireBus(EventTypes.MAP_LOCK_CHANGED, { mapName: 'mapa-1' });
            fireBus(EventTypes.BRIEFING_EDIT_STARTED, { briefingId: 'b1' });
            stateManagerMock._selected = [{ type: 'point', id: 'f1' }];
            stateManagerMock._fireSelection();

            expect(wsClientMock.sendCursor).not.toHaveBeenCalled();
            expect(wsClientMock.sendBriefingEditStart).not.toHaveBeenCalled();
            expect(wsClientMock.sendSelection).not.toHaveBeenCalled();
        });
    });

    describe('startPresence — idempotency', () => {
        it('is a no-op on a second start (handlers registered once)', () => {
            startPresence({ map });
            const firstCount = wsClientMock.on.mock.calls.length;
            startPresence({ map });
            expect(wsClientMock.on.mock.calls.length).toBe(firstCount);
            expect(map.on).toHaveBeenCalledTimes(1);
        });
    });

    describe('outbound cursor (mousemove, throttled)', () => {
        beforeEach(() => {
            startPresence({ map });
        });

        it('binds a mousemove listener on the map', () => {
            expect(map.count('mousemove')).toBe(1);
        });

        it('sends the leading move immediately with the active mapId', () => {
            map.fire('mousemove', { lngLat: { lng: 10, lat: 20 } });
            expect(wsClientMock.sendCursor).toHaveBeenCalledTimes(1);
            expect(wsClientMock.sendCursor).toHaveBeenCalledWith({
                position: { lng: 10, lat: 20 },
                mapId: 'mapa-1',
                surface: '2d',
            });
        });

        it('O MOUSE DO VISITANTE NÃO VIAJA, e o mapa ativo dele continua viajando (dono, 2026-09-20)', () => {
            sessionContext.setVisitorSession();
            try {
                map.fire('mousemove', { lngLat: { lng: 10, lat: 20 } });
                expect(wsClientMock.sendCursor).not.toHaveBeenCalled();
                // O quadro SEM posição é o único carregador do mapa ativo: é por ele que a lista
                // de quem está online sabe em que mapa o visitante está.
                fireBus(EventTypes.MAP_LOCK_CHANGED, { mapName: 'mapa-1', locked: false });
                expect(wsClientMock.sendCursor).toHaveBeenCalledWith({ position: null, mapId: 'mapa-1', surface: '2d' });
            } finally {
                sessionContext.clearSession();
            }
            // PISO: fora da visita o mesmo gesto envia, então a recusa acima é do visitante. A janela
            // de estrangulamento precisa passar antes, porque o movimento do visitante a abriu.
            vi.advanceTimersByTime(200);
            wsClientMock.sendCursor.mockClear();
            map.fire('mousemove', { lngLat: { lng: 11, lat: 21 } });
            expect(wsClientMock.sendCursor).toHaveBeenCalledWith({ position: { lng: 11, lat: 21 }, mapId: 'mapa-1', surface: '2d' });
        });

        /**
         * A TAXA NA ORIGEM É NO MÁXIMO 5 POR SEGUNDO (2026-09-23). Cada quadro de cursor chega a
         * todos os colegas da sala, e no link de 40 kbps três colegas mexendo o mouse a 12,5 Hz
         * saturavam o enlace só de cursor (5639 B/s medidos). Uma mão real move o mouse a 60 Hz; o
         * que sai daqui em 10 s cabe em 5 por segundo, e a ÚLTIMA posição sempre sai.
         */
        it('a 60 Hz hand sends at most 5 frames per second, and the last position always goes out', () => {
            let t = 0;
            for (let i = 0; i < 600; i++) {
                map.fire('mousemove', { lngLat: { lng: i, lat: i } });
                vi.advanceTimersByTime(1000 / 60);
                t += 1000 / 60;
            }
            vi.advanceTimersByTime(CURSOR_THROTTLE_MS);
            const sent = wsClientMock.sendCursor.mock.calls.length;
            expect(t).toBeCloseTo(10000, 0);
            expect(sent, 'frames in 10 s').toBeLessThanOrEqual(51);
            expect(sent, 'the cursor still moves').toBeGreaterThanOrEqual(45);
            expect(wsClientMock.sendCursor).toHaveBeenLastCalledWith({
                position: { lng: 599, lat: 599 }, mapId: 'mapa-1', surface: '2d',
            });
        });

        it('throttles bursts to one leading + one trailing send per window', () => {
            map.fire('mousemove', { lngLat: { lng: 1, lat: 1 } }); // leading
            map.fire('mousemove', { lngLat: { lng: 2, lat: 2 } }); // coalesced
            map.fire('mousemove', { lngLat: { lng: 3, lat: 3 } }); // coalesced (latest wins)
            expect(wsClientMock.sendCursor).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(CURSOR_THROTTLE_MS);
            expect(wsClientMock.sendCursor).toHaveBeenCalledTimes(2);
            // The trailing send carries the most recent position.
            expect(wsClientMock.sendCursor).toHaveBeenLastCalledWith({
                position: { lng: 3, lat: 3 },
                mapId: 'mapa-1',
                surface: '2d',
            });
        });

        it('does not send when the socket is disconnected', () => {
            wsClientMock.isConnected.mockReturnValue(false);
            map.fire('mousemove', { lngLat: { lng: 1, lat: 1 } });
            expect(wsClientMock.sendCursor).not.toHaveBeenCalled();
        });

        it('ignores mousemove events without a valid lngLat', () => {
            map.fire('mousemove', {});
            map.fire('mousemove', { lngLat: { lng: 'x', lat: 1 } });
            expect(wsClientMock.sendCursor).not.toHaveBeenCalled();
        });
    });

    // ===== Cursor das superficies imersivas (2026-09-16) =====
    describe('outbound cursor — 360 e 3D', () => {
        beforeEach(() => {
            startPresence({ map });
        });

        it('leva o ponteiro do 360 em coordenada de esfera, escopado pela foto', () => {
            fireBus(EventTypes.CURSOR_360_MOVED, {
                position: { heading: 12.5, pitch: -0.3 }, photoName: 'foto-7',
            });
            expect(wsClientMock.sendCursor).toHaveBeenCalledWith({
                position: { heading: 12.5, pitch: -0.3 },
                mapId: 'mapa-1',
                surface: '360',
                photoName: 'foto-7',
            });
        });

        it('leva o ponteiro do 3D com altura, escopado pelo tileset', () => {
            fireBus(EventTypes.CURSOR_3D_MOVED, {
                position: { lng: -43.1, lat: -22.9, alt: 15.5 }, tilesetId: 'modelo-2',
            });
            expect(wsClientMock.sendCursor).toHaveBeenCalledWith({
                position: { lng: -43.1, lat: -22.9, alt: 15.5 },
                mapId: 'mapa-1',
                surface: '3d',
                tilesetId: 'modelo-2',
            });
        });

        it('leva a saida do ponteiro como quadro sem posicao, e nao como silencio', () => {
            fireBus(EventTypes.CURSOR_360_MOVED, { position: null, photoName: 'foto-7' });
            expect(wsClientMock.sendCursor).toHaveBeenCalledWith({
                position: null, mapId: 'mapa-1', surface: '360', photoName: 'foto-7',
            });
        });

        it('usa a MESMA janela do cursor do mapa: um quadro na frente, um no fim', () => {
            fireBus(EventTypes.CURSOR_360_MOVED, { position: { heading: 1, pitch: 0 }, photoName: 'f1' });
            fireBus(EventTypes.CURSOR_360_MOVED, { position: { heading: 2, pitch: 0 }, photoName: 'f1' });
            fireBus(EventTypes.CURSOR_360_MOVED, { position: { heading: 3, pitch: 0 }, photoName: 'f1' });
            expect(wsClientMock.sendCursor).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(CURSOR_THROTTLE_MS);
            expect(wsClientMock.sendCursor).toHaveBeenCalledTimes(2);
            expect(wsClientMock.sendCursor).toHaveBeenLastCalledWith({
                position: { heading: 3, pitch: 0 }, mapId: 'mapa-1', surface: '360', photoName: 'f1',
            });
        });

        it('O QUADRO ATRASADO SAI COM A SUPERFICIE DELE, e nao com a da ultima chamada', () => {
            // O caso degenerado da janela unica: dois quadros de superficies DIFERENTES na mesma
            // janela. Guardar so a posicao no pendente faria o quadro do 360 sair rotulado como 3D
            // (ou o contrario), e o par desenharia o colega na cena errada.
            fireBus(EventTypes.CURSOR_3D_MOVED, { position: { lng: 1, lat: 2, alt: 3 }, tilesetId: 't1' });
            fireBus(EventTypes.CURSOR_360_MOVED, { position: { heading: 9, pitch: 0.1 }, photoName: 'f9' });

            vi.advanceTimersByTime(CURSOR_THROTTLE_MS);
            expect(wsClientMock.sendCursor).toHaveBeenLastCalledWith({
                position: { heading: 9, pitch: 0.1 }, mapId: 'mapa-1', surface: '360', photoName: 'f9',
            });
        });

        it('nao envia com o socket desconectado', () => {
            wsClientMock.isConnected.mockReturnValue(false);
            fireBus(EventTypes.CURSOR_360_MOVED, { position: { heading: 1, pitch: 0 }, photoName: 'f1' });
            expect(wsClientMock.sendCursor).not.toHaveBeenCalled();
        });
    });

    // CASO V (dono, 2026-09-22): em qual visualizador cada colega está. A ponte manda só o
    // IDENTIFICADOR e só quando o contexto MUDA; o nome é resolvido pelo servidor, por
    // destinatário. E a conexão própria que sai de ONLINE esvazia a lista, porque sem socket
    // ninguém a corrige.
    describe('caso V: contexto de visualizador', () => {
        beforeEach(() => {
            startPresence({ map });
        });

        it('anuncia o modelo 3D aberto, a troca e o fechamento, e só quando muda', () => {
            fireBus(EventTypes.VIEWER_3D_OPENED, { tilesetId: 'museu' });
            expect(wsClientMock.sendViewer).toHaveBeenLastCalledWith({ surface: '3d', tilesetId: 'museu' });
            fireBus(EventTypes.VIEWER_3D_OPENED, { tilesetId: 'museu' });
            expect(wsClientMock.sendViewer).toHaveBeenCalledTimes(1);
            fireBus(EventTypes.VIEWER_3D_OPENED, { tilesetId: 'quartel' });
            expect(wsClientMock.sendViewer).toHaveBeenLastCalledWith({ surface: '3d', tilesetId: 'quartel' });
            fireBus(EventTypes.VIEWER_3D_CLOSED, {});
            expect(wsClientMock.sendViewer).toHaveBeenLastCalledWith({ surface: '2d' });
            expect(wsClientMock.sendViewer).toHaveBeenCalledTimes(3);
        });

        it('o 360 anda de foto em foto, e uma foto que termina de carregar DEPOIS de fechar não reabre', () => {
            fireBus(EventTypes.STREETVIEW_360_OPENED, { photoName: 'f1.jpg' });
            expect(wsClientMock.sendViewer).toHaveBeenLastCalledWith({ surface: '360', photoName: 'f1.jpg' });
            fireBus(EventTypes.STREETVIEW_360_PHOTO_CHANGED, { previousPhoto: 'f1.jpg', currentPhoto: 'f2.jpg' });
            expect(wsClientMock.sendViewer).toHaveBeenLastCalledWith({ surface: '360', photoName: 'f2.jpg' });
            fireBus(EventTypes.STREETVIEW_360_CLOSED, {});
            expect(wsClientMock.sendViewer).toHaveBeenLastCalledWith({ surface: '2d' });
            fireBus(EventTypes.STREETVIEW_360_PHOTO_CHANGED, { previousPhoto: 'f2.jpg', currentPhoto: 'f3.jpg' });
            expect(wsClientMock.sendViewer).toHaveBeenLastCalledWith({ surface: '2d' });
            expect(wsClientMock.sendViewer).toHaveBeenCalledTimes(3);
        });

        it('a cena caminhável fica POR CIMA do 3D, e fechá-la volta ao modelo aberto embaixo', () => {
            fireBus(EventTypes.VIEWER_3D_OPENED, { tilesetId: 'museu' });
            fireBus(EventTypes.FIRST_PERSON_OPENED, { sceneId: 'cena-1' });
            expect(wsClientMock.sendViewer).toHaveBeenLastCalledWith({ surface: 'fp', tilesetId: 'cena-1' });
            fireBus(EventTypes.FIRST_PERSON_CLOSED, { sceneId: 'cena-1' });
            expect(wsClientMock.sendViewer).toHaveBeenLastCalledWith({ surface: '3d', tilesetId: 'museu' });
        });

        it('um socket novo re-anuncia o visualizador aberto, e o mapa não precisa ser dito', () => {
            wsHandlers.connected({ usersOnline: [] });
            expect(wsClientMock.sendViewer).not.toHaveBeenCalled();
            fireBus(EventTypes.VIEWER_3D_OPENED, { tilesetId: 'museu' });
            wsClientMock.sendViewer.mockClear();
            wsHandlers.connected({ usersOnline: [] });
            expect(wsClientMock.sendViewer).toHaveBeenCalledWith({ surface: '3d', tilesetId: 'museu' });
        });

        it('sem socket não envia, e o contexto sai assim que o socket volta', () => {
            wsClientMock.isConnected.mockReturnValue(false);
            fireBus(EventTypes.VIEWER_3D_OPENED, { tilesetId: 'museu' });
            expect(wsClientMock.sendViewer).not.toHaveBeenCalled();
            wsClientMock.isConnected.mockReturnValue(true);
            wsHandlers.connected({ usersOnline: [] });
            expect(wsClientMock.sendViewer).toHaveBeenCalledWith({ surface: '3d', tilesetId: 'museu' });
        });

        it('o VISITANTE de link público não anuncia visualizador nenhum', () => {
            const spy = vi.spyOn(sessionContext, 'isVisitor').mockReturnValue(true);
            try {
                fireBus(EventTypes.VIEWER_3D_OPENED, { tilesetId: 'museu' });
                wsHandlers.connected({ usersOnline: [] });
                expect(wsClientMock.sendViewer).not.toHaveBeenCalled();
            } finally {
                spy.mockRestore();
            }
        });

        it("roteia o quadro 'viewer_context' para presenceStore.setViewer", () => {
            const msg = { type: 'viewer_context', clientId: 'c1', userId: 'u1', viewer: { surface: '3d', recurso: null } };
            wsHandlers.viewerContext(msg);
            expect(presenceStoreMock.setViewer).toHaveBeenCalledWith(msg);
        });

        it('a conexão própria que sai de ONLINE esvazia a lista; a que ENTRA em ONLINE não', () => {
            fireBus(EventTypes.CONNECTION_STATE_CHANGED, { previousState: 'online', currentState: 'reconnecting' });
            expect(presenceStoreMock.clear).toHaveBeenCalledTimes(1);
            fireBus(EventTypes.CONNECTION_STATE_CHANGED, { previousState: 'connecting', currentState: 'online' });
            expect(presenceStoreMock.clear).toHaveBeenCalledTimes(1);
            fireBus(EventTypes.CONNECTION_STATE_CHANGED, { previousState: 'online', currentState: 'offline' });
            expect(presenceStoreMock.clear).toHaveBeenCalledTimes(2);
        });
    });

    describe('stopPresence', () => {
        it('unbinds the map listener and clears the store', () => {
            startPresence({ map });
            stopPresence();
            expect(map.off).toHaveBeenCalledWith('mousemove', expect.any(Function));
            expect(map.count('mousemove')).toBe(0);
            expect(presenceStoreMock.clear).toHaveBeenCalledTimes(1);
        });

        it('detaches the owned WS handlers so they no longer hit the store', () => {
            startPresence({ map });
            stopPresence();
            // After stop, the registered handlers are no-ops; routing is severed.
            wsHandlers.cursor({ userId: 'u1', position: { lng: 1, lat: 2 } });
            wsHandlers.connected({ usersOnline: [{ clientId: 'c1' }] });
            expect(presenceStoreMock.setCursor).not.toHaveBeenCalled();
            expect(presenceStoreMock.setInitial).not.toHaveBeenCalled();
        });

        it('is a no-op when not started', () => {
            stopPresence();
            expect(presenceStoreMock.clear).not.toHaveBeenCalled();
        });

        it('releases the selection.features subscription so it no longer sends outbound', () => {
            startPresence({ map });
            stopPresence();
            // After teardown a selection change must not reach the ws client.
            stateManagerMock._selected = [{ type: 'point', id: 'f1' }];
            stateManagerMock._fireSelection();
            expect(wsClientMock.sendSelection).not.toHaveBeenCalled();
        });

        it('cancels a pending trailing-cursor send', () => {
            startPresence({ map });
            map.fire('mousemove', { lngLat: { lng: 1, lat: 1 } }); // leading
            map.fire('mousemove', { lngLat: { lng: 2, lat: 2 } }); // schedules trailing
            wsClientMock.sendCursor.mockClear();

            stopPresence();
            vi.advanceTimersByTime(CURSOR_THROTTLE_MS);
            expect(wsClientMock.sendCursor).not.toHaveBeenCalled();
        });
    });

    describe('start after stop', () => {
        it('re-wires cleanly (handlers re-registered, throttle reset)', () => {
            startPresence({ map });
            stopPresence();

            const map2 = createFakeMap();
            startPresence({ map: map2 });
            map2.fire('mousemove', { lngLat: { lng: 5, lat: 6 } });
            expect(wsClientMock.sendCursor).toHaveBeenLastCalledWith({
                position: { lng: 5, lat: 6 },
                mapId: 'mapa-1',
                surface: '2d',
            });
        });
    });
});
