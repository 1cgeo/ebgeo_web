// Path: src/modules/catalog/catalog.controller.js
// Controllers are curried by `table` so one set serves every per-type router.
import { existsSync, rmSync } from 'node:fs';
import { asyncHandler } from '../../utils/async-handler.js';
import { BadRequestError } from '../../utils/errors.js';
import * as videoStore from '../catalog-video/catalog-video.store.js';

/** Remove um tmp do multer, sem lançar (o dado autoritativo já é o arquivo de token gravado). */
function cleanTmpFile(p) {
  if (p && existsSync(p)) {
    try { rmSync(p, { force: true }); } catch { /* best-effort */ }
  }
}
import { marcarEscopoJson } from '../../utils/cache-scope.js';
import { createAudit } from '../../utils/audit.js';
import { diffAuditavel } from '../../utils/audit-diff.js';
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
 * AS QUATRO TABELAS TÊM TIPO DE CONCESSÃO (`TYPE_BY_TABLE`), então na prática
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

/**
 * AS DUAS LEITURAS MARCAM ESCOPO DE CACHE, pela mesma peça do 360
 * (`utils/cache-scope.js`), e não por simetria: o corpo delas varia por papel global,
 * por escopo de produção, por concessão pessoal e pelo empréstimo do `?atlasId=`.
 * Elas não emitiam `Cache-Control` NENHUM, o que autoriza um cache compartilhado a
 * guardar por heurística e repor a resposta de um membro para quem não a alcança.
 *
 * A isenção do RFC 9111 para `Authorization` não cobre isto: `flexibleAuth` também
 * autentica por cookie, e a requisição de cookie chega sem aquele cabeçalho.
 */
export const list = (table) => asyncHandler(async (req, res) => {
  const data = await svc.listCatalog(table, visibleTo(req, table));
  marcarEscopoJson(req, res);
  res.json({ data });
});

export const get = (table) => asyncHandler(async (req, res) => {
  const data = await svc.getCatalogItem(table, req.params.id, visibleTo(req, table));
  marcarEscopoJson(req, res);
  res.json({ data });
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
 * `details` CARREGA UM DE-PARA SELETIVO desde 2026-08-21, e a regra antiga ("só NOME,
 * nunca VALOR") sobrevive como PISO do que ninguém classificou. Quem decide o regime de
 * cada campo é `utils/audit-diff.js`, e o cabeçalho dele é a fonte: valor literal só para
 * uma allowlist de campos pequenos e não-endereçáveis, IMPRESSÃO (HMAC truncado) para
 * endereço e mídia, e nome-só para todo o resto. `config` continua guardando URL de
 * serviço e data URL de miniatura, e nenhum dos dois entra aqui — o de-para responde
 * "mudou? voltou ao que era?" sem carregar o valor.
 *
 * `fields` CONTINUA PRESENTE e não foi substituído: `auditoria-acoes-novas.test.js` o lê,
 * e trocar a forma quebraria um verde que hoje verifica algo real. O de-para é ADITIVO.
 *
 * `targetOrgId` É A OM DONA DA LINHA, e ela vem do ENVELOPE do serviço (a mesma
 * consulta que escreveu), nunca de uma leitura à parte. É o que põe o catálogo no eixo
 * de auditoria por OM: sem ela, o produtor abriria a trilha e não veria o próprio
 * acervo. Ela é a OM DA ÉPOCA por construção — transferir a linha amanhã não reescreve
 * a história de hoje.
 */
export const create = (table) => asyncHandler(async (req, res) => {
  const { row, resurrected, ownerOrgId } = await svc.createCatalogItem(table, req.body, producerActor(req));
  await createAudit(req, {
    action: 'CATALOG_CREATE',
    actorId: principalUserId(req.user),
    targetType: assertAuditTargetTypeOf(table),
    targetId: row.id,
    targetName: row.name,
    targetOrgId: ownerOrgId,
    // `resurrected` distingue duas operações que compartilham a rota: um INSERT e o
    // overwrite total de um id soft-deletado. `ownerOrgId` é o que prova qual OM o
    // produtor carimbou, que é o dado central do eixo de produção.
    details: { table, resurrected, ownerOrgId },
  });
  res.status(201).json({ data: row });
});

export const update = (table) => asyncHandler(async (req, res) => {
  const { row, antes, depois, ownerOrgId } = await svc.updateCatalogItem(
    table, req.params.id, req.body, producerActor(req),
  );
  await createAudit(req, {
    action: 'CATALOG_UPDATE',
    actorId: principalUserId(req.user),
    targetType: assertAuditTargetTypeOf(table),
    targetId: row.id,
    targetName: row.name,
    targetOrgId: ownerOrgId,
    details: { table, fields: Object.keys(req.body || {}), ...diffAuditavel(antes, depois) },
  });
  res.json({ data: row });
});

/**
 * TRANSFERE A OM DONA (`PATCH /:id/owner-org`, só administrador).
 *
 * REUSA A AÇÃO `CATALOG_UPDATE` em vez de cunhar `CATALOG_TRANSFER`, porque um valor novo no
 * `CHECK` de `audit_trail.action` custa uma migração de constraint (cai e volta = destrutivo,
 * com linha em `EXCECOES_DESTRUTIVAS`), e o de-para em `details` já diz que foi transferência.
 * `targetOrgId` É A OM NOVA (a dona a partir de agora): a linha da trilha responde "de quem é
 * hoje", e o `fromOrgId` em `details` guarda de quem era.
 */
export const transferOwner = (table) => asyncHandler(async (req, res) => {
  const { row, fromOrgId, toOrgId } = await svc.transferCatalogItemOwner(
    table, req.params.id, req.body.owner_org_id ?? null,
  );
  await createAudit(req, {
    action: 'CATALOG_UPDATE',
    actorId: principalUserId(req.user),
    targetType: assertAuditTargetTypeOf(table),
    targetId: row.id,
    targetName: row.name,
    targetOrgId: toOrgId,
    details: { table, transfer: true, fromOrgId, toOrgId },
  });
  res.json({ data: row });
});

/**
 * ENVIA o vídeo de prévia (`POST /:id/preview-video`, multipart campo `video`). Salva o arquivo,
 * grava a URL servida em `config.previewVideo` e apaga o vídeo ANTIGO se ele era hospedado aqui.
 *
 * A ORDEM tem uma armadilha: se a gravação no banco falhar DEPOIS de salvar o arquivo, o arquivo
 * novo fica órfão. Por isso o `catch` o apaga (`deleteVideoByUrl` da URL nova). O tmp do multer é
 * sempre limpo. O vídeo antigo só é apagado no caminho de sucesso, e nunca uma URL EXTERNA (o
 * store ignora URL que não é dele).
 */
export const setPreviewVideo = (table) => asyncHandler(async (req, res) => {
  const tmp = req.files?.video?.[0]?.path ?? req.file?.path;
  if (!tmp) throw new BadRequestError('Envie um vídeo no campo "video".');
  let url;
  try {
    url = await videoStore.saveVideo(tmp);
  } finally {
    cleanTmpFile(tmp);
  }
  try {
    const { row, ownerOrgId, oldUrl } = await svc.setCatalogPreviewVideo(
      table, req.params.id, url, producerActor(req),
    );
    videoStore.deleteVideoByUrl(oldUrl);
    await createAudit(req, {
      action: 'CATALOG_UPDATE',
      actorId: principalUserId(req.user),
      targetType: assertAuditTargetTypeOf(table),
      targetId: row.id,
      targetName: row.name,
      targetOrgId: ownerOrgId,
      details: { table, fields: ['previewVideo'] },
    });
    res.json({ data: row });
  } catch (err) {
    videoStore.deleteVideoByUrl(url); // desfaz o arquivo recém-salvo se o banco recusou
    throw err;
  }
});

/**
 * REMOVE o vídeo de prévia (`DELETE /:id/preview-video`). Tira a chave do `config` e apaga o
 * arquivo hospedado, se houver.
 */
export const removePreviewVideo = (table) => asyncHandler(async (req, res) => {
  const { row, ownerOrgId, oldUrl } = await svc.setCatalogPreviewVideo(
    table, req.params.id, null, producerActor(req),
  );
  videoStore.deleteVideoByUrl(oldUrl);
  await createAudit(req, {
    action: 'CATALOG_UPDATE',
    actorId: principalUserId(req.user),
    targetType: assertAuditTargetTypeOf(table),
    targetId: row.id,
    targetName: row.name,
    targetOrgId: ownerOrgId,
    details: { table, fields: ['previewVideo'] },
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
    targetOrgId: row.owner_org_id ?? null,
    // Soft-delete, e dizê-lo importa: `CATALOG_DELETE` não é o fim do id (a rota de
    // criação o ressuscita), e ler a trilha como se fosse produz a conclusão errada.
    details: { table, soft: true },
  });
  res.status(204).send();
});

/**
 * QUANTOS ATLAS REFERENCIAM ESTE ITEM (`GET /:id/references`).
 *
 * É LEITURA COM GATE DE ESCRITA, e a assimetria é o desenho: o número existe para a confirmação
 * de `DELETE /:id`, então quem conta é exatamente quem exclui (`requireCatalogProducer` na rota,
 * `fn_can_produce_resource` no `WHERE` do serviço). Servi-lo com o gate de LEITURA do catálogo
 * transformaria a rota num censo de quantos projetos usam cada recurso, respondível a todo
 * chamador autenticado, que é outro poder.
 *
 * NÃO MARCA ESCOPO DE CACHE como as duas leituras acima, e a razão é a inversa da delas: o corpo
 * NÃO varia por chamador (o número é o mesmo para qualquer um que passe no gate), e ele varia por
 * ATO DE TERCEIRO, a cada op de sync que cria ou apaga uma referência. Nenhum cabeçalho de cache
 * ajuda aqui; o que evita a resposta velha é a tela pedir no momento do clique.
 *
 * SEM TRILHA: é leitura, e o ato que ela precede (`CATALOG_DELETE`) já deixa linha.
 */
export const references = (table) => asyncHandler(async (req, res) => {
  const data = await svc.countAtlasReferences(table, req.params.id, producerActor(req));
  res.json({ data });
});
