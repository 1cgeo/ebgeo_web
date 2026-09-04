import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { runInThisContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { LINEAR_SYMBOLS, FILLED_SYMBOL_CODES } from '../../src/js/military_tools/coordination_line_tool/coordination_line_catalog.js';

/**
 * O fosso anticarro (290202) do MD33, medido no desenho que sai.
 *
 * O simbolo e uma faixa de dentes CHEIOS encostados uns nos outros: o catalogo o
 * marca `continuous`, entao `symbol_size` e o PERIODO de um dente e o padrao
 * corre de ponta a ponta, e o marca `filled`, entao a saida e um MultiPolygon,
 * um poligono por dente, sem espinha nenhuma por baixo. Cada dente e um anel
 * fechado de quatro pontos: pe na linha, apice fora, outro pe na linha, e o
 * primeiro repetido.
 *
 * O que este arquivo existe para travar e o LADO. A prancha MD33-M-02 traz a
 * observacao de que "o simbolo de unidade inimiga nao faz parte do tracado do
 * obstaculo, servindo apenas como referencia de orientacao": o desenho nao diz
 * onde esta o inimigo, diz para onde o obstaculo aponta, e essa e toda a
 * informacao que ele carrega. Um fosso cujos dentes alternassem de lado, ou que
 * ignorasse a inversao da linha, seria outro desenho, e nenhuma das duas falhas
 * aparece numa contagem de aneis.
 *
 * A regua vem da mesma prancha, lida coluna a coluna em 2026-09-03: o perfil
 * mostra os triangulos ENCOSTADOS uns nos outros, e nao uma linha com dentes
 * pendurados nela, com altura de 0,82 da base. Sao esses dois numeros que a
 * secao "a regua da prancha" confere no desenho.
 *
 * Turf REAL, o mesmo bundle que o app serve, porque toda afirmacao aqui e medida
 * de coordenada e um duble mediria a si mesmo.
 */

// A geometria importa BaseGeometry do barril `@tools`, que puxa modulos acoplados
// ao DOM e ao MapLibre; uma base trivial mantem este arquivo no ambiente `node`.
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

beforeAll(async () => {
    // O app carrega o turf por <script>, entao ele e um global e nao um modulo:
    // roda-se o bundle servido neste contexto e le-se o global que ele define.
    const code = readFileSync(require.resolve('../../public/vendors/turf.min.js'), 'utf8');
    runInThisContext(code);
    turf = globalThis.turf;

    ({ default: AddCoordinationLineGeometry } =
        await import('../../src/js/military_tools/coordination_line_tool/add_coordination_line_geometry.js'));
    geom = new AddCoordinationLineGeometry();
});

/** O codigo do fosso anticarro no catalogo MD33. */
const FOSSO = '290202';

/** Metros entre duas coordenadas. */
const metros = (a, b) => turf.distance(turf.point(a), turf.point(b), { units: 'meters' });

/** Quilometros ao longo de um vetor de coordenadas. */
const km = (coords) => turf.length(turf.lineString(coords), { units: 'kilometers' });

/** Uma reta oeste-leste de aproximadamente `k` quilometros na latitude -30. */
const straightLine = (k) => [[-53.0, -30.0], [-53.0 + k / 96.3, -30.0]];

/** As propriedades que uma linha de coordenacao desenhada carrega. */
const props = (baseCoordinates, overrides = {}) => ({
    baseCoordinates,
    lineWidth: 4,
    symbol_code: FOSSO,
    symbol_size: 0.5,
    symbol_spacing: 2,
    createdAtZoom: 0,
    zoomCorrectionEnabled: true,
    ...overrides,
});

/**
 * Os dentes. O fosso sai como MultiPolygon, entao cada dente e o anel EXTERNO do
 * seu poligono; a funcao aceita tambem MultiLineString para que os casos
 * degenerados, que caem no simbolo padrao, passem por aqui sem caso especial.
 * @param {Object} geometry - Geometria gerada
 * @returns {Array<Array>} Um anel por dente
 */
const dentesDe = (geometry) => {
    if (geometry.type === 'MultiPolygon') return geometry.coordinates.map(poligono => poligono[0]);
    if (geometry.type === 'MultiLineString') return geometry.coordinates;
    return [];
};

/** Todo ponto que sai, seja a geometria LineString, MultiLineString ou MultiPolygon. */
const pontosDe = (geometry) => {
    if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat(2);
    if (geometry.type === 'MultiLineString') return geometry.coordinates.flat();
    return geometry.coordinates;
};

/**
 * A mesma linha densificada pelo proprio `turf.along`, que e a referencia honesta
 * para "esta sobre a linha".
 *
 * A linha CLICADA de dois vertices e um segmento em graus, enquanto os pes do
 * dente saem de `turf.along`, que interpola pelo GRANDE CIRCULO. As duas
 * convencoes diferem pela flecha do arco, medida em 1,13 m nesta linha de 10 km
 * em 2026-09-03, e essa diferenca nao e folga do simbolo.
 *
 * @param {Array} base - Coordenadas clicadas
 * @returns {Object} Turf lineString com 501 pontos sobre o arco
 */
const arcoDe = (base) => {
    const linha = turf.lineString(base);
    const total = km(base);
    return turf.lineString(Array.from({ length: 501 }, (_, i) =>
        turf.along(linha, (total * i) / 500, { units: 'kilometers' }).geometry.coordinates));
};

/** Distancia sem sinal de um ponto a uma referencia, em metros. */
const distanciaA = (ponto, referencia) => Math.abs(turf.pointToLineDistance(
    turf.point(ponto), referencia, { units: 'meters' },
));

/**
 * Lado do ponto P em relacao ao segmento A->B: -1, 0 ou 1.
 *
 * Produto vetorial, e NAO `turf.pointToLineDistance`, que devolve distancia sem
 * sinal: com ela o `Math.sign` da sempre 1 e o teste passa a medir nada.
 */
const lado = (a, b, p) => Math.sign(
    (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]),
);

/** Lado do apice contra a base do PROPRIO dente, ou seja, contra o rumo local. */
const ladoLocal = (dente) => lado(dente[0], dente[2], dente[1]);

/** O apice de um dente: o ponto do meio do anel. */
const apiceDe = (dente) => dente[1];

// ============================================================================
// O CONTRATO DO CATALOGO — o que decide todo o resto
// ============================================================================

describe('o que o catalogo diz do 290202', () => {
    it('e um simbolo CONTINUO e CHEIO, e por isso nao passa por resolveGlyphLayout', () => {
        const simbolo = LINEAR_SYMBOLS[FOSSO];

        expect(simbolo).toBeDefined();
        expect(simbolo.glyph).toBe('teeth');
        expect(simbolo.continuous).toBe(true);
        expect(simbolo.filled).toBe(true);
        expect(simbolo.depthRatio).toBe(0.82);

        // `continuous` desvia ANTES de `resolveGlyphLayout`, entao `symbol_size` e
        // o PERIODO de um dente e `symbol_spacing` nao entra na conta. Quem quiser
        // mudar a densidade do fosso mexe no tamanho, e o teste abaixo trava isso:
        // um espacamento 4000 vezes maior nao muda um dente de lugar.
        const largo = geom.describeLayout(props(straightLine(10), { symbol_spacing: 40 }), 12);
        const apertado = geom.describeLayout(props(straightLine(10), { symbol_spacing: 0.01 }), 12);
        expect(largo.count).toBe(apertado.count);
        expect(largo.count).toBeGreaterThan(1);
    });

    it('FILLED_SYMBOL_CODES tem o fosso e NAO tem nenhum simbolo de anel fechado', () => {
        // A camada `coordination-line-fill-layer` le esta lista. Uma camada de
        // fill do MapLibre FECHA e pinta qualquer linha que receba: medido no
        // navegador em 2026-09-03, sem o filtro ela pintou o miolo do losango
        // 290199, o de toda argola de concertina, e ate a area entre uma espinha
        // dobrada e a sua corda. Marcar `filled` num simbolo de anel fechado
        // enche a tela, e este teste e o que reprova isso antes de chegar la.
        expect(FILLED_SYMBOL_CODES).toContain('290202');
        for (const id of ['290100', '290199', '290302', '290303', '290307', '290308', '290309']) {
            expect(FILLED_SYMBOL_CODES, id).not.toContain(id);
        }

        // E a lista e DERIVADA da tabela, nunca uma segunda lista escrita a mao,
        // que envelheceria calada: confere-se contra o campo `filled` da fonte.
        const pelaTabela = Object.values(LINEAR_SYMBOLS).filter(s => s.filled).map(s => s.id);
        expect([...FILLED_SYMBOL_CODES]).toEqual(pelaTabela);

        // Todo id da lista sai mesmo como poligono, e nenhum de fora sai.
        const base = straightLine(10);
        for (const id of Object.keys(LINEAR_SYMBOLS)) {
            const tipo = geom.generate(props(base, { symbol_code: id }), 12).type;
            expect(tipo === 'MultiPolygon', id).toBe(FILLED_SYMBOL_CODES.includes(id));
        }
    });
});

// ============================================================================
// O DESENHO
// ============================================================================

describe('o fosso anticarro (290202) sai como uma faixa de dentes cheios', () => {
    const base = straightLine(10);

    it('sai um poligono por dente, encadeados de ponta a ponta, sem espinha sobrando', () => {
        const properties = props(base);
        const geometry = geom.generate(properties, 12);
        const esperado = geom.describeLayout(properties, 12).count;

        // MultiPolygon, e nao MultiLineString: um simbolo cheio tem de chegar na
        // camada de preenchimento, e ela so pinta poligono.
        expect(geometry.type).toBe('MultiPolygon');
        expect(esperado).toBeGreaterThan(1);
        expect(geometry.coordinates).toHaveLength(esperado);

        // Um poligono por dente, com um anel so. Nunca um poligono com todos os
        // dentes dentro: dentes vizinhos dividem um canto, e um anel unico
        // passando por todos se auto-interceptaria ali.
        for (const poligono of geometry.coordinates) {
            expect(poligono).toHaveLength(1);
        }

        // `continuous`: o padrao SUBSTITUI a linha, entao nenhum anel e tao
        // comprido quanto ela. Uma espinha sobrando seria uma corda atravessando
        // todos os dentes.
        const comprimento = km(base);
        for (const dente of dentesDe(geometry)) {
            expect(km(dente)).toBeLessThan(comprimento * 0.5);
        }

        // E o padrao cobre a linha inteira: o pe final de um dente e o pe inicial
        // do proximo, no mesmo ponto.
        const dentes = dentesDe(geometry);
        for (let i = 1; i < dentes.length; i++) {
            expect(metros(dentes[i - 1][2], dentes[i][0])).toBeLessThan(0.001);
        }
    });

    it('cada dente e um anel FECHADO de quatro pontos: o ultimo repete o primeiro', () => {
        const dentes = dentesDe(geom.generate(props(base), 12));

        expect(dentes.length).toBeGreaterThan(1);
        for (const dente of dentes) {
            expect(dente).toHaveLength(4);
            expect(dente[3]).toEqual(dente[0]);
        }
    });

    it('os dois pes do dente ficam SOBRE a linha', () => {
        const geometry = geom.generate(props(base), 12);
        const arco = arcoDe(base);
        const clicada = turf.lineString(base);

        let piorNoArco = 0;
        let piorNaClicada = 0;
        for (const dente of dentesDe(geometry)) {
            for (const pe of [dente[0], dente[2]]) {
                piorNoArco = Math.max(piorNoArco, distanciaA(pe, arco));
                piorNaClicada = Math.max(piorNaClicada, distanciaA(pe, clicada));
            }
        }

        // Medido em 2026-09-03 contra este bundle: 0,0000045 m do arco, contra
        // 1,129884 m da linha clicada. O segundo numero e a flecha do grande
        // circulo, a mesma que a suite da concertina registra nesta linha de
        // 10 km, e nao folga do dente.
        expect(piorNoArco).toBeLessThan(0.001);
        expect(piorNaClicada).toBeLessThan(1.5);
    });

    it('a profundidade do apice e o PERIODO vezes depthRatio', () => {
        const properties = props(base, { symbol_size: 0.5 });
        const geometry = geom.generate(properties, 12);
        const arco = arcoDe(base);

        // O periodo entregue nao e o pedido: `resolveContinuousLayout` AJUSTA o
        // periodo ao comprimento da linha, para o padrao nao terminar num toco de
        // linha nua. Medido: 0,49999 km numa linha de 9,9998 km, em 20 dentes.
        const periodo = km(base) / geom.describeLayout(properties, 12).count;
        const alvo = periodo * LINEAR_SYMBOLS[FOSSO].depthRatio * 1000;

        expect(alvo).toBeCloseTo(409.99, 1);

        for (const dente of dentesDe(geometry)) {
            // Medido: 410,10 a 410,49 m contra os 409,99 m do alvo.
            expect(Math.abs(distanciaA(apiceDe(dente), arco) - alvo) / alvo).toBeLessThan(0.02);
            // A base do dente e o periodo inteiro, porque os dentes se encostam.
            expect(metros(dente[0], dente[2])).toBeCloseTo(periodo * 1000, 1);
        }
    });
});

// ============================================================================
// O LADO — a informacao que o desenho carrega
// ============================================================================

describe('o lado dos dentes e a informacao do simbolo', () => {
    const base = straightLine(10);

    it('todo dente aponta para o MESMO lado', () => {
        const dentes = dentesDe(geom.generate(props(base), 12));

        expect(dentes.length).toBeGreaterThan(1);

        const lados = dentes.map(ladoLocal);
        expect(new Set(lados).size).toBe(1);
        expect(lados[0]).not.toBe(0);

        // A mesma leitura contra uma referencia FIXA, a linha clicada, para o caso
        // de o rumo local e o rumo geral discordarem. Medido: -1 em todos, isto e
        // a DIREITA do percurso, que e o `bearing + 90` do builder.
        const fixos = dentes.map(dente => lado(base[0], base[1], apiceDe(dente)));
        expect(new Set(fixos).size).toBe(1);
        expect(fixos[0]).toBe(lados[0]);
        expect(fixos[0]).toBe(-1);
    });

    it('CONTRAPROVA: a regua acusa dois lados quando eles existem', () => {
        // A regra acima so vale se souber REPROVAR. Este par de dentes de mentira
        // alterna de lado de proposito, e e o desenho que o simbolo nao pode ter.
        const alternado = [
            [[0, 0], [0.5, 1], [1, 0], [0, 0]],
            [[2, 0], [2.5, -1], [3, 0], [2, 0]],
        ];

        expect(new Set(alternado.map(ladoLocal)).size).toBe(2);
    });

    it('INVERTER a linha inverte o lado dos dentes', () => {
        const invertida = [...base].reverse();

        // A referencia e SEMPRE `base[0] -> base[1]`, nunca a linha invertida, ou
        // os dois sinais girariam juntos e o teste nao mediria nada.
        const ladoContra = (coords) => {
            const dentes = dentesDe(geom.generate(props(coords), 12));
            expect(dentes.length).toBeGreaterThan(0);
            const lados = dentes.map(dente => lado(base[0], base[1], apiceDe(dente)));
            expect(new Set(lados).size).toBe(1);
            return lados[0];
        };

        const antes = ladoContra(base);
        const depois = ladoContra(invertida);

        expect(antes).not.toBe(0);
        expect(depois).toBe(-antes);

        // CONTRAPROVA da REFERENCIA. Medido contra a base do proprio dente, os
        // dois sinais giram juntos e a leitura fica IGUAL nos dois sentidos, isto
        // e, mede nada. E a armadilha que a referencia fixa acima evita, e ela
        // fica registrada aqui para que ninguem a reintroduza por simplificacao.
        const local = (coords) => ladoLocal(dentesDe(geom.generate(props(coords), 12))[0]);
        expect(local(invertida)).toBe(local(base));
    });

    it('numa dobra de 90 graus os dentes seguem todos do mesmo lado do percurso', () => {
        const cotovelo = [[-53.0, -30.0], [-52.98, -30.0], [-52.98, -29.98]];
        const properties = props(cotovelo, { symbol_size: 0.2 });
        const dentes = dentesDe(geom.generate(properties, 12));

        expect(dentes.length).toBeGreaterThan(4);
        expect(dentes).toHaveLength(geom.describeLayout(properties, 12).count);

        // A dobra tem de ser ATRAVESSADA por um dente, ou o caso nao exercita
        // nada. Um dente que corta o canto tem a corda mais curta que o arco que
        // ele cobre, e essa e a assinatura de que ele esta em cima da dobra.
        const periodo = km(cotovelo) / dentes.length;
        const cordas = dentes.map(d => metros(d[0], d[2]));
        expect(Math.min(...cordas)).toBeLessThan(periodo * 1000 * 0.9);

        const lados = dentes.map(ladoLocal);
        expect(new Set(lados).size).toBe(1);
        expect(lados[0]).not.toBe(0);
    });
});

// ============================================================================
// A REGUA DA PRANCHA — as duas razoes que o perfil do manual fixa
// ============================================================================

describe('a regua do MD33-M-02, medida na prancha', () => {
    const base = straightLine(10);

    /** O que o perfil da prancha da, lido coluna a coluna em 2026-09-03. */
    const PRANCHA = { alturaPorBase: 0.82, periodoPorBase: 1 };

    it('o dente tem 0,82 de altura por base, e os dentes se emendam', () => {
        const properties = props(base);
        const geometry = geom.generate(properties, 12);
        const arco = arcoDe(base);
        const periodo = km(base) / geom.describeLayout(properties, 12).count;

        const dentes = dentesDe(geometry);
        expect(dentes.length).toBeGreaterThan(1);

        for (const dente of dentes) {
            const largura = metros(dente[0], dente[2]);

            // Medido em 2026-09-03 nesta linha de 10 km com 20 dentes: base de
            // 499,99 m e apice a 410,1 m do arco, ou seja 0,820. E o `depthRatio`
            // do catalogo, e e o que a prancha da.
            expect(distanciaA(apiceDe(dente), arco) / largura)
                .toBeCloseTo(PRANCHA.alturaPorBase, 2);

            // Periodo IGUAL a base: os triangulos se encostam, como o perfil da
            // prancha mostra. Um periodo maior que a base deixaria um pedaco de
            // linha nua entre dois dentes, que e outro simbolo.
            expect((periodo * 1000) / largura).toBeCloseTo(PRANCHA.periodoPorBase, 2);
        }
    });
});

// ============================================================================
// PIOR CASO — os insumos que a regua existe para aguentar
// ============================================================================

describe('pior caso do fosso anticarro', () => {
    const degenerados = [
        ['linha de comprimento zero', props([[-53, -30], [-53, -30]])],
        ['linha de 1 metro', props(straightLine(0.001))],
        ['vai-e-volta A -> B -> A', props([[-53, -30], [-52.95, -30], [-53, -30]])],
        ['dente maior que a linha', props(straightLine(1), { symbol_size: 50 })],
        ['codigo desconhecido', props(straightLine(10), { symbol_code: '999999' })],
    ];

    for (const [nome, properties] of degenerados) {
        it(`${nome}: nao lanca e devolve so coordenada finita`, () => {
            let geometry;
            expect(() => { geometry = geom.generate(properties, 12); }).not.toThrow();

            expect(geometry).toBeTruthy();
            expect(['LineString', 'MultiLineString', 'MultiPolygon']).toContain(geometry.type);
            expect(Array.isArray(geometry.coordinates)).toBe(true);
            expect(geometry.coordinates.length).toBeGreaterThan(0);

            const pontos = pontosDe(geometry);
            expect(pontos.length).toBeGreaterThan(0);
            for (const [lng, lat] of pontos) {
                expect(Number.isFinite(lng)).toBe(true);
                expect(Number.isFinite(lat)).toBe(true);
                expect(lat).toBeGreaterThanOrEqual(-90);
                expect(lat).toBeLessThanOrEqual(90);
            }
        });
    }

    it('o vai-e-volta: so o dente da DOBRA degenera, e os outros seguem do mesmo lado', () => {
        // A ida e a volta correm sobre os MESMOS pontos, entao um lado medido
        // contra a linha clicada seria zero. O rumo local do proprio dente e a
        // unica referencia que sobrevive a isso.
        const dentes = dentesDe(geom.generate(props([[-53, -30], [-52.95, -30], [-53, -30]]), 12));

        expect(dentes.length).toBeGreaterThan(1);

        const cordas = dentes.map(d => metros(d[0], d[2]));
        const lados = dentes.map(ladoLocal);

        // DEFEITO DE PRODUCAO, medido em 2026-09-03 e REGISTRADO aqui em vez de
        // consertado. O dente centrado exatamente na dobra tem os dois pes no
        // MESMO ponto, e `turf.bearing` de dois pontos coincidentes devolve 0, ou
        // seja norte: o apice sai entao para leste, AO LONGO da linha em vez de
        // atravessado nela. Medido nesta linha de 9,6298 km com 19 dentes de
        // 506,83 m: o dente 9 tem corda 0 m e 669,02 m do pe ao apice, contra
        // 486,77 m dos outros dezoito. O mesmo `zigzagTooth` desenha a sapa
        // (557,51 m contra 395,84 m) e a trincheira, com um dente degenerado cada.
        const degenerados = cordas.filter(c => c < 1).length;
        expect(degenerados).toBe(1);

        // A afirmacao DURAVEL, que continua valendo se alguem consertar a dobra:
        // todo dente de base utilizavel aponta para o mesmo lado do percurso.
        const bons = lados.filter((_, i) => cordas[i] >= 1);
        expect(bons).toHaveLength(dentes.length - degenerados);
        expect(new Set(bons).size).toBe(1);
        expect(bons[0]).not.toBe(0);
    });

    it('um dente maior que a linha degrada para a espinha nua, nunca para o vazio', () => {
        const espinha = straightLine(1);
        const geometry = geom.generate(props(espinha, { symbol_size: 50 }), 12);

        expect(geometry.type).toBe('LineString');
        expect(geometry.coordinates).toEqual(espinha);
        expect(dentesDe(geometry)).toHaveLength(0);
    });

    it('o teto de dentes vale para o fosso, e o padrao ainda cobre a linha inteira', () => {
        const base = straightLine(100);
        const properties = props(base, { symbol_size: 0.001 });
        const layout = geom.describeLayout(properties, 12);
        const dentes = dentesDe(geom.generate(properties, 12));

        expect(layout.count).toBeLessThanOrEqual(geom.maxGlyphs);
        expect(layout.capped).toBe(true);
        expect(dentes).toHaveLength(layout.count);

        // Capado nao quer dizer parado no meio: o ultimo dente chega ao fim da
        // linha, ou a cauda ficaria com cara de linha comum, que e outro simbolo.
        expect(metros(dentes[dentes.length - 1][2], base[base.length - 1])).toBeLessThan(1);
    });
});
