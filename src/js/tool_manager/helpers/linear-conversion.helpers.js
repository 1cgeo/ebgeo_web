// Path: js/tool_manager/helpers/linear-conversion.helpers.js

/**
 * @fileoverview Orchestration for converting a feature between `line`, `arrow`
 * and `boundary`. The decisions live in `linear-conversion.model.js` (pure);
 * everything impure lives here: locks, store writes, MapLibre sources, the
 * dependent features of a boundary and the measurement label of a line.
 *
 * NO STATIC IMPORT FROM `military_tools`. This file sits in `tool_manager/`,
 * which the bundler routes to the `core` chunk, while `military_tools/` is its
 * own chunk; a static edge from here would recreate the core <-> military-tools
 * circular chunk that `feature-header.helpers.js` documents. The arrow and
 * boundary controls are therefore reached through `selectionManager.controls`
 * (already-built instances), and the boundary's zoom model — the only module we
 * genuinely need the code of — through a dynamic `import()`.
 *
 * THE STORE CANNOT MOVE A FEATURE BETWEEN TYPES. `updateFeature(type, ...)`
 * searches inside `features[type]`, so a conversion is necessarily an ADD of a
 * new id plus a REMOVE of the old one. The add goes FIRST: if persistence
 * fails, the worst case is a duplicate the user can delete, never a hole where
 * their drawing used to be. Both writes are wrapped in
 * `startBatchUndo`/`commitBatchUndo` so a single Ctrl+Z undoes the conversion
 * as one unit instead of leaving the map with two features or none.
 */

import {
    addFeature,
    removeFeature,
    isCurrentMapLockedSync,
    isFeatureEffectivelyLocked,
    getCurrentMapNameSync,
    getEventBus,
    getStorageTypeFromSource,
    startBatchUndo,
    commitBatchUndo,
} from '@store';
import { IDUtils, showSuccess, showWarning } from '@utils';
import { EventTypes } from '@events';
import {
    canConvertLinear,
    lockedConversionReason,
    resolveSpineCoordinates,
    buildConvertedProperties,
    describeConversionLoss,
    formatConversionSuccess,
} from './linear-conversion.model.js';

/** Sources holding the features derived from a boundary. @constant {string[]} */
const BOUNDARY_DEPENDENT_SOURCES = ['boundary-circles', 'boundary-texts'];

/**
 * Generate the target geometry. Each of the three geometries takes a different
 * argument list, and that asymmetry is the whole reason this helper exists.
 *
 * @param {Object} control - Target tool control
 * @param {string} targetSource - Target type
 * @param {Array<Array<number>>} coordinates - Resolved spine
 * @param {Object} properties - Built properties
 * @returns {Object|null} GeoJSON geometry, or null
 */
function generateTargetGeometry(control, targetSource, coordinates, properties) {
    if (targetSource === 'boundary') return control.geometry.generate(properties);
    if (targetSource === 'arrow') return control.geometry.generate(coordinates, properties);
    return control.geometry.generate(coordinates);
}

/**
 * Remove what the source feature leaves behind outside its own GeoJSON source:
 * a line's measurement label (a DOM marker, invisible to `removeFeature`) and a
 * boundary's circles and texts (features in two sibling sources, keyed by
 * `parent`).
 *
 * @param {Object} map - MapLibre map instance
 * @param {Object} [sourceControl] - Control of the ORIGINAL type
 * @param {string} sourceType - Original type
 * @param {string} featureId - Original feature id
 * @returns {Promise<void>} Resolves once the artifacts are gone
 */
async function cleanupSourceArtifacts(map, sourceControl, sourceType, featureId) {
    if (sourceType === 'line') {
        sourceControl?.removeFeatureMeasurement?.(featureId);
        return;
    }

    if (sourceType !== 'boundary') return;

    for (const sourceName of BOUNDARY_DEPENDENT_SOURCES) {
        const source = map.getSource(sourceName);
        if (!source) continue;
        const data = await source.getData();
        data.features = data.features.filter(f => f.properties?.parent !== featureId);
        source.setData(data);
    }
}

/**
 * Convert one feature into another of the three linear types.
 *
 * @param {Object} feature - Feature to convert
 * @param {string} targetSource - Target type ('line' | 'arrow' | 'boundary')
 * @param {Object} selectionManager - SelectionManager instance
 * @param {Object} uiManager - UIManager instance
 * @returns {Promise<{success: boolean, feature?: Object, reason?: string}>} Outcome
 */
export async function convertLinearFeature(feature, targetSource, selectionManager, uiManager) {
    const eligibility = canConvertLinear(feature, targetSource);
    if (!eligibility.ok) {
        showWarning(eligibility.reason);
        return { success: false, reason: eligibility.reason };
    }

    // Re-checked here (not only in the menu) because the map can be locked from
    // another surface while the dropdown sits open.
    const lockReason = lockedConversionReason({
        mapLocked: isCurrentMapLockedSync(),
        featureLocked: isFeatureEffectivelyLocked(feature),
    });
    if (lockReason) {
        showWarning(lockReason);
        return { success: false, reason: lockReason };
    }

    const map = selectionManager?.map;
    const sourceType = feature.properties.source;
    const targetControl = selectionManager?.controls?.get(targetSource);
    const sourceControl = selectionManager?.controls?.get(sourceType);

    if (!map || !targetControl?.geometry) {
        showWarning('Ferramenta de destino indisponível');
        return { success: false, reason: 'Ferramenta de destino indisponível' };
    }

    const targetStorage = getStorageTypeFromSource(targetSource);
    const sourceStorage = getStorageTypeFromSource(sourceType);
    const targetMapSource = map.getSource(targetStorage);
    const sourceMapSource = map.getSource(sourceStorage);

    if (!targetMapSource || !sourceMapSource) {
        showWarning('Camada de destino indisponível');
        return { success: false, reason: 'Camada de destino indisponível' };
    }

    try {
        const coordinates = resolveSpineCoordinates(feature);
        const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();
        const fallbackName = await IDUtils.generateFeatureName(targetSource, map);
        const currentZoom = map.getZoom();

        const properties = buildConvertedProperties({
            feature,
            targetSource,
            defaults: targetControl.constructor?.DEFAULT_PROPERTIES || {},
            featureId,
            fallbackName,
            coordinates,
            adaptiveWidth: targetControl.calculateWidthForZoom?.(currentZoom),
            adaptiveSymbolSize: targetControl.calculateSymbolSizeForZoom?.(currentZoom),
            referenceZoom: currentZoom,
        });

        if (targetSource === 'boundary') {
            // The derived pixel sizes are the boundary's own model. Its factor is
            // 1 at birth, but the AUTHORED sizes came from the source feature, so
            // leaving the target defaults in place would paint a 4 px line under
            // a 5 px `lineWidth`. Dynamic import: see the file header.
            const { computeBoundaryZoomSizes } = await import(
                '../../military_tools/boundary_tool/boundary-zoom.model.js'
            );
            Object.assign(properties, computeBoundaryZoomSizes(properties, currentZoom));
        }

        // Each type enforces its own minimum vertex spacing (line 1 m,
        // boundary 5 m, arrow 10 m), so a spine legal as a line can be illegal
        // as an arrow. Ask the DESTINATION before writing anything.
        if (!targetControl.geometry.validate(coordinates, properties)) {
            showWarning('Vértices muito próximos para este tipo de feição');
            return { success: false, reason: 'Vértices muito próximos' };
        }

        const geometry = generateTargetGeometry(targetControl, targetSource, coordinates, properties);
        if (!geometry) {
            showWarning('Não foi possível gerar a geometria convertida');
            return { success: false, reason: 'Geometria inválida' };
        }

        const newFeature = {
            type: 'Feature',
            id: geoJsonId,
            properties,
            geometry,
        };
        const sourceId = feature.properties.id;

        selectionManager.deselectAllFeatures();

        startBatchUndo();
        try {
            // A blocked write returns undefined instead of throwing. Reading the
            // return value is what stops the conversion from painting a feature
            // the store never accepted (and then deleting the real one).
            const stored = await addFeature(targetStorage, newFeature);
            if (!stored) {
                showWarning('Não foi possível criar a feição convertida');
                return { success: false, reason: 'Escrita bloqueada' };
            }

            const targetData = await targetMapSource.getData();
            targetData.features.push(newFeature);
            targetMapSource.setData(targetData);

            if (targetSource === 'boundary') {
                try {
                    await targetControl.updateDependentFeatures(newFeature);
                } catch (dependentError) {
                    console.error('Error building boundary dependents after conversion:', dependentError);
                }
            }

            // Only after the add succeeded do we remove the original.
            await removeFeature(sourceStorage, sourceId);

            const sourceData = await sourceMapSource.getData();
            sourceData.features = sourceData.features.filter(
                f => String(f.properties?.id) !== String(sourceId)
            );
            sourceMapSource.setData(sourceData);

            await cleanupSourceArtifacts(map, sourceControl, sourceType, sourceId);
        } finally {
            commitBatchUndo();
        }

        await selectionManager.toggleFeatureSelection(targetSource, featureId, newFeature);
        uiManager?.updateSelectionHighlight?.();
        uiManager?.updatePanels?.();

        // Undo restores the store but not the MapLibre sources; the same signal
        // `line-split.js` emits is what makes the rest of the UI re-read.
        getEventBus().emit(EventTypes.LAYERS_CHANGED, {
            mapName: getCurrentMapNameSync()
        });

        showSuccess(formatConversionSuccess(targetSource, describeConversionLoss(feature)));
        return { success: true, feature: newFeature };
    } catch (error) {
        console.error('Error converting linear feature:', error);
        showWarning('Erro ao converter a feição');
        return { success: false, reason: 'Erro inesperado' };
    }
}
