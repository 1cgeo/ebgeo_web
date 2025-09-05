// Path: js\controls_sig\tool_manager\group_manager.js
import { memoryStore, setMapGroups, getMapGroups } from '../store/repository.js';
import { IDUtils } from '../id_utils.js';

/**
 * Gerenciador central de grupos de features
 * Mantém cache em memória para consultas síncronas e persiste no IndexedDB
 */
export class GroupManager {
    constructor() {
        this.memoryStore = memoryStore;
    }

    // ===== OPERAÇÕES PRINCIPAIS =====

    /**
     * Cria um novo grupo com as features especificadas
     * @param {Array} features - Array de features a serem agrupadas
     * @param {string} mapName - Nome do mapa (null = mapa atual)
     * @returns {Object} Grupo criado
     */
    createGroup(features, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        
        // Validar se nenhuma feature já está agrupada
        const groupedFeatures = features.filter(feature => 
            this.isFeatureGrouped(feature.properties.source, feature.properties.id, targetMap)
        );
        
        if (groupedFeatures.length > 0) {
            throw new Error('Algumas features já estão agrupadas. Use "combinar grupos" em vez disso.');
        }

        if (features.length < 2) {
            throw new Error('É necessário pelo menos 2 features para criar um grupo.');
        }

        // Criar grupo
        const groupId = IDUtils.generateUniqueId();
        const groupName = this.generateGroupName(targetMap);
        
        const newGroup = {
            id: groupId,
            name: groupName,
            features: features.map(feature => ({
                type: feature.properties.source,
                id: feature.properties.id
            })),
            visible: true,
            locked: false
        };

        // Adicionar ao cache
        this._ensureMapGroupsExist(targetMap);
        this.memoryStore.groups[targetMap].set(groupId, newGroup);

        // Persistir em background
        this._saveGroupsToDBAsync(targetMap);

        return newGroup;
    }

    /**
     * Combina grupos existentes e/ou features soltas em um novo grupo
     * @param {Array} groupIds - IDs dos grupos a combinar
     * @param {Array} selectedFeatures - Features adicionais a incluir
     * @param {string} mapName - Nome do mapa
     * @returns {Object} Grupo combinado
     */
    combineGroups(groupIds, selectedFeatures = [], mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapGroupsExist(targetMap);

        const groupsCache = this.memoryStore.groups[targetMap];
        
        // Coletar todas as features dos grupos
        const allFeatures = [];
        let combinedGroupName = '';

        // Adicionar features dos grupos existentes
        groupIds.forEach((groupId, index) => {
            const group = groupsCache.get(groupId);
            if (group) {
                allFeatures.push(...group.features);
                if (index === 0) {
                    combinedGroupName = group.name; // Manter nome do primeiro grupo
                }
            }
        });

        // Adicionar features soltas (verificar se não estão agrupadas)
        selectedFeatures.forEach(feature => {
            const isGrouped = this.isFeatureGrouped(
                feature.properties.source, 
                feature.properties.id, 
                targetMap
            );
            
            if (!isGrouped) {
                allFeatures.push({
                    type: feature.properties.source,
                    id: feature.properties.id
                });
            }
        });

        if (allFeatures.length < 2) {
            throw new Error('É necessário pelo menos 2 features para formar um grupo.');
        }

        // Criar novo grupo combinado
        const newGroupId = IDUtils.generateUniqueId();
        const finalGroupName = combinedGroupName || this.generateGroupName(targetMap);
        
        const combinedGroup = {
            id: newGroupId,
            name: finalGroupName,
            features: allFeatures,
            visible: true,
            locked: false
        };

        // Remover grupos antigos do cache
        groupIds.forEach(groupId => {
            groupsCache.delete(groupId);
        });

        // Adicionar novo grupo
        groupsCache.set(newGroupId, combinedGroup);

        // Persistir
        this._saveGroupsToDBAsync(targetMap);

        return combinedGroup;
    }

    /**
     * Desfaz um grupo, deixando as features soltas
     * @param {string} groupId - ID do grupo a desfazer
     * @param {string} mapName - Nome do mapa
     * @returns {Array} Features que estavam no grupo
     */
    ungroupFeatures(groupId, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapGroupsExist(targetMap);

        const groupsCache = this.memoryStore.groups[targetMap];
        const group = groupsCache.get(groupId);

        if (!group) {
            throw new Error(`Grupo ${groupId} não encontrado.`);
        }

        const features = [...group.features];
        
        // Remover grupo do cache
        groupsCache.delete(groupId);

        // Persistir
        this._saveGroupsToDBAsync(targetMap);

        return features;
    }

    /**
     * Atualiza propriedade de um grupo (visibilidade, bloqueio, etc.)
     */
    updateGroupProperty(groupId, property, value, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapGroupsExist(targetMap);

        const groupsCache = this.memoryStore.groups[targetMap];
        const group = groupsCache.get(groupId);

        if (!group) {
            throw new Error(`Grupo ${groupId} não encontrado.`);
        }

        // Atualizar propriedade
        group[property] = value;

        // Persistir
        this._saveGroupsToDBAsync(targetMap);

        return group;
    }

    // ===== CONSULTAS SÍNCRONAS =====

    /**
     * Busca o grupo que contém uma feature específica
     * @param {string} type - Tipo da feature (source)
     * @param {string} featureId - ID da feature
     * @param {string} mapName - Nome do mapa
     * @returns {Object|null} Grupo encontrado ou null
     */
    getFeatureGroup(type, featureId, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapGroupsExist(targetMap);

        const groupsCache = this.memoryStore.groups[targetMap];

        for (const group of groupsCache.values()) {
            const hasFeature = group.features.some(f => 
                f.type === type && f.id === featureId
            );
            
            if (hasFeature) {
                return group;
            }
        }

        return null;
    }

    /**
     * Verifica se uma feature está em algum grupo
     */
    isFeatureGrouped(type, featureId, mapName = null) {
        return this.getFeatureGroup(type, featureId, mapName) !== null;
    }

    /**
     * Retorna todos os grupos de um mapa
     */
    getMapGroups(mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapGroupsExist(targetMap);
        
        return this.memoryStore.groups[targetMap];
    }

    /**
     * Retorna um grupo específico por ID
     */
    getGroupById(groupId, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapGroupsExist(targetMap);
        
        return this.memoryStore.groups[targetMap].get(groupId);
    }

    /**
     * Retorna todas as features de um grupo
     */
    getGroupFeatures(groupId, mapName = null) {
        const group = this.getGroupById(groupId, mapName);
        return group ? group.features : [];
    }

    // ===== UTILITÁRIOS =====

    /**
     * Gera nome único para um grupo ("Grupo 1", "Grupo 2", etc.)
     */
    generateGroupName(mapName) {
        this._ensureMapGroupsExist(mapName);
        const groupsCache = this.memoryStore.groups[mapName];
        
        const existingNames = new Set();
        for (const group of groupsCache.values()) {
            existingNames.add(group.name);
        }

        let counter = 1;
        let groupName;
        
        do {
            groupName = `Grupo ${counter}`;
            counter++;
        } while (existingNames.has(groupName));

        return groupName;
    }

    /**
     * Carrega grupos do IndexedDB para o cache em memória
     */
    async loadGroupsToMemory(mapName) {
        try {
            const groupsData = await getMapGroups(mapName);
            
            // Converter objeto para Map
            const groupsMap = new Map();
            Object.entries(groupsData).forEach(([groupId, groupData]) => {
                groupsMap.set(groupId, groupData);
            });

            this.memoryStore.groups[mapName] = groupsMap;
            
        } catch (error) {
            console.warn(`Erro ao carregar grupos do mapa ${mapName}:`, error);
            this.memoryStore.groups[mapName] = new Map();
        }
    }

    /**
     * Duplica grupos de um mapa para outro (para cópia de mapa)
     */
    async duplicateMapGroups(sourceMapName, targetMapName) {
        try {
            const sourceGroupsData = await getMapGroups(sourceMapName);
            
            if (Object.keys(sourceGroupsData).length === 0) {
                return; // Não há grupos para duplicar
            }

            // Criar novos IDs para os grupos (mas manter os IDs das features)
            const duplicatedGroups = {};
            
            Object.values(sourceGroupsData).forEach(group => {
                const newGroupId = IDUtils.generateUniqueId();
                duplicatedGroups[newGroupId] = {
                    ...group,
                    id: newGroupId,
                    // Features mantêm os mesmos IDs (assumindo que as features já foram duplicadas)
                };
            });

            // Salvar grupos duplicados
            await setMapGroups(targetMapName, duplicatedGroups);

            // Atualizar cache se for o mapa atual
            if (targetMapName === this.memoryStore.currentMap) {
                const groupsMap = new Map();
                Object.entries(duplicatedGroups).forEach(([groupId, groupData]) => {
                    groupsMap.set(groupId, groupData);
                });
                this.memoryStore.groups[targetMapName] = groupsMap;
            }

        } catch (error) {
            console.error(`Erro ao duplicar grupos de ${sourceMapName} para ${targetMapName}:`, error);
        }
    }

    /**
     * Combina grupos de múltiplos mapas em um mapa de destino
     */
    async combineMapGroups(sourceMapNames, targetMapName) {
        try {
            const targetGroups = await getMapGroups(targetMapName);
            const existingNames = new Set(
                Object.values(targetGroups).map(group => group.name)
            );

            // Coletar grupos de todos os mapas fonte
            for (const sourceMapName of sourceMapNames) {
                const sourceGroups = await getMapGroups(sourceMapName);
                
                Object.values(sourceGroups).forEach(group => {
                    const newGroupId = IDUtils.generateUniqueId();
                    
                    // Resolver conflito de nomes
                    let finalName = group.name;
                    let counter = 1;
                    while (existingNames.has(finalName)) {
                        finalName = `${group.name}_${counter}`;
                        counter++;
                    }
                    existingNames.add(finalName);

                    // Adicionar grupo com novo ID e nome resolvido
                    targetGroups[newGroupId] = {
                        ...group,
                        id: newGroupId,
                        name: finalName
                    };
                });
            }

            // Salvar grupos combinados
            await setMapGroups(targetMapName, targetGroups);

            // Atualizar cache se necessário
            if (targetMapName === this.memoryStore.currentMap) {
                await this.loadGroupsToMemory(targetMapName);
            }

        } catch (error) {
            console.error(`Erro ao combinar grupos em ${targetMapName}:`, error);
        }
    }

    /**
     * Remove todos os grupos de um mapa
     */
    async clearMapGroups(mapName) {
        try {
            // Limpar do IndexedDB
            await setMapGroups(mapName, {});

            // Limpar do cache
            if (this.memoryStore.groups[mapName]) {
                this.memoryStore.groups[mapName].clear();
            }

        } catch (error) {
            console.error(`Erro ao limpar grupos do mapa ${mapName}:`, error);
        }
    }

    /**
     * Remove feature de todos os grupos (quando feature é deletada)
     */
    removeFeatureFromAllGroups(type, featureId, mapName = null) {
        const targetMap = mapName || this.memoryStore.currentMap;
        this._ensureMapGroupsExist(targetMap);

        const groupsCache = this.memoryStore.groups[targetMap];
        let modified = false;

        // Percorrer todos os grupos e remover a feature
        for (const [groupId, group] of groupsCache) {
            const initialLength = group.features.length;
            group.features = group.features.filter(f => 
                !(f.type === type && f.id === featureId)
            );

            // Se grupo ficou vazio ou com apenas 1 feature, remover
            if (group.features.length <= 1) {
                groupsCache.delete(groupId);
                modified = true;
            } else if (group.features.length < initialLength) {
                modified = true;
            }
        }

        // Persistir se houve modificação
        if (modified) {
            this._saveGroupsToDBAsync(targetMap);
        }
    }

    // ===== MÉTODOS PRIVADOS =====

    /**
     * Garante que existe cache de grupos para um mapa
     */
    _ensureMapGroupsExist(mapName) {
        if (!this.memoryStore.groups[mapName]) {
            this.memoryStore.groups[mapName] = new Map();
        }
    }

    /**
     * Salva grupos no IndexedDB em background
     */
    _saveGroupsToDBAsync(mapName) {
        // Executar em próximo tick para não bloquear UI
        setTimeout(async () => {
            try {
                const groupsCache = this.memoryStore.groups[mapName];
                const groupsData = Object.fromEntries(groupsCache);
                await setMapGroups(mapName, groupsData);
            } catch (error) {
                console.error(`Erro ao salvar grupos do mapa ${mapName}:`, error);
            }
        }, 0);
    }
}

// Singleton instance
const groupManagerInstance = new GroupManager();

export default groupManagerInstance;