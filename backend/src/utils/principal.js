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
  const id = user?.id;
  return typeof id === 'string' && PRINCIPAL_UUID_RE.test(id) ? id : null;
}
