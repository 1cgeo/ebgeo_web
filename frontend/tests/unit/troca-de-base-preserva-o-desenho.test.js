// Path: tests/unit/troca-de-base-preserva-o-desenho.test.js

/**
 * @fileoverview TROCAR DE MAPA BASE NÃO PODE APAGAR O QUE A PESSOA ACABOU DE DESENHAR.
 *
 * O MECANISMO, medido nesta árvore em 2026-09-04 e não deduzido. Dezesseis sources de
 * feição são escritas pelo despachante de diff (`layers/geojson-dispatcher.js`), que
 * guarda uma fila POR source e a entrega em lote. A remontagem de `setupMapFeatures`
 * escreve cada uma dessas sources INTEIRA, por `setOrCreateSource` →
 * `writeWholeCollection`, e coleção inteira é `replaceAll`: pelo contrato do próprio
 * despachante, ela DESCARTA o que aquela source tinha na fila. O que estiver enfileirado
 * e ainda não entregue some sem erro em lugar nenhum.
 *
 * POR ISSO O MODO PRESERVADO NÃO É UMA OTIMIZAÇÃO. Depois de uma troca de mapa base no
 * mesmo mapa do atlas, o `transformStyle` mantém as sources pelas MESMAS referências, o
 * conteúdo já está lá, e remontar seria escrever por cima da fila viva.
 *
 * A DIVISÃO DOS DOIS BLOCOS abaixo é deliberada: o primeiro mede o despachante contra
 * `setOrCreateSource` de verdade, que é onde a perda acontece; o segundo dirige
 * `setupMapFeatures` e cobra que o modo preservado não chegue lá. Nenhum dos dois usa
 * MapLibre real, então eles dizem que a escrita é ou não é emitida, nunca que o mapa
 * desenhou.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { getGeoJsonDispatcher, peekGeoJsonDispatcher, destroyGeoJsonDispatchers } from '../../src/js/layers/geojson-dispatcher.js';
import { setOrCreateSource } from '../../src/js/layers/styles/layer.helpers.js';

/** Mapa falso com o mínimo que o despachante e `setOrCreateSource` usam. */
function mapaFalso() {
    const sources = new Map();
    const ouvintes = new Map();
    const map = {
        escritas: [],
        getSource: (id) => sources.get(id) || null,
        addSource(id, spec) {
            sources.set(id, {
                _dados: spec.data,
                setData(fc) {
                    this._dados = fc;
                    map.escritas.push({ tipo: 'setData', id, n: fc.features.length });
                    map.sinalizar(id);
                },
                updateData(diff) {
                    const porChave = new Map(this._dados.features.map((f) => [f.properties.id, f]));
                    for (const id of diff.remove || []) porChave.delete(id);
                    for (const f of diff.add || []) porChave.set(f.properties.id, f);
                    this._dados = { type: 'FeatureCollection', features: [...porChave.values()] };
                    map.escritas.push({ tipo: 'updateData', id, add: (diff.add || []).length });
                    map.sinalizar(id);
                },
            });
        },
        removeSource: (id) => sources.delete(id),
        on(evt, fn) { if (!ouvintes.has(evt)) ouvintes.set(evt, new Set()); ouvintes.get(evt).add(fn); },
        off(evt, fn) { ouvintes.get(evt)?.delete(fn); },
        sinalizar(id) {
            queueMicrotask(() => {
                for (const fn of ouvintes.get('sourcedata') || []) fn({ sourceId: id, isSourceLoaded: true, dataType: 'source' });
                for (const fn of ouvintes.get('idle') || []) fn({});
            });
        },
    };
    return map;
}

const feicao = (id) => ({ type: 'Feature', properties: { id }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } });
const idsNaFonte = (map, id) => map.getSource(id)._dados.features.map((f) => f.properties.id);

describe('o despachante de diff através de um setStyle', () => {
    it('O PIOR CASO: recriar a source e remontar a coleção APAGA a feição enfileirada', async () => {
        const map = mapaFalso();
        map.addSource('lines', { type: 'geojson', data: { type: 'FeatureCollection', features: [feicao('linha-antiga')] }, promoteId: 'id' });
        const despachante = getGeoJsonDispatcher(map, 'lines');
        // A pessoa desenha. A ferramenta enfileira, e o lote ainda não saiu.
        despachante.add(feicao('linha-nova'));
        expect(despachante.isIdle()).toBe(false);

        // `setStyle` SEM `transformStyle`: o MapLibre remove e recria toda source do app.
        map.removeSource('lines');
        map.addSource('lines', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' });
        // Modo cheio: a remontagem escreve a coleção do store, que não tem a feição nova.
        setOrCreateSource(map, 'lines', [feicao('linha-antiga')]);
        await despachante.flush();

        expect(idsNaFonte(map, 'lines')).toEqual(['linha-antiga']);
        expect(map.escritas.filter((e) => e.tipo === 'updateData')).toHaveLength(0);
    });

    it('a perda é da ESCRITA INTEIRA, não da troca de instância: a mesma source basta para perdê-la', async () => {
        // O controle que separa as duas causas. Sem ele, a leitura natural do caso acima
        // seria "o problema é a source ter sido recriada", e o conserto seria o errado.
        const map = mapaFalso();
        map.addSource('lines', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' });
        const despachante = getGeoJsonDispatcher(map, 'lines');
        despachante.add(feicao('linha-nova'));
        setOrCreateSource(map, 'lines', []);
        await despachante.flush();
        expect(idsNaFonte(map, 'lines')).toEqual([]);
    });

    it('modo preservado sobre a MESMA source: a feição enfileirada chega, por updateData', async () => {
        const map = mapaFalso();
        map.addSource('lines', { type: 'geojson', data: { type: 'FeatureCollection', features: [feicao('linha-antiga')] }, promoteId: 'id' });
        const instanciaAntes = map.getSource('lines');
        const despachante = getGeoJsonDispatcher(map, 'lines');
        despachante.add(feicao('linha-nova'));

        // `transformStyle` entrega a source ao próximo estilo pela mesma referência, então o
        // diff do MapLibre não emite operação nenhuma para ela; e o modo preservado não
        // escreve coleção inteira.
        await despachante.flush();

        expect(map.getSource('lines')).toBe(instanciaAntes);
        expect(idsNaFonte(map, 'lines').sort()).toEqual(['linha-antiga', 'linha-nova']);
        expect(map.escritas.filter((e) => e.tipo === 'setData')).toHaveLength(0);
    });

    it('a source cujo despachante morreu no caminho é remontada, e é isso que o modo cheio cobre', async () => {
        // `_dispatchBatch` destrói o despachante quando não acha a source, e o comentário
        // dele diz por quê: a remontagem repovoa. Essa saída depende do modo CHEIO existir.
        const map = mapaFalso();
        map.addSource('lines', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' });
        const despachante = getGeoJsonDispatcher(map, 'lines');
        despachante.add(feicao('linha-nova'));
        map.removeSource('lines');
        await despachante.flush();
        expect(peekGeoJsonDispatcher(map, 'lines')).toBe(null);
    });
});

// ---------------------------------------------------------------------------------------
// O modo de `setupMapFeatures`, dirigido.
// ---------------------------------------------------------------------------------------

const chamadasDeEstilo = [];

const NOMES_DE_ESTILO = [
    'setupPointLayers', 'setupLineLayers', 'setupBrushLayers', 'setupPolygonLayers',
    'setupCircleLayers', 'setupRectangleLayers', 'setupEllipseLayers', 'setupSectorLayers',
    'setupTextLayers', 'setupImageLayers', 'setupArrowLayers', 'setupMilitarySymbolsLayers',
    'setupCoordinationMeasureLayers', 'setupDeclinationLayers', 'setupBoundaryLayers',
    'setupOccupiedFrontLayers', 'setupCoordinationLineLayers', 'setupLOSLayers',
    'setupVisibilityLayers', 'setupAuxiliaryLayers',
];

vi.mock('../../src/js/layers/styles/index.js', () => {
    const mod = { setupLayerSeparators: () => {} };
    for (const nome of [
        'setupPointLayers', 'setupLineLayers', 'setupBrushLayers', 'setupPolygonLayers',
        'setupCircleLayers', 'setupRectangleLayers', 'setupEllipseLayers', 'setupSectorLayers',
        'setupTextLayers', 'setupImageLayers', 'setupArrowLayers', 'setupMilitarySymbolsLayers',
        'setupCoordinationMeasureLayers', 'setupDeclinationLayers', 'setupBoundaryLayers',
        'setupOccupiedFrontLayers', 'setupCoordinationLineLayers', 'setupLOSLayers',
        'setupVisibilityLayers', 'setupAuxiliaryLayers',
    ]) {
        mod[nome] = (...args) => { chamadasDeEstilo.push(nome); return args; };
    }
    return mod;
});

const leiturasDoStore = [];
vi.mock('../../src/js/store', () => ({
    getCurrentMapFeatures: async () => { leiturasDoStore.push('getCurrentMapFeatures'); return {}; },
    getImage: async () => null,
    hasImage: async () => false,
    getCurrentMapNameSync: () => 'mapa-1',
    getGridStyle: async () => null,
    getCatalogLayers: async () => [],
    getControl: () => null,
}));

vi.mock('../../src/js/layers/image-regen-registry.js', () => ({ getImageRegenerator: () => null }));
vi.mock('../../src/js/layers/feature-images.js', () => ({
    collectImageResourceFeatures: () => [],
    collectImageResourceRatios: () => ({}),
}));
vi.mock('../../src/js/utilities/turf-loader.js', () => ({ ensureTurf: async () => ({}) }));
vi.mock('../../src/js/grid/index.js', () => ({ initGridLayers: () => {} }));
vi.mock('../../src/js/draw_tools/point_tool/point-marker-symbols.js', () => ({
    generatePointImage: async () => null,
    needsPerFeatureImage: () => false,
    pointImageSignature: () => '',
}));
vi.mock('../../src/js/draw_tools/point_tool/point-custom-icons.js', () => ({
    parseCustomMarker: () => null,
    registerCustomFeatureImage: async () => {},
}));
vi.mock('../../src/js/layers/visibility-filter.js', () => ({
    updateAllLayerFilters: () => {},
    invalidateFilterCache: () => {},
    updateMeasurementLabelVisibility: () => {},
}));
vi.mock('../../src/js/layers/layer-opacity-applier.js', () => ({
    applyLayerOpacities: () => {},
    invalidateOpacityCache: () => {},
}));
vi.mock('../../src/js/measurement_tool/measurement-labels.js', () => ({ setupMeasurementLayers: () => {} }));
vi.mock('../../src/js/config.js', () => ({ default: { features: { grid: false } } }));

const { setupMapFeatures } = await import('../../src/js/layers/layer_setup.js');

function mapaComPontos({ comPoints = true } = {}) {
    const map = mapaFalso();
    if (comPoints) map.addSource('points', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' });
    return map;
}

const gerentes = { setupAnalysisLayers: async () => {}, setupDataLayers: async () => {} };
const barramento = { on: () => () => {}, emit: () => {} };

beforeEach(() => {
    chamadasDeEstilo.length = 0;
    leiturasDoStore.length = 0;
});

describe('o modo de setupMapFeatures', () => {
    it('modo PRESERVADO: nenhuma das vinte montagens de camada roda, e o store nem é lido', async () => {
        const map = mapaComPontos();
        destroyGeoJsonDispatchers(map);
        await setupMapFeatures(map, gerentes, gerentes, barramento, { contentPreserved: true });
        expect(chamadasDeEstilo).toEqual([]);
        expect(leiturasDoStore).toEqual([]);
        expect(map.escritas).toEqual([]);
    });

    it('modo CHEIO: as vinte rodam, e a coleção é lida do store', async () => {
        const map = mapaComPontos();
        await setupMapFeatures(map, gerentes, gerentes, barramento);
        expect(chamadasDeEstilo.sort()).toEqual([...NOMES_DE_ESTILO].sort());
        expect(leiturasDoStore).toEqual(['getCurrentMapFeatures']);
    });

    it('`contentPreserved` COM a source do app ausente cai no cheio (remontagem do MapLibre)', async () => {
        // `Style.setState` que levanta faz o MapLibre remontar o estilo do zero e levar as
        // sources do app junto. O chamador não sabe disso; a source ausente sabe.
        const map = mapaComPontos({ comPoints: false });
        await setupMapFeatures(map, gerentes, gerentes, barramento, { contentPreserved: true });
        expect(chamadasDeEstilo.sort()).toEqual([...NOMES_DE_ESTILO].sort());
    });

    it('sem opção nenhuma o modo é cheio, que é o que os dez outros chamadores precisam', async () => {
        const map = mapaComPontos();
        await setupMapFeatures(map, gerentes, gerentes, barramento, {});
        expect(chamadasDeEstilo.length).toBe(NOMES_DE_ESTILO.length);
    });
});
