// Path: tests/unit/diagnostico-frases.test.js

/**
 * @fileoverview A LÓGICA PURA da aba "Diagnóstico": qual estado desenhar, quanto pesa uma
 * contagem, o que é um instante, e como cada número vira texto.
 *
 * A ABA É TRÊS ROTAS SOBRE UMA JANELA SÓ, e nenhuma delas existe em node. O que se testa aqui é
 * o que decide a tela ANTES de qualquer DOM: `estadoDaSecao`, `listaDoPayload`, `pesoDaContagem`,
 * a ordenação das rotas e as formatações. `diag-tab.js` fica de fora de propósito (é DOM e rede),
 * e é por isso que toda decisão que valia a pena prender saiu de lá para `diag-phrases.js`.
 *
 * ERAM TRÊS ORDENAÇÕES ATÉ 2026-09-02, e duas saíram com as seções que as usavam (erros do
 * servidor e erros do navegador). A herdeira das duas é `ordenarDefeitos`, presa em
 * `defeito-frases.test.js` com o mesmo argumento que estava aqui.
 *
 * OS TRÊS CONTROLES NEGATIVOS desta suíte, isto é, o que ficaria vermelho se o código voltasse ao
 * óbvio:
 *
 *   1. **`estadoDaSecao` com payload malformado.** Trocar `if (!Array.isArray(itens)) return
 *      FALHA` por um `?? []` (que é a forma "tolerante" que a aba Concessões usa, e é natural
 *      copiar dela) faz a seção desenhar "nenhum erro nas últimas 24 horas" para uma resposta que
 *      não tinha lista nenhuma. É a boa notícia mais perigosa do produto: um verde que afirma
 *      saúde justamente quando o instrumento parou de medir. O caso concreto é a rota que ainda
 *      não existe nesta implantação e responde 404 com corpo de erro, ou um proxy devolvendo HTML.
 *      Duas asserções abaixo cobrem isso, e a simétrica (o array NU continua sendo lista) é a que
 *      impede o conserto de virar "recuse tudo".
 *   2. **`pesoDaContagem` linear.** Uma escada por unidade (ou qualquer coisa que devolva o mesmo
 *      degrau para 1 e para 1000) passa verde em qualquer asserção de "devolve uma string", e é
 *      exatamente o defeito que a aba existe para não ter: mil ocorrências de um defeito e uma de
 *      outro com o mesmo peso visual devolvem a escolha para a pessoa sem nenhum dado a mais. A
 *      asserção mede que os quatro degraus são DISTINTOS e que a fronteira de cada um está onde
 *      se diz que está.
 *   3. **`instanteDe('')` como epoch.** `new Date(Number(''))` é `new Date(0)`: sem o teste de
 *      dígitos, um campo vazio vira 01/01/1970 na tela, uma data plausível e falsa em vez de um
 *      travessão. Reverter a guarda deixa a asserção de string vazia vermelha.
 *
 * O FUSO É PASSADO EXPLICITAMENTE nas asserções de hora (`{ timeZone: 'UTC' }`). Sem isso a
 * suíte mediria o fuso da máquina que a roda, o que é uma medição de algo que muda sozinho: verde
 * aqui e vermelho na máquina do lado, sem nada ter mudado no código.
 */

import { describe, it, expect } from 'vitest';
import {
    CONTAGEM,
    ESTADO,
    FAIXAS,
    JANELAS,
    JANELA_PADRAO,
    LATENCIA,
    PESO,
    contagemDetalhe,
    contagemHistoricaDetalhe,
    contagemHistoricaUnidade,
    contagemLabel,
    cortadaNotice,
    estadoDaContagemDeErros,
    estadoDaLatencia,
    estadoDaSecao,
    faixaEstado,
    faixasOrdenadas,
    horaLocal,
    horaLocalCompleta,
    instanteDe,
    intervaloDeOcorrencias,
    janelaEmPalavras,
    janelaValida,
    latenciaLabel,
    leitorCego,
    leitorCegoNotice,
    listaDoPayload,
    mensagemLabel,
    normalizarJanela,
    ordenarRotas,
    paginaLabel,
    pesoDaContagem,
    pulsoEmptyNotice,
    resumirTexto,
    rotaLabel,
    serverErrorsScanNotice,
    slowEmptyNotice,
    taxaDeErro,
    truncamentoNotice,
    usuarioLabel,
} from '../../src/js/admin/diag-phrases.js';

const UTC = { timeZone: 'UTC' };

describe('a janela de tempo', () => {
    it('as três janelas oferecidas cabem no teto de sete dias do servidor', () => {
        // Um seletor que oferecesse "30 dias" desenharia um recorte que a resposta não tem, que é
        // o defeito que o período da Auditoria já pagou uma vez.
        expect(JANELAS.map((j) => j.valor)).toEqual(['1h', '24h', '7d']);
        expect(janelaValida('7d')).toBe(true);
        expect(janelaValida('30d')).toBe(false);
    });

    it('falha FECHADA no padrão: valor estranho consulta 24 horas, nunca algo que o servidor recuse', () => {
        expect(normalizarJanela('30d')).toBe(JANELA_PADRAO);
        expect(normalizarJanela(undefined)).toBe(JANELA_PADRAO);
        expect(normalizarJanela(null)).toBe(JANELA_PADRAO);
        expect(normalizarJanela(7)).toBe(JANELA_PADRAO);
        expect(normalizarJanela('')).toBe(JANELA_PADRAO);
        // E o válido passa intacto, senão a normalização estaria só devolvendo o padrão sempre.
        expect(normalizarJanela('1h')).toBe('1h');
    });

    it('a frase de vazio NOMEIA a janela: "nenhum erro" sem período fala da história inteira', () => {
        // As duas frases de vazio que sobraram nesta camada nomeiam a janela; a da seção de
        // defeitos mora em `defeito-phrases.js` e é cobrada em `defeito-frases.test.js`.
        expect(pulsoEmptyNotice('24h'))
            .toBe('Nenhuma requisição registrada nas últimas 24 horas.');
        expect(pulsoEmptyNotice('1h')).toBe('Nenhuma requisição registrada na última hora.');
        expect(slowEmptyNotice('7d'))
            .toBe('Nenhuma rota com latência medida nos últimos 7 dias.');
        // Janela inválida degrada para a frase do padrão, e não para uma frase sem período.
        expect(janelaEmPalavras('bobagem')).toBe('nas últimas 24 horas');
    });
});

describe('estadoDaSecao — qual das quatro telas desenhar', () => {
    it('carregando vence tudo: uma requisição em voo ainda não sabe se vai falhar', () => {
        expect(estadoDaSecao({ carregando: true, erro: new Error('x'), itens: [] }))
            .toBe(ESTADO.CARREGANDO);
    });

    it('erro explícito é falha, e qualquer valor não nulo conta', () => {
        expect(estadoDaSecao({ erro: new Error('404'), itens: [] })).toBe(ESTADO.FALHA);
        expect(estadoDaSecao({ erro: 'texto solto', itens: [1] })).toBe(ESTADO.FALHA);
    });

    it('CONTROLE NEGATIVO 1: lista ausente é FALHA, nunca "nenhum erro"', () => {
        // Um `?? []` aqui (a forma tolerante da aba Concessões, natural de copiar) faria a seção
        // anunciar saúde para uma resposta que não tinha lista nenhuma. É o verde que afirma
        // "está tudo bem" no instante em que o instrumento parou de medir.
        expect(estadoDaSecao({ itens: null })).toBe(ESTADO.FALHA);
        expect(estadoDaSecao({ itens: undefined })).toBe(ESTADO.FALHA);
        expect(estadoDaSecao({ itens: { grupos: [] } })).toBe(ESTADO.FALHA);
        expect(estadoDaSecao({ itens: 'nada' })).toBe(ESTADO.FALHA);
        // Sem argumento nenhum (chamador que esqueceu de extrair a lista) também falha fechado.
        expect(estadoDaSecao()).toBe(ESTADO.FALHA);
    });

    it('lista vazia é VAZIO, e lista com item é LISTA (a discriminação do controle acima)', () => {
        // Sem estas duas, "devolva FALHA sempre" passaria verde na asserção anterior.
        expect(estadoDaSecao({ itens: [] })).toBe(ESTADO.VAZIO);
        expect(estadoDaSecao({ itens: [{}] })).toBe(ESTADO.LISTA);
    });
});

describe('listaDoPayload — o envelope e o array nu', () => {
    it('lê o campo do envelope', () => {
        expect(listaDoPayload({ grupos: [1, 2] }, 'grupos')).toEqual([1, 2]);
        expect(listaDoPayload({ itens: [] }, 'itens')).toEqual([]);
        expect(listaDoPayload({ rotas: [{ rota: '/a' }] }, 'rotas')).toEqual([{ rota: '/a' }]);
    });

    it('aceita o array NU, pela razão inversa do controle negativo 1', () => {
        // Um servidor que devolva a lista crua tem dado de verdade para mostrar; chamá-lo de falha
        // esconderia erro real. O conserto do payload malformado não pode virar "recuse tudo".
        expect(listaDoPayload([{ assinatura: 'a' }], 'grupos')).toEqual([{ assinatura: 'a' }]);
        expect(listaDoPayload([], 'grupos')).toEqual([]);
    });

    it('devolve null (e não []) quando não há lista: é o que faz o estado distinguir os dois', () => {
        expect(listaDoPayload(null, 'grupos')).toBeNull();
        expect(listaDoPayload({}, 'grupos')).toBeNull();
        expect(listaDoPayload({ grupos: 'x' }, 'grupos')).toBeNull();
        expect(listaDoPayload('<html>', 'grupos')).toBeNull();
        // O campo errado não vale pelo certo: um payload de erros lido como o de rotas é falha.
        expect(listaDoPayload({ grupos: [1] }, 'rotas')).toBeNull();
    });
});

describe('pesoDaContagem — a escada logarítmica', () => {
    it('CONTROLE NEGATIVO 2: os quatro degraus são DISTINTOS, e 1 não pesa como 1000', () => {
        // Uma escada linear, ou qualquer implementação que devolva o mesmo degrau para as duas
        // pontas, passa verde em "devolve uma string" e falha aqui.
        const degraus = [1, 5, 50, 1000].map(pesoDaContagem);
        expect(new Set(degraus).size).toBe(4);
        expect(pesoDaContagem(1)).not.toBe(pesoDaContagem(1000));
    });

    it('as fronteiras estão onde a documentação diz (1 / 2-9 / 10-99 / 100+)', () => {
        expect(pesoDaContagem(1)).toBe(PESO.UNICA);
        expect(pesoDaContagem(2)).toBe(PESO.POUCAS);
        expect(pesoDaContagem(9)).toBe(PESO.POUCAS);
        expect(pesoDaContagem(10)).toBe(PESO.MUITAS);
        expect(pesoDaContagem(99)).toBe(PESO.MUITAS);
        expect(pesoDaContagem(100)).toBe(PESO.MASSA);
        expect(pesoDaContagem(999999)).toBe(PESO.MASSA);
    });

    it('o desconhecido cai no degrau mais BAIXO: alarme sobre número que não chegou treina a ignorar', () => {
        for (const v of [null, undefined, NaN, Infinity, -Infinity, '500', {}, 0, -3]) {
            expect(pesoDaContagem(v)).toBe(PESO.UNICA);
        }
    });
});

describe('contagemLabel / contagemDetalhe', () => {
    it('agrupa milhares e não inventa zero para campo ausente', () => {
        expect(contagemLabel(1234)).toBe('1.234');
        expect(contagemLabel(0)).toBe('0');
        expect(contagemLabel(1234.6)).toBe('1.235');
        for (const v of [null, undefined, NaN, Infinity, -1, '12']) {
            expect(contagemLabel(v)).toBe('—');
        }
    });

    it('o singular e o plural, e a ausência dita em voz alta', () => {
        expect(contagemDetalhe(1)).toBe('1 ocorrência');
        expect(contagemDetalhe(2)).toBe('2 ocorrências');
        expect(contagemDetalhe(0)).toBe('0 ocorrências');
        expect(contagemDetalhe(1500)).toBe('1.500 ocorrências');
        expect(contagemDetalhe(undefined)).toBe('sem contagem');
        expect(contagemDetalhe(NaN)).toBe('sem contagem');
    });
});

describe('instanteDe — as três formas em que uma data chega', () => {
    it('epoch ms, string numérica, ISO e Date', () => {
        expect(instanteDe(1756000000000).getTime()).toBe(1756000000000);
        expect(instanteDe('1756000000000').getTime()).toBe(1756000000000);
        expect(instanteDe('2026-08-30T12:00:00.000Z').toISOString())
            .toBe('2026-08-30T12:00:00.000Z');
        const d = new Date('2026-08-30T12:00:00.000Z');
        expect(instanteDe(d)).toBe(d);
    });

    it('CONTROLE NEGATIVO 3: a string vazia NÃO é a epoch de 1970', () => {
        // `new Date(Number(''))` é `new Date(0)`. Sem o teste de dígitos, um campo vazio vira uma
        // data plausível e errada em vez de um travessão, dentro de um painel de diagnóstico.
        expect(instanteDe('')).toBeNull();
        expect(instanteDe('   ')).toBeNull();
        // A discriminação: o zero LITERAL continua sendo a epoch, porque é um número de verdade.
        expect(instanteDe(0).getTime()).toBe(0);
    });

    it('o que não se resolve vira null, sem lançar', () => {
        for (const v of [null, undefined, NaN, Infinity, 'ontem', {}, [], true, 8.64e15 * 2]) {
            expect(instanteDe(v)).toBeNull();
        }
    });
});

describe('as horas locais', () => {
    it('curta e completa, no fuso passado (a tela usa o de quem lê)', () => {
        const t = Date.UTC(2026, 7, 30, 14, 32, 7);
        expect(horaLocal(t, UTC)).toBe('30/08/2026, 14:32');
        expect(horaLocalCompleta(t, UTC)).toBe('30/08/2026, 14:32:07');
    });

    it('sem instante não há hora, e a string vazia é o sinal de que a tela não desenha o campo', () => {
        expect(horaLocal(null)).toBe('');
        expect(horaLocal('')).toBe('');
        expect(horaLocalCompleta(undefined)).toBe('');
    });

    it('o intervalo distingue ocorrência única de janela, e as duas metades faltam separadas', () => {
        const a = Date.UTC(2026, 7, 28, 9, 0, 0);
        const b = Date.UTC(2026, 7, 30, 14, 32, 7);
        expect(intervaloDeOcorrencias(a, b, UTC))
            .toBe('Da primeira em 28/08/2026, 09:00:00 até a última em 30/08/2026, 14:32:07');
        expect(intervaloDeOcorrencias(b, b, UTC)).toBe('Ocorrência única em 30/08/2026, 14:32:07');
        expect(intervaloDeOcorrencias(null, b, UTC)).toBe('Última ocorrência em 30/08/2026, 14:32:07');
        expect(intervaloDeOcorrencias(a, null, UTC)).toBe('Primeira ocorrência em 28/08/2026, 09:00:00');
        expect(intervaloDeOcorrencias(null, null, UTC)).toBe('');
    });
});

describe('as faixas de status', () => {
    it('as quatro conhecidas aparecem SEMPRE, zeradas inclusive', () => {
        // Uma barra que não é desenhada se lê como dado que não chegou, e "zero 5xx" é justamente
        // a informação que a pessoa veio buscar.
        const saida = faixasOrdenadas({ '2xx': 100 });
        expect(saida.map((f) => f.faixa)).toEqual([...FAIXAS]);
        expect(saida.find((f) => f.faixa === '5xx').total).toBe(0);
        expect(saida.find((f) => f.faixa === '2xx').total).toBe(100);
    });

    it('a faixa desconhecida entra DEPOIS das quatro, e não some', () => {
        const saida = faixasOrdenadas({ '5xx': 3, '1xx': 1, '9xx': 2 });
        expect(saida.map((f) => f.faixa)).toEqual(['2xx', '3xx', '4xx', '5xx', '1xx', '9xx']);
        expect(saida.at(-1).estado).toBe('desconhecida');
    });

    it('mapa ausente devolve lista VAZIA, e não quatro zeros: aí o dado é que não chegou', () => {
        expect(faixasOrdenadas(null)).toEqual([]);
        expect(faixasOrdenadas(undefined)).toEqual([]);
        expect(faixasOrdenadas([])).toEqual([]);
        expect(faixasOrdenadas('2xx')).toEqual([]);
    });

    it('a família não é herdada: um código que este build não conhece não vira verde', () => {
        expect(faixaEstado('2xx')).toBe('ok');
        expect(faixaEstado('3xx')).toBe('redirecionamento');
        expect(faixaEstado('4xx')).toBe('cliente');
        expect(faixaEstado('5xx')).toBe('servidor');
        expect(faixaEstado('1xx')).toBe('desconhecida');
        expect(faixaEstado(undefined)).toBe('desconhecida');
    });

    it('valor de faixa que não é contagem vira zero, e nunca NaN na tela', () => {
        const saida = faixasOrdenadas({ '2xx': 'muitos', '4xx': -5, '5xx': null });
        expect(saida.map((f) => f.total)).toEqual([0, 0, 0, 0]);
    });
});

describe('taxaDeErro', () => {
    it('sem total não há taxa, e a tela não desenha o chip', () => {
        expect(taxaDeErro({ total: 0, erros: 0 })).toBeNull();
        expect(taxaDeErro({ total: null, erros: 3 })).toBeNull();
        expect(taxaDeErro({})).toBeNull();
        expect(taxaDeErro()).toBeNull();
    });

    it('SEM A CONTAGEM DE ERROS também não há taxa: o numerador ausente não vale zero', () => {
        // O chip verde "0%" ao lado do ladrilho que diz "—" eram duas afirmações opostas sobre o
        // mesmo campo, e a verde era a falsa. Voltar a `numeroOuZero(erros)` deixa isto vermelho.
        expect(taxaDeErro({ total: 500 })).toBeNull();
        expect(taxaDeErro({ total: 500, erros: null })).toBeNull();
        expect(taxaDeErro({ total: 500, erros: NaN })).toBeNull();
        expect(taxaDeErro({ total: 500, erros: '0' })).toBeNull();
        // E o zero de VERDADE continua virando o chip verde, que é a informação que a pessoa veio
        // buscar: recusar tudo esconderia a boa notícia junto com a mentira.
        expect(taxaDeErro({ total: 500, erros: 0 })).toBe('0%');
    });

    it('percentual em pt-BR, com o zero exato distinguido do quase zero', () => {
        expect(taxaDeErro({ total: 1000, erros: 0 })).toBe('0%');
        expect(taxaDeErro({ total: 1000, erros: 24 })).toBe('2,4%');
        expect(taxaDeErro({ total: 100, erros: 100 })).toBe('100,0%');
        // ARREDONDAR UM ERRO REAL PARA ZERO É DIZER QUE ELE NÃO HOUVE: um em cem mil vira "<0,1%"
        // e não "0,0%".
        expect(taxaDeErro({ total: 100000, erros: 1 })).toBe('<0,1%');
    });
});

describe('a latência', () => {
    it('a unidade muda no segundo, que é onde a leitura muda', () => {
        expect(latenciaLabel(12)).toBe('12 ms');
        expect(latenciaLabel(999)).toBe('999 ms');
        expect(latenciaLabel(1000)).toBe('1,0 s');
        expect(latenciaLabel(1234)).toBe('1,2 s');
        expect(latenciaLabel(0)).toBe('0 ms');
        expect(latenciaLabel(0.4)).toBe('<1 ms');
    });

    it('o que não é medida vira travessão', () => {
        for (const v of [null, undefined, NaN, Infinity, -1, '30']) {
            expect(latenciaLabel(v)).toBe('—');
        }
    });

    it('os cortes de percepção (300 ms e 1 s), e o p95 ausente que NÃO vira verde', () => {
        expect(estadoDaLatencia(0)).toBe(LATENCIA.OK);
        expect(estadoDaLatencia(299)).toBe(LATENCIA.OK);
        expect(estadoDaLatencia(300)).toBe(LATENCIA.ATENCAO);
        expect(estadoDaLatencia(999)).toBe(LATENCIA.ATENCAO);
        expect(estadoDaLatencia(1000)).toBe(LATENCIA.LENTA);
        // Pintar de verde um valor que ninguém mediu afirmaria saúde.
        expect(estadoDaLatencia(undefined)).toBe(LATENCIA.DESCONHECIDA);
        expect(estadoDaLatencia(NaN)).toBe(LATENCIA.DESCONHECIDA);
        expect(estadoDaLatencia('12')).toBe(LATENCIA.DESCONHECIDA);
    });

    it('QUINTO CONTROLE NEGATIVO: o ladrilho de erros do pulso tem TRÊS estados, não dois', () => {
        // A forma óbvia (e a que estava no código) é o ternário `contagem > 0 ? 'erro' : 'ok'`,
        // que devolve VERDE para o número que não chegou. É o mesmo defeito de pintar um p95
        // ausente de verde, num lugar pior: o ladrilho fica ao lado do travessão que
        // `contagemLabel` desenha, ou seja, a tela diz "não tenho o número" e "está tudo bem" na
        // mesma linha. Voltar ao ternário deixa as três últimas asserções vermelhas.
        expect(estadoDaContagemDeErros(0)).toBe(CONTAGEM.OK);
        expect(estadoDaContagemDeErros(1)).toBe(CONTAGEM.ERRO);
        expect(estadoDaContagemDeErros(9999)).toBe(CONTAGEM.ERRO);
        expect(estadoDaContagemDeErros(undefined)).toBe(CONTAGEM.DESCONHECIDA);
        expect(estadoDaContagemDeErros(null)).toBe(CONTAGEM.DESCONHECIDA);
        expect(estadoDaContagemDeErros(NaN)).toBe(CONTAGEM.DESCONHECIDA);
        expect(estadoDaContagemDeErros('0')).toBe(CONTAGEM.DESCONHECIDA);
        // Negativa acompanha o travessão de `contagemLabel`: cor de fato onde não há fato, não.
        expect(estadoDaContagemDeErros(-3)).toBe(CONTAGEM.DESCONHECIDA);
        expect(contagemLabel(-3)).toBe('—');
    });
});

describe('a ordenação das rotas lentas', () => {
    // ERAM TRÊS ORDENAÇÕES ATÉ 2026-09-02, e duas saíram com as seções que as usavam. A
    // regra que elas carregavam NÃO se perdeu: `ordenarDefeitos` (`defeito-phrases.js`) é a
    // herdeira das duas, e o argumento que a governa é o mesmo que estava aqui, ordenar por
    // um critério e cortar por outro é um pódio sobre amostra escolhida por terceiro.

    it('as rotas vêm por P95, e não por máximo nem por número de chamadas', () => {
        // O `max` é uma chamada só (pode ser um cliente que dormiu) e `n` é volume, não lentidão.
        const entrada = [
            { rota: '/rapida', n: 10000, p50: 5, p95: 20, max: 9000 },
            { rota: '/lenta', n: 3, p50: 900, p95: 1500, max: 1600 },
        ];
        expect(ordenarRotas(entrada).map((r) => r.rota)).toEqual(['/lenta', '/rapida']);
        // NÃO MUTA a entrada: a lista original continua na ordem em que chegou.
        expect(entrada.map((r) => r.rota)).toEqual(['/rapida', '/lenta']);
    });

    it('entrada que não é lista não explode, e linha malformada não derruba a ordem', () => {
        expect(ordenarRotas(null)).toEqual([]);
        expect(ordenarRotas(undefined)).toEqual([]);
        expect(ordenarRotas({})).toEqual([]);
        expect(ordenarRotas([null, { p95: 5 }, undefined]).length).toBe(3);
        expect(ordenarRotas([null, { p95: 5 }, undefined])[0].p95).toBe(5);
    });
});

describe('os rótulos de linha — nada de travessão onde há dado', () => {
    it('resumirTexto corta por LAYOUT, colapsa espaço e não perde o começo', () => {
        expect(resumirTexto('abc')).toBe('abc');
        expect(resumirTexto('  a \n  b  ')).toBe('a b');
        expect(resumirTexto('x'.repeat(200))).toHaveLength(160);
        expect(resumirTexto('x'.repeat(200)).endsWith('…')).toBe(true);
        expect(resumirTexto('abcdef', 4)).toBe('abc…');
        expect(resumirTexto('abcd', 4)).toBe('abcd');
        for (const v of [null, undefined, 42, {}, '']) expect(resumirTexto(v)).toBe('');
        // Máximo inválido não zera o texto (seria pior que não cortar).
        expect(resumirTexto('abc', NaN)).toBe('abc');
    });

    it('a mensagem do navegador cai na assinatura antes de virar "sem mensagem"', () => {
        expect(mensagemLabel({ mensagem: 'Cannot read properties of null' }))
            .toBe('Cannot read properties of null');
        expect(mensagemLabel({ assinatura: 'TypeError' })).toBe('TypeError');
        expect(mensagemLabel({})).toBe('Erro sem mensagem');
    });

    it('"anônimo" NÃO é falta de dado: é o estado normal da metade pública do produto', () => {
        expect(usuarioLabel({ username: 'diniz' })).toBe('diniz');
        expect(usuarioLabel({ username: '  ', userId: 'u-1' })).toBe('u-1');
        expect(usuarioLabel({})).toBe('anônimo');
        expect(usuarioLabel(null)).toBe('anônimo');
    });

    it('a página cai na URL, e só então no travessão', () => {
        expect(paginaLabel({ pagina: 'atlas.html' })).toBe('atlas.html');
        expect(paginaLabel({ url: 'https://x/index.html?a=1' })).toBe('https://x/index.html?a=1');
        expect(paginaLabel({})).toBe('—');
    });

    it('a rota sem nome é dita, e não desenhada como célula vazia', () => {
        expect(rotaLabel({ rota: ' /api/v1/atlas ' })).toBe('/api/v1/atlas');
        expect(rotaLabel({})).toBe('rota sem nome');
    });
});

describe('serverErrorsScanNotice — o vazio ambíguo', () => {
    it('diz o que a varredura leu, para que "nenhum erro" não seja afirmação sobre o leitor', () => {
        expect(serverErrorsScanNotice({ arquivos: 4, linhas: 120000 }))
            .toBe('4 arquivos de log, 120.000 linhas lidas');
        expect(serverErrorsScanNotice({ arquivos: 1, linhas: 1 }))
            .toBe('1 arquivo de log, 1 linha lida');
    });

    it('as duas metades faltam separadas, e sem nenhuma delas não nasce parágrafo', () => {
        expect(serverErrorsScanNotice({ arquivos: 2 })).toBe('2 arquivos de log');
        expect(serverErrorsScanNotice({ linhas: 10 })).toBe('10 linhas lidas');
        expect(serverErrorsScanNotice({})).toBe('');
        expect(serverErrorsScanNotice()).toBe('');
        expect(serverErrorsScanNotice({ arquivos: 'muitos', linhas: NaN })).toBe('');
    });
});

describe('os três avisos que desfazem uma leitura errada da tela', () => {
    it('QUARTO CONTROLE NEGATIVO: o leitor cego não é vazio, e ele responde com SUCESSO', () => {
        // As duas seções que leem arquivo de log respondem 200 com lista vazia quando o diretório
        // não existe. Sem `leitorCego`, a tela desenharia a boa notícia ("nenhum erro nas últimas
        // 24 horas") a partir de um instrumento desligado, que é a cobertura vazia da constituição
        // aplicada a uma tela: o verde não estaria provando nada. A asserção nomeia o campo do
        // servidor porque ele é o único sinal que separa os dois desfechos.
        //
        // ESTA SUÍTE PRENDE A FUNÇÃO, E NÃO O CONSUMIDOR DELA, e enquanto essa era a frase
        // inteira o buraco estava declarado por escrito aqui: tirar a chamada de `diag-tab.js`
        // não deixava nada vermelho. Foi por ele que o defeito entrou, e `_pintarPulso` passou a
        // existência inteira sem chamar `leitorCego` nem as notas de leitura, com
        // `diretorioAusente` e `truncado` chegando no próprio payload dela. Quem cobra a CHAMADA
        // agora é `tests/unit/diagnostico-secoes-de-log.test.js`, que varre `diag-tab.js` e deriva
        // do código a lista de seções, para que a quinta nasça cobrada.
        expect(leitorCego({ diretorioAusente: true, grupos: [] })).toBe(true);
        // A discriminação, senão "devolva true sempre" (que esconderia toda boa notícia) passaria.
        expect(leitorCego({ diretorioAusente: false, grupos: [] })).toBe(false);
        expect(leitorCego({ grupos: [] })).toBe(false);
        expect(leitorCego(null)).toBe(false);
        // E ele não aceita o campo por verdade frouxa: só o booleano do contrato.
        expect(leitorCego({ diretorioAusente: 'sim' })).toBe(false);
        expect(leitorCegoNotice().length).toBeGreaterThan(40);
    });

    it('o truncamento é dito: um pico no começo da janela não pode sumir calado', () => {
        expect(truncamentoNotice({ truncado: true })).toContain('ANTIGOS');
        expect(truncamentoNotice({ truncado: false })).toBe('');
        expect(truncamentoNotice({})).toBe('');
        expect(truncamentoNotice(null)).toBe('');
        expect(truncamentoNotice({ truncado: 1 })).toBe('');
    });

    it('o corte é dito: vinte não pode ser indistinguível de vinte que eram quatrocentos', () => {
        expect(cortadaNotice(20, 400, 'assinaturas')).toBe('Mostrando 20 de 400 assinaturas.');
        expect(cortadaNotice(15, 1500, 'rotas')).toBe('Mostrando 15 de 1.500 rotas.');
        // Lista INTEIRA não ganha frase: um aviso que aparece sempre deixa de ser lido.
        expect(cortadaNotice(20, 20, 'assinaturas')).toBe('');
        expect(cortadaNotice(20, 3, 'assinaturas')).toBe('');
        // Contagem que o servidor não mandou também não vira frase (nem "de undefined").
        expect(cortadaNotice(20, undefined, 'assinaturas')).toBe('');
        expect(cortadaNotice(undefined, 400, 'assinaturas')).toBe('');
        expect(cortadaNotice(20, NaN, 'assinaturas')).toBe('');
    });
});

describe('a contagem de um defeito é VITALÍCIA, e a tela tem de dizer isso', () => {
    // O CONTADOR NÃO ZERA. `defeitos.ocorrencias` é incrementado pelo upsert desde a primeira
    // vez que a assinatura apareceu, e a listagem filtra só `ultima_em`: um defeito de seis meses
    // atrás com doze mil relatos, disparado UMA vez hoje, entra na janela de 24 horas com doze mil
    // e peso visual máximo. A tela chamava isso de "ocorrências" e ordenava por ele.
    //
    // O QUE ESTAS ASSERÇÕES PROVARIAM SE O CÓDIGO ESTIVESSE ERRADO: que a única coluna que existe
    // para decidir o que consertar primeiro está nomeada pelo que ela é (relato acumulado, e não
    // ocorrência do período), e que a nota diz quantas assinaturas distintas a janela teve.

    it('o crachá é nomeado por RELATO, e não por ocorrência da janela', () => {
        expect(contagemHistoricaUnidade()).toBe('relatos no total');
    });

    it('o detalhe DATA as duas pontas, que é o que torna o rótulo honesto barato', () => {
        // "12.000 desde 3 de março, o último hoje" é verdadeiro e útil; "12.000 ocorrências nas
        // últimas 24 horas" é falso. As duas datas já vinham no payload e ninguém as usava aqui.
        const item = {
            ocorrencias: 12000,
            primeiraEm: Date.UTC(2026, 2, 3, 14, 22, 10),
            ultimaEm: Date.UTC(2026, 7, 31, 9, 1, 44),
        };
        expect(contagemHistoricaDetalhe(item, UTC)).toBe(
            '12.000 relatos no total, o primeiro em 03/03/2026, 14:22:10 e o último em '
            + '31/08/2026, 09:01:44.',
        );
    });

    it('uma ponta só, ou nenhuma, ainda diz que o número é acumulado', () => {
        const base = { ocorrencias: 3 };
        const t = Date.UTC(2026, 7, 30, 14, 32, 7);
        // Pontas iguais: a data não se repete, e o "no total" fica, porque três relatos no mesmo
        // segundo continuam sendo três sessões distintas.
        expect(contagemHistoricaDetalhe({ ...base, primeiraEm: t, ultimaEm: t }, UTC))
            .toBe('3 relatos no total, em 30/08/2026, 14:32:07.');
        expect(contagemHistoricaDetalhe({ ...base, ultimaEm: t }, UTC))
            .toBe('3 relatos no total, em 30/08/2026, 14:32:07.');
        expect(contagemHistoricaDetalhe({ ...base, primeiraEm: t }, UTC))
            .toBe('3 relatos no total, desde 30/08/2026, 14:32:07.');
        expect(contagemHistoricaDetalhe(base, UTC))
            .toBe('3 relatos no total, desde a primeira vez que esta assinatura apareceu.');
        expect(contagemHistoricaDetalhe({ ocorrencias: 1 }, UTC))
            .toBe('1 relato no total, desde a primeira vez que esta assinatura apareceu.');
    });

    it('sem contagem não se inventa número, como em `contagemDetalhe`', () => {
        expect(contagemHistoricaDetalhe({}, UTC)).toBe('sem contagem');
        expect(contagemHistoricaDetalhe(null, UTC)).toBe('sem contagem');
        expect(contagemHistoricaDetalhe({ ocorrencias: NaN }, UTC)).toBe('sem contagem');
        expect(contagemHistoricaDetalhe({ ocorrencias: -2 }, UTC)).toBe('sem contagem');
    });
});
