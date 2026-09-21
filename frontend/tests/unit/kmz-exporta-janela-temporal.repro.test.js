// Path: tests/unit/kmz-exporta-janela-temporal.repro.test.js
//
// ACHADO I6: A EXPORTAÇÃO KMZ NÃO CITAVA TEMPO EM LUGAR NENHUM.
//
// ================= A CAUSA ====================================================
//
// Os nove arquivos de `src/js/import_export/kmz/` montavam nome, estilo, balão,
// `ExtendedData` e geometria, e nenhum deles olhava para `temporalInicio`,
// `temporalFim` ou `trajetoria`. Do outro lado, a IMPORTAÇÃO de KML já lia
// `<TimeSpan>` e `<TimeStamp>` (`temporal/temporal-import.js` mais o achatamento de
// `import.control.js`), de modo que o produto sabia LER um tempo que ele mesmo nunca
// ESCREVIA: exportar um mapa e reimportá-lo devolvia toda feição PERMANENTE, visível em
// qualquer posição do cursor, e a única pista era a ausência.
//
// ================= O QUE FOI FEITO, E O QUE FICOU DE FORA =====================
//
//  - A JANELA DE VALIDADE passou a sair como `<TimeSpan>` (`kmz/kml-time.js`), num
//    Placemark ou GroundOverlay, e VOLTA idêntica pelo caminho de importação. O bloco de
//    ida-e-volta abaixo é o que prende isso.
//  - A TRAJETÓRIA continua fora, agora DECLARADA: `degradationNotes` acusa o ponto móvel
//    no balão. KML só a representaria por `gx:Track`, extensão do Google que SUBSTITUI a
//    geometria do Placemark, de modo que quem não a implementa perde a feição inteira em
//    vez de apenas não animá-la.
//  - `<TimeStamp>` NÃO é emitido, e o último bloco mede o porquê: o caminho de volta o lê
//    como INÍCIO e perde o fim.
//
// O ambiente é node puro: `kml-time.js` e `kml-document.js` são folhas, e
// `kmz-feature-mapper.js` carrega aqui (as partes que precisam de canvas são tardias),
// então a fiação é medida dirigindo o mapeador de verdade, não por leitura de texto.

import { describe, it, expect } from 'vitest';
import {
    toKmlDateTime,
    buildTimePrimitive,
    hasMovingTrajectory,
} from '@js/import_export/kmz/kml-time.js';
import { buildPlacemark, buildGroundOverlay, StyleRegistry } from '@js/import_export/kmz/kml-document.js';
import {
    mapFeatureToKml,
    degradationNotes,
    TRAJECTORY_DEGRADATION_NOTE,
} from '@js/import_export/kmz/kmz-feature-mapper.js';
import { extractTemporalProperties } from '@js/temporal/temporal-import.js';

const INICIO = Date.UTC(2026, 8, 21, 12, 0, 0);
const FIM = Date.UTC(2026, 8, 21, 18, 30, 0);

/** Registro de ativos que nunca gera bitmap: o gerador de ponto precisa de canvas. */
const assetsStub = {
    has: () => true,
    get: () => ({ href: 'files/ponto.png', width: 64, height: 64 }),
    add: () => null,
};

/**
 * O que o `@tmcw/togeojson` entrega ao importador a partir do XML que acabamos de escrever,
 * seguido do achatamento que `import.control.js` faz (`_flattenTemporalSource`).
 *
 * A leitura é por expressão regular e não pelo togeojson de verdade porque ele precisa de um
 * `DOMParser`, que não existe no ambiente node desta suíte. A FORMA reproduzida aqui é a que
 * o comentário de `import.control.js` declara: `<TimeSpan>` vira `timespan: { begin, end }`.
 * @param {string} xml - Fragmento KML
 * @returns {Object} Propriedades cruas, como o importador as vê
 */
function lerComoOImportadorLe(xml) {
    const span = xml.match(/<TimeSpan>([\s\S]*?)<\/TimeSpan>/);
    if (!span) return {};
    const begin = span[1].match(/<begin>([^<]*)<\/begin>/);
    const end = span[1].match(/<end>([^<]*)<\/end>/);
    const timespan = { begin: begin ? begin[1] : undefined, end: end ? end[1] : undefined };
    // Espelho de `_flattenTemporalSource`.
    return { timespan, begin: timespan.begin, end: timespan.end };
}

describe('I6 — `toKmlDateTime`', () => {
    it('escreve ISO 8601 em UTC, com o `Z` que tira a ambiguidade de fuso', () => {
        expect(toKmlDateTime(INICIO)).toBe('2026-09-21T12:00:00Z');
        expect(toKmlDateTime(0)).toBe('1970-01-01T00:00:00Z');
    });

    it('mantém os milissegundos quando eles existem, e só então', () => {
        expect(toKmlDateTime(INICIO + 250)).toBe('2026-09-21T12:00:00.250Z');
        expect(toKmlDateTime(INICIO)).not.toContain('.000');
    });

    it('aceita instante anterior à época', () => {
        expect(toKmlDateTime(Date.UTC(1944, 5, 6, 6, 30, 0))).toBe('1944-06-06T06:30:00Z');
    });

    it('recusa o inutilizável em vez de deixar a exportação inteira lançar', () => {
        for (const lixo of [undefined, null, NaN, Infinity, -Infinity, '1750000000000', new Date(), {}]) {
            expect(toKmlDateTime(lixo)).toBeNull();
        }
        // Fora da faixa do `Date`, onde `toISOString` LANÇA um RangeError.
        expect(toKmlDateTime(8.64e15 + 1)).toBeNull();
        expect(toKmlDateTime(-8.64e15 - 1)).toBeNull();
        expect(toKmlDateTime(8.64e15)).toBe('+275760-09-13T00:00:00Z');
    });
});

describe('I6 — `buildTimePrimitive`', () => {
    it('emite as duas pontas quando a janela é fechada', () => {
        expect(buildTimePrimitive({ temporalInicio: INICIO, temporalFim: FIM }))
            .toBe('<TimeSpan><begin>2026-09-21T12:00:00Z</begin><end>2026-09-21T18:30:00Z</end></TimeSpan>');
    });

    it('emite só `begin` para "daqui em diante" e só `end` para "até então"', () => {
        expect(buildTimePrimitive({ temporalInicio: INICIO }))
            .toBe('<TimeSpan><begin>2026-09-21T12:00:00Z</begin></TimeSpan>');
        expect(buildTimePrimitive({ temporalFim: FIM }))
            .toBe('<TimeSpan><end>2026-09-21T18:30:00Z</end></TimeSpan>');
    });

    it('cala para a feição PERMANENTE, que é a maioria', () => {
        expect(buildTimePrimitive({})).toBe('');
        expect(buildTimePrimitive()).toBe('');
        expect(buildTimePrimitive({ nome: 'X', trajetoria: [] })).toBe('');
        expect(buildTimePrimitive({ temporalInicio: NaN, temporalFim: null })).toBe('');
    });

    it('não emite `<TimeStamp>` nem para a janela de comprimento zero', () => {
        const xml = buildTimePrimitive({ temporalInicio: INICIO, temporalFim: INICIO });
        expect(xml).not.toContain('TimeStamp');
        expect(xml).toBe('<TimeSpan><begin>2026-09-21T12:00:00Z</begin><end>2026-09-21T12:00:00Z</end></TimeSpan>');
    });
});

describe('I6 — IDA E VOLTA: o que o exportador escreve o importador lê igual', () => {
    const casos = [
        ['janela fechada', { temporalInicio: INICIO, temporalFim: FIM }],
        ['só início', { temporalInicio: INICIO }],
        ['só fim', { temporalFim: FIM }],
        ['comprimento zero', { temporalInicio: INICIO, temporalFim: INICIO }],
        ['com milissegundos', { temporalInicio: INICIO + 7, temporalFim: FIM + 999 }],
        ['antes da época', { temporalInicio: Date.UTC(1944, 5, 6, 6, 30, 0) }],
    ];

    it.each(casos)('%s volta com o MESMO epoch ms', (_nome, props) => {
        const xml = buildTimePrimitive(props);
        expect(xml).not.toBe('');

        const devolta = extractTemporalProperties(lerComoOImportadorLe(xml));
        expect(devolta).toEqual(props);
    });

    it('a feição permanente volta permanente, sem chave nenhuma inventada', () => {
        expect(extractTemporalProperties(lerComoOImportadorLe(buildTimePrimitive({})))).toEqual({});
    });

    it('CONTROLE: `<TimeStamp>` PERDERIA o fim, que é a razão de não o emitirmos', () => {
        // O togeojson colapsa `<TimeStamp><when>` numa chave `timestamp`, que
        // `extractTemporalProperties` lê como INÍCIO (`INSTANT_KEYS`).
        const devolta = extractTemporalProperties({ timestamp: toKmlDateTime(INICIO) });
        expect(devolta).toEqual({ temporalInicio: INICIO });
        expect(devolta.temporalFim).toBeUndefined();
    });
});

describe('I6 — `hasMovingTrajectory` e a nota de degradação', () => {
    const kp = (t) => ({ t, lng: -43, lat: -22 });

    it('dois keypoints movem; um keypoint ou nenhum não movem', () => {
        expect(hasMovingTrajectory({ trajetoria: [kp(1), kp(2)] })).toBe(true);
        expect(hasMovingTrajectory({ trajetoria: [kp(1)] })).toBe(false);
        expect(hasMovingTrajectory({ trajetoria: [] })).toBe(false);
        expect(hasMovingTrajectory({ trajetoria: 'x' })).toBe(false);
        expect(hasMovingTrajectory({})).toBe(false);
        expect(hasMovingTrajectory()).toBe(false);
    });

    it('a nota entra para o ponto móvel e fica fora do ponto parado', () => {
        expect(degradationNotes({ trajetoria: [kp(1), kp(2)] })).toContain(TRAJECTORY_DEGRADATION_NOTE);
        expect(degradationNotes({ trajetoria: [kp(1)] })).not.toContain(TRAJECTORY_DEGRADATION_NOTE);
        expect(degradationNotes({})).toEqual([]);
    });

    it('convive com a nota de hachura, que já existia', () => {
        const notas = degradationNotes({ hatchEnabled: true, trajetoria: [kp(1), kp(2)] });
        expect(notas).toHaveLength(2);
        expect(notas[0]).toContain('Hachura');
        expect(notas[1]).toBe(TRAJECTORY_DEGRADATION_NOTE);
    });
});

describe('I6 — o elemento de tempo entra no Placemark e no GroundOverlay', () => {
    const POINT = '<Point><coordinates>1,2,0</coordinates></Point>';
    const TIME = '<TimeSpan><begin>2026-09-21T12:00:00Z</begin></TimeSpan>';
    const BOX = { north: 1, south: 0, east: 1, west: 0, rotation: 0 };

    it('no Placemark, entre a descrição e o `ExtendedData` (ordem do schema)', () => {
        const xml = buildPlacemark({
            geometry: POINT,
            description: '<description>d</description>',
            time: TIME,
            extendedData: '<ExtendedData/>',
        });
        expect(xml).toContain(TIME);
        expect(xml.indexOf('<description>')).toBeLessThan(xml.indexOf('<TimeSpan>'));
        expect(xml.indexOf('<TimeSpan>')).toBeLessThan(xml.indexOf('<ExtendedData/>'));
        expect(xml.indexOf('<ExtendedData/>')).toBeLessThan(xml.indexOf('<Point>'));
    });

    it('no GroundOverlay, que também é uma Feature do KML', () => {
        const xml = buildGroundOverlay({ href: 'files/a.png', box: BOX, time: TIME });
        expect(xml).toContain(TIME);
        expect(xml.indexOf('<TimeSpan>')).toBeLessThan(xml.indexOf('<Icon>'));
    });

    it('some por completo quando a feição é permanente', () => {
        expect(buildPlacemark({ geometry: POINT })).not.toContain('TimeSpan');
        expect(buildGroundOverlay({ href: 'a.png', box: BOX })).not.toContain('TimeSpan');
    });
});

describe('I6 — a fiação: o mapeador de verdade carimba o tempo em cada categoria', () => {
    /**
     * @param {string} featureType - Tipo de armazenamento
     * @param {Object} geometry - Geometria GeoJSON
     * @param {Object} [extra] - Propriedades extras
     * @returns {Promise<string|null>} Fragmento KML
     */
    function exportar(featureType, geometry, extra = {}) {
        return mapFeatureToKml({
            feature: {
                type: 'Feature',
                properties: {
                    source: featureType,
                    id: 'f1',
                    nome: 'Alvo',
                    temporalInicio: INICIO,
                    temporalFim: FIM,
                    ...extra,
                },
                geometry,
            },
            featureType,
            styles: new StyleRegistry(),
            assets: assetsStub,
            options: { includePhotos: false },
        });
    }

    const LINHA = { type: 'LineString', coordinates: [[0, 0], [1, 1]] };
    const AREA = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
    const PONTO = { type: 'Point', coordinates: [-43.2, -22.9] };

    it.each([
        ['line', LINHA],
        ['polygon', AREA],
        ['point', PONTO],
        ['text', PONTO],
    ])('%s sai com a janela de validade', async (featureType, geometry) => {
        const xml = await exportar(featureType, geometry, featureType === 'text' ? { text: 'T' } : {});
        expect(xml).toContain('<begin>2026-09-21T12:00:00Z</begin>');
        expect(xml).toContain('<end>2026-09-21T18:30:00Z</end>');
    });

    it('a feição permanente não ganha elemento de tempo nenhum', async () => {
        const xml = await mapFeatureToKml({
            feature: { type: 'Feature', properties: { source: 'line', nome: 'L' }, geometry: LINHA },
            featureType: 'line',
            styles: new StyleRegistry(),
            assets: assetsStub,
            options: { includePhotos: false },
        });
        expect(xml).not.toContain('TimeSpan');
    });

    it('o ponto MÓVEL leva a nota de degradação no balão, junto com a janela', async () => {
        const xml = await exportar('point', PONTO, {
            trajetoria: [
                { t: INICIO, lng: -43.2, lat: -22.9 },
                { t: FIM, lng: -43.1, lat: -22.8 },
            ],
        });
        expect(xml).toContain('<TimeSpan>');
        expect(xml).toContain('Trajetória (ponto móvel)');
    });

    it('e o ida-e-volta sobrevive ao mapeador inteiro, não só ao montador', async () => {
        const xml = await exportar('line', LINHA);
        expect(extractTemporalProperties(lerComoOImportadorLe(xml)))
            .toEqual({ temporalInicio: INICIO, temporalFim: FIM });
    });
});
