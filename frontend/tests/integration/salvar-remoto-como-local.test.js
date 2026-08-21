// Path: tests/integration/salvar-remoto-como-local.test.js

/**
 * @fileoverview "Salvar como local": a cópia perde o restrito e a ORIGEM não é tocada.
 *
 * O DEFEITO QUE ESTA ARQUITETURA CONVIDA, e que só este arquivo pega: toda operação de
 * store resolve contra o escopo ATIVO, e no caminho "Salvar como local" o escopo ativo é o
 * atlas REMOTO de origem. Podar pelas operações de store — que é o caminho natural — não
 * poda a cópia: poda o atlas do SERVIDOR. Nenhum teste de função pura nota isso, porque as
 * funções puras estão certas nos dois casos.
 *
 * A FÁBRICA DE NAMESPACE É REAL AQUI (só o `localforage` é falso), pelo mesmo motivo que em
 * `namespace-remoto-fiacao.test.js`: a pergunta é EM QUAL BANCO cada escrita caiu, e um
 * dublê da fábrica responderia o que o teste quisesse.
 *
 * O PISO fica ENTRE a cópia e a poda: depois de `copyAtlasDatabases` e antes de
 * `podarEscopo`, o destino precisa carregar o id restrito E o público nos quatro documentos.
 * Sem ele, um destino vazio passaria a poda com louvor.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Disco falso, chaveado por (nome do banco, object store).
// ============================================================================

const { dropFromFake, makeStore, resetFake } = vi.hoisted(() => {
    const databases = new Map();

    function makeStore({ name, storeName = null }) {
        const key = `${name}::${storeName || 'keyvaluepairs'}`;
        const backing = databases.get(key) ?? new Map();
        databases.set(key, backing);
        return {
            __dbName: name,
            setItem: vi.fn(async (k, v) => { backing.set(k, v); return v; }),
            getItem: vi.fn(async (k) => (backing.has(k) ? backing.get(k) : null)),
            removeItem: vi.fn(async (k) => { backing.delete(k); }),
            keys: vi.fn(async () => [...backing.keys()]),
            length: vi.fn(async () => backing.size),
            clear: vi.fn(async () => { backing.clear(); }),
            iterate: vi.fn(async (callback) => {
                for (const [k, v] of [...backing.entries()]) callback(v, k);
            }),
        };
    }

    async function dropFromFake({ name }) {
        for (const key of [...databases.keys()]) {
            if (key.startsWith(`${name}::`)) databases.delete(key);
        }
    }

    return { databases, dropFromFake, makeStore, resetFake: () => databases.clear() };
});

vi.mock('localforage', () => ({
    default: { createInstance: vi.fn(makeStore), dropInstance: vi.fn(dropFromFake) },
}));

vi.mock('@utils/tab-lock.js', async (importOriginal) => ({
    ...await importOriginal(),
    announceTabLockTeardown: vi.fn(async () => undefined),
}));

import * as ns from '@store/atlas-namespace.js';
import * as localApi from '@store/local-atlas.api.js';
import * as remoteApi from '@store/remote-atlas.api.js';
import * as origem from '@store/store-origin.js';
import { RefVerdict } from '@catalog/private-reference-pruner.js';

const ATLAS_REMOTO = '33333333-3333-4333-8333-333333333333';
const PUBLICO = 'tileset-publico';
const RESTRITO = 'tileset-restrito';
const FOTO = 'foto-restrita.jpg';
const MODELO = 'modelo-restrito';

/** Resolver injetado: só o público resolve. */
const resolver = (grupo, id) => (id === PUBLICO ? RefVerdict.PUBLIC : RefVerdict.UNKNOWN);

beforeEach(async () => {
    resetFake();
    vi.clearAllMocks();
    ns.clearStoreCache();
    ns.clearActiveScope();
    await origem.loadStoreOrigin();
    await localApi.initLocalAtlases();
});

/** Semeia os quatro documentos do escopo com um par (público, restrito). */
async function semearAtlas(escopo) {
    await ns.getStoreFor(ns.StoreName.MAPS, escopo).setItem('Principal', {
        name: 'Principal',
        baseLayer: PUBLICO,
        catalogLayers: [{ id: `data-${RESTRITO}`, type: 'data_layer', visible: true }],
        features: { points: [{ id: 'f1', properties: { nome: 'Ponto' } }] },
    });
    await ns.getStoreFor(ns.StoreName.CESIUM3D, escopo).setItem('Principal', {
        cameraPositions: {},
        markers: [
            { id: 'm1', tilesetId: PUBLICO },
            { id: 'm2', tilesetId: RESTRITO },
        ],
        measurements: [],
        viewsheds: [],
    });
    await ns.getStoreFor(ns.StoreName.STREETVIEW360, escopo).setItem('Principal', {
        orientations: { [FOTO]: { lon: 1, lat: 2, fov: 75 } },
        markers: [{ id: 's1', photoName: FOTO }],
    });
    await ns.getStoreFor(ns.StoreName.BRIEFINGS, escopo).setItem('b1', {
        id: 'b1',
        name: 'Briefing',
        slides: [{ id: 'sl1', title: 'Prosa', mode: '3d', modelId: MODELO }],
    });
}

/** O JSON dos quatro documentos de um escopo, concatenado. */
async function retrato(escopo) {
    const partes = [];
    for (const nome of [ns.StoreName.MAPS, ns.StoreName.CESIUM3D,
        ns.StoreName.STREETVIEW360, ns.StoreName.BRIEFINGS]) {
        const store = ns.getStoreFor(nome, escopo);
        const chaves = await store.keys();
        for (const chave of chaves) partes.push(JSON.stringify(await store.getItem(chave)));
    }
    return partes.join('\n');
}

describe('saveActiveRemoteAtlasAsLocal', () => {
    it('recusa quando o escopo ativo NÃO é um atlas de servidor', async () => {
        // O nome da função já diz "remote", e um chamador que a use sobre um slot local
        // duplicaria bancos com identidade errada. É bug do chamador, então lança.
        await expect(localApi.saveActiveRemoteAtlasAsLocal('Cópia', resolver)).rejects.toThrow(/servidor/);
    });

    it('exige o resolver: podar sem ele apagaria o catálogo inteiro em silêncio', async () => {
        await remoteApi.activateRemoteAtlas(ATLAS_REMOTO, 'Atlas do servidor');
        await expect(localApi.saveActiveRemoteAtlasAsLocal('Cópia', null)).rejects.toThrow(/resolver/);
    });

    it('a cópia perde o restrito, mantém o público, e a ORIGEM fica intacta', async () => {
        await remoteApi.activateRemoteAtlas(ATLAS_REMOTO, 'Atlas do servidor');
        const escopoRemoto = ns.remoteScope(ATLAS_REMOTO);
        await semearAtlas(escopoRemoto);

        // PISO: a origem carrega os quatro ids antes de qualquer coisa.
        const antes = await retrato(escopoRemoto);
        for (const id of [PUBLICO, RESTRITO, FOTO, MODELO]) {
            expect(antes, `a origem precisa citar ${id}`).toContain(id);
        }

        const resultado = await localApi.saveActiveRemoteAtlasAsLocal('Cópia local', resolver);
        expect(resultado.ok).toBe(true);

        const escopoLocal = localApi.scopeOfLocalAtlas(resultado.atlas);
        const depois = await retrato(escopoLocal);

        // A cópia: o público ficou, os três restritos sumiram.
        expect(depois).toContain(PUBLICO);
        for (const id of [RESTRITO, FOTO, MODELO]) {
            expect(depois, `a cópia não pode citar ${id}`).not.toContain(id);
        }
        // E o que não é referência de recurso não foi tocado.
        expect(depois).toContain('"nome":"Ponto"');
        expect(depois).toContain('"title":"Prosa"');

        // A DISCRIMINAÇÃO QUE DÁ NOME AO ARQUIVO: o atlas do SERVIDOR, que continua montado,
        // carrega os quatro ids intactos. É o único caso que pega a poda contra o escopo
        // ATIVO em vez do destino.
        expect(await retrato(escopoRemoto)).toBe(antes);

        // O relatório conta o que caiu, por superfície.
        expect(resultado.relatorio.total).toBe(5);
        expect(Object.keys(resultado.relatorio.porSuperficie).sort()).toEqual([
            'briefing.slide.modelId',
            'cesium3d.markers',
            'mapa.catalogLayers',
            'sv360.markers',
            'sv360.orientations',
        ]);
    });

    it('a cópia é um SLOT LOCAL novo, registrado com identidade própria', async () => {
        // Sem a reescrita do registro, a cópia se apresentaria com o id e o nome do atlas de
        // servidor, e a tela mostraria dois cartões com o mesmo nome.
        await remoteApi.activateRemoteAtlas(ATLAS_REMOTO, 'Atlas do servidor');
        await semearAtlas(ns.remoteScope(ATLAS_REMOTO));

        const resultado = await localApi.saveActiveRemoteAtlasAsLocal('Cópia local', resolver);
        const escopoLocal = localApi.scopeOfLocalAtlas(resultado.atlas);
        const registro = await ns.getStoreFor(ns.StoreName.ATLAS, escopoLocal)
            .getItem(ns.ATLAS_RECORD_KEY);

        expect(registro.id).toBe(resultado.atlas.id);
        expect(registro.name).toBe('Cópia local');
        expect(localApi.listLocalAtlases().map((a) => a.name)).toContain('Cópia local');

        // E a aba continua onde estava: copiar não monta nem troca o atlas ativo.
        expect(ns.getActiveScope()).toEqual(ns.remoteScope(ATLAS_REMOTO));
    });
});
