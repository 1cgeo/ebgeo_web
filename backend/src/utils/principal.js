// Path: src/utils/principal.js
// O id de usuário utilizável num cast ::uuid.

// Um principal apoiado numa linha de `users` sempre tem sub UUID. O token de link
// público usa deliberadamente `public-<uuid>`, que NÃO é um UUID nu. Mesmo padrão
// de `middleware/auth.js` e `middleware/permissions.js`.
const PRINCIPAL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O id do usuário quando ele é um UUID de verdade, senão null.
 *
 * NULL É O VALOR CORRETO PARA O VISITANTE DE LINK PÚBLICO, não uma degradação:
 * nos predicados de acesso o ramo de concessão pessoal morre com ele e sobra o
 * ramo de empréstimo do atlas, que é o que deve alcançá-lo.
 *
 * E é uma barreira de tipo, não só de semântica: mandar `public-<uuid>` para um
 * cast `::uuid` levanta 22P02, que o errorHandler traduz num HTTP 400 sem relação
 * aparente com a causa. `nomes.controller.js` carrega um irmão desta função
 * exatamente por causa desse defeito.
 *
 * @param {{id?: string}} [user] - req.user
 * @returns {string|null}
 */
export function principalUserId(user) {
  return principalIdOrNull(user?.id);
}

/**
 * O MESMO teste, para quando o id do principal já vem SOLTO.
 *
 * Existe porque nem todo caminho carrega um `req.user`: o socket de colaboração guarda
 * `ws.userId` (`collab.gateway.js`), e o `pushOperations` recebe o id como argumento. Sem
 * esta função, cada um deles reescreveria a regex — que é como `sync.service.js` já ficou
 * com duas cópias dela (`FEATURE_UUID_RE`, `COMMENT_UUID_RE`).
 *
 * @param {*} id
 * @returns {string|null}
 */
export function principalIdOrNull(id) {
  return typeof id === 'string' && PRINCIPAL_UUID_RE.test(id) ? id : null;
}

/**
 * Um `atlasId` vindo do request, quando ele é um UUID de verdade, senão null.
 *
 * MESMA BARREIRA DE TIPO de `principalUserId`, e pela mesma razão: o valor vai
 * para um cast `::uuid` e qualquer outra coisa levanta 22P02, que o errorHandler
 * traduz num HTTP 400 sem relação aparente com a causa. Null é "sem atlas em
 * foco", que é um estado legítimo — quem lê o 360 direto pela URL não tem atlas
 * nenhum aberto.
 *
 * @param {*} value - Tipicamente `req.query.atlasId`.
 * @returns {string|null}
 */
export function atlasScopeId(value) {
  return typeof value === 'string' && PRINCIPAL_UUID_RE.test(value) ? value : null;
}
