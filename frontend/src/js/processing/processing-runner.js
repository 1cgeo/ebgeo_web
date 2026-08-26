// Path: js/processing/processing-runner.js

/**
 * @fileoverview Processing algorithm execution coordinator.
 * Collects features -> executes algorithm -> creates layer -> persists results.
 * Updates MapLibre sources after persistence (same pattern as import.control).
 */

import { getLayerFeatures, addFeatures } from '@store/feature.operations.js';
import { createLayerForImport } from '@store/layer.operations.js';
import { getStorageTypeFromSource } from '@store/store.constants.js';
import { isCurrentMapLockedSync } from '@store/map.operations.js';
import { getControl } from '@store/control.registry.js';
import { EventTypes } from '@events/event_types.js';
import { getGeoJsonDispatcher } from '@layers/geojson-dispatcher.js';
import { IDUtils } from '@utils/id_utils.js';
import { ensureTurf } from '@utils/turf-loader.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Executes a complete processing algorithm:
 * collect -> filter -> execute -> create layer -> persist -> emit events.
 *
 * @param {Object} options
 * @param {import('./algorithms/algorithm.interface.js').AlgorithmDefinition} options.algorithm
 * @param {Object} options.params - Algorithm parameters (includes sourceLayerId, distance, etc.)
 * @param {Object} options.stateManager - StateManager for selection
 * @param {Object} options.eventBus - EventBus for events
 * @param {Function} [options.onProgress] - Callback(current, total) for progress
 * @returns {Promise<{ layerId: string, featureCount: number }>}
 * @throws {Error} If map locked, no features, or processing error
 */
export async function runProcessing(options) {
    const { algorithm, params, stateManager, eventBus, onProgress } = options;
    const { sourceLayerId, useSelectedOnly, outputLayerName } = params;

    if (isCurrentMapLockedSync()) {
        throw new Error('Mapa bloqueado para edição');
    }

    eventBus.emit(EventTypes.PROCESSING_STARTED, {
        algorithmId: algorithm.id,
        sourceLayerId,
    });

    try {
        // Always read geometry from the STORE (the stored/home position), never from
        // the live selection objects — those get rewritten to the interpolated
        // position during temporal playback, which would make a selected-only run
        // process a moving feature at the cursor instead of its authored location.
        // For "use selected" we just intersect the layer's stored features with the
        // selected ids, so both paths use identical (home) geometry.
        let inputFeatures = await getLayerFeatures(sourceLayerId);
        if (useSelectedOnly) {
            const selectedIds = new Set(
                stateManager.getSelectedFeatures()
                    .map(item => item.feature?.properties?.id)
                    .filter(id => id != null)
            );
            inputFeatures = inputFeatures.filter(f => selectedIds.has(f.properties?.id));
        }

        inputFeatures = inputFeatures.filter(f => {
            const source = f.properties?.source;
            return algorithm.supportedGeometryTypes.includes(source);
        });

        if (inputFeatures.length === 0) {
            throw new Error('Nenhuma feição compatível encontrada na camada selecionada');
        }

        // O FUNIL DOS TRES ALGORITMOS. `execute` e SINCRONO por contrato
        // (`algorithms/algorithm.interface.js`), e os tres o cumprem lendo `window.turf`
        // direto: buffer, envoltoria convexa e Voronoi. Tornar `execute` assincrono mudaria a
        // interface para todo algoritmo futuro por uma dependencia que e detalhe da
        // implementacao de tres deles. O `await` fica aqui, no unico chamador, uma linha antes
        // — e este e o gesto de RODAR o algoritmo, entao a carga continua sob demanda.
        await ensureTurf();

        const resultFeatures = algorithm.execute(inputFeatures, {
            ...params,
            onProgress,
        });

        if (!resultFeatures || resultFeatures.length === 0) {
            throw new Error('O algoritmo não produziu resultados');
        }

        const newLayer = createLayerForImport(outputLayerName || `${algorithm.name} - Resultado`);
        if (!newLayer) {
            throw new Error('Falha ao criar camada de saída');
        }

        const featuresMap = {};

        for (const feature of resultFeatures) {
            const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();
            feature.properties.id = featureId;
            feature.id = geoJsonId;
            feature.properties.layerId = newLayer.id;

            const storageType = getStorageTypeFromSource(feature.properties.source);
            if (!featuresMap[storageType]) {
                featuresMap[storageType] = [];
            }
            featuresMap[storageType].push(feature);
        }

        await addFeatures(featuresMap);

        await _updateMapSources(featuresMap);

        eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
        eventBus.emit(EventTypes.PROCESSING_COMPLETED, {
            algorithmId: algorithm.id,
            layerId: newLayer.id,
            featureCount: resultFeatures.length,
        });

        return {
            layerId: newLayer.id,
            featureCount: resultFeatures.length,
        };

    } catch (error) {
        eventBus.emit(EventTypes.PROCESSING_ERROR, {
            algorithmId: algorithm.id,
            error: error.message,
        });
        throw error;
    }
}

// ============================================================================
// PRIVATE
// ============================================================================

/**
 * Updates MapLibre sources with persisted features.
 * Gets the map instance via control registry (same pattern as import).
 * Strips internal properties (_prefix) that should not go to MapLibre.
 * @private
 */
async function _updateMapSources(featuresMap) {
    const polygonControl = getControl('AddPolygonControl');
    const map = polygonControl?.map;
    if (!map) return;

    for (const [storageType, features] of Object.entries(featuresMap)) {
        if (features.length === 0) continue;

        if (map.getSource(storageType)) {
            for (const feature of features) _stripInternalProperties(feature);
            // Queued as one batch: these sources are dispatcher-owned, and a raw `setData` would
            // replace MapLibre's pending-update slot and drop a queued diff without any error.
            getGeoJsonDispatcher(map, storageType).add(features);
        }
    }
}

/**
 * Removes properties with _ prefix from a feature for MapLibre compatibility.
 * @private
 */
function _stripInternalProperties(feature) {
    if (!feature.properties) return;
    for (const key of Object.keys(feature.properties)) {
        if (key.startsWith('_')) {
            delete feature.properties[key];
        }
    }
}
