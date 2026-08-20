// Path: src/utils/roles.js
// Maps the backend's two orthogonal axes (global role + per-atlas permission)
// to the frontend's UserRole vocabulary.
// Stored per-atlas permission: read | comment | write | manage. `owner` is synthesized
// from atlas.owner_id (not a stored share). Global `admin` short-circuits to 'admin'.

/**
 * SAO QUATRO VALORES DE PAPEL GLOBAL, e o contrato declarado aqui dizia dois.
 *
 * O COMPORTAMENTO SEMPRE ESTEVE CERTO — so `'admin'` faz curto-circuito, e
 * `producer`/`credenciado` caem na escada por atlas como qualquer conta comum, que e
 * exatamente o desenho: manter acervo e ler recurso privado NAO sao papel de cliente.
 * O que estava errado era o `@param`, e um contrato que omite dois dos quatro valores
 * convida a leitura de que eles não existem — que e como alguem acrescenta
 * `credenciado` a este curto-circuito achando que está completando uma lista.
 *
 * @param {('owner'|'manage'|'write'|'comment'|'read'|null)} permission - per-atlas permission
 * @param {('user'|'producer'|'credenciado'|'admin'|undefined)} globalRole - global JWT role
 * @returns {('admin'|'owner'|'manager'|'editor'|'commenter'|'viewer')}
 */
export function toFrontendRole(permission, globalRole) {
  if (globalRole === 'admin') return 'admin';
  if (permission === 'owner') return 'owner';
  if (permission === 'manage') return 'manager';
  if (permission === 'write') return 'editor';
  if (permission === 'comment') return 'commenter';
  return 'viewer'; // 'read', public, or none
}
