// Path: tests/unit/viewshed-3d-preview.test.js
//
// O PREVIEW DO VIEWSHED 3D ENTRE OS DOIS CLIQUES, que o plugin substituido desenhava e a reescrita
// de 2026-09-15 perdeu sem deixar rastro (relato do dono em 2026-09-22). A aritmetica dele mora em
// `services/viewshed-preview.js`, um folha sem Cesium, e este arquivo e o que ela ganha em troca.
//
// A PROMESSA QUE ESTE ARQUIVO COBRA: o setor desenhado enquanto o ponteiro se move e o setor que a
// ferramenta vai desenhar depois do segundo clique. Tres coisas decidem isso e as tres se erram sem
// erro nenhum na tela: o apice e o OLHO (o clique levantado a altura do observador), o alcance e
// medido do CLIQUE e nao do olho, e os eixos sao os que a `Camera` do Cesium obtem ao ortonormalizar
// o "para cima" geocentrico contra a direcao de visada.
//
// O QUE ELE NAO PROVA: que o preview aparece, acompanha o ponteiro e some no segundo clique. Isso e
// comportamento de navegador, e e da captura do Playwright.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
    previewRange,
    previewFrame,
    previewPolylines,
    MIN_PREVIEW_RANGE,
} from '@js/3d_models_viewer_tool/services/viewshed-preview.js';
import { frustumOutlineAngles } from '@js/3d_models_viewer_tool/services/viewshed-geometry.js';

// ===== WGS84, escrito a mao para nao depender do Cesium =====

const A = 6378137.0;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const RAD = Math.PI / 180;

/** Geodetic (degrees, metres) to Earth-fixed metres. */
function ecef(latDeg, lonDeg, h = 0) {
    const lat = latDeg * RAD;
    const lon = lonDeg * RAD;
    const sinLat = Math.sin(lat);
    const n = A / Math.sqrt(1 - E2 * sinLat * sinLat);
    return {
        x: (n + h) * Math.cos(lat) * Math.cos(lon),
        y: (n + h) * Math.cos(lat) * Math.sin(lon),
        z: (n * (1 - E2) + h) * sinLat,
    };
}

/** East, north and the ELLIPSOID normal at a geodetic position. */
function enu(latDeg, lonDeg) {
    const lat = latDeg * RAD;
    const lon = lonDeg * RAD;
    return {
        east: { x: -Math.sin(lon), y: Math.cos(lon), z: 0 },
        north: {
            x: -Math.sin(lat) * Math.cos(lon),
            y: -Math.sin(lat) * Math.sin(lon),
            z: Math.cos(lat),
        },
        up: { x: Math.cos(lat) * Math.cos(lon), y: Math.cos(lat) * Math.sin(lon), z: Math.sin(lat) },
    };
}

const add = (o, frame, e, n, u) => ({
    x: o.x + frame.east.x * e + frame.north.x * n + frame.up.x * u,
    y: o.y + frame.east.y * e + frame.north.y * n + frame.up.y * u,
    z: o.z + frame.east.z * e + frame.north.z * n + frame.up.z * u,
});
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
});
const norm = (v) => Math.hypot(v.x, v.y, v.z);
const unit = (v) => {
    const l = norm(v);
    return { x: v.x / l, y: v.y / l, z: v.z / l };
};

/** Altura do olho que a ferramenta usa (`DEFAULT_OBSERVER_HEIGHT` em `viewshed_tool_3d.js`). */
const EYE = 1.5;

/**
 * Um observador no chao e o olho 1,5 m acima dele, ao longo da normal do ELIPSOIDE, que e como a
 * ferramenta o levanta (altura do clique mais a do observador, por `fromDegrees`).
 */
function station(lat, lon) {
    const frame = enu(lat, lon);
    const observer = ecef(lat, lon, 0);
    const eye = add(observer, frame, 0, 0, EYE);
    return { frame, observer, eye };
}

/** Lugares que cobrem os dois hemisferios, o antimeridiano e a vizinhanca do polo. */
const LUGARES = [
    { nome: 'Rio de Janeiro', lat: -22.9, lon: -43.2 },
    { nome: 'Brasilia', lat: -15.79, lon: -47.88 },
    { nome: 'hemisferio norte e leste', lat: 52.5, lon: 13.4 },
    { nome: 'antimeridiano', lat: -17.7, lon: 179.99995 },
    { nome: 'equador e meridiano zero', lat: 0, lon: 0 },
    { nome: 'perto do polo sul', lat: -89.9, lon: 120 },
];

const lugar = fc.constantFrom(...LUGARES);
/** Deslocamento horizontal do ponteiro, com pelo menos 1 m, mais um desnivel. */
const deslocamento = fc
    .tuple(
        fc.double({ min: -2500, max: 2500, noNaN: true }),
        fc.double({ min: -2500, max: 2500, noNaN: true }),
        fc.double({ min: -80, max: 80, noNaN: true }),
    )
    .filter(([e, n]) => Math.hypot(e, n) >= 1);

describe('previewRange: o alcance que a analise vai receber', () => {
    it('e a distancia do CLIQUE ao ponteiro, arredondada a um decimo', () => {
        const { frame, observer } = station(-22.9, -43.2);
        expect(previewRange(observer, add(observer, frame, 0, 186.44, 0))).toBe(186.4);
        expect(previewRange(observer, add(observer, frame, 0, 186.46, 0))).toBe(186.5);
        expect(previewRange(observer, add(observer, frame, 30, 40, 0))).toBe(50);
    });

    it('e simetrico, e zero sobre o proprio observador, inclusive com -0', () => {
        const { frame, observer } = station(10, 20);
        const p = add(observer, frame, 12, -7, 3);
        expect(previewRange(observer, p)).toBe(previewRange(p, observer));
        expect(previewRange(observer, { ...observer })).toBe(0);
        expect(previewRange({ x: -0, y: -0, z: -0 }, { x: 0, y: 0, z: 0 })).toBe(0);
    });

    it('entrada que nao e um ponto finito devolve NaN, e nao um numero plausivel', () => {
        const bom = { x: 1, y: 2, z: 3 };
        for (const ruim of [
            null,
            undefined,
            {},
            { x: NaN, y: 0, z: 0 },
            { x: 0, y: Infinity, z: 0 },
            { x: 0, y: 0, z: -Infinity },
            { x: '1', y: 2, z: 3 },
        ]) {
            expect(Number.isNaN(previewRange(ruim, bom)), JSON.stringify(ruim)).toBe(true);
            expect(Number.isNaN(previewRange(bom, ruim)), JSON.stringify(ruim)).toBe(true);
        }
    });
});

describe('previewFrame: o referencial do setor', () => {
    it('o alcance e medido do CLIQUE, nao do olho, e a diferenca aparece a 10 m', () => {
        // CONTROLE NEGATIVO EMBUTIDO: a 10 m, com o olho 1,5 m acima, as duas contas divergem no
        // primeiro decimal (10,0 contra 10,1). Quem trocar o observador pelo olho em `previewRange`
        // reprova aqui, e o sintoma seria o arco do preview 10 cm alem do arco que a analise desenha.
        const { frame, observer, eye } = station(-22.9, -43.2);
        const ponteiro = add(observer, frame, 0, 10, 0);
        expect(Number(norm(sub(ponteiro, eye)).toFixed(1))).toBe(10.1);
        expect(previewFrame(observer, eye, ponteiro).range).toBe(10);
    });

    it('os tres eixos sao unitarios e ortogonais, em qualquer lugar do globo', () => {
        fc.assert(
            fc.property(lugar, deslocamento, (l, [e, n, u]) => {
                const { frame, observer, eye } = station(l.lat, l.lon);
                const f = previewFrame(observer, eye, add(observer, frame, e, n, u));
                expect(f, l.nome).not.toBeNull();
                expect(norm(f.forward)).toBeCloseTo(1, 12);
                expect(norm(f.right)).toBeCloseTo(1, 12);
                expect(norm(f.up)).toBeCloseTo(1, 12);
                expect(dot(f.forward, f.right)).toBeCloseTo(0, 12);
                expect(dot(f.forward, f.up)).toBeCloseTo(0, 12);
                expect(dot(f.right, f.up)).toBeCloseTo(0, 12);
            }),
            { numRuns: 400 },
        );
    });

    it('a visada aponta do OLHO para o ponteiro', () => {
        fc.assert(
            fc.property(lugar, deslocamento, (l, [e, n, u]) => {
                const { frame, observer, eye } = station(l.lat, l.lon);
                const ponteiro = add(observer, frame, e, n, u);
                const f = previewFrame(observer, eye, ponteiro);
                const esperado = unit(sub(ponteiro, eye));
                expect(dot(f.forward, esperado)).toBeCloseTo(1, 12);
            }),
            { numRuns: 300 },
        );
    });

    it('os eixos batem com os de um caminho INDEPENDENTE: direita = visada x vertical', () => {
        // O modulo ortogonaliza o "para cima" por Gram-Schmidt, como a Camera do Cesium; aqui a mesma
        // base sai pela outra ordem (primeiro a direita, depois o "para cima" como direita x visada).
        // Se as duas divergirem, uma das contas esta errada, e o preview deixa de ser a malha final.
        fc.assert(
            fc.property(lugar, deslocamento, (l, [e, n, u]) => {
                const { frame, observer, eye } = station(l.lat, l.lon);
                const f = previewFrame(observer, eye, add(observer, frame, e, n, u));
                const vertical = unit(eye);
                const direita = unit(cross(f.forward, vertical));
                const cima = cross(direita, f.forward);
                expect(dot(f.right, direita)).toBeCloseTo(1, 10);
                expect(dot(f.up, cima)).toBeCloseTo(1, 10);
            }),
            { numRuns: 300 },
        );
    });

    it('a DIREITA e a direita de quem olha, e o "para cima" aponta para cima', () => {
        const { frame, observer, eye } = station(-22.9, -43.2);

        const paraNorte = previewFrame(observer, eye, add(observer, frame, 0, 200, 0));
        expect(dot(paraNorte.right, frame.east)).toBeGreaterThan(0.999);
        expect(dot(paraNorte.up, frame.up)).toBeGreaterThan(0.99);

        const paraLeste = previewFrame(observer, eye, add(observer, frame, 200, 0, 0));
        expect(dot(paraLeste.right, frame.north)).toBeLessThan(-0.999);

        // Olhando para baixo, de um telhado para a rua: o "para cima" continua do lado do ceu.
        const paraBaixo = previewFrame(observer, eye, add(observer, frame, 0, 20, -30));
        expect(dot(paraBaixo.up, frame.up)).toBeGreaterThan(0);
    });

    it('sem setor para mostrar, devolve null em vez de eixos com NaN', () => {
        const { frame, observer, eye } = station(-22.9, -43.2);

        // Ponteiro sobre o proprio observador, e a 4 cm dele, que arredonda para zero.
        expect(previewFrame(observer, eye, { ...observer })).toBeNull();
        expect(previewFrame(observer, eye, add(observer, frame, 0.04, 0, 0))).toBeNull();
        // Logo acima do piso ja existe setor.
        const perto = previewFrame(observer, eye, add(observer, frame, 0.2, 0, 0));
        expect(perto).not.toBeNull();
        expect(perto.range).toBeGreaterThanOrEqual(MIN_PREVIEW_RANGE);

        // Ponteiro exatamente no olho: nao ha visada.
        expect(previewFrame(observer, eye, { ...eye })).toBeNull();

        // Ponteiro exatamente sob o olho, na vertical geocentrica: a visada e paralela ao "para
        // cima" e nenhuma abertura horizontal se define. O alcance ate o clique passa do piso, entao
        // quem recusa aqui e a guarda de paralelismo, e nao a de distancia.
        const r = norm(eye);
        const sobOOlho = { x: eye.x * (1 - 3 / r), y: eye.y * (1 - 3 / r), z: eye.z * (1 - 3 / r) };
        expect(previewRange(observer, sobOOlho)).toBeGreaterThan(MIN_PREVIEW_RANGE);
        expect(previewFrame(observer, eye, sobOOlho)).toBeNull();

        // Entradas que nao sao pontos.
        for (const ruim of [null, undefined, {}, { x: NaN, y: 0, z: 0 }, { x: 0, y: 0, z: Infinity }]) {
            expect(previewFrame(ruim, eye, observer), JSON.stringify(ruim)).toBeNull();
            expect(previewFrame(observer, ruim, observer), JSON.stringify(ruim)).toBeNull();
            expect(previewFrame(observer, eye, ruim), JSON.stringify(ruim)).toBeNull();
        }
    });

    it('atravessa o antimeridiano sem dar a volta ao mundo', () => {
        // Em coordenadas de terra fixa nao ha costura em 180 graus, e o teste prova que o modulo nao
        // passa por longitude em lugar nenhum: dois pontos a uns 11 m, um de cada lado da linha.
        const { observer, eye } = station(-17.7, 179.99995);
        const outroLado = ecef(-17.7, -179.99995, 0);
        const f = previewFrame(observer, eye, outroLado);
        expect(f).not.toBeNull();
        expect(f.range).toBeGreaterThan(9);
        expect(f.range).toBeLessThan(12);
        const { east } = enu(-17.7, 179.99995);
        // Atravessar para longitude -179,99995 e andar para LESTE.
        expect(dot(f.forward, east)).toBeGreaterThan(0.98);
    });
});

describe('previewPolylines: a malha que o preview desenha', () => {
    it('e a mesma malha da analise final (mesma contagem de linhas), mais a linha de mira', () => {
        const { frame, observer, eye } = station(-22.9, -43.2);
        const ponteiro = add(observer, frame, 40, 180, 2);
        const f = previewFrame(observer, eye, ponteiro);
        const d = previewPolylines(f, eye, ponteiro, 120, 120);

        expect(d.outline).toHaveLength(frustumOutlineAngles(120, 120).length);
        expect(d.outline).toHaveLength(9 + 9 + 4);
        // A mira sai do olho e termina EXATAMENTE no ponteiro, que e o ponto que o segundo clique toma.
        expect(d.aim).toEqual([{ ...eye }, { ...ponteiro }]);
    });

    it('todo ponto da superficie distante fica a `range` metros do olho, e o apice E o olho', () => {
        fc.assert(
            fc.property(
                lugar,
                deslocamento,
                fc.double({ min: 1, max: 300, noNaN: true }),
                fc.double({ min: 1, max: 170, noNaN: true }),
                (l, [e, n, u], h, v) => {
                    const { frame, observer, eye } = station(l.lat, l.lon);
                    const ponteiro = add(observer, frame, e, n, u);
                    const f = previewFrame(observer, eye, ponteiro);
                    const d = previewPolylines(f, eye, ponteiro, h, v);
                    const angulos = frustumOutlineAngles(h, v);
                    expect(d.outline).toHaveLength(angulos.length);
                    d.outline.forEach((linha, i) => {
                        const pontosDistantes = angulos[i].apex ? linha.slice(1) : linha;
                        if (angulos[i].apex) {
                            expect(linha).toHaveLength(2);
                            expect(linha[0]).toEqual({ ...eye });
                        }
                        expect(pontosDistantes.length).toBeGreaterThan(0);
                        for (const p of pontosDistantes) {
                            expect(Math.abs(norm(sub(p, eye)) - f.range)).toBeLessThan(1e-6);
                        }
                    });
                },
            ),
            { numRuns: 150 },
        );
    });

    it('a malha cobre EXATAMENTE a abertura pedida, medida nos eixos do referencial', () => {
        // O azimute e a elevacao de cada ponto desenhado, recuperados da geometria em torno dos
        // eixos do proprio referencial (que e onde a malha final tambem e desenhada; a tinta mede em
        // torno da vertical local, e a diferenca e a declarada em `docs/wiki/viewshed-3d.md`). As
        // duas metades sao necessarias: sem a primeira um setor maior que o pedido passaria, sem a
        // segunda um menor tambem.
        fc.assert(
            fc.property(
                lugar,
                deslocamento,
                fc.double({ min: 1, max: 300, noNaN: true }),
                fc.double({ min: 1, max: 170, noNaN: true }),
                (l, [e, n, u], h, v) => {
                    const { frame, observer, eye } = station(l.lat, l.lon);
                    const ponteiro = add(observer, frame, e, n, u);
                    const f = previewFrame(observer, eye, ponteiro);
                    const d = previewPolylines(f, eye, ponteiro, h, v);
                    const azimutes = [];
                    const elevacoes = [];
                    for (const linha of d.outline) {
                        for (const p of linha) {
                            if (p.x === eye.x && p.y === eye.y && p.z === eye.z) continue;
                            const dir = unit(sub(p, eye));
                            azimutes.push(Math.atan2(dot(dir, f.right), dot(dir, f.forward)) / RAD);
                            elevacoes.push(Math.asin(Math.max(-1, Math.min(1, dot(dir, f.up)))) / RAD);
                        }
                    }
                    expect(azimutes.length).toBeGreaterThan(0);
                    expect(Math.max(...azimutes)).toBeCloseTo(h / 2, 4);
                    expect(Math.min(...azimutes)).toBeCloseTo(-h / 2, 4);
                    expect(Math.max(...elevacoes)).toBeCloseTo(v / 2, 4);
                    expect(Math.min(...elevacoes)).toBeCloseTo(-v / 2, 4);
                },
            ),
            { numRuns: 150 },
        );
    });

    it('o centro da malha fica NA linha de mira', () => {
        // O ponto (0, 0) do setor, que com 8 subdivisoes e o cruzamento do meridiano e do paralelo do
        // meio, esta sobre a reta olho-ponteiro, a `range` metros do olho.
        const { frame, observer, eye } = station(52.5, 13.4);
        const ponteiro = add(observer, frame, -300, 400, 12);
        const f = previewFrame(observer, eye, ponteiro);
        const d = previewPolylines(f, eye, ponteiro, 120, 120);
        const meridianoCentral = d.outline[4];
        const centro = meridianoCentral[4];
        const esperado = {
            x: eye.x + f.forward.x * f.range,
            y: eye.y + f.forward.y * f.range,
            z: eye.z + f.forward.z * f.range,
        };
        expect(norm(sub(centro, esperado))).toBeLessThan(1e-6);
    });

    it('nao devolve referencias para as entradas', () => {
        // O motor guarda o olho e le o ponteiro de uma coordenada que o Cesium reusa: uma copia que
        // fosse a mesma referencia se moveria sozinha no quadro seguinte.
        const { frame, observer, eye } = station(-22.9, -43.2);
        const ponteiro = add(observer, frame, 10, 50, 0);
        const olhoAntes = { ...eye };
        const d = previewPolylines(previewFrame(observer, eye, ponteiro), eye, ponteiro, 120, 120);
        d.aim[0].x += 1000;
        d.aim[1].x += 1000;
        d.outline.find((linha) => linha.length === 2)[0].x += 1000;
        expect(eye).toEqual(olhoAntes);
        expect(d.aim[1]).not.toBe(ponteiro);
    });

    it('sem referencial, ou com olho ou ponteiro invalido, devolve null', () => {
        const { frame, observer, eye } = station(-22.9, -43.2);
        const ponteiro = add(observer, frame, 10, 50, 0);
        const f = previewFrame(observer, eye, ponteiro);
        expect(previewPolylines(null, eye, ponteiro, 120, 120)).toBeNull();
        expect(previewPolylines(f, null, ponteiro, 120, 120)).toBeNull();
        expect(previewPolylines(f, eye, { x: NaN, y: 0, z: 0 }, 120, 120)).toBeNull();
    });

    it('abertura invalida cai no padrao da malha em vez de produzir pontos NaN', () => {
        const { frame, observer, eye } = station(-22.9, -43.2);
        const ponteiro = add(observer, frame, 10, 50, 0);
        const f = previewFrame(observer, eye, ponteiro);
        for (const ruim of [undefined, null, NaN, 0, -30, Infinity]) {
            const d = previewPolylines(f, eye, ponteiro, ruim, ruim);
            const pontos = d.outline.flat();
            expect(pontos.length, String(ruim)).toBeGreaterThan(0);
            for (const p of pontos) {
                expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z), String(ruim))
                    .toBe(true);
            }
        }
    });
});
