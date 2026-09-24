// Path: tests/store/foto-inline-convertida-na-proxima-edicao.test.js
//
// FASE 2c DAS FOTOS ANEXAS, A REDE DE SEGURANÇA (decisão do dono de 2026-09-24): nada converte o
// acervo em lote, nem no servidor nem no disco. Uma feição, um marcador 3D ou um marcador 360 de
// atlas de SERVIDOR que ainda carrega foto INLINE a converte na PRÓXIMA edição: os bytes vão para o
// armazém de imagens sob um id NOVO, a subida é registrada na fila durável, e a operação sai só com
// a referência e a miniatura. Antes, toda edição dessas entidades levava a foto inteira duas vezes
// (dado e anterior), e acima de 10 MB por operação a edição nunca sincronizava.
//
// O arnês é o de `escrita-de-conteudo-em-mapa-inexistente.repro.test.js`: repositório em memória,
// `feature.operations.js`, `cesium3d.operations.js`, `streetview360.operations.js` e
// `photo-attach.js` REAIS, e a porta do diário capturando o que o servidor receberia.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    getEmptyMapData,
    getEmptyCesium3dData,
    getEmptyStreetview360Data
} from '../../src/js/store/repository.utils.js';

const h = vi.hoisted(() => ({
    mapas: new Map(),
    laterais3d: new Map(),
    laterais360: new Map(),
    /** O que o servidor receberia: cada operação com o seu dado. */
    ops: [],
    /** O armazém de imagens do atlas. */
    imagens: new Map(),
    /** A fila de subida: um registro por blob. */
    envios: [],
    /** Atlas de servidor conectado? */
    online: true,
    /** O registro da subida responde assim. */
    registrado: true,
    /** A gravação da entidade falha? */
    falharGravacao: false,
    escopo: { atual: Object.freeze({ kind: 'remote', atlasId: 'atlas-1', dbSuffix: 'remote-atlas-1' }) },
    mapManager: {
        getCurrentMapName: vi.fn(() => 'Mapa'),
        getCurrentMapId: vi.fn(() => 'uuid-mapa'),
        getMapId: vi.fn(() => 'uuid-mapa'),
        getFeatureColor: vi.fn(() => null),
        getFeatureColors: vi.fn(() => []),
        updateColorUsage: vi.fn(),
        recordAction: vi.fn()
    }
}));

vi.mock('../../src/js/store/repositories/index.js', () => {
    const lateral = (loja, vazio) => ({
        ler: async (mapa) => loja.get(mapa) ?? vazio(),
        gravar: async (mapa, dados) => {
            if (h.falharGravacao) throw new Error('quota');
            loja.set(mapa, structuredClone(dados));
        }
    });
    const tresD = lateral(h.laterais3d, getEmptyCesium3dData);
    const trescentos = lateral(h.laterais360, getEmptyStreetview360Data);
    return {
        getExistingMapData: vi.fn(async (mapa) => structuredClone(h.mapas.get(mapa) ?? null)),
        getMapDataCompat: vi.fn(async (mapa) => structuredClone(h.mapas.get(mapa) ?? getEmptyMapData())),
        updateMapDataCompat: vi.fn(async (mapa, documento) => {
            if (h.falharGravacao) throw new Error('quota');
            h.mapas.set(mapa, structuredClone(documento));
        }),
        getLayersCompat: vi.fn(async () => []),
        getCesium3dCompat: vi.fn(tresD.ler),
        setCesium3dCompat: vi.fn(tresD.gravar),
        getStreetview360Compat: vi.fn(trescentos.ler),
        setStreetview360Compat: vi.fn(trescentos.gravar)
    };
});

vi.mock('../../src/js/store/atlas-namespace.js', () => ({
    StoreScopeKind: Object.freeze({ LOCAL: 'local', REMOTE: 'remote' }),
    getActiveScope: () => h.escopo.atual
}));

vi.mock('../../src/js/store/sync/permission-guard.js', () => ({
    checkPermission: vi.fn(() => ({ allowed: true })),
    GuardAction: {
        CREATE_FEATURE: 'EDIT', UPDATE_FEATURE: 'EDIT', DELETE_FEATURE: 'DELETE',
        CREATE_MARKER_3D: 'EDIT', DELETE_MARKER_3D: 'DELETE',
        CREATE_MARKER_360: 'EDIT', DELETE_MARKER_360: 'DELETE'
    }
}));

vi.mock('../../src/js/store/map.operations.js', () => ({ isCurrentMapLockedSync: vi.fn(() => false) }));

vi.mock('../../src/js/store/settings.operations.js', () => ({
    storeImage: vi.fn(async (id, blob) => { h.imagens.set(id, blob); }),
    removeImage: vi.fn(async (id) => { h.imagens.delete(id); })
}));

vi.mock('../../src/js/store/sync/image-sync.js', () => ({
    isImageSyncOnline: () => h.online,
    registrarEnvioDeImagem: vi.fn(async (blob, id, { origem }) => {
        const envio = { id, origem, bytes: blob.size, enviado: false, descartado: false };
        h.envios.push(envio);
        return {
            registrado: h.registrado,
            enviar: vi.fn(async () => { envio.enviado = true; }),
            descartar: vi.fn(async () => { envio.descartado = true; })
        };
    })
}));

vi.mock('../../src/js/store/sync/index.js', async () => ({
    OperationType: (await import('../../src/js/store/sync/operation-types.js')).OperationType
}));

vi.mock('../../src/js/store/sync/operation-dispatcher.js', () => ({
    persistOperationIntents: vi.fn(async (operations) => {
        for (const op of operations) h.ops.push(structuredClone({ entityType: op.entityType, data: op.data, previousData: op.previousData }));
        return async () => {};
    })
}));

vi.mock('../../src/js/store/store-state-manager.js', () => ({ default: h.mapManager }));

vi.mock('../../src/js/store/memory-store.js', () => ({
    memoryStore: {
        lockedMaps: new Set(),
        isUndoing: false,
        isRedoing: false,
        currentMap: 'Mapa',
        cesium3d: { cameraPositions: {}, markers: [], measurements: [], viewsheds: [], _mapName: null },
        streetview360: { orientations: {}, markers: [], _mapName: null }
    }
}));

vi.mock('../../src/js/store/services/map-resolver.service.js', () => ({
    mapResolver: {
        isInitialized: true,
        resolveToId: vi.fn((x) => x),
        resolveToName: vi.fn((x) => x),
        getIdForName: vi.fn((x) => x),
        registerMap: vi.fn()
    }
}));

vi.mock('../../src/js/events', () => ({
    EventTypes: {
        LAYERS_CHANGED: 'layers:changed',
        MARKERS_3D_CHANGED: 'markers3d:changed',
        MARKERS_360_CHANGED: 'markers360:changed'
    }
}));

import { updateFeature, updateFeatureProperty, setFeatureDependencies } from '../../src/js/store/feature.operations.js';
import { updateMarker, setCesium3dDependencies } from '../../src/js/store/cesium3d.operations.js';
import { updateMarker360, setStreetview360Dependencies } from '../../src/js/store/streetview360.operations.js';
import { setStoreErrorEventBus } from '../../src/js/store/store-errors.js';

const MAPA = 'Mapa';
const MINIATURA = 'data:image/jpeg;base64,/9j/mini';
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
const INLINE = `data:image/jpeg;base64,${btoa(String.fromCharCode(...JPEG))}`;
const inline = (id) => ({ id, name: `${id}.jpg`, type: 'image/png', size: 9, data: INLINE, thumbnail: MINIATURA, addedAt: 1 });
const referencia = { id: 'ja-ref', name: 'nova.jpg', type: 'image/jpeg', thumbnail: MINIATURA, addedAt: 2 };

function ponto(fotos) {
    return {
        type: 'Feature', id: 1,
        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
        properties: { id: 'p1', source: 'point', nome: 'Antes', layerId: 'default', images: fotos }
    };
}

const feicaoGravada = () => h.mapas.get(MAPA).features.points[0];
const opsDeFeicao = () => h.ops.filter((op) => op.entityType === 'feature');

beforeEach(() => {
    vi.clearAllMocks();
    h.mapas.clear();
    h.laterais3d.clear();
    h.laterais360.clear();
    h.ops.length = 0;
    h.imagens.clear();
    h.envios.length = 0;
    h.online = true;
    h.registrado = true;
    h.falharGravacao = false;
    const documento = getEmptyMapData();
    documento.id = 'uuid-mapa';
    documento.name = MAPA;
    documento.features.points = [ponto([inline('velha'), referencia, inline('velha')])];
    h.mapas.set(MAPA, documento);
    const barramento = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
    setStoreErrorEventBus(barramento);
    setFeatureDependencies({ eventBus: barramento, groupManager: { removeFeatureFromAllGroups: vi.fn(() => null) }, layerManager: {} });
    setCesium3dDependencies({ eventBus: barramento });
    setStreetview360Dependencies({ eventBus: barramento });
});

describe('feição de atlas de servidor com foto inline: a próxima edição converte', () => {
    it('updateFeatureProperty: a op sai sem bytes, sob id NOVO, e a subida começa depois da gravação', async () => {
        await updateFeatureProperty('points', 'p1', 'nome', 'Depois', MAPA);

        const [op] = opsDeFeicao();
        const fotos = op.data.properties.images;
        expect(op.data.properties.nome).toBe('Depois');
        // NEM o lado NOVO nem o ANTERIOR levam os bytes: o envelope carrega `previousData` inteiro.
        expect(JSON.stringify(op)).not.toContain(INLINE);
        expect(op.previousData.properties.images[0]).toEqual({ id: 'velha', name: 'velha.jpg', type: 'image/png', size: 9, thumbnail: MINIATURA, addedAt: 1 });
        expect(op.previousData.properties.nome).toBe('Antes');
        expect(fotos).toHaveLength(3);
        const [primeira, ref, duplicata] = fotos;
        expect(primeira.id).not.toBe('velha');
        expect(primeira).toEqual({ id: primeira.id, name: 'velha.jpg', type: 'image/jpeg', size: 9, thumbnail: MINIATURA, addedAt: 1 });
        // A duplicata da MESMA foto é um blob só.
        expect(duplicata.id).toBe(primeira.id);
        expect(ref).toEqual(referencia);

        expect(h.envios).toEqual([{ id: primeira.id, origem: 'foto-convertida', bytes: JPEG.length, enviado: true, descartado: false }]);
        expect(new Uint8Array(await h.imagens.get(primeira.id).arrayBuffer())).toEqual(JPEG);
        // O documento gravado concorda com a op.
        expect(feicaoGravada().properties.images).toEqual(fotos);
    });

    it('updateFeature converte pelo mesmo caminho', async () => {
        const editada = ponto([inline('velha')]);
        editada.properties.nome = 'Movida';
        editada.geometry.coordinates = [-43.3, -22.8];
        await updateFeature('points', editada, MAPA);
        const [op] = opsDeFeicao();
        expect(op.data.properties.images[0]).not.toHaveProperty('data');
        expect(JSON.stringify(op)).not.toContain(INLINE);
        expect(h.envios.map((e) => e.enviado)).toEqual([true]);
    });

    it('atlas LOCAL (nenhum atlas de servidor conectado): nada muda, nada é gravado no armazém', async () => {
        h.online = false;
        await updateFeatureProperty('points', 'p1', 'nome', 'Depois', MAPA);
        expect(opsDeFeicao()[0].data.properties.images[0].data).toBe(INLINE);
        expect(h.imagens.size).toBe(0);
        expect(h.envios).toEqual([]);
    });

    it('subida que não se registra: a edição sai como antes, com a foto inline, e os bytes gravados saem do armazém', async () => {
        h.registrado = false;
        await updateFeatureProperty('points', 'p1', 'nome', 'Depois', MAPA);
        expect(opsDeFeicao()[0].data.properties.images[0].data).toBe(INLINE);
        expect(h.imagens.size).toBe(0);
    });

    // UM ERRO NÃO É UMA RECUSA (revisão da fase 2c, 2026-09-24). A gravação da entidade falha DEPOIS
    // de a intenção estar no diário; a intenção será reprojetada e enviada citando a foto, então os
    // bytes e a pendência ficam e sobem. Antes, eles eram apagados e o servidor recebia uma
    // referência para uma foto que ninguém ia mandar.
    it('gravação que falha depois da intenção: os bytes ficam e sobem', async () => {
        h.falharGravacao = true;
        await expect(updateFeatureProperty('points', 'p1', 'nome', 'Depois', MAPA)).rejects.toThrow();
        const [op] = opsDeFeicao();
        const citada = op.data.properties.images[0].id;
        expect(h.envios).toEqual([expect.objectContaining({ id: citada, enviado: true, descartado: false })]);
        expect(h.imagens.has(citada)).toBe(true);
    });

    it('a próxima edição de uma feição JÁ convertida não converte de novo', async () => {
        await updateFeatureProperty('points', 'p1', 'nome', 'Uma', MAPA);
        await updateFeatureProperty('points', 'p1', 'nome', 'Duas', MAPA);
        expect(h.envios).toHaveLength(1);
        expect(opsDeFeicao()[1].data.properties.images[0].id).toBe(opsDeFeicao()[0].data.properties.images[0].id);
    });
});

describe('marcador 3D e marcador 360: o mesmo, no funil de cada documento lateral', () => {
    it('updateMarker (3D) converte a foto do marcador', async () => {
        const doc = getEmptyCesium3dData();
        doc.markers = [{ id: 'm3d', tilesetId: 't1', properties: { nome: 'M' }, images: [inline('m3d-foto')] }];
        h.laterais3d.set(MAPA, doc);
        await updateMarker('m3d', { properties: { nome: 'M2' } }, MAPA);
        const op = h.ops.find((o) => o.entityType !== 'feature');
        expect(op.data.images[0]).not.toHaveProperty('data');
        expect(op.data.images[0].id).not.toBe('m3d-foto');
        expect(JSON.stringify(op)).not.toContain(INLINE);
        expect(h.envios).toMatchObject([{ origem: 'foto-convertida-3d', enviado: true }]);
        expect(h.laterais3d.get(MAPA).markers[0].images[0].id).toBe(op.data.images[0].id);
    });

    it('updateMarker360 converte a foto do marcador', async () => {
        const doc = getEmptyStreetview360Data();
        doc.markers = [{ id: 'm360', photoName: 'p', position: { heading: 0, pitch: 0 }, properties: { nome: 'M' }, images: [inline('m360-foto')], sync: { version: 1 } }];
        h.laterais360.set(MAPA, doc);
        await updateMarker360('m360', { properties: { nome: 'M2' } }, MAPA);
        const op = h.ops.find((o) => o.entityType !== 'feature');
        expect(op).toBeDefined();
        expect(op.data.images[0]).not.toHaveProperty('data');
        expect(JSON.stringify(op)).not.toContain(INLINE);
        expect(h.envios).toMatchObject([{ origem: 'foto-convertida-360', enviado: true }]);
    });
});
