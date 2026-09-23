// Path: tests/integration/recuperado-unico-e-aberto.test.js

/**
 * @fileoverview O Recuperado ABRE DIRETO e é UM SÓ enquanto ninguém trabalhar nele (decisão do dono,
 * 2026-09-23).
 *
 * O resgate das alterações tardias (a versão antiga gravou depois da atualização) guarda o trabalho
 * num atlas "Recuperado — alterações da versão antiga". Medido antes do conserto, neste mesmo
 * harness: a versão antiga gravando DE NOVO criava um terceiro atlas com o mesmo nome, e o boot
 * seguia no atlas atualizado. As réguas daqui:
 *
 *   1. o segundo resgate, com o primeiro Recuperado intocado, deixa UM Recuperado, o novo;
 *   2. o Recuperado em que a pessoa desenhou FICA, e deixa de ser candidato;
 *   3. o Recuperado montado em outra aba não sai enquanto a trava de montagem estiver tomada;
 *   4. o boot abre o Recuperado, mesmo com a aba apontando para outro atlas.
 */

import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { seedDatabase, resetIndexedDB } from '../helpers/idb-helpers.js';

beforeEach(async () => { vi.resetModules(); await resetIndexedDB(); });
afterEach(async () => {
    vi.restoreAllMocks();
    delete globalThis.sessionStorage;
    await resetIndexedDB();
});

const SEGUNDO_ID = '6f1c1d0e-4b3a-4d52-9a57-2f3c8e5b7a10';

function linha(n) {
    const id = `00000000-0000-4000-8000-00000000000${n}`;
    return {
        type: 'Feature', id,
        geometry: { type: 'LineString', coordinates: [[-53.03, -24.68], [-53.02, -24.67 - n / 1000]] },
        properties: {
            id, nome: `Linha de Coordenação #${n}`, color: '#000000', layerId: 'default',
            source: 'coordination_line', symbol_code: '290302', visivel: true, bloqueado: false
        }
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

async function seed24() {
    await seedDatabase('ebgeo_atlas', { current_atlas: {
        id: '76cfc275-0000-4000-8000-000000000000', name: 'Meu Atlas', schemaVersion: '2.4',
        lastActiveMapId: 'Principal', mapOrder: ['Principal', 'Segundo'], settings: { terrainExaggeration: 1.5 }
    } });
    await seedDatabase('ebgeo_maps', { Principal: mapa('Principal', 'Principal'), Segundo: mapa('Segundo', SEGUNDO_ID) });
    await seedDatabase('ebgeo_app_settings', {
        schemaVersion: '2.4', lastActiveMap: 'Principal', color_usage_Principal: {}, color_usage_Segundo: {}
    });
}

/** O que a versão antiga grava quando desenha `n` linhas no mapa Principal, na versão `v`. */
async function antigaDesenha(n, v) {
    const linhas = Array.from({ length: n }, (_, i) => linha(i + 1));
    await seedDatabase('ebgeo_maps', { Principal: { ...mapa('Principal', 'Principal', linhas), sync: { createdAt: 1, updatedAt: v, version: v } } });
    await seedDatabase('ebgeo_app_settings', { color_usage_Principal: { '#000000': n } });
}

async function modules() {
    return {
        ns: await import('@store/atlas-namespace.js'),
        transition: await import('@store/migration/legacy-transition.js'),
        resiliente: await import('@store/migration/transicao-resiliente.js'),
        limpeza: await import('@store/migration/legacy-cleanup.js'),
        abrir: await import('@store/migration/abrir-recuperado.js')
    };
}

/** Conclui a transição, desenha um ponto na versão nova e faz o PRIMEIRO resgate. */
async function primeiroResgate() {
    const m = await modules();
    const { state } = await m.transition.prepareLegacyTransition();
    const destino = m.ns.localScope(state.entry.id, state.destination);
    const principal = await m.ns.getStoreFor(m.ns.StoreName.MAPS, destino).getItem('Principal');
    principal.features.points = [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-47.9, -15.8] }, properties: { id: 'p1', source: 'point' } }];
    await m.ns.getStoreFor(m.ns.StoreName.MAPS, destino).setItem('Principal', principal);

    await antigaDesenha(2, 26);
    const r1 = await m.resiliente.prepareLegacyTransitionResiliente();
    const primeiro = r1.reparos[0].entry;
    return { ...m, destino, primeiro, escopoDo: (e) => m.ns.localScope(e.id, e.dbSuffix) };
}

/** A versão antiga grava de novo e o boot seguinte resgata de novo. */
async function segundoResgate(m) {
    await antigaDesenha(3, 27);
    const r2 = await m.resiliente.prepareLegacyTransitionResiliente();
    expect(r2.reparos?.[0]?.kind).toBe(m.resiliente.ReparoAutomatico.ALTERACOES_RECUPERADAS);
    return r2.reparos[0].entry;
}

const recuperados = (entradas) => entradas.filter(e => e.name?.includes('Recuperado'));

describe('um Recuperado só, enquanto ninguém trabalhar nele', () => {
    it('o segundo resgate com o primeiro INTOCADO deixa UM Recuperado, com tudo da versão antiga', async () => {
        await seed24();
        const m = await primeiroResgate();
        const segundo = await segundoResgate(m);

        const relatorio = await m.limpeza.pruneAbandonedCopies();

        const entradas = await m.ns.readLocalAtlasRegistry();
        expect(recuperados(entradas).map(e => e.id)).toEqual([segundo.id]);
        expect(entradas).toHaveLength(2);
        const principal = await m.ns.getStoreFor(m.ns.StoreName.MAPS, m.escopoDo(segundo)).getItem('Principal');
        expect(principal.features.coordination_lines).toHaveLength(3);
        // O disco do primeiro saiu junto com o registro.
        expect(await m.transition.inventoryScope(m.escopoDo(m.primeiro))).toEqual([]);
        expect(relatorio.recoveries).toContainEqual({ id: m.primeiro.id, outcome: 'superseded-dropped' });
    });

    it('o Recuperado em que a pessoa DESENHOU fica, e deixa de ser candidato', async () => {
        await seed24();
        const m = await primeiroResgate();
        const lojaDoPrimeiro = m.ns.getStoreFor(m.ns.StoreName.MAPS, m.escopoDo(m.primeiro));
        const principal = await lojaDoPrimeiro.getItem('Principal');
        principal.features.points = [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-50, -20] }, properties: { id: 'trabalho', source: 'point' } }];
        await lojaDoPrimeiro.setItem('Principal', principal);
        await segundoResgate(m);

        const relatorio = await m.limpeza.pruneAbandonedCopies();

        expect(recuperados(await m.ns.readLocalAtlasRegistry())).toHaveLength(2);
        expect((await lojaDoPrimeiro.getItem('Principal')).features.points[0].properties.id).toBe('trabalho');
        expect(relatorio.recoveries).toContainEqual({ id: m.primeiro.id, outcome: 'superseded-edited-kept' });
        const { readLegacyTransition } = await import('@store/migration/transition-state.js');
        expect((await readLegacyTransition()).recoverySuperseded).toEqual([]);
    });

    it('o Recuperado MONTADO em outra aba não sai enquanto a trava estiver tomada', async () => {
        await seed24();
        const m = await primeiroResgate();
        await segundoResgate(m);

        let soltar;
        const tomada = new Promise((resolve) => {
            navigator.locks.request(m.ns.atlasMountLockName(m.primeiro.dbSuffix), () => new Promise((r) => { soltar = r; resolve(); }));
        });
        await tomada;

        const enquanto = await m.limpeza.pruneAbandonedCopies();
        expect(enquanto.recoveries).toContainEqual({ id: m.primeiro.id, outcome: 'superseded-in-use' });
        expect(recuperados(await m.ns.readLocalAtlasRegistry())).toHaveLength(2);

        soltar();
        await new Promise((r) => setTimeout(r, 0));
        const depois = await m.limpeza.pruneAbandonedCopies();
        expect(depois.recoveries).toContainEqual({ id: m.primeiro.id, outcome: 'superseded-dropped' });
        expect(recuperados(await m.ns.readLocalAtlasRegistry())).toHaveLength(1);
    });
});

describe('o Recuperado abre direto', () => {
    it('o boot monta o Recuperado, mesmo com a aba apontando para o atlas atualizado', async () => {
        // A aba vinha do atlas atualizado: o ponteiro da aba vence o da instalação no boot.
        const sessao = new Map();
        globalThis.sessionStorage = {
            getItem: (k) => (sessao.has(k) ? sessao.get(k) : null),
            setItem: (k, v) => sessao.set(k, String(v)),
            removeItem: (k) => sessao.delete(k)
        };
        await seed24();
        const m = await primeiroResgate();
        const atualizado = (await m.ns.readLocalAtlasRegistry()).find(e => !e.name?.includes('Recuperado'));
        sessao.set(m.ns.TAB_MOUNT_KEY, JSON.stringify({ version: 1, kind: 'local', atlasId: atualizado.id, dbSuffix: atualizado.dbSuffix }));

        expect(await m.abrir.apontarParaORecuperado(m.primeiro)).toBe(true);

        const { initServices } = await import('@store/services.js');
        initServices();
        const store = await import('@store/store.js');
        await store.initializeWithLastActiveMap();
        expect(m.ns.getActiveScope()?.dbSuffix).toBe(m.primeiro.dbSuffix);
        expect(sessao.get('ebgeo_local_intent')).toBe('1');
    });

    it('com o mapa aberto, o vigia troca para o Recuperado ao vivo e o aviso diz que ele está aberto', async () => {
        await seed24();
        const m = await modules();
        const { state } = await m.transition.prepareLegacyTransition();
        const destino = m.ns.localScope(state.entry.id, state.destination);
        const principal = await m.ns.getStoreFor(m.ns.StoreName.MAPS, destino).getItem('Principal');
        principal.features.points = [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-47.9, -15.8] }, properties: { id: 'p1', source: 'point' } }];
        await m.ns.getStoreFor(m.ns.StoreName.MAPS, destino).setItem('Principal', principal);
        await antigaDesenha(2, 26);

        // O dublê mínimo de DOM do vizinho `transicao-resiliente.test.js`.
        const textos = [];
        const el = () => ({
            className: '', textContent: '', style: {}, dataset: {}, children: [],
            classList: { add() {}, remove() {}, contains: () => false },
            setAttribute() {}, getAttribute: () => null, removeAttribute() {},
            appendChild(c) { this.children.push(c); return c; },
            append(...n) { this.children.push(...n); }, remove() {},
            addEventListener() {}, getBoundingClientRect: () => ({ top: 0, height: 0, bottom: 0 })
        });
        const body = el();
        const ouvintes = new Map();
        globalThis.document = { body, createElement: el, querySelector: () => null, getElementById: () => null,
            addEventListener() {}, removeEventListener() {} };
        globalThis.window = { addEventListener: (nome, fn) => ouvintes.set(nome, fn), location: { reload() {} } };
        globalThis.requestAnimationFrame = () => 0;
        const antes = body.appendChild.bind(body);
        body.appendChild = (c) => { textos.push(c); return antes(c); };

        const abrirAtlas = vi.fn(async () => ({ ok: true }));
        const ui = await import('@js/ui/migration-recovery.js');
        ui.watchLegacyChanges({ abrirAtlas });
        await ouvintes.get('focus')();

        const recuperado = recuperados(await m.ns.readLocalAtlasRegistry())[0];
        expect(abrirAtlas).toHaveBeenCalledWith(recuperado.id);
        const texto = textos.map(t => [t.textContent, ...(t.children || []).flatMap(
            c => [c.textContent, ...(c.children || []).map(n => n.textContent)])].join(' ')).join(' ');
        expect(texto).toContain('que está aberto agora');
    });

    it('um id fora do registro não aponta nada', async () => {
        await seed24();
        const m = await primeiroResgate();
        expect(await m.abrir.apontarParaORecuperado({ id: 'nao-existe' })).toBe(false);
        expect(await m.abrir.apontarParaORecuperado(null)).toBe(false);
        expect(await m.ns.getGlobalStore().getItem(m.ns.GlobalKey.CURRENT_LOCAL_ATLAS)).not.toBe('nao-existe');
    });
});
