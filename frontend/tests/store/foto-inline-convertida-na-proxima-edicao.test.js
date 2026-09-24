// Path: tests/store/foto-inline-convertida-na-proxima-edicao.test.js
//
// FASE 2c DAS FOTOS ANEXAS, A REDE DE SEGURANÇA (decisão do dono de 2026-09-24): nada converte o
// acervo em lote, nem no servidor nem no disco. Um marcador 3D ou 360 de atlas de SERVIDOR que ainda
// carrega foto INLINE a converte na PRÓXIMA edição; uma FEIÇÃO, na próxima edição DAS FOTOS (desde a
// segunda revisão, 2026-09-24: a edição sem relação com elas não as converte nem as reivindica no
// patch, e o lado anterior viaja sem os bytes). Na conversão, os bytes vão para o
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
    /** O armazém de imagens recusa a escrita (cota)? */
    falharArmazem: false,
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
    storeImage: vi.fn(async (id, blob) => {
        if (h.falharArmazem) throw new DOMException('Cota excedida', 'QuotaExceededError');
        h.imagens.set(id, blob);
    }),
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

// O PROCESSAMENTO da foto anexa usa canvas, que node não tem; o resto do módulo é o real.
vi.mock('../../src/js/utilities/image_utils.js', async (importOriginal) => ({
    ...(await importOriginal()),
    processImageFile: vi.fn(async () => ({
        blob: new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9])], { type: 'image/jpeg' }),
        thumbnail: 'data:image/jpeg;base64,/9j/mini',
    })),
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
import { updateMarker, addMarkerImage, setCesium3dDependencies } from '../../src/js/store/cesium3d.operations.js';
import { updateMarker360, addMarker360Image, setStreetview360Dependencies } from '../../src/js/store/streetview360.operations.js';
import { setStoreErrorEventBus } from '../../src/js/store/store-errors.js';
import { pauseStoreWrites } from '../../src/js/store/write-coordinator.js';
import { featureMutationContract } from '../../src/js/store/sync/feature-patch.js';

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
    h.falharArmazem = false;
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

/** Uma foto nova por referência, como a galeria a anexa: é o que faz a edição ser DAS FOTOS. */
const nova = { id: 'nova-ref', name: 'nova2.jpg', type: 'image/jpeg', thumbnail: MINIATURA, addedAt: 3 };

/** Uma edição das FOTOS da feição: a lista gravada, mais uma foto por referência. */
const editarFotos = () => updateFeatureProperty('points', 'p1', 'images', [...feicaoGravada().properties.images, nova], MAPA);

/** Quantas vezes os bytes da foto inline viajam num texto. */
const vezesQueViaja = (texto) => texto.split(INLINE).length - 1;

describe('feição de atlas de servidor com foto inline: a próxima edição DAS FOTOS converte', () => {
    it('editar as fotos: a op sai sem bytes, sob id NOVO, e a subida começa depois da gravação', async () => {
        await editarFotos();

        const [op] = opsDeFeicao();
        const fotos = op.data.properties.images;
        // NEM o lado NOVO nem o ANTERIOR levam os bytes: o envelope carrega `previousData` inteiro.
        expect(JSON.stringify(op)).not.toContain(INLINE);
        expect(op.previousData.properties.images[0]).toEqual({ id: 'velha', name: 'velha.jpg', type: 'image/png', size: 9, thumbnail: MINIATURA, addedAt: 1 });
        expect(fotos).toHaveLength(4);
        const [primeira, ref, duplicata, anexada] = fotos;
        expect(primeira.id).not.toBe('velha');
        expect(primeira).toEqual({ id: primeira.id, name: 'velha.jpg', type: 'image/jpeg', size: 9, thumbnail: MINIATURA, addedAt: 1 });
        // A duplicata da MESMA foto é um blob só.
        expect(duplicata.id).toBe(primeira.id);
        expect(ref).toEqual(referencia);
        expect(anexada).toEqual(nova);

        expect(h.envios).toEqual([{ id: primeira.id, origem: 'foto-convertida', bytes: JPEG.length, enviado: true, descartado: false }]);
        expect(new Uint8Array(await h.imagens.get(primeira.id).arrayBuffer())).toEqual(JPEG);
        // O documento gravado concorda com a op, e o patch é só das fotos.
        expect(feicaoGravada().properties.images).toEqual(fotos);
        expect(featureMutationContract('update', op.data, op.previousData).patch.map((e) => e.path))
            .toEqual([['properties', 'images']]);
    });

    it('updateFeature converte pelo mesmo caminho quando as fotos mudam', async () => {
        const editada = ponto([inline('velha')]);
        editada.properties.nome = 'Movida';
        editada.geometry.coordinates = [-43.3, -22.8];
        await updateFeature('points', editada, MAPA);
        const [op] = opsDeFeicao();
        expect(op.data.properties.images[0]).not.toHaveProperty('data');
        expect(JSON.stringify(op)).not.toContain(INLINE);
        expect(h.envios.map((e) => e.enviado)).toEqual([true]);
    });

    it('atlas LOCAL (nenhum atlas de servidor conectado): nada é convertido, nada é gravado no armazém', async () => {
        h.online = false;
        await editarFotos();
        expect(opsDeFeicao()[0].data.properties.images[0].data).toBe(INLINE);
        expect(h.imagens.size).toBe(0);
        expect(h.envios).toEqual([]);
    });

    it('subida que não se registra: a edição sai como antes, com a foto inline, e os bytes gravados saem do armazém', async () => {
        h.registrado = false;
        await editarFotos();
        expect(opsDeFeicao()[0].data.properties.images[0].data).toBe(INLINE);
        expect(h.imagens.size).toBe(0);
    });

    // UM ERRO NÃO É UMA RECUSA (revisão da fase 2c, 2026-09-24). A gravação da entidade falha DEPOIS
    // de a intenção estar no diário; a intenção será reprojetada e enviada citando a foto, então os
    // bytes e a pendência ficam e sobem. Antes, eles eram apagados e o servidor recebia uma
    // referência para uma foto que ninguém ia mandar.
    it('gravação que falha depois da intenção: os bytes ficam e sobem', async () => {
        h.falharGravacao = true;
        await expect(editarFotos()).rejects.toThrow();
        const [op] = opsDeFeicao();
        const citada = op.data.properties.images[0].id;
        expect(h.envios).toEqual([expect.objectContaining({ id: citada, enviado: true, descartado: false })]);
        expect(h.imagens.has(citada)).toBe(true);
    });

    // O DISCO CHEIO NÃO DERRUBA A EDIÇÃO (revisão da fase 2c, 2026-09-24, item 4): editar as fotos de
    // uma feição não pode falhar porque a foto antiga não coube no armazém. A edição sai como antes,
    // com a foto inline, e nada fica registrado pela metade.
    it('cota estourada no armazém: a edição sai como antes, inline, sem pendência pela metade', async () => {
        h.falharArmazem = true;
        await editarFotos();
        const [op] = opsDeFeicao();
        expect(op.data.properties.images.at(-1)).toEqual(nova);
        expect(op.data.properties.images[0].data).toBe(INLINE);
        expect(h.envios).toEqual([]);
        expect(h.imagens.size).toBe(0);
    });

    // DENTRO DA TRANSAÇÃO (revisão da fase 2c, 2026-09-24, item 5): a conversão escreve no IndexedDB
    // (os bytes e a pendência), e fora do trabalho da transação ela acontecia ANTES de
    // `runTransaction` perguntar pela pausa da aba, pela barreira de saída e pelo carimbo de escopo.
    // Uma escrita que a transação recusava já tinha gravado e registrado a foto.
    it('escrita recusada pela pausa da aba: a conversão não grava nem registra nada', async () => {
        const pausa = pauseStoreWrites(h.escopo.atual);
        try {
            await expect(editarFotos()).rejects.toThrow();
        } finally {
            pausa.resume();
        }
        expect(h.imagens.size).toBe(0);
        expect(h.envios).toEqual([]);
        expect(opsDeFeicao()).toEqual([]);
    });

    it('a próxima edição de uma feição JÁ convertida não converte de novo', async () => {
        await editarFotos();
        await updateFeatureProperty('points', 'p1', 'images', feicaoGravada().properties.images.slice(0, 3), MAPA);
        expect(h.envios).toHaveLength(1);
        expect(opsDeFeicao()[1].data.properties.images[0].id).toBe(opsDeFeicao()[0].data.properties.images[0].id);
    });
});

// A EDIÇÃO SEM RELAÇÃO COM AS FOTOS NÃO AS CONVERTE, e não as reivindica (2026-09-24, item 4 da
// segunda revisão): converter em QUALQUER edição punha `properties.images` no patch de um renomear,
// sob ids novos, e dois colegas que editavam nome e descrição da mesma feição disputavam as fotos,
// que nenhum dos dois tinha tocado. O segundo era recusado. O peso que justificava converter em toda
// edição (o lado anterior levando os bytes) sai por outro caminho: o anterior viaja sem eles.
describe('feição com foto inline: a edição SEM RELAÇÃO com as fotos', () => {
    it('renomear não converte nada, e o patch é só do nome', async () => {
        await updateFeatureProperty('points', 'p1', 'nome', 'Depois', MAPA);

        const [op] = opsDeFeicao();
        expect(h.envios).toEqual([]);
        expect(h.imagens.size).toBe(0);
        expect(op.data.properties.nome).toBe('Depois');
        expect(op.data.properties.images).toEqual([inline('velha'), referencia, inline('velha')]);
        expect(featureMutationContract('update', op.data, op.previousData).patch)
            .toEqual([{ op: 'set', path: ['properties', 'nome'], value: 'Depois' }]);
    });

    it('os bytes viajam UMA vez, no lado novo: o anterior vai sem eles', async () => {
        await updateFeatureProperty('points', 'p1', 'nome', 'Depois', MAPA);
        const [op] = opsDeFeicao();
        expect(vezesQueViaja(JSON.stringify(op.previousData))).toBe(0);
        expect(op.previousData.properties.images).toEqual([
            { id: 'velha', name: 'velha.jpg', type: 'image/png', size: 9, thumbnail: MINIATURA, addedAt: 1 },
            referencia,
            { id: 'velha', name: 'velha.jpg', type: 'image/png', size: 9, thumbnail: MINIATURA, addedAt: 1 },
        ]);
        // Os DOIS itens inline do lado novo, e nenhum outro: o dado que a reprojeção grava continua inteiro.
        expect(vezesQueViaja(JSON.stringify(op))).toBe(2);
        expect(op.previousData.properties.nome).toBe('Antes');
    });

    it('updateFeature que só move a geometria também não mexe nas fotos', async () => {
        const movida = structuredClone(feicaoGravada());
        movida.geometry.coordinates = [-43.4, -22.7];
        await updateFeature('points', movida, MAPA);
        const [op] = opsDeFeicao();
        expect(h.envios).toEqual([]);
        expect(featureMutationContract('update', op.data, op.previousData).patch.map((e) => e.path)).toEqual([['geometry']]);
        expect(feicaoGravada().properties.images[0].data).toBe(INLINE);
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

// AS PORTAS DA FASE 2b GRAVAM DENTRO DA TRANSAÇÃO (revisão, item 5): o preparo só processa, e os
// bytes e a pendência da foto anexa são escritos pelo trabalho da transação. Uma escrita recusada pela
// pausa da aba não deixa foto gravada nem registrada.
describe('anexar foto a marcador 3D e 360: nada é gravado fora da transação', () => {
    const arquivo = () => ({ name: 'vistoria.jpg', type: 'image/jpeg', size: 10 });

    it('pausa da aba: anexar ao marcador 3D não grava nem registra a foto', async () => {
        const doc = getEmptyCesium3dData();
        doc.markers = [{ id: 'm3d', tilesetId: 't1', properties: { nome: 'M' }, images: [] }];
        h.laterais3d.set(MAPA, doc);
        const pausa = pauseStoreWrites(h.escopo.atual);
        try {
            await expect(addMarkerImage('m3d', arquivo(), MAPA)).rejects.toThrow();
        } finally {
            pausa.resume();
        }
        expect(h.imagens.size).toBe(0);
        expect(h.envios).toEqual([]);
    });

    it('pausa da aba: anexar ao marcador 360 não grava nem registra a foto', async () => {
        const doc = getEmptyStreetview360Data();
        doc.markers = [{ id: 'm360', photoName: 'p', position: { heading: 0, pitch: 0 }, properties: { nome: 'M' }, images: [], sync: { version: 1 } }];
        h.laterais360.set(MAPA, doc);
        const pausa = pauseStoreWrites(h.escopo.atual);
        try {
            await expect(addMarker360Image('m360', arquivo(), MAPA)).rejects.toThrow();
        } finally {
            pausa.resume();
        }
        expect(h.imagens.size).toBe(0);
        expect(h.envios).toEqual([]);
    });

    it('CONTROLE: sem pausa, a foto do marcador 3D é gravada, registrada e enviada', async () => {
        const doc = getEmptyCesium3dData();
        doc.markers = [{ id: 'm3d', tilesetId: 't1', properties: { nome: 'M' }, images: [] }];
        h.laterais3d.set(MAPA, doc);
        const item = await addMarkerImage('m3d', arquivo(), MAPA);
        expect(h.imagens.has(item.id)).toBe(true);
        expect(h.envios).toEqual([expect.objectContaining({ id: item.id, origem: 'foto-anexa-3d', enviado: true })]);
    });
});
