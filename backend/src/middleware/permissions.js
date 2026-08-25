// Path: src/middleware/permissions.js
import { query } from '../database/index.js';
import { ForbiddenError, NotFoundError } from '../utils/errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Permission hierarchy levels (higher number = more access).
 * read < comment < write < manage < owner. `comment` (Comentarista) sees the atlas and
 * may only act on spatial comments; `manage` (co-Gestor) can share + configure the atlas.
 */
export const PERMISSION_LEVELS = {
  read: 1,
  comment: 2,
  write: 3,
  manage: 4,
  owner: 5,
};

/**
 * Resolves the permission level for a user on an atlas.
 * Pure function for testing.
 * @param {Object} params
 * @param {string|null} params.userId - Current user ID (null for anonymous)
 * @param {string} params.ownerId - Atlas owner ID
 * @param {Object|null} params.share - The STRONGEST share reaching this user, direct OR through a
 *   live access group, as `fn_user_atlas_shares` resolved it: `{ permission }`. It is NOT "this
 *   person's row in atlas_shares" any more (since 2026-08-21, when `atlas_shares` gained
 *   `group_id`). Do not reintroduce a direct `SELECT ... FROM atlas_shares WHERE user_id = $2`
 *   here: that reads one of the two arms and silently drops every group-granted level.
 * @param {boolean} params.isPublic - Whether atlas is public
 * @returns {string|null} Permission level: 'owner', 'manage', 'write', 'comment', 'read', or null
 */
export function resolvePermission({ userId, ownerId, share, isPublic }) {
  // 1. Is user the atlas owner?
  if (userId && userId === ownerId) {
    return 'owner';
  }

  // 2. Is user in atlas_shares?
  if (share && share.permission) {
    return share.permission;
  }

  // 3. Is atlas public?
  if (isPublic) {
    return 'read';
  }

  // 4. None of the above
  return null;
}

/**
 * Creates middleware that checks if the authenticated user has
 * the required permission level on the atlas specified by :atlasId or :aId or :id.
 *
 * @param {'read' | 'comment' | 'write' | 'manage' | 'owner'} requiredLevel - Minimum permission
 * @returns {Function} Express middleware
 * @throws {TypeError} At MOUNT time when `requiredLevel` is not a known level.
 */
export function requireAtlasPermission(requiredLevel) {
  // Fail-CLOSED on an unknown level, and fail at mount time rather than per request.
  //
  // `PERMISSION_LEVELS[requiredLevel]` is undefined for a typo, and `resolvedLevel <
  // undefined` is false (NaN comparison), so the gate used to call next(): ONE
  // mistyped level ('managee', 'writes') silently opened that route to every bearer
  // of any level, anonymous included on a public atlas. That is the exact opposite of
  // the intent, and nothing anywhere reported it — the 28 existing call sites were
  // correct by luck, not by verification.
  //
  // Throwing here turns the typo into a boot failure (the routers are built at import
  // time), which is the only moment at which a static mistake can still be free.
  //
  // The `typeof` half is not pedantry: property lookup stringifies its key, so
  // `Object.hasOwn(PERMISSION_LEVELS, ['read'])` is TRUE — a one-element array would
  // mount a gate whose level came from a coercion nobody wrote.
  if (typeof requiredLevel !== 'string' || !Object.hasOwn(PERMISSION_LEVELS, requiredLevel)) {
    throw new TypeError(
      `requireAtlasPermission: unknown level ${JSON.stringify(requiredLevel)}. ` +
      `Expected one of: ${Object.keys(PERMISSION_LEVELS).join(', ')}.`
    );
  }

  return async (req, res, next) => {
    try {
      // Extract atlasId from req.params (try :atlasId, :aId, :id)
      const atlasId = req.params.atlasId || req.params.aId || req.params.id;

      if (!atlasId) {
        return next(new NotFoundError('Atlas'));
      }

      // O UUID DE UMA CONTA DE VERDADE, ou NULL. Anônimo não tem nenhum, e o visitante
      // de link público carrega um `sub` sintético (`public-<uuid>`) que não é UUID nu:
      // os dois viram NULL aqui de propósito, porque `fn_principal_vivo(NULL)` é FALSE
      // (é o primeiro termo dela) e um `::uuid` sobre `public-<uuid>` levantaria 22P02.
      const principalUuid = req.user?.id && UUID_RE.test(req.user.id) ? req.user.id : null;

      // Fetch atlas and check if it exists.
      //
      // A VIVACIDADE DO PRINCIPAL VIAJA NESTA CONSULTA, e não numa segunda. O eixo POR
      // ATLAS era o último que resolvia permissão sem perguntar se quem pede ainda
      // existe: `fn_principal_vivo` (conta ativa E OM de lotação ativa) já gateava o
      // eixo de RECURSO em `fn_granted_resource_ids`, o grupo de acesso em
      // `fn_user_group_ids` e o atalho global em `fn_is_global_admin`, e `atlas_shares`
      // não a consultava em lugar nenhum. Um usuário DESATIVADO, ou cuja OM foi
      // desativada, mantinha o nível que um share lhe deu.
      //
      // O `auth` ESTRITO já barrava esse principal (401 conta inativa, 403 OM inativa)
      // ANTES deste middleware, e é por isso que o buraco não aparecia nas rotas de
      // atlas: TODAS elas montam `auth`. O que não monta é a família servida só por
      // `flexibleAuth` — as leituras do 360, que chamam este mesmo gate por
      // `requireAtlasScopeWhenPresent` (middleware/resource-access.js) quando vem
      // `?atlasId=`. Lá `req.user` sai do TOKEN sem reconciliação nenhuma (a renovação
      // deslizante só consulta o banco a menos de 5 min do vencimento), então o share
      // de uma conta morta continuava abrindo o atlas e, com ele, o empréstimo.
      //
      // Ela ri de carona no SELECT que já roda em toda requisição, em vez de virar uma
      // segunda ida ao banco: este gate está no caminho quente (toda op de sync, toda
      // imagem, todo tile do 360).
      const atlasResult = await query(
        `SELECT owner_id, is_public, fn_principal_vivo($2::uuid) AS principal_vivo
           FROM atlas WHERE id = $1 AND deleted_at IS NULL`,
        [atlasId, principalUuid]
      );

      if (atlasResult.rows.length === 0) {
        return next(new NotFoundError('Atlas'));
      }

      const atlas = atlasResult.rows[0];

      // CONTA MORTA NÃO TEM IDENTIDADE NESTE EIXO, e a poda é na RAIZ: sem `userId` o
      // ramo de posse de `resolvePermission` também morre, não só o de share. É o
      // mesmo desfecho que o `auth` estrito produz nas outras rotas, e degrada para o
      // que sobra de público: quem já era anônimo não perde nada, e um atlas
      // `is_public` continua respondendo `read` para todo mundo (inclusive para a
      // conta morta), porque público é público.
      const contaViva = atlas.principal_vivo === true;
      const userId = contaViva ? (req.user?.id || null) : null;

      // A public-link visitor token is scoped to the atlas it was minted for
      // (atlas.service.js signs an `atlasId` claim). Enforce that scope here, which
      // is what the WS gateway has always done (collab.gateway.js:55-57). Without
      // it, such a principal skipped the share lookup and fell straight through to
      // the isPublic branch below, so ONE public link granted read on EVERY public
      // atlas whose UUID was known. Checked before the admin shortcut on purpose:
      // a visitor token carries no real identity and must never reach it.
      //
      // Responde 404 e não 403 pelo mesmo motivo do bloco de `resolvedPermission` abaixo:
      // aqui o chamador está sondando um atlas com o qual não tem relação nenhuma (o token
      // dele é de OUTRO atlas), e distinguir "existe mas não é seu" de "não existe" entrega
      // existência de graça.
      if (req.user?.isPublic) {
        if (req.user.publicAtlasId !== atlasId) {
          return next(new NotFoundError('Atlas'));
        }
      }

      // O ATALHO DO ADMIN GLOBAL MORA DENTRO DA VIVACIDADE, e o aninhamento é
      // deliberado nas duas pontas. A de conteúdo: o `admin` global resolve como topo
      // da escada por atlas (`toFrontendRole`, utils/roles.js), então deixá-lo fora
      // faria o desativado ser o ÚNICO principal que a desativação não alcança — logo
      // ele, que é quem mais tem a perder, e a assimetria seria a mesma que
      // `fn_principal_vivo` nasceu para fechar (o atalho global conferia vida e o ramo
      // de concessão não). Aqui o papel ainda vem do token nas rotas só-`flexibleAuth`,
      // que não reconciliam nada. A de forma: escrever a conjunção numa linha só
      // (`contaViva && req.user?.role === 'admin'`) quebraria o trecho que o censo de
      // papel global fixa por texto (tests/unit/papel-global-censo.test.js), e um censo
      // que deixa de casar não fica vermelho, fica MUDO.
      //
      // Admin morto cai na escada comum logo abaixo e termina em 404, como qualquer
      // conta sem relação com o atlas.
      if (contaViva) {
        // Global admins have full (owner-level) access to every atlas so they can
        // support/debug and manage any user's project.
        if (req.user?.role === 'admin') {
          req.atlasPermission = 'owner';
          req.atlasId = atlasId;
          req.atlasOwnerId = atlas.owner_id;
          return next();
        }
      }

      // O share MAIS FORTE que alcança esta pessoa: o direto e o dos grupos VIVOS de
      // que ela participa, resolvidos pelo MÁXIMO dentro de `fn_user_atlas_shares`
      // (008_acesso_a_recurso.sql). A aritmética da precedência mora lá, uma
      // vez só, porque as três listagens de atlas e o gate do WebSocket precisam
      // responder o mesmo — duas cópias de uma escada é o defeito que esta casa já
      // pagou duas vezes.
      //
      // A guarda mudou de `UUID_RE` para `contaViva`, e ela é ESTRITAMENTE mais forte:
      // `contaViva` só é verdadeiro quando `principalUuid` era um UUID nu (é o
      // argumento que `fn_principal_vivo` recebeu), então o visitante de link público e
      // o anônimo continuam sem gastar a ida ao banco e sem chegar perto do `::uuid` —
      // e a conta desativada passa a acompanhá-los.
      let share = null;
      if (contaViva) {
        const shareResult = await query(
          `SELECT permission FROM fn_user_atlas_shares($2::uuid, $1::uuid)`,
          [atlasId, userId]
        );
        if (shareResult.rows.length > 0) {
          share = shareResult.rows[0];
        }
      }

      // Resolve permission
      const resolvedPermission = resolvePermission({
        userId,
        ownerId: atlas.owner_id,
        share,
        isPublic: atlas.is_public,
      });

      // NENHUMA relação com o atlas (não é dono, não tem share, o atlas não é público):
      // responde 404, não 403. A escada é 404 para quem não tem relação e 403 para quem tem
      // share de nível insuficiente, logo abaixo.
      //
      // O porquê, e ele não é preferência: este projeto JÁ tomou esta decisão, e a aplicava
      // em um módulo só. `enforceProjectReadable` (modules/streetview360/sv360.service.js)
      // diz, com estas palavras, "Throws NotFoundError (NOT Forbidden) when a project is not
      // readable, so a hidden project is indistinguishable from a nonexistent one". O módulo
      // de atlas fazia o oposto, e um 403 aqui contra um 404 no atlas inexistente entregava
      // existência a quem já tivesse o UUID (colaborador com share revogado, link público
      // despublicado). A inconsistência entre os dois módulos custava mais que o vazamento:
      // é ela que faz alguém copiar o padrão errado no módulo seguinte.
      //
      // O 403 de baixo NÃO vira 404, e essa distinção é o ponto todo: quem tem share está
      // olhando o atlas na tela, então dizer "não existe" seria mentira confusa e destruiria
      // o sinal que faz a pessoa entender que precisa pedir NÍVEL, não pedir o link.
      //
      // Decidido em 2026-07-25 (ver `auditoria-continuacao.md`).
      if (!resolvedPermission) {
        return next(new NotFoundError('Atlas'));
      }

      const resolvedLevel = PERMISSION_LEVELS[resolvedPermission];
      const requiredLevelNum = PERMISSION_LEVELS[requiredLevel];

      // The symmetric fail-open: a `permission` value outside the column's CHECK
      // would also resolve to undefined, and `undefined < 4` is false. Unreachable
      // today only because the `atlas_shares.permission` CHECK (003_atlas.sql) constrains the column — which is a
      // guarantee of the schema, not of this file.
      if (resolvedLevel === undefined || resolvedLevel < requiredLevelNum) {
        return next(new ForbiddenError());
      }

      // Set permission on request for downstream use
      req.atlasPermission = resolvedPermission;
      req.atlasId = atlasId;
      req.atlasOwnerId = atlas.owner_id;

      next();
    } catch (err) {
      next(err);
    }
  };
}
