// Path: js/draw_tools/line_tool/line-split.js

/**
 * @fileoverview Line split (cut) functionality.
 * Splits a single line feature into two at a user-chosen point.
 */

import {
    addFeature,
    removeFeature,
    isCurrentMapLockedSync,
    getCurrentMapNameSync,
    getEventBus
} from '@store';
import { IDUtils, showSuccess, showWarning, showToast } from '@utils';
import { EventTypes } from '@events';
import AddLineGeometry from './add_line_geometry.js';
import { removeMeasurement, updateFeatureMeasurement } from './line_measurement.js';
import { calculateProfile } from './line_profile.js';

/** Minimum distance (meters) from endpoints to allow a split */
const MIN_ENDPOINT_DISTANCE = 1;

/**
 * Pure check whether the current selection allows a line split.
 *
 * @param {Array} selectedFeatures - Currently selected features
 * @returns {{ canSplit: boolean, reason?: string }}
 */
export function canSplitLine(selectedFeatures) {
    if (!selectedFeatures || selectedFeatures.length !== 1) {
        return { canSplit: false, reason: 'Selecione exatamente 1 linha' };
    }

    const f = selectedFeatures[0];

    if (f.properties?.source !== 'line') {
        return { canSplit: false, reason: 'Feição selecionada não é uma linha' };
    }

    if (!f.geometry?.coordinates || f.geometry.coordinates.length < 2) {
        return { canSplit: false, reason: 'Linha sem coordenadas suficientes' };
    }

    if (f.properties?.bloqueado) {
        return { canSplit: false, reason: 'Linha está bloqueada' };
    }

    return { canSplit: true };
}

/**
 * Splits a line feature into two at the nearest point to `clickLngLat`.
 *
 * @param {Object} lineFeature - GeoJSON line feature to split
 * @param {{ lng: number, lat: number }} clickLngLat - Map click coordinates
 * @param {Object} map - MapLibre map instance
 * @param {Object} selectionManager - SelectionManager instance
 * @returns {Promise<{ success: boolean, features?: [Object, Object] }>}
 */
export async function splitLineAtPoint(lineFeature, clickLngLat, map, selectionManager) {
    if (isCurrentMapLockedSync()) {
        showWarning('Mapa está bloqueado');
        return { success: false };
    }

    const coords = lineFeature.geometry.coordinates;
    if (!coords || coords.length < 2) {
        showWarning('Linha sem coordenadas suficientes');
        return { success: false };
    }

    // Build turf geometries
    const turfLine = window.turf.lineString(coords);
    const clickPoint = window.turf.point([clickLngLat.lng, clickLngLat.lat]);

    // Find nearest point on the line
    const snapped = window.turf.nearestPointOnLine(turfLine, clickPoint);
    const splitCoord = snapped.geometry.coordinates;
    const segIdx = snapped.properties.index;

    // Guard: don't split at endpoints
    const distToStart = window.turf.distance(
        window.turf.point(coords[0]),
        window.turf.point(splitCoord),
        { units: 'meters' }
    );
    const distToEnd = window.turf.distance(
        window.turf.point(coords[coords.length - 1]),
        window.turf.point(splitCoord),
        { units: 'meters' }
    );

    if (distToStart < MIN_ENDPOINT_DISTANCE || distToEnd < MIN_ENDPOINT_DISTANCE) {
        showWarning('Não é possível cortar no extremo da linha');
        return { success: false };
    }

    // Build two coordinate arrays
    const coords1 = coords.slice(0, segIdx + 1).concat([splitCoord]);
    const coords2 = [splitCoord].concat(coords.slice(segIdx + 1));

    if (coords1.length < 2 || coords2.length < 2) {
        showWarning('Corte resultaria em linha inválida');
        return { success: false };
    }

    // Generate geometry for both halves
    const geometry = new AddLineGeometry();
    const originalProps = lineFeature.properties;
    const baseName = originalProps.nome || 'Linha';

    // Feature 1 — inherit all properties, override only what changes
    const { id: featureId1, geoJsonId: geoJsonId1 } = IDUtils.generateFeatureIds();
    const feature1 = {
        type: 'Feature',
        id: geoJsonId1,
        properties: {
            ...originalProps,
            id: featureId1,
            nome: `${baseName} (1)`,
            baseCoordinates: coords1,
            profileData: null
        },
        geometry: geometry.generate(coords1)
    };

    // Feature 2 — inherit all properties, override only what changes
    const { id: featureId2, geoJsonId: geoJsonId2 } = IDUtils.generateFeatureIds();
    const feature2 = {
        type: 'Feature',
        id: geoJsonId2,
        properties: {
            ...originalProps,
            id: featureId2,
            nome: `${baseName} (2)`,
            baseCoordinates: coords2,
            profileData: null
        },
        geometry: geometry.generate(coords2)
    };

    try {
        // Deselect current line
        selectionManager.deselectAllFeatures();

        // Clean up measurement label from the original line
        const originalId = originalProps.id;
        removeMeasurement(originalId);

        // Remove original from store
        await removeFeature('lines', originalId);

        // Update map source
        const source = map.getSource('lines');
        if (source) {
            const data = await source.getData();
            data.features = data.features.filter(f => f.properties.id !== originalId);
            data.features.push(feature1, feature2);
            source.setData(data);
        }

        // Add new features to store
        await addFeature('lines', feature1);
        await addFeature('lines', feature2);

        // Recreate measurement labels if measure was enabled
        if (originalProps.measure) {
            updateFeatureMeasurement(map, feature1);
            updateFeatureMeasurement(map, feature2);
        }

        // Recalculate profile data if profile was enabled
        if (originalProps.profile) {
            try {
                const [profileData1, profileData2] = await Promise.all([
                    calculateProfile(map, coords1),
                    calculateProfile(map, coords2)
                ]);
                feature1.properties.profileData = JSON.stringify(profileData1);
                feature2.properties.profileData = JSON.stringify(profileData2);

                // Update source with recalculated profile data
                const updatedSource = map.getSource('lines');
                if (updatedSource) {
                    const updatedData = await updatedSource.getData();
                    for (const f of updatedData.features) {
                        if (f.properties.id === featureId1) {
                            f.properties.profileData = feature1.properties.profileData;
                        } else if (f.properties.id === featureId2) {
                            f.properties.profileData = feature2.properties.profileData;
                        }
                    }
                    updatedSource.setData(updatedData);
                }
            } catch (err) {
                console.error('Error recalculating profile after split:', err);
            }
        }

        // Ensure nothing is selected after split
        selectionManager.deselectAllFeatures();
        selectionManager.updateUI();

        // Notify the system
        getEventBus().emit(EventTypes.LAYERS_CHANGED, {
            mapName: getCurrentMapNameSync()
        });

        showSuccess('Linha cortada com sucesso');
        return { success: true, features: [feature1, feature2] };
    } catch (error) {
        console.error('Error splitting line:', error);
        showWarning('Erro ao cortar linha');
        return { success: false };
    }
}

/**
 * Enters temporary click mode for splitting a line.
 * The user clicks on the map near the line to choose the split point.
 * Press Escape to cancel.
 *
 * @param {Object} lineFeature - GeoJSON line feature to split
 * @param {Object} map - MapLibre map instance
 * @param {Object} selectionManager - SelectionManager instance
 * @returns {Promise<{ success: boolean }>}
 */
// Cancels the in-progress split session, if any. Set while split mode is active so
// a new activation (or an abandoned session via tool switch) tears down the prior
// map-click / document-keydown listeners instead of leaking them.
let activeSplitCleanup = null;

export function activateSplitMode(lineFeature, map, selectionManager) {
    // A prior split mode may have been entered and then abandoned (e.g. the user
    // switched tools without clicking the map or pressing Esc). Settle and clean it
    // up before starting a new one.
    if (activeSplitCleanup) {
        activeSplitCleanup();
    }

    return new Promise((resolve) => {
        showToast('Clique na linha para cortar. Pressione Esc para cancelar.', 'info');

        const originalCursor = map.getCanvas().style.cursor;
        map.getCanvas().style.cursor = 'crosshair';

        function cleanup() {
            map.getCanvas().style.cursor = originalCursor;
            map.off('click', onMapClick);
            document.removeEventListener('keydown', onKeyDown);
            if (activeSplitCleanup === cancelActive) activeSplitCleanup = null;
        }

        // Tears down listeners AND settles the promise as cancelled; registered as
        // the global active-cleanup so a re-entry or external teardown can call it.
        const cancelActive = () => {
            cleanup();
            resolve({ success: false, cancelled: true });
        };

        async function onMapClick(e) {
            cleanup();
            const result = await splitLineAtPoint(lineFeature, e.lngLat, map, selectionManager);
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
