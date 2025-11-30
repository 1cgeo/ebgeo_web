// Path: js\controls_sig\export_import_service.js
import {
    getAllMapNamesStore,
    getCurrentMapName,
    getCurrentMapFeatures,
    getCurrentBaseLayer,
    setBaseLayer,
    MIN_SCHEMA_VERSION,
    MAX_SCHEMA_VERSION,
    SCHEMA_VERSION,
    compareVersions,
    addMap,
    setCurrentMap,
    clearAllDataStore,
    getImage,
    storeImage,
    setSchemaVersion,
    getColorUsage,
    getMapNotes,
    getMapGroups,
    // Layer imports
    getLayers,
    setMapLayers,
} from './store/store.js';

import { IDUtils } from './id_utils.js';
import config from '../config.js';
import { showToast, showSuccess } from './utilities/toast_service.js';
import groupManager from './tool_manager/group_manager.js';

/**
 * Normaliza estrutura de mapData para a versão atual
 * Garante que coordination_measures existe (adicionado em v1.4)
 */
const normalizeMapDataForCurrentVersion = (mapData) => {
    if (!mapData.features.coordination_measures) {
        mapData.features.coordination_measures = [];
    }
    return mapData;
};

export class ExportImportService {
    constructor(baseLayerControl, mapControl, mapManager) {
        this.baseLayerControl = baseLayerControl;
        this.mapControl = mapControl;
        this.mapManager = mapManager;
    }

    // Arredondar coordenadas para precisão de 1 metro (6 casas decimais)
    roundCoordinates(coords) {
        const precision = 6;
        const factor = Math.pow(10, precision);

        if (Array.isArray(coords[0])) {
            return coords.map(coord => this.roundCoordinates(coord));
        } else {
            return coords.map(coord => Math.round(coord * factor) / factor);
        }
    }

    // Otimizar feature individual
    optimizeFeature(feature) {
        const optimized = { ...feature };

        // Arredondar coordenadas
        if (optimized.geometry && optimized.geometry.coordinates) {
            optimized.geometry.coordinates = this.roundCoordinates(optimized.geometry.coordinates);
        }

        return optimized;
    }

    // Otimizar dados do mapa
    optimizeMapData(mapData) {
        const optimized = { ...mapData };

        if (optimized.features) {
            for (const [category, features] of Object.entries(optimized.features)) {
                if (Array.isArray(features)) {
                    optimized.features[category] = features.map(feature =>
                        this.optimizeFeature(feature)
                    );
                }
            }
        }

        return optimized;
    }

    // Detectar extensão correta do blob baseado no tipo MIME
    getBlobExtension(blob) {
        const mimeType = blob.type || 'image/png';
        switch (mimeType) {
            case 'image/svg+xml': return 'svg';
            case 'image/jpeg': return 'jpg';
            case 'image/webp': return 'webp';
            case 'image/png':
            default: return 'png';
        }
    }

    // XOR simples para mascarar dados
    xorData(data, key = 0xAA) {
        const result = new Uint8Array(data.length);
        for (let i = 0; i < data.length; i++) {
            result[i] = data[i] ^ key;
        }
        return result;
    }

    // Criar botão de salvar
    createSaveButton() {
        const saveButton = document.createElement('button');
        saveButton.className = 'map-action-button save-action';
        saveButton.innerHTML = `<img src="./images/icon_save_black.svg" alt="Exportar projeto" />`;
        saveButton.title = 'Exportar projeto';

        saveButton.onclick = async () => {
            await this.handleExport();
        };

        return saveButton;
    }

    // Criar botão de carregar
    createLoadButton() {
        const loadButton = document.createElement('button');
        loadButton.className = 'map-action-button load-action';
        loadButton.innerHTML = `<img src="./images/icon_load_black.svg" alt="Importar projeto" />`;
        loadButton.title = 'Importar projeto (substitui atual)';

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.ebgeo';
        fileInput.className = 'hidden-file-input';
        fileInput.onchange = async (event) => {
            await this.handleImport(event, false);
        };

        loadButton.onclick = () => {
            fileInput.click();
        };

        loadButton.appendChild(fileInput);
        return loadButton;
    }

    // Criar botão de carregar aditivo
    createLoadAdditiveButton() {
        const loadAdditiveButton = document.createElement('button');
        loadAdditiveButton.className = 'map-action-button load-action';
        loadAdditiveButton.innerHTML = `<img src="./images/icon_folder_plus_black.svg" alt="Adicionar ao projeto" />`;
        loadAdditiveButton.title = 'Adicionar ao projeto atual';

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.ebgeo';
        fileInput.className = 'hidden-file-input';
        fileInput.onchange = async (event) => {
            await this.handleImport(event, true);
        };

        loadAdditiveButton.onclick = () => {
            fileInput.click();
        };

        loadAdditiveButton.appendChild(fileInput);
        return loadAdditiveButton;
    }

    // Manipular exportação
    async handleExport() {
        try {
            this.mapControl.deactivateActiveTools();

            const zip = new JSZip();

            const mapsToExport = await getAllMapNamesStore();

            if (mapsToExport.length === 0) {
                alert('Nenhum mapa para exportar');
                return;
            }

            const data = {
                version: SCHEMA_VERSION,
                currentMap: await getCurrentMapName(),
                maps: {},
                colorUsage: {},
                mapNotes: {},
                groups: {},
                layers: {}, // NEW: Add layers to export data
            };

            // Exportar dados dos mapas com otimização
            for (const mapName of mapsToExport) {
                const mapData = await getCurrentMapFeatures(mapName);
                if (mapData) {
                    // Reconstruir estrutura completa do mapa
                    const fullMapData = {
                        baseLayer: await getCurrentBaseLayer(mapName),
                        hillshadeEnabled: true, // Valor padrão, poderia ser obtido via nova função
                        analysisLayers: {}, // Valor padrão, poderia ser obtido via nova função
                        features: mapData,
                        zoom: null,
                        center_lat: null,
                        center_long: null
                    };

                    data.maps[mapName] = this.optimizeMapData(fullMapData);
                }

                // Exportar dados de cores
                try {
                    const colorData = await getColorUsage(mapName);
                    if (colorData && Object.keys(colorData).length > 0) {
                        data.colorUsage[mapName] = colorData;
                    }
                } catch (error) {
                    console.warn(`Não foi possível exportar cores do mapa ${mapName}:`, error);
                }

                // Exportar notas do mapa
                try {
                    const notesData = await getMapNotes(mapName);
                    if (notesData && (notesData.title || notesData.description)) {
                        data.mapNotes[mapName] = notesData;
                    }
                } catch (error) {
                    console.warn(`Não foi possível exportar notas do mapa ${mapName}:`, error);
                }

                // Exportar grupos do mapa
                try {
                    const groupsMap = getMapGroups(mapName);
                    if (groupsMap && groupsMap.size > 0) {
                        // Converter Map para Object para serialização JSON
                        data.groups[mapName] = Object.fromEntries(groupsMap);
                    }
                } catch (error) {
                    console.warn(`Não foi possível exportar grupos do mapa ${mapName}:`, error);
                }

                // NEW: Exportar layers do mapa
                try {
                    const layersData = await getLayers(mapName);
                    if (layersData && layersData.length > 0) {
                        data.layers[mapName] = layersData;
                    }
                } catch (error) {
                    console.warn(`Não foi possível exportar layers do mapa ${mapName}:`, error);
                }
            }

            // Adicionar data.json ao ZIP sem indentação e com compressão máxima
            const jsonString = JSON.stringify(data);
            zip.file('data.json', jsonString, {
                compression: 'DEFLATE',
                compressionOptions: { level: 9 }
            });

            // Coletar e exportar imagens usadas
            const usedImages = new Set();
            for (const mapName of mapsToExport) {
                const mapData = await getCurrentMapFeatures(mapName);
                if (mapData) {
                    for (const [category, features] of Object.entries(mapData)) {
                        if (Array.isArray(features)) {
                            features.forEach(feature => {
                                if (feature.properties && feature.properties.id) {
                                    usedImages.add(feature.properties.id);
                                }
                            });
                        }
                    }
                }
            }

            // Adicionar imagens ao ZIP com extensão correta baseada no tipo MIME
            for (const imageId of usedImages) {
                try {
                    const blob = await getImage(imageId);
                    if (blob) {
                        const extension = this.getBlobExtension(blob);
                        zip.file(`images/${imageId}.${extension}`, blob, {
                            compression: 'DEFLATE',
                            compressionOptions: { level: 9 }
                        });
                    }
                } catch (error) {
                    console.warn('Imagem não encontrada:', imageId);
                }
            }

            // Gerar arquivo ZIP
            const zipBlob = await zip.generateAsync({
                type: 'blob',
                compression: 'DEFLATE',
                compressionOptions: { level: 9 },
                streamFiles: true
            });

            // Aplicar XOR nos dados ZIP para mascarar
            const zipArray = new Uint8Array(await zipBlob.arrayBuffer());
            const maskedData = this.xorData(zipArray);

            // Adicionar identificador no início para detectar arquivo XOR
            const identifier = new TextEncoder().encode('EBGXOR');
            const finalArray = new Uint8Array(identifier.length + maskedData.length);
            finalArray.set(identifier, 0);
            finalArray.set(maskedData, identifier.length);

            // Criar blob final
            const finalBlob = new Blob([finalArray], {
                type: 'application/vnd.ebgeo'
            });

            const url = URL.createObjectURL(finalBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `projeto-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.ebgeo`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            this.showSaveSuccess(mapsToExport.length);

        } catch (error) {
            console.error('Erro ao exportar dados:', error);
            alert('Erro ao exportar arquivo .ebgeo');
        }
    }

    // Manipular importação
    async handleImport(event, isAdditiveImport) {
        this.mapControl.deactivateActiveTools();

        const file = event.target.files[0];
        if (!file) return;

        try {
            const fileBuffer = await file.arrayBuffer();
            const fileArray = new Uint8Array(fileBuffer);

            let zipData;
            const identifier = new TextDecoder().decode(fileArray.slice(0, 6));

            if (identifier === 'EBGXOR') {
                const maskedData = fileArray.slice(6);
                zipData = this.xorData(maskedData);
            } else {
                zipData = fileArray;
            }

            const zip = await JSZip.loadAsync(zipData);

            if (!isAdditiveImport) {
                await clearAllDataStore();
            }

            const dataFile = zip.file('data.json');
            if (!dataFile) {
                throw new Error('Arquivo data.json não encontrado no .ebgeo');
            }

            const dataJson = await dataFile.async('string');
            const data = JSON.parse(dataJson);

            if (!data.version) {
                throw new Error('Arquivo .ebgeo sem informação de versão. Use a versão mais recente da aplicação para gerar o arquivo.');
            }

            if (compareVersions(data.version, MIN_SCHEMA_VERSION) < 0) {
                throw new Error(`Arquivo .ebgeo incompatível. Versão do arquivo: ${data.version}, versão mínima aceita: ${MIN_SCHEMA_VERSION}`);
            }
            if (compareVersions(data.version, MAX_SCHEMA_VERSION) > 0) {
                throw new Error(`Arquivo .ebgeo incompatível - versão muito recente. Versão do arquivo: ${data.version}, versão máxima aceita: ${MAX_SCHEMA_VERSION}. Atualize a aplicação para usar este arquivo.`);
            }

            await setSchemaVersion(SCHEMA_VERSION);

            let importedMapsCount = 0;

            if (isAdditiveImport) {
                await this.loadImagesFromZip(zip);

                const existingMapNames = await getAllMapNamesStore();
                const mapsToImport = Object.keys(data.maps).length;

                if (existingMapNames.length + mapsToImport > 100) {
                    throw new Error(`Limite de mapas excedido. Você tem ${existingMapNames.length} mapas, tentando importar ${mapsToImport}. Limite: 100 mapas.`);
                }

                const mapNameMapping = new Map();

                for (const [originalMapName, mapData] of Object.entries(data.maps)) {
                    // Encontrar nome único
                    let finalMapName = originalMapName;
                    let counter = 1;
                    while (existingMapNames.includes(finalMapName)) {
                        finalMapName = `${originalMapName}_${counter}`;
                        counter++;
                    }

                    mapNameMapping.set(originalMapName, finalMapName);

                    // Regenerar IDs das features
                    const { newMapData } = await IDUtils.regenerateMapIds(mapData, finalMapName);

                    // Normalizar estrutura para versão atual
                    normalizeMapDataForCurrentVersion(newMapData);

                    // Buscar dados originais do arquivo para preservar cores e notas
                    const originalColorUsage = data.colorUsage?.[originalMapName] || null;
                    const originalNotes = data.mapNotes?.[originalMapName] || null;

                    // Passar cores e notas para preservar dados originais
                    await addMap(finalMapName, newMapData, originalColorUsage, originalNotes);
                    existingMapNames.push(finalMapName);
                    importedMapsCount++;
                }

                // Importar grupos com nomes de mapas atualizados
                await this.importGroupsAdditively(data.groups, mapNameMapping);

                // NEW: Importar layers com nomes de mapas atualizados
                await this.importLayersAdditively(data.layers, mapNameMapping);

            } else {
                for (const [mapName, mapData] of Object.entries(data.maps)) {
                    // Normalizar estrutura para versão atual
                    normalizeMapDataForCurrentVersion(mapData);

                    const colorUsageData = data.colorUsage?.[mapName] || null;
                    const notesData = data.mapNotes?.[mapName] || null;
                    await addMap(mapName, mapData, colorUsageData, notesData);
                    importedMapsCount++;
                }

                setCurrentMap(data.currentMap);

                // Importar grupos diretamente (import normal)
                await this.importGroupsDirectly(data.groups);

                // NEW: Importar layers diretamente (import normal)
                await this.importLayersDirectly(data.layers);

                // Carregar imagens após processamento dos mapas (import normal)
                await this.loadImagesFromZip(zip);
            }

            const currentBaseLayer = isAdditiveImport ?
                await getCurrentBaseLayer() :
                data.maps[await getCurrentMapName()]?.baseLayer;

            const validBaseLayer = config.getValidBasemapFallback(currentBaseLayer);

            setBaseLayer(validBaseLayer);

            await this.baseLayerControl.switchMap();
            await this.mapControl.updateMapList();

            const importType = isAdditiveImport ? 'adicionados' : 'carregados';
            this.showLoadSuccess(importedMapsCount, importType);

        } catch (error) {
            console.error('Erro ao importar arquivo:', error);
            alert('Erro ao carregar arquivo .ebgeo: ' + error.message);
        }

        event.target.value = '';
    }

    /**
     * Importa grupos diretamente (import normal - substitui tudo)
     */
    async importGroupsDirectly(groupsData) {
        if (!groupsData || Object.keys(groupsData).length === 0) {
            return; // Não há grupos para importar
        }

        try {
            // Para cada mapa, importar seus grupos
            for (const [mapName, mapGroups] of Object.entries(groupsData)) {
                if (mapGroups && Object.keys(mapGroups).length > 0) {
                    // Limpar grupos existentes do mapa
                    await groupManager.clearMapGroups(mapName);
                    
                    // Carregar grupos para memória se for o mapa atual
                    const currentMapName = await getCurrentMapName();
                    if (mapName === currentMapName) {
                        // Carregar grupos importados diretamente na memória
                        const groupsMap = new Map();
                        Object.entries(mapGroups).forEach(([groupId, groupData]) => {
                            groupsMap.set(groupId, groupData);
                        });
                        groupManager.memoryStore.groups[mapName] = groupsMap;
                    }
                    
                    // Persistir no IndexedDB
                    await groupManager._saveGroupsToDBAsync(mapName);
                }
            }

        } catch (error) {
            console.error('Erro ao importar grupos diretamente:', error);
        }
    }

    /**
     * Importa grupos aditivamente (import aditivo - com resolução de conflitos)
     */
    async importGroupsAdditively(groupsData, mapNameMapping) {
        if (!groupsData || Object.keys(groupsData).length === 0) {
            return; // Não há grupos para importar
        }

        try {
            // Para cada mapa original, importar seus grupos com nome atualizado
            for (const [originalMapName, mapGroups] of Object.entries(groupsData)) {
                const finalMapName = mapNameMapping.get(originalMapName);
                
                if (!finalMapName || !mapGroups || Object.keys(mapGroups).length === 0) {
                    continue;
                }

                // Gerar novos IDs para os grupos e resolver conflitos de nomes
                const processedGroups = await this.processGroupsForAdditiveImport(mapGroups, finalMapName);

                // Carregar grupos para memória se for o mapa atual
                const currentMapName = await getCurrentMapName();
                if (finalMapName === currentMapName) {
                    // Garantir que cache de grupos existe
                    if (!groupManager.memoryStore.groups[finalMapName]) {
                        groupManager.memoryStore.groups[finalMapName] = new Map();
                    }
                    
                    // Adicionar grupos processados ao cache
                    const groupsCache = groupManager.memoryStore.groups[finalMapName];
                    Object.entries(processedGroups).forEach(([groupId, groupData]) => {
                        groupsCache.set(groupId, groupData);
                    });
                }

                // Persistir no IndexedDB
                await groupManager._saveGroupsToDBAsync(finalMapName);
            }

        } catch (error) {
            console.error('Erro ao importar grupos aditivamente:', error);
        }
    }

    /**
     * Processa grupos para import aditivo (novos IDs e nomes únicos)
     */
    async processGroupsForAdditiveImport(mapGroups, mapName) {
        const processedGroups = {};
        const existingGroups = getMapGroups(mapName);
        const existingNames = new Set();

        // Coletar nomes existentes
        for (const group of existingGroups.values()) {
            existingNames.add(group.name);
        }

        // Processar cada grupo
        Object.values(mapGroups).forEach(group => {
            // Gerar novo ID único
            const newGroupId = IDUtils.generateUniqueId();
            
            // Resolver conflito de nomes
            let finalName = group.name;
            let counter = 1;
            while (existingNames.has(finalName)) {
                finalName = `${group.name}_${counter}`;
                counter++;
            }
            existingNames.add(finalName);

            // Criar grupo processado
            processedGroups[newGroupId] = {
                ...group,
                id: newGroupId,
                name: finalName
                // features mantêm os mesmos IDs (assumindo que features já foram importadas)
            };
        });

        return processedGroups;
    }

    /**
     * NEW: Importa layers diretamente (import normal - substitui tudo)
     */
    async importLayersDirectly(layersData) {
        if (!layersData || Object.keys(layersData).length === 0) {
            return; // Não há layers para importar
        }

        try {
            for (const [mapName, layers] of Object.entries(layersData)) {
                if (layers && Array.isArray(layers) && layers.length > 0) {
                    await setMapLayers(mapName, { layers });
                }
            }
        } catch (error) {
            console.error('Erro ao importar layers diretamente:', error);
        }
    }

    /**
     * NEW: Importa layers aditivamente (import aditivo - com resolução de conflitos)
     */
    async importLayersAdditively(layersData, mapNameMapping) {
        if (!layersData || Object.keys(layersData).length === 0) {
            return; // Não há layers para importar
        }

        try {
            for (const [originalMapName, layers] of Object.entries(layersData)) {
                const finalMapName = mapNameMapping.get(originalMapName);
                
                if (!finalMapName || !layers || !Array.isArray(layers) || layers.length === 0) {
                    continue;
                }

                // Obter layers existentes do mapa de destino
                const existingLayers = await getLayers(finalMapName) || [];
                const existingNames = new Set(existingLayers.map(l => l.name));
                const existingIds = new Set(existingLayers.map(l => l.id));

                // Processar layers importadas
                const processedLayers = layers.map(layer => {
                    // Gerar novo ID se já existe
                    let newId = layer.id;
                    if (existingIds.has(newId) || newId === 'default') {
                        newId = IDUtils.generateUniqueId();
                    }

                    // Resolver conflito de nomes
                    let finalName = layer.name;
                    let counter = 1;
                    while (existingNames.has(finalName)) {
                        finalName = `${layer.name}_${counter}`;
                        counter++;
                    }
                    existingNames.add(finalName);
                    existingIds.add(newId);

                    return {
                        ...layer,
                        id: newId,
                        name: finalName
                    };
                });

                // Mesclar com layers existentes (exceto 'default' duplicada)
                const mergedLayers = [...existingLayers];
                processedLayers.forEach(layer => {
                    // Não adicionar se for a layer 'default' e já existe uma
                    if (layer.id !== 'default' || !mergedLayers.some(l => l.id === 'default')) {
                        mergedLayers.push(layer);
                    }
                });

                await setMapLayers(finalMapName, { layers: mergedLayers });
            }
        } catch (error) {
            console.error('Erro ao importar layers aditivamente:', error);
        }
    }

    async loadImagesFromZip(zip) {
        const imageFiles = Object.keys(zip.files).filter(name =>
            name.startsWith('images/') &&
            /\.(png|jpe?g|svg|webp)$/i.test(name)
        );

        for (const fileName of imageFiles) {
            try {
                const imageId = fileName.replace('images/', '').replace(/\.(png|jpe?g|svg|webp)$/i, '');
                const blob = await zip.file(fileName).async('blob');
                await storeImage(imageId, blob);
            } catch (imgError) {
                console.warn('Erro ao carregar imagem:', fileName, imgError);
            }
        }
    }

    // Mostrar sucesso no salvamento
    showSaveSuccess(mapCount) {
        const saveBtn = document.querySelector('.save-action');
        if (saveBtn) {
            const originalContent = saveBtn.innerHTML;

            saveBtn.classList.add('success');
            saveBtn.innerHTML = '<img src="./images/icon_check_green.svg" alt="SUCCESS" />';

            setTimeout(() => {
                saveBtn.classList.remove('success');
                saveBtn.innerHTML = originalContent;
            }, 1500);
        }

        const message = mapCount === 1 ? '1 mapa exportado!' : `${mapCount} mapas exportados!`;
        showSuccess(message);
    }

    // Mostrar sucesso no carregamento
    showLoadSuccess(mapCount, importType) {
        const loadBtn = document.querySelector('.load-action');
        if (loadBtn) {
            const originalContent = loadBtn.innerHTML;

            loadBtn.classList.add('success');
            loadBtn.innerHTML = '<img src="./images/icon_check_green.svg" alt="SUCCESS" />';

            setTimeout(() => {
                loadBtn.classList.remove('success');
                loadBtn.innerHTML = originalContent;
            }, 1500);
        }

        const message = mapCount === 1 ? `1 mapa ${importType}!` : `${mapCount} mapas ${importType}!`;
        showSuccess(message);
    }

    /**
     * Processa arquivo .ebgeo diretamente (para drag & drop)
     */
    async processFileDirectly(file, isAdditiveImport = false) {
        // Simular evento fake para reutilizar lógica existente
        const fakeEvent = {
            target: {
                files: [file],
                value: '' // Para resetar após processamento
            }
        };

        await this.handleImport(fakeEvent, isAdditiveImport);
    }
}