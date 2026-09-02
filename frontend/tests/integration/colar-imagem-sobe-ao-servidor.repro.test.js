// Path: tests/integration/colar-imagem-sobe-ao-servidor.repro.test.js
// REPRO: colar uma feição de IMAGEM num atlas de SERVIDOR duplicava o blob SÓ no IndexedDB.
// O par recebia a feição e uma moldura vazia.
//
// ================= A CADEIA, MEDIDA ==========================================
//
// `paste()` cunha um id novo por feição e chama `IDUtils.duplicateImageResource`, que é
// `getImage` + `storeImage`: as duas escrevem no disco LOCAL e nenhuma sobe byte nenhum. Não
// existe op incremental de imagem no vocabulário de sync, então a op da feição viajava sozinha
// e o par ficava com uma referência a um id que o servidor nunca viu: `getImage` erra
// localmente, cai no servidor, toma 404 e o carregador instala o placeholder de erro. Nada
// lança, nada avisa, dos dois lados.
//
// Vale igual para "Colar Aqui" e "Duplicar Seleção": os dois passam por este mesmo `paste()`
// (`context-menu/context-menu.control.js`).
//
// ================= O QUE ESTE ARQUIVO PRENDE =================================
//
// Que a colagem chame a porta BULK (`POST /atlas/:atlasId/images/bulk`, a única que preserva
// o `localId` como id) com o id NOVO, ANTES de gravar as feições, e SÓ para o blob que ninguém
// consegue reconstruir. Ele exercita o `ClipboardManager` de verdade e o ajudante de verdade
// (`store/upload-copied-blobs.js`), com `buildImageUploads` e `uploadImagesInChunks` REAIS: o
// único dublê do transporte é o `apiClient`, cujo `bulkUploadImages` é o espião. Assim o teste
// mede o pedido que sairia, e não a intenção de fazê-lo.
//
// A METADE QUE NÃO SOBE É REGRA, NÃO ESQUECIMENTO. Símbolo militar, medida de coordenação e
// declinação magnética desenham um PNG gerado no cliente e o par o REGENERA das propriedades
// sincronizadas (`layers/image-regen-registry.js`). Subir o deles seria peso morto em toda
// colagem. Quem decide é o registro de regeneração, consultado por tipo, nunca uma lista
// fechada nova: no app quem o povoa é `initToolRegistry` (`tool_manager/tool-registry.js`), de
// forma ANSIOSA no boot do mapa, e aqui o `beforeEach` registra as mesmas três entradas.
//
// O CONTROLE NEGATIVO, rodado antes de mexer em `paste()`: os quatro casos que exigem envio
// reprovaram com "expected 'bulkUploadImages' to be called ... times, but got 0 times", e os
// três de ausência passaram (é o defeito: nada subia nunca). Dentro do arquivo, o papel de
// controle é do caso que cola a IMAGEM e a MEDIDA juntas: sem ele, um `paste()` que não
// subisse NADA passaria em todas as asserções de ausência.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// OS DUBLÊS (molde de tests/integration/colar-simbolo-por-feicao.repro.test.js)
// ---------------------------------------------------------------------------

/** O disco local de blobs, compartilhado pelos dois pontos que o leem. */
const blobs = new Map();

let clipboard = { features: [], copiedAt: null, sourceMapName: 'Principal' };
let atlasRemoto = true;
const addFeatures = vi.fn(async () => {});
/** A ordem em que os dois lados do contrato aconteceram (a subida vem antes da gravação). */
let ordem = [];

// As quatro derivações do registro de tipos entram DE VERDADE: `hasImageResource` é o que
// decide quem duplica blob, e um dublê dela mediria a lista que o teste escreveu.
vi.mock('@store', async () => {
    const constantes = await vi.importActual('@store/store.constants.js');
    return {
        addFeatures: (...args) => {
            ordem.push('addFeatures');
            return addFeatures(...args);
        },
        getImage: vi.fn(async (id) => blobs.get(id) || null),
        getCurrentMapNameSync: () => 'Principal',
        getStorageTypeFromSource: constantes.getStorageTypeFromSource,
        getSourceTypeFromStorage: constantes.getSourceTypeFromStorage,
        isUncopyableFeatureType: constantes.isUncopyableFeatureType,
        hasImageResource: constantes.hasImageResource,
        getStateManager: () => ({
            getClipboard: () => clipboard,
            hasClipboardData: () => clipboard.features.length > 0,
            setClipboard: (features, sourceMapName) => {
                clipboard = { features, copiedAt: Date.now(), sourceMapName };
            },
            clearClipboard: () => { clipboard = { features: [], copiedAt: null, sourceMapName: null }; },
        }),
        isCurrentMapLockedSync: () => false,
        buildLayerMappingForMove: vi.fn(async () => new Map()),
        emitStoreError: vi.fn(),
        StoreErrorEvents: { STORE_OPERATION_BLOCKED: 'store:operation-blocked' },
    };
});

// O ajudante lê o blob por AQUI, e não pelo barril: é a folha de operações de imagem.
vi.mock('@store/settings.operations.js', () => ({
    getImage: vi.fn(async (id) => blobs.get(id) || null),
    storeImage: vi.fn(async (id, blob) => { blobs.set(id, blob); }),
    removeImage: vi.fn(async (id) => { blobs.delete(id); }),
}));

vi.mock('@store/store-origin.js', () => ({
    isRemoteStoreSync: () => atlasRemoto,
}));

/** O ÚNICO dublê do transporte: `buildImageUploads` e `uploadImagesInChunks` são os reais. */
const bulkUploadImages = vi.fn(async () => ({ mapping: {}, failed: [] }));
const syncEngine = { atlasId: 'atlas-uuid' };

vi.mock('@store/sync/index.js', () => ({
    apiClient: {
        bulkUploadImages: (...args) => {
            ordem.push('upload');
            return bulkUploadImages(...args);
        },
    },
    syncEngine,
}));

vi.mock('@store/sync/permission-guard.js', () => ({
    checkPermission: () => ({ allowed: true }),
    GuardAction: { CREATE_FEATURE: 'CREATE_FEATURE' },
}));

vi.mock('@store/denial-phrases.js', () => ({
    denialNotice: (capability) => `RECUSA(${capability})`,
}));

let proximoId = 0;
vi.mock('@utils', () => ({
    IDUtils: {
        generateUniqueId: () => `novo-${++proximoId}`,
        generateGeoJSONId: () => ++proximoId,
        generateFeatureName: async () => 'Feição',
        // O mesmo que a de verdade faz: `getImage` + `storeImage`, as duas no disco local.
        duplicateImageResource: vi.fn(async (oldId, newId) => {
            const blob = blobs.get(oldId);
            if (blob) blobs.set(newId, blob);
        }),
    },
    ToastService: { showSuccess: vi.fn(), showWarning: vi.fn(), showError: vi.fn() },
}));

vi.mock('@layers/geojson-dispatcher.js', () => ({
    getGeoJsonDispatcher: () => ({ add: vi.fn() }),
}));

vi.mock('@js/draw_tools/point_tool/point-marker-symbols.js', () => ({
    generatePointImage: () => ({}),
    needsPerFeatureImage: () => false,
}));

vi.mock('@js/draw_tools/point_tool/point-custom-icons.js', () => ({
    parseCustomMarker: () => null,
    registerCustomFeatureImage: vi.fn(async () => {}),
}));

// `FileReader` não é global do Node, e `blobToBase64` depende dele. Sem esta ponte todo blob
// cairia no `catch` de `buildImageUploads`, o upload sairia vazio e o arquivo mediria uma
// lista vazia, verde por engano. Lê o blob de verdade, e não devolve dado fixo. (Mesma ponte
// de `tests/unit/enviar-blob-com-id-novo.test.js`.)
if (typeof globalThis.FileReader === 'undefined') {
    globalThis.FileReader = class {
        readAsDataURL(blob) {
            blob.arrayBuffer().then((buf) => {
                const bytes = new Uint8Array(buf);
                let bruto = '';
                for (const b of bytes) bruto += String.fromCharCode(b);
                this.result = `data:${blob.type};base64,${btoa(bruto)}`;
                this.onloadend?.();
            }, (err) => { this.error = err; this.onerror?.(); });
        }
    };
}

const ClipboardManager = (await import('../../src/js/tool_manager/clipboard_manager.js')).default;
const { registerImageRegenerator } = await import('@layers/image-regen-registry.js');

// ---------------------------------------------------------------------------
// O SUJEITO
// ---------------------------------------------------------------------------

/** Bytes reconhecíveis, para que a asserção olhe o CONTEÚDO e não só o id. */
const BYTES_PNG = [137, 80, 78, 71, 13, 10, 26, 10];

/** Um PNG de verdade: `buildImageUploads` recusa mime fora da lista do servidor. */
const pngBlob = () => new Blob([new Uint8Array(BYTES_PNG)], { type: 'image/png' });

/** Um item do clipboard, como `copy()` o deixa. */
const item = (id, source) => ({
    type: source,
    feature: {
        type: 'Feature',
        id: 1,
        geometry: { type: 'Point', coordinates: [0, 0] },
        properties: { id, source, nome: id, layerId: 'default' },
    },
});

/** Um controle que cola somando o deslocamento, que é o que todo real faz. */
const controle = {
    canCopy: () => true,
    prepareForCopy: (f) => structuredClone(f),
    prepareForPaste: (f, offset) => ({
        ...f,
        geometry: {
            ...f.geometry,
            coordinates: [f.geometry.coordinates[0] + offset.dx, f.geometry.coordinates[1] + offset.dy],
        },
    }),
};

function montar() {
    const selectionManager = {
        controls: new Map([
            ['image', controle],
            ['coordination_measure', controle],
            ['military_symbol', controle],
            ['point', controle],
        ]),
        ensureControlFor: vi.fn(async (type) => selectionManager.controls.get(type) ?? null),
        getAllSelectedFeatures: () => [],
        deselectAllFeatures: vi.fn(),
        toggleFeatureSelection: vi.fn(async () => {}),
        updateUI: vi.fn(),
    };
    const map = {
        getZoom: () => 12,
        getCenter: () => ({ lat: 0, lng: 0 }),
        getSource: () => null,
        hasImage: () => true,
        addImage: vi.fn(),
        removeImage: vi.fn(),
    };
    const manager = new ClipboardManager(selectionManager, map);
    // O registro no MapLibre é de outro arquivo e de outro repro; aqui ele só atrapalharia,
    // porque `new Image()` não existe em node.
    vi.spyOn(manager, 'loadSingleImageForPaste').mockResolvedValue(undefined);
    return manager;
}

/** Os itens de um pedido bulk: `[{ localId, mimeType, data }]`. */
const enviados = () => bulkUploadImages.mock.calls.flatMap(([, chunk]) => chunk);

beforeEach(() => {
    blobs.clear();
    ordem = [];
    proximoId = 0;
    atlasRemoto = true;
    syncEngine.atlasId = 'atlas-uuid';
    addFeatures.mockClear();
    bulkUploadImages.mockClear();
    bulkUploadImages.mockResolvedValue({ mapping: {}, failed: [] });
    // As três famílias que o par REGENERA. No app quem as registra é `initToolRegistry`, no
    // boot do mapa, sem clique nenhum; sem esta linha o teste mediria um registro vazio e
    // concluiria que tudo sobe.
    for (const source of ['military_symbol', 'coordination_measure', 'magnetic_declination']) {
        registerImageRegenerator(source, async () => {});
    }
});

describe('colar uma IMAGEM num atlas de servidor sobe o blob sob o id NOVO', () => {
    beforeEach(() => {
        blobs.set('img-antiga', pngBlob());
        clipboard = { features: [item('img-antiga', 'image')], copiedAt: Date.now(), sourceMapName: 'Principal' };
    });

    it('manda UM item para a porta bulk, com o id novo e os bytes do blob', async () => {
        const colados = await montar().paste();

        expect(colados).toBe(1);
        expect(bulkUploadImages).toHaveBeenCalledTimes(1);

        const [atlasId] = bulkUploadImages.mock.calls[0];
        expect(atlasId).toBe('atlas-uuid');

        const itens = enviados();
        expect(itens).toHaveLength(1);
        // O id NOVO, que é o que a feição colada carrega: o servidor preserva `localId` como id.
        expect(itens[0].localId).toBe('novo-1');
        expect(itens[0].localId).not.toBe('img-antiga');
        expect(itens[0].mimeType).toBe('image/png');
        // E o CONTEÚDO: um pedido com o id certo e bytes de outra imagem passaria sem isto.
        expect(itens[0].data).toBe(`data:image/png;base64,${btoa(String.fromCharCode(...BYTES_PNG))}`);
    });

    it('a subida vem ANTES da gravação das feições, que é o que a torna útil', async () => {
        // O flush de saída parte a cada 1,5 s: uma op de feição que chegasse ao par antes do
        // blob desenharia um buraco.
        await montar().paste();

        expect(ordem).toEqual(['upload', 'addFeatures']);
    });

    it('"Colar Aqui" sobe igual: é o MESMO paste(), com alvo', async () => {
        await montar().paste({ targetLngLat: { lng: 10, lat: 20 } });

        expect(enviados().map((i) => i.localId)).toEqual(['novo-1']);
    });
});

describe('o blob que o par REGENERA não sobe', () => {
    it('medida de coordenação: nenhum pedido sai', async () => {
        blobs.set('mc-antiga', pngBlob());
        clipboard = { features: [item('mc-antiga', 'coordination_measure')], copiedAt: Date.now(), sourceMapName: 'Principal' };

        const colados = await montar().paste();

        expect(colados).toBe(1);
        expect(bulkUploadImages).not.toHaveBeenCalled();
        // O blob CONTINUA sendo duplicado no disco local: quem desenha aqui é ele.
        expect(blobs.has('novo-1')).toBe(true);
    });

    it('CONTROLE: imagem e medida na MESMA colagem sobem SÓ a imagem', async () => {
        // Sem este caso, um `paste()` que não subisse nada passaria nas asserções de ausência.
        blobs.set('img-antiga', pngBlob());
        blobs.set('mc-antiga', pngBlob());
        clipboard = {
            features: [item('img-antiga', 'image'), item('mc-antiga', 'coordination_measure')],
            copiedAt: Date.now(),
            sourceMapName: 'Principal',
        };

        const colados = await montar().paste();

        expect(colados).toBe(2);
        // `novo-1` é o id da imagem (primeira do clipboard), `novo-2` o da medida.
        expect(enviados().map((i) => i.localId)).toEqual(['novo-1']);
    });

    it('feição SEM blob nenhum (ponto) não produz pedido', async () => {
        clipboard = { features: [item('pt-antigo', 'point')], copiedAt: Date.now(), sourceMapName: 'Principal' };

        await montar().paste();

        expect(bulkUploadImages).not.toHaveBeenCalled();
    });
});

describe('o portão do atlas fica DENTRO do ajudante', () => {
    beforeEach(() => {
        blobs.set('img-antiga', pngBlob());
        clipboard = { features: [item('img-antiga', 'image')], copiedAt: Date.now(), sourceMapName: 'Principal' };
    });

    it('atlas LOCAL: nada sobe, e a colagem acontece igual', async () => {
        atlasRemoto = false;

        const colados = await montar().paste();

        expect(colados).toBe(1);
        expect(bulkUploadImages).not.toHaveBeenCalled();
        expect(addFeatures).toHaveBeenCalledTimes(1);
    });

    it('atlas remoto SEM atlas conectado: nada sobe', async () => {
        // `isRemoteStoreSync` e `syncEngine.atlasId` são perguntas diferentes: a marca de
        // origem sobrevive ao `disconnect`, o id do atlas não.
        syncEngine.atlasId = null;

        await montar().paste();

        expect(bulkUploadImages).not.toHaveBeenCalled();
    });
});

describe('a subida é BEST-EFFORT: ela nunca derruba a colagem', () => {
    beforeEach(() => {
        blobs.set('img-antiga', pngBlob());
        clipboard = { features: [item('img-antiga', 'image')], copiedAt: Date.now(), sourceMapName: 'Principal' };
    });

    it('rede fora: a feição é gravada assim mesmo', async () => {
        bulkUploadImages.mockRejectedValue(new Error('ECONNREFUSED'));

        const colados = await montar().paste();

        expect(colados).toBe(1);
        expect(addFeatures).toHaveBeenCalledTimes(1);
    });

    it('servidor recusa o item: a feição é gravada assim mesmo', async () => {
        bulkUploadImages.mockResolvedValue({
            mapping: {},
            failed: [{ localId: 'novo-1', error: 'File too large' }],
        });

        const colados = await montar().paste();

        expect(colados).toBe(1);
        expect(addFeatures).toHaveBeenCalledTimes(1);
    });

    it('blob que sumiu entre duplicar e subir: nenhum pedido, e a colagem segue', async () => {
        // A duplicação é best-effort e pode não ter escrito nada (`Promise.allSettled`). O
        // ajudante não inventa um pedido sem bytes; ele devolve o id em `skipped`, porque um id
        // que some aqui é a feição que vai desenhar vazia no par.
        blobs.delete('img-antiga');

        const colados = await montar().paste();

        expect(colados).toBe(1);
        expect(bulkUploadImages).not.toHaveBeenCalled();
    });

    it('mime fora da lista do servidor (SVG): nem pedido sai, e a colagem segue', async () => {
        // `buildImageUploads` separa o que o servidor não aceita, em vez de derrubar o lote.
        blobs.set('img-antiga', new Blob(['<svg/>'], { type: 'image/svg+xml' }));

        const colados = await montar().paste();

        expect(colados).toBe(1);
        expect(bulkUploadImages).not.toHaveBeenCalled();
    });
});
