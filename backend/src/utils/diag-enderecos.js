// Path: src/utils/diag-enderecos.js
/**
 * @fileoverview OS ENDEREÇOS DISTINTOS que falaram com o servidor numa janela: a parte PURA.
 *
 * Pedido do dono em 2026-09-22: "na parte de monitoramento do admin poder ver os IPs distintos que
 * estão usando o EBGeo ou usaram o EBGeo". A resposta NÃO precisou de instrumentação nova, e é isso
 * que molda o arquivo: `requestLogPayload` (`src/middleware/request-logger.js`) já carimba `ip`,
 * `userId` e `sessaoId` em TODA linha de requisição desde 2026-08-31, e o `.jsonl` é guardado por
 * `LOG_RETENTION_DAYS` dias. O que faltava era a pergunta, não o dado.
 *
 * AS DUAS PORTAS COMPARTILHAM ESTE ACUMULADOR, e só ele, pela regra de sempre desta camada: a rota
 * (`GET /api/v1/diag/enderecos`, que lê pelo anel de 200 mil de `lerJanela`) e o comando
 * (`npm run diag -- enderecos`, que lê em fluxo e sem teto) respondem à MESMA pergunta, e uma
 * segunda implementação da contagem faria as duas divergirem no dia em que alguém consertasse uma.
 * O acumulador recebe um registro por vez e não sabe de onde ele veio.
 *
 * ─── O QUE CONTA COMO REQUISIÇÃO ───
 *
 * SÓ A LINHA DO `request-logger`, reconhecida pela ESTRUTURA (`statusCode` numérico), nunca pela
 * mensagem. Três produtores escrevem `ip` neste log, e contar os três inflaria o número de quem os
 * dispara: a recusa do limitador (`limiterDenialPayload`, sem `statusCode`, uma por janela do
 * limitador) e o acesso ao gazetteer (`nomes-access-log.js`, sem `statusCode`, uma a MAIS por
 * busca) repetiriam requisições que a linha de requisição já contou. É o MESMO denominador do pulso
 * (`criarResumoDeStatus`), e isso é propriedade conferida por teste: a soma das requisições por
 * endereço, mais as sem endereço, é o `total` do pulso sobre as mesmas linhas.
 *
 * ─── QUEM É CONTA ───
 *
 * O `userId` da linha tem TRÊS formas, e só uma é conta. UUID é uma linha de `users`. `public-<uuid>`
 * é o visitante de LINK PÚBLICO, cujo identificador sintético não representa pessoa nenhuma, e ele é
 * ANÔNIMO aqui como nos três canais de telemetria (tratá-lo como conta é o erro que faz relatório
 * inventar usuário). Ausente é o anônimo propriamente dito. Qualquer outra forma cai no anônimo,
 * porque a direção segura do erro é deixar de atribuir, nunca atribuir a quem não foi.
 *
 * ─── O QUE ISTO NÃO MEDE ───
 *
 *   - Não mede PESSOAS nem MÁQUINAS: um endereço é o que o servidor viu depois do proxy reverso
 *     (`TRUST_PROXY_HOPS`), e numa rede com NAT ele pode ser uma organização inteira.
 *   - "Usando agora" é TRÁFEGO, não presença: é o endereço com pelo menos uma requisição nos últimos
 *     `JANELA_DE_AGORA_MS`. Não lê o código de presença, de propósito (outro módulo, outra pergunta).
 *   - A "primeira vez visto" é a primeira DENTRO DA JANELA, e não a de sempre.
 *   - As ABAS (`sessoes`) são um piso: só entra quem mandou o cabeçalho `X-EBGeo-Sessao`.
 *
 * ZERO EFEITOS, e o único import é `enderecoDe`, a leitura do campo que o relatório de erros já usa:
 * uma segunda leitura aqui divergiria dela.
 */

import { enderecoDe } from './diag-consulta.js';

/**
 * O valor que `clientAddress` escreve quando o socket não tinha endereço.
 *
 * DUPLICADO DE `UNKNOWN_ADDRESS` (`src/middleware/request-logger.js`) de propósito, e preso por
 * teste: aquele arquivo importa o logger, que importa `config.js`, que exige `DATABASE_URL` na
 * avaliação, e este módulo é carregado pelos comandos de log que existem para responder quando o
 * banco não está de pé. `tests/unit/diag-enderecos.test.js` importa os dois e exige igualdade.
 */
export const ENDERECO_INDETERMINADO = 'unknown';

/**
 * A largura do "usando agora", em ms: cinco minutos.
 *
 * É TRÁFEGO, não presença, e o número é escolha de leitura e não medição: uma aba aberta faz
 * requisição com frequência muito maior que isso (o pulso de monitoramento, o flush de sync, o
 * config), e uma aba em segundo plano sofre o estrangulamento de timer do navegador, que é de
 * minuto. Cinco minutos cobre as duas sem virar "hoje".
 */
export const JANELA_DE_AGORA_MS = 5 * 60_000;

/**
 * Quantas contas cada endereço NOMEIA, no máximo.
 *
 * O TETO EXISTE POR CAUSA DO NAT: atrás de um endereço só pode estar uma OM inteira, e uma célula
 * de tabela com duzentos nomes deixa de ser lida. As que ficam de fora são CONTADAS
 * (`contasDistintas`), nunca descartadas em silêncio.
 */
export const MAX_CONTAS_POR_ENDERECO = 20;

/**
 * Quantos endereços as DUAS portas publicam quando o chamador não diz. Uma constante e não dois
 * literais (o Joi da rota e o `--limite` do comando), senão a mesma pergunta sairia cortada em
 * tamanhos diferentes conforme a porta, e comparar as duas saídas deixaria de provar alguma coisa.
 */
export const LIMITE_PADRAO_DE_ENDERECOS = 100;

/** As três formas de principal numa linha de requisição. Ver o `fileoverview`. */
export const PrincipalDaLinha = Object.freeze({
  CONTA: 'conta',
  LINK_PUBLICO: 'link-publico',
  ANONIMO: 'anonimo',
});

/** UUID estrito, ancorado: o `sub` de conta e o `sessaoId` têm essa forma e nenhuma outra. */
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O prefixo do `sub` do token de link público. É o mesmo que `principalUserId`
 * (`src/utils/principal.js`) recusa como id de conta.
 */
const PREFIXO_DE_LINK_PUBLICO = 'public-';

/**
 * Qual principal uma linha de requisição carrega.
 * @param {*} userId - o `userId` da linha, como o `request-logger` o escreveu
 * @returns {string} um valor de {@link PrincipalDaLinha}
 */
export function principalDaLinha(userId) {
  if (typeof userId !== 'string' || userId === '') return PrincipalDaLinha.ANONIMO;
  if (RE_UUID.test(userId)) return PrincipalDaLinha.CONTA;
  if (userId.startsWith(PREFIXO_DE_LINK_PUBLICO)) return PrincipalDaLinha.LINK_PUBLICO;
  return PrincipalDaLinha.ANONIMO;
}

/**
 * A linha é a do `request-logger`? O critério é ESTRUTURAL e é o do pulso: ver o `fileoverview`.
 * @param {*} reg
 * @returns {boolean}
 */
function ehLinhaDeRequisicao(reg) {
  return Boolean(reg) && typeof reg === 'object' && typeof reg.statusCode === 'number';
}

/** @param {*} t @returns {number|null} */
function instante(t) {
  return typeof t === 'number' && Number.isFinite(t) ? t : null;
}

/**
 * Ordem das contas dentro de um endereço: mais requisições primeiro, depois a mais recente, e o
 * próprio id como desempate, para que o corte em `MAX_CONTAS_POR_ENDERECO` seja determinístico.
 */
function compararContas(a, b) {
  return b.requisicoes - a.requisicoes
    || (b.ultima ?? -Infinity) - (a.ultima ?? -Infinity)
    || (a.userId < b.userId ? -1 : (a.userId > b.userId ? 1 : 0));
}

/**
 * Ordem dos endereços: o MAIS RECENTE primeiro, que é o que põe "usando agora" no topo e é também o
 * critério do corte (quem pergunta quer o fim da janela). Endereço sem instante nenhum vai para o
 * fim; o desempate é o volume e depois o próprio endereço, para a saída ser determinística.
 */
function compararEnderecos(a, b) {
  return (b.ultima ?? -Infinity) - (a.ultima ?? -Infinity)
    || b.requisicoes - a.requisicoes
    || (a.ip < b.ip ? -1 : (a.ip > b.ip ? 1 : 0));
}

/**
 * O acumulador em FLUXO: um registro por vez, nunca a lista.
 *
 * O QUE ELE RETÉM é proporcional ao número de ENDEREÇOS e de abas da janela, não ao de linhas: um
 * contador por endereço, um conjunto de ids de aba e um mapa de contas. Numa rede fechada isso é
 * pequeno por construção; o preço declarado é que um volume patológico de endereços (varredura
 * IPv6, por exemplo) cresce este mapa, e na rota o anel de 200 mil já limita quantas linhas chegam
 * aqui. O comando não tem teto, e roda no host, fora do ciclo de requisição.
 *
 * @param {{agora?: number, recenteMs?: number}} [opcoes] - `agora` é o fim da janela em epoch ms,
 *   e decide o `recente` de cada endereço
 * @returns {{ver: (reg: Object) => void, resultado: (o?: {limite?: number}) => Object}}
 */
export function criarRelatorioDeEnderecos({ agora = Date.now(), recenteMs = JANELA_DE_AGORA_MS } = {}) {
  const porIp = new Map();
  let requisicoes = 0;
  let semEndereco = 0;

  return {
    ver(reg) {
      if (!ehLinhaDeRequisicao(reg)) return;
      const ip = enderecoDe(reg);
      // SEM ENDEREÇO NÃO É ANÔNIMO, e a contagem é separada por isso: é linha anterior ao campo
      // (ele nasceu em 2026-08-31), e somá-la a qualquer endereço inventaria de onde ela veio.
      if (!ip) { semEndereco += 1; return; }
      requisicoes += 1;

      let e = porIp.get(ip);
      if (!e) {
        e = {
          ip, primeira: null, ultima: null, requisicoes: 0, comErro: 0,
          sessoes: new Set(), contas: new Map(), anonimas: 0, deLinkPublico: 0,
        };
        porIp.set(ip, e);
      }
      const t = instante(reg.time);
      e.requisicoes += 1;
      if (reg.statusCode >= 400) e.comErro += 1;
      if (t !== null) {
        if (e.primeira === null || t < e.primeira) e.primeira = t;
        if (e.ultima === null || t > e.ultima) e.ultima = t;
      }
      // A ABA SÓ ENTRA COM A FORMA QUE O PRODUTOR GARANTE (`sessaoDaRequisicao` só grava UUID): uma
      // linha editada à mão ou de outro produtor não pode inflar a contagem de abas com lixo.
      if (typeof reg.sessaoId === 'string' && RE_UUID.test(reg.sessaoId)) e.sessoes.add(reg.sessaoId);

      const tipo = principalDaLinha(reg.userId);
      if (tipo === PrincipalDaLinha.CONTA) {
        let c = e.contas.get(reg.userId);
        if (!c) { c = { userId: reg.userId, requisicoes: 0, ultima: null }; e.contas.set(reg.userId, c); }
        c.requisicoes += 1;
        if (t !== null && (c.ultima === null || t > c.ultima)) c.ultima = t;
        return;
      }
      e.anonimas += 1;
      if (tipo === PrincipalDaLinha.LINK_PUBLICO) e.deLinkPublico += 1;
    },

    /**
     * @param {{limite?: number}} [o] - quantos endereços publicar; ausente, todos
     * @returns {Object}
     */
    resultado({ limite } = {}) {
      const corte = Number.isInteger(limite) && limite > 0 ? limite : null;
      const todos = [...porIp.values()].map((e) => ({
        ip: e.ip,
        // O SENTINELA VIRA BANDEIRA, e não fica só como texto: a tela precisa dizer "não
        // determinável" sem conhecer a string de outro pacote.
        indeterminado: e.ip === ENDERECO_INDETERMINADO,
        primeira: e.primeira,
        ultima: e.ultima,
        // `<=` e não `<`, e sem piso de futuro: um relógio adiantado de alguns segundos entre o
        // processo que escreveu e o que lê não pode tirar do "agora" a requisição que acabou de
        // chegar.
        recente: e.ultima !== null && agora - e.ultima <= recenteMs,
        requisicoes: e.requisicoes,
        comErro: e.comErro,
        sessoes: e.sessoes.size,
        anonimas: e.anonimas,
        deLinkPublico: e.deLinkPublico,
        contasDistintas: e.contas.size,
        contas: [...e.contas.values()].sort(compararContas).slice(0, MAX_CONTAS_POR_ENDERECO),
      })).sort(compararEnderecos);

      return {
        // A PREMISSA DO "AGORA" VIAJA NO DOCUMENTO, e não fica só na tela: sem ela `recentes: 3` não
        // diz "três nos últimos cinco minutos", diz um número sobre uma janela que ninguém vê.
        recenteMs,
        // AS CONTAGENS SÃO DE ANTES DO CORTE, pela regra da casa: sem elas, cem endereços na tela
        // são indistinguíveis de cem que eram quatro mil.
        distintos: todos.length,
        recentes: todos.filter((e) => e.recente).length,
        requisicoes,
        semEndereco,
        limite: corte,
        enderecos: corte === null ? todos : todos.slice(0, corte),
      };
    },
  };
}

/**
 * A fachada para quem já tem a janela em memória (a rota, sob o anel de `lerJanela`).
 * @param {Object[]} registros
 * @param {{agora?: number, recenteMs?: number, limite?: number}} [opcoes]
 * @returns {Object}
 */
export function relatorioDeEnderecos(registros, { agora, recenteMs, limite } = {}) {
  const acumulador = criarRelatorioDeEnderecos({ agora, recenteMs });
  for (const reg of registros) acumulador.ver(reg);
  return acumulador.resultado({ limite });
}

/**
 * Os ids de CONTA citados pelos endereços PUBLICADOS, sem repetição.
 *
 * SÓ OS DA LISTA CORTADA, e não os da janela inteira: a resolução de nome existe para a linha que
 * alguém vai ler, e nomear conta de endereço que não saiu na resposta seria trabalho de banco sem
 * leitor. O teto natural é `limite × MAX_CONTAS_POR_ENDERECO`.
 * @param {{enderecos?: Array<{contas?: Array<{userId: string}>}>}} relatorio
 * @returns {string[]}
 */
export function idsDeContas(relatorio) {
  const ids = new Set();
  for (const e of relatorio?.enderecos ?? []) {
    for (const c of e?.contas ?? []) {
      if (typeof c?.userId === 'string' && RE_UUID.test(c.userId)) ids.add(c.userId);
    }
  }
  return [...ids];
}
