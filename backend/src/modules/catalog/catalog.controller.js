// Path: src/modules/catalog/catalog.controller.js
// Controllers are curried by `table` so one set serves every per-type router.
import { asyncHandler } from '../../utils/async-handler.js';
import { createAudit } from '../../utils/audit.js';
import { principalUserId } from '../../utils/principal.js';
import { TYPE_BY_TABLE } from '../resource-access/resource-access.types.js';
import { assertAuditTargetTypeOf } from './catalog.tables.js';
import * as svc from './catalog.service.js';

/**
 * O principal desta requisição, na forma que o predicado de acesso espera.
 *
 * `atlasId` sai da QUERY porque estas rotas não têm o atlas no caminho: o painel
 * pede `GET /api/v1/tilesets?atlasId=...` quando quer ver também o que o atlas em
 * foco empresta. Ausente significa "sem atlas em foco", que é um estado legítimo.
 *
 * DESDE A MIGRAÇÃO 021 AS QUATRO TABELAS TÊM TIPO DE CONCESSÃO, então na prática
 * `resourceType` nunca chega nulo. O `??` fica: ele é o que garante que uma tabela
 * ausente de `TYPE_BY_TABLE` degrade para "sem eixo de concessão" (menos dado) em
 * vez de montar um predicado com `undefined`. Repare que o nulo apaga só o ramo de
 * CONCESSÃO, nunca o principal inteiro: o ramo de PRODUÇÃO precisa sobreviver, ou o
 * produtor não veria a própria linha privada na listagem que ele pode editar.
 */
function visibleTo(req, table) {
  return {
    userId: principalUserId(req.user),
    atlasId: req.query?.atlasId ?? null,
    resourceType: TYPE_BY_TABLE[table] ?? null,
  };
}

/**
 * O ator de uma ESCRITA, na forma que o serviço espera.
 *
 * `req.catalogActor` é posto por `requireCatalogProducer`, que resolveu o escopo NO
 * BANCO. Ele serve para FORÇAR `owner_org_id` na criação, nunca como gate: o gate é
 * o `fn_can_produce_resource` dentro do `WHERE` de cada escrita.
 */
function producerActor(req) {
  return req.catalogActor ?? { id: principalUserId(req.user), producerOrgId: null };
}

export const list = (table) => asyncHandler(async (req, res) => {
  res.json({ data: await svc.listCatalog(table, visibleTo(req, table)) });
});

export const get = (table) => asyncHandler(async (req, res) => {
  res.json({ data: await svc.getCatalogItem(table, req.params.id, visibleTo(req, table)) });
});

/**
 * A TRILHA DO CATÁLOGO MORA AQUI, e não no serviço, por uma razão que não é
 * estilística: este é o único ponto do módulo que tem `req` (ip, user-agent, ator) E
 * `table` ao mesmo tempo. O serviço é curried por tabela mas não conhece a
 * requisição, e o middleware conhece a requisição mas escreve antes da escrita.
 *
 * NENHUMA DAS TRÊS ESCRITAS É TRANSACIONAL (cada uma é uma query só, e a
 * invalidação do memo de `/api/config` já roda fora de transação), então a trilha
 * não recebe `t`: não há transação a que aderir. A consequência honesta é que uma
 * falha da trilha depois de um UPDATE bem-sucedido responde 500 sobre uma escrita
 * que aconteceu — o mesmo comportamento que `organizations.controller.js` já tem, e
 * a alternativa (best-effort) trocaria isso por escrita de catálogo sem rastro, que
 * é justamente o buraco que esta fase fecha.
 *
 * `details` NUNCA carrega VALOR de campo, só NOME (a mesma regra de `USER_UPDATE`):
 * `config` guarda URL de serviço, e a trilha é lida por qualquer administrador.
 */
export const create = (table) => asyncHandler(async (req, res) => {
  const { row, resurrected, ownerOrgId } = await svc.createCatalogItem(table, req.body, producerActor(req));
  await createAudit(req, {
    action: 'CATALOG_CREATE',
    actorId: principalUserId(req.user),
    targetType: assertAuditTargetTypeOf(table),
    targetId: row.id,
    targetName: row.name,
    // `resurrected` distingue duas operações que compartilham a rota: um INSERT e o
    // overwrite total de um id soft-deletado. `ownerOrgId` é o que prova qual OM o
    // produtor carimbou, que é o dado central do eixo de produção.
    details: { table, resurrected, ownerOrgId },
  });
  res.status(201).json({ data: row });
});

export const update = (table) => asyncHandler(async (req, res) => {
  const row = await svc.updateCatalogItem(table, req.params.id, req.body, producerActor(req));
  await createAudit(req, {
    action: 'CATALOG_UPDATE',
    actorId: principalUserId(req.user),
    targetType: assertAuditTargetTypeOf(table),
    targetId: row.id,
    targetName: row.name,
    details: { table, fields: Object.keys(req.body || {}) },
  });
  res.json({ data: row });
});

export const remove = (table) => asyncHandler(async (req, res) => {
  const row = await svc.deleteCatalogItem(table, req.params.id, producerActor(req));
  await createAudit(req, {
    action: 'CATALOG_DELETE',
    actorId: principalUserId(req.user),
    targetType: assertAuditTargetTypeOf(table),
    targetId: row.id,
    targetName: row.name,
    // Soft-delete, e dizê-lo importa: `CATALOG_DELETE` não é o fim do id (a rota de
    // criação o ressuscita), e ler a trilha como se fosse produz a conclusão errada.
    details: { table, soft: true },
  });
  res.status(204).send();
});
