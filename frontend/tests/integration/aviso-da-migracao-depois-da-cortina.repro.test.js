// Path: tests/integration/aviso-da-migracao-depois-da-cortina.repro.test.js

/**
 * @fileoverview O AVISO DO PORTÃO DE MIGRAÇÃO NÃO PODE GASTAR O TEMPO DELE ATRÁS DA CORTINA.
 *
 * `runLegacyUpgradeGate` (`ui/migration-recovery.js`) termina bem e o boot do mapa segue COBERTO
 * pela cortina (`#initial-loader`, z-index 9999), que só sai quando `renderBootMap` termina. Os dois
 * avisos que o portão dá nesse instante, o do resgate (12 s) e o da alteração tardia adiada (3 s,
 * o padrão), são toasts (`--z-toast`: 220): emitidos na hora, contavam o prazo por baixo da cortina,
 * e o de 3 s podia sumir inteiro antes de a pessoa ver o mapa. Medido no navegador, o boot depois do
 * portão leva de 0,5 s a 3,5 s com um acervo antigo para copiar.
 *
 * O PORTÃO RODA DE VERDADE AQUI, com o acervo 2.4 e a alteração tardia em conflito semeados em
 * `fake-indexeddb`, e o que se mede é o momento em que o toast chega ao corpo: nenhum enquanto a
 * cortina está no documento, e o do resgate logo depois de ela sair. O `MutationObserver` é um
 * dublê que o próprio caso dispara, e é isso que torna a ordem determinística.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedDatabase, resetIndexedDB } from '../helpers/idb-helpers.js';

beforeEach(async () => { vi.resetModules(); await resetIndexedDB(); });
afterEach(async () => {
    vi.restoreAllMocks();
    delete globalThis.MutationObserver;
    await resetIndexedDB();
});

const SEGUNDO_ID = '6f1c1d0e-4b3a-4d52-9a57-2f3c8e5b7a10';

function linha(n) {
    const id = `00000000-0000-4000-8000-00000000000${n}`;
    return {
        type: 'Feature', id,
        geometry: { type: 'LineString', coordinates: [[-53.03, -24.68], [-53.02, -24.67 - n / 1000]] },
        properties: { id, nome: `Linha #${n}`, color: '#000000', layerId: 'default', source: 'coordination_line', visivel: true, bloqueado: false }
    };
}

function mapa(nome, id, linhas = []) {
    return {
        id, name: nome, baseLayer: 'osm-overture', catalogLayers: [], analysisLayers: {},
        bearing: null, pitch: null, zoom: null, center_lat: null, center_long: null,
        features: { coordination_lines: linhas, points: [], lines: [], polygons: [] },
        sync: { createdAt: 1, updatedAt: 1, version: 1, deleted: false, deletedAt: null, dirty: true, ownerId: null }
    };
}

/** Acervo da versão antiga, a transição concluída, e um CONFLITO tardio: o boot seguinte resgata. */
async function acervoComConflitoTardio() {
    await seedDatabase('ebgeo_atlas', { current_atlas: {
        id: '76cfc275-0000-4000-8000-000000000000', name: 'Meu Atlas', schemaVersion: '2.4',
        lastActiveMapId: 'Principal', mapOrder: ['Principal', 'Segundo']
    } });
    await seedDatabase('ebgeo_maps', { Principal: mapa('Principal', 'Principal'), Segundo: mapa('Segundo', SEGUNDO_ID) });
    await seedDatabase('ebgeo_app_settings', { schemaVersion: '2.4', lastActiveMap: 'Principal', color_usage_Principal: {}, color_usage_Segundo: {} });

    const ns = await import('@store/atlas-namespace.js');
    const { prepareLegacyTransition } = await import('@store/migration/legacy-transition.js');
    const { state } = await prepareLegacyTransition();
    const destino = ns.localScope(state.entry.id, state.destination);
    const loja = ns.getStoreFor(ns.StoreName.MAPS, destino);
    const principal = await loja.getItem('Principal');
    principal.features.points = [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-47.9, -15.8] },
        properties: { id: 'ponto-novo', nome: 'Ponto novo', color: '#ff0000', source: 'point' } }];
    await loja.setItem('Principal', principal);
    await ns.getStoreFor(ns.StoreName.SETTINGS, destino).setItem('color_usage_Principal', { '#ff0000': 1 });

    // A versão antiga grava no MESMO mapa depois da transição.
    await seedDatabase('ebgeo_maps', { Principal: { ...mapa('Principal', 'Principal', [linha(1), linha(2)]), sync: { createdAt: 1, updatedAt: 26, version: 26 } } });
    await seedDatabase('ebgeo_app_settings', { color_usage_Principal: { '#000000': 2 } });
}

/**
 * O mínimo de DOM que o portão e o serviço de aviso tocam, com a cortina no corpo.
 * @returns {{ avisos: Object[], cortina: Object, observadores: Function[] }}
 */
function montarDom() {
    const avisos = [];
    const observadores = [];
    const el = (tag = 'div') => {
        const node = {
            tagName: tag.toUpperCase(), className: '', textContent: '', style: {}, dataset: {}, children: [],
            parentNode: null, isConnected: false, inert: false,
            classList: { add() {}, remove() {}, contains: () => false },
            setAttribute() {}, getAttribute: () => null, removeAttribute() {},
            appendChild(c) { c.parentNode = node; c.isConnected = true; node.children.push(c); return c; },
            append(...n) { for (const c of n) node.appendChild(c); },
            insertBefore(c, ref) {
                c.parentNode = node; c.isConnected = true;
                const i = ref ? node.children.indexOf(ref) : -1;
                if (i >= 0) node.children.splice(i, 0, c); else node.children.push(c);
                return c;
            },
            removeChild(c) { const i = node.children.indexOf(c); if (i >= 0) node.children.splice(i, 1); c.parentNode = null; c.isConnected = false; },
            remove() { node.parentNode?.removeChild(node); },
            get nextSibling() {
                const irmaos = node.parentNode?.children ?? [];
                return irmaos[irmaos.indexOf(node) + 1] ?? null;
            },
            addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ top: 0, height: 0, bottom: 0 })
        };
        return node;
    };
    const body = el('body');
    body.isConnected = true;
    const cortina = el();
    cortina.id = 'initial-loader';
    body.appendChild(cortina);
    const acrescentar = body.appendChild.bind(body);
    body.appendChild = (c) => {
        if (c !== cortina && String(c.className).includes('toast')) avisos.push({ no: c, comCortina: cortina.isConnected });
        return acrescentar(c);
    };
    globalThis.document = {
        body, createElement: el, querySelector: () => null,
        getElementById: (id) => (id === 'initial-loader' && cortina.isConnected ? cortina : null),
        addEventListener() {}, removeEventListener() {}, visibilityState: 'visible'
    };
    globalThis.window = { addEventListener() {}, removeEventListener() {}, location: { reload() {} } };
    globalThis.requestAnimationFrame = () => 0;
    globalThis.MutationObserver = class {
        constructor(fn) { this.fn = fn; }
        observe() { observadores.push(this); }
        disconnect() { const i = observadores.indexOf(this); if (i >= 0) observadores.splice(i, 1); }
    };
    return { avisos, cortina, observadores };
}

/** O texto inteiro de um nó do dublê, filhos inclusive. */
function texto(no) {
    return [no.textContent, ...(no.children || []).map(texto)].join(' ');
}

describe('o aviso do portão espera a cortina do boot sair', () => {
    it('o resgate só vira toast depois de a cortina sair, e sai com o prazo inteiro', async () => {
        await acervoComConflitoTardio();
        const { avisos, cortina, observadores } = montarDom();
        const ui = await import('@js/ui/migration-recovery.js');

        expect(await ui.runLegacyUpgradeGate({ mapa: true })).toBe(true);
        for (let i = 0; i < 10; i++) await Promise.resolve();

        // Enquanto a cortina cobre o boot, nenhum aviso chegou ao corpo.
        expect(avisos.filter(a => a.comCortina), 'nenhum aviso nasceu atrás da cortina').toEqual([]);

        // A cortina sai (é o que `hideLoadingScreen` faz ao fim de `renderBootMap`).
        cortina.remove();
        for (const obs of [...observadores]) obs.fn([]);
        for (let i = 0; i < 10; i++) await Promise.resolve();

        const resgate = avisos.find(a => /Recuperado/.test(texto(a.no)));
        expect(resgate, 'o aviso do resgate saiu depois da cortina').toBeTruthy();
        expect(resgate.comCortina).toBe(false);
    });
});
