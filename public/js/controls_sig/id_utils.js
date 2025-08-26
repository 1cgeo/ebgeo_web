// Path: js\controls_sig\id_utils.js

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
     * @returns {string} Nome gerado ('Círculo #3', 'Seta #1', etc.)
     */
    static generateFeatureName(source, map) {
        try {
            // Mapeamento source → nome em português
            const SOURCE_DISPLAY_NAMES = {
                'rectangle': 'Retângulo',
                'circle': 'Círculo',
                'ellipse': 'Elipse',
                'arrow': 'Seta',
                'brush': 'Pincel',
                'boundary': 'Limite',
                'occupied_front': 'Frente Ocupada',
                'military_symbol': 'Símbolo Militar',
                'text': 'Texto',
                'image': 'Imagem',
                'los': 'Linha de Visada',
                'visibility': 'Visibilidade',
                'point': 'Ponto',
                'line': 'Linha',
                'polygon': 'Polígono'
            };

            // Mapeamento source → nome do source no mapa
            const SOURCE_TO_MAP_SOURCE = {
                'rectangle': 'rectangles',
                'circle': 'circles',
                'ellipse': 'ellipses',
                'brush': 'brushes',
                'arrow': 'arrows',
                'boundary': 'boundarys',
                'occupied_front': 'occupied_fronts',
                'military_symbol': 'military_symbols',
                'text': 'texts',
                'image': 'images',
                'los': 'los',
                'visibility': 'visibility',
                'point': 'points',
                'line': 'lines',
                'polygon': 'polygons'
            };

            let displayName;
            let featureCount = 0;

            displayName = SOURCE_DISPLAY_NAMES[source] || 'Feição';
            const mapSourceName = SOURCE_TO_MAP_SOURCE[source];

            if (mapSourceName) {
                const mapSource = map.getSource(mapSourceName);
                if (mapSource && mapSource._data && mapSource._data.features) {
                    featureCount = mapSource._data.features.length;
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
                    feature.id = Date.now().toString() + Math.random(); // Novo ID do GeoJSON
                }
            }
        }

        // Atualizar nome do mapa
        newMapData.nome = mapName;

        return newMapData;
    }

    /**
     * Verifica se um tipo de feature tem recursos de imagem associados
     */
    static hasImageResource(featureType) {
        const FEATURE_TYPES_WITH_IMAGES = ['images', 'military_symbols'];
        return FEATURE_TYPES_WITH_IMAGES.includes(featureType);
    }

    /**
     * Duplica recurso de imagem no imageStore
     */
    static async duplicateImageResource(oldId, newId, featureType) {
        try {
            const { imageStore } = await import('./store/store.js');

            const oldBlob = await imageStore.getItem(oldId);
            if (oldBlob) {
                await imageStore.setItem(newId, oldBlob);
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