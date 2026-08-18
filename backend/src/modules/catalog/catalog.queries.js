// Path: src/modules/catalog/catalog.queries.js
// The AUTHORIZATION predicate over a catalog row, in ONE definition.
//
// The rule itself does not live here: it lives in the three SQL functions of migrations
// 017/019 (`fn_has_global_data_access`, `fn_can_produce_resource`, `fn_granted_resource_ids`).
// What lives here is their COMPOSITION — the three OR branches — which was written by hand in
// two places (`catalog.service.js` and `resource-access.queries.js`) and was about to gain a
// third with the snapshot rehydration of F11. Same reason `sv360AccessPredicate` is imported
// rather than copied: a fix applied on one side never reaches the other, and the symptom shows
// up far from the cause with every suite green.
//
// THE `access_level = 'public'` TERM IS DELIBERATELY LEFT OUT. It is a property of the ROW (is
// this one public?), not of the principal (does this caller reach it?), and the callers compose
// it differently: the raw listing adds the public rows, the additive payload demands
// `= 'private'` because it is a DELTA over `/api/config`. Baking the term in here would make
// the second one serve again what the boot document already served.

import { assertResourceType } from '../resource-access/resource-access.types.js';

/**
 * The three authorization branches, as a parenthesised SQL boolean expression.
 *
 * Takes SQL EXPRESSIONS, not values: the callers number their own placeholders (the catalog
 * service offsets them, the snapshot query uses literals from the whitelist), and a builder
 * that owned the numbering would force one scheme on all of them.
 *
 * The grant branch is a semi-join (`IN (SELECT ...)`), never `fn_can_see_resource` per row: one
 * query instead of one per row (R8). It is OPTIONAL because one caller cannot always build it —
 * `catalog.service.js` maps table to resource type through an object, and an entry that goes
 * missing must degrade to LESS data, never to a leak.
 *
 * @param {Object} p
 * @param {string} p.alias - Table alias of the catalog row (`t`).
 * @param {string} p.userParam - SQL expression for the principal, uuid or NULL.
 * @param {string} p.produceTypeExpr - SQL expression for the PRODUCTION type.
 * @param {string} [p.atlasParam] - SQL expression for the atlas in focus; omit to drop the grant branch.
 * @param {string} [p.grantTypeExpr] - SQL expression for the GRANT type; omit to drop the grant branch.
 * @returns {string}
 */
export function catalogAuthorizationPredicate({
  alias, userParam, produceTypeExpr, atlasParam = null, grantTypeExpr = null,
}) {
  const termos = [
    `fn_has_global_data_access(${userParam})`,
    `fn_can_produce_resource(${userParam}, ${produceTypeExpr}, ${alias}.id)`,
  ];
  if (atlasParam && grantTypeExpr) {
    termos.push(`${alias}.id IN (SELECT resource_id
                              FROM fn_granted_resource_ids(${userParam}, ${atlasParam}, ${grantTypeExpr}))`);
  }
  return `( ${termos.join('\n                OR ')} )`;
}

/**
 * A resource type as a SQL text LITERAL, whitelisted.
 *
 * For the call sites that know the type at module load and would rather not spend a bind
 * parameter on it. It goes through `assertResourceType` for the same reason the table names do:
 * a value interpolated into SQL never comes from a request without a whitelist.
 *
 * @param {string} type - One of RESOURCE_TYPES.
 * @returns {string}
 */
export function resourceTypeLiteral(type) {
  return `'${assertResourceType(type)}'::text`;
}
