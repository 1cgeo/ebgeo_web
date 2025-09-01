// Path: js\controls_sig\store\map-manager.js
import { memoryStore, setAppSetting } from './repository.js';

/**
 * Gerenciador de estado em memória e sistema undo/redo
 */
class MapManager {
    constructor() {
        this.memoryStore = memoryStore;
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
        this.setCurrentMapName(mapName);
        // Persistir último mapa ativo
        await setAppSetting('lastActiveMap', mapName);
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

    removeMapFromMemory(mapName) {
        delete this.memoryStore.maps[mapName];
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

// Singleton instance
const mapManagerInstance = new MapManager();

export default mapManagerInstance;