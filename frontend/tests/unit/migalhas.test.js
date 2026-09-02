// Path: tests/unit/migalhas.test.js

/**
 * @fileoverview O ANEL DE MIGALHAS, e as três propriedades que valem mais que o recurso: nunca
 * lança, tem teto duro, e não guarda nada que não caiba nos tetos que a rota valida.
 *
 * ELE É DIRIGIDO PELA FÁBRICA, e não pelo singleton, em quase tudo: relógio parado e normalizador
 * de mentira são o que permite medir o corte e o descarte sem esperar por nada. O singleton ganha
 * os casos que só ele tem (a normalização configurada depois da construção).
 *
 * CONTROLE NEGATIVO conferido revertendo: tire o `while (anel.length > teto)` e o caso do teto fica
 * vermelho; tire o `try` do `registrar` e o caso do relógio quebrado passa a lançar; troque o
 * `anel.map(...)` de `listar` por `anel` e o caso da cópia fica vermelho.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    TETO_DE_MIGALHAS,
    TETO_DO_TEXTO,
    TETO_DO_TIPO,
    TipoDeMigalha,
    configurarMigalhas,
    criarMigalhas,
    migalhas,
    normalizarRota,
} from '@js/session/migalhas.js';

/** Um anel com relógio parado, que é o que torna o `t` uma asserção e não um sorteio. */
function anelDeTeste(opcoes = {}) {
    let relogio = 1000;
    const anel = criarMigalhas({
        agora: () => relogio,
        ...opcoes,
    });
    return { anel, avancar: (ms) => { relogio += ms; }, relogio: () => relogio };
}

describe('o vocabulário de tipo: seis valores, fechados', () => {
    it('são exatamente os seis, e o objeto é congelado', () => {
        expect(Object.values(TipoDeMigalha).sort()).toEqual([
            'api', 'conexao', 'console', 'evento', 'navegacao', 'sessao',
        ]);
        expect(Object.isFrozen(TipoDeMigalha)).toBe(true);
    });

    it('nenhum valor se repete (duplicata fundiria dois canais num filtro só)', () => {
        const valores = Object.values(TipoDeMigalha);
        expect(new Set(valores).size).toBe(valores.length);
    });
});

describe('o anel: teto duro, e o mais VELHO cai', () => {
    it('guarda o que cabe, na ordem em que entrou', () => {
        const { anel } = anelDeTeste();
        anel.registrar(TipoDeMigalha.EVENTO, 'primeira');
        anel.registrar(TipoDeMigalha.EVENTO, 'segunda');
        expect(anel.listar().map((m) => m.texto)).toEqual(['primeira', 'segunda']);
        expect(anel.tamanho()).toBe(2);
    });

    it('no teto+1 o mais velho SAI, e o mais novo entra', () => {
        const { anel } = anelDeTeste({ teto: 3 });
        for (const texto of ['a', 'b', 'c', 'd']) anel.registrar(TipoDeMigalha.EVENTO, texto);
        expect(anel.listar().map((m) => m.texto)).toEqual(['b', 'c', 'd']);
        expect(anel.tamanho()).toBe(3);
        expect(anel.estado().caidas).toBe(1);
    });

    it('o teto padrão são as trinta que a rota aceita', () => {
        const { anel } = anelDeTeste();
        for (let i = 0; i < 100; i++) anel.registrar(TipoDeMigalha.API, `pedido ${i}`);
        expect(anel.tamanho()).toBe(TETO_DE_MIGALHAS);
        expect(TETO_DE_MIGALHAS).toBe(30);
        // O corte é pelo TOPO: o que sobrou é o FIM da sequência, que é o que explica o desfecho.
        expect(anel.listar()[TETO_DE_MIGALHAS - 1].texto).toBe('pedido 99');
    });

    it('`limpar` esvazia o anel e NÃO zera os contadores (eles descrevem a página)', () => {
        const { anel } = anelDeTeste();
        anel.registrar(TipoDeMigalha.EVENTO, 'a');
        anel.limpar();
        expect(anel.tamanho()).toBe(0);
        expect(anel.listar()).toEqual([]);
        expect(anel.estado().registradas).toBe(1);
    });
});

describe('a forma de uma migalha: três campos, e nada mais', () => {
    it('cada item tem exatamente `t`, `tipo` e `texto`', () => {
        const { anel } = anelDeTeste();
        anel.registrar(TipoDeMigalha.API, 'GET /config 200 3ms');
        const [item] = anel.listar();
        expect(Object.keys(item).sort()).toEqual(['t', 'texto', 'tipo']);
        expect(item.t).toBe(1000);
        expect(item.tipo).toBe('api');
        expect(item.texto).toBe('GET /config 200 3ms');
    });

    it('o `t` é INTEIRO mesmo com relógio fracionário (a coluna do servidor é inteira)', () => {
        const anel = criarMigalhas({ agora: () => 1234.987 });
        anel.registrar(TipoDeMigalha.EVENTO, 'x');
        expect(anel.listar()[0].t).toBe(1234);
        expect(Number.isInteger(anel.listar()[0].t)).toBe(true);
    });

    it('o `tipo` é cortado em 20 e o `texto` em 120', () => {
        const { anel } = anelDeTeste();
        anel.registrar('t'.repeat(80), 'x'.repeat(400));
        const [item] = anel.listar();
        expect(item.tipo).toHaveLength(TETO_DO_TIPO);
        expect(item.texto).toHaveLength(TETO_DO_TEXTO);
        expect(TETO_DO_TIPO).toBe(20);
        expect(TETO_DO_TEXTO).toBe(120);
    });

    it('`listar` devolve CÓPIA: mexer no resultado não mexe no anel', () => {
        // O resultado vai para dentro do corpo de um POST, que pode ir para a fila do
        // `localStorage`: uma referência viva continuaria mudando depois de guardada.
        const { anel } = anelDeTeste();
        anel.registrar(TipoDeMigalha.EVENTO, 'original');
        const lista = anel.listar();
        lista[0].texto = 'adulterado';
        lista.push({ t: 0, tipo: 'x', texto: 'intruso' });
        expect(anel.listar()).toEqual([{ t: 1000, tipo: 'evento', texto: 'original' }]);
    });
});

describe('a normalização INJETADA', () => {
    it('o texto passa pelo normalizador antes de entrar', () => {
        const anel = criarMigalhas({ agora: () => 1, normalizar: (t) => t.toUpperCase() });
        anel.registrar(TipoDeMigalha.EVENTO, 'minusculo');
        expect(anel.listar()[0].texto).toBe('MINUSCULO');
    });

    it('o corte de 120 vale DEPOIS da normalização (é ela que pode encompridar)', () => {
        const anel = criarMigalhas({ agora: () => 1, normalizar: (t) => t.repeat(50) });
        anel.registrar(TipoDeMigalha.EVENTO, 'abc');
        expect(anel.listar()[0].texto).toHaveLength(TETO_DO_TEXTO);
    });

    it('normalizador que LANÇA não derruba o registro: o texto entra cru', () => {
        const anel = criarMigalhas({
            agora: () => 1,
            normalizar: () => { throw new Error('normalizador quebrado'); },
        });
        expect(() => anel.registrar(TipoDeMigalha.EVENTO, 'sobrevive')).not.toThrow();
        expect(anel.listar()[0].texto).toBe('sobrevive');
    });

    it('normalizador que devolve não-string é ignorado (o texto entra cru)', () => {
        const anel = criarMigalhas({ agora: () => 1, normalizar: () => ({ nao: 'string' }) });
        anel.registrar(TipoDeMigalha.EVENTO, 'cru');
        expect(anel.listar()[0].texto).toBe('cru');
    });

    it('sem normalizador o anel guarda o texto como veio (o caso do node puro)', () => {
        const { anel } = anelDeTeste();
        anel.registrar(TipoDeMigalha.API, 'GET /config 200 3ms');
        expect(anel.listar()[0].texto).toBe('GET /config 200 3ms');
    });
});

describe('NUNCA LANÇA: entrada ruim é descartada e CONTADA', () => {
    // Laço dentro de UM caso, e não `it.each`: o `%s` do título não sabe formatar um `Symbol` (ele
    // LANÇA), e um array na lista de casos o corredor ESPALHA como argumentos, o que faria o caso
    // do array vazio medir `undefined` em silêncio.
    const RUINS = [null, undefined, 42, {}, [], true, Symbol('x'), () => {}];

    it('tipo inválido não lança e não entra', () => {
        let conferidos = 0;
        for (const ruim of RUINS) {
            const { anel } = anelDeTeste();
            expect(() => anel.registrar(ruim, 'texto')).not.toThrow();
            expect(anel.tamanho()).toBe(0);
            expect(anel.estado().descartadas).toBe(1);
            conferidos++;
        }
        // Cobertura vazia passa verde: sem esta linha, uma lista que esvaziasse reportaria sucesso.
        expect(conferidos).toBe(RUINS.length);
    });

    it('texto inválido não lança e não entra', () => {
        let conferidos = 0;
        for (const ruim of RUINS) {
            const { anel } = anelDeTeste();
            expect(() => anel.registrar(TipoDeMigalha.EVENTO, ruim)).not.toThrow();
            expect(anel.tamanho()).toBe(0);
            expect(anel.estado().descartadas).toBe(1);
            conferidos++;
        }
        expect(conferidos).toBe(RUINS.length);
    });

    it('tipo e texto SÓ DE ESPAÇO são descartados (uma linha em branco não é fato)', () => {
        const { anel } = anelDeTeste();
        anel.registrar('   ', 'texto');
        anel.registrar(TipoDeMigalha.EVENTO, '   ');
        expect(anel.tamanho()).toBe(0);
        expect(anel.estado().descartadas).toBe(2);
    });

    it('relógio quebrado não lança e não produz `t` inválido', () => {
        for (const quebrado of [() => NaN, () => 'ontem', () => { throw new Error('x'); }]) {
            const anel = criarMigalhas({ agora: quebrado });
            expect(() => anel.registrar(TipoDeMigalha.EVENTO, 'x')).not.toThrow();
            expect(anel.tamanho()).toBe(0);
            expect(anel.estado().descartadas).toBe(1);
        }
    });

    it('`estado()` conta o que entrou, o que caiu e o que foi recusado', () => {
        const { anel } = anelDeTeste({ teto: 2 });
        anel.registrar(TipoDeMigalha.EVENTO, 'a');
        anel.registrar(TipoDeMigalha.EVENTO, 'b');
        anel.registrar(TipoDeMigalha.EVENTO, 'c');
        anel.registrar(null, 'd');
        expect(anel.estado()).toEqual({
            registradas: 3, descartadas: 1, caidas: 1, tamanho: 2, teto: 2,
        });
    });

    it('`registrar` devolve se a migalha entrou', () => {
        const { anel } = anelDeTeste();
        expect(anel.registrar(TipoDeMigalha.EVENTO, 'entra')).toBe(true);
        expect(anel.registrar(TipoDeMigalha.EVENTO, null)).toBe(false);
    });
});

describe('`normalizarRota`: a FORMA da rota, nunca a linha', () => {
    it('UUID vira `:id` e número vira `:n`', () => {
        expect(normalizarRota('/atlas/3f2504e0-4f89-11d3-9a0c-0305e82c3301/maps/12'))
            .toBe('/atlas/:id/maps/:n');
    });

    it('UUID em MAIÚSCULA também casa', () => {
        expect(normalizarRota('/atlas/3F2504E0-4F89-11D3-9A0C-0305E82C3301'))
            .toBe('/atlas/:id');
    });

    it('a QUERY é descartada inteira, com credencial e tudo', () => {
        // `?verify=` e `?atlasPublico=` são credenciais de uso único, e o termo de busca é texto
        // que a pessoa digitou. Nenhum dos três pode acabar num log.
        expect(normalizarRota('/auth/verify-email?verify=segredo-do-token')).toBe('/auth/verify-email');
        expect(normalizarRota('/nomes/busca?q=Cel%20Fulano')).toBe('/nomes/busca');
        expect(normalizarRota('/config#fragmento')).toBe('/config');
    });

    it('o resto do caminho é preservado (é ele que agrupa)', () => {
        expect(normalizarRota('/atlas')).toBe('/atlas');
        expect(normalizarRota('/resource-access/grants/issued')).toBe('/resource-access/grants/issued');
    });

    it('segmento longo demais é cortado (algumas rotas interpolam nome de gente)', () => {
        const nome = 'a'.repeat(200);
        const saida = normalizarRota(`/atlas/${nome}`);
        expect(saida.length).toBeLessThan(50);
        expect(saida.startsWith('/atlas/aaa')).toBe(true);
    });

    it('entrada estranha devolve vazio, e nunca lança', () => {
        for (const ruim of [null, undefined, 42, {}, [], '']) {
            expect(normalizarRota(ruim)).toBe('');
        }
    });

    it('hex de 32 (que NÃO é UUID) não vira `:id`: a regra é estreita de propósito', () => {
        // Uma regra larga demais apagaria nome de rota que por acaso pareça id. O que agrupa é a
        // FORMA, e o que a decide é o formato canônico do UUID, com os hifens.
        expect(normalizarRota('/x/0123456789abcdef0123456789abcdef'))
            .toBe('/x/0123456789abcdef0123456789abcdef');
    });
});

describe('o singleton do produto', () => {
    it('começa SEM normalização (o cliente HTTP o carrega em node puro)', () => {
        configurarMigalhas({ normalizar: null });
        migalhas.limpar();
        migalhas.registrar(TipoDeMigalha.API, 'GET /atlas/3f2504e0-4f89-11d3-9a0c-0305e82c3301 200 1ms');
        expect(migalhas.listar()[0].texto).toContain('3f2504e0');
        migalhas.limpar();
    });

    it('`configurarMigalhas` liga a normalização depois da construção', () => {
        configurarMigalhas({ normalizar: (t) => t.replace(/\d/g, '#') });
        migalhas.limpar();
        migalhas.registrar(TipoDeMigalha.API, 'GET /x 200 1ms');
        expect(migalhas.listar()[0].texto).toBe('GET /x ### #ms');
        configurarMigalhas({ normalizar: null });
        migalhas.limpar();
    });

    it('`configurarMigalhas` com entrada estranha não lança e desliga a normalização', () => {
        expect(() => configurarMigalhas({ normalizar: 'não é função' })).not.toThrow();
        expect(() => configurarMigalhas()).not.toThrow();
        migalhas.limpar();
        migalhas.registrar(TipoDeMigalha.EVENTO, 'cru');
        expect(migalhas.listar()[0].texto).toBe('cru');
        migalhas.limpar();
    });
});

describe('o contrato de FOLHA', () => {
    it('`session/migalhas.js` tem ZERO IMPORTS', () => {
        // A razão é mais estreita que a dos vizinhos: `store/sync/api-client.js` importa este
        // módulo, e os helpers do Playwright carregam AQUELE em node puro, sem alias do Vite. Um
        // import aqui derrubaria toda spec de UI antes de abrir o navegador.
        const caminho = fileURLToPath(new URL('../../src/js/session/migalhas.js', import.meta.url));
        const texto = readFileSync(caminho, 'utf8');
        // A guarda do próprio guarda: um caminho errado leria vazio e passaria verde.
        expect(texto.length, 'o arquivo veio vazio: o caminho não resolve').toBeGreaterThan(500);
        expect(texto).not.toMatch(/^\s*import\s/m);
        expect(texto).not.toMatch(/\bfrom\s+['"]/);
    });
});
