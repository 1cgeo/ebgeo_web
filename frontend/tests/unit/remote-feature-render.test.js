// Path: tests/unit/remote-feature-render.test.js

/**
 * Regression — bug E: a peer's remote feature op is applied to the STORE (and emits
 * FEATURE_CREATED/MODIFIED/DELETED) but nothing repopulated the MapLibre sources, so a
 * synced feature was invisible on the 2D map / features tree until a base-layer switch.
 * wireRemoteFeatureRender() bridges that: a debounced source refresh on those events.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { busMock, registry } = vi.hoisted(() => {
    const reg = {};
    return {
        registry: reg,
        busMock: {
            on: vi.fn((evt, handler) => { (reg[evt] ||= new Set()).add(handler); }),
            off: vi.fn((evt, handler) => { reg[evt]?.delete(handler); }),
            emit: vi.fn(),
        },
    };
});

vi.mock('../../src/js/store/services.js', () => ({ getEventBus: () => busMock }));

import { wireRemoteFeatureRender } from '../../src/js/layers/remote-feature-render.js';
import { EventTypes } from '../../src/js/events/event_types.js';

function fire(evt) {
    for (const handler of registry[evt] || []) handler();
}

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

beforeEach(() => {
    for (const k of Object.keys(registry)) delete registry[k];
    vi.clearAllMocks();
});

describe('wireRemoteFeatureRender (bug E)', () => {
    it('subscribes to the remote-only feature events', () => {
        wireRemoteFeatureRender(vi.fn());
        expect(busMock.on).toHaveBeenCalledWith(EventTypes.FEATURE_CREATED, expect.any(Function));
        expect(busMock.on).toHaveBeenCalledWith(EventTypes.FEATURE_MODIFIED, expect.any(Function));
        expect(busMock.on).toHaveBeenCalledWith(EventTypes.FEATURE_DELETED, expect.any(Function));
        // A snapshot (initial open / reconnect) refreshes the source via MAP_MODIFIED.
        expect(busMock.on).toHaveBeenCalledWith(EventTypes.MAP_MODIFIED, expect.any(Function));
    });

    it('refreshes the map sources when a remote feature CREATE arrives', async () => {
        const refresh = vi.fn();
        let scheduled = null;
        const scheduler = (fn) => { scheduled = fn; return 'token'; };

        wireRemoteFeatureRender(refresh, { scheduler });
        fire(EventTypes.FEATURE_CREATED);

        expect(refresh).not.toHaveBeenCalled(); // debounced — not yet
        scheduled();                            // fire the debounce timer
        await flush();
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('also refreshes on remote MODIFY and DELETE', async () => {
        for (const evt of [EventTypes.FEATURE_MODIFIED, EventTypes.FEATURE_DELETED]) {
            for (const k of Object.keys(registry)) delete registry[k];
            const refresh = vi.fn();
            let scheduled = null;
            wireRemoteFeatureRender(refresh, { scheduler: (fn) => { scheduled = fn; return 1; } });
            fire(evt);
            scheduled();
            await flush();
            expect(refresh).toHaveBeenCalledTimes(1);
        }
    });

    it('coalesces a burst of remote ops into a SINGLE refresh (debounce)', async () => {
        const refresh = vi.fn();
        let scheduled = null;
        let scheduleCount = 0;
        const scheduler = (fn) => { scheduled = fn; scheduleCount++; return 1; };

        wireRemoteFeatureRender(refresh, { scheduler });
        fire(EventTypes.FEATURE_CREATED);
        fire(EventTypes.FEATURE_MODIFIED);
        fire(EventTypes.FEATURE_DELETED);

        expect(scheduleCount).toBe(1); // only one timer armed for the whole burst
        scheduled();
        await flush();
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('re-arms after a refresh completes (next remote op refreshes again)', async () => {
        const refresh = vi.fn();
        let scheduled = null;
        const scheduler = (fn) => { scheduled = fn; return 1; };

        wireRemoteFeatureRender(refresh, { scheduler });
        fire(EventTypes.FEATURE_CREATED);
        scheduled();
        await flush();
        fire(EventTypes.FEATURE_MODIFIED); // a later op
        scheduled();
        await flush();
        expect(refresh).toHaveBeenCalledTimes(2);
    });

    it('unwire stops further refreshes', async () => {
        const refresh = vi.fn();
        let scheduled = null;
        const unwire = wireRemoteFeatureRender(refresh, { scheduler: (fn) => { scheduled = fn; return 1; } });

        unwire();
        fire(EventTypes.FEATURE_CREATED);

        expect(scheduled).toBeNull(); // handler unsubscribed → never scheduled
        expect(busMock.off).toHaveBeenCalledTimes(4); // FEATURE_CREATED/MODIFIED/DELETED + MAP_MODIFIED
    });
});

/**
 * A rajada de operacoes remotas pagava UMA reconstrucao inteira por operacao: com o mapa grande,
 * aplicar uma op leva mais que os 80 ms do debounce, e nada impedia uma segunda reconstrucao de
 * comecar com a primeira rodando. Medido em 2026-09-23 no Chromium, 300 criacoes remotas num mapa
 * de 3 000 pontos: 161 a 220 reconstrucoes e 33 a 45 s para convergir; com o espacamento aplicado
 * a todo agendamento (primeira versao), 45 a 52 e 16 a 24 s. Os casos contam agendamentos, nao relogio.
 */
describe('wireRemoteFeatureRender: rajada longa', () => {
    const deferred = () => {
        let resolve;
        const promise = new Promise((r) => { resolve = r; });
        return { promise, resolve };
    };
    const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

    it('nunca sobrepoe duas reconstrucoes: o evento no meio de uma agenda UMA depois dela', async () => {
        const pending = deferred();
        const refresh = vi.fn(() => pending.promise);
        const armed = [];
        wireRemoteFeatureRender(refresh, { scheduler: (fn, ms) => { armed.push({ fn, ms }); return armed.length; } });

        fire(EventTypes.FEATURE_CREATED);
        expect(armed).toHaveLength(1);
        armed[0].fn();
        await settle();
        expect(refresh).toHaveBeenCalledTimes(1);

        // Varios eventos enquanto a reconstrucao roda: nenhum timer novo.
        for (let i = 0; i < 20; i++) fire(EventTypes.FEATURE_CREATED);
        expect(armed).toHaveLength(1);

        pending.resolve();
        await settle();
        // Exatamente UMA reconstrucao a mais, para desenhar o que chegou durante a anterior.
        expect(armed).toHaveLength(2);
        armed[1].fn();
        await settle();
        expect(refresh).toHaveBeenCalledTimes(2);
    });

    it('sem evento durante a reconstrucao, nada mais e agendado', async () => {
        const refresh = vi.fn();
        const armed = [];
        wireRemoteFeatureRender(refresh, { scheduler: (fn, ms) => { armed.push({ fn, ms }); return 1; } });
        fire(EventTypes.FEATURE_MODIFIED);
        armed[0].fn();
        await settle();
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(armed).toHaveLength(1);
    });

    it('so a reconstrucao de arrasto espera o custo da anterior; o evento isolado espera o debounce', async () => {
        let clock = 0;
        const pending = deferred();
        const refresh = vi.fn(() => { clock += 300; return pending.promise; });
        const armed = [];
        wireRemoteFeatureRender(refresh, {
            now: () => clock,
            scheduler: (fn, ms) => { armed.push({ fn, ms }); return armed.length; },
        });

        fire(EventTypes.FEATURE_CREATED);
        expect(armed[0].ms).toBe(80);
        armed[0].fn();
        await settle();
        // Evento DURANTE a reconstrucao de 300 ms: a de arrasto espera 300.
        fire(EventTypes.FEATURE_CREATED);
        pending.resolve();
        await settle();
        expect(armed[1].ms).toBe(300);
        armed[1].fn();
        await settle();

        // Sem evento durante a reconstrucao, o proximo evento isolado volta ao debounce, mesmo
        // depois de uma reconstrucao cara: a edicao solitaria do colega nao paga o custo da rajada.
        fire(EventTypes.FEATURE_MODIFIED);
        expect(armed[2].ms).toBe(80);
    });

    it('uma reconstrucao que nunca termina nao congela o desenho: o vigia abre a porta', async () => {
        const nunca = new Promise(() => {});
        const refresh = vi.fn(() => nunca);
        const armed = [];
        const vigias = [];
        const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
        wireRemoteFeatureRender(refresh, {
            scheduler: (fn, ms) => { armed.push({ fn, ms }); return armed.length; },
            watchdogScheduler: (fn, ms) => { vigias.push({ fn, ms }); return vigias.length; },
            cancelWatchdog: () => {},
        });
        fire(EventTypes.FEATURE_CREATED);
        armed[0].fn();
        await settle();
        expect(vigias[0].ms).toBe(5000);

        // A foto do colega pendurou o GET do blob; as edicoes seguintes chegam.
        fire(EventTypes.FEATURE_MODIFIED);
        expect(armed).toHaveLength(1);
        vigias[0].fn();
        // A porta abriu, e a edicao que chegou durante a espera ganha a sua reconstrucao, no debounce.
        expect(armed).toHaveLength(2);
        expect(armed[1].ms).toBe(80);
        armed[1].fn();
        await settle();
        expect(refresh).toHaveBeenCalledTimes(2);
        aviso.mockRestore();
    });

    it('o termino tardio da reconstrucao pendurada nao abre a porta da seguinte', async () => {
        const primeira = deferred();
        const segunda = deferred();
        const refresh = vi.fn().mockReturnValueOnce(primeira.promise).mockReturnValueOnce(segunda.promise);
        const armed = [];
        const vigias = [];
        const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
        wireRemoteFeatureRender(refresh, {
            scheduler: (fn, ms) => { armed.push({ fn, ms }); return armed.length; },
            watchdogScheduler: (fn, ms) => { vigias.push({ fn, ms }); return vigias.length; },
            cancelWatchdog: () => {},
        });
        fire(EventTypes.FEATURE_CREATED);
        armed[0].fn();
        await settle();
        vigias[0].fn();
        fire(EventTypes.FEATURE_CREATED);
        armed[1].fn();
        await settle();
        expect(refresh).toHaveBeenCalledTimes(2);

        primeira.resolve();
        await settle();
        // A segunda ainda segura a porta: evento novo so marca sujo, nao arma timer.
        fire(EventTypes.FEATURE_CREATED);
        expect(armed).toHaveLength(2);
        segunda.resolve();
        await settle();
        expect(armed).toHaveLength(3);
        aviso.mockRestore();
    });

    it('a reconstrucao superada que termina tarde agenda uma nova, porque pintou uma lista velha', async () => {
        // O cenario da revisao: A leu as feicoes (com a foto P) e travou no blob; o vigia abriu a
        // porta; um colega apagou P; B desenhou sem P; A termina e faz setData com a lista antiga.
        const primeira = deferred();
        const refresh = vi.fn().mockReturnValueOnce(primeira.promise).mockReturnValue(undefined);
        const armed = [];
        const vigias = [];
        const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
        wireRemoteFeatureRender(refresh, {
            scheduler: (fn, ms) => { armed.push({ fn, ms }); return armed.length; },
            watchdogScheduler: (fn, ms) => { vigias.push({ fn, ms }); return vigias.length; },
            cancelWatchdog: () => {},
        });
        fire(EventTypes.FEATURE_CREATED);
        armed[0].fn();
        await settle();
        vigias[0].fn();
        fire(EventTypes.FEATURE_DELETED);
        armed[1].fn();
        await settle();
        expect(refresh).toHaveBeenCalledTimes(2);
        expect(armed).toHaveLength(2);

        primeira.resolve();
        await settle();
        // Nenhum evento novo, e mesmo assim uma reconstrucao e agendada para repintar do store.
        expect(armed).toHaveLength(3);
        expect(armed[2].ms).toBe(80);
        armed[2].fn();
        await settle();
        expect(refresh).toHaveBeenCalledTimes(3);
        aviso.mockRestore();
    });

    it('desligar cancela o timer pendente e o vigia da reconstrucao em curso', async () => {
        const pending = deferred();
        const refresh = vi.fn(() => pending.promise);
        const armed = [];
        const cancelados = [];
        const vigiasCancelados = [];
        const unwire = wireRemoteFeatureRender(refresh, {
            scheduler: (fn, ms) => { armed.push({ fn, ms }); return `timer-${armed.length}`; },
            cancelScheduled: (handle) => { cancelados.push(handle); },
            watchdogScheduler: () => 'vigia-1',
            cancelWatchdog: (handle) => { vigiasCancelados.push(handle); },
        });
        fire(EventTypes.FEATURE_CREATED);
        armed[0].fn();
        await settle();
        unwire();
        expect(vigiasCancelados).toEqual(['vigia-1']);

        const outro = wireRemoteFeatureRender(vi.fn(), {
            scheduler: (fn, ms) => { armed.push({ fn, ms }); return 'timer-pendente'; },
            cancelScheduled: (handle) => { cancelados.push(handle); },
            watchdogScheduler: () => 'v',
            cancelWatchdog: () => {},
        });
        fire(EventTypes.FEATURE_MODIFIED);
        outro();
        expect(cancelados).toContain('timer-pendente');
        pending.resolve();
        await settle();
    });

    it('a espera de arrasto tem teto: uma reconstrucao de 160 s nao adia a seguinte por 160 s', async () => {
        let clock = 0;
        const lenta = deferred();
        const refresh = vi.fn(() => { clock += 160000; return lenta.promise; });
        const armed = [];
        wireRemoteFeatureRender(refresh, {
            now: () => clock,
            scheduler: (fn, ms) => { armed.push({ fn, ms }); return armed.length; },
            watchdogScheduler: () => 0,
            cancelWatchdog: () => {},
        });
        fire(EventTypes.FEATURE_CREATED);
        armed[0].fn();
        await settle();
        fire(EventTypes.FEATURE_CREATED);
        lenta.resolve();
        await settle();
        expect(armed[1].ms).toBe(2000);
    });

    it('a reconstrucao que falha nao trava as seguintes', async () => {
        const refresh = vi.fn(() => Promise.reject(new Error('falhou')));
        const armed = [];
        const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
        wireRemoteFeatureRender(refresh, { scheduler: (fn, ms) => { armed.push({ fn, ms }); return 1; } });
        fire(EventTypes.FEATURE_CREATED);
        armed[0].fn();
        await settle();
        fire(EventTypes.FEATURE_CREATED);
        expect(armed).toHaveLength(2);
        erro.mockRestore();
    });

    it('depois de desligar, o fim de uma reconstrucao em curso nao agenda outra', async () => {
        const pending = deferred();
        const refresh = vi.fn(() => pending.promise);
        const armed = [];
        const unwire = wireRemoteFeatureRender(refresh, { scheduler: (fn, ms) => { armed.push({ fn, ms }); return 1; } });
        fire(EventTypes.FEATURE_CREATED);
        armed[0].fn();
        await settle();
        fire(EventTypes.FEATURE_CREATED);
        unwire();
        pending.resolve();
        await settle();
        expect(armed).toHaveLength(1);
    });
});
