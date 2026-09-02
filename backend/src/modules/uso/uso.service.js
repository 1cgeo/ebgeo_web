// Path: src/modules/uso/uso.service.js
/**
 * @fileoverview O RELATÓRIO DE USO: quem usa, o quê, quanto.
 *
 * ELE TEM DUAS METADES DESDE 2026-09-02, E A DISTINÇÃO É A PRIMEIRA COISA A SABER. A metade
 * antiga é DERIVADA: `operations`, `audit_trail`, `users` e `atlas` já guardavam o que ela
 * responde, e instrumentar de novo seria criar uma segunda verdade para manter. A metade nova
 * (sessões, gestos, desempenho, disponibilidade vista da ponta) é INSTRUMENTADA, porque
 * nenhuma dessas perguntas tem resposta em tabela alguma que já existisse: `operations` sabe
 * quantas feições nasceram e não sabe se alguém abriu o 3D. A escrita dela mora noutro
 * arquivo (`uso.eventos.service.js`), e o porquê está no cabeçalho de lá.
 *
 * ESTE ARQUIVO NÃO ESCREVE NADA, e a linha acima não muda isso: ele continua sendo só
 * leitura, atrás de `requireAdmin`.
 *
 * AS DUAS METADES NÃO USAM A MESMA JANELA, E ISSO PRECISA SER LIDO ANTES DE COMPARAR NÚMEROS
 * DAS DUAS. A metade derivada compara INSTANTES (`created_at >= $1 AND < $2`), então "30d"
 * ali significa exatamente 720 horas contadas para trás. A metade nova encosta em colunas
 * `date`, e a comparação é `dia >= $1::date AND dia <= $2::date`: ela ARREDONDA PARA O DIA nas
 * DUAS pontas, e é INCLUSIVA nas duas. Um pedido de "30d" feito às 14h cobre 31 dias de
 * calendário, com o primeiro e o último parciais. Não é descuido: um `<` sobre o dia do fim
 * apagaria o dia corrente da resposta inteira, que é justamente o dia que alguém está olhando
 * quando abre a tela, e um `>` no começo cortaria o dia em que a janela nasceu.
 *
 * A CONSEQUÊNCIA QUE ENGANA: a soma da série de sessões NÃO tem de bater com a soma da série
 * de produção da mesma janela, porque elas cobrem intervalos diferentes por construção. Para
 * que a tela possa dizer isso em vez de deixar a pessoa descobrir, a faixa EFETIVA viaja no
 * payload (`sessoes.faixa`), em dias, do jeito que a série já viaja.
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
  HORIZONTE_DE_USO, SESSOES_POR_DIA, USO_NA_JANELA, EVENTOS_TOP,
  DESEMPENHO_POR_SESSAO, DESEMPENHO_DIARIO, DISPONIBILIDADE_POR_DIA,
  SAUDE_POR_RELEASE,
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
/**
 * Quantos pares (gesto, qualificador) entram no bloco `ferramentas`.
 *
 * Vinte, e o argumento é o de `TOP_ATLAS_LIMITE`: o número existe para que a lista caiba numa
 * tela, e torná-lo parâmetro de query abriria um `?limite=` sobre uma agregação, atrás de um
 * gate de administrador. Ele é MAIOR que o do ranking de atlas porque o vocabulário é maior:
 * treze eventos mais os qualificadores livres de `ferramenta.ativada`, e cortar em dez
 * esconderia toda a cauda de ferramentas, que é justamente o que o bloco existe para mostrar.
 */
export const EVENTOS_TOP_LIMITE = 20;

/**
 * Quantas releases a saúde de release acompanha.
 *
 * TRÊS, e o número é o da PERGUNTA e não o da tela: "a que está no ar está pior que a
 * anterior?" precisa de duas, e a terceira é a folga que permite ver se a anterior já era
 * ruim. Uma lista longa aqui viraria histórico, que é outro relatório e outra janela.
 */
export const RELEASES_NA_SAUDE = 3;

/**
 * O desempenho por página, escolhendo entre as DUAS fontes e DIZENDO qual respondeu.
 *
 * A REGRA É "SESSÃO VENCE ONDE HOUVER SESSÃO", e ela não é arbitrária: um percentil se
 * calcula sobre a distribuição, e a distribuição são as sessões retidas. O agregado diário só
 * tem p75 POR DIA, e a mediana de p75 diários não é o p75 da janela (ver `DESEMPENHO_DIARIO`);
 * ela é a melhor resposta disponível quando as sessões já foram podadas, e a pior quando elas
 * existem.
 *
 * `origem` VIAJA NO PAYLOAD, e é o que impede a segunda fonte de mentir por omissão. Sem ele,
 * `amostras` teria duas grandezas com o mesmo nome (sessões num caso, DIAS no outro) e a tela
 * leria "30 amostras" das duas maneiras. Um número que muda de significado sem mudar de nome
 * é a forma mais barata de um relatório enganar.
 *
 * @param {Object[]} porSessao - linhas de `DESEMPENHO_POR_SESSAO`
 * @param {Object[]} porDiario - linhas de `DESEMPENHO_DIARIO`
 * @returns {Object[]} uma linha por página, ordenada pelo nome da página
 */
function desempenhoDaJanela(porSessao, porDiario) {
  const linha = (l, origem) => ({
    pagina: l.pagina,
    origem,
    amostras: inteiro(l.amostras),
    // `decimalOuNulo` e NUNCA `inteiro`: um percentil sobre conjunto vazio é NULL (a página
    // não carrega mapa, ninguém interagiu), e zero milissegundo seria uma MEDIDA.
    lcpP75Ms: decimalOuNulo(l.lcp_p75_ms),
    inpP75Ms: decimalOuNulo(l.inp_p75_ms),
    clsP75: decimalOuNulo(l.cls_p75),
    tempoAteMapaP75Ms: decimalOuNulo(l.tempo_ate_mapa_p75_ms),
  });

  const porPagina = new Map();
  for (const l of porDiario) porPagina.set(l.pagina, linha(l, 'diario'));
  for (const l of porSessao) porPagina.set(l.pagina, linha(l, 'sessoes'));
  return [...porPagina.values()].sort((a, b) => a.pagina.localeCompare(b.pagina));
}

/**
 * O menor de dois instantes que podem não existir.
 *
 * `Math.min(a, null)` é `0` em JavaScript, ou seja 1970, que é o horizonte mais confortável e
 * mais falso que este relatório poderia publicar. É a mesma armadilha que `paraEpoch` fecha do
 * outro lado, e ela precisa ser fechada de novo aqui porque o menor de UM instante é aquele
 * instante, e o menor de NENHUM é `null`.
 *
 * @param {number|null} a
 * @param {number|null} b
 * @returns {number|null}
 */
function menorInstante(a, b) {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

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

  // A SEGUNDA ONDA, E ELA É SEQUENCIAL EM RELAÇÃO À PRIMEIRA DE PROPÓSITO. O pool desta
  // aplicação tem DEZ conexões e serve o sync e o `GET /api/config`; disparar as quinze
  // consultas do relatório de uma vez tomaria o pool inteiro e faria o resto do produto
  // esperar por uma tela de administração. Em duas ondas de oito e sete, o pico é oito e
  // sobram duas conexões. O custo é uma ida a mais de latência numa rota que ninguém carrega
  // em laço, e a alternativa (uma transação para tudo) prenderia UMA conexão pelo tempo
  // somado das quinze, que é pior nos dois eixos.
  //
  // A JANELA É A MESMA `p` das oito de cima, e é isso que mantém o relatório sendo o retrato
  // de UM período. Ver o cabeçalho de `uso.queries.js`.
  //
  // MAS ELA É LIDA DE OUTRO JEITO AQUI: estas sete comparam DIA, não instante, e o recorte é
  // inclusivo nas duas pontas (ver o `fileoverview`). Os mesmos dois parâmetros produzem, nas
  // oito de cima, um intervalo meio-aberto de instantes, e nestas, um intervalo fechado de
  // dias de calendário. É por isso que `sessoes.faixa` existe: sem ela, a única forma de
  // saber sobre quais dias a resposta fala seria refazer o arredondamento no cliente, e para
  // isso ele precisaria adivinhar o fuso do servidor.
  const [
    horizonteDeUso, sessoesPorDia, naJanela, eventosTop,
    desempPorSessao, desempPorDiario, disponibilidade,
  ] = await Promise.all([
    one(HORIZONTE_DE_USO),
    any(SESSOES_POR_DIA, p),
    one(USO_NA_JANELA, p),
    any(EVENTOS_TOP, [...p, EVENTOS_TOP_LIMITE]),
    any(DESEMPENHO_POR_SESSAO, p),
    any(DESEMPENHO_DIARIO, p),
    any(DISPONIBILIDADE_POR_DIA, p),
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
    //
    // AS DUAS DE USO ENTRARAM EM 2026-09-02 E SÃO DUAS PELO MESMO ARGUMENTO, não por simetria.
    // `usoDesde` é o começo do dado de uso como um todo (o menor entre a sessão retida mais
    // antiga e o dia agregado mais antigo), e é o que a aba usa para dizer desde quando esta
    // instalação mede uso: antes da primeira descarga de qualquer navegador ele é `null`, e
    // `null` aqui significa "esta instalação nunca mediu", que é diferente de "ninguém usou".
    // `usoSessoesDesde` é mais estreito e limita METADE do bloco de sessões: pessoas distintas
    // na janela, duração mediana e o desempenho de origem `sessoes` saem das sessões RETIDAS,
    // e a retenção é bem menor que o teto da janela. Publicar um horizonte só faria o
    // consumidor avisar sobre o bloco errado, que é exatamente o erro que a separação entre
    // `operacoesDesde` e `trilhaDesde` já evita do outro lado.
    horizonte: {
      operacoesDesde,
      trilhaDesde,
      usoDesde: menorInstante(
        paraEpoch(horizonteDeUso.sessoes_desde),
        paraEpoch(horizonteDeUso.diario_desde)
      ),
      usoSessoesDesde: paraEpoch(horizonteDeUso.sessoes_desde),
    },

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

    // ─── O USO DE PRODUTO, desde 2026-09-02 ───
    //
    // Daqui para baixo nada é derivado de `operations` nem da trilha: tudo sai das três
    // tabelas de `020_uso_de_produto.sql`, alimentadas por `POST /uso/eventos`. É a metade
    // que responde o que a pessoa FAZ, e não quanto ela produziu.

    // SESSÕES: a série é somável e vem da costura entre dia fechado e dia aberto
    // (`SESSOES_POR_DIA`, que é a consulta a ler antes de qualquer outra desta família).
    //
    // OS TOTAIS DA JANELA SAEM DE DUAS FONTES DIFERENTES, E ISSO PRECISA ESTAR DITO. `total`,
    // `autenticadas` e `comErro` são a SOMA da série, e portanto exatos: eles são aditivos, e
    // somar a série é a única forma de o total não poder discordar do gráfico logo acima dele.
    // `usuariosDistintos` e `duracaoMedianaS` NÃO são aditivos (contagem distinta não se soma
    // entre dias, mediana não se re-agrega a partir de medianas), então saem das SESSÕES
    // RETIDAS e são um PISO quando a janela ultrapassa a retenção. Quem permite ao consumidor
    // perceber isso é `horizonte.usoSessoesDesde`, no mesmo payload e na mesma unidade.
    //
    // `usuariosDistintos` DA SÉRIE DIÁRIA E O DA JANELA NÃO SÃO A MESMA GRANDEZA, e a
    // diferença é estrutural, não um defeito a consertar: o diário é distinto DENTRO de cada
    // página (é o que `uso_diario` guarda), somado sobre as páginas do dia, então quem usou
    // duas páginas conta duas vezes ali; o da janela é distinto de verdade. Somar a coluna da
    // série e comparar com o total é, por construção, comparar duas perguntas.
    sessoes: {
      // A FAIXA EFETIVA, em dias de calendário do SERVIDOR, derivada da própria série densa.
      //
      // DERIVADA E NÃO CONSULTADA: `SESSOES_POR_DIA` já produz um `generate_series` sobre
      // exatamente as duas fronteiras arredondadas, então a primeira e a última linha SÃO a
      // faixa. Uma nona consulta para perguntar ao banco o que a oitava já respondeu seria
      // mais uma ida ao pool e uma segunda chance de os dois números discordarem.
      //
      // `null` QUANDO A SÉRIE ESTÁ VAZIA, o que não acontece hoje (o `generate_series` sempre
      // devolve ao menos um dia), e é escrito assim mesmo porque um `undefined` vindo de uma
      // série vazia sumiria do JSON e o consumidor leria "campo não informado", que é o
      // estado de servidor ANTIGO e significa outra coisa.
      faixa: {
        deDia: sessoesPorDia[0]?.dia ?? null,
        ateDia: sessoesPorDia[sessoesPorDia.length - 1]?.dia ?? null,
      },
      porDia: sessoesPorDia.map((l) => ({
        dia: l.dia,
        sessoes: inteiro(l.sessoes),
        sessoesAutenticadas: inteiro(l.sessoes_autenticadas),
        usuariosDistintos: inteiro(l.usuarios_distintos),
        sessoesComErro: inteiro(l.sessoes_com_erro),
      })),
      total: sessoesPorDia.reduce((s, l) => s + inteiro(l.sessoes), 0),
      autenticadas: sessoesPorDia.reduce((s, l) => s + inteiro(l.sessoes_autenticadas), 0),
      comErro: sessoesPorDia.reduce((s, l) => s + inteiro(l.sessoes_com_erro), 0),
      usuariosDistintos: inteiro(naJanela.usuarios_distintos),
      // `decimalOuNulo` e não `inteiro`: sem sessão retida na janela não há mediana nenhuma, e
      // zero segundo seria uma medida ("todo mundo fechou a aba no instante em que abriu").
      duracaoMedianaS: decimalOuNulo(naJanela.duracao_mediana_s),
      // Quantas sessões sustentam os DOIS números acima. Ele é o que separa "ninguém usou" de
      // "a retenção já levou as sessões da janela": nos dois casos os dois números seriam
      // vazios, e só num deles isso é uma afirmação sobre o uso.
      sessoesRetidas: inteiro(naJanela.sessoes_retidas),
    },

    // GESTOS: o bloco se chama `ferramentas` porque é o nome da tela, e ele NÃO é filtrado por
    // ferramenta. Ver `EVENTOS_TOP`: cortar tudo o que não é `ferramenta.ativada` esconderia
    // os desfechos caros (3D, 360, PDF, `.ebgeo`), que são poucos e são os que decidem
    // prioridade.
    //
    // `prop` VAZIO É UM VALOR, e não ausência: ele é a linha do gesto SEM qualificador, que
    // acontece quando o cliente não soube qualificá-lo. Publicá-lo como `null` faria a tela
    // ter de inventar uma frase para um estado que já tem nome.
    ferramentas: eventosTop.map((l) => ({
      evento: l.evento,
      prop: l.prop,
      contagem: inteiro(l.contagem),
    })),

    // DESEMPENHO: uma linha por página, com a FONTE declarada em `origem`. Ver
    // `desempenhoDaJanela`: `sessoes` é o p75 de verdade, `diario` é a mediana das p75
    // diárias, e as duas trazem `amostras` em grandezas diferentes (sessões e DIAS).
    desempenho: desempenhoDaJanela(desempPorSessao, desempPorDiario),

    // DISPONIBILIDADE VISTA DA PONTA: quantas pessoas bateram na tela de indisponibilidade.
    // É a única medida que o log em arquivo não pode ter, porque quando o backend está fora
    // não existe requisição para registrar. A série é preenchida com zero, e aqui o zero é a
    // BOA notícia: um buraco ao lado de um pico se leria como "não sabemos".
    disponibilidade: disponibilidade.map((l) => ({
      dia: l.dia,
      vistos: inteiro(l.vistos),
    })),
  };
}

/**
 * A SAÚDE POR RELEASE: das builds que estiveram no ar na janela, quantas sessões tiveram,
 * quantas delas com erro, e quantos defeitos nasceram ou regrediram nelas.
 *
 * ELA MORA AQUI E É CONSUMIDA POR `GET /diag/status`, e a direção da dependência é essa
 * mesmo: `diag` importa de `uso`, nunca o contrário. O motivo é estrutural e precisa
 * continuar valendo. `diag.service.js` NÃO IMPORTA `config` NEM O BANCO, e a ausência é
 * declarada no `fileoverview` de lá: é ela que o mantém exercível em node puro, sem
 * `DATABASE_URL` e sem `JWT_SECRET`. Pendurar esta consulta lá dentro derrubaria essa
 * propriedade por uma linha de payload. Quem compõe é o CONTROLLER de `diag`, que já importa
 * `config` e já importa `defeitos.service.js` (e portanto o banco), e que já era o lugar onde
 * o `release` do processo entra na resposta.
 *
 * A JANELA É A DA ROTA QUE CHAMA, e no `/diag/status` ela é curta por padrão (1h) e limitada a
 * 7d. Isso não é um descuido de reuso: aquela rota é o PULSO, e a pergunta ao lado do pulso é
 * "quais builds estão respondendo agora". Um histórico longo de releases é outro relatório.
 *
 * @param {Object} opts
 * @param {string} opts.desde - a janela, na gramática de `parseJanela`
 * @param {Date} [opts.agora] - o fim da janela
 * @returns {Promise<Object[]>} uma linha por release, da mais recente para a mais antiga
 */
export async function saudeDasReleases({ desde, agora = new Date() }) {
  const fim = agora;
  const inicio = new Date(fim.getTime() - parseJanela(desde));
  const linhas = await any(SAUDE_POR_RELEASE, [inicio, fim, RELEASES_NA_SAUDE]);

  return linhas.map((l) => ({
    release: l.release,
    sessoes: inteiro(l.sessoes),
    sessoesComErro: inteiro(l.sessoes_com_erro),
    // Os DOIS de defeito não têm recorte de tempo, ao contrário dos dois de cima: ver
    // `SAUDE_POR_RELEASE`. "Quantos defeitos nasceram nesta build" é propriedade da BUILD, e
    // recortá-la pela janela faria uma build recém-implantada parecer limpa por não ter tido
    // tempo, que é a afirmação oposta à útil.
    defeitosNovos: inteiro(l.defeitos_novos),
    regressoes: inteiro(l.regressoes),
  }));
}
