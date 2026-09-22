// Path: js/store/map-view.operations.js

/**
 * @fileoverview THE SAVED VIEW OF A MAP: camera, base layer and temporal switch, saved by ONE
 * gesture and applied together when someone enters the map.
 *
 * WHY IT EXISTS (decision of the owner, 2026-09-20, registered in
 * docs/decisions/decisions-2026.md). The base layer and the temporal switch used to be synced
 * map settings written by every click, so one person choosing a basemap, or turning the timeline
 * on, repainted the screen of everyone in the atlas. Both became VIEW state of the person
 * (`baselayers/base-layer.control.js`, `temporal.operations.js`), and what is left to share is
 * what the map should look like for whoever ARRIVES: that is this gesture, the old "save
 * position", now carrying the three things the person is looking at.
 *
 * IT IS COMPOSITE AND STAYS OUTSIDE EVERY DOCUMENT LOCK, like `transferLayerToMap`. The camera
 * and the base layer live on the map document (`withMapDocument`), the temporal switch on a side
 * document (`withSideDocument`), and the lock queue is FIFO without reentrancy, so one
 * transaction cannot hold them all. `withGestureBatch` is what makes the three leaves ONE
 * logical batch: the server applies or refuses them together, which is what keeps a saved view
 * from landing as a camera of one person with the basemap of another.
 *
 * A LEAF WHOSE VALUE DID NOT CHANGE IS NOT CALLED. The camera is always written (the gesture is
 * "save what is on screen now"); the base layer and the temporal switch only when they differ
 * from what is stored, because an op that rewrites the stored value claims a dispute unit for
 * nothing and can be refused on behalf of an edit nobody made.
 */

import {
    updateMapPosition, clearMapPosition, setBaseLayer, getCurrentBaseLayer, isMapLocked,
} from './map.operations.js';
import { getEmptyMapData } from './repository.utils.js';
import { setMapTemporalSaved, isMapTemporalSavedEnabled } from './temporal.operations.js';
import mapManager from './store-state-manager.js';
import { withGestureBatch } from './sync/gesture-batch.js';
import { checkPermission, GuardAction } from './sync/permission-guard.js';
import { emitStoreError, StoreErrorEvents } from './store-errors.js';
import { forgetRememberedMapView, personViewTarget } from './vista-da-pessoa.js';

/**
 * Saves the view of a map: what whoever enters it next will see.
 *
 * @param {Object} view - What is on the screen of the person saving.
 * @param {number} view.center_lat - Camera latitude.
 * @param {number} view.center_long - Camera longitude.
 * @param {number} view.zoom - Camera zoom.
 * @param {number} view.bearing - Camera bearing.
 * @param {number} view.pitch - Camera pitch.
 * @param {string|null} [view.baseLayer] - Base layer id on screen; null/absent leaves the saved one.
 * @param {boolean|null} [view.temporalEnabled] - Temporal switch on screen; non-boolean leaves
 *   the saved one.
 * @param {string} [mapName=null] - Map name (null = current).
 * @returns {Promise<boolean>} False when the gesture was refused up front (role or map lock); the
 *   blocked event already carries the sentence.
 */
export async function saveMapView(view, mapName = null) {
    if (!view || !['center_lat', 'center_long', 'zoom'].every((k) => Number.isFinite(view[k]))) {
        throw new Error('saveMapView: a finite camera (center_lat, center_long, zoom) is required');
    }

    // ONE gate for the whole gesture, asked before any leaf runs. Each leaf asks again (they are
    // public operations), but a refusal decided here keeps the gesture from being half-refused
    // leaf by leaf with three blocked events.
    const perm = checkPermission(GuardAction.UPDATE_MAP);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
            operation: 'saveMapView', reason: perm.reason, required: perm.required
        });
        return false;
    }

    const targetMap = mapName || mapManager.getCurrentMapName();
    // The remembered view of the person saving, resolved NOW, in the atlas the gesture happened in.
    const alvoDaVistaLembrada = personViewTarget(targetMap);
    if (await isMapLocked(targetMap)) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
            operation: 'saveMapView', reason: 'map_locked'
        });
        return false;
    }

    const carriesBase = typeof view.baseLayer === 'string' && view.baseLayer.length > 0;
    const carriesTemporal = typeof view.temporalEnabled === 'boolean';
    const baseChanged = carriesBase && view.baseLayer !== await getCurrentBaseLayer(targetMap);
    const temporalChanged = carriesTemporal
        && view.temporalEnabled !== await isMapTemporalSavedEnabled(targetMap);

    await withGestureBatch(async () => {
        await updateMapPosition(view.center_lat, view.center_long, view.zoom,
            view.bearing ?? 0, view.pitch ?? 0, targetMap);
        if (baseChanged) await setBaseLayer(view.baseLayer, targetMap);
        if (temporalChanged) await setMapTemporalSaved(targetMap, view.temporalEnabled);
    });

    // THE SAVER NOW LOOKS AT EXACTLY WHAT WAS SAVED, so their remembered deviation for this map is
    // forgotten, field by field (owner, 2026-09-22): a base or a switch the view did not carry
    // stays remembered. From here on this person follows the saved view like anyone who never
    // chose, and a colleague saving later reaches them on the next entry. Other people's remembered
    // views are theirs, on their computers. Writing the saved values AS the remembered view was the
    // alternative rejected: it would freeze the saver on this save forever.
    forgetRememberedMapView(alvoDaVistaLembrada, { baseLayer: carriesBase, temporalEnabled: carriesTemporal });
    return true;
}

/**
 * The base layer a map is BORN with, which is what "no saved base layer" means: `maps.base_layer`
 * is NOT NULL on the server, so clearing cannot write an absence, it writes the birth value. Read
 * off the one place that defines it, so the two cannot drift.
 * @returns {string}
 */
export function birthBaseLayer() {
    return getEmptyMapData().baseLayer;
}

/**
 * Clears the saved view of a map: the mirror of {@link saveMapView}.
 *
 * "LIMPAR POSIÇÃO SALVA" USED TO CLEAR THE CAMERA ONLY (owner, 2026-09-21). Since the saved
 * position became the saved VIEW, that left a map with no saved camera still carrying the base
 * layer and the temporal switch somebody saved with it, which nothing on screen showed and no
 * gesture could remove. The three now leave together, in ONE logical batch, for the same reason
 * they are saved together.
 *
 * IT DOES NOT TOUCH THE SCREEN of the person clearing, like the save does not: the base layer and
 * the temporal switch on screen are their own view. What changes is what the NEXT arrival finds.
 *
 * A LEAF WHOSE VALUE IS ALREADY THE CLEARED ONE IS NOT CALLED, same rule and same reason as in the
 * save: an op that rewrites the stored value claims a dispute unit for nothing. The camera is
 * always cleared, because the gesture is offered only on a map that has one.
 *
 * @param {string} [mapName=null] - Map name (null = current).
 * @returns {Promise<boolean>} False when the gesture was refused (level or map lock).
 */
export async function clearMapView(mapName = null) {
    const perm = checkPermission(GuardAction.UPDATE_MAP);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
            operation: 'clearMapView', reason: perm.reason, required: perm.required
        });
        return false;
    }

    const targetMap = mapName || mapManager.getCurrentMapName();
    if (await isMapLocked(targetMap)) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
            operation: 'clearMapView', reason: 'map_locked'
        });
        return false;
    }

    const baseDeNascimento = birthBaseLayer();
    const baseChanged = await getCurrentBaseLayer(targetMap) !== baseDeNascimento;
    const temporalChanged = await isMapTemporalSavedEnabled(targetMap);

    await withGestureBatch(async () => {
        await clearMapPosition(targetMap);
        if (baseChanged) await setBaseLayer(baseDeNascimento, targetMap);
        if (temporalChanged) await setMapTemporalSaved(targetMap, false);
    });
    return true;
}
