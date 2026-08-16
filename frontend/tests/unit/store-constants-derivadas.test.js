// Path: tests/unit/store-constants-derivadas.test.js
//
// THE SIX CONSTANTS OF `store.constants.js` STOPPED BEING WRITTEN AND STARTED BEING DERIVED.
// This file is the receipt: each one still has the exact name, shape, contents and KEY ORDER
// it had when a human typed it out.
//
// WHY THE EXPECTATIONS ARE WRITTEN OUT BY HAND, ALL OF THEM. The derivation and its check
// must not share a source. Comparing `FEATURE_TYPE_MAPPINGS` against something computed from
// `FEATURE_TYPE_REGISTRY` is comparing the value with itself: it passes green over an empty
// registry, over a registry missing five rows, and over a registry whose rows were reordered.
// The tables below were transcribed from the hand-written constants as they stood before the
// derivation existed, and they are the only thing in this repository that still remembers
// what those constants looked like.
//
// KEY ORDER IS ASSERTED, NOT INCIDENTAL. `getSelectionControlConfig` iterates the type list
// and `Object.keys` order decides the order buttons and rows appear in. `toEqual` on objects
// ignores order, so the order cases compare `Object.keys(...)` as arrays, on purpose.
//
// WHAT THE GREEN DOES NOT PROVE: that the derivation is a good idea, or that any single row
// is right. It proves that a refactor which was supposed to change nothing observable
// changed nothing observable.

import { describe, it, expect } from 'vitest';
import {
    FEATURE_TYPE_ICONS,
    FEATURE_TYPE_MAPPINGS,
    FEATURE_DISPLAY_NAMES,
    UNCOPYABLE_FEATURE_TYPES,
    IMAGE_RESOURCE_FEATURE_TYPES,
    getStorageTypeFromSource,
    getSourceTypeFromStorage,
    getFeatureDisplayName,
    getFeatureIconFromStorage,
    getAllStorageTypes,
    isUncopyableFeatureType,
    hasImageResource,
    getSelectionControlConfig,
} from '@store/store.constants.js';

// ============================================================================
// As constantes como eram escritas a mao, transcritas uma vez
// ============================================================================

const ICONES_ESPERADOS = {
    point: './images/icon_point_black.svg',
    line: './images/icon_line_black.svg',
    polygon: './images/icon_polygon_black.svg',
    circle: './images/icon_circle_black.svg',
    ellipse: './images/icon_ellipse_black.svg',
    rectangle: './images/icon_rectangle_black.svg',
    sector: './images/icon_sector_black.svg',
    text: './images/icon_text_black.svg',
    image: './images/icon_photo_black.svg',
    brush: './images/icon_brush_black.svg',
    arrow: './images/icon_arrow_black.svg',
    boundary: './images/icon_boundary_black.svg',
    occupied_front: './images/icon_occupied_front_black.svg',
    military_symbol: './images/icon_military_black.svg',
    coordination_measure: './images/icon_coordination_black.svg',
    los: './images/icon_los_black.svg',
    visibility: './images/icon_visibility_black.svg',
    magnetic_declination: './images/icon_declination_black.svg',
};

const MAPEAMENTO_ESPERADO = {
    point: 'points',
    line: 'lines',
    polygon: 'polygons',
    circle: 'circles',
    ellipse: 'ellipses',
    rectangle: 'rectangles',
    sector: 'setores',
    text: 'texts',
    image: 'images',
    brush: 'brushes',
    arrow: 'arrows',
    boundary: 'boundarys',
    occupied_front: 'occupied_fronts',
    military_symbol: 'military_symbols',
    coordination_measure: 'coordination_measures',
    los: 'los',
    visibility: 'visibility',
    processed_los: 'processed_los',
    processed_visibility: 'processed_visibility',
    magnetic_declination: 'magnetic_declinations',
};

const NOMES_ESPERADOS = {
    point: 'Ponto',
    line: 'Linha',
    polygon: 'Polígono',
    circle: 'Círculo',
    ellipse: 'Elipse',
    rectangle: 'Retângulo',
    sector: 'Setor',
    text: 'Texto',
    image: 'Imagem',
    brush: 'Pincel',
    arrow: 'Seta',
    boundary: 'Limite',
    occupied_front: 'Frente Ocupada',
    military_symbol: 'Símbolo Militar',
    coordination_measure: 'Medida de Coordenação',
    los: 'Linha de Visada',
    visibility: 'Visibilidade',
    magnetic_declination: 'Declinação Magnética',
};

const NAO_COPIAVEIS_ESPERADOS = ['los', 'visibility'];

const COM_IMAGEM_ESPERADOS = ['image', 'military_symbol', 'coordination_measure', 'magnetic_declination'];

// The 18 selectable types, in canonical order. This is `SOURCE_TYPES`, which is module-private
// and only observable through `getSelectionControlConfig`.
const SELECIONAVEIS_ESPERADOS = [
    'point', 'line', 'polygon', 'circle', 'ellipse', 'rectangle', 'sector',
    'text', 'image', 'brush',
    'arrow', 'boundary', 'occupied_front', 'military_symbol', 'coordination_measure',
    'los', 'visibility',
    'magnetic_declination',
];

describe('constantes derivadas: conteudo identico ao escrito a mao', () => {
    it('FEATURE_TYPE_ICONS', () => {
        expect(FEATURE_TYPE_ICONS).toEqual(ICONES_ESPERADOS);
        expect(Object.keys(FEATURE_TYPE_ICONS), 'a ordem das chaves mudou').toEqual(Object.keys(ICONES_ESPERADOS));
    });

    it('FEATURE_TYPE_MAPPINGS', () => {
        expect(FEATURE_TYPE_MAPPINGS).toEqual(MAPEAMENTO_ESPERADO);
        expect(Object.keys(FEATURE_TYPE_MAPPINGS), 'a ordem das chaves mudou').toEqual(Object.keys(MAPEAMENTO_ESPERADO));
    });

    it('FEATURE_DISPLAY_NAMES', () => {
        expect(FEATURE_DISPLAY_NAMES).toEqual(NOMES_ESPERADOS);
        expect(Object.keys(FEATURE_DISPLAY_NAMES), 'a ordem das chaves mudou').toEqual(Object.keys(NOMES_ESPERADOS));
    });

    it('UNCOPYABLE_FEATURE_TYPES', () => {
        expect(UNCOPYABLE_FEATURE_TYPES).toEqual(NAO_COPIAVEIS_ESPERADOS);
    });

    it('IMAGE_RESOURCE_FEATURE_TYPES', () => {
        expect(IMAGE_RESOURCE_FEATURE_TYPES).toEqual(COM_IMAGEM_ESPERADOS);
    });

    it('as cinco continuam congeladas', () => {
        for (const [nome, valor] of Object.entries({
            FEATURE_TYPE_ICONS, FEATURE_TYPE_MAPPINGS, FEATURE_DISPLAY_NAMES,
            UNCOPYABLE_FEATURE_TYPES, IMAGE_RESOURCE_FEATURE_TYPES,
        })) {
            expect(Object.isFrozen(valor), `${nome} deixou de ser congelada`).toBe(true);
        }
    });
});

describe('constantes derivadas: a regressao que a derivacao poderia ter causado', () => {
    // The cheap way to write a registry is one flat list of twenty strings. It would have
    // pushed the two processing OUTPUT types into every user-facing map, and they would have
    // shown up in the feature tab, in the PDF legend and in box selection, named 'Feição'.
    // These three cases exist because that regression is invisible in a diff of a constant.

    it('as duas saidas de processamento NAO tem nome de exibicao', () => {
        expect(Object.keys(FEATURE_DISPLAY_NAMES)).not.toContain('processed_los');
        expect(Object.keys(FEATURE_DISPLAY_NAMES)).not.toContain('processed_visibility');
        // And the fallback for them is unchanged.
        expect(getFeatureDisplayName('processed_los')).toBe('Feição');
    });

    it('as duas saidas de processamento NAO tem icone', () => {
        expect(Object.keys(FEATURE_TYPE_ICONS)).not.toContain('processed_los');
        expect(getFeatureIconFromStorage('processed_visibility')).toBeUndefined();
    });

    it('as duas saidas de processamento NAO entram na selecao por caixa', () => {
        const config = getSelectionControlConfig();
        expect(Object.keys(config), 'a ordem ou o conteudo da selecao mudou').toEqual(SELECIONAVEIS_ESPERADOS);
        expect(config.point).toEqual({ sourceNames: ['points'] });
        expect(config.sector).toEqual({ sourceNames: ['setores'] });
    });

    it('mas as duas continuam existindo como bucket de armazenamento', () => {
        // The opposite error: dropping them from the mappings is what sent a synced processing
        // result into 'processed_loss' on the receiving peer.
        expect(getAllStorageTypes()).toContain('processed_los');
        expect(getAllStorageTypes()).toContain('processed_visibility');
        expect(getAllStorageTypes()).toHaveLength(20);
    });
});

describe('constantes derivadas: as funcoes que os seis consumidores chamam', () => {
    it('ida e volta entre tipo e bucket, incluindo os irregulares', () => {
        for (const [tipo, bucket] of Object.entries(MAPEAMENTO_ESPERADO)) {
            expect(getStorageTypeFromSource(tipo), `ida de '${tipo}'`).toBe(bucket);
            expect(getSourceTypeFromStorage(bucket), `volta de '${bucket}'`).toBe(tipo);
        }
    });

    it('o fallback de tipo desconhecido continua sendo o mesmo', () => {
        // Positive control for the round trip above: without it, a lookup that returned the
        // input unchanged would also pass, and would prove nothing about the table.
        expect(getStorageTypeFromSource('tipo_que_nao_existe')).toBe('tipo_que_nao_existes');
        // The reverse fallback has two shapes, and both are part of the contract:
        expect(getSourceTypeFromStorage('bananas'), 'com s final, tira o s').toBe('banana');
        expect(getSourceTypeFromStorage('banana'), 'sem s final, devolve o proprio').toBe('banana');
    });

    it('isUncopyableFeatureType e hasImageResource concordam com as listas', () => {
        for (const tipo of Object.keys(MAPEAMENTO_ESPERADO)) {
            expect(isUncopyableFeatureType(tipo), `copia de '${tipo}'`).toBe(NAO_COPIAVEIS_ESPERADOS.includes(tipo));
            expect(hasImageResource(tipo), `imagem de '${tipo}'`).toBe(COM_IMAGEM_ESPERADOS.includes(tipo));
        }
    });
});
