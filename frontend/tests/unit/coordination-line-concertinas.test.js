import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { runInThisContext } from 'node:vm';
import { readFileSync } from 'node:fs';

/**
 * The two concertinas of the MD33 catalogue (290308 dupla, 290309 tripla) against
 * the REAL turf bundle the app ships.
 *
 * Everything here is a MEASUREMENT in metres, never a call count, because the two
 * symbols share every line of the builder and differ ONLY in two numbers: the rail
 * gap (0.7 against 1.35 of `symbol_size`) and the loop height (2.6 against 1.0 of
 * that gap). What separates them on the plate is a single fact: the double's loop
 * OVERTOPS its rail, and the triple's loop is CONTAINED between spine and rail,
 * touching both. A suite that only counted parts would pass with the two drawings
 * identical.
 *
 * The plate figures come from MD33-M-02, measured in pixels on 2026-09-03:
 *   - 290308: a 19 px band, rails 7 px apart, an 18 px loop standing on the spine,
 *     a 20.5 px period. 18/7 = 2.6 loop heights per rail gap.
 *   - 290309: a 20 px band with the rails on its EDGES (17.5 px apart) and the loop
 *     spanning exactly that gap. 1.0 loop height per rail gap.
 *
 * THE RULER. `turf.along`, which places every glyph anchor, interpolates along a
 * GREAT CIRCLE, while a two-vertex lineString read by `turf.pointToLineDistance` is
 * measured as the straight chord in lon/lat. Measured on 2026-09-03 against this
 * bundle, on an east-west line at latitude -30, the two disagree by 1.13 m over
 * 10 km and by 112.67 m over 100 km, and reading the loops against the raw base
 * coordinates reported the loop floating 106 m off a line it actually touches. So
 * `reguaDaEspinha` densifies the spine with the same `turf.along` the drawing uses,
 * and every distance below is taken against that.
 */

// The geometry imports BaseGeometry from the `@tools` barrel, which pulls in
// DOM/MapLibre-coupled modules; a trivial base keeps this file in `node`.
vi.mock('@tools', () => ({
    BaseGeometry: class {
        constructor(properties = {}) { this.properties = properties; }
        calculateDistance(a, b) {
            const toRad = (d) => (d * Math.PI) / 180;
            const R = 6371000;
            const dLat = toRad(b[1] - a[1]);
            const dLng = toRad(b[0] - a[0]);
            const h = Math.sin(dLat / 2) ** 2
                + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
            return 2 * R * Math.asin(Math.sqrt(h));
        }
    },
}));

const require = createRequire(import.meta.url);

let AddCoordinationLineGeometry;
let geom;
let turf;
let CONSTANTS;

beforeAll(async () => {
    // The app loads turf from a <script> tag, so it is a global, not a module:
    // run the shipped bundle in this context and read the global it defines.
    const code = readFileSync(require.resolve('../../public/vendors/turf.min.js'), 'utf8');
    runInThisContext(code);
    turf = globalThis.turf;

    ({ default: AddCoordinationLineGeometry } =
        await import('../../src/js/military_tools/coordination_line_tool/add_coordination_line_geometry.js'));
    geom = new AddCoordinationLineGeometry();
    CONSTANTS = AddCoordinationLineGeometry.GEOMETRY_CONSTANTS;
});

const DUPLA = '290308';
const TRIPLA = '290309';

/** The catalogue's rail gap for each symbol, as a multiple of `symbol_size`. */
const GAP_RATIO = { [DUPLA]: 0.7, [TRIPLA]: 1.35 };

// ============================================================================
// LINES, RULERS AND THE PARTS OF A DRAWING
// ============================================================================

/** A straight west-to-east line of roughly `km` kilometres at latitude -30. */
const lesteOeste = (km) => [[-53.0, -30.0], [-53.0 + km / 96.3, -30.0]];

/** A straight south-to-north line of roughly `km` kilometres from latitude -30. */
const norteSul = (km) => [[-53.0, -30.0], [-53.0, -30.0 + km / 111.0]];

/** A line running north-east, so neither axis dominates. */
const diagonal = (km) => [[-53.0, -30.0], [-53.0 + km / 136.1, -30.0 + km / 156.9]];

/** Metres between two coordinates. */
const metros = (a, b) => turf.distance(turf.point(a), turf.point(b), { units: 'meters' });

/** Kilometres along a coordinate array. */
const comprimentoKm = (coords) => turf.length(turf.lineString(coords), { units: 'kilometers' });

/**
 * The measuring line: the spine sampled with the SAME `turf.along` the drawing
 * uses to place its anchors, so the ruler and the drawing follow one geodesic.
 *
 * Sampled SEGMENT BY SEGMENT, keeping every authored vertex. Densifying the whole
 * line in one pass cuts the corners: measured on 2026-09-03, a 400-station ruler
 * over the 90 degree elbow below left its own corner vertex 5 m off the ruler, and
 * the spine was classified as a rail.
 *
 * @param {Array} base - Base coordinates
 * @param {number} [porSegmento] - Samples per segment
 * @returns {Object} Turf lineString to measure against
 */
function reguaDaEspinha(base, porSegmento = 200) {
    const pontos = [];

    for (let i = 0; i < base.length - 1; i++) {
        const segmento = turf.lineString([base[i], base[i + 1]]);
        const comprimento = turf.length(segmento, { units: 'kilometers' });
        for (let j = 0; j < porSegmento; j++) {
            pontos.push(
                turf.along(segmento, (comprimento * j) / porSegmento, { units: 'kilometers' })
                    .geometry.coordinates,
            );
        }
    }
    pontos.push(base[base.length - 1]);

    return turf.lineString(pontos);
}

/** Metres from a coordinate to the ruler. */
const aEspinha = (coord, regua) =>
    turf.pointToLineDistance(turf.point(coord), regua, { units: 'meters' });

/** Every `[lng, lat]` a geometry carries, whatever its type. */
function todasAsCoordenadas(geometry) {
    return geometry.type === 'LineString' ? geometry.coordinates : geometry.coordinates.flat();
}

/**
 * Split a drawing into its three families, by STRUCTURE rather than by emission
 * order: a glyph is a CLOSED ring, the spine is the open part whose every vertex
 * lies on the ruler, and whatever open part is left runs beside it and is a rail.
 *
 * Closedness rather than a point count, so the same classifier reads the default
 * symbol too (a five-point diamond) and can prove it has NO rail. The concertina
 * tests check the ring's point count separately.
 *
 * @param {Object} geometry - Generated geometry
 * @param {Object} regua - Measuring line
 * @returns {{espinha: Array, espinhas: Array, trilhos: Array, argolas: Array}} The families
 */
function separar(geometry, regua) {
    const argolas = [];
    const espinhas = [];
    const trilhos = [];

    for (const coords of geometry.coordinates) {
        const fechada = coords.length >= 3 && metros(coords[0], coords[coords.length - 1]) < 0.001;

        if (fechada) {
            argolas.push(coords);
        } else if (coords.every(p => aEspinha(p, regua) < 1)) {
            espinhas.push(coords);
        } else {
            trilhos.push(coords);
        }
    }

    return { espinha: espinhas[0], espinhas, trilhos, argolas };
}

/** Build the properties a drawn coordination line would carry. */
const props = (baseCoordinates, overrides = {}) => ({
    baseCoordinates,
    lineWidth: 4,
    symbol_size: 0.5,
    symbol_spacing: 2,
    // `createdAtZoom: 0` is NOT a zoom reference (see hasZoomReference), so both
    // zoom factors are 1 and the derived sizes are the authored ones. Every
    // millimetre below is therefore a statement about `symbol_size` itself.
    createdAtZoom: 0,
    zoomCorrectionEnabled: true,
    ...overrides,
});

/**
 * Draw one concertina and measure it: the rail's distance from the spine, and how
 * far the loop reaches on each side.
 *
 * @param {string} code - Symbol code
 * @param {Array} base - Base coordinates
 * @param {Object} [overrides] - Property overrides
 * @returns {Object} The measured drawing
 */
function medir(code, base, overrides = {}) {
    const propriedades = props(base, { symbol_code: code, ...overrides });
    const geometry = geom.generate(propriedades, 12);
    const regua = reguaDaEspinha(base);
    const partes = separar(geometry, regua);

    const trilho = partes.trilhos[0];
    const meioDoTrilho = trilho ? trilho[Math.floor(trilho.length / 2)] : null;

    const distanciasDaArgola = partes.argolas.map(argola => argola.map(p => aEspinha(p, regua)));

    return {
        geometry,
        regua,
        propriedades,
        ...partes,
        distanciaDoTrilho: meioDoTrilho ? aEspinha(meioDoTrilho, regua) : NaN,
        // Worst case over every loop, not the first one: a loop straddling a bend
        // is the one that drifts.
        argolaMinima: Math.min(...distanciasDaArgola.map(d => Math.min(...d))),
        argolaMaxima: Math.max(...distanciasDaArgola.map(d => Math.max(...d))),
    };
}

/** Relative gap between a measurement and what the catalogue asks for. */
const erroRelativo = (medido, esperado) => Math.abs(medido - esperado) / esperado;

// ============================================================================
// CONCERTINA DUPLA (290308)
// ============================================================================

describe('concertina dupla (290308)', () => {
    it('emite a espinha inteira, UM trilho paralelo e uma argola por glifo', () => {
        const base = lesteOeste(10);
        const medida = medir(DUPLA, base);
        const { count } = geom.describeLayout(medida.propriedades, 12);

        expect(medida.geometry.type).toBe('MultiLineString');
        expect(count).toBeGreaterThan(1);

        // 1 espinha + 1 trilho + uma argola por glifo, e nada mais.
        expect(medida.geometry.coordinates).toHaveLength(1 + 1 + count);
        expect(medida.espinhas).toHaveLength(1);
        expect(medida.trilhos).toHaveLength(1);
        expect(medida.argolas).toHaveLength(count);

        // Cada argola é a elipse fechada de COIL_STEPS + 1 pontos.
        for (const argola of medida.argolas) {
            expect(argola).toHaveLength(CONSTANTS.COIL_STEPS + 1);
        }

        // A espinha vai INTEIRA: `interrupts: false`, e a argola se apoia nela.
        expect(comprimentoKm(medida.espinha)).toBeCloseTo(comprimentoKm(base), 3);
    });

    it('o trilho paralelo corre a symbol_size * 0.7 da espinha', () => {
        // symbol_size 0.5 km * 0.7 = 350 m. Medido em 2026-09-03: 350.000 m.
        const medida = medir(DUPLA, lesteOeste(10), { symbol_size: 0.5 });
        expect(erroRelativo(medida.distanciaDoTrilho, 350)).toBeLessThan(0.02);
    });

    it('o trilho segue o symbol_size, e não um número fixo', () => {
        for (const symbol_size of [0.1, 0.5, 1.5]) {
            const medida = medir(DUPLA, lesteOeste(10), { symbol_size, symbol_spacing: 3 });
            const esperado = symbol_size * GAP_RATIO[DUPLA] * 1000;
            expect(erroRelativo(medida.distanciaDoTrilho, esperado)).toBeLessThan(0.02);
        }
    });

    it('a argola TRANSBORDA o trilho, que é o que a separa da tripla', () => {
        // Sem esta medida, dupla e tripla passam como iguais: as duas emitem
        // espinha, trilho e argola, e só o transbordo distingue os desenhos.
        // Da prancha: argola de 18 px sobre trilhos a 7 px, ou seja 2.6 vezes.
        // Medido em 2026-09-03: trilho a 350.000 m, argola até 909.5 m.
        const medida = medir(DUPLA, lesteOeste(10));

        expect(medida.argolaMaxima).toBeGreaterThan(medida.distanciaDoTrilho);
        expect(medida.argolaMaxima / medida.distanciaDoTrilho)
            .toBeCloseTo(CONSTANTS.COIL_DOUBLE_HEIGHT_RATIO, 1);
    });

    it('a argola ENCOSTA na espinha, porque se apoia na linha', () => {
        // Medido em 2026-09-03 contra a régua densificada: 0.001 m.
        const medida = medir(DUPLA, lesteOeste(10));
        expect(medida.argolaMinima).toBeLessThan(3);
    });
});

// ============================================================================
// CONCERTINA TRIPLA (290309)
// ============================================================================

describe('concertina tripla (290309)', () => {
    it('emite a espinha inteira, UM trilho paralelo e uma argola por glifo', () => {
        const base = lesteOeste(10);
        const medida = medir(TRIPLA, base);
        const { count } = geom.describeLayout(medida.propriedades, 12);

        expect(medida.geometry.coordinates).toHaveLength(1 + 1 + count);
        expect(medida.espinhas).toHaveLength(1);
        expect(medida.trilhos).toHaveLength(1);
        expect(medida.argolas).toHaveLength(count);

        for (const argola of medida.argolas) {
            expect(argola).toHaveLength(CONSTANTS.COIL_STEPS + 1);
        }

        expect(comprimentoKm(medida.espinha)).toBeCloseTo(comprimentoKm(base), 3);
    });

    it('o trilho paralelo corre a symbol_size * 1.35 da espinha', () => {
        // symbol_size 0.5 km * 1.35 = 675 m. Medido em 2026-09-03: 675.000 m.
        const medida = medir(TRIPLA, lesteOeste(10), { symbol_size: 0.5 });
        expect(erroRelativo(medida.distanciaDoTrilho, 675)).toBeLessThan(0.02);
    });

    it('a argola NÃO transborda o trilho', () => {
        // Da prancha: a faixa de 20 px tem os trilhos nas BORDAS, e a argola cabe
        // entre eles. Medido em 2026-09-03: trilho a 675.000 m, argola até 674.6 m.
        const medida = medir(TRIPLA, lesteOeste(10));
        expect(medida.argolaMaxima).toBeLessThanOrEqual(medida.distanciaDoTrilho + 3);
    });

    it('a argola encosta nos DOIS trilhos', () => {
        // Contida quer dizer tocando os dois lados: a espinha embaixo e o trilho
        // em cima. Medido em 2026-09-03: mínimo 0.001 m, máximo 674.6 m contra um
        // trilho a 675.000 m.
        const medida = medir(TRIPLA, lesteOeste(10));

        expect(medida.argolaMinima).toBeLessThan(3);
        expect(medida.distanciaDoTrilho - medida.argolaMaxima).toBeLessThan(3);
    });
});

// ============================================================================
// A DISTINÇÃO: o teste que reprova quem igualar os dois símbolos
// ============================================================================

describe('a dupla e a tripla são desenhos diferentes', () => {
    /** Quanto a argola passa do trilho, em múltiplos da distância do trilho. */
    const transbordo = (code) => {
        const medida = medir(code, lesteOeste(10));
        return medida.argolaMaxima / medida.distanciaDoTrilho;
    };

    it('com os MESMOS parâmetros, a dupla transborda e a tripla não', () => {
        // Medido em 2026-09-03: dupla 2.599, tripla 0.999.
        //
        // Igualar os dois COIL_*_HEIGHT_RATIO leva as duas ao mesmo transbordo e
        // reprova aqui. Igualar os dois railGapRatio reprova nos testes de
        // distância do trilho acima, que exigem 0.7 e 1.35 por nome.
        const daDupla = transbordo(DUPLA);
        const daTripla = transbordo(TRIPLA);

        expect(daDupla).toBeGreaterThan(2);
        expect(daTripla).toBeLessThanOrEqual(1.02);
        expect(daDupla).toBeGreaterThan(daTripla * 2);
    });

    it('as duas ocupam faixas de larguras diferentes', () => {
        // A faixa é o que o símbolo cobre no terreno: da espinha ao ponto mais
        // afastado, seja ele do trilho ou da argola. Medido em 2026-09-03:
        // dupla 909.5 m, tripla 675.0 m.
        const faixa = (code) => {
            const medida = medir(code, lesteOeste(10));
            return Math.max(medida.argolaMaxima, medida.distanciaDoTrilho);
        };

        expect(faixa(DUPLA)).toBeGreaterThan(faixa(TRIPLA) * 1.2);
    });

    it('os dois códigos não produzem a mesma geometria', () => {
        const base = lesteOeste(10);
        const daDupla = geom.generate(props(base, { symbol_code: DUPLA }), 12);
        const daTripla = geom.generate(props(base, { symbol_code: TRIPLA }), 12);
        expect(daDupla.coordinates).not.toEqual(daTripla.coordinates);
    });

    // ------------------------------------------------------------------------
    // A RÉGUA CONTRA O PIOR CASO QUE ELA EXISTE PARA PEGAR
    // ------------------------------------------------------------------------

    it('a régua do trilho REPROVA a distância do outro símbolo', () => {
        // Uma régua que só foi vista passar no insumo bom não foi vista
        // funcionar. Aqui ela é apontada para o número errado de propósito: se
        // alguém igualar os dois `railGapRatio`, é este cruzamento que cai.
        const daDupla = medir(DUPLA, lesteOeste(10), { symbol_size: 0.5 });
        const daTripla = medir(TRIPLA, lesteOeste(10), { symbol_size: 0.5 });

        expect(erroRelativo(daDupla.distanciaDoTrilho, 675)).toBeGreaterThan(0.02);
        expect(erroRelativo(daTripla.distanciaDoTrilho, 350)).toBeGreaterThan(0.02);
    });

    it('a régua do transbordo REPROVA um desenho com as duas alturas iguais', () => {
        // O insumo degenerado que este arquivo existe para pegar: alguém iguala
        // COIL_DOUBLE_HEIGHT_RATIO a COIL_TRIPLE_HEIGHT_RATIO, as duas argolas
        // passam a caber dentro do trilho, e os dois símbolos viram o mesmo
        // desenho com trilhos em distâncias diferentes. A constante é um campo
        // estático mutável; o catálogo é congelado, e por isso o eixo do
        // `railGapRatio` é coberto pelo cruzamento do teste acima.
        const original = CONSTANTS.COIL_DOUBLE_HEIGHT_RATIO;

        try {
            CONSTANTS.COIL_DOUBLE_HEIGHT_RATIO = CONSTANTS.COIL_TRIPLE_HEIGHT_RATIO;

            const daDupla = transbordo(DUPLA);
            const daTripla = transbordo(TRIPLA);

            // Com as alturas iguais, a dupla deixa de transbordar: as três
            // asseverações do teste da distinção caem.
            expect(daDupla).toBeLessThan(2);
            expect(daDupla).not.toBeGreaterThan(daTripla * 2);
        } finally {
            CONSTANTS.COIL_DOUBLE_HEIGHT_RATIO = original;
        }

        // E o desenho volta ao que era depois da restauração.
        expect(transbordo(DUPLA)).toBeGreaterThan(2);
    });
});

// ============================================================================
// PIOR CASO: os insumos que a régua existe para pegar
// ============================================================================

describe('pior caso', () => {
    const degenerados = [
        ['linha de comprimento zero', [[-53, -30], [-53, -30]]],
        ['linha de dois pontos a 1 m', [[-53, -30], [-53, -29.999991]]],
    ];

    for (const code of [DUPLA, TRIPLA]) {
        for (const [nome, base] of degenerados) {
            it(`${code}: ${nome} degrada para LineString sem lançar`, () => {
                let geometry;
                expect(() => { geometry = geom.generate(props(base, { symbol_code: code }), 12); }).not.toThrow();

                // Nenhuma argola inteira cabe, e o desenho cai na espinha crua.
                expect(geometry.type).toBe('LineString');
                expect(geometry.coordinates).toEqual(base);
            });
        }

        it(`${code}: vai-e-volta (A -> B -> A) desenha sem NaN`, () => {
            const base = [[-53, -30], [-52.95, -30], [-53, -30]];
            let geometry;
            expect(() => { geometry = geom.generate(props(base, { symbol_code: code }), 12); }).not.toThrow();

            expect(geometry.type).toBe('MultiLineString');
            for (const [lng, lat] of todasAsCoordenadas(geometry)) {
                expect(Number.isFinite(lng)).toBe(true);
                expect(Number.isFinite(lat)).toBe(true);
            }
        });

        it(`${code}: symbol_size maior que a linha cai no padrão sem lançar`, () => {
            let geometry;
            expect(() => {
                geometry = geom.generate(props(lesteOeste(1), { symbol_code: code, symbol_size: 50 }), 12);
            }).not.toThrow();
            expect(geometry.type).toBe('LineString');
        });
    }

    it('uma dobra de 90 graus mantém o trilho à ESQUERDA do sentido de percurso', () => {
        // O trilho sai por `turf.lineOffset` com deslocamento negativo, o mesmo
        // lado em que `bearing - 90` põe cada argola. Se ele trocar de lado, a
        // argola cruza a espinha e o símbolo vira outro.
        const base = [[-53.0, -30.0], [-52.98, -30.0], [-52.98, -29.98]];

        for (const code of [DUPLA, TRIPLA]) {
            const medida = medir(code, base, { symbol_size: 0.3, symbol_spacing: 0.8 });
            expect(medida.trilhos).toHaveLength(1);

            for (const vertice of medida.trilhos[0]) {
                const proximo = turf.nearestPointOnLine(medida.regua, turf.point(vertice));
                const indice = Math.min(proximo.properties.index, medida.regua.geometry.coordinates.length - 2);
                const rumoDaEspinha = turf.bearing(
                    turf.point(medida.regua.geometry.coordinates[indice]),
                    turf.point(medida.regua.geometry.coordinates[indice + 1]),
                );
                const rumoAteOTrilho = turf.bearing(proximo, turf.point(vertice));

                let delta = rumoAteOTrilho - rumoDaEspinha;
                while (delta > 180) delta -= 360;
                while (delta <= -180) delta += 360;

                // Esquerda do percurso é -90 graus. O sinal é o que importa; a
                // folga cobre a esquadria do canto mitrado.
                expect(delta, `${code} vertice ${JSON.stringify(vertice)}`).toBeLessThan(-45);
                expect(delta, `${code} vertice ${JSON.stringify(vertice)}`).toBeGreaterThan(-135);
            }
        }
    });

    it('um symbol_code desconhecido cai no símbolo padrão, sem lançar e sem trilho', () => {
        const base = lesteOeste(10);
        let doDesconhecido;
        expect(() => { doDesconhecido = geom.generate(props(base, { symbol_code: '999999' }), 12); }).not.toThrow();

        const doPadrao = geom.generate(props(base, { symbol_code: '290199' }), 12);
        expect(doDesconhecido).toEqual(doPadrao);

        // O padrão (290199, losango) não tem trilho: toda parte aberta corre SOBRE
        // a espinha, e nenhuma corre ao lado dela.
        const regua = reguaDaEspinha(base);
        const partes = separar(doDesconhecido, regua);
        expect(partes.trilhos).toHaveLength(0);
        expect(partes.argolas.length).toBeGreaterThan(0);
        // E os glifos do padrão são losangos de cinco pontos, não elipses.
        expect(partes.argolas.every(a => a.length === 5)).toBe(true);
    });

    it('toda coordenada emitida é finita e a latitude fica em [-90, 90]', () => {
        const casos = [
            ['reta leste-oeste', lesteOeste(10), {}],
            ['reta norte-sul', norteSul(10), {}],
            ['diagonal', diagonal(10), {}],
            ['comprimento zero', [[-53, -30], [-53, -30]], {}],
            ['dois pontos a 1 m', [[-53, -30], [-53, -29.999991]], {}],
            ['vai-e-volta', [[-53, -30], [-52.95, -30], [-53, -30]], {}],
            ['dobra de 90 graus', [[-53.0, -30.0], [-52.98, -30.0], [-52.98, -29.98]], { symbol_size: 0.3, symbol_spacing: 0.8 }],
            ['symbol_size absurdo', lesteOeste(1), { symbol_size: 50 }],
            ['symbol_size absurdo em linha longa', lesteOeste(100), { symbol_size: 40, symbol_spacing: 1 }],
            ['symbol_spacing zero', lesteOeste(10), { symbol_spacing: 0 }],
            ['symbol_size NaN', lesteOeste(10), { symbol_size: NaN }],
            ['perto do polo', [[-53, -84], [-52.5, -84]], {}],
            ['cruzando o equador', [[-53, -0.05], [-53, 0.05]], {}],
        ];

        for (const code of [DUPLA, TRIPLA]) {
            for (const [nome, base, overrides] of casos) {
                let geometry;
                expect(() => {
                    geometry = geom.generate(props(base, { symbol_code: code, ...overrides }), 12);
                }, `${code} / ${nome}`).not.toThrow();

                expect(['LineString', 'MultiLineString'], `${code} / ${nome}`).toContain(geometry.type);

                const pontos = todasAsCoordenadas(geometry);
                expect(pontos.length, `${code} / ${nome}`).toBeGreaterThan(0);

                for (const ponto of pontos) {
                    expect(Array.isArray(ponto), `${code} / ${nome}`).toBe(true);
                    expect(Number.isFinite(ponto[0]), `${code} / ${nome} lng ${ponto[0]}`).toBe(true);
                    expect(Number.isFinite(ponto[1]), `${code} / ${nome} lat ${ponto[1]}`).toBe(true);
                    expect(Math.abs(ponto[1]), `${code} / ${nome} lat ${ponto[1]}`).toBeLessThanOrEqual(90);
                }
            }
        }
    });
});

// ============================================================================
// O RUMO DA LINHA: trilho geodésico contra trilho em graus
// ============================================================================

describe('o trilho e a argola têm de concordar em QUALQUER rumo', () => {
    const rumos = [
        ['leste-oeste', lesteOeste(10)],
        ['norte-sul', norteSul(10)],
        ['diagonal a 45 graus', diagonal(10)],
    ];

    for (const [nome, base] of rumos) {
        it(`${nome}: o trilho da tripla fica onde o catálogo manda, e contém a argola`, () => {
            // DEFEITO DE PRODUÇÃO, pego aqui em 2026-09-03. Passa em leste-oeste e
            // REPROVA nos outros dois rumos.
            //
            // `buildRails` usa `turf.lineOffset`, que desloca em GRAUS e não no
            // terreno, enquanto a argola sai de `turf.destination`, que é
            // geodésico. Numa linha norte-sul o trilho é deslocado em longitude, e
            // o chão encolhe por cos(latitude): medido a -30 de latitude, o trilho
            // da tripla cai a 584.57 m dos 675 m pedidos, exatamente 675*cos(30).
            // A argola continua com 675 m, então ela TRANSBORDA o trilho em 90 m,
            // e a tripla passa a desenhar como a dupla, que é a única coisa que as
            // distingue na prancha. A 45 graus o trilho fica a 631.41 m e o
            // transbordo é de 50 m. A -55 de latitude o trilho cai a 387.16 m
            // contra 675 m da argola.
            const medida = medir(TRIPLA, base, { symbol_size: 0.5 });

            expect(erroRelativo(medida.distanciaDoTrilho, 675)).toBeLessThan(0.02);
            expect(medida.argolaMaxima).toBeLessThanOrEqual(medida.distanciaDoTrilho + 3);
        });
    }
});
