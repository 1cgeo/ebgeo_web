// Path: tests/unit/fotos-descem-antes-da-copia.repro.test.js

/**
 * @fileoverview A cópia que sai do servidor leva as fotos por referência que este computador ainda
 * não tem (2026-09-24, item 2 da segunda revisão das fotos anexas).
 *
 * O DEFEITO. Desde a fase 2b uma foto anexa é um blob no banco de imagens, e o item guarda só a
 * referência e a miniatura. Neste navegador o blob existe só se alguém aqui anexou ou abriu a foto:
 * a de um colega, e a antiga inline que outro cliente converteu, descem do servidor sob demanda
 * (`getImage` cai nele). "Salvar como local" copia os bancos como estão e o RESGATE adota o
 * namespace sem mover um byte, e um atlas LOCAL não tem servidor onde cair: essas fotos ficavam com
 * a miniatura para sempre, enquanto o diálogo prometia que o conteúdo desenhado "vai inteiro".
 *
 * O QUE ESTE VERDE PROVARIA SE O CÓDIGO ESTIVESSE ERRADO. Os casos do resgate semeiam a foto de um
 * colega SÓ no documento do mapa, com o banco de imagens vazio, e exigem os bytes no banco que o
 * atlas local adotado passa a ler (nome do banco escrito à mão, não derivado do módulo sob teste).
 * Sem a descida, o banco continua vazio e o caso reprova. O caso sem rede exige a foto NOMEADA na
 * frase, porque uma perda que ninguém declara era exatamente o defeito.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Disco falso chaveado por (nome do banco, object store), como em
// tests/unit/resgate-trabalho-nao-sincronizado.repro.test.js: a pergunta é EM QUAL banco o byte caiu.
// ============================================================================

const { databases, dropFromFake, makeStore, resetFake } = vi.hoisted(() => {
    const databases = new Map();

    function keyOf(name, storeName) {
        return `${name}::${storeName || 'keyvaluepairs'}`;
    }

    function makeStore({ name, storeName = null }) {
        const key = keyOf(name, storeName);
        const backing = databases.get(key) ?? new Map();
        databases.set(key, backing);
        return {
            __dbName: name,
            setItem: async (k, v) => { backing.set(k, v); return v; },
            getItem: async (k) => (backing.has(k) ? backing.get(k) : null),
            removeItem: async (k) => { backing.delete(k); },
            keys: async () => [...backing.keys()],
            length: async () => backing.size,
            clear: async () => { backing.clear(); },
            iterate: async (callback) => {
                for (const [k, v] of backing.entries()) callback(v, k);
            }
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
    default: {
        createInstance: vi.fn(makeStore),
        dropInstance: vi.fn(dropFromFake)
    }
}));

vi.mock('@utils/toast_service.js', () => ({
    showToast: vi.fn(), showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn(),
    showInChannel: vi.fn(),
}));

const ATLAS = '22222222-2222-4222-8222-222222222222';
const FOTO_DO_COLEGA = 'aaaaaaaa-0000-4000-8000-000000000001';
const FOTO_MINHA = 'aaaaaaaa-0000-4000-8000-000000000002';
const FOTO_3D = 'aaaaaaaa-0000-4000-8000-000000000003';
const FOTO_360 = 'aaaaaaaa-0000-4000-8000-000000000004';
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** O banco de imagens do atlas remoto, com o nome escrito à mão. */
function bancoDeImagens(atlasId) {
    return databases.get(`ebgeo_images__remote-${atlasId}::keyvaluepairs`) ?? new Map();
}

let ns;
let remoteApi;
let localApi;
let origem;
let saida;
let copia;
let api;

beforeEach(async () => {
    vi.resetModules();
    resetFake();
    ns = await import('@store/atlas-namespace.js');
    remoteApi = await import('@store/remote-atlas.api.js');
    localApi = await import('@store/local-atlas.api.js');
    origem = await import('@store/store-origin.js');
    saida = await import('@js/session/unsynced-work-exit.js');
    copia = await import('@store/fotos-para-copia.js');
    api = (await import('@store/sync/api-client.js')).apiClient;
});

/**
 * Um atlas de servidor montado cujo mapa cita duas fotos por referência (a do colega, que este
 * computador nunca abriu, e a minha, que está no banco) e uma inline antiga, que carrega os bytes.
 */
async function atlasComFotoDoColega({ com3dE360 = false } = {}) {
    await localApi.initLocalAtlases();
    await remoteApi.activateRemoteAtlas(ATLAS);
    await origem.markStoreRemote(ATLAS);
    const escopo = ns.remoteScope(ATLAS);
    await ns.getStoreFor(ns.StoreName.MAPS, escopo).setItem('mapa-1', {
        name: 'Principal',
        features: {
            points: [{
                id: 'f1',
                properties: {
                    nome: 'Ponte',
                    images: [
                        { id: FOTO_DO_COLEGA, name: 'ponte-do-colega.jpg', thumbnail: 'data:image/jpeg;base64,AA==' },
                        { id: FOTO_MINHA, name: 'minha.jpg', thumbnail: 'data:image/jpeg;base64,AA==' },
                        { id: 'inline-antiga', name: 'antiga.png', data: 'data:image/png;base64,iVBORw0KGgo=' },
                    ],
                },
            }],
        },
    });
    await ns.getStoreFor(ns.StoreName.IMAGES, escopo).setItem(FOTO_MINHA, new Blob([PNG], { type: 'image/png' }));
    if (com3dE360) {
        await ns.getStoreFor(ns.StoreName.CESIUM3D, escopo).setItem('mapa-1', {
            markers: [{ id: 'm1', images: [{ id: FOTO_3D, name: 'modelo.jpg' }] }],
        });
        await ns.getStoreFor(ns.StoreName.STREETVIEW360, escopo).setItem('mapa-1', {
            markers: [{ id: 'm2', images: [FOTO_360] }],
        });
    }
    return escopo;
}

/** Uma pendência de foto não confirmada: é o que faz o resgate involuntário ter trabalho a guardar. */
async function comTrabalhoPendente(escopo) {
    await ns.getStoreFor(ns.StoreName.IMAGES, escopo).setItem(`upload_pendente__${FOTO_MINHA}`, {
        id: FOTO_MINHA, estado: 'pendente', origem: 'foto-anexa',
    });
}

// ============================================================================
// 1. A descida
// ============================================================================

describe('baixarFotosQueFaltam: as fotos por referência que este computador não tem', () => {
    it('baixa só a que falta, grava no banco de imagens do atlas, e não pede a que já está', async () => {
        const escopo = await atlasComFotoDoColega();
        const pedidos = [];
        const cliente = {
            fetchImageBlob: async (atlasId, id) => {
                pedidos.push([atlasId, id]);
                return new Blob([PNG], { type: 'image/png' });
            },
        };

        const r = await copia.baixarFotosQueFaltam(escopo, ATLAS, { cliente });

        expect(pedidos).toEqual([[ATLAS, FOTO_DO_COLEGA]]);
        expect(r).toEqual({ total: 2, baixadas: 1, faltaram: [] });
        expect(bancoDeImagens(ATLAS).get(FOTO_DO_COLEGA)).toBeInstanceOf(Blob);
    });

    it('percorre também os documentos de 3D e de 360 (id solto conta como referência)', async () => {
        const escopo = await atlasComFotoDoColega({ com3dE360: true });
        const pedidos = [];
        const cliente = {
            fetchImageBlob: async (_atlasId, id) => { pedidos.push(id); return new Blob([PNG]); },
        };

        const r = await copia.baixarFotosQueFaltam(escopo, ATLAS, { cliente });

        expect(pedidos.sort()).toEqual([FOTO_DO_COLEGA, FOTO_3D, FOTO_360].sort());
        expect(r.baixadas).toBe(3);
        expect(r.faltaram).toEqual([]);
    });

    it('a que o servidor recusa entra em faltaram com o NOME, e as seguintes continuam', async () => {
        const escopo = await atlasComFotoDoColega({ com3dE360: true });
        const cliente = {
            fetchImageBlob: async (_atlasId, id) => {
                if (id === FOTO_DO_COLEGA) throw Object.assign(new Error('HTTP 404'), { status: 404 });
                return new Blob([PNG]);
            },
        };

        const r = await copia.baixarFotosQueFaltam(escopo, ATLAS, { cliente });

        expect(r.faltaram).toEqual([{ id: FOTO_DO_COLEGA, nome: 'ponte-do-colega.jpg' }]);
        expect(r.baixadas).toBe(2);
        expect(bancoDeImagens(ATLAS).has(FOTO_DO_COLEGA)).toBe(false);
    });

    it('o PRAZO vale para a descida inteira: um pedido que não volta não segura a pessoa', async () => {
        const escopo = await atlasComFotoDoColega({ com3dE360: true });
        const cliente = { fetchImageBlob: () => new Promise(() => {}) };

        const inicio = Date.now();
        const r = await copia.baixarFotosQueFaltam(escopo, ATLAS, { cliente, prazoMs: 40 });

        expect(Date.now() - inicio).toBeLessThan(2000);
        expect(r.faltaram.map((f) => f.id).sort()).toEqual([FOTO_DO_COLEGA, FOTO_3D, FOTO_360].sort());
        expect(r.baixadas).toBe(0);
    });

    it('resposta sem bytes é falta, não sucesso', async () => {
        const escopo = await atlasComFotoDoColega();
        const cliente = { fetchImageBlob: async () => null };

        const r = await copia.baixarFotosQueFaltam(escopo, ATLAS, { cliente });

        expect(r.faltaram).toEqual([{ id: FOTO_DO_COLEGA, nome: 'ponte-do-colega.jpg' }]);
    });

    it('avisa QUANTAS vai pedir antes do primeiro pedido, e se cala quando nada falta', async () => {
        const escopo = await atlasComFotoDoColega({ com3dE360: true });
        const ordem = [];
        const cliente = { fetchImageBlob: async (_a, id) => { ordem.push(`pedido ${id}`); return new Blob([PNG]); } };

        await copia.baixarFotosQueFaltam(escopo, ATLAS, { cliente, aoBaixar: (n) => ordem.push(`aviso ${n}`) });
        expect(ordem[0]).toBe('aviso 3');
        expect(ordem).toHaveLength(4);

        const depois = [];
        await copia.baixarFotosQueFaltam(escopo, ATLAS, { cliente, aoBaixar: (n) => depois.push(n) });
        expect(depois).toEqual([]);
    });

    it('sem atlas de servidor, lista o que falta sem pedir nada', async () => {
        const escopo = await atlasComFotoDoColega();
        const cliente = { fetchImageBlob: vi.fn() };

        const r = await copia.baixarFotosQueFaltam(escopo, null, { cliente });

        expect(cliente.fetchImageBlob).not.toHaveBeenCalled();
        expect(r.faltaram).toEqual([{ id: FOTO_DO_COLEGA, nome: 'ponte-do-colega.jpg' }]);
    });
});

// ============================================================================
// 2. O resgate
// ============================================================================

describe('o resgate traz as fotos antes de adotar o namespace', () => {
    it('a foto do colega fica no banco que o atlas LOCAL resgatado lê', async () => {
        await atlasComFotoDoColega();
        vi.spyOn(api, 'fetchImageBlob').mockImplementation(async () => new Blob([PNG], { type: 'image/png' }));

        const preservado = await saida.preserveUnsyncedWorkAsLocal(ATLAS, 'Operação Alfa');

        expect(preservado).toBe(true);
        const resgatado = localApi.listLocalAtlases().find((a) => a.name === 'Operação Alfa');
        expect(resgatado?.dbSuffix).toBe(`remote-${ATLAS}`);
        expect(bancoDeImagens(ATLAS).get(FOTO_DO_COLEGA)).toBeInstanceOf(Blob);
        expect(saida.fotosQueFicaramNoResgate(ATLAS)).toEqual([]);
        expect(saida.avisoDeFotosDoResgate(ATLAS)).toBe('');
    });

    it('sem rede o resgate NÃO falha, e a foto que ficou só com a miniatura é NOMEADA', async () => {
        await atlasComFotoDoColega();
        vi.spyOn(api, 'fetchImageBlob').mockRejectedValue(new TypeError('Failed to fetch'));

        const preservado = await saida.preserveUnsyncedWorkAsLocal(ATLAS, 'Operação Alfa');

        expect(preservado).toBe(true);
        expect(saida.fotosQueFicaramNoResgate(ATLAS)).toEqual([{ id: FOTO_DO_COLEGA, nome: 'ponte-do-colega.jpg' }]);
        const aviso = saida.avisoDeFotosDoResgate(ATLAS);
        expect(aviso).toContain('"ponte-do-colega.jpg"');
        expect(aviso).toContain('só com a miniatura');
    });

    it('o download ADIANTADO (antes do logout) é o mesmo que o resgate usa: um pedido só', async () => {
        await atlasComFotoDoColega();
        const pedido = vi.spyOn(api, 'fetchImageBlob').mockImplementation(async () => new Blob([PNG]));

        await saida.trazerFotosDoResgate(ATLAS);
        await saida.preserveUnsyncedWorkAsLocal(ATLAS, 'Operação Alfa');

        expect(pedido).toHaveBeenCalledTimes(1);
        expect(bancoDeImagens(ATLAS).get(FOTO_DO_COLEGA)).toBeInstanceOf(Blob);
    });

    it('a saída involuntária de uma página sem mapa leva a CONTAGEM das fotos que ficaram', async () => {
        const escopo = await atlasComFotoDoColega();
        await comTrabalhoPendente(escopo);
        vi.spyOn(api, 'fetchImageBlob').mockRejectedValue(new TypeError('Failed to fetch'));

        const r = await saida.preserveUnsyncedWorkOnLostSession({ atlasId: ATLAS, atlasName: 'Operação Alfa' });

        expect(r.preserved).toBe(true);
        expect(r.photosOnlyThumbnail).toBe(1);
        expect(r.message).toContain('só com a miniatura');
    });
});
