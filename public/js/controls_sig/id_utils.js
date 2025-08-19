// Path: js/controls_sig/id_utils.js

/**
 * Utilitários simples para geração de IDs únicos
 */
export class IDUtils {
    
    /**
     * Gerar ID único simples
     */
    static generateUniqueId() {
        return Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Regenerar IDs de todas as feições em mapData e duplicar recursos
     */
    static async regenerateMapIds(mapData, mapName) {
        const idMapping = new Map();
        const newMapData = JSON.parse(JSON.stringify(mapData));
        
        // Processar cada tipo de feição
        for (const [featureType, features] of Object.entries(newMapData.features)) {
            if (!Array.isArray(features)) continue;
            
            for (const feature of features) {
                const oldId = feature.properties.id;
                const newId = this.generateUniqueId();
                
                // Atualizar ID da feição
                feature.properties.id = newId;
                idMapping.set(oldId, newId);
                
                // Processar recursos de imagem
                await this.duplicateImageResource(feature, oldId, newId, featureType);
            }
        }
        
        return { newMapData, idMapping };
    }
    
    /**
     * Duplicar recurso de imagem quando necessário
     */
    static async duplicateImageResource(feature, oldId, newId, featureType) {
        try {
            const { imageStore } = await import('./store.js');
            let resourceId = null;
            
            // Identificar ID do recurso baseado no tipo
            if (featureType === 'images') {
                resourceId = feature.properties?.id || oldId;
            } else if (featureType === 'military_symbols') {
                resourceId = feature.properties?.id;
            }
            
            if (!resourceId) return;
            
            // Verificar se recurso existe
            const resourceBlob = await imageStore.getItem(resourceId);
            if (!resourceBlob) return;
            
            // Duplicar recurso com novo ID
            await imageStore.setItem(newId, resourceBlob);
            
            // Atualizar referência na feição
            if (feature.properties) {
                feature.properties.id = newId;
            }
            
        } catch (error) {
            console.error('Erro ao duplicar recurso:', error);
        }
    }
}