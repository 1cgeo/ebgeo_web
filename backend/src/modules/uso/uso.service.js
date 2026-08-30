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
 * CINCO CONSULTAS EM PARALELO, com o mesmo par (início, fim). Elas são independentes e nada
 * aqui é transacional de propósito: um relatório não precisa de instantâneo consistente do
 * banco, e abrir transação para cinco `SELECT` prenderia uma conexão do pool de dez que
 * serve o sync e o `GET /api/config`. O que ELAS PRECISAM compartilhar é a JANELA, e isso
 * se resolve passando os mesmos dois parâmetros, não segurando uma transação.
 */

import { one, any } from '../../database/index.js';
import { parseJanela } from '../../utils/diag-consulta.js';
import { paraEpoch, inteiro } from './uso.horizonte.js';
import {
  HORIZONTE, PESSOAS, ATLAS_RESUMO, TOP_ATLAS,
  PRODUCAO_POR_ENTIDADE, PRODUCAO_POR_DIA,
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

  const [horizonte, pessoas, atlas, top, porEntidade, porDia] = await Promise.all([
    one(HORIZONTE),
    one(PESSOAS, p),
    one(ATLAS_RESUMO, p),
    any(TOP_ATLAS, [...p, TOP_ATLAS_LIMITE]),
    any(PRODUCAO_POR_ENTIDADE, p),
    any(PRODUCAO_POR_DIA, p),
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
  };
}
