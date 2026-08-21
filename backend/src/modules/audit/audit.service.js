// Path: src/modules/audit/audit.service.js
import { query } from '../../database/index.js';
import * as Q from './audit.queries.js';

/**
 * @typedef {Object} EscopoDeAuditoria
 * @property {boolean} administra - Lê a trilha inteira.
 * @property {string|null} orgId - A OM a que a leitura fica presa quando não administra.
 */

/**
 * Lista a trilha, RECORTADA pelo escopo de quem pergunta.
 *
 * A PRIMEIRA LINHA DO CORPO É O RECORTE, e ela é o ponto inteiro deste lote: a OM não
 * vem da query string do chamador. Quem administra pode ESTREITAR por `targetOrgId`
 * (é filtro, não autorização); quem não administra recebe a OM que o gate resolveu no
 * banco, e o `query.targetOrgId` dele nunca é lido. Trocar esta linha por
 * `query.targetOrgId ?? escopo.orgId` transformaria o recorte num pedido do cliente,
 * que é exatamente o defeito que o gate existe para não ter.
 *
 * ELA MORA NO SERVIÇO E NÃO NO CONTROLLER de propósito: assim o caso que a prova pode
 * montar uma query hostil à mão, sem HTTP, e afirmar sobre os PARÂMETROS que chegam à
 * consulta — o caminho independente daquele que produziu o resultado.
 *
 * O escopo é obrigatório e não tem default permissivo: um chamador que esquecesse de
 * passá-lo levanta, em vez de listar tudo.
 *
 * @param {Object} query - Os filtros já validados pela borda.
 * @param {EscopoDeAuditoria} escopo - Posto por `requireAuditReader`.
 * @returns {Promise<{total: number, page: number, limit: number, data: Array}>}
 */
export async function listAudit(
  { action, actorId, targetType, targetId, targetOrgId, from, to, page, limit },
  escopo,
) {
  if (!escopo || typeof escopo.administra !== 'boolean') {
    throw new Error('listAudit: escopo de auditoria ausente (requireAuditReader não rodou?)');
  }
  const orgId = escopo.administra ? (targetOrgId ?? null) : escopo.orgId;

  const offset = (page - 1) * limit;
  const filtros = [
    action ?? null,
    actorId ?? null,
    targetType ?? null,
    targetId ?? null,
    orgId ?? null,
    from ?? null,
    to ?? null,
  ];
  const [data, count] = await Promise.all([
    query(Q.LIST_AUDIT, [...filtros, limit, offset]),
    query(Q.COUNT_AUDIT, filtros),
  ]);
  return {
    total: count.rows[0].total,
    page,
    limit,
    // O ESCOPO VOLTA NA RESPOSTA porque a tela precisa dele para decidir o que mostrar:
    // uma lista recortada apresentada como completa é a pior leitura possível de uma
    // trilha, e o cliente não pode deduzir o recorte do papel da própria sessão (o gate
    // resolve no BANCO, e o token pode estar 15 min atrás). Quem a aba consome hoje é
    // `administra`, que decide a coluna e o filtro de OM; `escopoOrgId` diz QUAL OM é o
    // recorte e ainda não tem leitor na tela, mas tem nos casos que provam o recorte.
    escopoOrgId: escopo.administra ? null : escopo.orgId,
    administra: escopo.administra,
    data: data.rows,
  };
}
