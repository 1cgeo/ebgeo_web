// Path: tests/unit/ui-visibility-controller.test.js

/**
 * @fileoverview Pins `UIVisibilityController` (`src/js/ui/ui-visibility.controller.js`):
 * the element/profile enums, the SEVEN built-in profile tables, `register`/`unregister`,
 * `applyProfile`, the per-element overrides (`showElement`/`hideElement`/`toggleElement`),
 * `defineProfile`, and `UIVisibilityEvents.PROFILE_CHANGED` (a third event vocabulary that
 * lives OUTSIDE `event_types.js` while riding the SAME bus).
 *
 * WHAT IT PINS
 * - The structural invariant that makes the profiles work at all: EVERY built-in profile
 *   assigns EVERY `UIElement`. There is NO inheritance: an unlisted element simply keeps
 *   whatever state it had, which is the previous profile's, not the normal one. The JSDoc
 *   used to promise inheritance and the PROSE was the half corrected, because the tables are
 *   only correct by being exhaustive today, so the exhaustiveness is asserted here (with both
 *   collection sizes asserted first).
 * - Callbacks fire only for elements whose state actually CHANGES, verified by call counts
 *   on spies, not by "did not throw".
 * - A NORMAL -> briefing -> NORMAL round trip restores the baseline for all 17 elements.
 *
 * WHAT IT DOES NOT REACH
 * - Anything DOM: registration callbacks here are spies, so what a real control does inside
 *   its `show`/`hide` is out of scope (the environment is node, no jsdom).
 * - Who calls `applyProfile` in production (the briefing presenter / mode manager wiring).
 * - `PROFILES` itself is module-private and not exported; it is reached only through
 *   `applyProfile` / `defineProfile`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let emitted = [];
let busAvailable = true;

vi.mock('@store/services.js', () => ({
    getEventBus: () => (busAvailable
        ? { emit: (type, payload) => { emitted.push({ type, payload }); } }
        : null),
}));

/**
 * Fresh module + fresh singleton. Needed because `PROFILES` is a module-level MUTABLE
 * object that `defineProfile` writes into: without this, one test's custom profile would
 * be visible to the next.
 * @returns {Promise<object>} module namespace
 */
async function freshModule() {
    vi.resetModules();
    return import('../../src/js/ui/ui-visibility.controller.js');
}

/** @returns {{show: import('vitest').Mock, hide: import('vitest').Mock}} */
function spyCallbacks() {
    return { show: vi.fn(), hide: vi.fn() };
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

describe('enums e evento', () => {
    it('UIElement e VisibilityProfile sao congelados e tem os tamanhos do contrato', async () => {
        const { UIElement, VisibilityProfile, UIVisibilityEvents } = await freshModule();

        expect(Object.isFrozen(UIElement)).toBe(true);
        expect(Object.isFrozen(VisibilityProfile)).toBe(true);
        expect(Object.isFrozen(UIVisibilityEvents)).toBe(true);

        expect(Object.keys(UIElement)).toHaveLength(17);
        expect(Object.keys(VisibilityProfile)).toHaveLength(7);
        expect(UIVisibilityEvents).toEqual({ PROFILE_CHANGED: 'ui:visibilityProfileChanged' });

        // Every element id is unique (a duplicated value would silently merge two controls).
        expect(new Set(Object.values(UIElement)).size).toBe(17);
        expect(new Set(Object.values(VisibilityProfile)).size).toBe(7);
    });

    it('PROFILE_CHANGED NAO esta em event_types.js', async () => {
        const { UIVisibilityEvents } = await freshModule();
        const { EventTypes } = await import('../../src/js/events/event_types.js');

        const known = Object.values(EventTypes);
        expect(known.length).toBeGreaterThan(20);
        expect(known).not.toContain(UIVisibilityEvents.PROFILE_CHANGED);
    });
});

describe('ESTRUTURAL: as tabelas de perfil', () => {
    it('todo perfil embutido atribui TODOS os 17 elementos (o "herda do normal" do JSDoc nao existe no codigo)', async () => {
        const { getUIVisibilityController, UIElement, VisibilityProfile } = await freshModule();
        const c = getUIVisibilityController();

        const elementos = Object.values(UIElement);
        const perfis = Object.values(VisibilityProfile);
        expect(elementos).toHaveLength(17);
        expect(perfis).toHaveLength(7);

        // Probe each profile through the public API: force every element to a KNOWN wrong
        // value first, then apply the profile. Any element the profile fails to mention
        // keeps the poisoned value, which is exactly the silent failure being guarded.
        let checados = 0;
        for (const perfil of perfis) {
            for (const el of elementos) {
                c.hideElement(el);
            }
            expect(c.applyProfile(perfil)).toBe(true);

            for (const el of elementos) {
                // An unmentioned element would still read `false` here for the profiles that
                // want it visible; for a profile that wants it hidden the poison is invisible,
                // so run the mirror pass below too.
                checados++;
                expect(typeof c.isElementVisible(el)).toBe('boolean');
            }

            for (const el of elementos) {
                c.showElement(el);
            }
            c.applyProfile(perfil);
            const depoisDeMostrarTudo = elementos.map((el) => c.isElementVisible(el));

            for (const el of elementos) {
                c.hideElement(el);
            }
            c.applyProfile(perfil);
            const depoisDeEsconderTudo = elementos.map((el) => c.isElementVisible(el));

            // Same profile, two opposite starting points: identical results ONLY IF the
            // profile assigns every element. This is the real assertion of the block.
            expect(depoisDeEsconderTudo).toEqual(depoisDeMostrarTudo);
        }
        expect(checados).toBe(7 * 17);
    });

    it('OBSERVADO: a familia BRIEFING_LOCKED_* e byte a byte igual a BRIEFING_PRESENT_* (o comentario promete "sidebar available" e a SIDEBAR fica escondida)', async () => {
        const { getUIVisibilityController, UIElement, VisibilityProfile } = await freshModule();
        const c = getUIVisibilityController();
        const elementos = Object.values(UIElement);
        expect(elementos).toHaveLength(17);

        /** @param {string} perfil @returns {Record<string, boolean>} */
        const retrato = (perfil) => {
            c.applyProfile(VisibilityProfile.NORMAL);
            c.applyProfile(perfil);
            return Object.fromEntries(elementos.map((el) => [el, c.isElementVisible(el)]));
        };

        const pares = [
            [VisibilityProfile.BRIEFING_PRESENT_2D, VisibilityProfile.BRIEFING_LOCKED_2D],
            [VisibilityProfile.BRIEFING_PRESENT_3D, VisibilityProfile.BRIEFING_LOCKED_3D],
            [VisibilityProfile.BRIEFING_PRESENT_360, VisibilityProfile.BRIEFING_LOCKED_360],
        ];
        expect(pares).toHaveLength(3);

        for (const [present, locked] of pares) {
            expect(retrato(locked)).toEqual(retrato(present));
            // And the half the comment gets wrong, asserted in absolute terms:
            expect(retrato(locked)[UIElement.SIDEBAR]).toBe(false);
        }
    });

    it('os tres perfis de apresentacao diferem entre si onde o viewer manda (coordenadas e terreno)', async () => {
        const { getUIVisibilityController, UIElement, VisibilityProfile } = await freshModule();
        const c = getUIVisibilityController();

        c.applyProfile(VisibilityProfile.BRIEFING_PRESENT_2D);
        expect(c.isElementVisible(UIElement.COORDINATES_PANEL)).toBe(true);
        expect(c.isElementVisible(UIElement.TERRAIN_BUTTON)).toBe(true);

        c.applyProfile(VisibilityProfile.BRIEFING_PRESENT_3D);
        expect(c.isElementVisible(UIElement.COORDINATES_PANEL)).toBe(true);
        expect(c.isElementVisible(UIElement.TERRAIN_BUTTON)).toBe(false);

        c.applyProfile(VisibilityProfile.BRIEFING_PRESENT_360);
        expect(c.isElementVisible(UIElement.COORDINATES_PANEL)).toBe(false);
        expect(c.isElementVisible(UIElement.TERRAIN_BUTTON)).toBe(false);

        // The search bar is the one thing every briefing profile keeps.
        for (const p of [
            VisibilityProfile.BRIEFING_PRESENT_2D,
            VisibilityProfile.BRIEFING_PRESENT_3D,
            VisibilityProfile.BRIEFING_PRESENT_360,
            VisibilityProfile.BRIEFING_LOCKED_2D,
            VisibilityProfile.BRIEFING_LOCKED_3D,
            VisibilityProfile.BRIEFING_LOCKED_360,
        ]) {
            c.applyProfile(p);
            expect(c.isElementVisible(UIElement.SEARCH_BAR)).toBe(true);
        }
    });
});

describe('applyProfile', () => {
    it('estado inicial e o perfil NORMAL, com os 17 elementos visiveis', async () => {
        const { getUIVisibilityController, UIElement, VisibilityProfile } = await freshModule();
        const c = getUIVisibilityController();

        expect(c.getCurrentProfile()).toBe(VisibilityProfile.NORMAL);
        const elementos = Object.values(UIElement);
        expect(elementos).toHaveLength(17);
        expect(elementos.filter((el) => c.isElementVisible(el))).toHaveLength(17);
        expect(emitted).toHaveLength(0);
    });

    it('perfil desconhecido devolve false, avisa, nao muda nada e NAO emite', async () => {
        const { getUIVisibilityController, UIElement, VisibilityProfile } = await freshModule();
        const c = getUIVisibilityController();

        const ruins = ['briefing', '', 'NORMAL', null, undefined, 0, 'briefing:present'];
        expect(ruins).toHaveLength(7);
        for (const bad of ruins) {
            expect(c.applyProfile(bad)).toBe(false);
        }

        expect(c.getCurrentProfile()).toBe(VisibilityProfile.NORMAL);
        expect(c.isElementVisible(UIElement.SIDEBAR)).toBe(true);
        expect(emitted).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledTimes(7);
    });

    it('CORRIGIDO: nomes de Object.prototype sao RECUSADOS como perfil (lookup por Object.hasOwn)', async () => {
        const { getUIVisibilityController, UIElement, VisibilityProfile } = await freshModule();
        const c = getUIVisibilityController();

        // CONTROLE: a guarda ja funcionava para um nome que nao existe em lugar nenhum, e
        // continua funcionando: o conserto nao trocou uma recusa por outra.
        expect(c.applyProfile('perfil:inexistente')).toBe(false);
        expect(c.getCurrentProfile()).toBe(VisibilityProfile.NORMAL);

        // Antes: `PROFILES` e objeto literal, entao a busca caia no prototipo e devolvia uma
        // FUNCAO (truthy). O metodo declarava sucesso, gravava `_currentProfile` com o nome
        // bogus e emitia PROFILE_CHANGED, sem aplicar uma unica visibilidade.
        const herdados = ['constructor', 'toString', 'valueOf', 'hasOwnProperty'];
        expect(herdados).toHaveLength(4);
        for (const nome of herdados) {
            emitted = [];
            expect(nome in {}, nome).toBe(true);          // a chave REALMENTE e herdada
            expect(c.applyProfile(nome), nome).toBe(false);
            expect(c.getCurrentProfile(), nome).toBe(VisibilityProfile.NORMAL);
            expect(emitted, nome).toHaveLength(0);
        }
        expect(warnSpy).toHaveBeenCalledTimes(5);        // o inexistente + os quatro herdados

        // CONTROLE: um perfil de verdade continua sendo aplicado e continua emitindo.
        emitted = [];
        expect(c.applyProfile(VisibilityProfile.BRIEFING_PRESENT_2D)).toBe(true);
        expect(emitted).toHaveLength(1);
        expect(c.isElementVisible(UIElement.SIDEBAR)).toBe(false);
    });

    it('so chama callback do que MUDOU, e emite PROFILE_CHANGED com o par anterior/atual', async () => {
        const { getUIVisibilityController, UIElement, VisibilityProfile, UIVisibilityEvents } = await freshModule();
        const c = getUIVisibilityController();

        const sidebar = spyCallbacks();      // true -> false
        const searchBar = spyCallbacks();    // true -> true (nao muda)
        c.register(UIElement.SIDEBAR, sidebar);
        c.register(UIElement.SEARCH_BAR, searchBar);
        sidebar.show.mockClear(); sidebar.hide.mockClear();
        searchBar.show.mockClear(); searchBar.hide.mockClear();

        expect(c.applyProfile(VisibilityProfile.BRIEFING_PRESENT_2D)).toBe(true);

        expect(sidebar.hide).toHaveBeenCalledTimes(1);
        expect(sidebar.show).not.toHaveBeenCalled();
        expect(searchBar.hide).not.toHaveBeenCalled();
        expect(searchBar.show).not.toHaveBeenCalled();

        expect(emitted).toEqual([{
            type: UIVisibilityEvents.PROFILE_CHANGED,
            payload: {
                previousProfile: VisibilityProfile.NORMAL,
                currentProfile: VisibilityProfile.BRIEFING_PRESENT_2D,
            },
        }]);
    });

    it('ROUND-TRIP: NORMAL -> briefing -> NORMAL restaura os 17 elementos e re-mostra o escondido', async () => {
        const { getUIVisibilityController, UIElement, VisibilityProfile } = await freshModule();
        const c = getUIVisibilityController();

        const elementos = Object.values(UIElement);
        expect(elementos).toHaveLength(17);
        const base = Object.fromEntries(elementos.map((el) => [el, c.isElementVisible(el)]));

        const sidebar = spyCallbacks();
        c.register(UIElement.SIDEBAR, sidebar);

        c.applyProfile(VisibilityProfile.BRIEFING_PRESENT_3D);
        c.applyProfile(VisibilityProfile.NORMAL);

        expect(Object.fromEntries(elementos.map((el) => [el, c.isElementVisible(el)]))).toEqual(base);
        expect(sidebar.hide).toHaveBeenCalledTimes(1);
        expect(sidebar.show).toHaveBeenCalledTimes(1);
        expect(c.getCurrentProfile()).toBe(VisibilityProfile.NORMAL);
    });

    it('OBSERVADO: aplicar o MESMO perfil de novo emite PROFILE_CHANGED com previous === current, sem callback nenhum', async () => {
        const { getUIVisibilityController, UIElement, VisibilityProfile } = await freshModule();
        const c = getUIVisibilityController();

        const sidebar = spyCallbacks();
        c.register(UIElement.SIDEBAR, sidebar);
        c.applyProfile(VisibilityProfile.BRIEFING_LOCKED_2D);
        sidebar.show.mockClear(); sidebar.hide.mockClear();
        emitted = [];

        expect(c.applyProfile(VisibilityProfile.BRIEFING_LOCKED_2D)).toBe(true);

        expect(sidebar.show).not.toHaveBeenCalled();
        expect(sidebar.hide).not.toHaveBeenCalled();
        expect(emitted).toHaveLength(1);
        expect(emitted[0].payload.previousProfile).toBe(emitted[0].payload.currentProfile);
    });

    it('OBSERVADO: aplicar um perfil RECOLOCA o que showElement/hideElement tinham forcado', async () => {
        const { getUIVisibilityController, UIElement, VisibilityProfile } = await freshModule();
        const c = getUIVisibilityController();

        c.hideElement(UIElement.SEARCH_BAR);
        expect(c.isElementVisible(UIElement.SEARCH_BAR)).toBe(false);

        // Every briefing profile asserts SEARCH_BAR: true, so the manual override is undone.
        c.applyProfile(VisibilityProfile.BRIEFING_PRESENT_2D);
        expect(c.isElementVisible(UIElement.SEARCH_BAR)).toBe(true);
    });

    it('sem EventBus a troca de perfil ocorre sem lancar', async () => {
        const { getUIVisibilityController, UIElement, VisibilityProfile } = await freshModule();
        const c = getUIVisibilityController();
        busAvailable = false;

        expect(() => c.applyProfile(VisibilityProfile.BRIEFING_PRESENT_360)).not.toThrow();
        expect(c.isElementVisible(UIElement.COORDINATES_PANEL)).toBe(false);
        expect(emitted).toHaveLength(0);
    });
});

describe('register / unregister', () => {
    it('LATE JOIN: quem registra com o elemento ja escondido recebe hide() na hora', async () => {
        const { getUIVisibilityController, UIElement, VisibilityProfile } = await freshModule();
        const c = getUIVisibilityController();

        c.applyProfile(VisibilityProfile.BRIEFING_PRESENT_2D);

        const toolbar = spyCallbacks();
        c.register(UIElement.TOOLBAR_DRAW, toolbar);

        expect(toolbar.hide).toHaveBeenCalledTimes(1);
        expect(toolbar.show).not.toHaveBeenCalled();
    });

    it('EDGE: quem registra com o elemento VISIVEL nao recebe chamada nenhuma (nem show)', async () => {
        const { getUIVisibilityController, UIElement } = await freshModule();
        const c = getUIVisibilityController();

        const toolbar = spyCallbacks();
        c.register(UIElement.TOOLBAR_DRAW, toolbar);

        expect(toolbar.show).not.toHaveBeenCalled();
        expect(toolbar.hide).not.toHaveBeenCalled();
    });

    it('EDGE: id desconhecido nao tem estado, entao registrar nao dispara nada', async () => {
        const { getUIVisibilityController } = await freshModule();
        const c = getUIVisibilityController();

        const cb = spyCallbacks();
        c.register('inventado:qualquer', cb);
        expect(cb.hide).not.toHaveBeenCalled();
        expect(cb.show).not.toHaveBeenCalled();

        // ...but the manual overrides still reach it once registered.
        c.hideElement('inventado:qualquer');
        expect(cb.hide).toHaveBeenCalledTimes(1);
    });

    it('callbacks incompletos sao recusados com aviso, e o elemento segue sem callback', async () => {
        const { getUIVisibilityController, UIElement, VisibilityProfile } = await freshModule();
        const c = getUIVisibilityController();

        const soShow = { show: vi.fn() };
        const soHide = { hide: vi.fn() };
        const vazio = {};
        c.register(UIElement.SIDEBAR, soShow);
        c.register(UIElement.TOOLBAR_MAIN, soHide);
        c.register(UIElement.GRID_BUTTON, vazio);
        expect(warnSpy).toHaveBeenCalledTimes(3);

        expect(() => c.applyProfile(VisibilityProfile.BRIEFING_PRESENT_2D)).not.toThrow();
        expect(soShow.show).not.toHaveBeenCalled();
        expect(soHide.hide).not.toHaveBeenCalled();
        // State still tracked even without callbacks.
        expect(c.isElementVisible(UIElement.SIDEBAR)).toBe(false);
    });

    it('CORRIGIDO: register(id, null) avisa e retorna, em vez de lancar TypeError', async () => {
        const { getUIVisibilityController, UIElement, VisibilityProfile } = await freshModule();
        const c = getUIVisibilityController();

        // CONTROLE: a chamada bem formada e alcancavel e nao lanca.
        expect(() => c.register(UIElement.SIDEBAR, spyCallbacks())).not.toThrow();

        // Antes, a guarda lia `callbacks.show` ANTES de testar o objeto, entao as tres formas
        // ausentes derrubavam o chamador inteiro a partir de um metodo cujo trabalho e
        // justamente recusar entrada ruim.
        expect(() => c.register(UIElement.TOOLBAR_MAIN, null)).not.toThrow();
        expect(() => c.register(UIElement.TOOLBAR_MAIN, undefined)).not.toThrow();
        expect(() => c.register(UIElement.TOOLBAR_MAIN)).not.toThrow();
        expect(warnSpy).toHaveBeenCalledTimes(3);

        // E a recusa e de verdade: nada foi registrado, entao aplicar um perfil que esconde
        // o TOOLBAR_MAIN nao chama callback nenhum e mesmo assim segue o estado.
        c.applyProfile(VisibilityProfile.BRIEFING_PRESENT_2D);
        expect(c.isElementVisible(UIElement.TOOLBAR_MAIN)).toBe(false);
    });

    it('unregister corta o callback sem mexer no estado', async () => {
        const { getUIVisibilityController, UIElement, VisibilityProfile } = await freshModule();
        const c = getUIVisibilityController();

        const sidebar = spyCallbacks();
        c.register(UIElement.SIDEBAR, sidebar);
        c.unregister(UIElement.SIDEBAR);

        c.applyProfile(VisibilityProfile.BRIEFING_PRESENT_2D);
        expect(sidebar.hide).not.toHaveBeenCalled();
        expect(c.isElementVisible(UIElement.SIDEBAR)).toBe(false);

        // unregister de id ausente e no-op.
        expect(() => c.unregister('nao:existe')).not.toThrow();
    });
});

describe('showElement / hideElement / toggleElement / isElementVisible', () => {
    it('toggle duas vezes e identidade, no estado e no retorno', async () => {
        const { getUIVisibilityController, UIElement } = await freshModule();
        const c = getUIVisibilityController();

        const cb = spyCallbacks();
        c.register(UIElement.ATTRIBUTE_TABLE, cb);

        const antes = c.isElementVisible(UIElement.ATTRIBUTE_TABLE);
        expect(c.toggleElement(UIElement.ATTRIBUTE_TABLE)).toBe(!antes);
        expect(c.toggleElement(UIElement.ATTRIBUTE_TABLE)).toBe(antes);
        expect(c.isElementVisible(UIElement.ATTRIBUTE_TABLE)).toBe(antes);

        expect(cb.hide).toHaveBeenCalledTimes(1);
        expect(cb.show).toHaveBeenCalledTimes(1);
    });

    it('EDGE: id nunca visto assume VISIVEL (`?? true`), entao o primeiro toggle esconde', async () => {
        const { getUIVisibilityController } = await freshModule();
        const c = getUIVisibilityController();

        expect(c.isElementVisible('nunca:visto')).toBe(true);
        expect(c.toggleElement('nunca:visto')).toBe(false);
        expect(c.isElementVisible('nunca:visto')).toBe(false);
        expect(c.toggleElement('nunca:visto')).toBe(true);
    });

    it('EDGE: `?? true` nao engole o `false` gravado (a forma `|| true` engoliria)', async () => {
        const { getUIVisibilityController, UIElement } = await freshModule();
        const c = getUIVisibilityController();

        c.hideElement(UIElement.GRID_BUTTON);
        expect(c.isElementVisible(UIElement.GRID_BUTTON)).toBe(false);
    });

    it('show/hide sao idempotentes no estado mas RECHAMAM o callback a cada vez', async () => {
        const { getUIVisibilityController, UIElement } = await freshModule();
        const c = getUIVisibilityController();

        const cb = spyCallbacks();
        c.register(UIElement.CONTEXT_MENU, cb);

        c.hideElement(UIElement.CONTEXT_MENU);
        c.hideElement(UIElement.CONTEXT_MENU);
        expect(cb.hide).toHaveBeenCalledTimes(2);
        expect(c.isElementVisible(UIElement.CONTEXT_MENU)).toBe(false);

        c.showElement(UIElement.CONTEXT_MENU);
        c.showElement(UIElement.CONTEXT_MENU);
        expect(cb.show).toHaveBeenCalledTimes(2);
        expect(c.isElementVisible(UIElement.CONTEXT_MENU)).toBe(true);
    });

    it('show/hide/toggle NAO emitem PROFILE_CHANGED nem mudam o perfil corrente', async () => {
        const { getUIVisibilityController, UIElement, VisibilityProfile } = await freshModule();
        const c = getUIVisibilityController();

        c.hideElement(UIElement.SIDEBAR);
        c.showElement(UIElement.SIDEBAR);
        c.toggleElement(UIElement.SIDEBAR);

        expect(emitted).toHaveLength(0);
        expect(c.getCurrentProfile()).toBe(VisibilityProfile.NORMAL);
    });
});

describe('defineProfile', () => {
    it('perfil custom herda o NORMAL e sobrepoe so o que declara', async () => {
        const { getUIVisibilityController, UIElement } = await freshModule();
        const c = getUIVisibilityController();

        c.defineProfile('custom:teste', { [UIElement.SIDEBAR]: false });
        expect(warnSpy).not.toHaveBeenCalled();

        expect(c.applyProfile('custom:teste')).toBe(true);
        expect(c.isElementVisible(UIElement.SIDEBAR)).toBe(false);
        // Everything else came from NORMAL, so it is visible.
        const outros = Object.values(UIElement).filter((el) => el !== UIElement.SIDEBAR);
        expect(outros).toHaveLength(16);
        expect(outros.filter((el) => c.isElementVisible(el))).toHaveLength(16);
    });

    it('EDGE: chave desconhecida no custom vira estado rastreado, sem validacao', async () => {
        const { getUIVisibilityController } = await freshModule();
        const c = getUIVisibilityController();

        c.defineProfile('custom:solto', { 'elemento:que:nao:existe': false });
        c.applyProfile('custom:solto');

        expect(c.isElementVisible('elemento:que:nao:existe')).toBe(false);
    });

    it('CORRIGIDO: defineProfile RECUSA um perfil EMBUTIDO, entao o NORMAL nao pode ser envenenado', async () => {
        const { getUIVisibilityController, UIElement, VisibilityProfile } = await freshModule();
        const c = getUIVisibilityController();

        // CONTROLE: antes da tentativa o NORMAL restaura a sidebar.
        c.applyProfile(VisibilityProfile.BRIEFING_PRESENT_2D);
        c.applyProfile(VisibilityProfile.NORMAL);
        expect(c.isElementVisible(UIElement.SIDEBAR)).toBe(true);

        // Antes: a sobrescrita passava com um aviso, e `PROFILES` e objeto de modulo, entao o
        // estrago sobrevivia a chamada. Dali em diante todo "voltar ao normal" da pagina
        // restaurava a tabela ENVENENADA, e a sidebar ficava escondida sem nada explicando.
        expect(c.defineProfile(VisibilityProfile.NORMAL, { [UIElement.SIDEBAR]: false })).toBe(false);
        expect(warnSpy).toHaveBeenCalledTimes(1);

        c.applyProfile(VisibilityProfile.BRIEFING_PRESENT_2D);
        c.applyProfile(VisibilityProfile.NORMAL);
        expect(c.isElementVisible(UIElement.SIDEBAR)).toBe(true);
    });

    it('CORRIGIDO: os SETE perfis embutidos sao recusados, um a um', async () => {
        const { getUIVisibilityController, UIElement, VisibilityProfile } = await freshModule();
        const c = getUIVisibilityController();

        const embutidos = Object.values(VisibilityProfile);
        expect(embutidos).toHaveLength(7);
        for (const nome of embutidos) {
            expect(c.defineProfile(nome, { [UIElement.GRID_BUTTON]: false }), nome).toBe(false);
        }
        expect(warnSpy).toHaveBeenCalledTimes(7);

        // CONTROLE: um nome CUSTOM continua sendo aceito, entao a recusa nao fechou tudo.
        expect(c.defineProfile('custom:legitimo', { [UIElement.GRID_BUTTON]: false })).toBe(true);
        c.applyProfile('custom:legitimo');
        expect(c.isElementVisible(UIElement.GRID_BUTTON)).toBe(false);
    });

    it('EDGE: redefinir um custom ja definido tambem avisa (o aviso nao distingue embutido de custom)', async () => {
        const { getUIVisibilityController, UIElement } = await freshModule();
        const c = getUIVisibilityController();

        c.defineProfile('custom:x', { [UIElement.GRID_BUTTON]: false });
        c.defineProfile('custom:x', { [UIElement.GRID_BUTTON]: true });
        expect(warnSpy).toHaveBeenCalledTimes(1);

        c.applyProfile('custom:x');
        expect(c.isElementVisible(UIElement.GRID_BUTTON)).toBe(true);
    });
});
