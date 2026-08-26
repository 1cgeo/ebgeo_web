// Path: src/modules/atlas/atlas.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import { createAudit } from '../../utils/audit.js';
import * as atlasService from './atlas.service.js';
import { broadcastToRoom, closeRoom } from '../collab/collab.rooms.js';
import * as resourceAccessService from '../resource-access/resource-access.service.js';

/**
 * O CICLO DE VIDA DO ATLAS É AUDITADO AQUI, no controller, porque as quatro escritas
 * envolvidas (criar, importar, clonar, apagar, restaurar) são cada uma UMA query ou
 * uma transação que já fechou quando o controller retoma — não há transação a que
 * aderir. A exceção é a transferência de posse, cuja trilha entra na transação do
 * serviço, onde a corrida pode terminar em rollback.
 *
 * `ATLAS_CREATE` é emitida pelos TRÊS caminhos que criam atlas (criar, importar de
 * um `.ebgeo`, clonar), distinguidos por `details.via`. Uma ação por caminho
 * deixaria "quantos atlas nasceram" dependendo de somar três filtros, e o terceiro
 * seria esquecido: os três produzem a mesma coisa, com origens diferentes.
 */
function auditAtlasCreated(req, atlas, via) {
  return createAudit(req, {
    action: 'ATLAS_CREATE',
    actorId: req.user.id,
    targetType: 'ATLAS',
    targetId: atlas.id,
    targetName: atlas.name,
    details: { via },
  });
}

export const listAtlas = asyncHandler(async (req, res) => {
  const result = await atlasService.listUserAtlas(req.user.id);
  res.json({ data: result });
});

// Tudo que o CARTÃO de projeto desenha além do que `listAtlas` já devolve: participantes, capa e
// quem está conectado agora. Um pedido só, porque a tela desenha os três juntos e três viagens
// deixariam o cartão montando aos pedaços na frente do usuário.
//
// Fora de `listAtlas` de propósito: aquela rota é chamada por quatro superfícies do cliente que
// não desenham nada disto (o controle de conta, a aba Mapas, o nome do atlas), e engordá-la faria
// toda troca de mapa pagar por esta tela.
//
// A REVALIDAÇÃO É O CONSERTO, e a ORDEM aqui é o conserto inteiro. As capas saem como data URI
// base64 num objeto só, sem paginação: MEDIDO em 2026-08-26 (`tests/bench/overview-capas.bench.mjs`,
// capas de 100 kB) são 2,7 MB para N=20, 13,7 MB para N=100 e 27,4 MB para N=200. Serializar isso
// não cede o laço de eventos do Node, então o processo inteiro para, WebSockets de colaboração
// inclusos, e o sintoma aparece no mapa de outra pessoa, nunca nesta tela.
//
// O `etag` padrão do Express já respondia 304 aqui, e não adiantava NADA no servidor: ele deriva o
// ETag do corpo pronto, isto é, depois da consulta das capas, do base64 e do `JSON.stringify`. A
// mesma bancada mediu 0,2696 s no 304 contra 0,2928 s no 200 com N=200. Por isso o ETag vem de
// `listUserAtlasMembers`, que NÃO projeta `bytes`, e a decisão de 304 acontece ANTES de as capas
// serem pedidas ao banco. Voltar a embrulhar as três consultas num `Promise.all` desfaz o conserto
// sem apagar uma linha dele.
//
// O CORPO DO 200 NÃO MUDA. É o que mantém intactos os sete pontos do cliente que leem `covers` e o
// contrato que `tests/integration/atlas-cartao-projeto.test.js` prende com data URIs literais.
//
// `private, no-cache` é "guarde e revalide", não "não guarde": é ele que faz o navegador mandar o
// `If-None-Match` em toda visita. O `Vary: Authorization` existe porque a resposta depende de QUEM
// pergunta, e sem ele a resposta de uma conta poderia ser servida à conta seguinte no mesmo
// navegador. `res.vary()` e não `setHeader`, porque o CORS já escreveu `Vary: Origin` nesta
// resposta e atribuir o cabeçalho apagaria aquilo.
export const listAtlasOverview = asyncHandler(async (req, res) => {
  const atlases = await atlasService.listUserAtlasMembers(req.user.id);
  res.setHeader('ETag', atlasService.overviewETag(atlases));
  res.setHeader('Cache-Control', 'private, no-cache');
  res.vary('Authorization');
  // `req.fresh` e não uma comparação à mão com `if-none-match`: ele já trata a lista de ETags, o
  // `*`, o prefixo fraco `W/` e o `Cache-Control: no-cache` que o recarregamento forçado manda.
  if (req.fresh) return res.status(304).end();

  const [covers, presence] = await Promise.all([
    atlasService.listUserAtlasCovers(req.user.id),
    atlasService.listUserAtlasPresence(req.user.id),
  ]);
  res.json({ data: { atlases, covers, presence } });
});

// Só a presença, para a atualização periódica: é o único dos três que muda sozinho, e repetir as
// capas a cada ciclo seria mandar centenas de kB para descobrir que ninguém entrou.
export const listAtlasPresence = asyncHandler(async (req, res) => {
  const presence = await atlasService.listUserAtlasPresence(req.user.id);
  res.json({ data: presence });
});

export const setAtlasCover = asyncHandler(async (req, res) => {
  const cover = await atlasService.setAtlasCover(req.atlasId, req.body, req.user.id);
  res.json({ data: cover });
});

export const deleteAtlasCover = asyncHandler(async (req, res) => {
  await atlasService.deleteAtlasCover(req.atlasId);
  res.status(204).send();
});

export const createAtlas = asyncHandler(async (req, res) => {
  const atlas = await atlasService.createAtlas(req.user.id, req.body);
  await auditAtlasCreated(req, atlas, 'create');
  res.status(201).json({ data: atlas });
});

export const getAtlas = asyncHandler(async (req, res) => {
  const atlas = await atlasService.getAtlasById(req.atlasId);
  res.json({ data: atlas });
});

export const updateAtlas = asyncHandler(async (req, res) => {
  const atlas = await atlasService.updateAtlas(req.atlasId, req.body);
  broadcastToRoom(req.atlasId, { type: 'atlas_updated', data: atlas });
  res.json({ data: atlas });
});

export const deleteAtlas = asyncHandler(async (req, res) => {
  const atlas = await atlasService.deleteAtlas(req.atlasId);
  // A TRILHA ANTES DO `closeRoom`: derrubar a sala é efeito colateral irreversível
  // sobre sockets vivos, e ordená-la depois deixaria a exclusão sem registro se a
  // trilha falhasse — mas com todo mundo já expulso.
  await createAudit(req, {
    action: 'ATLAS_DELETE',
    actorId: req.user.id,
    targetType: 'ATLAS',
    targetId: atlas.id,
    targetName: atlas.name,
    // Soft-delete: o atlas vai para a lixeira e `ATLAS_RESTORE` é o inverso. Dizer
    // `soft` impede a leitura de que a exclusão foi definitiva.
    details: { soft: true, ownerId: atlas.owner_id },
  });
  closeRoom(req.atlasId, { type: 'atlas_deleted', atlasId: req.atlasId });
  res.status(204).send();
});

// A global admin sees and restores every trashed atlas, not only their own: an atlas trashed by
// an owner who was later deactivated belongs to nobody who can act on it, so without this branch
// it is unreachable forever (bugs-backend #95). `req.user.role` is re-read from the database by
// the `auth` middleware on every request, so a demoted admin does not keep the power.
export const listTrash = asyncHandler(async (req, res) => {
  const result = await atlasService.listDeletedUserAtlas(req.user.id, req.user.role === 'admin');
  res.json({ data: result });
});

// A BUSCA DE ATLAS DO ADMINISTRADOR.
//
// O achado que ela fecha: `requireAtlasPermission` faz curto-circuito por `role === 'admin'`, de
// modo que o administrador tem POSSE em todo atlas — e não conseguia ALCANÇAR nenhum alheio, por
// falta de rota. A metade morta já tinha caminho (`listTrash` acima); a viva não tinha nenhum.
//
// ELA É BUSCA E NÃO LISTA, por decisão do dono (2026-08-24): a enumeração do acervo nasce sob
// controle explícito. Quem impõe isso são DOIS pontos, e nenhum é este controller: o Joi
// (`q` obrigatório, com piso de tamanho) e o próprio serviço, que relança se o termo não chegar.
// Aqui não há ramo de "sem termo" para escrever — é o que impede que ele apareça por descuido.
//
// SEM TRILHA DE AUDITORIA, e a omissão é deliberada e tem custo declarado: `audit_trail.action` é
// um CHECK fechado, e uma ação nova arrasta um par DROP/ADD CONSTRAINT mais uma linha em
// `EXCECOES_DESTRUTIVAS`. O ato aqui é de LEITURA, e a leitura que de fato move alguma coisa
// (restaurar, transferir posse) já deixa linha. Se a busca passar a ser o degrau de um fluxo
// destrutivo, é ali que a trilha entra, não aqui.
export const searchAtlasAsAdmin = asyncHandler(async (req, res) => {
  const { results, truncated } = await atlasService.searchAllAtlas(req.query.q, req.query.limit);
  res.json({ data: { term: req.query.q, results, truncated } });
});

export const restoreAtlas = asyncHandler(async (req, res) => {
  const byAdmin = req.user.role === 'admin';
  const atlas = await atlasService.restoreAtlas(req.params.atlasId, req.user.id, byAdmin);
  await createAudit(req, {
    action: 'ATLAS_RESTORE',
    actorId: req.user.id,
    targetType: 'ATLAS',
    targetId: atlas.id,
    targetName: atlas.name,
    // `byAdmin` separa o dono desfazendo a própria exclusão do administrador global
    // desatolando um atlas cujo dono foi desativado — duas histórias diferentes com
    // a mesma ação, e só o detalhe as distingue.
    details: { byAdmin, ownerId: atlas.owner_id },
  });
  res.json({ data: atlas });
});

export const getSettings = asyncHandler(async (req, res) => {
  const settings = await atlasService.getAtlasSettings(req.atlasId);
  res.json({ data: settings });
});

/**
 * O OVERLAY DE DISPONIBILIDADE DO ATLAS PASSA A DEIXAR RASTRO.
 *
 * Ele era o terceiro buraco nomeado do censo de auditoria, e o motivo de fechá-lo é o
 * que o censo já dizia: desligar 3D, 360 ou camadas de dados apaga superfícies inteiras
 * para TODOS os membros do atlas, logo é decisão de acesso, e decisão de acesso deixa
 * linha.
 *
 * `SHARING_CHANGE` É REUSADA DE PROPÓSITO. Ela já é o vocabulário de acesso do atlas
 * (o empréstimo de recurso emite a mesma ação com o mesmo `targetType`), então reusá-la
 * mantém "o que mudou no acesso deste atlas" numa lista só, e não alarga o CHECK de
 * `action`, que arrastaria um par DROP/ADD CONSTRAINT e uma entrada em
 * `EXCECOES_DESTRUTIVAS` para um fato que já tem palavra.
 *
 * `kind: 'settings'` DISCRIMINA os três emissores da ação dentro do alvo ATLAS
 * (`attached`, `detached`, `settings`), pela mesma razão de `details.kind` na poda.
 *
 * SÓ OS NOMES DOS CAMPOS, como no catálogo: as settings carregam listas de ids de
 * recurso, e a trilha é lida por qualquer administrador. O de-para com valores é
 * trabalho de outro lote.
 *
 * `targetOrgId` FICA NULO, e a ausência é a decisão: atlas não tem OM dona (o eixo dele
 * é o dono e os compartilhamentos). Carimbar aqui a OM de LOTAÇÃO do ator seria pior que
 * nada: faria o filtro por OM devolver atos que nada têm a ver com o acervo dela.
 */
export const updateSettings = asyncHandler(async (req, res) => {
  const atlas = await atlasService.updateAtlasSettings(req.atlasId, req.body);
  await createAudit(req, {
    action: 'SHARING_CHANGE',
    actorId: req.user.id,
    targetType: 'ATLAS',
    targetId: req.atlasId,
    targetName: atlas.name,
    details: { kind: 'settings', fields: Object.keys(req.body || {}) },
  });
  broadcastToRoom(req.atlasId, { type: 'atlas_settings_updated', settings: atlas.settings });
  res.json({ data: atlas });
});

export const cloneAtlas = asyncHandler(async (req, res) => {
  const atlas = await atlasService.cloneAtlas(req.atlasId, req.user.id, req.body);
  await createAudit(req, {
    action: 'ATLAS_CREATE',
    actorId: req.user.id,
    targetType: 'ATLAS',
    targetId: atlas.id,
    targetName: atlas.name,
    // `sourceAtlasId` só existe neste ramo: um clone carrega o conteúdo de um atlas
    // que o autor podia LER, e é o único caminho de criação em que a pergunta "de
    // onde veio este dado" tem resposta.
    // `prunedResourceRefs` e a outra metade da mesma resposta: quanto do dado da origem NAO
    // veio, porque o novo dono nao enxerga o recurso. So CONTAGEM por superficie — o nome de
    // um recurso privado e metadado do recurso, e a trilha e lida por administrador do
    // sistema, nao por quem tem a concessao.
    details: {
      via: 'clone',
      sourceAtlasId: req.atlasId,
      prunedResourceRefs: atlas.pruneReport ?? null,
    },
  });
  res.status(201).json({ data: atlas });
});

export const getPublicAtlas = asyncHandler(async (req, res) => {
  const atlas = await atlasService.getAtlasByPublicLink(req.params.link);
  res.json({ data: atlas });
});

export const importAtlas = asyncHandler(async (req, res) => {
  const result = await atlasService.importAtlas(req.user.id, req.body);
  await createAudit(req, {
    action: 'ATLAS_CREATE',
    actorId: req.user.id,
    targetType: 'ATLAS',
    targetId: result.id,
    targetName: result.name,
    // O resumo da importação já vem pronto do serviço e é o que diz o TAMANHO do
    // que entrou por uma rota que não passa pelo sync.
    details: { via: 'import', summary: result.summary ?? null },
  });
  res.status(201).json({ data: result });
});

export const duplicateMap = asyncHandler(async (req, res) => {
  const newMap = await atlasService.duplicateMap(req.atlasId, req.params.mapId);
  broadcastToRoom(req.atlasId, { type: 'map_duplicated', mapId: newMap.id });
  res.status(201).json({ data: newMap });
});

export const transferOwnership = asyncHandler(async (req, res) => {
  // req.atlasOwnerId is the CURRENT owner (set by the owner-only guard); req.user may be a
  // global admin acting on someone else's atlas, so we demote req.atlasOwnerId, not req.user.
  // `req` desce ao serviço porque a trilha de `ATLAS_TRANSFER` participa da MESMA
  // transação da troca de posse, que pode terminar em ConflictError e rollback.
  const atlas = await atlasService.transferOwnership(
    req.atlasId, req.atlasOwnerId, req.body.newOwnerId, req
  );
  // Notify the room so clients re-resolve their role + re-gate the UI immediately; the WS
  // heartbeat reconcile is the fallback that adjusts each live socket's cached permission.
  broadcastToRoom(req.atlasId, { type: 'atlas_owner_changed', atlasId: req.atlasId, newOwnerId: req.body.newOwnerId });
  res.json({ data: atlas });
});

// ===== Recursos EMPRESTADOS pelo atlas =====

export const listResources = asyncHandler(async (req, res) => {
  res.json({ data: await resourceAccessService.listAtlasResources(req.atlasId) });
});

export const attachResource = asyncHandler(async (req, res) => {
  const data = await resourceAccessService.attachAtlasResource({
    atlasId: req.atlasId,
    type: req.body.resourceType,
    resourceId: req.body.resourceId,
    actor: req.user,
    req,
  });
  // O broadcast e o que faz o par que ja esta com o atlas aberto ver o recurso
  // novo sem F5. Ele NAO carrega o recurso em si: quem o recebe pede o proprio
  // payload aditivo, porque o conjunto visivel e diferente por pessoa — mandar a
  // lista de um no frame de todos seria vazamento pelo canal de tempo real.
  broadcastToRoom(req.atlasId, { type: 'atlas_resources_updated' });
  res.status(201).json({ data });
});

export const detachResource = asyncHandler(async (req, res) => {
  const data = await resourceAccessService.detachAtlasResource({
    atlasId: req.atlasId,
    type: req.params.type,
    resourceId: req.params.id,
    actor: req.user,
    req,
  });
  broadcastToRoom(req.atlasId, { type: 'atlas_resources_updated' });
  res.json({ data });
});
