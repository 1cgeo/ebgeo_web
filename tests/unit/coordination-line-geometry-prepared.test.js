import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { runInThisContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { LINEAR_SYMBOLS } from '../../src/js/military_tools/coordination_line_tool/coordination_line_catalog.js';

/**
 * The PREPARED spine against the turf it replaces.
 *
 * `alongPrepared` and `slicePrepared` exist for speed alone: they must answer
 * what `turf.along` and `turf.lineSliceAlong` answer, to the last bit, because
 * the coordination line is drawn so that the gap in the spine and the glyph
 * anchored in it come from the SAME arithmetic. Measured on 2026-09-03 against
 * this same bundle, swapping one of the two calls for a merely equivalent one
 * (`turf.lineSlice`, planar) opened 1.13 m of daylight on a 10 km line and
 * 113.59 m on a 100 km one. A rounding step is smaller than that and still
 * wrong, so the ruler here is equality and not closeness.
 *
 * Three families:
 *   1. `alongPrepared` against `turf.along`, on random lines x random distances,
 *      the throws included.
 *   2. `slicePrepared` against `turf.lineSliceAlong`, the same way.
 *   3. `generate()` whole, against a fixture carrying the OLD bodies of those two
 *      calls, over every symbol in the catalogue.
 *
 * Plus the worst case each ruler exists to catch, run against a deliberately
 * broken spine, because a comparison only seen to pass has not been seen to work.
 */

// The geometry imports BaseGeometry from the `@tools` barrel, which pulls in
// DOM/MapLibre-coupled modules; a trivial base keeps this file in `node`.
vi.mock('@tools', () => ({
    BaseGeometry: class {
        constructor(properties = {}) { this.properties = properties; }
    },
}));

const require = createRequire(import.meta.url);

let AddCoordinationLineGeometry;
let geom;
let antigo;
let turf;

/**
 * The geometry as it stood before the prepared spine: the two calls the rewrite
 * replaced, copied back verbatim over the new ones.
 *
 * A subclass and not a second copy of the file, because the rewrite touched
 * NOTHING else in the drawing path: `generate` still walks the same layout, the
 * same glyph builders and the same rails. Anything that diverges below is the
 * arithmetic of these two methods, which is exactly what is on trial.
 */
function fixtureAntiga(Base) {
    return class GeometriaAntiga extends Base {
        alongPrepared(prepared, d) {
            return turf.along(prepared.line, d, { units: 'kilometers' });
        }

        slicePrepared(prepared, from, to) {
            const slice = turf.lineSliceAlong(prepared.line, from, to, { units: 'kilometers' });
            return slice?.geometry?.coordinates ?? [];
        }
    };
}

beforeAll(async () => {
    // The app loads turf from a <script> tag, so it is a global, not a module.
    const code = readFileSync(require.resolve('../../public/vendors/turf.min.js'), 'utf8');
    runInThisContext(code);
    turf = globalThis.turf;

    ({ default: AddCoordinationLineGeometry } =
        await import('../../src/js/military_tools/coordination_line_tool/add_coordination_line_geometry.js'));
    geom = new AddCoordinationLineGeometry();
    antigo = new (fixtureAntiga(AddCoordinationLineGeometry))();
});

// ============================================================================
// A DETERMINISTIC CORPUS OF LINES
// ============================================================================

/** mulberry32: a seeded PRNG, so a failure here is reproducible. */
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * One random spine: 2 to 120 vertices, 1 to 300 km, at a Brazilian latitude.
 *
 * Every fourth line repeats a vertex and every fifth one carries a segment of a
 * tenth of a millimetre. Both are the degenerate cases the binary search can get
 * wrong in a way a well-behaved line never shows: a repeated vertex makes two
 * entries of the running distance EQUAL, so "the first vertex that reaches d" is
 * ambiguous unless the search really returns the first.
 */
function linhaAleatoria(rand, i) {
    const n = 2 + Math.floor(rand() * 119);
    const totalKm = 1 + rand() * 299;
    const lat0 = -35 + rand() * 40;
    const lng0 = -70 + rand() * 40;
    const rumoBase = rand() * 360;

    const coords = [[lng0, lat0]];
    let atual = turf.point([lng0, lat0]);

    for (let k = 1; k < n; k++) {
        const repetido = i % 4 === 0 && k === Math.floor(n / 2);
        const curtissimo = i % 5 === 0 && k === Math.max(1, n - 2);

        if (repetido) {
            coords.push(coords[coords.length - 1].slice());
            continue;
        }

        const passo = curtissimo ? 1e-7 : totalKm / (n - 1);
        const rumo = rumoBase + (rand() - 0.5) * 120;
        atual = turf.destination(atual, passo, rumo, { units: 'kilometers' });
        coords.push(atual.geometry.coordinates);
    }

    return coords;
}

/** The running distance to each vertex, the way turf accumulates it. */
function acumuladas(coords) {
    const cum = [0];
    for (let i = 1; i < coords.length; i++) {
        cum.push(cum[i - 1] + turf.distance(coords[i - 1], coords[i], { units: 'kilometers' }));
    }
    return cum;
}

/**
 * Twenty distances per line: zero, the total, past the total, every kind of
 * vertex-exact value, and the rest scattered inside.
 */
function distancias(rand, cum) {
    const total = cum[cum.length - 1];
    const alvos = [0, total, total + 1, total * 0.5];

    // Vertex-exact distances are the whole point of the binary search: they are
    // where turf returns the vertex itself instead of stepping back into the
    // segment, and where an off-by-one lands on the wrong vertex.
    for (let k = 0; k < 4 && cum.length > 2; k++) {
        alvos.push(cum[1 + Math.floor(rand() * (cum.length - 2))]);
    }

    while (alvos.length < 20) alvos.push(rand() * total * 1.05);
    return alvos.slice(0, 20);
}

/** Run something, reporting the throw instead of letting it escape. */
function tentar(fn) {
    try {
        return { ok: true, valor: fn() };
    } catch (erro) {
        return { ok: false, erro: erro.message };
    }
}

/** Largest absolute difference between two coordinate arrays, or Infinity. */
function desvio(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return Infinity;
    let pior = 0;
    for (let i = 0; i < a.length; i++) {
        const pa = Array.isArray(a[i][0]) ? null : a[i];
        const pb = Array.isArray(b[i][0]) ? null : b[i];
        if (!pa || !pb) return Infinity;
        pior = Math.max(pior, Math.abs(pa[0] - pb[0]), Math.abs(pa[1] - pb[1]));
    }
    return pior;
}

/** The same, over a whole generated geometry (MultiLineString or MultiPolygon). */
function desvioGeometria(a, b) {
    if (a.type !== b.type) return Infinity;
    if (a.type === 'LineString') return desvio(a.coordinates, b.coordinates);
    if (a.coordinates.length !== b.coordinates.length) return Infinity;

    let pior = 0;
    for (let i = 0; i < a.coordinates.length; i++) {
        const pa = a.coordinates[i];
        const pb = b.coordinates[i];
        const anelado = Array.isArray(pa[0]) && Array.isArray(pa[0][0]);
        pior = Math.max(pior, anelado
            ? desvioGeometria(
                { type: 'MultiLineString', coordinates: pa },
                { type: 'MultiLineString', coordinates: pb },
            )
            : desvio(pa, pb));
    }
    return pior;
}

const TOLERANCIA = 1e-12;

// ============================================================================
// 1. alongPrepared CONTRA turf.along
// ============================================================================

describe('alongPrepared reproduz turf.along', () => {
    it('200 linhas x 20 distancias, coordenada a coordenada', () => {
        const rand = rng(20260904);
        let comparacoes = 0;
        let piorDesvio = 0;
        let exatas = 0;
        let lancamentos = 0;

        for (let i = 0; i < 200; i++) {
            const coords = linhaAleatoria(rand, i);
            const line = turf.lineString(coords);
            const prepared = geom.prepareSpine(line);
            const cum = acumuladas(coords);

            for (const d of distancias(rand, cum)) {
                const esperado = tentar(() => turf.along(line, d, { units: 'kilometers' }));
                const obtido = tentar(() => geom.alongPrepared(prepared, d));
                comparacoes++;

                expect(obtido.ok, `d=${d} na linha ${i}`).toBe(esperado.ok);

                if (!esperado.ok) {
                    expect(obtido.erro).toBe(esperado.erro);
                    lancamentos++;
                    continue;
                }

                const a = esperado.valor.geometry.coordinates;
                const b = obtido.valor.geometry.coordinates;
                const delta = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
                if (delta === 0) exatas++;
                piorDesvio = Math.max(piorDesvio, delta);

                expect(delta, `d=${d} na linha ${i}`).toBeLessThanOrEqual(TOLERANCIA);
            }
        }

        // A varredura tem de ter EXERCITADO os dois eixos que ela afirma medir: a
        // igualdade dos pontos e a igualdade dos erros. Sem esta conta, uma
        // geracao que so produzisse linhas mansas passaria por omissao.
        expect(comparacoes).toBe(4000);
        expect(lancamentos).toBe(0);
        expect(piorDesvio).toBe(0);
        expect(exatas).toBe(comparacoes);
    });

    it('a acumulada acompanha o turf ate o ultimo bit', () => {
        const rand = rng(7);
        for (let i = 0; i < 40; i++) {
            const coords = linhaAleatoria(rand, i);
            const prepared = geom.prepareSpine(turf.lineString(coords));
            expect(prepared.cumulative).toEqual(acumuladas(coords));
        }
    });

    it('distancia negativa estoura do mesmo jeito nos dois', () => {
        const line = turf.lineString([[-53, -30], [-52.9, -30], [-52.9, -29.9]]);
        const prepared = geom.prepareSpine(line);

        const esperado = tentar(() => turf.along(line, -1, { units: 'kilometers' }));
        const obtido = tentar(() => geom.alongPrepared(prepared, -1));

        expect(esperado.ok).toBe(false);
        expect(obtido.ok).toBe(false);
        expect(obtido.erro).toBe(esperado.erro);
    });

    it('vertice repetido devolve o PRIMEIRO dos empatados, como o turf', () => {
        // Duas entradas da acumulada valem o mesmo. Uma busca binaria que
        // devolvesse qualquer um dos empatados passaria numa linha mansa e
        // erraria aqui, porque o turf para no primeiro.
        const coords = [[-53, -30], [-52.9, -30], [-52.9, -30], [-52.8, -30]];
        const line = turf.lineString(coords);
        const prepared = geom.prepareSpine(line);
        const cum = acumuladas(coords);

        expect(prepared.cumulative[1]).toBe(prepared.cumulative[2]);
        const alvo = geom.firstVertexAtLeast(prepared.cumulative, cum[1]);
        expect(alvo).toBe(1);

        const a = turf.along(line, cum[1], { units: 'kilometers' }).geometry.coordinates;
        const b = geom.alongPrepared(prepared, cum[1]).geometry.coordinates;
        expect(b).toEqual(a);
    });
});

// ============================================================================
// 2. slicePrepared CONTRA turf.lineSliceAlong
// ============================================================================

describe('slicePrepared reproduz turf.lineSliceAlong', () => {
    it('200 linhas x 20 pares de distancia, vertice a vertice', () => {
        const rand = rng(31415);
        let comparacoes = 0;
        let lancamentos = 0;
        let vaziosDeUmPonto = 0;
        let paresInvertidos = 0;
        let piorDesvio = 0;
        let exatas = 0;

        for (let i = 0; i < 200; i++) {
            const coords = linhaAleatoria(rand, i);
            const line = turf.lineString(coords);
            const prepared = geom.prepareSpine(line);
            const cum = acumuladas(coords);
            const total = cum[cum.length - 1];
            const alvos = distancias(rand, cum);

            for (let k = 0; k < alvos.length; k++) {
                // Metade dos pares e um recorte de verdade, e o resto cobre as
                // bordas: comeco no zero, fim alem do fim, os dois no mesmo vao,
                // e o par invertido que o turf resolve pelo fim.
                const from = alvos[k];
                const to = k % 4 === 0 ? from
                    : k % 4 === 1 ? total + 5
                        : k % 4 === 2 ? Math.max(0, from - rand() * total * 0.3)
                            : from + rand() * total * 0.2;

                const esperado = tentar(
                    () => turf.lineSliceAlong(line, from, to, { units: 'kilometers' })
                        .geometry.coordinates,
                );
                const obtido = tentar(() => geom.slicePrepared(prepared, from, to));
                comparacoes++;
                if (to < from) paresInvertidos++;

                expect(obtido.ok, `[${from}, ${to}] na linha ${i}`).toBe(esperado.ok);

                if (!esperado.ok) {
                    expect(obtido.erro, `[${from}, ${to}] na linha ${i}`).toBe(esperado.erro);
                    lancamentos++;
                    if (esperado.erro.includes('two or more')) vaziosDeUmPonto++;
                    continue;
                }

                const delta = desvio(esperado.valor, obtido.valor);
                if (delta === 0) exatas++;
                piorDesvio = Math.max(piorDesvio, delta);
                expect(delta, `[${from}, ${to}] na linha ${i}`).toBeLessThanOrEqual(TOLERANCIA);
            }
        }

        expect(comparacoes).toBe(4000);
        // As bordas tem de ter SIDO exercitadas, nao so estar na lista.
        expect(paresInvertidos).toBeGreaterThan(100);
        expect(vaziosDeUmPonto).toBeGreaterThan(100);
        expect(piorDesvio).toBe(0);
        expect(exatas + lancamentos).toBe(comparacoes);
    });

    it('a espinha inteira sai igual, que e o recorte mais comprido que a ferramenta faz', () => {
        const rand = rng(2718);
        let degeneradas = 0;

        for (let i = 0; i < 60; i++) {
            const coords = linhaAleatoria(rand, i);
            const line = turf.lineString(coords);
            const prepared = geom.prepareSpine(line);
            const total = acumuladas(coords).pop();

            // Uma linha de comprimento zero (dois vertices no mesmo ponto) faz o
            // turf recusar o recorte inteiro, e a recusa e o que `sliceAlong`
            // converte em "nao desenha nada". Ela entra na comparacao como
            // qualquer outro caso, nao como excecao.
            const esperado = tentar(
                () => turf.lineSliceAlong(line, 0, total, { units: 'kilometers' }).geometry.coordinates,
            );
            const obtido = tentar(() => geom.slicePrepared(prepared, 0, total));

            expect(obtido.ok, `linha ${i}`).toBe(esperado.ok);
            if (!esperado.ok) {
                expect(obtido.erro).toBe(esperado.erro);
                degeneradas++;
                continue;
            }
            expect(obtido.valor, `linha ${i}`).toEqual(esperado.valor);
        }

        expect(degeneradas).toBeGreaterThan(0);
    });

    it('comeco depois do fim da linha reclama a mesma coisa', () => {
        const line = turf.lineString([[-53, -30], [-52.9, -30]]);
        const prepared = geom.prepareSpine(line);
        const total = turf.length(line, { units: 'kilometers' });

        const esperado = tentar(
            () => turf.lineSliceAlong(line, total + 10, total + 20, { units: 'kilometers' }),
        );
        const obtido = tentar(() => geom.slicePrepared(prepared, total + 10, total + 20));

        expect(esperado.ok).toBe(false);
        expect(obtido.erro).toBe(esperado.erro);
        expect(obtido.erro).toContain('Start position is beyond line');
    });

    it('comeco exatamente no fim devolve o ultimo ponto dobrado, nos dois', () => {
        const line = turf.lineString([[-53, -30], [-52.9, -30], [-52.8, -29.95]]);
        const prepared = geom.prepareSpine(line);
        const total = turf.length(line, { units: 'kilometers' });

        const esperado = turf.lineSliceAlong(line, total, total + 5, { units: 'kilometers' })
            .geometry.coordinates;
        expect(geom.slicePrepared(prepared, total, total + 5)).toEqual(esperado);
    });

    it('os dois extremos no MESMO vao saem iguais', () => {
        const line = turf.lineString([[-53, -30], [-52, -30], [-51, -29.5], [-50, -29.5]]);
        const prepared = geom.prepareSpine(line);
        const cum = acumuladas(line.geometry.coordinates);

        for (const [a, b] of [[cum[1] + 1, cum[1] + 7], [cum[2] + 0.5, cum[2] + 0.6], [0.1, 0.2]]) {
            const esperado = turf.lineSliceAlong(line, a, b, { units: 'kilometers' })
                .geometry.coordinates;
            expect(geom.slicePrepared(prepared, a, b)).toEqual(esperado);
        }
    });
});

// ============================================================================
// 3. PIOR CASO: a regua tem de REPROVAR uma espinha preparada errada
// ============================================================================

describe('pior caso: a comparacao reprova a espinha quebrada', () => {
    /** Two ways of getting the prepared spine wrong, each plausible on a first cut. */
    const QUEBRAS = {
        // Off by one: land on the segment that ENDS before the distance instead of
        // the one that contains it. It is the classic binary-search slip, and a
        // straight line hides it because both answers sit on the same great circle.
        'busca deslocada por um': (Base) => class extends Base {
            firstVertexAtLeast(cumulative, d) {
                const i = super.firstVertexAtLeast(cumulative, d);
                return i > 0 ? i - 1 : i;
            }
        },
        // Interpolate in DEGREE space instead of stepping geodesically, which is
        // the shortcut the whole prepared spine exists to avoid.
        'interpolacao em graus': (Base) => class extends Base {
            alongPrepared(prepared, d) {
                const { coords, cumulative } = prepared;
                const i = this.firstVertexAtLeast(cumulative, d);
                if (i <= 0) return turf.point(coords[Math.max(0, i)]);
                const vao = cumulative[i] - cumulative[i - 1];
                const t = vao > 0 ? (d - cumulative[i - 1]) / vao : 0;
                return turf.point([
                    coords[i - 1][0] + t * (coords[i][0] - coords[i - 1][0]),
                    coords[i - 1][1] + t * (coords[i][1] - coords[i - 1][1]),
                ]);
            }
        },
    };

    for (const [nome, quebrar] of Object.entries(QUEBRAS)) {
        it(`${nome}: a varredura de alongPrepared reprova`, () => {
            const roto = new (quebrar(AddCoordinationLineGeometry))();
            const rand = rng(20260904);
            let reprovas = 0;

            for (let i = 0; i < 20; i++) {
                const coords = linhaAleatoria(rand, i);
                const line = turf.lineString(coords);
                const prepared = roto.prepareSpine(line);

                for (const d of distancias(rand, acumuladas(coords))) {
                    const esperado = tentar(() => turf.along(line, d, { units: 'kilometers' }));
                    const obtido = tentar(() => roto.alongPrepared(prepared, d));

                    if (!esperado.ok || !obtido.ok) { reprovas++; continue; }
                    const a = esperado.valor.geometry.coordinates;
                    const b = obtido.valor.geometry.coordinates;
                    if (Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) > TOLERANCIA) reprovas++;
                }
            }

            expect(reprovas).toBeGreaterThan(0);
        });
    }

    it('a comparacao de generate() reprova a espinha deslocada por um', () => {
        // A regua da secao 4 e um deep equal, e um deep equal so vale se REPROVA
        // o estado errado. Aqui ela e apontada para a mesma busca deslocada, na
        // linha de 50 vertices, com o desenho inteiro em jogo.
        const roto = new (QUEBRAS['busca deslocada por um'](AddCoordinationLineGeometry))();
        const base = Array.from({ length: 50 }, (_, i) => [
            -53.0 + i * ((150 / 96.3) / 49), -30.0 + (i % 2) * 0.004,
        ]);

        let reprovados = 0;
        for (const id of Object.keys(LINEAR_SYMBOLS)) {
            const props = { baseCoordinates: base, symbol_code: id, symbol_size: 0.5, symbol_spacing: 0.1 };
            const velha = antigo.generate(props, undefined);
            if (desvioGeometria(roto.generate(props, undefined), velha) > TOLERANCIA) reprovados++;
        }

        expect(reprovados).toBe(Object.keys(LINEAR_SYMBOLS).length);
    });

    it('um recorte com um vertice a menos e reprovado', () => {
        const roto = new (class extends AddCoordinationLineGeometry {
            slicePrepared(prepared, from, to) {
                const corte = super.slicePrepared(prepared, from, to);
                return corte.length > 2 ? [corte[0], ...corte.slice(2)] : corte;
            }
        })();

        const coords = [[-53, -30], [-52, -30], [-51, -29.5], [-50, -29.5], [-49, -29]];
        const line = turf.lineString(coords);
        const prepared = roto.prepareSpine(line);
        const total = acumuladas(coords).pop();

        const esperado = turf.lineSliceAlong(line, 1, total - 1, { units: 'kilometers' })
            .geometry.coordinates;
        expect(desvio(esperado, roto.slicePrepared(prepared, 1, total - 1))).toBe(Infinity);
    });
});

// ============================================================================
// 4. generate() INTEIRO CONTRA A IMPLEMENTACAO ANTIGA
// ============================================================================

describe('generate desenha o mesmo que antes, simbolo por simbolo', () => {
    /** A spine of `n` vertices spanning roughly `km`, bending at every vertex. */
    function espinha(n, km) {
        const dLng = (km / 96.3) / (n - 1);
        return Array.from({ length: n }, (_, i) => [
            -53.0 + i * dLng,
            -30.0 + (i % 2) * 0.004,
        ]);
    }

    const IDS = Object.keys(LINEAR_SYMBOLS);
    const VERTICES = [2, 10, 50];

    it('o catalogo inteiro entra na varredura', () => {
        // Se o catalogo crescer, esta conta cai e a varredura abaixo deixa de
        // cobrir o simbolo novo em silencio.
        expect(IDS.length * VERTICES.length).toBe(30);
    });

    for (const id of IDS) {
        for (const n of VERTICES) {
            it(`${id} com ${n} vertices: geometria identica`, () => {
                const props = {
                    baseCoordinates: espinha(n, 150),
                    symbol_code: id,
                    symbol_size: 0.5,
                    symbol_spacing: 0.1,
                };

                const nova = geom.generate(props, undefined);
                const velha = antigo.generate(props, undefined);

                expect(nova.type).toBe(velha.type);
                expect(desvioGeometria(nova, velha)).toBe(0);
                expect(nova).toEqual(velha);
            });
        }
    }

    it('os 120 glifos e as duas familias de saida foram mesmo exercitados', () => {
        // Uma varredura que so tivesse desenhado LineString de degradacao passaria
        // acima sem medir nada. Esta conta e o que impede isso.
        const tipos = new Set();
        const contagens = [];

        for (const id of IDS) {
            const props = {
                baseCoordinates: espinha(50, 150),
                symbol_code: id,
                symbol_size: 0.5,
                symbol_spacing: 0.1,
            };
            tipos.add(geom.generate(props, undefined).type);
            contagens.push(geom.describeLayout(props, undefined).count);
        }

        expect(tipos).toEqual(new Set(['MultiLineString', 'MultiPolygon']));
        // O teto de 120 e o pior caso da bancada, e tem de ser atingido por
        // alguem. A cerca de arame dupla fica abaixo por ter a pegada mais larga
        // (spanRatio 1,6), que empurra o espacamento minimo para cima.
        expect(Math.max(...contagens)).toBe(120);
        expect(Math.min(...contagens)).toBeGreaterThan(90);
    });

    it('linhas tortas, curtas e dobradas tambem saem identicas', () => {
        const rand = rng(1234);
        const casos = [
            [[-53, -30], [-52.95, -30], [-53, -30]],
            [[-53, -30], [-53, -30], [-52.5, -29.7], [-52.5, -29.7]],
            [[-53, -30], [-52.99999, -30.00001]],
        ];
        for (let i = 0; i < 30; i++) casos.push(linhaAleatoria(rand, i));

        for (const base of casos) {
            for (const id of IDS) {
                const props = { baseCoordinates: base, symbol_code: id, symbol_size: 0.5, symbol_spacing: 0.1 };
                expect(geom.generate(props, undefined)).toEqual(antigo.generate(props, undefined));
            }
        }
    });
});
