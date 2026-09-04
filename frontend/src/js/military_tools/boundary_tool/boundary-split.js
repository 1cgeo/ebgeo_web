// Path: js/military_tools/boundary_tool/boundary-split.js

/**
 * @fileoverview Cutting a boundary in two, the counterpart of `line-split.js`
 * for a feature whose drawing is derived. The decisions that are pure live in
 * `tool_manager/helpers/boundary-split.model.js`; everything impure is here:
 * turf, the lock, the store, the three MapLibre sources and the temporary click
 * mode.
 *
 * WHAT A BOUNDARY NEEDS THAT A LINE DOES NOT:
 *
 * - The spine comes from `properties.baseCoordinates`. Its `geometry` is a
 *   MultiLineString that mixes the line's segments with the strokes of the
 *   echelon symbols, so `turf.lineString(geometry.coordinates)` would either
 *   throw or snap the cut onto the arm of an X.
 * - The echelon instances are remapped, never copied. See the model header.
 * - `generate` takes `(properties, zoom)`, not coordinates, and the derived
 *   sizes are written by `computeBoundaryZoomSizes` before it runs.
 * - Three sources change, not one: `boundarys` plus the circles and labels the
 *   boundary owns in `boundary-circles` and `boundary-texts`, keyed by `parent`.
 *   All three are written by `control.replaceSplitBoundary`, inside the
 *   control's serial queue, because a zoom pass reading them halfway through
 *   would write back a state without the halves.
 *
 * TWO DEPARTURES FROM `line-split.js`, both deliberate. The two adds come
 * BEFORE the remove, so a blocked write leaves a recoverable duplicate instead
 * of a hole where the drawing was; and the three store writes are wrapped in
 * `startBatchUndo`/`commitBatchUndo`, so one Ctrl+Z undoes the cut as a unit
 * instead of the three presses the line still costs.
 *
 * THE STORE IS THE ONLY WRITER OF RECORD, and that is what makes the cut reach
 * the peer. `addFeature`/`removeFeature` log a feature CREATE/CREATE/DELETE
 * inside their own transaction (`store/sync/operation-dispatcher.js`), which is
 * the only outbound path for incremental writes here; painting the sources
 * without them would draw a cut nobody else ever sees. Guard: the sync ops and
 * their order are pinned by `tests/integration/corte-divisa-op-de-sync.test.js`.
 */

import {
    addFeature,
    removeFeature,
    isCurrentMapLockedSync,
    getCurrentMapNameSync,
    getEventBus,
    startBatchUndo,
    commitBatchUndo,
} from '@store';
import { IDUtils, showSuccess, showWarning, showToast } from '@utils';
import { EventTypes } from '@events';
import { ensureTurf } from '@utils/turf-loader.js';
import { resolveSpineCoordinates } from '@tools/helpers/linear-conversion.model.js';
import { computeBoundaryZoomSizes } from '@tools/helpers/boundary-zoom.model.js';
import {
    MIN_SPLIT_DISTANCE_METERS,
    canSplitBoundary,
    splitSpineAtPoint,
    splitSymbolInstances,
} from '@tools/helpers/boundary-split.model.js';

/**
 * Distance between two coordinates, in metres.
 * @param {Array<number>} a - First position
 * @param {Array<number>} b - Second position
 * @returns {number} Distance in metres
 */
function metersBetween(a, b) {
    return window.turf.distance(window.turf.point(a), window.turf.point(b), { units: 'meters' });
}

/**
 * Length of a spine, in kilometres.
 * @param {Array<Array<number>>} coordinates - Spine coordinates
 * @returns {number} Length in kilometres, or NaN when it cannot be measured
 */
function lengthKm(coordinates) {
    try {
        return window.turf.length(window.turf.lineString(coordinates), { units: 'kilometers' });
    } catch (_error) {
        return NaN;
    }
}

/**
 * Pull a cut that landed on top of a vertex ONTO that vertex.
 *
 * `nearestPointOnLine` returns a computed position, so a click on a vertex lands
 * a few centimetres off it and the half would keep both the vertex and the cut,
 * a segment shorter than the 5 m the tool accepts anywhere else. Snapping makes
 * the model drop the repeat instead.
 *
 * @param {Array<Array<number>>} spine - Spine coordinates
 * @param {number} segmentIndex - Index of the vertex that opens the cut segment
 * @param {Array<number>} cut - Snapped cut position
 * @returns {Array<number>} The cut, or the vertex it sits on
 */
function snapCutToVertex(spine, segmentIndex, cut) {
    for (const index of [segmentIndex, segmentIndex + 1]) {
        const vertex = spine[index];
        if (vertex && metersBetween(vertex, cut) < MIN_SPLIT_DISTANCE_METERS) {
            return [vertex[0], vertex[1]];
        }
    }
    return cut;
}

/**
 * Cut a boundary in two at the point of the spine nearest to `clickLngLat`.
 *
 * @param {Object} boundaryFeature - Boundary feature to cut
 * @param {{ lng: number, lat: number }} clickLngLat - Map click coordinates
 * @param {Object} map - MapLibre map instance
 * @param {Object} selectionManager - SelectionManager instance
 * @returns {Promise<{ success: boolean, features?: [Object, Object] }>} Outcome
 */
export async function splitBoundaryAtPoint(boundaryFeature, clickLngLat, map, selectionManager) {
    if (isCurrentMapLockedSync()) {
        showWarning('Mapa está bloqueado');
        return { success: false };
    }

    // Re-checked here, not only in the menu: the feature can be locked from
    // another surface while the split mode waits for the click.
    const eligibility = canSplitBoundary([boundaryFeature]);
    if (!eligibility.canSplit) {
        showWarning(eligibility.reason);
        return { success: false };
    }

    const control = selectionManager?.controls?.get('boundary');
    if (!control?.geometry || !map?.getSource('boundarys')) {
        showWarning('Ferramenta de Linha de Limite indisponível');
        return { success: false };
    }

    // EVERY turf site of this file is below this line. The funnel has to be its
    // own, exactly as in `line-split.js`: who opens the boundary split mode is
    // `context-menu.control.js` or `tool_manager/helpers/feature-header.helpers.js`,
    // each with its own `import()`, and neither goes through `ensureControl`.
    // The three guards above stay BEFORE it: refusing the gesture must not
    // download the library.
    await ensureTurf();

    const spine = resolveSpineCoordinates(boundaryFeature);
    const snapped = window.turf.nearestPointOnLine(
        window.turf.lineString(spine),
        window.turf.point([clickLngLat.lng, clickLngLat.lat]),
    );
    const segmentIndex = snapped.properties.index;
    const cutCoord = snapped.geometry.coordinates;

    const distToStart = metersBetween(spine[0], cutCoord);
    const distToEnd = metersBetween(spine[spine.length - 1], cutCoord);
    if (distToStart < MIN_SPLIT_DISTANCE_METERS || distToEnd < MIN_SPLIT_DISTANCE_METERS) {
        showWarning('Não é possível cortar no extremo da linha de limite');
        return { success: false };
    }

    const halves = splitSpineAtPoint(spine, segmentIndex, snapCutToVertex(spine, segmentIndex, cutCoord));
    if (!halves) {
        showWarning('Corte resultaria em linha de limite inválida');
        return { success: false };
    }

    if (!control.geometry.validate(halves.first) || !control.geometry.validate(halves.second)) {
        showWarning('Corte resultaria em linha de limite inválida');
        return { success: false };
    }

    const instances = splitSymbolInstances(
        control.geometry.getSymbolInstances(boundaryFeature.properties),
        {
            totalLength: lengthKm(spine),
            firstLength: lengthKm(halves.first),
            secondLength: lengthKm(halves.second),
        },
    );

    const originalProps = boundaryFeature.properties;
    const originalId = originalProps.id;
    const baseName = originalProps.nome || 'Linha de Limite';
    const currentZoom = map.getZoom();

    /**
     * Build one half. The authored properties are inherited whole, exactly as
     * the line does; only identity, spine and echelon placement change, and the
     * derived sizes are recomputed rather than carried from the original.
     *
     * @param {Array<Array<number>>} coordinates - Half spine
     * @param {Array<Object>} symbolInstances - Echelon instances of this half
     * @param {number} order - 1 or 2, the suffix the name gets
     * @returns {Object|null} The new feature, or null when it cannot be drawn
     */
    const buildHalf = (coordinates, symbolInstances, order) => {
        const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();
        const properties = {
            ...originalProps,
            id: featureId,
            nome: `${baseName} (${order})`,
            baseCoordinates: coordinates,
            symbol_instances: symbolInstances,
        };

        // The legacy scalar is migrated on read and would put the symbol back
        // where it stood before the cut on the next load.
        delete properties.symbol_position_ratio;

        Object.assign(properties, computeBoundaryZoomSizes(properties, currentZoom));

        const geometry = control.geometry.generate(properties, currentZoom);
        if (!geometry?.coordinates) return null;

        return { type: 'Feature', id: geoJsonId, properties, geometry };
    };

    const first = buildHalf(halves.first, instances.first, 1);
    const second = buildHalf(halves.second, instances.second, 2);

    if (!first || !second) {
        showWarning('Não foi possível gerar a geometria do corte');
        return { success: false };
    }

    try {
        selectionManager.deselectAllFeatures();

        let stored = false;
        startBatchUndo();
        try {
            // A blocked write returns undefined instead of throwing; reading the
            // return is what stops the cut from painting halves the store never
            // accepted and then deleting the original.
            const storedFirst = await addFeature('boundarys', first);
            const storedSecond = storedFirst ? await addFeature('boundarys', second) : null;

            if (storedFirst && storedSecond) {
                await removeFeature('boundarys', originalId);
                stored = true;
            } else if (storedFirst) {
                await removeFeature('boundarys', first.properties.id);
            }
        } finally {
            commitBatchUndo();
        }

        if (!stored) {
            showWarning('Não foi possível cortar a linha de limite');
            return { success: false };
        }

        await control.replaceSplitBoundary(originalId, [first, second]);

        selectionManager.deselectAllFeatures();
        selectionManager.updateUI();

        // Undo restores the store but not the MapLibre sources; this is the
        // signal the rest of the UI re-reads on.
        getEventBus().emit(EventTypes.LAYERS_CHANGED, { mapName: getCurrentMapNameSync() });

        showSuccess('Linha de limite cortada com sucesso');
        return { success: true, features: [first, second] };
    } catch (error) {
        console.error('Error splitting boundary:', error);
        showWarning('Erro ao cortar a linha de limite');
        return { success: false };
    }
}

// Cancels the in-progress split session, if any. Set while split mode is active
// so a new activation (or an abandoned session via tool switch) tears down the
// prior map-click / document-keydown listeners instead of leaking them.
let activeSplitCleanup = null;

/**
 * Enter the temporary click mode that chooses where to cut. Escape cancels.
 *
 * @param {Object} boundaryFeature - Boundary feature to cut
 * @param {Object} map - MapLibre map instance
 * @param {Object} selectionManager - SelectionManager instance
 * @returns {Promise<{ success: boolean, cancelled?: boolean }>} Outcome
 */
export function activateBoundarySplitMode(boundaryFeature, map, selectionManager) {
    if (activeSplitCleanup) {
        activeSplitCleanup();
    }

    return new Promise((resolve) => {
        showToast('Clique na linha de limite para cortar. Pressione Esc para cancelar.', 'info');

        const originalCursor = map.getCanvas().style.cursor;
        map.getCanvas().style.cursor = 'crosshair';

        function cleanup() {
            map.getCanvas().style.cursor = originalCursor;
            map.off('click', onMapClick);
            document.removeEventListener('keydown', onKeyDown);
            if (activeSplitCleanup === cancelActive) activeSplitCleanup = null;
        }

        const cancelActive = () => {
            cleanup();
            resolve({ success: false, cancelled: true });
        };

        async function onMapClick(e) {
            cleanup();
            const result = await splitBoundaryAtPoint(boundaryFeature, e.lngLat, map, selectionManager);
            resolve(result);
        }

        function onKeyDown(e) {
            if (e.key === 'Escape') {
                cleanup();
                showToast('Corte cancelado', 'info');
                resolve({ success: false, cancelled: true });
            }
        }

        activeSplitCleanup = cancelActive;

        // Defer listener registration to avoid capturing the triggering click
        requestAnimationFrame(() => {
            map.on('click', onMapClick);
            document.addEventListener('keydown', onKeyDown);
        });
    });
}
