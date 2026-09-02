// Path: tests/integration/colar-simbolo-por-feicao.repro.test.js
// REPRO: copiar e colar uma MEDIDA DE COORDENAÇÃO ou uma DECLINAÇÃO MAGNÉTICA colava a
// feição sem o símbolo. O traço aparecia só depois de um F5.
//
// ================= A CADEIA, MEDIDA ==========================================
//
// As três famílias de símbolo (símbolo militar, medida de coordenação, declinação magnética)
// desenham um PNG gerado no cliente e registrado no MapLibre sob o `properties.id` DA FEIÇÃO:
// o estilo lê `'icon-image': ['get', 'id']` (`src/js/layers/styles/symbol.layers.js`). Logo,
// id novo exige registro novo, e não há fallback nenhum.
//
// `paste()` cunha um id novo por feição e duplica o blob sob esse id novo: quem decide é
// `hasImageResource`, DERIVADA do registro de tipos, então os quatro tipos com blob entram.
// Em seguida `loadPastedImages` deveria instalar cada blob no mapa, e ali havia uma LISTA
// FECHADA escrita à mão (`images` e `military_symbols`) anterior aos outros dois tipos.
// Resultado: o blob existia no IndexedDB, sob o id certo, e ninguém o registrava no mapa. O
// F5 consertava porque `setImages` (`src/js/layers/layer_setup.js`) varria os QUATRO, em
// OUTRA lista fechada escrita à mão.
//
// Nada emitia erro, e nada emitia evento: `FEATURE_CREATED` só sai pelo caminho REMOTO, então
// a colagem local nunca passa por `setupMapFeatures`.
//
// ================= O QUE ESTE ARQUIVO PRENDE =================================
//
// Que `loadPastedImages` peça o registro de TODO tipo com recurso de imagem, e não dos dois
// que alguém lembrou de escrever. Ele exercita o `ClipboardManager` de verdade, com a store,
// o toast e as ferramentas dubladas: o sujeito é a varredura dentro de `loadPastedImages`.
//
// O CONTROLE NEGATIVO deste arquivo é histórico e está registrado: rodado contra o
// `clipboard_manager.js` da lista fechada, o primeiro caso reprova com zero ids pedidos.
// Dentro do arquivo, o papel de controle é do caso `images` + `military_symbols`, que já
// passava antes: sem ele, uma varredura que pedisse TUDO (bucket de ponto inclusive) passaria
// em todas as asserções de presença.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// OS DUBLÊS (molde de tests/unit/colar-nao-anuncia-sucesso-recusado.repro.test.js)
// ---------------------------------------------------------------------------

let clipboard = { features: [], copiedAt: null, sourceMapName: 'Principal' };

vi.mock('@store', () => ({
    addFeatures: vi.fn(async () => {}),
    getImage: vi.fn(async () => null),
    getCurrentMapNameSync: () => 'Principal',
    getStorageTypeFromSource: (source) => `${source}s`,
    getSourceTypeFromStorage: (storage) => storage.replace(/s$/, ''),
    isUncopyableFeatureType: () => false,
    hasImageResource: () => false,
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
}));

vi.mock('@store/sync/permission-guard.js', () => ({
    checkPermission: () => ({ allowed: true }),
    GuardAction: { CREATE_FEATURE: 'CREATE_FEATURE' },
}));

vi.mock('@store/denial-phrases.js', () => ({
    denialNotice: (capability) => `RECUSA(${capability})`,
}));

vi.mock('@utils', () => ({
    IDUtils: {
        generateUniqueId: () => 'id-novo',
        generateGeoJSONId: () => 1,
        generateFeatureName: async () => 'Feição',
        duplicateImageResource: vi.fn(async () => {}),
    },
    ToastService: {
        showSuccess: vi.fn(),
        showWarning: vi.fn(),
        showError: vi.fn(),
    },
}));

vi.mock('@layers/geojson-dispatcher.js', () => ({
    getGeoJsonDispatcher: () => ({ add: vi.fn() }),
}));

// `needsPerFeatureImage` responde ao marcador do ponto, e não sempre-falso, porque o ramo dos
// pontos é justamente o que esta mudança NÃO pode ter quebrado.
vi.mock('@js/draw_tools/point_tool/point-marker-symbols.js', () => ({
    generatePointImage: () => ({ width: 1, height: 1 }),
    needsPerFeatureImage: (symbol) => symbol === 'quadrado',
}));

vi.mock('@js/draw_tools/point_tool/point-custom-icons.js', () => ({
    parseCustomMarker: () => null,
    registerCustomFeatureImage: vi.fn(async () => {}),
}));

const ClipboardManager = (await import('../../src/js/tool_manager/clipboard_manager.js')).default;

// ---------------------------------------------------------------------------
// O SUJEITO
// ---------------------------------------------------------------------------

/** A feature as `loadPastedImages` receives it: already pasted, already carrying the NEW id. */
const feicao = (id, source) => ({
    type: 'Feature',
    id: 1,
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: { id, source, nome: id },
});

let mapaTemImagem = false;
let mapa;

function montar() {
    const selectionManager = {
        controls: new Map(),
        ensureControlFor: vi.fn(async () => null),
        getAllSelectedFeatures: () => [],
        deselectAllFeatures: vi.fn(),
        toggleFeatureSelection: vi.fn(async () => {}),
        updateUI: vi.fn(),
    };
    mapa = {
        getZoom: () => 12,
        getCenter: () => ({ lat: 0, lng: 0 }),
        getSource: () => null,
        hasImage: () => mapaTemImagem,
        addImage: vi.fn(),
        removeImage: vi.fn(),
    };
    const manager = new ClipboardManager(selectionManager, mapa);
    vi.spyOn(manager, 'loadSingleImageForPaste').mockResolvedValue(undefined);
    return manager;
}

/** The ids `loadPastedImages` asked the map to register, in call order. */
const idsPedidos = (manager) =>
    manager.loadSingleImageForPaste.mock.calls.map(([imageId]) => imageId);

beforeEach(() => {
    mapaTemImagem = false;
});

describe('loadPastedImages registra o símbolo de TODO tipo com recurso de imagem', () => {
    it('medida de coordenação e declinação magnética entram — que é o defeito inteiro', async () => {
        const manager = montar();

        await manager.loadPastedImages({
            coordination_measures: [feicao('mc-1', 'coordination_measure')],
            magnetic_declinations: [feicao('dm-1', 'magnetic_declination')],
        });

        expect(idsPedidos(manager).sort()).toEqual(['dm-1', 'mc-1']);
    });

    it('CONTROLE: imagem e símbolo militar continuam entrando, como antes da mudança', async () => {
        // Este caso já passava com a lista fechada. Ele é o que impede o verde vazio do outro
        // lado: uma varredura que pedisse TODO bucket passaria nas asserções de presença, e
        // reprova na de ausência abaixo.
        const manager = montar();

        await manager.loadPastedImages({
            images: [feicao('img-1', 'image')],
            military_symbols: [feicao('sm-1', 'military_symbol')],
        });

        expect(idsPedidos(manager).sort()).toEqual(['img-1', 'sm-1']);
    });

    it('os quatro juntos dão quatro registros, um por feição', async () => {
        const manager = montar();

        await manager.loadPastedImages({
            images: [feicao('img-1', 'image')],
            military_symbols: [feicao('sm-1', 'military_symbol')],
            coordination_measures: [feicao('mc-1', 'coordination_measure'), feicao('mc-2', 'coordination_measure')],
            magnetic_declinations: [feicao('dm-1', 'magnetic_declination')],
        });

        expect(idsPedidos(manager).sort()).toEqual(['dm-1', 'img-1', 'mc-1', 'mc-2', 'sm-1']);
    });

    it('bucket SEM recurso de imagem não pede registro nenhum', async () => {
        // A asserção de ausência que dá conteúdo às de presença.
        const manager = montar();

        await manager.loadPastedImages({
            polygons: [feicao('pol-1', 'polygon')],
            lines: [feicao('lin-1', 'line')],
            boundarys: [feicao('lim-1', 'boundary')],
        });

        expect(idsPedidos(manager)).toEqual([]);
    });

    it('o guard `hasImage` continua de pé: nada é recarregado', async () => {
        mapaTemImagem = true;
        const manager = montar();

        await manager.loadPastedImages({
            coordination_measures: [feicao('mc-1', 'coordination_measure')],
            magnetic_declinations: [feicao('dm-1', 'magnetic_declination')],
        });

        expect(idsPedidos(manager)).toEqual([]);
    });

    it('feição sem `properties.id` é ignorada em vez de pedir `undefined`', async () => {
        const manager = montar();

        await manager.loadPastedImages({
            coordination_measures: [
                { type: 'Feature', properties: { source: 'coordination_measure' } },
                feicao('mc-2', 'coordination_measure'),
            ],
        });

        expect(idsPedidos(manager)).toEqual(['mc-2']);
    });

    it('objeto vazio não explode e não pede nada', async () => {
        const manager = montar();

        await expect(manager.loadPastedImages({})).resolves.toBeUndefined();
        expect(idsPedidos(manager)).toEqual([]);
    });
});

describe('o ramo dos pontos continua intacto', () => {
    it('marcador que precisa de imagem por feição ainda é assado e registrado', async () => {
        const manager = montar();

        await manager.loadPastedImages({
            points: [{
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [0, 0] },
                properties: { id: 'pt-1', source: 'point', markerSymbol: 'quadrado' },
            }],
        });

        expect(mapa.addImage).toHaveBeenCalledTimes(1);
        expect(mapa.addImage.mock.calls[0][0]).toBe('pt-1');
        // O ponto NÃO passa pelo caminho de blob: ele é gerado, não carregado.
        expect(idsPedidos(manager)).toEqual([]);
    });

    it('marcador de círculo (sem imagem por feição) não registra nada', async () => {
        const manager = montar();

        await manager.loadPastedImages({
            points: [{
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [0, 0] },
                properties: { id: 'pt-2', source: 'point', markerSymbol: 'circulo' },
            }],
        });

        expect(mapa.addImage).not.toHaveBeenCalled();
    });

    it('símbolo e ponto na MESMA colagem: os dois caminhos correm juntos', async () => {
        const manager = montar();

        await manager.loadPastedImages({
            magnetic_declinations: [feicao('dm-1', 'magnetic_declination')],
            points: [{
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [0, 0] },
                properties: { id: 'pt-1', source: 'point', markerSymbol: 'quadrado' },
            }],
        });

        expect(idsPedidos(manager)).toEqual(['dm-1']);
        expect(mapa.addImage.mock.calls[0][0]).toBe('pt-1');
    });
});
