// Path: src/modules/sharing/sharing.schemas.js
import Joi from 'joi';

// Grantable per-atlas permissions. `owner` is NOT grantable here — and the reason is the
// COLUMN, not this list: the CHECK on `atlas_shares.permission` (003_atlas.sql) never
// accepted the value. Ownership comes from `atlas.owner_id` and changes only via the
// transfer route.
//
// O GRUPO RECEBE OS MESMOS QUATRO NÍVEIS (decisão do dono, 2026-08-20), e não um teto mais
// baixo. A alternativa considerada e recusada era limitar grupo a `write`: ela some com a
// amplificação de autoridade sem ninguém ver, e a decisão preferiu abrir `manage` com as
// duas mitigações VISÍVEIS — só grupo próprio, e o dono do grupo nomeado na lista de quem
// tem acesso.
const GRANTABLE_PERMISSIONS = ['read', 'comment', 'write', 'manage'];

export const addUserShareSchema = Joi.object({
  userId: Joi.string().uuid().required(),
  permission: Joi.string().valid(...GRANTABLE_PERMISSIONS).required(),
});

export const updateUserShareSchema = Joi.object({
  permission: Joi.string().valid(...GRANTABLE_PERMISSIONS).required(),
});

export const addGroupShareSchema = Joi.object({
  groupId: Joi.string().uuid().required(),
  permission: Joi.string().valid(...GRANTABLE_PERMISSIONS).required(),
});

export const updateGroupShareSchema = Joi.object({
  permission: Joi.string().valid(...GRANTABLE_PERMISSIONS).required(),
});

/**
 * `:groupId` do PUT e do DELETE.
 *
 * As rotas de PESSOA NÃO têm par de params, e a diferença é deliberada e está medida:
 * `tests/integration/sharing-params-validation.test.js` documenta que ali um `:userId`
 * malformado vira 22P02 traduzido em 400 pela borda. As rotas novas não herdam esse
 * descuido — validado aqui, um `:groupId` malformado responde 422 com `details`, que é a
 * forma da casa (a mesma de `access-groups.routes.js`).
 *
 * `atlasId` ESTÁ DECLARADO porque este router usa `mergeParams` e a borda roda com
 * `stripUnknown: true`: omiti-lo aqui APAGARIA `req.params.atlasId` depois da validação.
 * Nada a jusante o lê hoje (o controller usa `req.atlasId`, posto pelo gate), mas a
 * próxima linha que o leia falharia com um `undefined` sem causa aparente. Mesma forma de
 * `atlasResourceParamsSchema` (`atlas.schemas.js`).
 */
export const groupIdParamsSchema = Joi.object({
  atlasId: Joi.string().uuid().required(),
  groupId: Joi.string().uuid().required(),
});
