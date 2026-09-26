// Path: tests/store/foto-recusada-descartar.test.js
//
// O "DESCARTAR" DE UMA FOTO ANEXA RECUSADA TIRA A FOTO DE TODA ENTIDADE QUE A CITA (decisão do dono de
// 2026-09-26), em qualquer mapa do atlas, pelas mesmas operações de store da galeria, então a edição
// sincroniza. O registro da recusa sai sozinho em seguida, pela regra da citação.
//
// O arnês é o de `foto-inline-convertida-na-proxima-edicao.test.js`: repositório em memória,
// `feature.operations.js`, `cesium3d.operations.js` e `streetview360.operations.js` REAIS, e a porta do
// diário capturando o que o servidor receberia.

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
    /** O posto deixa escrever? */
    permitido: true,
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
    checkPermission: vi.fn(() => ({ allowed: h.permitido })),
    GuardAction: {
        CREATE_FEATURE: 'EDIT', UPDATE_FEATURE: 'EDIT', DELETE_FEATURE: 'DELETE',
        CREATE_MARKER_3D: 'EDIT', DELETE_MARKER_3D: 'DELETE',
        CREATE_MARKER_360: 'EDIT', DELETE_MARKER_360: 'DELETE'
    }
}));

vi.mock('../../src/js/store/map.operations.js', () => ({
    isCurrentMapLockedSync: vi.fn(() => false),
    getAllMapNamesStore: vi.fn(async () => [...h.mapas.keys()]),
}));

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

import { setFeatureDependencies } from '../../src/js/store/feature.operations.js';
import { setCesium3dDependencies } from '../../src/js/store/cesium3d.operations.js';
import { setStreetview360Dependencies } from '../../src/js/store/streetview360.operations.js';
import { setStoreErrorEventBus } from '../../src/js/store/store-errors.js';
import { tirarFotoDasEntidades } from '../../src/js/store/foto-recusada.operations.js';

const MINIATURA = 'data:image/jpeg;base64,/9j/mini';
const foto = (id) => ({ id, name: `${id}.jpg`, type: 'image/jpeg', thumbnail: MINIATURA, addedAt: 1 });
const RECUSADA = 'foto-recusada';
const OUTRA = 'foto-que-fica';

function mapaCom(idFeicao, fotos) {
    const doc = getEmptyMapData();
    doc.features.points = [{
        type: 'Feature', id: 1,
        geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
        properties: { id: idFeicao, source: 'point', nome: idFeicao, layerId: 'default', images: fotos },
    }];
    return doc;
}

const fotosDe = (mapa) => h.mapas.get(mapa).features.points[0].properties.images.map((f) => f.id);

beforeEach(() => {
    vi.clearAllMocks();
    h.mapas.clear();
    h.laterais3d.clear();
    h.laterais360.clear();
    h.ops.length = 0;
    h.permitido = true;
    const bus = { emit: vi.fn() };
    setFeatureDependencies({ eventBus: bus, mapManager: h.mapManager });
    setCesium3dDependencies({ eventBus: bus });
    setStreetview360Dependencies({ eventBus: bus });
    setStoreErrorEventBus(bus);
});

describe('Descartar a foto anexa recusada', () => {
    it('tira a foto das feições de TODOS os mapas que a citam, e só ela; cada edição vira operação', async () => {
        h.mapas.set('Mapa', mapaCom('p1', [foto(RECUSADA), foto(OUTRA)]));
        h.mapas.set('Outro mapa', mapaCom('p2', [foto(RECUSADA)]));

        const avisos = [];
        const resultado = await tirarFotoDasEntidades(RECUSADA, { aoTirarDaFeicao: (id, tipo) => avisos.push([id, tipo]) });

        expect(resultado).toEqual({ tirada: true, restantes: 0 });
        // One call per feature edited, so the caller can redraw an open gallery.
        expect(avisos).toEqual([['p1', 'point'], ['p2', 'point']]);
        expect(fotosDe('Mapa')).toEqual([OUTRA]);
        expect(fotosDe('Outro mapa')).toEqual([]);
        const ops = h.ops.filter((op) => op.entityType === 'feature');
        expect(ops).toHaveLength(2);
        for (const op of ops) expect(op.data.properties.images.map((f) => f.id)).not.toContain(RECUSADA);
    });

    it('tira também de marcador 3D, medição e marcador 360', async () => {
        h.mapas.set('Mapa', mapaCom('p1', []));
        const vazio3d = getEmptyCesium3dData();
        h.laterais3d.set('Mapa', {
            ...vazio3d,
            markers: [{ id: 'm3', tilesetId: 't', images: [foto(RECUSADA)], sync: {} }],
            measurements: [{ id: 'me', tilesetId: 't', images: [foto(RECUSADA)], sync: {} }],
        });
        h.laterais360.set('Mapa', { ...getEmptyStreetview360Data(), markers: [{ id: 'm360', photoName: 'f', images: [foto(RECUSADA)], sync: {} }] });

        const resultado = await tirarFotoDasEntidades(RECUSADA);

        expect(resultado).toEqual({ tirada: true, restantes: 0 });
        expect(h.laterais3d.get('Mapa').markers[0].images).toEqual([]);
        expect(h.laterais3d.get('Mapa').measurements[0].images).toEqual([]);
        expect(h.laterais360.get('Mapa').markers[0].images).toEqual([]);
    });

    it('um portão que recusa deixa a foto onde está, e a resposta diz que ela não saiu de todo lugar', async () => {
        h.mapas.set('Mapa', mapaCom('p1', [foto(RECUSADA)]));
        h.permitido = false;

        const resultado = await tirarFotoDasEntidades(RECUSADA);

        expect(resultado).toEqual({ tirada: false, restantes: 1 });
        expect(fotosDe('Mapa')).toEqual([RECUSADA]);
        expect(h.ops).toHaveLength(0);
    });

    it('id vazio não varre nada', async () => {
        h.mapas.set('Mapa', mapaCom('p1', [foto(RECUSADA)]));
        expect(await tirarFotoDasEntidades('')).toEqual({ tirada: false, restantes: 0 });
        expect(fotosDe('Mapa')).toEqual([RECUSADA]);
    });
});
