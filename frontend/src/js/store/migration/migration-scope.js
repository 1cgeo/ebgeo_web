// Path: js/store/migration/migration-scope.js

/**
 * @fileoverview The scope a migration is asked to operate on, named once.
 *
 * A migration has TWO possible targets and they are not the same kind of thing:
 *
 *  - the PRE-NAMESPACE databases (`ebgeo_maps`, `ebgeo_app_settings`, ...), which are the
 *    installation as it existed before atlases had namespaces. Bringing them forward is a
 *    one-time upgrade of the INSTALLATION, and it is what registers the first local slot;
 *  - a namespaced LOCAL slot (`ebgeo_maps__<id>`), which is one atlas among up to ten.
 *    Bringing it forward is a property of THAT SLOT and of nothing else.
 *
 * Both resolve through `localScope`, so neither ever hardcodes a database name; the empty
 * `LEGACY_DB_SUFFIX` is what makes the first one land on the unsuffixed databases.
 */

import { LEGACY_DB_SUFFIX, localScope } from '../atlas-namespace.js';

/**
 * Diagnostic id of the scope that resolves to the pre-namespace databases. It never
 * reaches a database name: the empty `LEGACY_DB_SUFFIX` does.
 */
const LEGACY_SCOPE_ID = 'legacy-workspace';

/**
 * @returns {{ kind: string, atlasId: string, dbSuffix: string }} Scope of the unsuffixed
 *   databases, which are both the pre-namespace layout and local slot #1.
 */
export function legacyScope() {
    return localScope(LEGACY_SCOPE_ID, LEGACY_DB_SUFFIX);
}

/**
 * @param {{ dbSuffix: string }} [scope] - Any scope.
 * @returns {boolean} True when the scope resolves to the unsuffixed databases.
 */
export function isLegacyScope(scope) {
    return scope?.dbSuffix === LEGACY_DB_SUFFIX;
}
