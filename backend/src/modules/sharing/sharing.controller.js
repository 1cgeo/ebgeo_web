// Path: src/modules/sharing/sharing.controller.js
import { asyncHandler } from '../../utils/async-handler.js';
import * as sharingService from './sharing.service.js';
import { broadcastToRoom, getRoomUsers } from '../collab/collab.rooms.js';
import { toFrontendRole } from '../../utils/roles.js';

// Who may receive a `sharing_updated` frame that NAMES a member.
//
// `GET /atlas/:id/sharing` is gated at `manage` (sharing.routes.js) precisely because the atlas
// composition — member UUIDs and each one's level — is management information. The broadcast used
// to go to the whole room, so a Visualizador, a Comentarista, an Editor and even an anonymous
// public-link visitor read over the socket exactly what the REST route answers them with 403.
// (The presence roster already exposes the UUID and name of CONNECTED members; what leaked here on
// top of that is the PERMISSION LEVEL, and the UUID of a member who never connected.)
//
// `{ skipReadOnly: true }` does NOT fix it: it still delivers to `comment` and `write`, both below
// `manage`. Delivery is therefore directed by LEVEL, plus the affected user's own sockets — that
// exception is load-bearing, since the affected peer re-gates its UI live from the `role` field
// (sync-engine.js `sharingUpdated`, which ignores frames naming anybody else). A promoted viewer
// that stopped receiving its own frame would stay stuck in the safe view until reconnect.
//
// The two `public_*` frames below carry no identity — they say only that the atlas was
// published/unpublished — so they stay open to the room on purpose: a viewer needs them.
const MEMBER_FRAME_GATE = 'manage';

// O NÍVEL QUE VIAJA NA FRAME É O EFETIVO, NUNCA O DO VÍNCULO QUE MUDOU — e isso vale para
// os DOIS eixos, não só para o de grupo.
//
// Desde 2026-08-21 uma pessoa alcança o atlas por dois caminhos ao mesmo tempo (share
// direto e share de grupo), e o cliente aplica `sessionContext.updateRole(msg.role)` cru.
// Enquanto o eixo de PESSOA anunciava `req.body.permission`, mexer no share DIRETO de quem
// também está num grupo mais forte rebaixava a barra de ferramentas no cliente por uma
// queda que o servidor nunca fez; e `DELETE` respondia 204 anunciando `user_removed` para
// quem continuava com `manage` por grupo — o gestor via a pessoa sumir da lista e o
// servidor seguia entregando co-Gestão. Era o mesmo RISCO 5.3 que o eixo de grupo fechou,
// na metade espelhada, e o custo de fechá-lo é esta função: uma consulta por mutação.
//
// A AUDIÊNCIA NÃO MUDA (`manage` e acima, mais os sockets do próprio afetado), então o
// gestor continua recebendo a frame mesmo quando o afetado não está conectado — que é a
// razão de esta função NÃO se limitar a quem está na sala, ao contrário do fan-out de
// grupo logo abaixo, onde o alvo é a composição inteira e quem não está conectado
// re-resolveria tudo no próximo handshake.

/**
 * @private Emite UMA frame sobre uma pessoa, com o nível EFETIVO dela neste atlas.
 * @param {string} atlasId
 * @param {string} userId - a pessoa afetada pela mutação.
 * @param {'user_added'|'user_updated'} acao - a ação quando ainda existe nível. Sem nível
 *   nenhum a frame é sempre `user_removed`, que é o que o cliente já sabe ler.
 */
async function broadcastEffectiveForUser(atlasId, userId, acao) {
  const efetivo = await sharingService.effectiveRolesFor(atlasId, [String(userId)]);
  const permission = efetivo.get(String(userId)) ?? null;
  const frame = permission
    ? {
      type: 'sharing_updated',
      action: acao,
      userId,
      permission,
      // Frontend role for the affected user, so a connected peer re-gates its UI live
      // (per-atlas only; a global admin keeps full access and ignores this on the client).
      role: toFrontendRole(permission),
    }
    : { type: 'sharing_updated', action: 'user_removed', userId };
  broadcastToRoom(atlasId, frame, null, {
    minPermission: MEMBER_FRAME_GATE,
    alsoUserIds: [userId],
  });
}

export const getSharingConfig = asyncHandler(async (req, res) => {
  const config = await sharingService.getSharingConfig(req.atlasId);
  res.json({ data: config });
});

export const enablePublicSharing = asyncHandler(async (req, res) => {
  const result = await sharingService.enablePublicSharing(req.atlasId, req.user?.id ?? null, req);
  broadcastToRoom(req.atlasId, { type: 'sharing_updated', action: 'public_enabled' });
  res.json({ data: result });
});

export const disablePublicSharing = asyncHandler(async (req, res) => {
  await sharingService.disablePublicSharing(req.atlasId, req.user?.id ?? null, req);
  broadcastToRoom(req.atlasId, { type: 'sharing_updated', action: 'public_disabled' });
  res.status(204).send();
});

export const addUserShare = asyncHandler(async (req, res) => {
  const share = await sharingService.addUserShare(
    req.atlasId,
    req.body.userId,
    req.body.permission,
    req.user.id,
    req
  );
  await broadcastEffectiveForUser(req.atlasId, req.body.userId, 'user_added');
  res.status(201).json({ data: share });
});

export const updateUserShare = asyncHandler(async (req, res) => {
  const share = await sharingService.updateUserShare(
    req.atlasId,
    req.params.userId,
    req.body.permission,
    req.user?.id ?? null,
    req
  );
  await broadcastEffectiveForUser(req.atlasId, req.params.userId, 'user_updated');
  res.json({ data: share });
});

export const removeUserShare = asyncHandler(async (req, res) => {
  await sharingService.removeUserShare(req.atlasId, req.params.userId, req.user?.id ?? null, req);
  // `user_updated` QUANDO SOBRA CAMINHO. Tirar o share direto de quem também alcança por
  // grupo (ou de quem lê porque o atlas é público) não remove ninguém, e a frame precisa
  // dizer o que sobrou em vez de anunciar uma remoção que não aconteceu.
  await broadcastEffectiveForUser(req.atlasId, req.params.userId, 'user_updated');
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// O EIXO DE GRUPO: DUAS frames por mutação, e a segunda é a que evita um defeito caro.
// ---------------------------------------------------------------------------
//
// (1) UMA frame de COMPOSIÇÃO (`group_added` / `group_updated` / `group_removed`), só para
//     `manage` e acima. Ela nomeia o grupo e o nível do vínculo, que é informação de
//     gestão pela mesma razão que a lista de membros é: diz quem alcança o atlas.
//
// (2) UMA frame POR MEMBRO CONECTADO, com a permissão EFETIVA daquela pessoa, recalculada.
//
// A SEGUNDA NÃO É REDUNDÂNCIA, É O FIX. `sync-engine.js` (`sharingUpdated`) faz
// `sessionContext.updateRole(msg.role)` cru. Uma frame única carregando o nível do GRUPO
// rebaixaria no cliente quem tem share direto MAIOR: X com `manage` direto, num atlas que
// recebe um grupo `read`, veria a barra de ferramentas sumir sem motivo — e voltar no F5,
// porque o servidor nunca rebaixou nada. É a forma mais cara de defeito de UI:
// irreproduzível para quem reporta, invisível para quem investiga. Por isso o nível vem de
// `effectiveRolesFor`, NUNCA do vínculo que mudou.
//
// O FAN-OUT É LIMITADO A QUEM ESTÁ NA SALA, e não ao tamanho do grupo: quem não está
// conectado não tem UI para re-gatear, e re-resolveria tudo no próximo handshake. O custo
// fica proporcional à sala.

/**
 * @private Emite a frame por membro afetado que está NA SALA, com o nível EFETIVO de cada
 * um. `null` (perdeu todo caminho) vira `user_removed`, que é a frame que o cliente já
 * sabe ler.
 * @param {string} atlasId
 * @param {string[]} memberIds - os membros do grupo tocado.
 */
async function broadcastEffectiveForMembers(atlasId, memberIds) {
  const naSala = new Set(getRoomUsers(atlasId).map((u) => String(u.id)));
  const afetados = [...new Set(memberIds.map(String))].filter((id) => naSala.has(id));
  if (afetados.length === 0) return;

  const efetivo = await sharingService.effectiveRolesFor(atlasId, afetados);
  for (const userId of afetados) {
    const permission = efetivo.get(userId) ?? null;
    const frame = permission
      ? {
        type: 'sharing_updated',
        action: 'user_updated',
        userId,
        permission,
        role: toFrontendRole(permission),
      }
      : { type: 'sharing_updated', action: 'user_removed', userId };
    broadcastToRoom(atlasId, frame, null, {
      minPermission: MEMBER_FRAME_GATE,
      alsoUserIds: [userId],
    });
  }
}

export const addGroupShare = asyncHandler(async (req, res) => {
  const share = await sharingService.addGroupShare(
    req.atlasId,
    req.body.groupId,
    req.body.permission,
    req.user.id,
    req
  );
  broadcastToRoom(req.atlasId, {
    type: 'sharing_updated',
    action: 'group_added',
    groupId: req.body.groupId,
    permission: req.body.permission,
  }, null, { minPermission: MEMBER_FRAME_GATE });
  await broadcastEffectiveForMembers(req.atlasId, await sharingService.groupMemberIds(req.body.groupId));
  res.status(201).json({ data: share });
});

export const updateGroupShare = asyncHandler(async (req, res) => {
  const share = await sharingService.updateGroupShare(
    req.atlasId,
    req.params.groupId,
    req.body.permission,
    req.user?.id ?? null,
    req
  );
  broadcastToRoom(req.atlasId, {
    type: 'sharing_updated',
    action: 'group_updated',
    groupId: req.params.groupId,
    permission: req.body.permission,
  }, null, { minPermission: MEMBER_FRAME_GATE });
  await broadcastEffectiveForMembers(req.atlasId, await sharingService.groupMemberIds(req.params.groupId));
  res.json({ data: share });
});

export const removeGroupShare = asyncHandler(async (req, res) => {
  // OS MEMBROS SÃO LIDOS ANTES DA REMOÇÃO, e a ordem é o ponto: depois dela o vínculo já
  // não existe, mas a composição do GRUPO continua (o que sai é a linha de `atlas_shares`).
  // Ler antes mantém o alvo do fan-out estável mesmo se alguém mexer no grupo no meio.
  const membros = await sharingService.groupMemberIds(req.params.groupId);
  await sharingService.removeGroupShare(req.atlasId, req.params.groupId, req.user?.id ?? null, req);
  broadcastToRoom(req.atlasId, {
    type: 'sharing_updated',
    action: 'group_removed',
    groupId: req.params.groupId,
  }, null, { minPermission: MEMBER_FRAME_GATE });
  await broadcastEffectiveForMembers(req.atlasId, membros);
  res.status(204).send();
});
