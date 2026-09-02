// Path: tests/unit/uso-frases.test.js

/**
 * @fileoverview A LÓGICA PURA da aba "Uso": qual estado desenhar, a qual REGIME cada número
 * pertence, até onde o dado alcança, e a geometria do gráfico diário.
 *
 * A ABA É UMA ROTA SÓ, e nada dela existe em node. O que se testa aqui é o que decide a tela ANTES
 * de qualquer DOM, e é por isso que toda decisão que valia a pena prender saiu de `uso-tab.js`
 * para `uso-phrases.js`: o arquivo da aba é DOM e rede, e fica de fora de propósito.
 *
 * OS QUATRO CONTROLES NEGATIVOS desta suíte, isto é, o que ficaria vermelho se o código voltasse
 * ao óbvio. Os quatro foram RODADOS (reverter a peça, ver o vermelho, restaurar), e não só
 * escritos:
 *
 *   1. **O REGIME COMO PROSA, e não como campo.** Marcar `contasAtivas` ou `atlas.vivos` como
 *      `PERIODO` (que é o que acontece sozinho quando alguém escreve a legenda à mão em oito
 *      ladrilhos, ou copia uma linha da tabela para fazer a próxima) põe a legenda "nos últimos 30
 *      dias" sob um ESTOQUE. O número fica certo e a tela mente: "42 contas ativas nos últimos 30
 *      dias" lê como crescimento e é o total do sistema. É o erro que o enunciado desta aba chama
 *      de mais fácil de cometer e mais difícil de notar, e ele não tem sintoma nenhum — nenhuma
 *      tela quebra, nenhum número muda. A asserção que o pega é estrutural: os DOIS estoques são
 *      nomeados um a um, e TODO o resto é cobrado como `PERIODO`, nos dois sentidos.
 *   2. **`estadoDaTela` tolerante com payload malformado.** Trocar `if (!objeto(dados)) return
 *      FALHA` por um `dados ?? {}` faz a aba desenhar "nenhum uso registrado ainda: não há atlas,
 *      ninguém entrou e nada foi produzido" para uma rota que respondeu 404 com corpo de erro — que
 *      é exatamente o estado desta rota enquanto ela não existe. É a mesma classe que a aba
 *      Diagnóstico paga: um "nada aconteceu" desenhado sobre um instrumento desligado.
 *   3. **O horizonte colapsando `null` e `undefined`.** Um `alcance != null` no lugar dos dois
 *      ramos faz um servidor que não respondeu o campo ser lido como "não há dado nenhum", e a tela
 *      anuncia uma poda que não houve; e um `estadoDoHorizonte` que devolvesse sempre `COBRE`
 *      deixaria a aba MUDA sobre o histórico apagado, que é o defeito que o aviso existe para
 *      impedir. Os dois sentidos têm asserção.
 *   4. **`geometriaDaSerie` sem o piso de altura.** Um dia com uma operação ao lado de um dia com
 *      dez mil arredonda para zero e desenha idêntico ao dia PARADO: a barra passa a afirmar
 *      "nada aconteceu" sobre um dia em que aconteceu. A asserção mede o piso e, junto, a
 *      distinção que ele existe para preservar (`zero` verdadeiro só onde o total é zero).
 *
 * O FUSO É PASSADO EXPLICITAMENTE onde há `Intl` (`{ timeZone: 'UTC' }`). Sem isso a suíte mediria
 * o fuso da máquina que a roda, que é uma medição de algo que muda sozinho. Os rótulos de DIA são
 * montados à mão justamente para não terem fuso nenhum, e há asserção de que eles não deslizam.
 */

import { describe, it, expect } from 'vitest';
import {
    CELULA_ABERTA,
    COLUNAS_DE_RETENCAO,
    ESTADO,
    FONTE_DO_PISO_DO_FUNIL,
    HORIZONTE,
    JANELAS,
    JANELA_PADRAO,
    LIMITE_TOP,
    MAX_DIAS_DA_SERIE,
    METRICAS_DE_ATLAS,
    METRICAS_DE_PESSOAS,
    PASSOS_DO_FUNIL,
    PISO_DA_BARRA_PCT,
    REGIME,
    atlasNomeLabel,
    avisosDeHorizonte,
    dadosDoPayload,
    dataLocal,
    diaSeguinte,
    diaValido,
    diasDaJanela,
    diasEntre,
    donoLabel,
    entidadeLabel,
    estadoDaFonte,
    estadoDaTela,
    estadoDoHorizonte,
    funilEscopoHint,
    funilHint,
    funilInformado,
    funilNaoInformadoNotice,
    funilPassos,
    funilPisoNotice,
    funilSubtitulo,
    funilTemPiso,
    funilTitulo,
    funilVazioHint,
    funilVazioNotice,
    geometriaDaSerie,
    horizonteCompromete,
    instalacaoSemUso,
    instanteDe,
    janelaEmPalavras,
    janelaValida,
    larguraDaBarra,
    lerMetricas,
    linhasDeRetencao,
    mediaLabel,
    medianaLabel,
    metricaDetalhe,
    normalizarJanela,
    numeroLabel,
    ordenarTopAtlas,
    partesDoDia,
    percentualLabel,
    periodoParadoNotice,
    periodoSemMovimento,
    preencherDias,
    producaoPorEntidade,
    producaoVaziaNotice,
    regimeLabel,
    resumoDaSerie,
    resumoDaSerieLabel,
    retencaoColunaCoorte,
    retencaoColunaTamanho,
    retencaoHint,
    retencaoInformada,
    retencaoNaoInformadaNotice,
    retencaoSubtitulo,
    retencaoTitulo,
    retencaoVaziaHint,
    retencaoVaziaNotice,
    rotuloCurtoDeDia,
    rotuloDeCoorte,
    rotuloDeJanela,
    rotuloLongoDeDia,
    tituloDeBarra,
    topVazioNotice,
} from '../../src/js/admin/uso-phrases.js';

const UTC = { timeZone: 'UTC' };

/** Um payload mínimo mas RECONHECÍVEL, para que os testes de estado meçam o conteúdo. */
function dadosDe({ pessoas = {}, atlas = {}, producao = {}, ...resto } = {}) {
    return { pessoas, atlas, producao, ...resto };
}

describe('o período', () => {
    it('as três janelas são 7, 30 e 90 dias, e o padrão é o mês', () => {
        expect(JANELAS.map((j) => j.valor)).toEqual(['7d', '30d', '90d']);
        expect(JANELA_PADRAO).toBe('30d');
        expect(diasDaJanela('7d')).toBe(7);
        expect(diasDaJanela('90d')).toBe(90);
    });

    it('falha FECHADA no padrão: valor estranho consulta 30 dias', () => {
        expect(normalizarJanela('365d')).toBe(JANELA_PADRAO);
        expect(normalizarJanela(undefined)).toBe(JANELA_PADRAO);
        expect(normalizarJanela(null)).toBe(JANELA_PADRAO);
        expect(normalizarJanela('')).toBe(JANELA_PADRAO);
        expect(normalizarJanela(30)).toBe(JANELA_PADRAO);
        // E o válido passa intacto, senão a normalização só devolveria o padrão sempre.
        expect(normalizarJanela('90d')).toBe('90d');
        expect(janelaValida('90d')).toBe(true);
        expect(janelaValida('365d')).toBe(false);
    });

    it('a frase NOMEIA o período, e a janela inválida degrada para a do padrão', () => {
        expect(janelaEmPalavras('7d')).toBe('nos últimos 7 dias');
        expect(janelaEmPalavras('bobagem')).toBe('nos últimos 30 dias');
        expect(rotuloDeJanela('90d')).toBe('Últimos 90 dias');
        expect(topVazioNotice('7d')).toBe('Nenhum atlas recebeu edição nos últimos 7 dias.');
        expect(producaoVaziaNotice('90d'))
            .toBe('Nenhuma operação registrada nos últimos 90 dias.');
        expect(periodoParadoNotice('7d')).toContain('nos últimos 7 dias');
    });
});

describe('os números', () => {
    it('zero é "0" e o ausente é travessão: o zero inventado afirma que nada aconteceu', () => {
        expect(numeroLabel(0)).toBe('0');
        expect(numeroLabel(7)).toBe('7');
        expect(numeroLabel(1234567)).toBe('1.234.567');
        expect(numeroLabel(undefined)).toBe('—');
        expect(numeroLabel(null)).toBe('—');
        expect(numeroLabel(NaN)).toBe('—');
        expect(numeroLabel(Infinity)).toBe('—');
        // NEGATIVO também é travessão: contagem negativa é defeito do outro lado, e desenhá-la
        // repassaria o defeito como se fosse medida.
        expect(numeroLabel(-3)).toBe('—');
        // String numérica NÃO é número: aceitar '12' aqui aceitaria '12abc' na próxima refatoração.
        expect(numeroLabel('12')).toBe('—');
    });

    it('a média tem uma casa, e o ausente continua travessão', () => {
        expect(mediaLabel(12.34)).toBe('12,3');
        expect(mediaLabel(12)).toBe('12');
        expect(mediaLabel(0)).toBe('0');
        expect(mediaLabel(null)).toBe('—');
        expect(mediaLabel(NaN)).toBe('—');
    });

    it('o percentual não arredonda produção real para zero', () => {
        expect(percentualLabel(50, 100)).toBe('50,0%');
        expect(percentualLabel(0, 100)).toBe('0%');
        // Uma operação em um milhão é 0,0001%: "0,0%" diria que ela não houve.
        expect(percentualLabel(1, 1000000)).toBe('<0,1%');
        expect(percentualLabel(100, 100)).toBe('100,0%');
        // Sem total não há fração, e a tela não desenha nada.
        expect(percentualLabel(5, 0)).toBeNull();
        expect(percentualLabel(5, null)).toBeNull();
        expect(percentualLabel(5, -10)).toBeNull();
        expect(percentualLabel(undefined, 100)).toBe('0%');
    });
});

describe('instantes e dias', () => {
    it('a string vazia NÃO é a epoch: 1970 é uma data plausível e falsa', () => {
        expect(instanteDe('')).toBeNull();
        expect(instanteDe('   ')).toBeNull();
        expect(instanteDe(null)).toBeNull();
        expect(instanteDe(undefined)).toBeNull();
        expect(instanteDe(NaN)).toBeNull();
        expect(instanteDe('sem data')).toBeNull();
        // E as três formas legítimas resolvem.
        expect(instanteDe(0)?.getTime()).toBe(0);
        expect(instanteDe('1756512000000')?.getTime()).toBe(1756512000000);
        expect(instanteDe('2026-08-30T00:00:00.000Z')?.getTime())
            .toBe(Date.UTC(2026, 7, 30));
    });

    it('a data de um instante é local, e o teste fixa o fuso para não medir a máquina', () => {
        expect(dataLocal(Date.UTC(2026, 7, 30, 12), UTC)).toBe('30/08/2026');
        expect(dataLocal(null, UTC)).toBe('');
        expect(dataLocal('', UTC)).toBe('');
    });

    it('o dia é validado por IDA E VOLTA: 30 de fevereiro passa em qualquer teste de faixa', () => {
        expect(diaValido('2026-02-30')).toBe(false);
        expect(diaValido('2026-13-01')).toBe(false);
        expect(diaValido('2024-02-29')).toBe(true);
        expect(diaValido('2026-02-29')).toBe(false);
        expect(diaValido('2026-8-3')).toBe(false);
        expect(diaValido('30/08/2026')).toBe(false);
        expect(diaValido(20260830)).toBe(false);
        expect(diaValido(null)).toBe(false);
        expect(diaValido(' 2026-08-30 ')).toBe(true);
        expect(partesDoDia('2026-08-30')).toMatchObject({ ano: 2026, mes: 8, diaDoMes: 30 });
    });

    it('o rótulo de dia é montado à mão e NÃO desliza um dia por fuso', () => {
        // Passar o dia por uma `Date` faria "2026-08-30" virar 29/08 a oeste de Greenwich: um erro
        // de um dia é o tamanho exato de erro que ninguém percebe num gráfico de noventa barras.
        expect(rotuloCurtoDeDia('2026-08-30')).toBe('30/08');
        expect(rotuloLongoDeDia('2026-08-30')).toBe('30/08/2026');
        expect(rotuloCurtoDeDia('2026-01-01')).toBe('01/01');
        expect(rotuloLongoDeDia('2026-12-31')).toBe('31/12/2026');
        expect(rotuloCurtoDeDia('lixo')).toBe('');
        expect(rotuloLongoDeDia(null)).toBe('');
    });

    it('o dia seguinte atravessa mês, ano bissexto e virada de ano', () => {
        expect(diaSeguinte('2026-08-30')).toBe('2026-08-31');
        expect(diaSeguinte('2026-08-31')).toBe('2026-09-01');
        expect(diaSeguinte('2024-02-28')).toBe('2024-02-29');
        expect(diaSeguinte('2024-02-29')).toBe('2024-03-01');
        expect(diaSeguinte('2026-02-28')).toBe('2026-03-01');
        expect(diaSeguinte('2025-12-31')).toBe('2026-01-01');
        expect(diaSeguinte('nada')).toBe('');
    });

    it('a distância em dias recusa a ordem invertida em vez de devolver negativo', () => {
        const base = Date.UTC(2026, 7, 30);
        expect(diasEntre(base, base + 86400000 * 3)).toBe(3);
        expect(diasEntre(base, base)).toBe(1);
        expect(diasEntre(base + 86400000, base)).toBeNull();
        expect(diasEntre(null, base)).toBeNull();
        expect(diasEntre(base, 'lixo')).toBeNull();
        // Meio dia conta como dia começado, senão a frase do horizonte diria "0 dos 30 pedidos".
        expect(diasEntre(base, base + 43200000)).toBe(1);
    });
});

describe('o horizonte — até onde o dado alcança', () => {
    const DESDE = Date.UTC(2026, 7, 1);

    it('undefined e null são estados DIFERENTES, e colapsá-los erra nos dois sentidos', () => {
        // CONTROLE NEGATIVO 3. `undefined` é servidor que não respondeu o campo; `null` é o
        // contrato afirmando que não há dado nenhum. Um `!= null` faz o primeiro anunciar uma poda
        // que não houve.
        expect(estadoDoHorizonte({ desde: DESDE, alcance: undefined }))
            .toBe(HORIZONTE.DESCONHECIDO);
        expect(estadoDoHorizonte({ desde: DESDE, alcance: null })).toBe(HORIZONTE.VAZIO);
    });

    it('o dado que começa DEPOIS do pedido encurta a tela, e o que começa antes a cobre', () => {
        expect(estadoDoHorizonte({ desde: DESDE, alcance: DESDE - 86400000 }))
            .toBe(HORIZONTE.COBRE);
        // O empate cobre: o dado começa exatamente onde o pedido começa.
        expect(estadoDoHorizonte({ desde: DESDE, alcance: DESDE })).toBe(HORIZONTE.COBRE);
        // SEM TOLERÂNCIA: um milissegundo depois já é trecho mais curto que o pedido.
        expect(estadoDoHorizonte({ desde: DESDE, alcance: DESDE + 1 }))
            .toBe(HORIZONTE.ENCURTADO);
        expect(estadoDoHorizonte({ desde: DESDE, alcance: DESDE + 86400000 * 12 }))
            .toBe(HORIZONTE.ENCURTADO);
    });

    it('sem saber o que foi pedido não dá para afirmar que o pedido foi atendido', () => {
        expect(estadoDoHorizonte({ desde: undefined, alcance: DESDE })).toBe(HORIZONTE.DESCONHECIDO);
        expect(estadoDoHorizonte({ desde: 'lixo', alcance: DESDE })).toBe(HORIZONTE.DESCONHECIDO);
        expect(estadoDoHorizonte({ desde: DESDE, alcance: 'lixo' })).toBe(HORIZONTE.DESCONHECIDO);
        expect(estadoDoHorizonte()).toBe(HORIZONTE.DESCONHECIDO);
    });

    it('a janela INTEIRA antes do horizonte avisa, e a frase diz desde quando o dado alcança', () => {
        const alcance = Date.UTC(2026, 7, 20);
        const agora = Date.UTC(2026, 7, 30);
        const avisos = avisosDeHorizonte({
            desde: DESDE,
            horizonte: { operacoesDesde: alcance, trilhaDesde: DESDE - 1000 },
            janela: '30d',
            agora,
            timeZone: 'UTC',
        });
        expect(avisos).toHaveLength(1);
        expect(avisos[0].chave).toBe('operacoesDesde');
        expect(avisos[0].estado).toBe(HORIZONTE.ENCURTADO);
        // A frase LOCALIZA o estrago (quais números ficaram curtos) e diz desde quando o dado
        // alcança. Um aviso que não localiza ensina a desconfiar de tudo, que é o mesmo que não
        // desconfiar de nada.
        expect(avisos[0].texto).toContain('20/08/2026');
        expect(avisos[0].texto).toContain('nos últimos 30 dias');
        expect(avisos[0].texto).toContain('10 dos 30 dias pedidos');
        // O ALCANCE DE CADA FONTE FOI CONFERIDO CONTRA AS CONSULTAS do backend
        // (`backend/src/modules/uso/uso.queries.js`), e não deduzido do nome dela, que é onde a
        // dedução erra: `operations` limita TAMBÉM "Produziram" e "Com edição", e a "trilha de
        // auditoria" NÃO limita as contas novas nem os atlas criados, embora o nome sugira.
        expect(avisos[0].texto).toContain('gráfico diário, quebra por tipo e atlas mais ativos');
        // Os nomes entram um a um, e não como uma frase inteira: a lista cresceu quando o funil
        // de entrada nasceu, e uma asserção sobre o texto costurado reprovaria por causa da
        // vírgula, sem dizer nada sobre a propriedade que interessa.
        expect(avisos[0].texto).toContain('"Produziram"');
        expect(avisos[0].texto).toContain('"Com edição"');
        expect(avisos[0].texto).toContain('funil de entrada');
        // E ela NÃO AFIRMA CAUSA: uma instalação de dez dias e uma podada ontem produzem o mesmo
        // horizonte, e este módulo não tem como distingui-las.
        expect(avisos[0].texto).not.toMatch(/\bpodad/i);
        expect(avisos[0].texto).toContain('histórico que não existe mais, e não uso menor');
    });

    it('as DUAS fontes são independentes: uma podada não cala a outra', () => {
        // A guarda compartilhada é o defeito que a família `origins`/`expirations` do catálogo já
        // pagou: um `continue` só fazia um payload com metade dos campos perder a outra metade.
        const avisos = avisosDeHorizonte({
            desde: DESDE,
            horizonte: { operacoesDesde: DESDE + 86400000 },
            janela: '30d',
            agora: Date.UTC(2026, 7, 30),
        });
        expect(avisos.map((a) => a.chave)).toEqual(['operacoesDesde', 'trilhaDesde']);
        expect(avisos[0].estado).toBe(HORIZONTE.ENCURTADO);
        // O campo AUSENTE cai em desconhecido, e não em silêncio.
        expect(avisos[1].estado).toBe(HORIZONTE.DESCONHECIDO);
        expect(avisos[1].texto).toContain('a trilha de auditoria');
        // E os alcances NÃO SE REPETEM: duas fontes com a mesma frase seriam um aviso que não
        // localiza nada, que é o mesmo que não avisar.
        expect(avisos[0].texto).not.toBe(avisos[1].texto);
    });

    it('o horizonte que COBRE não desenha nada, e é o que impede o aviso de virar ruído', () => {
        // Sem esta asserção, um `avisosDeHorizonte` que devolvesse sempre as duas frases passaria
        // verde em todas as asserções acima.
        expect(avisosDeHorizonte({
            desde: DESDE,
            horizonte: { operacoesDesde: DESDE - 1, trilhaDesde: DESDE - 1 },
            janela: '30d',
        })).toEqual([]);
    });

    it('o bloco horizonte ausente vira DUAS notas de voz baixa, e não silêncio', () => {
        const avisos = avisosDeHorizonte({ desde: DESDE, janela: '30d' });
        expect(avisos).toHaveLength(2);
        for (const a of avisos) {
            expect(a.estado).toBe(HORIZONTE.DESCONHECIDO);
            expect(a.texto).toContain('não informou');
        }
        // Desconhecido NÃO compromete: servidor de versão anterior não é incidente, e alarmar a
        // cada carga ensina a ignorar o alarme.
        expect(horizonteCompromete(avisos)).toBe(false);
    });

    it('a fonte VAZIA diz que o zero abaixo não é falta de uso', () => {
        const avisos = avisosDeHorizonte({
            desde: DESDE,
            horizonte: { operacoesDesde: null, trilhaDesde: null },
            janela: '30d',
        });
        expect(avisos).toHaveLength(2);
        expect(avisos[0].estado).toBe(HORIZONTE.VAZIO);
        expect(avisos[0].texto).toContain('apagado por inteiro');
        expect(avisos[0].texto).toContain('não por falta de uso');
        expect(horizonteCompromete(avisos)).toBe(true);
    });

    it('horizonteCompromete separa o incidente da nota, e recusa o que não é lista', () => {
        expect(horizonteCompromete([{ estado: HORIZONTE.ENCURTADO }])).toBe(true);
        expect(horizonteCompromete([{ estado: HORIZONTE.DESCONHECIDO }])).toBe(false);
        expect(horizonteCompromete([])).toBe(false);
        expect(horizonteCompromete(null)).toBe(false);
        expect(horizonteCompromete('encurtado')).toBe(false);
    });
});

describe('o payload e o estado da tela', () => {
    it('o envelope e o objeto nu são aceitos, e o que não é esta resposta devolve null', () => {
        const dados = dadosDe({ producao: { total: 3 } });
        expect(dadosDoPayload(dados)).toBe(dados);
        expect(dadosDoPayload({ data: dados })).toBe(dados);
        // O PISO DE RECONHECIMENTO é ter ao menos um dos três blocos.
        expect(dadosDoPayload({ producao: { total: 1 } })).not.toBeNull();
        expect(dadosDoPayload({ error: { code: 'NOT_FOUND' } })).toBeNull();
        expect(dadosDoPayload({})).toBeNull();
        expect(dadosDoPayload([])).toBeNull();
        expect(dadosDoPayload('<!doctype html>')).toBeNull();
        expect(dadosDoPayload(null)).toBeNull();
        // Bloco que veio como ARRAY não é bloco: `pessoas: []` não reconhece a resposta.
        expect(dadosDoPayload({ pessoas: [], atlas: [], producao: [] })).toBeNull();
    });

    it('carregando vence tudo, e o erro explícito é falha', () => {
        expect(estadoDaTela({ carregando: true, erro: new Error('x'), dados: dadosDe() }))
            .toBe(ESTADO.CARREGANDO);
        expect(estadoDaTela({ erro: new Error('404'), dados: dadosDe() })).toBe(ESTADO.FALHA);
        // Qualquer valor não nulo conta como erro (um `ApiError`, um `Error` de rede, uma string).
        expect(estadoDaTela({ erro: 'quebrou' })).toBe(ESTADO.FALHA);
    });

    it('payload irreconhecível é FALHA, e NUNCA "instalação nova sem uso"', () => {
        // CONTROLE NEGATIVO 2. Um `dados ?? {}` aqui desenharia a boa notícia mais perigosa do
        // produto: "nenhum uso registrado ainda" sobre uma rota que respondeu 404 com corpo de
        // erro, que é exatamente o estado desta rota numa implantação onde ela não existe.
        expect(estadoDaTela({ dados: null })).toBe(ESTADO.FALHA);
        expect(estadoDaTela({ dados: undefined })).toBe(ESTADO.FALHA);
        expect(estadoDaTela({ dados: [] })).toBe(ESTADO.FALHA);
        expect(estadoDaTela({ dados: 'texto' })).toBe(ESTADO.FALHA);
        expect(estadoDaTela()).toBe(ESTADO.FALHA);
        // A simétrica, que impede o conserto de virar "recuse tudo".
        expect(estadoDaTela({ dados: dadosDe({ atlas: { vivos: 4 } }) })).toBe(ESTADO.DADOS);
    });

    it('instalação nova é tela vazia; período parado NÃO é, e a distinção é a decisão', () => {
        const nova = dadosDe({
            pessoas: { contasAtivas: 1, novasContas: 0, entraram: 0, editaram: 0 },
            atlas: { vivos: 0, criados: 0, excluidos: 0, comEdicao: 0 },
            producao: { total: 0, porEntidade: [], porDia: [] },
        });
        // A conta de quem está lendo esta tela existe, e é por isso que `contasAtivas` NÃO entra
        // no teste de instalação nova: exigir zero contas faria o estado nunca acontecer.
        expect(instalacaoSemUso(nova)).toBe(true);
        expect(estadoDaTela({ dados: nova })).toBe(ESTADO.VAZIO);

        const parada = dadosDe({
            pessoas: { contasAtivas: 42, novasContas: 0, entraram: 0, editaram: 0 },
            atlas: { vivos: 17, criados: 0, excluidos: 0, comEdicao: 0 },
            producao: { total: 0, porEntidade: [], porDia: [] },
        });
        // Um acervo de 17 atlas e 42 contas numa semana quieta NÃO pode desenhar "não há atlas":
        // os estoques de hoje continuam sendo fato, e são eles que dizem que o silêncio é de uma
        // janela e não do produto.
        expect(instalacaoSemUso(parada)).toBe(false);
        expect(estadoDaTela({ dados: parada })).toBe(ESTADO.DADOS);
        expect(periodoSemMovimento(parada)).toBe(true);
        expect(periodoSemMovimento(nova)).toBe(true);
    });

    it('um único sinal de vida tira o período do estado parado', () => {
        // A discriminação: sem ela, um `periodoSemMovimento` que devolvesse `true` sempre passaria
        // verde nas asserções acima.
        const base = {
            pessoas: { contasAtivas: 5, novasContas: 0, entraram: 0, editaram: 0 },
            atlas: { vivos: 3, criados: 0, excluidos: 0, comEdicao: 0 },
            producao: { total: 0, porEntidade: [], porDia: [] },
        };
        expect(periodoSemMovimento(dadosDe(base))).toBe(true);
        expect(periodoSemMovimento(dadosDe({
            ...base, producao: { ...base.producao, total: 1 },
        }))).toBe(false);
        expect(periodoSemMovimento(dadosDe({
            ...base, pessoas: { ...base.pessoas, entraram: 1 },
        }))).toBe(false);
        expect(periodoSemMovimento(dadosDe({
            ...base, atlas: { ...base.atlas, excluidos: 1 },
        }))).toBe(false);
        expect(periodoSemMovimento(null)).toBe(false);
    });
});

describe('o regime de cada número — o que a tela não pode rotular errado', () => {
    const TODAS = [...METRICAS_DE_PESSOAS, ...METRICAS_DE_ATLAS];

    it('toda métrica declara chave, rótulo, regime e detalhe', () => {
        expect(TODAS.length).toBeGreaterThanOrEqual(8);
        for (const m of TODAS) {
            expect(typeof m.chave, JSON.stringify(m)).toBe('string');
            expect(m.chave.length).toBeGreaterThan(0);
            expect(m.rotulo.length).toBeGreaterThan(0);
            expect([REGIME.HOJE, REGIME.PERIODO], m.chave).toContain(m.regime);
            expect(m.detalhe.length, m.chave).toBeGreaterThan(0);
        }
    });

    it('SÓ contasAtivas e vivos são de HOJE: todo o resto é do período', () => {
        // CONTROLE NEGATIVO 1, e ele é o coração desta aba. Marcar um estoque como `PERIODO` (ou o
        // contrário) põe a legenda errada sob um número certo, e nada quebra: "42 contas ativas nos
        // últimos 30 dias" lê como crescimento e é o total do sistema. As duas listas abaixo são
        // asserção ABSOLUTA nos dois sentidos, porque uma asserção só de presença passaria verde
        // com tudo marcado igual.
        const hoje = TODAS.filter((m) => m.regime === REGIME.HOJE).map((m) => m.chave);
        const periodo = TODAS.filter((m) => m.regime === REGIME.PERIODO).map((m) => m.chave);
        expect(hoje).toEqual(['contasAtivas', 'vivos']);
        expect(periodo)
            .toEqual(['novasContas', 'entraram', 'editaram', 'criados', 'excluidos', 'comEdicao']);
    });

    it('o regime vira palavra, e o de HOJE nunca herda a frase do período', () => {
        expect(regimeLabel(REGIME.HOJE, '90d')).toBe('hoje');
        expect(regimeLabel(REGIME.PERIODO, '90d')).toBe('nos últimos 90 dias');
        // Regime desconhecido cai no período, que é o regime da maioria; o guarda contra o erro é
        // a asserção absoluta acima, não este ramo.
        expect(regimeLabel(undefined, '7d')).toBe('nos últimos 7 dias');
    });

    it('o detalhe do estoque NÃO ganha o complemento de período', () => {
        const contas = METRICAS_DE_PESSOAS.find((m) => m.chave === 'contasAtivas');
        const entraram = METRICAS_DE_PESSOAS.find((m) => m.chave === 'entraram');
        expect(metricaDetalhe(contas, '30d')).toBe('contas ativas neste momento');
        expect(metricaDetalhe(contas, '30d')).not.toContain('últimos');
        expect(metricaDetalhe(entraram, '30d'))
            .toBe('pessoas distintas que fizeram login nos últimos 30 dias');
        expect(metricaDetalhe({}, '30d')).toBe('');
        expect(metricaDetalhe(null, '30d')).toBe('');
    });

    it('lerMetricas devolve o valor formatado e o regime já em palavras', () => {
        const lidas = lerMetricas(
            { contasAtivas: 1234, novasContas: 0 }, METRICAS_DE_PESSOAS, '7d',
        );
        expect(lidas.map((m) => m.chave))
            .toEqual(['contasAtivas', 'novasContas', 'entraram', 'editaram']);
        expect(lidas[0].texto).toBe('1.234');
        expect(lidas[0].regimeTexto).toBe('hoje');
        // Zero é "0", e o campo que não veio é travessão: no painel de uso o zero inventado é a
        // afirmação "não aconteceu nada".
        expect(lidas[1].texto).toBe('0');
        expect(lidas[2].texto).toBe('—');
        expect(lidas[2].regimeTexto).toBe('nos últimos 7 dias');
    });

    it('bloco ausente não quebra a leitura: quatro ladrilhos de travessão', () => {
        const lidas = lerMetricas(undefined, METRICAS_DE_ATLAS, '30d');
        expect(lidas).toHaveLength(4);
        expect(lidas.every((m) => m.texto === '—')).toBe(true);
        expect(lerMetricas({}, null, '30d')).toEqual([]);
    });
});

describe('a produção por tipo de entidade', () => {
    it('o tipo conhecido vira pt-BR e o DESCONHECIDO sobrevive com a chave crua', () => {
        expect(entidadeLabel('feature')).toBe('Feições');
        expect(entidadeLabel('map')).toBe('Mapas');
        expect(entidadeLabel('comment')).toBe('Comentários');
        expect(entidadeLabel('marker360')).toBe('Marcadores 360');
        // Um tipo que este build não conhece tem produção de verdade por trás: trocá-lo por
        // "Outros" o fundiria com os demais desconhecidos numa linha que não localiza nada.
        expect(entidadeLabel('tipoQueNaoExisteAinda')).toBe('tipoQueNaoExisteAinda');
        expect(entidadeLabel('')).toBe('Sem tipo');
        expect(entidadeLabel('   ')).toBe('Sem tipo');
        expect(entidadeLabel(null)).toBe('Sem tipo');
        expect(entidadeLabel(42)).toBe('Sem tipo');
    });

    it('ordena por total, desempata pelo rótulo e calcula a fatia sobre a SOMA da lista', () => {
        const linhas = producaoPorEntidade([
            { entidade: 'map', total: 10 },
            { entidade: 'feature', total: 70 },
            { entidade: 'layer', total: 10 },
            { entidade: 'comment', total: 10 },
        ]);
        expect(linhas.map((l) => l.entidade)).toEqual(['feature', 'layer', 'comment', 'map']);
        // Camadas < Comentários < Mapas em pt-BR: o desempate é pelo RÓTULO, que é o que se lê, e
        // não pela chave crua ('comment' < 'layer' < 'map' daria outra ordem).
        expect(linhas[0].rotulo).toBe('Feições');
        expect(linhas[0].fatia).toBe('70,0%');
        expect(linhas[1].fatia).toBe('10,0%');
    });

    it('a fatia é da lista e não de um total externo, e o lixo cai fora', () => {
        const linhas = producaoPorEntidade([
            { entidade: 'feature', total: 3 },
            null,
            'lixo',
            { entidade: 'map' },
            { entidade: 'layer', total: -5 },
        ]);
        expect(linhas.map((l) => l.entidade)).toEqual(['feature', 'layer', 'map']);
        // Total ausente e total negativo viram zero na barra, e não somem da lista: o tipo existe.
        expect(linhas[1].total).toBe(0);
        expect(linhas[0].fatia).toBe('100,0%');
        expect(producaoPorEntidade([])).toEqual([]);
        expect(producaoPorEntidade(null)).toEqual([]);
        expect(producaoPorEntidade('lixo')).toEqual([]);
    });

    it('a barra do tipo é proporcional ao MAIOR, com piso para o que tem produção', () => {
        expect(larguraDaBarra(100, 100)).toBe(100);
        expect(larguraDaBarra(50, 100)).toBe(50);
        expect(larguraDaBarra(0, 100)).toBe(0);
        // Um tipo com uma operação entre dez mil não pode desenhar como um tipo sem nenhuma.
        expect(larguraDaBarra(1, 10000)).toBe(PISO_DA_BARRA_PCT);
        expect(larguraDaBarra(5, 0)).toBe(0);
        expect(larguraDaBarra(5, null)).toBe(0);
    });
});

describe('a série diária', () => {
    it('o dia sem produção é preenchido com zero, e não vira buraco no eixo', () => {
        const serie = preencherDias([
            { dia: '2026-08-01', total: 5 },
            { dia: '2026-08-04', total: 2 },
        ]);
        expect(serie).toEqual([
            { dia: '2026-08-01', total: 5 },
            { dia: '2026-08-02', total: 0 },
            { dia: '2026-08-03', total: 0 },
            { dia: '2026-08-04', total: 2 },
        ]);
    });

    it('ordena o que chegou fora de ordem e SOMA o dia repetido', () => {
        const serie = preencherDias([
            { dia: '2026-08-03', total: 1 },
            { dia: '2026-08-01', total: 2 },
            { dia: '2026-08-01', total: 3 },
        ]);
        // Duas linhas do mesmo dia são duas parcelas da mesma produção: ficar com a última perderia
        // a outra em silêncio.
        expect(serie).toEqual([
            { dia: '2026-08-01', total: 5 },
            { dia: '2026-08-02', total: 0 },
            { dia: '2026-08-03', total: 1 },
        ]);
    });

    it('atravessa mês e ano sem pular nem repetir', () => {
        expect(preencherDias([
            { dia: '2025-12-30', total: 1 },
            { dia: '2026-01-02', total: 1 },
        ]).map((l) => l.dia))
            .toEqual(['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02']);
    });

    it('o dia inválido SAI, e não vira zero num lugar inventado do eixo', () => {
        const serie = preencherDias([
            { dia: '2026-08-01', total: 4 },
            { dia: '2026-02-30', total: 99 },
            { dia: 'ontem', total: 99 },
            { total: 99 },
            null,
        ]);
        expect(serie).toEqual([{ dia: '2026-08-01', total: 4 }]);
    });

    it('um dia só, lista vazia e não-lista são casos legítimos', () => {
        expect(preencherDias([{ dia: '2026-08-30', total: 7 }]))
            .toEqual([{ dia: '2026-08-30', total: 7 }]);
        expect(preencherDias([])).toEqual([]);
        expect(preencherDias(null)).toEqual([]);
        expect(preencherDias({ dia: '2026-08-30' })).toEqual([]);
    });

    it('vão absurdo não gera vinte mil entradas: o teto devolve a série como veio', () => {
        // Um `dia` de 1970 ao lado de um de hoje travaria a aba. O caso só existe com payload
        // corrompido, e a saída é um gráfico com buraco, nunca uma aba pendurada.
        const serie = preencherDias([
            { dia: '1970-01-01', total: 1 },
            { dia: '2026-08-30', total: 2 },
        ]);
        expect(serie).toHaveLength(2);
        expect(serie.length).toBeLessThan(MAX_DIAS_DA_SERIE);
        // E o vão que CABE continua sendo preenchido, senão o teto estaria desligando tudo.
        expect(preencherDias([
            { dia: '2026-01-01', total: 1 },
            { dia: '2026-01-31', total: 1 },
        ])).toHaveLength(31);
    });
});

describe('a geometria do gráfico', () => {
    it('o dia com UMA operação nunca desenha igual ao dia parado', () => {
        // CONTROLE NEGATIVO 4. Sem o piso, 1/10000 arredonda para 0% e a barra passa a afirmar
        // "nada aconteceu" sobre um dia em que aconteceu.
        const { maximo, barras } = geometriaDaSerie([
            { dia: '2026-08-01', total: 10000 },
            { dia: '2026-08-02', total: 0 },
            { dia: '2026-08-03', total: 1 },
        ]);
        expect(maximo).toBe(10000);
        expect(barras[0].alturaPct).toBe(100);
        expect(barras[1].alturaPct).toBe(0);
        expect(barras[1].zero).toBe(true);
        expect(barras[2].alturaPct).toBe(PISO_DA_BARRA_PCT);
        expect(barras[2].zero).toBe(false);
        // A propriedade, e não só os três casos: quem tem produção fica acima do piso, e só o zero
        // é zero.
        for (const b of barras) {
            expect(b.zero).toBe(b.total === 0);
            if (b.total > 0) expect(b.alturaPct).toBeGreaterThanOrEqual(PISO_DA_BARRA_PCT);
            else expect(b.alturaPct).toBe(0);
        }
    });

    it('a altura é proporcional, e a maior barra é sempre 100', () => {
        const { barras } = geometriaDaSerie([
            { dia: '2026-08-01', total: 25 },
            { dia: '2026-08-02', total: 50 },
            { dia: '2026-08-03', total: 100 },
        ]);
        expect(barras.map((b) => b.alturaPct)).toEqual([25, 50, 100]);
    });

    it('a série toda zerada não normaliza por zero, e não inventa altura', () => {
        const { maximo, dias, barras } = geometriaDaSerie([
            { dia: '2026-08-01', total: 0 },
            { dia: '2026-08-02', total: 0 },
        ]);
        expect(maximo).toBe(0);
        expect(dias).toBe(2);
        expect(barras.every((b) => b.alturaPct === 0 && b.zero)).toBe(true);
        expect(barras.every((b) => Number.isFinite(b.alturaPct))).toBe(true);
    });

    it('a série vazia devolve zero dias, e não uma barra fantasma', () => {
        expect(geometriaDaSerie([])).toEqual({ maximo: 0, dias: 0, barras: [] });
        expect(geometriaDaSerie(null)).toEqual({ maximo: 0, dias: 0, barras: [] });
        expect(geometriaDaSerie([{ dia: 'lixo', total: 9 }]))
            .toEqual({ maximo: 0, dias: 0, barras: [] });
    });

    it('um dia só desenha a barra cheia e mostra o rótulo', () => {
        const { barras } = geometriaDaSerie([{ dia: '2026-08-30', total: 3 }]);
        expect(barras).toHaveLength(1);
        expect(barras[0].alturaPct).toBe(100);
        expect(barras[0].mostrarRotulo).toBe(true);
        expect(barras[0].rotulo).toBe('30/08');
        expect(barras[0].titulo).toBe('30/08/2026: 3 operações');
    });

    it('o rótulo é raleado, mas as DUAS pontas do período sempre aparecem', () => {
        const serie = preencherDias([
            { dia: '2026-06-01', total: 1 },
            { dia: '2026-08-29', total: 1 },
        ]);
        expect(serie).toHaveLength(90);
        const { barras } = geometriaDaSerie(serie, { maxRotulos: 8 });
        const rotulados = barras.filter((b) => b.mostrarRotulo);
        // Noventa rótulos de cinco caracteres viram uma tarja preta; oito se leem.
        expect(rotulados.length).toBeLessThanOrEqual(9);
        expect(rotulados.length).toBeGreaterThanOrEqual(2);
        expect(barras[0].mostrarRotulo).toBe(true);
        expect(barras[89].mostrarRotulo).toBe(true);
        expect(barras[0].rotulo).toBe('01/06');
        expect(barras[89].rotulo).toBe('29/08');
        // `maxRotulos` inválido não zera os rótulos nem os solta todos.
        const solto = geometriaDaSerie(serie, { maxRotulos: NaN });
        expect(solto.barras.filter((b) => b.mostrarRotulo).length).toBeLessThanOrEqual(46);
    });

    it('o título da barra tem a data inteira e concorda em número', () => {
        expect(tituloDeBarra('2026-08-30', 1)).toBe('30/08/2026: 1 operação');
        expect(tituloDeBarra('2026-08-30', 0)).toBe('30/08/2026: 0 operações');
        expect(tituloDeBarra('2026-08-30', 4321)).toBe('30/08/2026: 4.321 operações');
        expect(tituloDeBarra('lixo', 2)).toBe('2 operações');
    });
});

describe('o resumo da série', () => {
    it('conta os dias DESENHADOS, e o pico é o primeiro em caso de empate', () => {
        const resumo = resumoDaSerie([
            { dia: '2026-08-01', total: 4 },
            { dia: '2026-08-02', total: 0 },
            { dia: '2026-08-03', total: 4 },
        ]);
        expect(resumo).toEqual({
            dias: 3,
            total: 8,
            media: 8 / 3,
            pico: { dia: '2026-08-01', total: 4 },
        });
        expect(resumoDaSerieLabel(resumo))
            .toBe('3 dias desenhados, média de 2,7 por dia, pico de 4 em 01/08/2026.');
    });

    it('a série vazia não tem média nem legenda', () => {
        expect(resumoDaSerie([])).toEqual({ dias: 0, total: 0, media: null, pico: null });
        expect(resumoDaSerie(null)).toEqual({ dias: 0, total: 0, media: null, pico: null });
        expect(resumoDaSerieLabel({ dias: 0 })).toBe('');
        expect(resumoDaSerieLabel(null)).toBe('');
    });

    it('a série toda zerada tem legenda, mas sem anunciar um pico de zero', () => {
        const resumo = resumoDaSerie([
            { dia: '2026-08-01', total: 0 },
            { dia: '2026-08-02', total: 0 },
        ]);
        expect(resumo.total).toBe(0);
        expect(resumo.media).toBe(0);
        const legenda = resumoDaSerieLabel(resumo);
        expect(legenda).toBe('2 dias desenhados, média de 0 por dia.');
        expect(legenda).not.toContain('pico');
    });

    it('um dia só concorda em número', () => {
        expect(resumoDaSerieLabel(resumoDaSerie([{ dia: '2026-08-30', total: 5 }])))
            .toBe('1 dia desenhado, média de 5 por dia, pico de 5 em 30/08/2026.');
    });
});

describe('os atlas mais ativos', () => {
    it('ordena por operações, desempata pelo nome e corta em dez', () => {
        const top = Array.from({ length: 14 }, (_, i) => ({
            id: `id-${i}`, nome: `Atlas ${String(i).padStart(2, '0')}`, dono: 'diniz', operacoes: i,
        }));
        const linhas = ordenarTopAtlas(top);
        expect(linhas).toHaveLength(LIMITE_TOP);
        expect(linhas[0].operacoes).toBe(13);
        expect(linhas[9].operacoes).toBe(4);
    });

    it('o empate é resolvido pelo nome, para que duas leituras desenhem a mesma ordem', () => {
        const linhas = ordenarTopAtlas([
            { nome: 'Zulu', operacoes: 5 },
            { nome: 'Alfa', operacoes: 5 },
            { nome: 'Mike', operacoes: 5 },
        ]);
        expect(linhas.map((l) => l.nome)).toEqual(['Alfa', 'Mike', 'Zulu']);
    });

    it('atlas sem nome e sem dono não deixam célula em branco', () => {
        const [linha] = ordenarTopAtlas([{ id: 'x', nome: '   ', operacoes: 2 }]);
        expect(linha.nome).toBe('Atlas sem nome');
        // "não informado" e NÃO um travessão: todo atlas tem dono, e o travessão sugeriria um
        // atlas órfão que não existe.
        expect(linha.dono).toBe('não informado');
        expect(atlasNomeLabel(null)).toBe('Atlas sem nome');
        expect(donoLabel({ dono: 42 })).toBe('não informado');
    });

    it('lixo na lista não desenha linha, e o que não é lista devolve vazio', () => {
        expect(ordenarTopAtlas([null, 'x', 7])).toEqual([]);
        expect(ordenarTopAtlas(null)).toEqual([]);
        expect(ordenarTopAtlas([])).toEqual([]);
        // Operações ausente vira zero, e a linha SOBREVIVE: o atlas existe.
        expect(ordenarTopAtlas([{ nome: 'A' }])).toEqual([
            { id: '', nome: 'A', dono: 'não informado', operacoes: 0 },
        ]);
        // Limite inválido cai no padrão em vez de cortar tudo.
        expect(ordenarTopAtlas([{ nome: 'A' }, { nome: 'B' }], 0)).toHaveLength(2);
    });
});

// ===== o funil de entrada e a coorte de retenção =====
//
// AS DUAS SEÇÕES DE COORTE, e o que elas acrescentam de errável ao resto do arquivo é UMA coisa:
// elas leem o período de outro jeito. Nas outras seções a janela recorta o FATO medido; aqui ela
// recorta a COORTE, e a contagem segue até hoje. Isso não é testável a partir das frases (quem
// decide é o SQL), e por isso o que se prende aqui é a metade que É deste lado: que a tela DIGA
// isso, que a conversão nomeie o denominador, que a mediana ausente não vire zero e que a célula
// não fechada não vire zero.
//
// OS CONTROLES NEGATIVOS DESTA PARTE, isto é, o que ficaria vermelho se o código voltasse ao
// óbvio. Os quatro foram RODADOS (reverter, ver o vermelho, restaurar):
//
//   1. **A conversão como percentual nu.** Trocar `conversaoLabel` por `percentualLabel` cru
//      deixa "40%" sozinho ao lado de um passo, e num funil isso é ambíguo entre "40% de quem se
//      cadastrou" e "40% de quem criou o primeiro atlas". Os dois números existem, são
//      diferentes, e nada na tela diria qual está sendo mostrado.
//   2. **O piso do funil como `estado === ENCURTADO`.** É o que se escreve sem pensar, e ele
//      falha ABERTO exatamente nos dois casos sem evidência: servidor que não informou o alcance
//      e registro de produção vazio passariam a apresentar o terceiro passo como se estivesse
//      inteiro. `funilTemPiso` compara com `COBRE`, que é o único desfecho que autoriza silêncio.
//   3. **A mediana ausente perdendo a guarda.** Tirar o `numeroContavel` de `medianaLabel` NÃO
//      escreve "mediana de 0 h", como esta linha dizia: `mediaLabel(null)` devolve travessão, e o
//      que sai é a frase agramatical "mediana de — h" numa linha que não deveria existir. O
//      defeito é o mesmo (a seção afirma uma medida sobre um passo a que ninguém chegou), e o
//      sintoma é outro; escrever o sintoma errado manda quem for depurar procurar um zero que
//      nunca aparece. Foi RODADO, e é assim que a frase foi corrigida.
//   4. **A célula não fechada virando "0 de 3".** Colapsar `null` e número na tabela de retenção
//      faz uma semana que ainda está correndo se ler como abandono, que é a afirmação oposta à
//      verdadeira. E o terceiro estado (a posição que o servidor não mandou) não pode virar
//      "ainda não", que inventaria o motivo do vazio.

describe('o funil de entrada', () => {
    const funilDe = (o = {}) => ({
        cadastraram: 0, criaramAtlas: 0, produziram: 0,
        horasAteAtlas: null, horasAteProducao: null, ...o,
    });

    it('os três passos são de PERÍODO, e o último é o único que depende da produção', () => {
        // A marca é do PASSO e não da posição: um passo novo entre os dois primeiros herdaria a
        // ressalva errada se ela fosse "o último da lista".
        expect(PASSOS_DO_FUNIL.map((p) => p.chave))
            .toEqual(['cadastraram', 'criaramAtlas', 'produziram']);
        for (const passo of PASSOS_DO_FUNIL) {
            expect(passo.regime).toBe(REGIME.PERIODO);
        }
        expect(PASSOS_DO_FUNIL.filter((p) => p.dependeDaProducao).map((p) => p.chave))
            .toEqual(['produziram']);
        // O primeiro passo não tem mediana: a distância entre o cadastro e ele é zero por
        // definição, e escrevê-la seria inventar uma medida.
        expect(PASSOS_DO_FUNIL[0].mediana).toBeNull();
        expect(PASSOS_DO_FUNIL[1].mediana).toBe('horasAteAtlas');
        expect(PASSOS_DO_FUNIL[2].mediana).toBe('horasAteProducao');
    });

    it('a conversão NOMEIA o denominador, e é a do passo anterior', () => {
        const passos = funilPassos(funilDe({ cadastraram: 10, criaramAtlas: 5, produziram: 2 }));
        expect(passos[0].conversao).toBeNull();
        expect(passos[1].conversao).toBe('50,0% de quem criou conta');
        // 2 de 5 (o passo ANTERIOR), e não 2 de 10: sem o nome do denominador na frase, os dois
        // números seriam indistinguíveis na tela.
        expect(passos[2].conversao).toBe('40,0% de quem criou o primeiro atlas');
    });

    it('a barra é fração do TOPO, e é ela que faz o funil parecer um funil', () => {
        const passos = funilPassos(funilDe({ cadastraram: 10, criaramAtlas: 5, produziram: 2 }));
        expect(passos.map((p) => p.largura)).toEqual([100, 50, 20]);
    });

    it('produção ínfima ainda desenha barra: o piso separa existir de não existir', () => {
        const passos = funilPassos(funilDe({ cadastraram: 10000, criaramAtlas: 1, produziram: 0 }));
        expect(passos[1].largura).toBe(PISO_DA_BARRA_PCT);
        // Zero é zero: nada aconteceu, e a barra não pode afirmar o contrário.
        expect(passos[2].largura).toBe(0);
    });

    it('topo zerado não vira 0%: sem denominador não há fração', () => {
        const passos = funilPassos(funilDe());
        expect(passos[1].conversao).toBeNull();
        expect(passos[1].largura).toBe(0);
        expect(passos.map((p) => p.texto)).toEqual(['0', '0', '0']);
    });

    it('a mediana ausente NÃO vira zero: ninguém chegou ao passo', () => {
        const passos = funilPassos(funilDe({ cadastraram: 3, criaramAtlas: 1 }));
        expect(passos[1].mediana).toBeNull();
        expect(passos[2].mediana).toBeNull();
        expect(medianaLabel(null)).toBeNull();
        expect(medianaLabel(undefined)).toBeNull();
        // Medida negativa é defeito do outro lado, e desenhá-la seria repassá-lo como medida.
        expect(medianaLabel(-3)).toBeNull();
        expect(medianaLabel('duas horas')).toBeNull();
    });

    it('ZERO hora é medida e aparece: quem criou o atlas no mesmo instante existe', () => {
        expect(medianaLabel(0)).toBe('mediana de 0 h');
    });

    it('a mediana é arredondada AQUI, num lugar só, e em pt-BR', () => {
        // O servidor manda a medida crua; quem arredonda é a frase. Duas casas de arredondamento
        // são dois vereditos sobre a mesma medida.
        expect(medianaLabel(6.0166666666666666)).toBe('mediana de 6 h');
        expect(medianaLabel(2.55)).toBe('mediana de 2,6 h');
        expect(medianaLabel(1)).toBe('mediana de 1 h');
        // A unidade não flexiona, e é por isso que ela é 'h' e não 'horas': nenhum ramo de plural
        // para alguém manter.
        expect(medianaLabel(2)).toBe('mediana de 2 h');
    });

    it('o piso marca SÓ o passo que depende da produção', () => {
        const comPiso = funilPassos(
            funilDe({ cadastraram: 3, criaramAtlas: 2, produziram: 1 }), { piso: true }
        );
        expect(comPiso.map((p) => p.piso)).toEqual([false, false, true]);
        const semPiso = funilPassos(funilDe({ cadastraram: 3, criaramAtlas: 2, produziram: 1 }));
        expect(semPiso.map((p) => p.piso)).toEqual([false, false, false]);
    });

    it('o piso é derivado do horizonte e falha FECHADO nos três estados sem cobertura', () => {
        // O erro que se escreve sem pensar é `estado === ENCURTADO`, e ele deixa passar como
        // íntegro justamente o vazio e o desconhecido, que são os dois casos SEM evidência.
        expect(funilTemPiso(HORIZONTE.COBRE)).toBe(false);
        expect(funilTemPiso(HORIZONTE.ENCURTADO)).toBe(true);
        expect(funilTemPiso(HORIZONTE.VAZIO)).toBe(true);
        expect(funilTemPiso(HORIZONTE.DESCONHECIDO)).toBe(true);
    });

    it('a ressalva do piso tem frase própria por estado, e nenhuma no estado que cobre', () => {
        expect(funilPisoNotice(HORIZONTE.COBRE)).toBe('');
        const encurtado = funilPisoNotice(HORIZONTE.ENCURTADO);
        const vazio = funilPisoNotice(HORIZONTE.VAZIO);
        const desconhecido = funilPisoNotice(HORIZONTE.DESCONHECIDO);
        for (const texto of [encurtado, vazio, desconhecido]) {
            expect(texto.length).toBeGreaterThan(0);
            // Cada frase nomeia que os DOIS primeiros passos continuam valendo: uma ressalva que
            // não localiza o estrago ensina a desconfiar do funil inteiro.
            expect(texto).toMatch(/dois primeiros|último passo/);
        }
        expect(new Set([encurtado, vazio, desconhecido]).size).toBe(3);
        // Nenhuma delas AFIRMA causa: instalação jovem e histórico podado são indistinguíveis.
        expect(encurtado).not.toMatch(/podad/i);
    });

    it('o estado do funil sai da MESMA leitura do horizonte que os avisos do topo', () => {
        // Duas leituras da mesma chave divergem no dia em que alguém corrigir uma delas, e a tela
        // passaria a avisar que a produção está curta e, três seções abaixo, a mostrar o terceiro
        // passo como se estivesse inteiro.
        const desde = Date.UTC(2026, 7, 1);
        expect(FONTE_DO_PISO_DO_FUNIL).toBe('operacoesDesde');
        expect(estadoDaFonte({
            desde, horizonte: { operacoesDesde: Date.UTC(2026, 6, 1) }, chave: FONTE_DO_PISO_DO_FUNIL,
        })).toBe(HORIZONTE.COBRE);
        expect(estadoDaFonte({
            desde, horizonte: { operacoesDesde: Date.UTC(2026, 7, 10) }, chave: FONTE_DO_PISO_DO_FUNIL,
        })).toBe(HORIZONTE.ENCURTADO);
        // `null` e ausente NÃO são o mesmo estado, e é a distinção inteira deste arquivo.
        expect(estadoDaFonte({
            desde, horizonte: { operacoesDesde: null }, chave: FONTE_DO_PISO_DO_FUNIL,
        })).toBe(HORIZONTE.VAZIO);
        expect(estadoDaFonte({ desde, horizonte: {}, chave: FONTE_DO_PISO_DO_FUNIL }))
            .toBe(HORIZONTE.DESCONHECIDO);
        expect(estadoDaFonte({ desde, chave: FONTE_DO_PISO_DO_FUNIL }))
            .toBe(HORIZONTE.DESCONHECIDO);
    });

    it('o aviso do topo NOMEIA o terceiro passo entre o que a produção limita', () => {
        // Sem isso a pessoa lê "a produção está curta" e não tem como saber que o funil abaixo
        // também está: um aviso que não localiza o estrago é o mesmo que nenhum.
        const [aviso] = avisosDeHorizonte({
            desde: Date.UTC(2026, 7, 1),
            horizonte: { operacoesDesde: Date.UTC(2026, 7, 10), trilhaDesde: Date.UTC(2020, 0, 1) },
            janela: '30d',
            agora: Date.UTC(2026, 7, 31),
            ...UTC,
        });
        expect(aviso.chave).toBe('operacoesDesde');
        expect(aviso.texto).toMatch(/funil/);
    });

    it('payload malformado não quebra o funil, e desenha três zeros', () => {
        for (const lixo of [null, undefined, [], 'x', 42]) {
            const passos = funilPassos(lixo);
            expect(passos).toHaveLength(3);
            expect(passos.map((p) => p.total)).toEqual([0, 0, 0]);
        }
    });

    it('bloco AUSENTE não é conta zero, e as duas frases são diferentes', () => {
        // O caso inteiro: um servidor de versão anterior não manda `funil`, os três passos leem
        // zero, e a leitura ingênua desenha "Nenhuma conta foi criada no período" ao lado do
        // ladrilho "Contas novas" dizendo outra coisa na MESMA tela. Duas afirmações opostas
        // custam mais que uma seção que não aparece.
        expect(funilInformado({ cadastraram: 0, criaramAtlas: 0, produziram: 0 })).toBe(true);
        expect(funilInformado(undefined)).toBe(false);
        expect(funilInformado(null)).toBe(false);
        // Array e escalar não são o bloco: é a mesma régua de `dadosDoPayload`.
        expect(funilInformado([])).toBe(false);
        expect(funilInformado(3)).toBe(false);
        // As duas frases não podem ser a mesma, e nenhuma delas pode afirmar o que a outra diz.
        expect(funilNaoInformadoNotice()).not.toBe(funilVazioNotice('30d'));
        expect(funilNaoInformadoNotice()).toMatch(/servidor/);
        expect(funilNaoInformadoNotice()).toMatch(/não quer dizer/);
        expect(funilVazioNotice('30d')).not.toMatch(/servidor/);
    });

    it('as frases da seção dizem o que a tela pode ser lida ao contrário', () => {
        // O período escolhe a coorte, e NÃO fecha a contagem: sem isso a coorte mais recente
        // pareceria a que menos converte só por ter tido menos tempo.
        expect(funilHint()).toMatch(/coorte/);
        expect(funilHint()).toMatch(/até hoje/);
        // E o funil não conta quem só edita atlas alheio: sem dizê-lo, o número pareceria baixo
        // sem explicação numa instalação em que trabalhar no atlas de outra pessoa é o normal.
        expect(funilEscopoHint()).toMatch(/alheio|de outra pessoa/);
        expect(funilTitulo()).toBe('Funil de entrada');
        expect(funilSubtitulo('30d')).toMatch(/nos últimos 30 dias/);
        expect(funilVazioNotice('7d')).toMatch(/nos últimos 7 dias/);
        expect(funilVazioHint().length).toBeGreaterThan(0);
    });
});

describe('a coorte de retenção', () => {
    const linhaDe = (o = {}) => ({ semana: '2003-06-02', cadastrados: 3, retidos: [2, 0, 1, null], ...o });

    it('as quatro colunas casam com o array `retidos` POR POSIÇÃO', () => {
        // Uma coluna a mais leria `undefined`; uma a menos esconderia uma semana que o servidor
        // mandou. O número é contrato com `SEMANAS_DE_RETENCAO`, do servidor.
        expect(COLUNAS_DE_RETENCAO.map((c) => c.semana)).toEqual([1, 2, 3, 4]);
        expect(COLUNAS_DE_RETENCAO.map((c) => c.rotulo)).toEqual(['S+1', 'S+2', 'S+3', 'S+4']);
        for (const coluna of COLUNAS_DE_RETENCAO) {
            expect(coluna.detalhe.length).toBeGreaterThan(0);
        }
    });

    it('a célula medida diz "n de m" e a fatia, e o título diz "pelo menos"', () => {
        const [linha] = linhasDeRetencao([linhaDe()]);
        expect(linha.cadastrados).toBe(3);
        expect(linha.cadastradosTexto).toBe('3');
        expect(linha.celulas[0].texto).toBe('2 de 3');
        expect(linha.celulas[0].percentual).toBe('66,7%');
        expect(linha.celulas[0].aberta).toBe(false);
        // "pelo menos" porque o LOGIN é best-effort: uma falha de escrita da trilha some da conta.
        expect(linha.celulas[0].titulo).toMatch(/^Pelo menos 2 de 3:/);
    });

    it('a célula não fechada é "ainda não", e NUNCA "0 de 3"', () => {
        // O caso inteiro: a semana ainda corre, o número ainda vai crescer, e um zero ali se lê
        // como abandono, que é a afirmação oposta à verdadeira.
        const [linha] = linhasDeRetencao([linhaDe()]);
        const aberta = linha.celulas[3];
        expect(aberta.texto).toBe(CELULA_ABERTA);
        expect(aberta.texto).toBe('ainda não');
        expect(aberta.aberta).toBe(true);
        expect(aberta.percentual).toBeNull();
        expect(aberta.titulo).toMatch(/ainda não passou|ainda vai crescer/);
        // E o par que fecha a discriminação: a semana FECHADA sem retorno é ZERO, e é medida.
        expect(linha.celulas[1].texto).toBe('0 de 3');
        expect(linha.celulas[1].aberta).toBe(false);
        expect(linha.celulas[1].percentual).toBe('0%');
    });

    it('a posição que o servidor NÃO mandou é um terceiro estado, e não "ainda não"', () => {
        // `null` é o contrato dizendo "esta semana ainda não terminou"; ausente é um servidor que
        // não respondeu. Colapsá-los inventaria o motivo do vazio.
        const [linha] = linhasDeRetencao([linhaDe({ retidos: [1] })]);
        expect(linha.celulas[0].texto).toBe('1 de 3');
        for (const i of [1, 2, 3]) {
            expect(linha.celulas[i].desconhecida).toBe(true);
            expect(linha.celulas[i].aberta).toBe(false);
            expect(linha.celulas[i].texto).toBe('—');
        }
    });

    it('a coorte é nomeada pela segunda-feira, montada à mão e sem deslizar de fuso', () => {
        const [linha] = linhasDeRetencao([linhaDe()]);
        expect(linha.rotulo).toBe('Semana de 02/06/2003');
        expect(rotuloDeCoorte('2026-01-05')).toBe('Semana de 05/01/2026');
        // Passar a string por uma `Date` faria a semana recuar um dia a oeste de Greenwich, e a
        // coorte passaria a ser nomeada pelo domingo anterior.
        expect(rotuloDeCoorte('lixo')).toBe('');
        expect(rotuloDeCoorte(null)).toBe('');
    });

    it('as linhas saem da mais antiga para a mais nova, que é a que tem menos células fechadas', () => {
        const linhas = linhasDeRetencao([
            linhaDe({ semana: '2003-06-16', retidos: [0, null, null, null] }),
            linhaDe({ semana: '2003-06-02' }),
            linhaDe({ semana: '2003-06-09', retidos: [1, 1, null, null] }),
        ]);
        expect(linhas.map((l) => l.semana)).toEqual(['2003-06-02', '2003-06-09', '2003-06-16']);
    });

    it('semana que não se resolve sai da lista, e lixo devolve vazio', () => {
        // Uma coorte que a tela não consegue nomear não tem como ser comparada com as outras.
        expect(linhasDeRetencao([linhaDe({ semana: '2003-02-30' })])).toEqual([]);
        expect(linhasDeRetencao([linhaDe({ semana: 'ontem' }), null, 7])).toEqual([]);
        expect(linhasDeRetencao(null)).toEqual([]);
        expect(linhasDeRetencao([])).toEqual([]);
    });

    it('coorte de UMA conta não quebra a fração, e 1 de 1 é 100%', () => {
        const [linha] = linhasDeRetencao([linhaDe({ cadastrados: 1, retidos: [1, 0, null, null] })]);
        expect(linha.celulas[0].texto).toBe('1 de 1');
        expect(linha.celulas[0].percentual).toBe('100,0%');
        expect(linha.celulas[1].percentual).toBe('0%');
    });

    it('bloco AUSENTE não é coorte vazia, e o piso de reconhecimento é a LISTA', () => {
        // Um `retencao` sem `semanas` não é uma coorte vazia, é uma resposta que esta tela não
        // sabe ler; e a lista VAZIA é o fato honesto de que ninguém criou conta no período.
        expect(retencaoInformada({ semanas: [] })).toBe(true);
        expect(retencaoInformada({ semanas: [linhaDe()] })).toBe(true);
        expect(retencaoInformada({})).toBe(false);
        expect(retencaoInformada(undefined)).toBe(false);
        expect(retencaoInformada(null)).toBe(false);
        expect(retencaoInformada({ semanas: 'nenhuma' })).toBe(false);
        expect(retencaoNaoInformadaNotice()).not.toBe(retencaoVaziaNotice('30d'));
        expect(retencaoNaoInformadaNotice()).toMatch(/servidor/);
        expect(retencaoVaziaNotice('30d')).not.toMatch(/servidor/);
    });

    it('a ressalva diz o piso E a âncora, porque são duas coisas diferentes', () => {
        // O piso NÃO vem de poda (a trilha não é podada): vem do LOGIN best-effort. Dizer "piso"
        // sem dizer de onde ele vem faria a pessoa procurar poda que não houve.
        expect(retencaoHint()).toMatch(/pelo menos/);
        expect(retencaoHint()).toMatch(/best-effort/);
        expect(retencaoHint()).toMatch(/segunda-feira/);
        expect(retencaoTitulo()).toBe('Retenção por semana de cadastro');
        expect(retencaoSubtitulo('90d')).toMatch(/nos últimos 90 dias/);
        expect(retencaoVaziaNotice('30d')).toMatch(/nos últimos 30 dias/);
        expect(retencaoVaziaHint().length).toBeGreaterThan(0);
        expect(retencaoColunaCoorte()).toBe('Coorte');
        expect(retencaoColunaTamanho()).toBe('Contas');
    });
});
