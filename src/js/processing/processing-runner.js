// Path: js/processing/processing-runner.js

/**
 * @fileoverview Coordenador de execução de algoritmos de processamento.
 * Coleta features → executa algoritmo → cria camada → persiste resultados.
 * Atualiza fontes MapLibre após persistência (mesmo padrão do import.control).
 * @dependencies store operations, event_types, utilities, control.registry
 */

import { getLayerFeatures, addFeatures } from '../store/feature.operations.js';
import { createLayerForImport } from '../store/layer.operations.js';
import { getStorageTypeFromSource } from '../store/store.constants.js';
import { isCurrentMapLockedSync } from '../store/map.operations.js';
import { getControl } from '../store/control.registry.js';
import { EventTypes } from '../events/event_types.js';
import { IDUtils } from '../utilities/id_utils.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Executa um algoritmo de processamento completo:
 * coleta → filtra → executa → cria camada → persiste → emite eventos.
 *
 * @param {Object} options
 * @param {import('./algorithms/algorithm.interface.js').AlgorithmDefinition} options.algorithm
 * @param {Object} options.params - Parâmetros do algoritmo (inclui sourceLayerId, distance, etc.)
 * @param {Object} options.stateManager - StateManager para seleção
 * @param {Object} options.eventBus - EventBus para eventos
 * @param {Function} [options.onProgress] - Callback(current, total) para progresso
 * @returns {Promise<{ layerId: string, featureCount: number }>}
 * @throws {Error} Se mapa bloqueado, sem feições, ou erro de processamento
 */
export async function runProcessing(options) {
    const { algorithm, params, stateManager, eventBus, onProgress } = options;
    const { sourceLayerId, useSelectedOnly, outputLayerName } = params;

    // 1. Verifica mapa bloqueado
    if (isCurrentMapLockedSync()) {
        throw new Error('Mapa bloqueado para edição');
    }

    // 2. Emite evento de início
    eventBus.emit(EventTypes.PROCESSING_STARTED, {
        algorithmId: algorithm.id,
        sourceLayerId,
    });

    try {
        // 3. Coleta features de entrada
        let inputFeatures;
        if (useSelectedOnly) {
            const allSelected = stateManager.getSelectedFeatures();
            inputFeatures = allSelected
                .map(item => item.feature)
                .filter(f => {
                    const fLayerId = f.properties?.layerId || 'default';
                    return fLayerId === sourceLayerId;
                });
        } else {
            inputFeatures = await getLayerFeatures(sourceLayerId);
        }

        // 4. Filtra por tipos suportados
        inputFeatures = inputFeatures.filter(f => {
            const source = f.properties?.source;
            return algorithm.supportedGeometryTypes.includes(source);
        });

        if (inputFeatures.length === 0) {
            throw new Error('Nenhuma feição compatível encontrada na camada selecionada');
        }

        // 5. Executa o algoritmo (função pura)
        const resultFeatures = algorithm.execute(inputFeatures, {
            ...params,
            onProgress,
        });

        if (!resultFeatures || resultFeatures.length === 0) {
            throw new Error('O algoritmo não produziu resultados');
        }

        // 6. Cria camada de saída
        const newLayer = createLayerForImport(outputLayerName || `${algorithm.name} - Resultado`);
        if (!newLayer) {
            throw new Error('Falha ao criar camada de saída');
        }

        // 7. Prepara features para persistência
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

        // 8. Persiste (batch, um único undo entry)
        await addFeatures(featuresMap);

        // 9. Atualiza fontes MapLibre (mesmo padrão de import.control / azimute-distância)
        await _updateMapSources(featuresMap);

        // 10. Emite eventos
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
 * Atualiza as fontes MapLibre com as features persistidas.
 * Obtém a instância do mapa via control registry (mesmo padrão do import).
 * Remove propriedades internas (_prefixo) que não devem ir para o MapLibre.
 * @private
 */
async function _updateMapSources(featuresMap) {
    // Obtém o mapa de qualquer controle registrado
    const polygonControl = getControl('AddPolygonControl');
    const map = polygonControl?.map;
    if (!map) return;

    for (const [storageType, features] of Object.entries(featuresMap)) {
        if (features.length === 0) continue;

        const source = map.getSource(storageType);
        if (source) {
            const data = await source.getData();
            // Remove propriedades internas (_prefixo) antes de adicionar ao MapLibre
            for (const feature of features) {
                _stripInternalProperties(feature);
                data.features.push(feature);
            }
            source.setData(data);
        }
    }
}

/**
 * Remove propriedades com prefixo _ do feature para compatibilidade com MapLibre.
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
