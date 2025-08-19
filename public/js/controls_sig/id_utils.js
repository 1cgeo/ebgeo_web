// Path: js\controls_sig\id_utils.js

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