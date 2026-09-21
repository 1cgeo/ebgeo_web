// Path: tests/unit/visibilidade-temporal-uma-regra-so.test.js

/**
 * @fileoverview O MAPA 2D E AS OUTRAS TRES SUPERFICIES DECIDIAM VISIBILIDADE POR REGRAS
 * DIFERENTES (achados M1 = V6, M6 = E6 = I9, e o buraco de teste M9).
 *
 * O DEFEITO. O filtro do mapa (`layers/visibility-filter.js`) testa SOBREPOSICAO entre a janela
 * de validade da feicao e a celula quantizada do passo; o marcador 3D, o marcador 360 e a legenda
 * do PDF testavam o INSTANTE do cursor. Com unidade HORA e o cursor as 10:00, uma feicao que
 * comeca as 10:20 cai DENTRO da celula [10:00, 11:00) e aparece no mapa, e some das outras tres;
 * o PDF a imprime na folha e nao a conta na legenda. Com unidade SEMANA a divergencia chega a
 * tres dias e meio.
 *
 * A CAUSA DE FUNDO, e o motivo deste arquivo existir. A regra estava escrita DUAS vezes, uma como
 * expressao do MapLibre e outra como funcao JavaScript, e nenhum teste do repositorio punha as
 * duas na MESMA assercao: o teste do filtro afirmava so a FORMA da expressao e o teste do modelo
 * so o predicado puro, de modo que as duas podiam divergir para sempre com as duas suites verdes.
 * Este arquivo avalia o MESMO conjunto de feicoes pelos DOIS caminhos e exige respostas iguais.
 *
 * O SEGUNDO DESVIO QUE ISSO REVELOU (M6): janela INVERTIDA (fim antes do inicio, que nada no
 * produto valida) era invisivel no predicado de instante e VISIVEL no filtro sempre que a celula
 * atravessasse a inversao. A semantica escolhida e' "nunca visivel", e ela esta presa nos dois
 * lados: a terceira clausula `inicio <= fim` do filtro e a guarda de mesmo nome no modelo.
 *
 * O AVALIADOR E' O CONTROLE INDEPENDENTE. Ele interpreta a expressao do MapLibre aqui dentro
 * (`all`, `<=`, `>=`, `coalesce`, `get`), sem chamar uma linha do modelo: se as duas respostas
 * batem, e porque batem de verdade, e nao porque uma foi derivada da outra.
 *
 * O QUE ESTE ARQUIVO NAO ALCANCA, declarado: um limite NaN dentro das propriedades. O modelo o
 * trata como ausente e o motor de expressao do MapLibre o compararia como falso (toda comparacao
 * com NaN e falsa), entao ali os dois divergem de proposito. A divergencia nao e' alcancavel pelo
 * produto, porque as propriedades chegam de JSON, que nao carrega NaN; um caso do
 * `temporal-model.test.js` fixa o lado do modelo.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    isTemporallyVisible,
    isTemporallyVisibleInWindow,
    isVisibleUnderTemporal,
    TEMPORAL_MIN_TS,
    TEMPORAL_MAX_TS,
} from '../../src/js/temporal/temporal-model.js';
import { buildTemporalOverlapFilter } from '../../src/js/layers/visibility-filter.js';

// ============================================================================
// Avaliador minimo de expressao MapLibre (o caminho INDEPENDENTE)
// ============================================================================

/**
 * Avalia o subconjunto de expressao que `buildTemporalOverlapFilter` produz, contra um objeto de
 * propriedades. Lanca em operador desconhecido de proposito: uma clausula nova que este avaliador
 * nao saiba ler tem de REPROVAR, nunca ser ignorada em silencio (seria cobertura vazia).
 * @param {*} expr - Expressao MapLibre, ou um literal.
 * @param {Object} props - Propriedades da feicao.
 * @returns {*}
 */
function avaliar(expr, props) {
    if (!Array.isArray(expr)) return expr;
    const [op, ...args] = expr;
    switch (op) {
        case 'all':
            return args.every((a) => avaliar(a, props) === true);
        case 'get': {
            // `['get', k]` do MapLibre devolve null quando a chave nao existe.
            const v = props?.[args[0]];
            return v === undefined ? null : v;
        }
        case 'coalesce': {
            for (const a of args) {
                const v = avaliar(a, props);
                if (v !== null && v !== undefined) return v;
            }
            return null;
        }
        case '<=':
            return avaliar(args[0], props) <= avaliar(args[1], props);
        case '>=':
            return avaliar(args[0], props) >= avaliar(args[1], props);
        default:
            throw new Error(`avaliador nao conhece o operador "${op}"`);
    }
}

/** Resposta do FILTRO do mapa para uma feicao numa janela. */
function visivelPeloFiltro(props, start, end) {
    return avaliar(buildTemporalOverlapFilter(start, end), props);
}

// ============================================================================
// O corpus: feicoes e janelas escolhidas para tocar cada fronteira
// ============================================================================

const HORA = 3600_000;
const T10 = Date.UTC(2024, 10, 20, 10, 0, 0); // 20/11/2024 10:00Z

const FEICOES = [
    ['permanente (sem tempo)', {}],
    ['so nome, nenhum limite', { nome: 'x' }],
    ['comeca 10:20, sem fim', { temporalInicio: T10 + 20 * 60_000 }],
    ['termina 10:20, sem inicio', { temporalFim: T10 + 20 * 60_000 }],
    ['janela inteira dentro da celula', { temporalInicio: T10 + 10 * 60_000, temporalFim: T10 + 50 * 60_000 }],
    ['janela que engloba a celula', { temporalInicio: T10 - 5 * HORA, temporalFim: T10 + 5 * HORA }],
    ['encosta no inicio da celula', { temporalInicio: T10 - HORA, temporalFim: T10 }],
    ['encosta no fim da celula', { temporalInicio: T10 + HORA, temporalFim: T10 + 2 * HORA }],
    ['termina um ms antes da celula', { temporalInicio: T10 - HORA, temporalFim: T10 - 1 }],
    ['comeca um ms depois da celula', { temporalInicio: T10 + HORA + 1, temporalFim: T10 + 2 * HORA }],
    ['instantanea no meio da celula', { temporalInicio: T10 + 30 * 60_000, temporalFim: T10 + 30 * 60_000 }],
    ['INVERTIDA dentro da celula', { temporalInicio: T10 + 50 * 60_000, temporalFim: T10 + 10 * 60_000 }],
    ['INVERTIDA atravessando a celula', { temporalInicio: T10 + 5 * HORA, temporalFim: T10 - 5 * HORA }],
    ['epoch zero', { temporalInicio: 0, temporalFim: 0 }],
    ['antes de 1970', { temporalInicio: -2 * HORA, temporalFim: -HORA }],
];

const JANELAS = [
    ['celula de uma hora', T10, T10 + HORA],
    ['instante 10:00', T10, T10],
    ['instante 10:20', T10 + 20 * 60_000, T10 + 20 * 60_000],
    ['celula de uma semana', T10, T10 + 7 * 24 * HORA],
    ['celula anterior', T10 - HORA, T10],
    ['epoch zero como instante', 0, 0],
    ['janela negativa (antes de 1970)', -3 * HORA, -HORA],
];

describe('1. o predicado puro e a expressao do MapLibre respondem a MESMA coisa', () => {
    it('os dois sentinelas de "sem limite" sao o MESMO numero dos dois lados', () => {
        // Se eles divergirem, todo o resto deste arquivo continuaria verde e o produto teria duas
        // nocoes de "permanente" separadas por milenios.
        const expr = JSON.stringify(buildTemporalOverlapFilter(0, 0));
        expect(expr).toContain(String(TEMPORAL_MIN_TS));
        expect(expr).toContain(String(TEMPORAL_MAX_TS));
    });

    for (const [nomeJanela, start, end] of JANELAS) {
        for (const [nomeFeicao, props] of FEICOES) {
            it(`${nomeFeicao} / ${nomeJanela}`, () => {
                const doModelo = isTemporallyVisibleInWindow(props, start, end);
                const doFiltro = visivelPeloFiltro(props, start, end);
                expect(typeof doFiltro).toBe('boolean');
                expect(doModelo).toBe(doFiltro);
            });
        }
    }

    it('CONTROLE DE VACUO: o corpus contem os DOIS desfechos, e nao so "visivel"', () => {
        const respostas = new Set();
        for (const [, start, end] of JANELAS) {
            for (const [, props] of FEICOES) respostas.add(isTemporallyVisibleInWindow(props, start, end));
        }
        expect(respostas).toEqual(new Set([true, false]));
    });

    it('propriedade: mil casos sorteados dao a mesma resposta nos dois caminhos', () => {
        const limite = fc.option(fc.integer({ min: -5_000_000, max: 5_000_000 }), { nil: undefined });
        fc.assert(
            fc.property(
                limite,
                limite,
                fc.integer({ min: -5_000_000, max: 5_000_000 }),
                fc.integer({ min: 0, max: 200_000 }),
                (inicio, fim, start, largura) => {
                    const props = {};
                    if (inicio !== undefined) props.temporalInicio = inicio;
                    if (fim !== undefined) props.temporalFim = fim;
                    const end = start + largura;
                    return isTemporallyVisibleInWindow(props, start, end) === visivelPeloFiltro(props, start, end);
                },
            ),
            { numRuns: 1000 },
        );
    });
});

describe('2. a janela INVERTIDA nunca e visivel, nos dois lados (M6)', () => {
    const invertida = { temporalInicio: 5000, temporalFim: 1000 };

    it('o instante nao a mostra em cursor nenhum', () => {
        for (const cursor of [0, 999, 1000, 3000, 5000, 5001, 9999]) {
            expect(isTemporallyVisible(invertida, cursor)).toBe(false);
        }
    });

    it('a janela que ATRAVESSA a inversao tambem nao a mostra, e o filtro concorda', () => {
        // Este e' EXATAMENTE o caso que divergia: a sobreposicao crua (inicio<=end && fim>=start)
        // diria "visivel" aqui, porque 5000 <= 9000 e 1000 >= 0.
        expect(isTemporallyVisibleInWindow(invertida, 0, 9000)).toBe(false);
        expect(visivelPeloFiltro(invertida, 0, 9000)).toBe(false);
    });

    it('CONTROLE: a mesma janela NAO invertida e visivel ali', () => {
        const direita = { temporalInicio: 1000, temporalFim: 5000 };
        expect(isTemporallyVisibleInWindow(direita, 0, 9000)).toBe(true);
        expect(visivelPeloFiltro(direita, 0, 9000)).toBe(true);
    });
});

describe('3. a celula de uma hora: o caso concreto do relatorio', () => {
    const comeca1020 = { temporalInicio: T10 + 20 * 60_000 };

    it('a feicao que comeca as 10:20 aparece no mapa com o cursor as 10:00', () => {
        expect(visivelPeloFiltro(comeca1020, T10, T10 + HORA)).toBe(true);
    });

    it('REGRESSAO: a regra da JANELA concorda com o mapa; a do INSTANTE nao concordava', () => {
        expect(isTemporallyVisibleInWindow(comeca1020, T10, T10 + HORA)).toBe(true);
        // O controle negativo do proprio caso: e' o instante que respondia diferente, e e' ele que
        // as outras tres superficies usavam.
        expect(isTemporallyVisible(comeca1020, T10)).toBe(false);
    });
});

// ============================================================================
// isVisibleUnderTemporal: a porta unica das superficies fora do MapLibre
// ============================================================================

/** Controlador de mentira, com a forma que `getFilterWindow`/`isRevealing` prometem. */
function controlador({ window = null, revealing = false, cursor = NaN } = {}) {
    return {
        getFilterWindow: () => window,
        isRevealing: () => revealing,
        getCursor: () => cursor,
    };
}

describe('4. isVisibleUnderTemporal', () => {
    const comeca1020 = { temporalInicio: T10 + 20 * 60_000 };

    it('temporal desligado mostra tudo, sem sequer perguntar ao controlador', () => {
        const ctrl = {
            getFilterWindow: () => { throw new Error('nao devia perguntar'); },
            isRevealing: () => { throw new Error('nao devia perguntar'); },
            getCursor: () => { throw new Error('nao devia perguntar'); },
        };
        expect(isVisibleUnderTemporal(comeca1020, false, ctrl)).toBe(true);
    });

    it('usa a JANELA do controlador, e concorda com o filtro do mapa (M1)', () => {
        const ctrl = controlador({ window: { start: T10, end: T10 + HORA }, cursor: T10 });
        expect(isVisibleUnderTemporal(comeca1020, true, ctrl)).toBe(true);
        expect(visivelPeloFiltro(comeca1020, T10, T10 + HORA)).toBe(true);
    });

    it('REGRESSAO: com a janela, a resposta deixa de ser a do instante cru', () => {
        const ctrl = controlador({ window: { start: T10, end: T10 + HORA }, cursor: T10 });
        // O comportamento ANTIGO (instante) respondia false aqui; e' o vermelho que este caso
        // produz quando o conserto e' revertido.
        expect(isTemporallyVisible(comeca1020, ctrl.getCursor())).toBe(false);
        expect(isVisibleUnderTemporal(comeca1020, true, ctrl)).toBe(true);
    });

    it('revelar ocultas nao esconde NADA, nem o que a janela esconderia (V7)', () => {
        const fora = { temporalInicio: T10 + 10 * HORA, temporalFim: T10 + 11 * HORA };
        const janela = { start: T10, end: T10 + HORA };
        expect(isVisibleUnderTemporal(fora, true, controlador({ window: janela }))).toBe(false);
        expect(isVisibleUnderTemporal(fora, true, controlador({ window: janela, revealing: true }))).toBe(true);
    });

    it('sem janela cai no teste de instante, que era o comportamento anterior', () => {
        const ctrl = controlador({ window: null, cursor: T10 });
        expect(isVisibleUnderTemporal(comeca1020, true, ctrl)).toBe(false);
        expect(isVisibleUnderTemporal({ temporalInicio: T10 - HORA }, true, ctrl)).toBe(true);
    });

    it('controlador ausente, ou sem os metodos novos, degrada para mostrar tudo', () => {
        expect(isVisibleUnderTemporal(comeca1020, true, null)).toBe(true);
        expect(isVisibleUnderTemporal(comeca1020, true, undefined)).toBe(true);
        expect(isVisibleUnderTemporal(comeca1020, true, {})).toBe(true);
    });

    it('BORDA: janela com start nao finito cai no instante em vez de esconder tudo', () => {
        const ctrl = controlador({ window: { start: NaN, end: NaN }, cursor: T10 + 30 * 60_000 });
        expect(isVisibleUnderTemporal(comeca1020, true, ctrl)).toBe(true);
    });

    it('BORDA: epoch zero como janela e instante legitimo, nao ausencia', () => {
        const ctrl = controlador({ window: { start: 0, end: 0 } });
        expect(isVisibleUnderTemporal({ temporalInicio: 1 }, true, ctrl)).toBe(false);
        expect(isVisibleUnderTemporal({ temporalInicio: 0 }, true, ctrl)).toBe(true);
    });
});

// ============================================================================
// 5. O CENSO: ninguem reescreve a regra por fora
// ============================================================================
//
// A equivalencia acima prende as DUAS escritas da regra uma contra a outra. Este bloco prende a
// terceira coisa, que e' a que deixou M1 vivo por tanto tempo: uma superficie que decida
// visibilidade temporal com um teste PROPRIO. O defeito nao foi as duas regras discordarem por
// descuido, foi cada superficie ter escolhido a sua.

/** Caminho absoluto de um arquivo de `src/` a partir deste teste. */
function fonte(relativo) {
    return readFileSync(fileURLToPath(new URL(`../../src/${relativo}`, import.meta.url)), 'utf8');
}

const SUPERFICIES = [
    ['marcador 3D', 'js/3d_models_viewer_tool/tools/marker_tool_3d.js'],
    ['marcador 360', 'js/street_view_tool/street_view_viewer.js'],
    ['legenda do PDF', 'js/import_export/pdf-export.tab.js'],
];

describe('5. as tres superficies fora do MapLibre delegam a regra', () => {
    for (const [nome, caminho] of SUPERFICIES) {
        it(`${nome} pergunta por isVisibleUnderTemporal`, () => {
            const codigo = fonte(caminho);
            expect(codigo).toContain('isVisibleUnderTemporal');
            // E le o CONTROLADOR, que e' de onde a janela e o modo de revelar saem. A porta so
            // devolve "mostra tudo" quando nao recebe controlador, entao passar nulo seria a
            // forma de desligar a regra sem que nada aqui reclamasse.
            expect(codigo).toContain("getControl('TemporalControl')");
        });

        it(`${nome} nao monta mais um teste de instante proprio`, () => {
            const codigo = fonte(caminho);
            // `isTemporallyVisible(` cru e' a forma exata que divergia do filtro do mapa.
            expect(codigo).not.toMatch(/\bisTemporallyVisible\s*\(/);
            // E nenhuma comparacao a mao contra os campos de validade.
            expect(codigo).not.toMatch(/temporalInicio\s*[<>]/);
            expect(codigo).not.toMatch(/temporalFim\s*[<>]/);
        });
    }

    it('CONTROLE DE VACUO: o teste sabe ler os tres arquivos, e eles nao estao vazios', () => {
        for (const [, caminho] of SUPERFICIES) {
            expect(fonte(caminho).length).toBeGreaterThan(1000);
        }
    });
});
