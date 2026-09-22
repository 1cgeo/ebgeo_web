// Path: js/store/vista-da-pessoa.js

/**
 * @fileoverview WHAT THIS PERSON LEFT ON A MAP, REMEMBERED ON THIS COMPUTER: the base layer and the
 * temporal switch, per map, per atlas (owner's request of 2026-09-22: "apesar do basemap e controle
 * temporal não sincronizarem, ele tem que salvar a preferência do usuário naquele mapa
 * localmente"). The record itself is `vista-da-pessoa-disco.js`; this module answers WHOSE record
 * and WHICH map, from the active scope and the session, in the same tick as the read or the write.
 *
 * THE PRECEDENCE ON ENTERING A MAP, and every reader applies the same one:
 *   1. what this person remembers for this map, when it is still valid (a base their catalogue
 *      still offers; any boolean for the switch);
 *   2. the SAVED view of the map (`saveMapView`), for a map that has one;
 *   3. the default that existed before: what is on screen, or the base of the document on the first
 *      paint after a boot or a wipe, and the saved `ativo` for the switch.
 * The readers are `setCurrentMap` (`store-state-manager.js`, the pin of the switch),
 * `BaseLayerControl.switchMap` (the base) and `applyMapEntryTemporalView` (the switch of a map with
 * a saved view).
 *
 * WHAT IS REMEMBERED IS A GESTURE, NEVER AN APPLICATION. The selector (`executeLayerChange`) and the
 * switch without `automatico` (`setMapTemporalView`) write here; a saved view applied on entry, a
 * briefing slide, a shared link, the preferred base of the terrain and a fallback do not, or the
 * first automatic value would freeze as a choice and the saved view would never reach this person
 * again.
 *
 * THE TWO GESTURES THAT ALIGN THE SCREEN WITH THE SAVED VIEW FORGET IT: saving the view (the saver
 * now looks at exactly what was saved) and restoring it ("Restaurar posição", `restoreSavedView`
 * of `switchMap`). From then on that person follows the saved view like anybody who never chose,
 * so a colleague saving later reaches them on the next entry. Other people's remembered views are
 * theirs and untouched: they live on other computers.
 *
 * WHO CAN BE REMEMBERED FOR (`personViewTarget` answers null otherwise, and then nothing is read or
 * written, which is the behaviour before this module):
 *   - a LOCAL atlas: whoever is at this computer, signed in or not (owner `null`), because a local
 *     atlas belongs to the computer, like its saved view;
 *   - a SERVER atlas: the signed-in user, by id. The public-link VISITOR is not remembered: their
 *     namespace is purged on the next boot without a session, so their view lives in memory for the
 *     visit, as it did before.
 *
 * THE MAP KEY IS THE ID, NEVER THE NAME, whenever the map has one (`mapResolver.resolveToId`). The
 * colour count paid for keying by name (a rename broke it); here a rename of a map with an id costs
 * nothing, and the legacy local map keyed by name is carried by `carryRememberedMapViewAcrossRename`.
 */

import { StoreScopeKind, getActiveScope } from './atlas-namespace.js';
import { memoryStore } from './memory-store.js';
import { mapResolver } from './services/map-resolver.service.js';
// By FILE, not through the sync barrel: this module is read inside the map-entry path, and the
// barrel drags the whole sync graph into anything that imports it.
import { sessionContext } from './sync/session-context.js';
import { forgetPersonView, movePersonView, readPersonView, rememberPersonView } from './vista-da-pessoa-disco.js';

/**
 * Resolves, NOW, where the remembered view of a map lives for the person on this tab.
 *
 * Capture it at the START of a gesture and write to it at the end: the write then goes to the
 * atlas and the map the gesture happened in, even if the tab switched atlas in between.
 *
 * @param {string|null} [mapName=null] - Map name or id; null means the current map.
 * @returns {import('./vista-da-pessoa-disco.js').PersonViewTarget|null} Null when there is no
 *   active scope or map, or when nobody on this tab can own a remembered view.
 */
export function personViewTarget(mapName = null) {
    // A FAILURE HERE COSTS THE MEMORY, NEVER THE ENTRY: this runs inside `setCurrentMap` and
    // `switchMap`, and a scope or a session that cannot be read (a store half torn down, a module
    // replaced in a test) must degrade to "nothing remembered", which is the behaviour before
    // this module existed.
    try {
        const scope = getActiveScope();
        const name = mapName || memoryStore.currentMap;
        if (!scope || typeof scope.dbSuffix !== 'string' || !name) return null;

        let owner = null;
        if (scope.kind === StoreScopeKind.REMOTE) {
            if (!sessionContext.isAuthenticated() || !sessionContext.userId) return null;
            owner = sessionContext.userId;
        }
        return { dbSuffix: scope.dbSuffix, owner, mapKey: mapResolver.resolveToId(name) || name };
    } catch {
        return null;
    }
}

/**
 * What this person remembers for a map.
 * @param {string|null} [mapName=null] - Map name or id; null means the current map.
 * @returns {import('./vista-da-pessoa-disco.js').RememberedView} Empty when nothing is remembered.
 */
export function rememberedMapView(mapName = null) {
    return readPersonView(personViewTarget(mapName));
}

/**
 * Remembers a GESTURE of this person on a map. Never call it for an automatic application.
 * @param {import('./vista-da-pessoa-disco.js').PersonViewTarget|null} target - From
 *   `personViewTarget`, captured when the gesture started.
 * @param {import('./vista-da-pessoa-disco.js').RememberedView} choice
 * @returns {boolean} Whether it was written.
 */
export function rememberMapView(target, choice) {
    return rememberPersonView(target, choice);
}

/**
 * Forgets what this person remembers for a map, so the saved view governs it again.
 * @param {import('./vista-da-pessoa-disco.js').PersonViewTarget|null} target
 * @param {{baseLayer?: boolean, temporalEnabled?: boolean}} [fields] - Both by default.
 * @returns {boolean} Whether something was removed.
 */
export function forgetRememberedMapView(target, fields) {
    return forgetPersonView(target, fields);
}

/**
 * Carries the remembered view of a map keyed by NAME across a rename of it.
 *
 * Call it BEFORE the resolver learns the new name (`renameMapInMemory` runs before
 * `mapResolver.renameMap`): a map the resolver knows by id is keyed by that id, and nothing moves.
 * The move ignores the owner on purpose, since it only renames a key inside one record.
 *
 * @param {string} oldName
 * @param {string} newName
 * @returns {void}
 */
export function carryRememberedMapViewAcrossRename(oldName, newName) {
    if (!oldName || !newName || oldName === newName) return;
    try {
        if (mapResolver.resolveToId(oldName) !== oldName) return;
        const scope = getActiveScope();
        if (!scope || typeof scope.dbSuffix !== 'string') return;
        movePersonView(scope.dbSuffix, oldName, newName);
    } catch {
        // Same rule as `personViewTarget`: a rename never fails because of this memory.
    }
}
