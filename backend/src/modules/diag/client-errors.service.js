// Path: src/modules/diag/client-errors.service.js
/**
 * @fileoverview Metade B: o erro do NAVEGADOR, que sem isto não existia em lugar nenhum.
 */

import { none, any } from '../../database/index.js';
import { parseJanela } from '../../utils/diag-consulta.js';
import { UPSERT_CLIENT_ERROR, LIST_CLIENT_ERRORS } from './client-errors.queries.js';

/** `''` é o que um cliente manda quando não tem o campo; no banco isso é NULL. */
const vazioVirando = (v) => (v === undefined || v === null || v === '' ? null : v);

/**
 * Registra (ou incrementa) um erro de navegador.
 *
 * `userId` é PARÂMETRO, e é o chamador (o controller) que o tira de `req.user`. Escrever
 * `relato.userId` aqui seria aceitar do corpo a identidade de quem relata, ou seja,
 * deixar qualquer anônimo carimbar um erro no nome de outra pessoa. A assinatura desta
 * função existe assim para que esse erro precise ser cometido de propósito.
 *
 * @param {Object} relato - o corpo já validado por Joi (tetos de tamanho aplicados)
 * @param {string|null} userId - o principal autenticado, ou null (anônimo)
 * @returns {Promise<void>}
 */
export async function registrarErroDeCliente(relato, userId) {
  await none(UPSERT_CLIENT_ERROR, [
    relato.assinatura,
    relato.mensagem,
    vazioVirando(relato.stack),
    vazioVirando(relato.url),
    vazioVirando(relato.pagina),
    vazioVirando(relato.userAgent),
    vazioVirando(relato.release),
    userId ?? null,
    vazioVirando(relato.atlasId),
  ]);
}

/**
 * Os erros de navegador da janela, do mais recente para o mais antigo.
 *
 * A janela é aplicada sobre `ultima_em` e não sobre `primeira_em`: o que interessa é o
 * defeito que AINDA está acontecendo. Um erro que nasceu há um mês e disparou hoje é o
 * caso mais relevante da lista, e ancorar em `primeira_em` o esconderia.
 *
 * @param {{desde: string, limite: number}} query - já validada
 * @returns {Promise<{desde: number, itens: Object[]}>}
 */
export async function listarErrosDeCliente({ desde, limite }) {
  const inicio = new Date(Date.now() - parseJanela(desde));
  const linhas = await any(LIST_CLIENT_ERRORS, [inicio, limite]);
  return {
    desde: inicio.getTime(),
    itens: linhas.map((l) => ({
      id: l.id,
      assinatura: l.assinatura,
      mensagem: l.mensagem,
      stack: l.stack,
      url: l.url,
      pagina: l.pagina,
      userAgent: l.user_agent,
      release: l.release,
      userId: l.user_id,
      username: l.username,
      atlasId: l.atlas_id,
      ocorrencias: l.ocorrencias,
      // Epoch ms, como toda data desta família de rotas: a metade A carimba `primeira` e
      // `ultima` assim (é o `time` do pino), e duas unidades de tempo na mesma tela é
      // conversão errada esperando para acontecer.
      primeiraEm: new Date(l.primeira_em).getTime(),
      ultimaEm: new Date(l.ultima_em).getTime(),
    })),
  };
}
