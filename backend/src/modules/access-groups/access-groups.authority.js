// Path: src/modules/access-groups/access-groups.authority.js
// O GATE DE AUTORIDADE SOBRE UM GRUPO, em arquivo próprio do módulo.
//
// POR QUE NÃO EM `middleware/resource-access.js`, onde moram os outros gates deste
// eixo: aquele arquivo responde perguntas sobre RECURSO ("esta pessoa pode ver /
// repassar ESTE recurso"), e este não pergunta nada sobre recurso nenhum. É o mesmo
// critério que põe `nomes/assets3d-acesso.js` dentro do módulo dele. E há uma razão de
// higiene junto: `middleware/resource-access.js` está classificado como gate de PODER
// no censo de papel global, com contagem exata de trechos, então crescê-lo custa mais
// caro do que deveria custar um gate que não fala de papel global.

import { principalUserId } from '../../utils/principal.js';
import { assertCanAdministerGroup } from './access-groups.service.js';

/**
 * Gate das cinco rotas que ESCREVEM num grupo (e da que lista o roster).
 *
 * SEMPRE 404, NUNCA 403, e a escolha é a mesma de `assertCanSeeResource`: com a
 * listagem recortada por posse, um 403 sobre grupo alheio contaria que aquele id
 * existe. Invisível tem de ser indistinguível de inexistente, senão a restrição de
 * listagem vira obscuridade e a recusa vira oráculo de inventário.
 *
 * A ORDEM NA ROTA É CONTRATO: `auth` → `validate({ params })` → este gate →
 * `validate({ body })`. Antes do `validate({ params })` um `:groupId` que não é UUID
 * chegaria a um cast `::uuid` e sairia como 22P02 traduzido em 400, no lugar do 422 da
 * borda; depois do `validate({ body })`, um corpo malformado seria respondido com 422
 * sobre um grupo que o chamador não pode nem saber que existe.
 *
 * Ele não pergunta nada por conta própria: quem responde é `fn_can_administer_group`,
 * pela mesma função que a listagem e o beneficiário-coletivo de uma concessão usam.
 *
 * @type {import('express').RequestHandler}
 */
export function requireGroupAuthority(req, res, next) {
  Promise.resolve().then(async () => {
    await assertCanAdministerGroup({
      actorId: principalUserId(req.user),
      groupId: req.params.groupId,
    });
    return next();
  }).catch(next);
}
