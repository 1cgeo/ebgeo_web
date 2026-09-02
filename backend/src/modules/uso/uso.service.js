// Path: src/modules/uso/uso.service.js
/**
 * @fileoverview O RELATÓRIO DE USO: quem usa, o quê, quanto.
 *
 * É a última peça da observabilidade (ver `docs/wiki/observabilidade.md`, seção "O que
 * ainda não existe"), e a que NÃO instrumenta nada: `operations`, `audit_trail`, `users` e
 * `atlas` já guardam tudo o que ele responde. Instrumentação nova aqui seria uma segunda
 * verdade para manter.
 *
 * IRMÃO DE `modules/diag/` EM FORMA E EM GATE, e as duas semelhanças são deliberadas: a
 * mesma gramática de janela (`parseJanela`, um só significado para "30d" no produto
 * inteiro) e o mesmo `auth` estrito + `requireAdmin`. A diferença é a fonte: aquele lê o
 * log em ARQUIVO, este lê o BANCO — que é exatamente a separação que a página de
 * observabilidade defende (o arquivo é sequencial e serve à investigação; o banco agrupa e
 * pagina, e serve ao resumo).
 *
 * AS CONSULTAS RODAM EM PARALELO, com o mesmo par (início, fim). Elas são independentes e
 * nada aqui é transacional de propósito: um relatório não precisa de instantâneo consistente
 * do banco, e abrir transação para uma dúzia de `SELECT` prenderia uma conexão do pool de dez
 * que serve o sync e o `GET /api/config`. O que ELAS PRECISAM compartilhar é a JANELA, e isso
 * se resolve passando os mesmos dois parâmetros, não segurando uma transação. (Esta linha
 * carregava a contagem, e ela envelheceu na primeira consulta acrescentada; o que vale é a
 * propriedade.)
 */

import { one, any } from '../../database/index.js';
import { parseJanela } from '../../utils/diag-consulta.js';
import { paraEpoch, inteiro, decimalOuNulo } from './uso.horizonte.js';
import { TETO_DA_JANELA_MS } from './uso.schemas.js';
import {
  HORIZONTE, PESSOAS, ATLAS_RESUMO, TOP_ATLAS,
  PRODUCAO_POR_ENTIDADE, PRODUCAO_POR_DIA,
  FUNIL_DE_ENTRADA, COORTE_DE_RETENCAO,
} from './uso.queries.js';

/**
 * Quantos atlas entram no ranking.
 *
 * Constante e não parâmetro de query: o número existe para que a lista caiba numa tela, e
 * torná-lo configurável abriria um `?limite=` que, sobre uma agregação que já varre
 * `operations`, é um jeito de pedir trabalho arbitrário atrás de um gate de administrador.
 * Quem quer o ranking inteiro tem SQL no servidor.
 */
export const TOP_ATLAS_LIMITE = 10;

/** Uma semana em milissegundos. Usada só para derivar o teto de linhas da coorte. */
const SEMANA_MS = 7 * 86_400_000;

/**
 * Quantas linhas de coorte a resposta pode trazer, no máximo.
 *
 * DERIVADO DO TETO DA JANELA, e não escolhido: cada segunda-feira tocada pelo intervalo é uma
 * coorte. Uma constante escrita à mão aqui seria um segundo teto para a mesma coisa, e os dois
 * divergem no dia em que o primeiro mudar; um número MENOR cortaria coortes reais em silêncio,
 * que é o jeito de a tabela mentir sem parecer.
 *
 * O `ceil` NÃO É FOLGA, É O NÚMERO CERTO, e o `floor` que morava aqui estava ERRADO por um. A
 * conta depende da FASE da janela dentro da semana, não só do comprimento dela: 365 dias são 52
 * semanas mais um dia, então uma janela que comece perto do fim de uma semana toca 54
 * segundas-feiras, e `floor(365/7) + 1` dá 53. O erro tem exatamente o tamanho que ninguém
 * percebe, e o sintoma seria uma coorte a menos na tabela, sem aviso nenhum. As fases estão
 * enumeradas em `tests/integration/uso-funil-e-retencao.test.js`, que prova o máximo em vez de
 * repetir a fórmula (repeti-la seria o teste concordando com o defeito).
 *
 * ELE É UM CINTO, e não a regra: o recorte de verdade é o `WHERE` da consulta, que só agrupa
 * quem nasceu na janela. O `LIMIT` existe para que uma janela absurda (relógio do servidor
 * saltando, um `desde` que passe pela borda por outro caminho) não vire uma resposta de
 * milhares de linhas numa rota de administração. E, se ele morder, quem cai é a coorte mais
 * ANTIGA, porque a consulta ordena decrescente e a reversão acontece aqui: ver
 * `COORTE_DE_RETENCAO`.
 */
export const MAX_SEMANAS_DE_COORTE = Math.ceil(TETO_DA_JANELA_MS / SEMANA_MS) + 1;

/**
 * As quatro semanas de retenção que a coorte acompanha.
 *
 * QUATRO, e o número está no SQL também (`w1`..`w4` e o `LEAST(4, …)`): mudar aqui sem mudar
 * lá encurta a tabela sem erro nenhum. Elas são o primeiro mês, que é o horizonte em que a
 * decisão de continuar usando o produto se toma; uma quinta coluna só adiaria a resposta da
 * coorte mais recente por mais uma semana.
 */
export const SEMANAS_DE_RETENCAO = 4;

/**
 * As células de retenção de uma linha de coorte.
 *
 * A CÉLULA AINDA NÃO ALCANÇADA É `null`, E NUNCA ZERO, e é `semanas_completas` (calculado no
 * SQL, onde o fuso é conhecido) quem decide quantas já fecharam. Um zero numa semana que ainda
 * corre se lê como abandono, que é a afirmação oposta à verdadeira; e um número que ainda vai
 * crescer, publicado como se fosse final, ensina a desconfiar da tabela inteira quando ele
 * mudar na carga seguinte.
 *
 * @param {Object} linha - a linha crua da consulta
 * @returns {Array<number|null>} uma entrada por semana de {@link SEMANAS_DE_RETENCAO}
 */
function celulasDeRetencao(linha) {
  const completas = inteiro(linha.semanas_completas);
  const brutos = [linha.w1, linha.w2, linha.w3, linha.w4];
  return brutos
    .slice(0, SEMANAS_DE_RETENCAO)
    .map((valor, i) => (i < completas ? inteiro(valor) : null));
}

/**
 * O resumo de uso da janela.
 *
 * `agora` é INJETÁVEL, e não é conveniência de teste: é o que faz as cinco consultas
 * responderem sobre o MESMO intervalo (ver o cabeçalho de `uso.queries.js`). O teste ganha
 * determinismo de graça, mas a razão é de produção.
 *
 * @param {Object} opts
 * @param {string} opts.desde - a janela, na gramática de `parseJanela` ('30d', '24h', …)
 * @param {Date} [opts.agora] - o fim da janela
 * @returns {Promise<Object>} o payload de `GET /uso/resumo`
 */
export async function resumo({ desde, agora = new Date() }) {
  const fim = agora;
  const inicio = new Date(fim.getTime() - parseJanela(desde));
  const p = [inicio, fim];

  const [horizonte, pessoas, atlas, top, porEntidade, porDia, funil, coorte] = await Promise.all([
    one(HORIZONTE),
    one(PESSOAS, p),
    one(ATLAS_RESUMO, p),
    any(TOP_ATLAS, [...p, TOP_ATLAS_LIMITE]),
    any(PRODUCAO_POR_ENTIDADE, p),
    any(PRODUCAO_POR_DIA, p),
    one(FUNIL_DE_ENTRADA, p),
    any(COORTE_DE_RETENCAO, [...p, MAX_SEMANAS_DE_COORTE]),
  ]);

  const desdeMs = inicio.getTime();
  const operacoesDesde = paraEpoch(horizonte.operacoes_desde);
  const trilhaDesde = paraEpoch(horizonte.trilha_desde);

  const entidades = porEntidade.map((l) => ({
    entidade: l.entidade,
    total: inteiro(l.total),
  }));

  return {
    // Epoch ms, como TODA data da família de rotas de observabilidade (`/diag/*` carimba
    // `desde`, `primeira` e `ultima` assim). Duas unidades de tempo no mesmo painel é
    // conversão errada esperando para acontecer.
    desde: desdeMs,

    // O HORIZONTE: até onde o dado alcança, e a peça que separa este relatório de um que
    // mente. `operations` é PODÁVEL (`cleanupOldOperations`, rota de administrador), então
    // um pedido de 90 dias pode estar sendo respondido sobre 20 — com números corretos,
    // plausíveis, e indistinguíveis de um trimestre de pouco uso.
    //
    // A JANELA QUE ULTRAPASSA O HORIZONTE SE DETECTA COMPARANDO `horizonte.*` COM `desde`,
    // que viajam juntos no mesmo payload e na mesma unidade. Não há booleano de veredito
    // aqui, e a ausência é decisão: os dois instantes dão QUATRO desfechos ao consumidor
    // (cobre / podado / sem dado nenhum / campo não informado por servidor anterior) e a
    // tela precisa de frase diferente em cada um. Um booleano colapsaria os três últimos e
    // seria, em dois pacotes, a resposta mais pobre para a mesma pergunta — e a primeira
    // que o próximo consumidor alcançaria. A armadilha do `null` está no `fileoverview` de
    // `uso.horizonte.js`, que é onde a decisão inteira mora.
    //
    // SÃO DUAS FONTES E NÃO UMA porque elas limitam METADES DIFERENTES da resposta:
    // `operacoesDesde` limita a produção (total, por entidade, série diária, ranking e
    // `editaram`), e `trilhaDesde` limita `entraram`. Publicar um horizonte só faria o
    // consumidor avisar sobre o bloco errado.
    horizonte: { operacoesDesde, trilhaDesde },

    pessoas: {
      contasAtivas: inteiro(pessoas.contas_ativas),
      novasContas: inteiro(pessoas.novas_contas),
      entraram: inteiro(pessoas.entraram),
      editaram: inteiro(pessoas.editaram),
    },

    atlas: {
      vivos: inteiro(atlas.vivos),
      criados: inteiro(atlas.criados),
      excluidos: inteiro(atlas.excluidos),
      comEdicao: inteiro(atlas.com_edicao),
      top: top.map((l) => ({
        id: l.id,
        nome: l.nome,
        // `null` e não string vazia: o dono ausente (ver o `LEFT JOIN` da query) precisa
        // ser distinguível de um dono cujo nome é vazio, e só um dos dois é um defeito.
        dono: l.dono ?? null,
        operacoes: inteiro(l.operacoes),
      })),
    },

    producao: {
      // DERIVADO da lista por entidade, e não uma sexta consulta. As duas contariam o mesmo
      // conjunto (`porEntidade` não tem LIMIT), então a segunda ida ao banco compraria
      // apenas a chance de as duas discordarem. O teste de integração confere a invariante
      // pelo terceiro lado, que é independente: a soma da série DIÁRIA também bate.
      total: entidades.reduce((soma, e) => soma + e.total, 0),
      porEntidade: entidades,
      porDia: porDia.map((l) => ({ dia: l.dia, total: inteiro(l.total) })),
    },

    // O FUNIL DE ENTRADA: dos que criaram conta na janela, quantos chegaram ao primeiro
    // atlas e quantos chegaram à primeira edição. Os três números são MONOTÔNICOS por
    // construção (ver `FUNIL_DE_ENTRADA`), e é isso que autoriza a tela a chamá-los de
    // conversão: um terceiro passo maior que o segundo daria percentual acima de 100% com o
    // dado inteiro e correto.
    //
    // AS DUAS MEDIANAS SÃO `null` QUANDO NINGUÉM CHEGOU AO PASSO, e nunca zero: ver
    // `decimalOuNulo`. Elas vêm em HORAS, cruas, sem arredondamento: quem arredonda é a
    // frase, num lugar só, porque o número que a tela diz tem de ser o número que o servidor
    // mandou.
    //
    // O TERCEIRO PASSO DEPENDE DE `operations`, LOGO DEPENDE DO HORIZONTE, e não há booleano
    // de veredito aqui pela mesma razão declarada no bloco acima: `horizonte.operacoesDesde`
    // e `desde` viajam no mesmo payload, na mesma unidade, e a comparação entre eles dá ao
    // consumidor os quatro desfechos que um booleano colapsaria em dois. Os passos 1 e 2 saem
    // de `users` e `atlas`, que não são podáveis, e por isso nenhum horizonte os limita.
    funil: {
      cadastraram: inteiro(funil.cadastraram),
      criaramAtlas: inteiro(funil.criaram_atlas),
      produziram: inteiro(funil.produziram),
      horasAteAtlas: decimalOuNulo(funil.horas_ate_atlas),
      horasAteProducao: decimalOuNulo(funil.horas_ate_producao),
    },

    // A COORTE DE RETENÇÃO, uma linha por semana ISO em que alguém se cadastrou.
    //
    // SEMANA SEM CADASTRO NÃO TEM LINHA (ver `COORTE_DE_RETENCAO`), e isso é o avesso do
    // preenchimento da série diária: lá o zero é fato, aqui não há coorte, e uma linha de
    // denominador zero não tem retenção nenhuma para mostrar.
    //
    // `audit_trail` NÃO É PODADA, então esta metade da resposta não tem horizonte. O que ela
    // tem é o piso do `LOGIN` best-effort, que é outra coisa e mora na frase da tela.
    //
    // A CONSULTA DEVOLVE DECRESCENTE E O PAYLOAD SAI CRESCENTE. A ordem do SQL existe só para
    // escolher quem o `LIMIT` corta (a coorte mais antiga, e não a que a pessoa está olhando);
    // a ordem da tela é a cronológica, porque a coorte mais velha é a única com as quatro
    // semanas fechadas e é ela que serve de referência para ler as de cima.
    retencao: {
      semanas: coorte
        .map((l) => ({
          semana: l.semana,
          cadastrados: inteiro(l.cadastrados),
          retidos: celulasDeRetencao(l),
        }))
        .reverse(),
    },
  };
}
