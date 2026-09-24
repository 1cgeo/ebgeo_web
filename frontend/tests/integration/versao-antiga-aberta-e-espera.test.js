// Path: tests/integration/versao-antiga-aberta-e-espera.test.js

/**
 * @fileoverview A JANELA DA VERSÃO ANTIGA ABERTA É ESPERA, NÃO FALHA (2026-09-23).
 *
 * O caso mais comum da virada: a pessoa tinha o EBGeo antigo aberto quando a versão mudou, e abre a
 * nova numa segunda aba. O portão de migração desenhava a tela de duas saídas (baixar os dados ou
 * APAGÁ-LOS) e a saída certa, fechar a janela velha e recarregar, não tinha botão. Medido no
 * navegador com o build real da `main` numa aba e o desta linha na outra, 2 de 2
 * (`tests/helpers/main-aba-aberta.mjs`).
 *
 * O QUE É REAL AQUI: o protocolo da aba antiga é o CÓDIGO da `main` publicada (8b611113), preservado
 * na fixture, rodando num canal `BroadcastChannel` de verdade; a cópia e a migração são as do
 * produto, sobre IndexedDB. O que é dublê: o `document`, porque a suíte roda em node puro.
 */

import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { seedDatabase, readKey, resetIndexedDB } from '../helpers/idb-helpers.js';
import { makeDocumentStub, makeElement } from '../helpers/dom-double.js';

// O telemetro de uso não tem para onde ir em node; o portão o chama no começo e no fim.
vi.mock('@js/session/uso-lote.js', () => ({ registrarUso: () => {}, descarregarUso: () => {} }));

/** Uma instalação 2.4 da versão antiga: o que a aba velha tem aberto. */
async function seedAcervo() {
    await seedDatabase('ebgeo_atlas', { current_atlas: {
        id: '76cfc275-0000-4000-8000-000000000000', name: 'Meu Atlas', schemaVersion: '2.4',
        lastActiveMapId: 'Principal', mapOrder: ['Principal']
    } });
    await seedDatabase('ebgeo_maps', {
        Principal: { id: 'Principal', name: 'Principal', baseLayer: 'osm-overture', zoom: 7,
            features: { points: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-47.9, -15.8] },
                properties: { id: 'p1', nome: 'Ponto da versão antiga', source: 'point' } }] } }
    });
    await seedDatabase('ebgeo_app_settings', { schemaVersion: '2.4', lastActiveMap: 'Principal' });
}

/** A aba da `main` publicada, pelo código dela. */
function abaDaMain() {
    const source = readFileSync(new URL('../fixtures/migration-review/tab-lock-main-8b611113.txt', import.meta.url), 'utf8');
    return runInNewContext(
        source.replace('export function initTabLock', 'function initTabLock')
        + '\n({ initTabLock, active: () => isActive, close: () => channel?.close() })',
        { BroadcastChannel, setTimeout, document: { body: { appendChild() {} }, createElement: () => makeElement('div') },
            requestAnimationFrame: (fn) => setTimeout(fn, 0) }
    );
}

let doc;

beforeAll(async () => {
    // A transformação a frio fica fora do orçamento dos casos (ver `migracao-main-riscos-abertos`).
    await import('@js/ui/migration-recovery.js');
}, 120000);

beforeEach(async () => {
    vi.resetModules();
    await resetIndexedDB();
    await seedAcervo();
    doc = makeDocumentStub();
    doc.getElementById = () => null;
    globalThis.document = doc;
    globalThis.window = { addEventListener() {}, removeEventListener() {}, location: { reload() {} } };
});

afterEach(async () => {
    await resetIndexedDB();
});

const tela = () => doc.body.children.find(c => c.dataset?.testid === 'migration-recovery') ?? null;
const botoes = () => (tela()?.children[0]?.children ?? []).filter(c => c.tagName === 'BUTTON');
const dormir = (ms) => new Promise(r => setTimeout(r, ms));

describe('uma aba da versão antiga aberta durante a virada', () => {
    it('o portão ESPERA sem comando destrutivo, e segue sozinho quando ela fecha', async () => {
        const antiga = abaDaMain();
        let desfecho = null;
        try {
            antiga.initTabLock();
            await dormir(1600);
            expect(antiga.active(), 'controle: a aba antiga terminou a própria sondagem e está ativa').toBe(true);

            const { runLegacyUpgradeGate } = await import('@js/ui/migration-recovery.js');
            const portao = runLegacyUpgradeGate().then(v => { desfecho = v; });

            await vi.waitFor(() => expect(tela()).not.toBeNull(), { timeout: 10000 });
            // Enquanto a antiga responde, o portão não desiste: segura a tela e não migra.
            await dormir(3000);
            expect(desfecho, 'o portão não saiu enquanto a aba antiga estava aberta').toBeNull();
            expect(botoes().map(b => b.textContent), 'nenhum comando, e nenhum destrutivo').toEqual([]);
            expect(tela().children[0].children.map(c => c.textContent).join(' ')).toMatch(/Feche/);
            expect(await readKey('ebgeo_global', 'legacy_transition_v1'), 'nada foi copiado ainda').toBeFalsy();

            // A pessoa fecha a aba antiga. Nenhum clique nesta.
            antiga.close();
            await Promise.race([portao, dormir(15000)]);
            expect(desfecho, 'o portão seguiu sozinho e a migração abriu').toBe(true);
            expect(tela(), 'a tela de espera saiu').toBeNull();
            const diario = await readKey('ebgeo_global', 'legacy_transition_v1');
            expect(diario?.status).toBe('committed');
            const migrado = await readKey(`ebgeo_maps__${diario.destination}`, 'Principal');
            expect(migrado.features.points.map(f => f.properties.nome)).toEqual(['Ponto da versão antiga']);
        } finally {
            antiga.close();
        }
    }, 40000);

    it('controle: sem aba antiga o portão segue na hora, sem tela nenhuma', async () => {
        const { runLegacyUpgradeGate } = await import('@js/ui/migration-recovery.js');
        const inicio = Date.now();
        expect(await runLegacyUpgradeGate()).toBe(true);
        expect(Date.now() - inicio).toBeLessThan(5000);
        expect(tela()).toBeNull();
    }, 20000);
});
