// Path: src/modules/resource-access/resource-access.queries.js
// SQL nomeado do módulo de acesso a recurso. O PREDICADO de acesso não mora aqui:
// ele mora nas três funções da migração 017, e estas consultas as CHAMAM. Uma
// definição só, que é a dívida que o schema `ng` já paga por não ter feito assim.

/**
 * Marca um recurso de CATÁLOGO como público ou privado.
 * O nome da tabela é INTERPOLADO pelo chamador a partir de `assertCatalogTableOf`,
 * nunca do request.
 *   $1 = accessLevel, $2 = id
 * @param {string} table - Já validado.
 * @returns {string}
 */
export const setCatalogAccessLevel = (table) => `
  UPDATE ${table} SET access_level = $1, updated_at = NOW()
   WHERE id = $2 AND active = true
   RETURNING id, name, access_level
`;

/** Idem para o 360, cuja chave é UUID. $1 = accessLevel, $2 = id. */
export const SET_360_ACCESS_LEVEL = `
  UPDATE sv360.projects SET access_level = $1, updated_at = NOW()
   WHERE id = $2::uuid
   RETURNING id::text AS id, name, access_level
`;
