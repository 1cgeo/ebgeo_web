// Path: tests/unit/arrow-control-doubleheaded.test.js

/**
 * @fileoverview As TRÊS listas de `add_arrow_control.js` que uma propriedade nova
 * de seta tem de entrar, e o que acontece quando ela falta em cada uma.
 *
 * POR QUE ESTE ARQUIVO EXISTE. `doubleHeaded` não bastava existir na geometria:
 * ela precisa aparecer em quatro lugares daquele controle, e três deles FALHAM
 * EM SILÊNCIO quando esquecidos, cada um de um jeito diferente e nenhum com erro
 * na tela:
 *
 *   1. `DEFAULT_PROPERTIES` — sem ela a seta nova nasce sem a chave, e o painel
 *      desenha `undefined` como desligado por acidente e não por decisão;
 *   2. a lista de REGENERAÇÃO — sem ela o toggle grava a propriedade e não
 *      redesenha nada: a pessoa clica, o painel muda, a seta não;
 *   3. `BRANCH_PROPS` — sem ela o toggle de uma seta COMBINADA grava no topo, e
 *      `generateMergedGeometry` lê ramo a ramo, então de novo nada acontece;
 *   4. `hasFeatureChanged` — o pior dos quatro, porque só aparece depois: a seta
 *      é redesenhada na tela, a pessoa vê a mudança, salva, e `saveFeatures`
 *      decide que nada mudou e NÃO persiste. O trabalho some no próximo F5.
 *
 * O quarto é a razão de este arquivo ser comportamental e não léxico: ele se lê
 * numa cadeia (`saveFeatures` → `hasFeatureChanged` → `updateFeature`), e é essa
 * cadeia que uma lista incompleta rompe.
 *
 * O QUE ELE NÃO ALCANÇA. Nada de MapLibre, store, undo ou sync de verdade: o
 * mapa, o despachante de diffs e o store são dublês. Ele diz que a propriedade
 * ATRAVESSA o controle, nunca que ela é persistida ou sincronizada.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

const persisted = [];

vi.mock('@tools', () => ({
    BaseGeometry: class { constructor(properties = {}) { this.properties = { ...properties }; } },
    BaseControl: class {
        constructor(toolManager) { this.toolManager = toolManager; }
        updateSelectionManagerFeatures() {}
        getSelectedFeature() { return null; }
        createEditHandles() {}
    },
}));

vi.mock('@store', () => ({
    addFeature: () => Promise.resolve(),
    updateFeature: (source, feature) => { persisted.push({ source, id: feature.properties.id }); return Promise.resolve(); },
    removeFeature: () => Promise.resolve(),
    getActiveLayerIdSync: () => 'camada-ativa',
}));

vi.mock('@utils', () => ({
    IDUtils: {
        generateFeatureIds: () => ({ id: 'novo-id', geoJsonId: 'novo-geojson-id' }),
        generateFeatureName: () => Promise.resolve('Seta 1'),
    },
    showWarning: () => {},
}));

vi.mock('@utils/pointer-utils', () => ({
    getPointerPosition: () => ({ x: 0, y: 0 }),
    isTouchDevice: () => false,
}));

vi.mock('@js/military_tools/arrow_tool/arrow_attributes_panel.js', () => ({
    addArrowAttributesToPanel: () => {},
}));

vi.mock('@js/draw_tools/drawing-touch-helpers', () => ({
    DrawingFinishButton: class { show() {} hide() {} destroy() {} },
}));

vi.mock('@layers/geojson-dispatcher.js', () => ({
    getGeoJsonDispatcher: () => ({
        add: () => {}, remove: () => {}, flush: () => Promise.resolve(),
    }),
    destroyGeoJsonDispatcher: () => {},
}));

beforeAll(() => {
    // Stub planar mínimo: aqui a FORMA da seta não é o assunto, só o fato de a
    // geometria ter sido (ou não) refeita. `arrow-geometry.test.js` e
    // `arrow-geometry-turf-real.test.js` é que medem forma.
    globalThis.turf = {
        lineString: (coords) => {
            if (!Array.isArray(coords)) throw new Error('coordinates must be an array');
            return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } };
        },
        point: (c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c } }),
        lineOffset: (line, offset) => ({
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: line.geometry.coordinates.map((c) => [c[0], c[1] + offset]),
            },
        }),
        bearing: () => 90,
        destination: (p, d, b) => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [(p.geometry ? p.geometry.coordinates : p)[0] + d, b] },
        }),
        length: () => 100000,
        feature: (g) => ({ type: 'Feature', geometry: g }),
    };
});

afterAll(() => { delete globalThis.turf; });

const { default: AddArrowControl } = await import('../../src/js/military_tools/arrow_tool/add_arrow_control.js');

/**
 * Um controle com um mapa dublê cuja fonte `arrows` devolve as feições dadas.
 * @param {Array} features - Feições da fonte
 * @returns {Object} O controle pronto para uso
 */
function controlWith(features) {
    const control = new AddArrowControl({});
    control.map = {
        getSource: () => ({ getData: () => Promise.resolve({ type: 'FeatureCollection', features }) }),
    };
    // `updateSelectionManagerFeatures` e o desenho de alcas sao do controle, nao
    // da base: sem estes dois dubles a chamada morre depois de ja ter feito o
    // trabalho que este arquivo mede.
    control.selectionManager = { updateSelectedFeature() {} };
    control.getSelectedFeature = () => null;
    return control;
}

const arrowFeature = (props = {}) => ({
    type: 'Feature',
    properties: {
        id: 'a1', source: 'arrow', baseCoordinates: [[0, 0], [1, 0], [2, 0]], width: 1000, ...props,
    },
    geometry: { type: 'Polygon', coordinates: [[]] },
});

beforeEach(() => { persisted.length = 0; });

// ============================================================================

describe('AddArrowControl.DEFAULT_PROPERTIES', () => {
    it('a seta nasce com a cauda DESLIGADA, e explicitamente `false`', () => {
        // `false`, não ausente: é a diferença entre um estado escolhido e um
        // `undefined` que o painel desenha como desligado por acidente.
        expect(AddArrowControl.DEFAULT_PROPERTIES.doubleHeaded).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(AddArrowControl.DEFAULT_PROPERTIES, 'doubleHeaded')).toBe(true);
    });

    it('CONTROLE: o toggle mestre continua nascendo LIGADO', () => {
        expect(AddArrowControl.DEFAULT_PROPERTIES.showArrowHead).toBe(true);
    });
});

describe('AddArrowControl.hasFeatureChanged', () => {
    const control = controlWith([]);

    it('ligar a cauda CONTA como mudança', () => {
        // Sem esta linha em `hasFeatureChanged`, `saveFeatures` decide que nada
        // mudou e a seta redesenhada na tela some no próximo F5.
        expect(control.hasFeatureChanged(
            arrowFeature({ doubleHeaded: true }),
            { ...arrowFeature({ doubleHeaded: false }).properties },
        )).toBe(true);
    });

    it('desligar a cauda também conta', () => {
        expect(control.hasFeatureChanged(
            arrowFeature({ doubleHeaded: false }),
            { ...arrowFeature({ doubleHeaded: true }).properties },
        )).toBe(true);
    });

    it('CONTROLE: uma seta idêntica NÃO conta como mudada', () => {
        const props = arrowFeature({ doubleHeaded: true }).properties;
        expect(control.hasFeatureChanged({ properties: { ...props } }, { ...props })).toBe(false);
    });

    it('COMPAT: a seta ANTIGA (sem a chave) conta como mudada ao ligar', () => {
        // Uma seta gravada antes desta versão volta do disco sem `doubleHeaded`.
        // `undefined !== false`, então o primeiro toggle a marca como mudada
        // mesmo que a pessoa ligue e desligue de volta. É benigno (o pior caso é
        // uma escrita a mais, que grava a forma nova) e fica declarado aqui para
        // que a próxima leitura não o trate como defeito.
        const antiga = arrowFeature();
        delete antiga.properties.doubleHeaded;
        expect(control.hasFeatureChanged(arrowFeature({ doubleHeaded: false }), { ...antiga.properties })).toBe(true);
    });
});

describe('AddArrowControl.saveFeatures', () => {
    it('PERSISTE a seta cuja única mudança foi a cauda', () => {
        // A cadeia inteira: saveFeatures → hasFeatureChanged → updateFeature.
        const atual = arrowFeature({ doubleHeaded: true });
        const control = controlWith([atual]);
        const antes = new Map([['a1', { ...arrowFeature({ doubleHeaded: false }).properties }]]);

        return control.saveFeatures([atual], antes).then(() => {
            expect(persisted).toEqual([{ source: 'arrows', id: 'a1' }]);
        });
    });

    it('CONTROLE: sem mudança nenhuma não escreve no store', () => {
        const atual = arrowFeature({ doubleHeaded: true });
        const control = controlWith([atual]);
        const antes = new Map([['a1', { ...atual.properties }]]);

        return control.saveFeatures([atual], antes).then(() => {
            expect(persisted).toEqual([]);
        });
    });
});

describe('AddArrowControl.updateFeaturesProperty', () => {
    it('REGENERA a geometria quando a cauda muda', async () => {
        const sourceFeature = arrowFeature({ doubleHeaded: false });
        const control = controlWith([sourceFeature]);
        const antes = sourceFeature.geometry;

        await control.updateFeaturesProperty([sourceFeature], 'doubleHeaded', true);

        expect(sourceFeature.properties.doubleHeaded).toBe(true);
        expect(sourceFeature.geometry).not.toBe(antes);
        expect(sourceFeature.geometry.type).toBe('Polygon');
        // Absoluto: 3 + 3 do bico + 3 + 3 da cauda + fechamento.
        expect(sourceFeature.geometry.coordinates[0].length).toBe(13);
    });

    it('CONTROLE: uma propriedade NÃO geométrica não regenera nada', async () => {
        const sourceFeature = arrowFeature();
        const control = controlWith([sourceFeature]);
        const antes = sourceFeature.geometry;

        await control.updateFeaturesProperty([sourceFeature], 'nome', 'Outra');

        expect(sourceFeature.properties.nome).toBe('Outra');
        expect(sourceFeature.geometry).toBe(antes);
    });

    it('a seta COMBINADA recebe a flag em TODOS os ramos, não só no topo', async () => {
        // `generateMergedGeometry` lê `branch.doubleHeaded`, nunca o topo, então
        // sem `doubleHeaded` em `BRANCH_PROPS` o toggle de uma seta combinada
        // grava e não desenha.
        const merged = arrowFeature({
            isMerged: true,
            branches: [
                { baseCoordinates: [[0, 0], [1, 0], [2, 0]], width: 1000 },
                { baseCoordinates: [[3, 0], [4, 0], [5, 0]], width: 1000 },
            ],
        });
        const control = controlWith([merged]);

        await control.updateFeaturesProperty([merged], 'doubleHeaded', true);

        expect(merged.properties.branches.map((b) => b.doubleHeaded)).toEqual([true, true]);
    });
});
