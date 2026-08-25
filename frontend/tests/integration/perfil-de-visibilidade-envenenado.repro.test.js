// Path: tests/integration/perfil-de-visibilidade-envenenado.repro.test.js

/**
 * @fileoverview Repro for the two ways `UIVisibilityController` could be left describing a
 * screen that is not on screen. Both drive the PRODUCTION singleton through the same
 * entry points the briefing controls use (`applyProfile`, `defineProfile`, `register`), with
 * spy callbacks standing in for the real controls' show/hide.
 *
 * DEFECT 1 (prototype-chain profile). `PROFILES` is an object literal, so `PROFILES[name]`
 * reached `Object.prototype`. A name like 'constructor', 'toString', 'valueOf' or
 * 'hasOwnProperty' resolved to a FUNCTION, which is truthy, so the `if (!profile)` guard let
 * it through: `applyProfile` returned true, stamped `_currentProfile` with the bogus name and
 * emitted PROFILE_CHANGED, without applying a single visibility. Every later reader of
 * `getCurrentProfile()` then believed the app was in a mode that does not exist, and no
 * element callback had run. Root cause is the bare lookup; the fix is `Object.hasOwn`, the
 * same shape used by `arrivalNotice` in `projects/atlas-drive.js`.
 *
 * DEFECT 5 (built-in profile overwritten). `defineProfile` warned and overwrote. `PROFILES`
 * is a MODULE-level mutable object, so the damage outlived the call: once NORMAL was
 * rewritten with a hidden sidebar, every later "back to normal" in that page load restored
 * the poisoned table. Leaving a briefing then left the sidebar hidden for the rest of the
 * session, with nothing on screen explaining it, and no reload short of F5 undoing it. Fix:
 * a built-in name is refused, custom names still merge over NORMAL.
 *
 * NOT REACHED: the DOM. Registration callbacks here are spies, so what a real control does
 * inside show/hide is out of scope (the environment is node, no jsdom).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let emitted = [];

vi.mock('@store/services.js', () => ({
    getEventBus: () => ({ emit: (type, payload) => { emitted.push({ type, payload }); } }),
}));

/** Fresh module + fresh singleton, because `PROFILES` is module-level and mutable. */
async function freshModule() {
    vi.resetModules();
    return import('../../src/js/ui/ui-visibility.controller.js');
}

let warnSpy;

beforeEach(() => {
    emitted = [];
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// Restore, do not merely clear: a spy left installed is re-wrapped by the next spyOn, and
// the warn counts of both tests then land in the same mock.
afterEach(() => { warnSpy.mockRestore(); });

describe('REPRO: um nome herdado de Object.prototype era aceito como perfil de visibilidade', () => {
    it('os quatro nomes herdados sao recusados, e a sidebar de um perfil real ainda responde', async () => {
        const { getUIVisibilityController, UIElement, VisibilityProfile, UIVisibilityEvents } =
            await freshModule();
        const c = getUIVisibilityController();

        const sidebar = { show: vi.fn(), hide: vi.fn() };
        c.register(UIElement.SIDEBAR, sidebar);
        sidebar.show.mockClear();
        sidebar.hide.mockClear();

        const herdados = ['constructor', 'toString', 'valueOf', 'hasOwnProperty'];
        expect(herdados).toHaveLength(4);
        for (const nome of herdados) {
            // The key really IS inherited: without this the loop could be asserting over
            // names that were never on the prototype, and would pass for the wrong reason.
            expect(nome in {}, nome).toBe(true);
            expect(c.applyProfile(nome), nome).toBe(false);
            expect(c.getCurrentProfile(), nome).toBe(VisibilityProfile.NORMAL);
        }
        expect(emitted).toHaveLength(0);
        expect(sidebar.show).not.toHaveBeenCalled();
        expect(sidebar.hide).not.toHaveBeenCalled();

        // CONTROLE: a declared profile still applies, still moves the callback and still
        // emits, so the guard did not simply close the door on everything.
        expect(c.applyProfile(VisibilityProfile.BRIEFING_PRESENT_2D)).toBe(true);
        expect(sidebar.hide).toHaveBeenCalledTimes(1);
        expect(emitted).toHaveLength(1);
        expect(emitted[0].type).toBe(UIVisibilityEvents.PROFILE_CHANGED);
        expect(emitted[0].payload.currentProfile).toBe(VisibilityProfile.BRIEFING_PRESENT_2D);
    });
});

describe('REPRO: defineProfile envenenava o perfil NORMAL para o resto da vida do modulo', () => {
    it('sair de um briefing volta a mostrar a sidebar mesmo depois da tentativa de sobrescrever o NORMAL', async () => {
        const { getUIVisibilityController, UIElement, VisibilityProfile } = await freshModule();
        const c = getUIVisibilityController();

        const sidebar = { show: vi.fn(), hide: vi.fn() };
        c.register(UIElement.SIDEBAR, sidebar);

        // The exact gesture that used to poison the table.
        expect(c.defineProfile(VisibilityProfile.NORMAL, { [UIElement.SIDEBAR]: false })).toBe(false);
        expect(warnSpy).toHaveBeenCalledTimes(1);

        sidebar.show.mockClear();
        sidebar.hide.mockClear();

        // Enter a briefing and come back out, which is the round trip a presenter makes.
        c.applyProfile(VisibilityProfile.BRIEFING_PRESENT_2D);
        c.applyProfile(VisibilityProfile.NORMAL);

        expect(c.isElementVisible(UIElement.SIDEBAR)).toBe(true);
        expect(sidebar.hide).toHaveBeenCalledTimes(1);
        expect(sidebar.show).toHaveBeenCalledTimes(1);
    });

    it('CONTROLE: um perfil CUSTOM continua sendo definivel e aplicavel', async () => {
        const { getUIVisibilityController, UIElement } = await freshModule();
        const c = getUIVisibilityController();

        expect(c.defineProfile('custom:mesa-de-areia', { [UIElement.GRID_BUTTON]: false })).toBe(true);
        expect(c.applyProfile('custom:mesa-de-areia')).toBe(true);
        expect(c.isElementVisible(UIElement.GRID_BUTTON)).toBe(false);
        // The merge over NORMAL is what makes a partial custom table safe: the elements the
        // caller did not name come back visible, not stuck at the previous profile's state.
        expect(c.isElementVisible(UIElement.SIDEBAR)).toBe(true);
    });
});
