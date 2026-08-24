// Path: src/modules/organizations/organizations.service.js
// The organizations table is served to the ANONYMOUS GET /api/config (`organizacoesMilitares`,
// for the signup dropdowns), so every write here drops the memoized payload — see config.cache.js.
import { query } from '../../database/index.js';
import { NotFoundError, ConflictError } from '../../utils/errors.js';
import { getLiveAuthState } from '../../utils/org-status.js';
import { invalidateAppConfigCache } from '../config/config.cache.js';
import * as Q from './organizations.queries.js';

/**
 * A LOTAÇÃO VIVA do ator, lida do BANCO e nunca do token.
 *
 * `middleware/auth.js` reconcilia papel e escopo de produção a cada requisição e
 * deliberadamente NÃO reconcilia `organization_id`: a lotação não autoriza nada, então a
 * claim dela pode ficar até `JWT_ACCESS_EXPIRY` desatualizada, e um administrador que
 * acabou de ser movido de OM carrega a antiga. Uma guarda de auto-bloqueio escrita sobre
 * `req.user.organization_id` erraria nos DOIS sentidos por essa janela: recusaria a
 * desativação da OM que ele já não ocupa e liberaria a da OM em que ele acabou de entrar,
 * que é justamente a que o tranca para fora. A coluna que decide o bloqueio é
 * `users.organization_id` no banco (é ela que `LIVE_AUTH_STATE` junta), então é ela que a
 * guarda tem de ler.
 *
 * @param {string|null|undefined} actingUserId
 * @returns {Promise<string|null>} A OM de lotação, ou null (sem ator, ator sem OM).
 */
async function lotacaoVivaDoAtor(actingUserId) {
  if (!actingUserId) return null;
  const live = await getLiveAuthState(actingUserId);
  return live?.organizationId ?? null;
}

/**
 * Recusa a desativação da OM em que o próprio requisitante está lotado.
 *
 * C1 — o botão "Desativar" do painel de pessoal é a única escrita do sistema capaz de
 * trancar quem a executa. `LIVE_AUTH_STATE` passa a devolver `org_is_active: false` para
 * toda conta LOTADA na OM, e o middleware `auth` estrito responde 403 ANTES de adotar o
 * papel global do banco, então `requireAdmin` nunca chega a rodar: não sobra caminho pela
 * API para desfazer o próprio ato, e login e refresh também recusam. Só um acesso direto
 * ao banco reverte.
 *
 * ESPELHA a guarda de conta em `modules/users/users.service.js` ("Você não pode desativar
 * a própria conta."), pelo mesmo motivo e com o mesmo status: 409, porque o pedido é
 * legítimo e coerente, mas conflita com o estado de quem o faz. Só o eixo de LOTAÇÃO é
 * guardado — desativar a OM PRODUTORA de alguém tira a escrita daquela pessoa, o que é
 * exatamente o efeito pretendido, e não tranca ninguém para fora.
 *
 * @param {string} orgId - OM que se quer desativar.
 * @param {string|null} actingUserId - Quem está pedindo (null = caminho sem ator).
 * @returns {Promise<void>}
 * @throws {ConflictError} Quando a OM é a de lotação do requisitante.
 */
async function assertNaoEhAPropriaLotacao(orgId, actingUserId) {
  const lotacao = await lotacaoVivaDoAtor(actingUserId);
  if (lotacao && lotacao === orgId) {
    throw new ConflictError(
      'Você não pode desativar a organização militar em que está lotado: '
      + 'a desativação bloqueia todas as contas lotadas nela, inclusive a sua, e o bloqueio '
      + 'acontece antes de o servidor consultar o seu papel de administrador.'
    );
  }
}

export async function listOrganizations() {
  const { rows } = await query(Q.LIST_ORGANIZATIONS);
  return rows;
}

export async function getOrganization(id) {
  const { rows } = await query(Q.FIND_ORGANIZATION, [id]);
  if (rows.length === 0) throw new NotFoundError('Organization');
  return rows[0];
}

export async function createOrganization(data) {
  const { rows: existing } = await query(Q.CHECK_SLUG, [data.slug]);
  if (existing.length > 0) throw new ConflictError('Já existe uma organização com este identificador (slug).');
  const { rows } = await query(Q.INSERT_ORGANIZATION, [data.nome, data.slug, data.sigla || null]);
  invalidateAppConfigCache();
  return rows[0];
}

/**
 * @param {string} id
 * @param {object} data
 * @param {string|null} [actingUserId] - Requisitante, para a guarda de auto-bloqueio.
 */
export async function updateOrganization(id, data, actingUserId = null) {
  // O PUT também desativa (`is_active: false` está no schema do corpo), então a guarda
  // precisa dos DOIS caminhos: guardada só a rota de desativação, a tela se trancaria
  // para fora pela porta ao lado, com o mesmo efeito e um nome de ação diferente na
  // trilha. É a mesma classe de porta dos fundos que `updateUser` documenta.
  if (data.is_active === false) {
    await assertNaoEhAPropriaLotacao(id, actingUserId);
  }
  const { rows } = await query(Q.UPDATE_ORGANIZATION, [
    id,
    data.nome ?? null,
    data.sigla === '' ? null : (data.sigla ?? null),
    data.is_active ?? null,
    data.sigla !== undefined, // provided? — lets an explicit null clear the column
  ]);
  if (rows.length === 0) throw new NotFoundError('Organization');
  invalidateAppConfigCache();
  return rows[0];
}

/**
 * @param {string} id
 * @param {string|null} [actingUserId] - Requisitante, para a guarda de auto-bloqueio.
 */
export async function deactivateOrganization(id, actingUserId = null) {
  // A guarda vem ANTES do UPDATE, e não depois de ler a linha: recusar depois de escrever
  // não é recusar. A ordem também é o que faz o teste conseguir separar "409 e a OM
  // continua ativa" de "409 emitido em cima do estrago".
  await assertNaoEhAPropriaLotacao(id, actingUserId);
  const { rows } = await query(Q.DEACTIVATE_ORGANIZATION, [id]);
  if (rows.length === 0) throw new NotFoundError('Organization');
  invalidateAppConfigCache();
  return { success: true };
}

/**
 * As contagens que a tela mostra ANTES de perguntar se pode desativar.
 *
 * Leitura pura: não decide nada e não é o gate. A recusa de auto-bloqueio é
 * `assertNaoEhAPropriaLotacao`, no servidor, e continua valendo mesmo que a tela ignore
 * `requesterIsMember` — este campo existe para a pessoa ver o motivo antes de levar 409,
 * não para a tela virar o ponto de imposição.
 *
 * @param {string} id
 * @param {string|null} [requesterId]
 * @returns {Promise<{activeMembers:number, activeProducers:number, catalogItems:number,
 *   requesterIsMember:boolean}>}
 */
export async function getDeactivationImpact(id, requesterId = null) {
  await getOrganization(id); // 404 para OM inexistente, antes de contar nada
  const { rows } = await query(Q.ORGANIZATION_DEACTIVATION_IMPACT, [id]);
  const r = rows[0];
  const lotacao = await lotacaoVivaDoAtor(requesterId);
  return {
    // `Number()` obrigatório: COUNT é bigint e chega como string (ver o comentário da
    // consulta). Sem ele a tela compara '0' com 0 e nunca acerta o caso vazio.
    activeMembers: Number(r.active_members),
    activeProducers: Number(r.active_producers),
    catalogItems: Number(r.catalog_items),
    requesterIsMember: lotacao === id,
  };
}
