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
export const listAtlasOverview = asyncHandler(async (req, res) => {
  const [atlases, covers, presence] = await Promise.all([
    atlasService.listUserAtlasMembers(req.user.id),
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

export const updateSettings = asyncHandler(async (req, res) => {
  const atlas = await atlasService.updateAtlasSettings(req.atlasId, req.body);
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
    details: { via: 'clone', sourceAtlasId: req.atlasId },
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
