// Path: js/military_tools/arrow_tool/arrow-merge.js

import { addFeature, removeFeature, getActiveLayerIdSync, startBatchUndo, commitBatchUndo } from '@store';
import { IDUtils, showSuccess, showWarning } from '@utils';
import { getGeoJsonDispatcher } from '@layers/geojson-dispatcher.js';
import AddArrowGeometry from './add_arrow_geometry.js';
import { ensureTurf } from '@utils/turf-loader.js';

/**
 * Per-branch geometric properties extracted from an arrow feature
 */
const BRANCH_GEOMETRIC_PROPS = [
    'baseCoordinates', 'width', 'showArrowHead', 'doubleHeaded',
    'headLengthRatio', 'airmobile', 'airmobilePosition'
];

/** Shared instance: `normalizeBaseCoordinates` carries no per-arrow state. */
const branchGeometry = new AddArrowGeometry();

/**
 * Copy a branch coordinate list so the branch owns every vertex.
 *
 * Two things this does that a spread does not. It NORMALIZES first, because
 * persistence hands `baseCoordinates` back as a JSON string and spreading a string
 * yields its characters; and it copies each `[lng, lat]`, because a one-level copy
 * leaves the vertices shared with the arrow the merge is about to consume, so
 * editing the merged arrow reaches back into the deleted one.
 * @param {string|Array} raw - Stored baseCoordinates (array or JSON string)
 * @returns {Array} Detached array of detached positions
 */
function copyBranchCoordinates(raw) {
    return branchGeometry
        .normalizeBaseCoordinates(raw)
        .map(coord => (Array.isArray(coord) ? [...coord] : coord));
}

/**
 * Extract branch data from a single arrow feature
 * @param {Object} feature - Arrow feature (regular or merged)
 * @returns {Array} Array of branch objects
 */
function extractBranches(feature) {
    const props = feature.properties;

    if (props.isMerged && Array.isArray(props.branches) && props.branches.length > 0) {
        return props.branches.map(b => (
            b.baseCoordinates !== undefined
                ? { ...b, baseCoordinates: copyBranchCoordinates(b.baseCoordinates) }
                : { ...b }
        ));
    }

    const branch = {};
    for (const key of BRANCH_GEOMETRIC_PROPS) {
        if (props[key] !== undefined) {
            branch[key] = key === 'baseCoordinates'
                ? copyBranchCoordinates(props[key])
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

    // `??`, not `||`: a falsy-but-real layer id (0, '') used to collapse into the
    // 'default' bucket, letting arrows from genuinely different layers through.
    const layerIds = new Set(selectedFeatures.map(f => f.properties?.layerId ?? 'default'));
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

    // O SEGUNDO DONO DE `add_arrow_geometry.js`, e o que o tira do grupo coberto por
    // `ensureControl`. Os setenta sitios de Turf daquele arquivo chegam por dois caminhos: a
    // ferramenta de seta (funil do registro) e este modulo, que `context-menu.control.js` e
    // `tool_manager/helpers/feature-header.helpers.js` importam por `import()` proprio, sem
    // passar pelo registro de ferramentas. As duas funcoes publicas que geram geometria ja
    // eram assincronas, entao o funil deste caminho custa uma linha em cada.
    await ensureTurf();

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
        // Raw, like `showArrowHead` right above it: the top-level props are the
        // MIRROR of the first branch for the old reader, and normalising here
        // would hand back an arrow the merge did not consume.
        doubleHeaded: allBranches[0].doubleHeaded,
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

        // Same dispatcher instance `add_arrow_control.js` uses (the registry is keyed by map +
        // source id), so this cannot wipe a diff the tool has queued.
        const dispatcher = getGeoJsonDispatcher(map, 'arrows');

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

        // The delta is exactly N removals plus one insertion, which is the diff format itself: no
        // collection read, no rewrite of the arrows this merge never touched.
        dispatcher.remove(features.map(f => f.properties.id));
        dispatcher.add(mergedFeature);
        await dispatcher.flush();

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

    // Mesmo motivo do `mergeArrows` acima. As duas guardas ficam ANTES: recusar o gesto nao
    // pode baixar 619 kB.
    await ensureTurf();

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
                // `=== true`, the mirror image of the line above: the flag is
                // OFF by default, so an absent value has to resolve to false the
                // same way an absent `showArrowHead` resolves to true.
                doubleHeaded: branch.doubleHeaded === true,
                // `??`, not `||`: `mergeArrows` preserves a branch that stored 0
                // (it copies every DEFINED key), so `||` here would hand a different
                // arrow back than the one the merge consumed.
                headLengthRatio: branch.headLengthRatio ?? 1.5,
                airmobile: branch.airmobile ?? false,
                airmobilePosition: branch.airmobilePosition ?? 0.7
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

        // Same dispatcher instance `add_arrow_control.js` uses (the registry is keyed by map +
        // source id), so this cannot wipe a diff the tool has queued.
        const dispatcher = getGeoJsonDispatcher(map, 'arrows');

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

        // The delta is exactly one removal plus N insertions, which is the diff format itself: no
        // collection read, no rewrite of the arrows this split never touched.
        dispatcher.remove(props.id);
        dispatcher.add(createdFeatures);
        await dispatcher.flush();

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
