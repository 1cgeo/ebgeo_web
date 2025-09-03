// Path: js\controls_sig\store\map-manager.js
import { memoryStore, setAppSetting, setColorUsage, getColorUsage, removeColorUsage, getAllMapNames, getMapData } from './repository.js';

/**
 * Gerenciador de estado em memória e sistema undo/redo
 * EXTENSÃO: Color Tracking System
 */
class MapManager {
    constructor() {
        this.memoryStore = memoryStore;
        // NOVO: Cache global de cores do projeto (soma de todos os mapas)
        this.projectColorCache = new Map(); // Map<color, count>
    }

    // ===== MEMORY STORE MANAGEMENT =====

    getCurrentMapName() {
        return this.memoryStore.currentMap;
    }

    setCurrentMapName(mapName) {
        this.memoryStore.currentMap = mapName;
        
        // Criar entrada no memoryStore se não existir
        if (!this.memoryStore.maps[mapName]) {
            this.memoryStore.maps[mapName] = {
                undoStack: [],
                redoStack: []
            };
        }
    }

    async setCurrentMap(mapName) {
        // Salvar cache do mapa anterior (se houver)
        if (this.memoryStore.currentMap && this.memoryStore.currentMap !== mapName) {
            await this.saveColorUsageToDB(this.memoryStore.currentMap);
        }
        
        this.setCurrentMapName(mapName);
        
        // Carregar cache do novo mapa
        await this.loadColorUsageFromDB(mapName);
        
        // Persistir último mapa ativo
        await setAppSetting('lastActiveMap', mapName);
    }

    // ===== COLOR TRACKING SYSTEM =====

    /**
     * Extrai cor de uma feature baseado nas propriedades do layer_setup.js
     */
    getFeatureColor(feature) {
        const props = feature.properties;
        if (!props) return null;
        
        // Prioridade baseada no layer_setup.js:
        return props.color ||           // Points, Lines, Polygons (fill), Occupied fronts, Boundaries, Texts, LOS/Visibility processed
               props.fillColor ||       // Circles, Rectangles, Arrows, Ellipses  
               props.lineColor ||       // Circles, Rectangles, Arrows, Ellipses, Brushes
               props.outlinecolor ||    // Polygons (border)
               props.backgroundColor;   // Texts (background)
    }

    /**
     * Processa cores de um mapa (usado no addMap)
     */
    async processMapColors(mapName, mapData, colorUsageData = null) {
        let mapColorCounts;
        
        if (colorUsageData) {
            // Dados de cor já fornecidos (ex: vem de arquivo .ebgeo)
            mapColorCounts = new Map();
            for (const [color, count] of Object.entries(colorUsageData)) {
                mapColorCounts.set(color, Number(count) || 0);
            }
        } else {
            // Calcular cores do zero
            mapColorCounts = await this.calculateMapColors(mapData);
        }
        
        // Salvar no IndexDB específico do mapa
        await setColorUsage(mapName, Object.fromEntries(mapColorCounts));
        
        // Atualizar cache do projeto (soma global)
        this.updateProjectColorCache(mapColorCounts, 'add');
        
        // Se é o mapa atual, também atualizar cache de memória
        if (mapName === this.memoryStore.currentMap) {
            this.memoryStore.colorUsageCache = mapColorCounts;
        }
    }

    /**
     * Calcula cores de um mapa do zero
     */
    async calculateMapColors(mapData) {
        const colorCounts = new Map();
        
        Object.entries(mapData.features || {}).forEach(([featureType, features]) => {
            if (!Array.isArray(features)) return;
            
            features.forEach(feature => {
                const color = this.getFeatureColor(feature);
                if (color) {
                    colorCounts.set(color, (colorCounts.get(color) || 0) + 1);
                }
            });
        });
        
        return colorCounts;
    }

    /**
     * Atualiza cache do projeto (soma de todos os mapas)
     */
    updateProjectColorCache(mapColors, operation) {
        // operation: 'add' ou 'remove'
        const multiplier = operation === 'add' ? 1 : -1;
        
        for (const [color, count] of mapColors) {
            const currentCount = this.projectColorCache.get(color) || 0;
            const newCount = currentCount + (count * multiplier);
            
            if (newCount <= 0) {
                this.projectColorCache.delete(color);
            } else {
                this.projectColorCache.set(color, newCount);
            }
        }
    }

    /**
     * Carrega cores do IndexDB para o cache
     */
    async loadColorUsageFromDB(mapName) {
        try {
            const colorData = await getColorUsage(mapName);
            const colorMap = new Map();
            
            // Converter para Map e garantir números
            for (const [color, count] of Object.entries(colorData)) {
                colorMap.set(color, Number(count) || 0);
            }
            
            this.memoryStore.colorUsageCache = colorMap;
            
            // Se cache vazio, fazer análise inicial em background
            if (colorMap.size === 0) {
                setTimeout(() => this.performInitialColorAnalysis(mapName), 100);
            }
            
        } catch (error) {
            console.warn(`Erro ao carregar cores do mapa ${mapName}:`, error);
            this.memoryStore.colorUsageCache = new Map();
        }
    }

    /**
     * Salva cache de cores no IndexDB (background)
     */
    async saveColorUsageToDB(mapName) {
        try {
            const colorData = Object.fromEntries(this.memoryStore.colorUsageCache);
            await setColorUsage(mapName, colorData);
        } catch (error) {
            console.warn(`Erro ao salvar cores do mapa ${mapName}:`, error);
        }
    }

    /**
     * Realiza análise inicial de cores de um mapa existente
     */
    async performInitialColorAnalysis(mapName) {
        try {
            const mapData = await getMapData(mapName);
            const colorCounts = new Map();
            
            // Analisar todas as features de todos os tipos
            Object.entries(mapData.features || {}).forEach(([featureType, features]) => {
                if (!Array.isArray(features)) return;
                
                features.forEach(feature => {
                    const color = this.getFeatureColor(feature);
                    if (color) {
                        colorCounts.set(color, (colorCounts.get(color) || 0) + 1);
                    }
                });
            });
            
            // Se é o mapa atual, atualizar cache
            if (mapName === this.memoryStore.currentMap) {
                this.memoryStore.colorUsageCache = colorCounts;
            }
            
            // Sempre persistir no IndexDB
            await setColorUsage(mapName, Object.fromEntries(colorCounts));
            
            // Atualizar cache do projeto
            this.updateProjectColorCache(colorCounts, 'add');
            
        } catch (error) {
            console.warn(`Erro na análise inicial de cores do mapa ${mapName}:`, error);
        }
    }

    /**
     * Atualiza tracking de cores quando features mudam
     */
    updateColorUsage(oldColor, newColor, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        const isCurrentMap = targetMap === this.memoryStore.currentMap;
        
        if (isCurrentMap) {
            // Atualizar cache de memória apenas se for o mapa atual
            if (oldColor) {
                const oldCount = this.memoryStore.colorUsageCache.get(oldColor) || 0;
                if (oldCount <= 1) {
                    this.memoryStore.colorUsageCache.delete(oldColor);
                } else {
                    this.memoryStore.colorUsageCache.set(oldColor, oldCount - 1);
                }
            }
            
            if (newColor) {
                const newCount = this.memoryStore.colorUsageCache.get(newColor) || 0;
                this.memoryStore.colorUsageCache.set(newColor, newCount + 1);
            }
            
            // Background save
            setTimeout(() => this.saveColorUsageToDB(targetMap), 100);
        }
        
        // Sempre atualizar cache do projeto
        if (oldColor) {
            const oldProjectCount = this.projectColorCache.get(oldColor) || 0;
            if (oldProjectCount <= 1) {
                this.projectColorCache.delete(oldColor);
            } else {
                this.projectColorCache.set(oldColor, oldProjectCount - 1);
            }
        }
        
        if (newColor) {
            const newProjectCount = this.projectColorCache.get(newColor) || 0;
            this.projectColorCache.set(newColor, newProjectCount + 1);
        }
    }

    /**
     * API pública para obter cores frequentes
     */
    getFrequentColors(limit = 10, scope = 'current') {
        const sourceCache = scope === 'project' ? 
            this.projectColorCache : 
            this.memoryStore.colorUsageCache;
            
        return Array.from(sourceCache.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([color, count]) => ({ color, count }));
    }

    /**
     * Limpa todos os caches de cor
     */
    async clearAllColorCaches() {
        // Limpar cache de memória
        this.memoryStore.colorUsageCache = new Map();
        this.projectColorCache.clear();
        
        // Limpar IndexDB - buscar todas as chaves de cor
        try {
            const allMaps = await getAllMapNames();
            for (const mapName of allMaps) {
                await removeColorUsage(mapName);
            }
        } catch (error) {
            console.warn('Erro ao limpar caches de cor:', error);
        }
    }

    /**
     * Inicializa cache do projeto carregando cores de todos os mapas
     */
    async initializeProjectColorCache() {
        try {
            this.projectColorCache.clear();
            const allMaps = await getAllMapNames();
            
            for (const mapName of allMaps) {
                const colorData = await getColorUsage(mapName);
                const mapColors = new Map(Object.entries(colorData));
                this.updateProjectColorCache(mapColors, 'add');
            }
        } catch (error) {
            console.warn('Erro ao inicializar cache de cores do projeto:', error);
        }
    }

    // ===== UNDO/REDO SYSTEM =====

    recordAction(action) {
        const currentMap = this.memoryStore.maps[this.memoryStore.currentMap];
        if (!this.memoryStore.isUndoing && !this.memoryStore.isRedoing) {
            currentMap.undoStack.push(action);
            if (currentMap.undoStack.length > 20) {
                currentMap.undoStack.shift();
            }
            currentMap.redoStack = [];
        }
    }

    async undoLastAction(executeFunction) {
        const currentMap = this.memoryStore.maps[this.memoryStore.currentMap];
        const lastAction = currentMap.undoStack.pop();
        if (!lastAction) return false;

        this.memoryStore.isUndoing = true;
        currentMap.redoStack.push(lastAction);
        
        try {
            await this._executeUndoAction(lastAction, executeFunction);
        } finally {
            this.memoryStore.isUndoing = false;
        }

        return true;
    }

    async redoLastAction(executeFunction) {
        const currentMap = this.memoryStore.maps[this.memoryStore.currentMap];
        const lastUndoneAction = currentMap.redoStack.pop();
        if (!lastUndoneAction) return false;

        this.memoryStore.isRedoing = true;
        currentMap.undoStack.push(lastUndoneAction);

        try {
            await this._executeRedoAction(lastUndoneAction, executeFunction);
        } finally {
            this.memoryStore.isRedoing = false;
        }

        return true;
    }

    async _executeUndoAction(action, executeFunction) {
        switch (action.type) {
            case 'add':
                await executeFunction.removeFeature(action.featureType, action.feature.properties.id);
                break;
            case 'update':
                await executeFunction.updateFeature(action.featureType, action.oldFeature);
                break;
            case 'remove':
                await executeFunction.addFeature(action.featureType, action.feature);
                break;
            case 'removeWithProcessed':
                // Restaurar feature principal
                await executeFunction.addFeature(action.mainFeatureType, action.mainFeature);
                // Restaurar features processadas se houver
                if (action.processedFeatures) {
                    for (const pf of action.processedFeatures.features) {
                        await executeFunction.addFeature(action.processedFeatures.type, pf);
                    }
                }
                break;
            case 'addMultiple':
                for (const [type, features] of Object.entries(action.features)) {
                    for (const feature of features) {
                        await executeFunction.removeFeature(type, feature.properties.id);
                    }
                }
                break;
            case 'moveBetweenMaps':
                // UNDO: Mover features de volta (destino → origem)
                for (const [type, typeOps] of Object.entries(action.movedFeatures)) {
                    for (const featureOp of typeOps.mainFeatures) {
                        // Remover do destino
                        await executeFunction.removeFeatureFromMap(type, featureOp.feature.properties.id, action.targetMapName);
                        
                        // Restaurar na origem
                        await executeFunction.addFeatureToMap(type, featureOp.removedData.mainFeature, action.sourceMapName);

                        // Restaurar processadas se houver
                        if (featureOp.removedData.processedFeatures) {
                            for (const pf of featureOp.removedData.processedFeatures.features) {
                                await executeFunction.addFeatureToMap(featureOp.removedData.processedFeatures.type, pf, action.sourceMapName);
                            }
                        }
                    }
                }
                break;
        }
    }

    async _executeRedoAction(action, executeFunction) {
        switch (action.type) {
            case 'add':
                await executeFunction.addFeature(action.featureType, action.feature);
                break;
            case 'update':
                await executeFunction.updateFeature(action.featureType, action.newFeature);
                break;
            case 'remove':
                await executeFunction.removeFeature(action.featureType, action.feature.properties.id);
                break;
            case 'removeWithProcessed':
                // Remover feature principal (que automaticamente remove processadas)
                await executeFunction.removeFeature(action.mainFeatureType, action.mainFeature.properties.id);
                break;
            case 'addMultiple':
                for (const [type, features] of Object.entries(action.features)) {
                    for (const feature of features) {
                        await executeFunction.addFeature(type, feature);
                    }
                }
                break;
            case 'moveBetweenMaps':
                // REDO: Refazer o movimento (origem → destino)
                for (const [type, typeOps] of Object.entries(action.movedFeatures)) {
                    for (const featureOp of typeOps.mainFeatures) {
                        // Remover da origem
                        await executeFunction.removeFeatureFromMap(type, featureOp.removedData.mainFeature.properties.id, action.sourceMapName);
                        
                        // Adicionar no destino
                        await executeFunction.addFeatureToMap(type, featureOp.feature, action.targetMapName);

                        // Adicionar processadas se houver
                        if (featureOp.removedData.processedFeatures) {
                            for (const pf of featureOp.removedData.processedFeatures.features) {
                                await executeFunction.addFeatureToMap(featureOp.removedData.processedFeatures.type, pf, action.targetMapName);
                            }
                        }
                    }
                }
                break;
        }
    }

    // ===== UTILITY METHODS =====

    isUndoing() {
        return this.memoryStore.isUndoing;
    }

    isRedoing() {
        return this.memoryStore.isRedoing;
    }

    canUndo() {
        const currentMap = this.memoryStore.maps[this.memoryStore.currentMap];
        return currentMap?.undoStack.length > 0;
    }

    canRedo() {
        const currentMap = this.memoryStore.maps[this.memoryStore.currentMap];
        return currentMap?.redoStack.length > 0;
    }

    clearHistory(mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        if (this.memoryStore.maps[targetMap]) {
            this.memoryStore.maps[targetMap].undoStack = [];
            this.memoryStore.maps[targetMap].redoStack = [];
        }
    }

    // ===== MAP MANAGEMENT =====

    addMapToMemory(mapName) {
        this.memoryStore.maps[mapName] = {
            undoStack: [],
            redoStack: []
        };
    }

    async removeMapFromMemory(mapName) {
        // Código existente
        delete this.memoryStore.maps[mapName];
        
        // NOVO: Remover cores do cache do projeto
        try {
            const mapColors = await getColorUsage(mapName);
            if (mapColors && Object.keys(mapColors).length > 0) {
                const mapColorsMap = new Map(Object.entries(mapColors));
                this.updateProjectColorCache(mapColorsMap, 'remove');
            }
            await removeColorUsage(mapName);
        } catch (error) {
            console.warn(`Erro ao remover cores do mapa ${mapName}:`, error);
        }
    }

    renameMapInMemory(oldName, newName) {
        if (this.memoryStore.maps[oldName]) {
            this.memoryStore.maps[newName] = this.memoryStore.maps[oldName];
            delete this.memoryStore.maps[oldName];

            if (this.memoryStore.currentMap === oldName) {
                this.memoryStore.currentMap = newName;
            }
        }
    }

    // ===== BATCH OPERATIONS =====

    recordBatchOperation(operations) {
        if (operations.length === 0) return;

        if (operations.length === 1) {
            this.recordAction(operations[0]);
        } else {
            // Para múltiplas operações, criar uma ação composta
            this.recordAction({
                type: 'batch',
                operations: operations
            });
        }
    }
}

// Inicializar memoryStore com cache de cores
if (!memoryStore.colorUsageCache) {
    memoryStore.colorUsageCache = new Map();
}

// Singleton instance
const mapManagerInstance = new MapManager();

export default mapManagerInstance;