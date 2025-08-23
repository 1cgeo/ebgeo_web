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
     * ✅ NOVO - Gera nome automático para feature baseado no source
     * @param {string} source - Source da feature ('circle', 'ellipse', etc.)
     * @param {Object} map - Instância do mapa MapLibre
     * @param {Object} [geometry] - Geometria da feature (para draw)
     * @returns {string} Nome gerado ('Círculo #3', 'Seta #1', etc.)
     */
    static generateFeatureName(source, map, geometry = null) {
        try {
            // Mapeamento source → nome em português
            const SOURCE_DISPLAY_NAMES = {
                'circle': 'Círculo',
                'ellipse': 'Elipse',
                'arrow': 'Seta',
                'boundary': 'Limite',
                'occupied_front': 'Frente Ocupada',
                'military_symbol': 'Símbolo Militar',
                'text': 'Texto',
                'image': 'Imagem',
                'los': 'Linha de Visada',
                'visibility': 'Visibilidade',
                // Draw types
                'point': 'Ponto',
                'linestring': 'Linha',
                'polygon': 'Polígono'
            };

            // Mapeamento source → nome do source no mapa
            const SOURCE_TO_MAP_SOURCE = {
                'circle': 'circles',
                'ellipse': 'ellipses',
                'arrow': 'arrows',
                'boundary': 'boundarys',
                'occupied_front': 'occupied_fronts',
                'military_symbol': 'military_symbols',
                'text': 'texts',
                'image': 'images',
                'los': 'los',
                'visibility': 'visibility'
            };

            let displayName;
            let featureCount = 0;

            // Tratamento especial para draw (baseado na geometria)
            if (source === 'draw' && geometry) {
                const geometryType = geometry.type.toLowerCase();
                displayName = SOURCE_DISPLAY_NAMES[geometryType] || 'Feature';
                
                // Para draw, contar via DrawControl
                const drawControl = map._controls.find(control => 
                    control.constructor.name === 'DrawControl' ||
                    control instanceof MapboxDraw
                );
                
                if (drawControl) {
                    const allDrawFeatures = drawControl.getAll().features;
                    featureCount = allDrawFeatures.filter(f => 
                        f.geometry.type.toLowerCase() === geometryType
                    ).length;
                }
            } else {
                // Sources normais
                displayName = SOURCE_DISPLAY_NAMES[source] || 'Feature';
                const mapSourceName = SOURCE_TO_MAP_SOURCE[source];
                
                if (mapSourceName) {
                    const mapSource = map.getSource(mapSourceName);
                    if (mapSource && mapSource._data && mapSource._data.features) {
                        featureCount = mapSource._data.features.length;
                    }
                }
            }

            // Próximo número sempre crescente
            const nextNumber = featureCount + 1;
            
            return `${displayName} #${nextNumber}`;
            
        } catch (error) {
            console.warn('Erro ao gerar nome da feature:', error);
            // Fallback seguro
            const fallbackNames = {
                'circle': 'Círculo',
                'ellipse': 'Elipse', 
                'arrow': 'Seta'
            };
            const fallbackName = fallbackNames[source] || 'Feature';
            return `${fallbackName} #1`;
        }
    }

    /**
     * Regenerar IDs de todas as features em mapData e duplicar recursos
     * ✅ CORREÇÃO: Separação de fases para evitar conflito de timing
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
                }
            }
        }
        
        return { newMapData, idMapping };
    }
    
    /**
     * Verificar se tipo de feature tem recurso de imagem
     */
    static hasImageResource(featureType) {
        return ['images', 'military_symbols'].includes(featureType);
    }
    
    /**
     * Duplicar recurso de imagem quando necessário
     */
    static async duplicateImageResource(oldId, newId, featureType) {
        try {
            const { imageStore } = await import('./store.js');
            
            // Verificar se tipo tem recurso de imagem
            if (!this.hasImageResource(featureType)) {
                return;
            }
            
            const resourceBlob = await imageStore.getItem(oldId);
            if (!resourceBlob) {
                console.warn(`Recurso ${oldId} não encontrado para ${featureType}`);
                return;
            }
            
            // ✅ CORREÇÃO: Verificar se novo ID já existe para evitar conflitos
            const existingBlob = await imageStore.getItem(newId);
            if (existingBlob) {
                console.warn(`ID ${newId} já existe no imageStore, pulando duplicação`);
                return;
            }
            
            // Duplicar recurso com novo ID
            await imageStore.setItem(newId, resourceBlob);
            
        } catch (error) {
            console.error('Erro ao duplicar recurso:', error);
            throw error;
        }
    }
}