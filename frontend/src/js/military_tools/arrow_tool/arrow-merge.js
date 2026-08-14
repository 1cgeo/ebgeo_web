// Path: js/military_tools/arrow_tool/arrow-merge.js

import { addFeature, removeFeature, getActiveLayerIdSync, startBatchUndo, commitBatchUndo } from '@store';
import { IDUtils, showSuccess, showWarning } from '@utils';
import AddArrowGeometry from './add_arrow_geometry.js';

/**
 * Per-branch geometric properties extracted from an arrow feature
 */
const BRANCH_GEOMETRIC_PROPS = [
    'baseCoordinates', 'width', 'showArrowHead',
    'headLengthRatio', 'airmobile', 'airmobilePosition'
];

/**
 * Extract branch data from a single arrow feature
 * @param {Object} feature - Arrow feature (regular or merged)
 * @returns {Array} Array of branch objects
 */
function extractBranches(feature) {
    const props = feature.properties;

    if (props.isMerged && Array.isArray(props.branches) && props.branches.length > 0) {
        return props.branches.map(b => ({ ...b }));
    }

    const branch = {};
    for (const key of BRANCH_GEOMETRIC_PROPS) {
        if (props[key] !== undefined) {
            branch[key] = key === 'baseCoordinates'
                ? [...props[key]]
                : props[key];
        }
    }
    return [branch];
}

/**
 * Check whether the selected features can be merged
 * @param {Array} selectedFeatures - Array of GeoJSON features
 * @returns {{ canMerge: boolean, reason?: string }}
 */
export function canMergeArrows(selectedFeatures) {
    if (!selectedFeatures || selectedFeatures.length < 2) {
        return { canMerge: false, reason: 'Selecione pelo menos 2 setas' };
    }

    const allArrows = selectedFeatures.every(f => f.properties?.source === 'arrow');
    if (!allArrows) {
        return { canMerge: false, reason: 'Todas as feições devem ser setas' };
    }

    const layerIds = new Set(selectedFeatures.map(f => f.properties?.layerId || 'default'));
    if (layerIds.size > 1) {
        return { canMerge: false, reason: 'Setas devem estar na mesma camada' };
    }

    return { canMerge: true };
}

/**
 * Check whether a feature is a merged arrow that can be split
 * @param {Array} selectedFeatures - Array of GeoJSON features
 * @returns {{ canSplit: boolean }}
 */
export function canSplitArrows(selectedFeatures) {
    if (!selectedFeatures || selectedFeatures.length !== 1) {
        return { canSplit: false };
    }

    const feature = selectedFeatures[0];
    return {
        canSplit: feature.properties?.source === 'arrow' &&
                  feature.properties?.isMerged === true &&
                  Array.isArray(feature.properties?.branches) &&
                  feature.properties.branches.length > 1
    };
}

/**
 * Merge multiple arrow features into a single combined arrow
 * @param {Array} features - Arrow features to merge
 * @param {Object} map - MapLibre map instance
 * @param {Object} selectionManager - SelectionManager instance
 * @returns {Object|null} The merged feature, or null on failure
 */
export async function mergeArrows(features, map, selectionManager) {
    if (features.length < 2) {
        showWarning('Selecione pelo menos 2 setas para combinar');
        return null;
    }

    const geometry = new AddArrowGeometry();

    // Collect all branches from all source arrows (flatten already-merged arrows)
    const allBranches = [];
    for (const feature of features) {
        allBranches.push(...extractBranches(feature));
    }

    // Use visual properties from the first arrow as base
    const base = features[0].properties;
    const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();
    const featureName = await IDUtils.generateFeatureName('arrow', map);

    const mergedProperties = {
        source: 'arrow',
        geometryType: 'arrow',
        layerId: base.layerId || getActiveLayerIdSync(),
        id: featureId,
        nome: featureName,
        descricao: base.descricao || '',
        visivel: base.visivel !== false,
        bloqueado: base.bloqueado || false,
        fillColor: base.fillColor,
        lineColor: base.lineColor,
        lineWidth: base.lineWidth,
        fillOpacity: base.fillOpacity,
        lineOpacity: base.lineOpacity,
        isMerged: true,
        branches: allBranches,
        // Backward-compat: top-level geometric props mirror first branch
        baseCoordinates: allBranches[0].baseCoordinates,
        width: allBranches[0].width,
        showArrowHead: allBranches[0].showArrowHead,
        headLengthRatio: allBranches[0].headLengthRatio,
        airmobile: allBranches[0].airmobile,
        airmobilePosition: allBranches[0].airmobilePosition
    };

    const mergedGeometry = geometry.generate(mergedProperties.baseCoordinates, mergedProperties);
    if (!mergedGeometry) {
        showWarning('Erro ao gerar geometria combinada');
        return null;
    }

    const mergedFeature = {
        type: 'Feature',
        id: geoJsonId,
        properties: mergedProperties,
        geometry: mergedGeometry
    };

    try {
        // Deselect all before modifying
        selectionManager.deselectAllFeatures();

        const data = await map.getSource('arrows').getData();
        const idsToRemove = new Set(features.map(f => String(f.properties.id)));

        // Batch so a single Ctrl+Z undoes the whole merge as one unit.
        startBatchUndo();
        try {
            // Add the merged arrow FIRST so a persist failure cannot lose the
            // source arrows (worst case is a recoverable extra feature).
            await addFeature('arrows', mergedFeature);

            // Only after the add succeeded do we remove the originals.
            for (const feature of features) {
                await removeFeature('arrows', feature.properties.id);
            }
        } finally {
            commitBatchUndo();
        }

        data.features = data.features.filter(f => !idsToRemove.has(String(f.properties.id)));
        data.features.push(mergedFeature);
        map.getSource('arrows').setData(data);

        // Select the new merged feature
        await selectionManager.toggleFeatureSelection('arrow', featureId, mergedFeature);
        selectionManager.updateUI();

        showSuccess('Setas combinadas com sucesso');
        return mergedFeature;
    } catch (error) {
        console.error('Error merging arrows:', error);
        showWarning('Erro ao combinar setas');
        return null;
    }
}

/**
 * Split a merged arrow back into individual arrow features
 * @param {Object} mergedFeature - The merged arrow feature
 * @param {Object} map - MapLibre map instance
 * @param {Object} selectionManager - SelectionManager instance
 * @returns {Array|null} Array of created features, or null on failure
 */
export async function splitArrows(mergedFeature, map, selectionManager) {
    const props = mergedFeature.properties;
    if (!props.isMerged || !Array.isArray(props.branches) || props.branches.length < 2) {
        showWarning('Esta seta não é uma seta combinada');
        return null;
    }

    const geometry = new AddArrowGeometry();
    const createdFeatures = [];

    try {
        selectionManager.deselectAllFeatures();

        // Build every branch feature in memory BEFORE any write, so a geometry failure aborts
        // without having touched the store (mirrors the guard in mergeArrows).
        for (const branch of props.branches) {
            const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();
            const featureName = await IDUtils.generateFeatureName('arrow', map);

            const featureProps = {
                source: 'arrow',
                geometryType: 'arrow',
                layerId: props.layerId || getActiveLayerIdSync(),
                id: featureId,
                nome: featureName,
                descricao: props.descricao || '',
                visivel: props.visivel !== false,
                bloqueado: props.bloqueado || false,
                // Visual props from parent
                fillColor: props.fillColor,
                lineColor: props.lineColor,
                lineWidth: props.lineWidth,
                fillOpacity: props.fillOpacity,
                lineOpacity: props.lineOpacity,
                // Geometric props from branch
                baseCoordinates: branch.baseCoordinates,
                width: branch.width,
                showArrowHead: branch.showArrowHead !== false,
                headLengthRatio: branch.headLengthRatio || 1.5,
                airmobile: branch.airmobile || false,
                airmobilePosition: branch.airmobilePosition || 0.7
            };

            const featureGeometry = geometry.generate(featureProps.baseCoordinates, featureProps);
            if (!featureGeometry) {
                showWarning('Erro ao gerar geometria da seta');
                return null;
            }

            createdFeatures.push({
                type: 'Feature',
                id: geoJsonId,
                properties: featureProps,
                geometry: featureGeometry
            });
        }

        const data = await map.getSource('arrows').getData();

        // Batch so a single Ctrl+Z undoes the whole split as one unit. Add the branches FIRST
        // so a persist failure cannot lose the merged arrow (worst case is recoverable extras).
        startBatchUndo();
        try {
            for (const newFeature of createdFeatures) {
                await addFeature('arrows', newFeature);
            }
            await removeFeature('arrows', props.id);
        } finally {
            commitBatchUndo();
        }

        data.features = data.features.filter(f => String(f.properties.id) !== String(props.id));
        data.features.push(...createdFeatures);
        map.getSource('arrows').setData(data);

        // Select first created feature
        if (createdFeatures.length > 0) {
            const first = createdFeatures[0];
            await selectionManager.toggleFeatureSelection('arrow', first.properties.id, first);
            selectionManager.updateUI();
        }

        showSuccess('Setas separadas com sucesso');
        return createdFeatures;
    } catch (error) {
        console.error('Error splitting arrows:', error);
        showWarning('Erro ao separar setas');
        return null;
    }
}
