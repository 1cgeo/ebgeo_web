// Path: tests/unit/application-mode-manager.test.js

/**
 * @fileoverview Pins `ApplicationModeManager` (`src/js/mode/application-mode.manager.js`):
 * the two enums, the six predicates, `enterMode`/`exitMode`/`setViewerMode`/`reset`,
 * the state stack, and the TWO event names that live OUTSIDE `event_types.js`
 * (`ApplicationModeEvents.MODE_CHANGED` / `VIEWER_MODE_CHANGED`, emitted on the SAME bus).
 *
 * WHAT IT PINS
 * - Emission is asserted through a recording bus injected by mocking `@store/services.js`
 *   (`getEventBus`), so "did not emit" is a real assertion and not an absence of setup.
 * - Every case that says "no event" also asserts the recorded call count, and every case
 *   that sweeps a collection asserts that collection's SIZE first (empty sweeps pass green).
 * - The singleton pair (`getApplicationModeManager` / `createApplicationModeManager`) is
 *   re-created per test with `vi.resetModules()` + dynamic import; module-level `instance`
 *   would otherwise leak state between cases.
 *
 * WHAT IT DOES NOT REACH
 * - The UI side of a mode change: this module only emits; who listens (`ui-visibility`,
 *   the briefing presenter, the toolbars) is not exercised here.
 * - `exitMode()`'s "empty stack AND mode !== NORMAL" branch is UNREACHABLE through the
 *   public API (`enterMode` always pushes, `exitMode` always pops, `reset` clears both
 *   at once), so it is documented rather than covered.
 * - `getEventBus()` throwing (as opposed to returning a falsy bus) is not modelled.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** Recorded emissions of the fake bus; reset in `beforeEach`. */
let emitted = [];
/** When false, `getEventBus()` returns null (the "services not initialised" shape). */
let busAvailable = true;

vi.mock('@store/services.js', () => ({
    getEventBus: () => (busAvailable
        ? { emit: (type, payload) => { emitted.push({ type, payload }); } }
        : null),
}));

/**
 * Loads a FRESH copy of the module (new singleton slot) and returns its exports.
 * @returns {Promise<object>} module namespace
 */
async function freshModule() {
    vi.resetModules();
    return import('../../src/js/mode/application-mode.manager.js');
}

let warnSpy;

beforeEach(() => {
    emitted = [];
    busAvailable = true;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    warnSpy.mockRestore();
});

describe('ApplicationMode / ViewerMode / ApplicationModeEvents (enums)', () => {
    it('os tres enums sao congelados e tem exatamente os valores do contrato', async () => {
        const { ApplicationMode, ViewerMode, ApplicationModeEvents } = await freshModule();

        expect(Object.isFrozen(ApplicationMode)).toBe(true);
        expect(Object.isFrozen(ViewerMode)).toBe(true);
        expect(Object.isFrozen(ApplicationModeEvents)).toBe(true);

        expect(ApplicationMode).toEqual({
            NORMAL: 'normal',
            BRIEFING_EDIT: 'briefing:edit',
            BRIEFING_PRESENT: 'briefing:present',
        });
        expect(ViewerMode).toEqual({ MAP_2D: '2d', VIEWER_3D: '3d', VIEWER_360: '360' });
        expect(ApplicationModeEvents).toEqual({
            MODE_CHANGED: 'application:modeChanged',
            VIEWER_MODE_CHANGED: 'application:viewerModeChanged',
        });
    });

    it('os dois nomes de evento NAO estao em event_types.js (vocabulario paralelo, mesmo barramento)', async () => {
        const { ApplicationModeEvents } = await freshModule();
        const { EventTypes } = await import('../../src/js/events/event_types.js');

        const known = Object.values(EventTypes);
        // Size assertion first: an empty `known` would make the two `not.toContain` vacuous.
        expect(known.length).toBeGreaterThan(20);
        expect(known).not.toContain(ApplicationModeEvents.MODE_CHANGED);
        expect(known).not.toContain(ApplicationModeEvents.VIEWER_MODE_CHANGED);
    });
});

describe('estado inicial e predicados', () => {
    it('nasce em NORMAL / 2d / contexto null', async () => {
        const { getApplicationModeManager, ApplicationMode, ViewerMode } = await freshModule();
        const m = getApplicationModeManager();

        expect(m.getMode()).toBe(ApplicationMode.NORMAL);
        expect(m.getViewerMode()).toBe(ViewerMode.MAP_2D);
        expect(m.getModeContext()).toBeNull();
        expect(emitted).toHaveLength(0);
    });

    it('INVARIANTE: exatamente UM predicado de modo e UM de viewer sao verdadeiros, em toda combinacao', async () => {
        const mod = await freshModule();
        const { getApplicationModeManager, ApplicationMode, ViewerMode } = mod;
        const m = getApplicationModeManager();

        const modes = Object.values(ApplicationMode);
        const viewers = Object.values(ViewerMode);
        // The sweep below is only worth something if both collections are the expected size.
        expect(modes).toHaveLength(3);
        expect(viewers).toHaveLength(3);

        let combos = 0;
        for (const mode of modes) {
            for (const viewer of viewers) {
                m.reset();
                m.enterMode(mode);
                m.setViewerMode(viewer);
                combos++;

                const modeFlags = [m.isNormalMode(), m.isBriefingEditMode(), m.isBriefingPresentMode()];
                expect(modeFlags.filter(Boolean)).toHaveLength(1);

                const viewerFlags = [m.is2DMapActive(), m.is3DViewerActive(), m.is360ViewerActive()];
                expect(viewerFlags.filter(Boolean)).toHaveLength(1);

                // isBriefingMode is the disjunction of the two briefing predicates.
                expect(m.isBriefingMode()).toBe(mode !== ApplicationMode.NORMAL);
            }
        }
        expect(combos).toBe(9);
    });
});

describe('enterMode', () => {
    it('modo valido troca, empilha o estado anterior e emite MODE_CHANGED com o payload completo', async () => {
        const { getApplicationModeManager, ApplicationMode, ApplicationModeEvents } = await freshModule();
        const m = getApplicationModeManager();

        const ctx = { briefingId: 'b1', slideIndex: 0 };
        expect(m.enterMode(ApplicationMode.BRIEFING_EDIT, ctx)).toBe(true);

        expect(m.getMode()).toBe(ApplicationMode.BRIEFING_EDIT);
        expect(m.getModeContext()).toBe(ctx);
        expect(emitted).toHaveLength(1);
        expect(emitted[0]).toEqual({
            type: ApplicationModeEvents.MODE_CHANGED,
            payload: {
                previousMode: ApplicationMode.NORMAL,
                currentMode: ApplicationMode.BRIEFING_EDIT,
                context: ctx,
            },
        });
    });

    it('EDGE: contexto e guardado POR REFERENCIA (mutacao do chamador vaza para dentro)', async () => {
        const { getApplicationModeManager, ApplicationMode } = await freshModule();
        const m = getApplicationModeManager();

        const ctx = { slideIndex: 0 };
        m.enterMode(ApplicationMode.BRIEFING_PRESENT, ctx);
        ctx.slideIndex = 7;

        expect(m.getModeContext().slideIndex).toBe(7);
    });

    it('EDGE: contexto omitido vira null, mas 0 e false sao PRESERVADOS (sem `|| padrao`)', async () => {
        const { getApplicationModeManager, ApplicationMode } = await freshModule();
        const m = getApplicationModeManager();

        m.enterMode(ApplicationMode.BRIEFING_EDIT);
        expect(m.getModeContext()).toBeNull();

        m.reset();
        m.enterMode(ApplicationMode.BRIEFING_EDIT, 0);
        expect(m.getModeContext()).toBe(0);

        m.reset();
        m.enterMode(ApplicationMode.BRIEFING_EDIT, false);
        expect(m.getModeContext()).toBe(false);

        // `undefined` passed explicitly falls back to the default parameter.
        m.reset();
        m.enterMode(ApplicationMode.BRIEFING_EDIT, undefined);
        expect(m.getModeContext()).toBeNull();
    });

    it('modo invalido devolve false, avisa, nao empilha e NAO emite', async () => {
        const { getApplicationModeManager, ApplicationMode } = await freshModule();
        const m = getApplicationModeManager();

        const invalidos = ['briefing', 'NORMAL', '', null, undefined, 0, {}, 'normal ', 'Normal'];
        expect(invalidos).toHaveLength(9);

        for (const bad of invalidos) {
            expect(m.enterMode(bad)).toBe(false);
        }

        expect(m.getMode()).toBe(ApplicationMode.NORMAL);
        expect(m.getModeContext()).toBeNull();
        expect(emitted).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledTimes(9);

        // Nothing was pushed: exitMode from NORMAL with an empty stack is a no-op.
        expect(m.exitMode()).toBe(false);
        expect(emitted).toHaveLength(0);
    });

    it('mesmo modo devolve false MAS sobrescreve o contexto, sem empilhar e sem emitir', async () => {
        const { getApplicationModeManager, ApplicationMode } = await freshModule();
        const m = getApplicationModeManager();

        m.enterMode(ApplicationMode.BRIEFING_EDIT, { a: 1 });
        emitted = [];

        expect(m.enterMode(ApplicationMode.BRIEFING_EDIT, { a: 2 })).toBe(false);
        expect(m.getModeContext()).toEqual({ a: 2 });
        expect(emitted).toHaveLength(0);

        // Only ONE frame was ever pushed (the initial NORMAL), so a single exit empties it.
        expect(m.exitMode()).toBe(true);
        expect(m.getMode()).toBe(ApplicationMode.NORMAL);
        expect(m.exitMode()).toBe(false);
    });

    it('EDGE: o `false` de "modo invalido" e o `false` de "mesmo modo" sao INDISTINGUIVEIS pelo retorno', async () => {
        const { getApplicationModeManager, ApplicationMode } = await freshModule();
        const m = getApplicationModeManager();

        // At boot the app is already in NORMAL, so re-entering it looks exactly like a
        // rejected mode from the call site: both are `false`, both leave the mode alone.
        // The difference (context WAS written) is only visible through getModeContext().
        expect(m.enterMode(ApplicationMode.NORMAL, { ctx: 'gravado' })).toBe(false);
        expect(m.getModeContext()).toEqual({ ctx: 'gravado' });

        expect(m.enterMode('inexistente', { ctx: 'ignorado' })).toBe(false);
        expect(m.getModeContext()).toEqual({ ctx: 'gravado' });
    });

    it('OBSERVADO: entrar em NORMAL vindo de um briefing EMPILHA o briefing, e o proximo exitMode VOLTA para ele', async () => {
        // This is today's behaviour, pinned deliberately: `enterMode(NORMAL)` is not an
        // "exit", it is a transition like any other, so it pushes the briefing frame. A
        // caller that treats it as a way out gets the briefing back on the next exitMode().
        const { getApplicationModeManager, ApplicationMode } = await freshModule();
        const m = getApplicationModeManager();

        m.enterMode(ApplicationMode.BRIEFING_EDIT, { b: 1 });
        expect(m.enterMode(ApplicationMode.NORMAL)).toBe(true);
        expect(m.getMode()).toBe(ApplicationMode.NORMAL);

        expect(m.exitMode()).toBe(true);
        expect(m.getMode()).toBe(ApplicationMode.BRIEFING_EDIT);
        expect(m.getModeContext()).toEqual({ b: 1 });
    });
});

describe('setViewerMode', () => {
    it('viewer valido troca e emite VIEWER_MODE_CHANGED', async () => {
        const { getApplicationModeManager, ViewerMode, ApplicationModeEvents } = await freshModule();
        const m = getApplicationModeManager();

        expect(m.setViewerMode(ViewerMode.VIEWER_360)).toBe(true);
        expect(m.getViewerMode()).toBe(ViewerMode.VIEWER_360);
        expect(emitted).toEqual([{
            type: ApplicationModeEvents.VIEWER_MODE_CHANGED,
            payload: { previousMode: ViewerMode.MAP_2D, currentMode: ViewerMode.VIEWER_360 },
        }]);
    });

    it('viewer invalido devolve false, avisa e nao muta; viewer igual devolve false sem emitir', async () => {
        const { getApplicationModeManager, ViewerMode } = await freshModule();
        const m = getApplicationModeManager();

        const invalidos = ['2D', 'map', '', null, undefined, 2, '360 '];
        expect(invalidos).toHaveLength(7);
        for (const bad of invalidos) {
            expect(m.setViewerMode(bad)).toBe(false);
        }
        expect(m.getViewerMode()).toBe(ViewerMode.MAP_2D);
        expect(emitted).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledTimes(7);

        // Same value: rejected too, and silently (no warn, no emit).
        warnSpy.mockClear();
        expect(m.setViewerMode(ViewerMode.MAP_2D)).toBe(false);
        expect(warnSpy).not.toHaveBeenCalled();
        expect(emitted).toHaveLength(0);
    });

    it('EDGE: o viewer NAO e empilhado por si so; so entra na pilha junto de um enterMode', async () => {
        const { getApplicationModeManager, ApplicationMode, ViewerMode } = await freshModule();
        const m = getApplicationModeManager();

        // Change the viewer BEFORE any mode transition: the frame pushed later carries 3d,
        // so exiting restores 3d and not the 2d the app booted with.
        m.setViewerMode(ViewerMode.VIEWER_3D);
        m.enterMode(ApplicationMode.BRIEFING_PRESENT);
        m.setViewerMode(ViewerMode.VIEWER_360);

        expect(m.exitMode()).toBe(true);
        expect(m.getViewerMode()).toBe(ViewerMode.VIEWER_3D);
    });
});

describe('exitMode', () => {
    it('ROUND-TRIP: enter + troca de viewer + exit devolve o instantaneo inicial', async () => {
        const { getApplicationModeManager, ApplicationMode, ViewerMode, ApplicationModeEvents } = await freshModule();
        const m = getApplicationModeManager();

        const antes = { mode: m.getMode(), viewer: m.getViewerMode(), ctx: m.getModeContext() };

        m.enterMode(ApplicationMode.BRIEFING_PRESENT, { slide: 3 });
        m.setViewerMode(ViewerMode.VIEWER_3D);
        emitted = [];

        expect(m.exitMode()).toBe(true);
        expect({ mode: m.getMode(), viewer: m.getViewerMode(), ctx: m.getModeContext() }).toEqual(antes);

        // Both events fire, mode first then viewer.
        expect(emitted.map((e) => e.type)).toEqual([
            ApplicationModeEvents.MODE_CHANGED,
            ApplicationModeEvents.VIEWER_MODE_CHANGED,
        ]);
        expect(emitted[1].payload).toEqual({
            previousMode: ViewerMode.VIEWER_3D,
            currentMode: ViewerMode.MAP_2D,
        });
    });

    it('pilha aninhada: dois enters exigem dois exits, na ordem inversa', async () => {
        const { getApplicationModeManager, ApplicationMode } = await freshModule();
        const m = getApplicationModeManager();

        m.enterMode(ApplicationMode.BRIEFING_EDIT, { nivel: 1 });
        m.enterMode(ApplicationMode.BRIEFING_PRESENT, { nivel: 2 });

        expect(m.exitMode()).toBe(true);
        expect(m.getMode()).toBe(ApplicationMode.BRIEFING_EDIT);
        expect(m.getModeContext()).toEqual({ nivel: 1 });

        expect(m.exitMode()).toBe(true);
        expect(m.getMode()).toBe(ApplicationMode.NORMAL);
        expect(m.getModeContext()).toBeNull();

        expect(m.exitMode()).toBe(false);
    });

    it('EDGE: exit que restaura o MESMO modo (viewer diferente) emite so o evento de viewer', async () => {
        const { getApplicationModeManager, ApplicationMode, ViewerMode, ApplicationModeEvents } = await freshModule();
        const m = getApplicationModeManager();

        // NORMAL -> NORMAL is impossible via enterMode (same-mode short-circuits), so build
        // the case with two frames: EDIT -> NORMAL (pushes EDIT) -> exit lands on EDIT.
        m.enterMode(ApplicationMode.BRIEFING_EDIT);
        m.enterMode(ApplicationMode.BRIEFING_PRESENT);
        m.exitMode(); // back to EDIT, stack still holds the NORMAL frame
        m.setViewerMode(ViewerMode.VIEWER_360);
        emitted = [];

        expect(m.exitMode()).toBe(true);
        expect(m.getMode()).toBe(ApplicationMode.NORMAL);
        expect(emitted.map((e) => e.type)).toEqual([
            ApplicationModeEvents.MODE_CHANGED,
            ApplicationModeEvents.VIEWER_MODE_CHANGED,
        ]);
    });

    it('EDGE: exit com pilha vazia em NORMAL nao mexe no viewer, mesmo fora do 2d', async () => {
        const { getApplicationModeManager, ViewerMode } = await freshModule();
        const m = getApplicationModeManager();

        m.setViewerMode(ViewerMode.VIEWER_3D);
        emitted = [];

        expect(m.exitMode()).toBe(false);
        expect(m.getViewerMode()).toBe(ViewerMode.VIEWER_3D);
        expect(emitted).toHaveLength(0);
    });
});

describe('reset', () => {
    it('volta a NORMAL/2d, limpa contexto e pilha, e emite os dois eventos', async () => {
        const { getApplicationModeManager, ApplicationMode, ViewerMode, ApplicationModeEvents } = await freshModule();
        const m = getApplicationModeManager();

        m.enterMode(ApplicationMode.BRIEFING_PRESENT, { x: 1 });
        m.setViewerMode(ViewerMode.VIEWER_360);
        emitted = [];

        expect(m.reset()).toBeUndefined();
        expect(m.getMode()).toBe(ApplicationMode.NORMAL);
        expect(m.getViewerMode()).toBe(ViewerMode.MAP_2D);
        expect(m.getModeContext()).toBeNull();
        expect(emitted.map((e) => e.type)).toEqual([
            ApplicationModeEvents.MODE_CHANGED,
            ApplicationModeEvents.VIEWER_MODE_CHANGED,
        ]);

        // Stack cleared: nothing left to restore.
        expect(m.exitMode()).toBe(false);
    });

    it('reset ja em NORMAL/2d nao emite nada (idempotente)', async () => {
        const { getApplicationModeManager } = await freshModule();
        const m = getApplicationModeManager();

        m.reset();
        m.reset();
        expect(emitted).toHaveLength(0);
    });

    it('EDGE: reset limpa a pilha, entao um exit logo depois NAO ressuscita o briefing', async () => {
        const { getApplicationModeManager, ApplicationMode } = await freshModule();
        const m = getApplicationModeManager();

        m.enterMode(ApplicationMode.BRIEFING_EDIT);
        m.enterMode(ApplicationMode.BRIEFING_PRESENT);
        m.reset();

        expect(m.exitMode()).toBe(false);
        expect(m.getMode()).toBe(ApplicationMode.NORMAL);
    });
});

describe('barramento ausente e singleton', () => {
    it('sem EventBus (services nao inicializados) as transicoes ocorrem sem lancar', async () => {
        const { getApplicationModeManager, ApplicationMode, ViewerMode } = await freshModule();
        const m = getApplicationModeManager();
        busAvailable = false;

        expect(() => {
            m.enterMode(ApplicationMode.BRIEFING_EDIT);
            m.setViewerMode(ViewerMode.VIEWER_3D);
            m.exitMode();
            m.enterMode(ApplicationMode.BRIEFING_PRESENT);
            m.reset();
        }).not.toThrow();

        expect(emitted).toHaveLength(0);
        expect(m.getMode()).toBe(ApplicationMode.NORMAL);
    });

    it('getApplicationModeManager e um singleton preguicoso e estavel', async () => {
        const { getApplicationModeManager } = await freshModule();
        expect(getApplicationModeManager()).toBe(getApplicationModeManager());
    });

    it('createApplicationModeManager NAO lanca no segundo uso: avisa e devolve a instancia existente (o JSDoc dizia que lancava, e foi a PROSA que se corrigiu)', async () => {
        const { getApplicationModeManager, createApplicationModeManager, ApplicationMode } = await freshModule();

        const primeira = getApplicationModeManager();
        primeira.enterMode(ApplicationMode.BRIEFING_EDIT);
        warnSpy.mockClear();

        const segunda = createApplicationModeManager();

        expect(segunda).toBe(primeira);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        // The state of the first instance survives: it is NOT a fresh manager.
        expect(segunda.getMode()).toBe(ApplicationMode.BRIEFING_EDIT);
    });

    it('create antes de qualquer get cria a instancia que o get devolve depois', async () => {
        const { getApplicationModeManager, createApplicationModeManager } = await freshModule();
        const criada = createApplicationModeManager();
        expect(getApplicationModeManager()).toBe(criada);
        expect(warnSpy).not.toHaveBeenCalled();
    });
});
