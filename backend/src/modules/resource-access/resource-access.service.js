// Path: src/modules/resource-access/resource-access.service.js
// Lógica do acesso a recurso privado. O PREDICADO não mora aqui: ele mora nas três
// funções SQL da migração 017. É o que permite dizer "o dado não vaza nem com bug
// de app" — um erro nesta camada não abre nada que o SQL feche.

import { tx } from '../../database/index.js';
import { NotFoundError } from '../../utils/errors.js';
import { createAudit } from '../../utils/audit.js';
import { invalidateAppConfigCache } from '../config/config.cache.js';
import * as Q from './resource-access.queries.js';
import { assertResourceType, tableOf } from './resource-access.types.js';

/**
 * Marca um recurso como público ou privado (gate de administrador na rota).
 *
 * `invalidateAppConfigCache()` roda DEPOIS do commit, nunca dentro (R3). Invalidar
 * dentro da transação reabre a janela na forma de cache: um GET concorrente
 * caindo ali reconstruiria o memo a partir da linha ANTIGA e o re-cacharia,
 * exatamente a janela que a transação acabou de fechar. É a lição de
 * `config-admin-lost-update.repro.test.js`.
 *
 * @param {{type: string, resourceId: string, accessLevel: 'public'|'private', actor: object, req: object}} params
 * @returns {Promise<{id: string, name: string, access_level: string}>}
 */
export async function setResourceVisibility({ type, resourceId, accessLevel, actor, req }) {
  const t = assertResourceType(type);
  const table = tableOf(t);

  const row = await tx(async (trx) => {
    const updated = table
      ? await trx.oneOrNone(Q.setCatalogAccessLevel(table), [accessLevel, resourceId])
      : await trx.oneOrNone(Q.SET_360_ACCESS_LEVEL, [accessLevel, resourceId]);
    if (!updated) throw new NotFoundError('Resource');
    // O ALVO VIAJA EM `details`, E NÃO NAS COLUNAS DE ALVO. Duas restrições do
    // schema de auditoria (001_core.sql) obrigam a isso, e o plano de origem só
    // conferiu a primeira das três colunas:
    //   - `action` tem CHECK, e 'SHARING_CHANGE' já está reservado. Essa parte bate.
    //   - `target_type` tem CHECK PRÓPRIO, limitado a USER/GROUP/MODEL/ZONE/
    //     SYSTEM/ATLAS/ORG. Não existe valor para "camada de dados", e 'MODEL'
    //     seria mentira para três dos quatro tipos.
    //   - `target_id` é UUID, e o id de recurso de catálogo é um SLUG TEXTUAL.
    //     Gravá-lo ali levanta 22P02, que o errorHandler devolve como HTTP 400 —
    //     foi exatamente assim que este defeito apareceu, com a rota respondendo
    //     400 sem nenhuma relação aparente com auditoria.
    // Alargar os dois exigiria DDL destrutiva (DROP CONSTRAINT e ALTER COLUMN
    // TYPE) por uma linha de log. `SYSTEM` + `details` é aditivo e não perde
    // informação nenhuma: o tipo e o id continuam consultáveis, em JSONB.
    await createAudit(req, {
      action: 'SHARING_CHANGE',
      actorId: actor.id,
      targetType: 'SYSTEM',
      targetId: null,
      targetName: updated.name,
      details: { resourceType: t, resourceId, accessLevel },
    }, trx);
    return updated;
  });

  invalidateAppConfigCache();
  return row;
}
