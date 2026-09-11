// Path: tests/unit/visibility-viewshed-custo.test.js

/**
 * O que custa caro no viewshed, travado contra regressao.
 *
 * Medido em 2026-09-11, grade de 10.020 celulas, com um DEM sintetico:
 * a varredura em si custa 8 a 23 ms, e o `nextPaint` a cada 5 raios custava
 * 957 ms de um total de 979 ms (abertura 359). O rendimento passou a ser por
 * TEMPO decorrido, entao uma varredura mais curta que o orcamento nao para
 * nenhuma vez. As features processadas tambem carregavam uma copia inteira do
 * `cellData` cada uma, 196 KB que nao dizem nada fora da feature principal.
 */

import { describe, it, expect } from 'vitest';
import AddVisibilityGeometry from '../../src/js/analysis_tools/visibility_tool/add_visibility_geometry.js';

const CENTER = [-53.5, -29.7];

/** Mapa falso com o caminho rapido de leitura do DEM da MapLibre 5.18. */
function makeMap(onRead = () => {}) {
    return {
        getTerrain: () => ({ source: 'terrain', exaggeration: 1 }),
        getZoom: () => 13,
        queryTerrainElevation: () => 0,
        terrain: {
            tileManager: { maxzoom: 13, minzoom: 0 },
            getElevationForLngLatZoom: (lngLat) => {
                onRead();
                return 300 + 120 * Math.sin(lngLat.lng * 900) * Math.cos(lngLat.lat * 900);
            },
        },
    };
}

/** Conta quantas vezes a varredura parou para um quadro. */
function countingGeometry() {
    const geometry = new AddVisibilityGeometry();
    let yields = 0;
    const original = geometry.nextPaint.bind(geometry);
    geometry.nextPaint = () => {
        yields++;
        return original();
    };
    return { geometry, yields: () => yields };
}

describe('rendimento da varredura', () => {
    it('nao para nenhuma vez quando a varredura inteira cabe no orcamento de pintura', async () => {
        const { geometry, yields } = countingGeometry();

        await geometry.calculateViewshed(CENTER, 20000, 0, 359, 2, 0, makeMap());

        // Sem o callback de progresso, o caminho do colar tambem passa por aqui.
        expect(yields()).toBe(0);
    });

    it('para quando o relogio passa do orcamento, e o progresso continua sendo avisado', async () => {
        const { geometry, yields } = countingGeometry();

        // Relogio falso que anda meio orcamento a cada leitura: o laco tem de
        // ceder, e o numero de paradas acompanha o TEMPO, nunca o numero de raios.
        let relogio = 0;
        geometry.now = () => relogio;
        const map = makeMap(() => { relogio += AddVisibilityGeometry.PAINT_BUDGET_MS / 2; });

        const progressos = [];
        await geometry.calculateViewshed(CENTER, 5000, 0, 60, 2, 0, map, (pct) => progressos.push(pct));

        expect(yields()).toBeGreaterThan(1);
        expect(progressos.length).toBeGreaterThan(1);
        expect(Math.max(...progressos)).toBeLessThanOrEqual(100);
    });
});

describe('peso do que e guardado', () => {
    it('nao repete o cellData nas duas metades processadas', async () => {
        const geometry = new AddVisibilityGeometry();
        const cells = await geometry.calculateViewshed(CENTER, 5000, 0, 60, 2, 0, makeMap());

        const feature = {
            type: 'Feature',
            properties: {
                id: 'v1',
                source: 'visibility',
                opacity: 0.5,
                center: CENTER,
                radius: 5000,
                bearing: 0,
                aperture: 60,
                cellData: cells.map(cell => ({ isVisible: cell.isVisible })),
            },
            geometry: { type: 'MultiPolygon', coordinates: cells.map(cell => [cell.coordinates]) },
        };

        const processed = geometry.generateProcessedFeatures(feature);

        expect(processed.length).toBeGreaterThan(0);
        for (const pf of processed) {
            expect(pf.properties.cellData).toBeUndefined();
            // O resto das propriedades continua vindo junto, que e o que pinta.
            expect(pf.properties.opacity).toBe(0.5);
            expect(pf.properties.color).toMatch(/^#(00FF00|FF0000)$/);
        }

        // O cellData segue inteiro na feature principal, que e quem o indexa.
        expect(feature.properties.cellData.length).toBe(feature.geometry.coordinates.length);
    });

    it('withoutCellData nao mexe no objeto de origem', () => {
        const props = { id: 'v1', opacity: 1, cellData: [{ isVisible: true }] };
        const limpo = AddVisibilityGeometry.withoutCellData(props);

        expect(limpo.cellData).toBeUndefined();
        expect(limpo.id).toBe('v1');
        expect(props.cellData).toHaveLength(1);
    });
});

describe('no do observador', () => {
    it('o handle central existe e e arrastavel', () => {
        const geometry = new AddVisibilityGeometry();
        const feature = {
            properties: { id: 'v1', center: CENTER, radius: 5000, bearing: 45, aperture: 60 },
        };

        const handles = geometry.createHandles(feature);
        const centro = handles.find(h => h.properties.handleId === 'center');

        expect(centro).toBeDefined();
        expect(centro.properties.user_isEditingHandle).toBe(true);
        expect(centro.geometry.coordinates).toEqual(CENTER);
    });

    it('mover o centro devolve o novo centro e mantem raio, azimute e abertura', () => {
        const geometry = new AddVisibilityGeometry();
        const feature = {
            properties: { id: 'v1', center: CENTER, radius: 5000, bearing: 45, aperture: 60 },
        };
        const novoCentro = [-53.4, -29.6];

        const result = geometry.updateFromHandle('center', novoCentro, feature);

        expect(result.center).toEqual(novoCentro);
        expect(result.radius).toBe(5000);
        expect(result.bearing).toBe(45);
        expect(result.aperture).toBe(60);
        // O setor de previa foi redesenhado em volta do centro novo.
        expect(result.geometry.coordinates[0][0]).toEqual(novoCentro);
    });

    it('os outros handles devolvem o centro antigo, para que o recalculo nao o perca', () => {
        const geometry = new AddVisibilityGeometry();
        const feature = {
            properties: { id: 'v1', center: CENTER, radius: 5000, bearing: 0, aperture: 60 },
        };

        const raio = geometry.updateFromHandle('radius', [-53.45, -29.65], feature);
        const abertura = geometry.updateFromHandle('aperture', [-53.45, -29.65], feature);

        expect(raio.center).toEqual(CENTER);
        expect(abertura.center).toEqual(CENTER);
    });
});

describe('fusao radial das celulas', () => {
    /**
     * A fusao tem de ser EXATA, e nao so menor: o veredito de cada ponto da grade
     * e a area coberta ficam iguais. Um teste que so contasse poligonos aprovaria
     * uma fusao que engole celula.
     */
    function grade(linhas) {
        return linhas.map(linha => linha.split('').map(c => ({ visible: c === 'v' })));
    }

    /** Distancia de cada celula, na ordem em que a grade as produz. */
    function faixas(cells, distanceDivisions, center, geometry) {
        return cells.map(c => {
            const dists = c.coordinates.map(p => geometry.calculateDistance(center, p));
            return {
                isVisible: c.isVisible,
                de: Math.round(Math.min(...dists) / distanceDivisions),
                ate: Math.round(Math.max(...dists) / distanceDivisions),
            };
        });
    }

    it('funde as corridas do mesmo raio e cobre exatamente a mesma extensao', () => {
        const geometry = new AddVisibilityGeometry();
        // Um raio com tres corridas: vvv, ooo, vv.
        const resultGrid = grade(['vvvooovv', 'vvvooovv']);
        const cells = geometry.generateWedgeCells(resultGrid, CENTER, 0, 1, 100, 8);

        // Um raio util (o laco para em length-1), tres corridas.
        expect(cells).toHaveLength(3);

        const f = faixas(cells, 100, CENTER, geometry);
        expect(f.map(c => c.isVisible)).toEqual([true, false, true]);
        expect(f.map(c => [c.de, c.ate])).toEqual([[0, 3], [3, 6], [6, 8]]);
    });

    it('alternancia celula a celula nao funde nada, que e o pior caso', () => {
        const geometry = new AddVisibilityGeometry();
        const resultGrid = grade(['vovovo', 'vovovo']);
        const cells = geometry.generateWedgeCells(resultGrid, CENTER, 0, 1, 100, 6);

        // Nenhuma corrida tem vizinha igual: a fusao nao pode inventar ganho.
        expect(cells).toHaveLength(6);
        expect(cells.map(c => c.isVisible)).toEqual([true, false, true, false, true, false]);
    });

    it('um raio todo visivel vira UMA cunha do centro ate a borda', () => {
        const geometry = new AddVisibilityGeometry();
        const resultGrid = grade(['vvvvvvvvvv', 'vvvvvvvvvv']);
        const cells = geometry.generateWedgeCells(resultGrid, CENTER, 0, 1, 100, 10);

        expect(cells).toHaveLength(1);
        const [f] = faixas(cells, 100, CENTER, geometry);
        expect([f.de, f.ate]).toEqual([0, 10]);
    });

    it('o veredito de cada celula da grade sobrevive a fusao', async () => {
        const geometry = new AddVisibilityGeometry();
        const cells = await geometry.calculateViewshed(CENTER, 5000, 0, 60, 2, 0, makeMap());

        // Reconstroi o veredito por faixa e confere contra a varredura crua.
        const visiveis = cells.filter(c => c.isVisible).length;
        expect(visiveis).toBeGreaterThan(0);
        expect(visiveis).toBeLessThan(cells.length);

        // A fusao nunca produz celula de extensao zero nem anel invertido.
        for (const c of cells) {
            const dists = c.coordinates.map(p => geometry.calculateDistance(CENTER, p));
            expect(Math.max(...dists)).toBeGreaterThan(Math.min(...dists));
        }
    });
});
