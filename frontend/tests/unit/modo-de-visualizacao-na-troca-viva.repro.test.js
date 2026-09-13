// Path: tests/unit/modo-de-visualizacao-na-troca-viva.repro.test.js

/**
 * @fileoverview REPRO: a troca ao vivo de um atlas de servidor para um slot LOCAL deixava o mapa em
 * modo de visualização (`body.is-view-only`), com as barras de desenho escondidas num espaço de
 * trabalho que é sempre editável.
 *
 * A CAUSA, medida em 2026-09-13 em `tests/e2e-ui/atlas-data-safety.scenario.js`: `switchAtlas`
 * desconecta ANTES de marcar a origem local, e `forgetAtlasRole` (sessão ONLINE) semeia um VIEWER
 * fechado e notifica `SESSION_CHANGED` enquanto o store ainda é REMOTO, então o controlador liga a
 * classe; `markStoreLocal` vem depois e não avisa ninguém. O clique do Playwright numa barra sem
 * área esperava para sempre, e o defeito valia desde 2026-08-25, quando `forgetAtlasRole` nasceu.
 *
 * O conserto: o controlador também re-deriva a classe em `ATLAS_SWITCHED` (fim de todo
 * `switchAtlas`) e em `ALL_DATA_CLEARED` (o wipe que re-marca o store local no lugar).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const listeners = new Map();
const bus = {
    on: vi.fn((name, fn) => { listeners.set(name, [...(listeners.get(name) ?? []), fn]); }),
    emit: (name, payload) => { for (const fn of listeners.get(name) ?? []) fn(payload); }
};
const guard = { allowed: true };

vi.mock('@store/services.js', () => ({ getEventBus: () => bus }));
vi.mock('@store/sync/permission-guard.js', () => ({ checkPermission: () => ({ ...guard }) }));
vi.mock('@store/sync/sync-engine.js', () => ({ syncEngine: { atlasId: null } }));
vi.mock('@utils', () => ({ showToast: vi.fn() }));

const { EventTypes } = await import('@events/event_types.js');
const { getViewModeController } = await import('@js/ui/view-mode.controller.js');

/** A minimal `document.body.classList`, which is all the controller touches. */
function bodyStub() {
    const classes = new Set();
    globalThis.document = {
        body: {
            classList: {
                toggle: (name, force) => { if (force) classes.add(name); else classes.delete(name); return classes.has(name); },
                contains: (name) => classes.has(name)
            }
        }
    };
    return classes;
}

describe('modo de visualização na troca viva para um slot local (repro)', () => {
    let classes;
    // `init` é idempotente por desenho (`_wired`), então o singleton se liga UMA vez e os casos
    // só trocam o corpo e o guarda.
    bodyStub();
    getViewModeController().init();
    beforeEach(() => {
        classes = bodyStub();
        guard.allowed = true;
        bus.emit(EventTypes.SESSION_CHANGED, {});
    });

    it('o controlador assina ATLAS_SWITCHED e ALL_DATA_CLEARED, além de sessão e conexão', () => {
        const assinados = new Set(listeners.keys());
        expect(assinados.has(EventTypes.SESSION_CHANGED)).toBe(true);
        expect(assinados.has(EventTypes.CONNECTION_STATE_CHANGED)).toBe(true);
        expect(assinados.has(EventTypes.ATLAS_SWITCHED)).toBe(true);
        expect(assinados.has(EventTypes.ALL_DATA_CLEARED)).toBe(true);
    });

    it('a sessão que semeia VIEWER com o store ainda remoto liga a classe, e a troca a desliga', () => {
        expect(classes.has('is-view-only')).toBe(false);

        // `forgetAtlasRole` durante o `disconnect` de `switchAtlas`: sessão ONLINE, store REMOTO.
        guard.allowed = false;
        bus.emit(EventTypes.SESSION_CHANGED, {});
        expect(classes.has('is-view-only')).toBe(true);

        // `markStoreLocal` acontece (o guarda volta a permitir) e ninguém avisa: era aqui que a
        // classe ficava presa. O fim de `switchAtlas` anuncia a troca.
        guard.allowed = true;
        bus.emit(EventTypes.ATLAS_SWITCHED, { kind: 'local', atlasId: 'b' });
        expect(classes.has('is-view-only')).toBe(false);
    });

    it('o wipe que re-marca o store local no lugar também solta a classe', () => {
        guard.allowed = false;
        bus.emit(EventTypes.CONNECTION_STATE_CHANGED, {});
        expect(classes.has('is-view-only')).toBe(true);
        guard.allowed = true;
        bus.emit(EventTypes.ALL_DATA_CLEARED, {});
        expect(classes.has('is-view-only')).toBe(false);
    });
});
