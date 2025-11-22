// Path: js\controls_sig\id_utils.js
import { getFeatureDisplayName, getStorageTypeFromSource, hasImageResource as storeHasImageResource } from './store/store.js';

/**
 * Utilitários simples para geração de IDs únicos e nomes de features
 */
export class IDUtils {

    /**
     * Gerar ID único simples
     */
    static generateUniqueId() {
        return Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * @param {string} source - Source da feature ('circle', 'ellipse', 'arrow', etc.)
     * @param {Object} map - Instância do mapa MapLibre
     * @returns {Promise<string>} Nome gerado ('Círculo #3', 'Seta #1', etc.)
     */
    static async generateFeatureName(source, map) {
        try {

            const displayName = getFeatureDisplayName(source);
            const mapSourceName = getStorageTypeFromSource(source);

            let featureCount = 0;

            if (mapSourceName) {
                const mapSource = map.getSource(mapSourceName);
                if (mapSource) {
                    const data = await mapSource.getData();
                    if (data && data.features) {
                        featureCount = data.features.length;
                    }
                }
            }

            // Próximo número sempre crescente
            const nextNumber = featureCount + 1;

            return `${displayName} #${nextNumber}`;

        } catch (error) {
            console.warn('Erro ao gerar nome da feature:', error);

            return `Feição #1`;
        }
    }

    /**
     * Regenerar IDs de todas as features em mapData e duplicar recursos
     * Separação de fases para evitar conflito de timing
     * 
     * @param {Object} mapData - Dados do mapa
     * @param {string} mapName - Nome do novo mapa
     * @returns {Object} Objeto contendo newMapData e idMapping
     */
    static async regenerateMapIds(mapData, mapName) {
        const idMapping = new Map();
        const newMapData = JSON.parse(JSON.stringify(mapData));

        // ✅ FASE 1: Coletar operações de recursos SEM alterar IDs das features
        const resourceOperations = [];

        for (const [featureType, features] of Object.entries(newMapData.features)) {
            if (!Array.isArray(features)) continue;

            for (const feature of features) {
                const oldId = feature.properties.id;
                const newId = this.generateUniqueId();

                // Mapear IDs para aplicação posterior
                idMapping.set(oldId, newId);

                // Se feature tem recurso de imagem, agendar duplicação
                if (this.hasImageResource(featureType)) {
                    resourceOperations.push({
                        oldId,
                        newId,
                        featureType
                    });
                }
            }
        }

        // ✅ FASE 2: Duplicar recursos usando IDs originais
        for (const operation of resourceOperations) {
            await this.duplicateImageResource(
                operation.oldId,
                operation.newId,
                operation.featureType
            );
        }

        // ✅ FASE 3: Aplicar novos IDs nas features
        for (const [featureType, features] of Object.entries(newMapData.features)) {
            if (!Array.isArray(features)) continue;

            for (const feature of features) {
                const oldId = feature.properties.id;
                const newId = idMapping.get(oldId);

                if (newId) {
                    feature.properties.id = newId;
                    feature.id = this.generateGeoJSONId();
                }
            }
        }

        // Atualizar nome do mapa
        newMapData.nome = mapName;

        return { newMapData, idMapping };
    }

    /**
     * Gera ID único para features GeoJSON (apenas números inteiros)
     */
    static generateGeoJSONId() {
        return Date.now() + Math.floor(Math.random() * 10000);
    }

    /**
     * Verifica se um tipo de feature tem recursos de imagem associados
     */
    static hasImageResource(featureType) {
        // Converter de storage type para source type se necessário
        const sourceType = featureType.endsWith('s') ? featureType.slice(0, -1) : featureType;
        return storeHasImageResource(sourceType);
    }

    /**
     * Duplica recurso de imagem no imageStore
     */
    static async duplicateImageResource(oldId, newId, featureType) {
        try {
            const { getImage, storeImage } = await import('./store/store.js');


            const oldBlob = await getImage(oldId);
            if (oldBlob) {
                await storeImage(newId, oldBlob);
            } else {
                console.warn(`⚠️ Recurso não encontrado para duplicação: ${oldId} (${featureType})`);
            }
        } catch (error) {
            console.error(`❌ Erro ao duplicar recurso ${oldId}:`, error);
        }
    }

    /**
     * Converte coordenadas de string para array se necessário
     */
    static normalizeCoordinates(coordinates) {
        if (typeof coordinates === 'string') {
            try {
                return JSON.parse(coordinates);
            } catch (e) {
                console.warn('Erro ao parsear coordenadas:', coordinates);
                return [];
            }
        }
        return Array.isArray(coordinates) ? coordinates : [];
    }

    /**
     * Validar se coordenadas são válidas
     */
    static isValidCoordinate(coord) {
        return Array.isArray(coord) &&
            coord.length >= 2 &&
            typeof coord[0] === 'number' &&
            typeof coord[1] === 'number' &&
            !isNaN(coord[0]) &&
            !isNaN(coord[1]);
    }

    /**
     * Filtrar coordenadas válidas de um array
     */
    static filterValidCoordinates(coordinates) {
        if (!Array.isArray(coordinates)) return [];

        return coordinates.filter(coord => this.isValidCoordinate(coord));
    }
}