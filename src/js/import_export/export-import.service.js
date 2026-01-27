// Path: js/import_export/export-import.service.js
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
    // Position and order imports
    getMapPosition,
    getMapOrder,
    setMapOrder,
    // Catalog imports
    processCatalogLayersOnImport,
    // Cesium 3D imports
    getCesium3dDataForExport,
    setCesium3dDataForImport,
} from '../store';

import { IDUtils, showToast, showSuccess } from '../utilities';
import JSZip from 'jszip';
import config from '../config.js';
import { groupManager } from '../tool_manager';
import { showExportModal } from '../modals/export.modal.js';
import { EventTypes } from '../events/event_types.js';

/**
 * Normalizes mapData structure to current version
 * Ensures coordination_measures exists (added in v1.4)
 * Validates catalog layers availability (added for unavailable layer support)
 * @param {Object} mapData - Map data to normalize
 * @returns {{ mapData: Object, unavailableCatalogLayersCount: number }} Normalized map data and count of unavailable layers
 */
const normalizeMapDataForCurrentVersion = (mapData) => {
    // Ensure coordination_measures exists (v1.4)
    if (!mapData.features.coordination_measures) {
        mapData.features.coordination_measures = [];
    }

    // Validate catalog layers availability
    let unavailableCatalogLayersCount = 0;
    if (mapData.catalogLayers && mapData.catalogLayers.length > 0) {
        const { processed, unavailableCount } = processCatalogLayersOnImport(mapData.catalogLayers);
        mapData.catalogLayers = processed;
        unavailableCatalogLayersCount = unavailableCount;
    }

    return { mapData, unavailableCatalogLayersCount };
};

export class ExportImportService {
    constructor(baseLayerControl, mapControl, mapManager, eventBus = null) {
        this.baseLayerControl = baseLayerControl;
        this.mapControl = mapControl;
        this.mapManager = mapManager;
        this._eventBus = eventBus;
    }

    /**
     * Rounds coordinates to 1 meter precision (6 decimal places)
     * @param {Array} coords - Coordinate array to round
     * @returns {Array} Rounded coordinates
     */
    roundCoordinates(coords) {
        const precision = 6;
        const factor = Math.pow(10, precision);

        if (Array.isArray(coords[0])) {
            return coords.map(coord => this.roundCoordinates(coord));
        } else {
            return coords.map(coord => Math.round(coord * factor) / factor);
        }
    }

    /**
     * Optimizes individual feature by rounding coordinates
     * @param {Object} feature - Feature to optimize
     * @returns {Object} Optimized feature
     */
    optimizeFeature(feature) {
        const optimized = { ...feature };

        if (optimized.geometry && optimized.geometry.coordinates) {
            optimized.geometry.coordinates = this.roundCoordinates(optimized.geometry.coordinates);
        }

        return optimized;
    }

    /**
     * Optimizes map data by processing all features
     * @param {Object} mapData - Map data to optimize
     * @returns {Object} Optimized map data
     */
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

    /**
     * Detects correct file extension based on blob MIME type
     * @param {Blob} blob - Blob to analyze
     * @returns {string} File extension
     */
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

    /**
     * Simple XOR operation to mask data
     * @param {Uint8Array} data - Data to mask
     * @param {number} key - XOR key (default 0xAA)
     * @returns {Uint8Array} Masked data
     */
    xorData(data, key = 0xAA) {
        const result = new Uint8Array(data.length);
        for (let i = 0; i < data.length; i++) {
            result[i] = data[i] ^ key;
        }
        return result;
    }

    /**
     * Creates save/export button
     * @returns {HTMLElement} Save button element
     */
    createSaveButton() {
        const saveButton = document.createElement('button');
        saveButton.className = 'map-action-button save-action';
        saveButton.innerHTML = `<img src="./images/icon_save_black.svg" alt="Exportar projeto" />`;
        saveButton.title = 'Exportar projeto';

        saveButton.onclick = () => {
            this.showExportModal();
        };

        return saveButton;
    }

    /**
     * Shows the export modal for map selection
     */
    showExportModal() {
        showExportModal(async (selectedMaps) => {
            await this.handleExport(selectedMaps);
        });
    }

    /**
     * Creates load/import button (replaces current)
     * @returns {HTMLElement} Load button element
     */
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

    /**
     * Creates additive load button (adds to current project)
     * @returns {HTMLElement} Additive load button element
     */
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

    /**
     * Handles project export to .ebgeo file
     * @param {string[]|null} selectedMaps - Optional array of map names to export. If null, exports all maps.
     */
    async handleExport(selectedMaps = null) {
        try {
            this.mapControl.deactivateActiveTools();

            const zip = new JSZip();

            // Use selected maps or fall back to all maps
            const allMaps = await getAllMapNamesStore();
            const mapsToExport = selectedMaps || allMaps;

            if (mapsToExport.length === 0) {
                alert('Nenhum mapa para exportar');
                return;
            }

            // Determine current map (must be one of the exported maps)
            const currentMapName = await getCurrentMapName();
            const exportCurrentMap = mapsToExport.includes(currentMapName)
                ? currentMapName
                : mapsToExport[0];

            // Filter map order to only include exported maps
            const fullMapOrder = await getMapOrder();
            const filteredMapOrder = fullMapOrder.filter(name => mapsToExport.includes(name));

            const data = {
                version: SCHEMA_VERSION,
                currentMap: exportCurrentMap,
                mapOrder: filteredMapOrder,
                maps: {},
                colorUsage: {},
                mapNotes: {},
                groups: {},
                layers: {},
                cesium3d: {},
            };

            // Export map data with optimization
            for (const mapName of mapsToExport) {
                const mapData = await getCurrentMapFeatures(mapName);
                if (mapData) {
                    // Get saved map position
                    const position = await getMapPosition(mapName);

                    // Rebuild complete map structure with actual position
                    const fullMapData = {
                        baseLayer: await getCurrentBaseLayer(mapName),
                        hillshadeEnabled: true,
                        analysisLayers: {},
                        features: mapData,
                        zoom: position.zoom,
                        center_lat: position.center_lat,
                        center_long: position.center_long,
                        bearing: position.bearing,
                        pitch: position.pitch
                    };

                    data.maps[mapName] = this.optimizeMapData(fullMapData);
                }

                // Export color usage data
                try {
                    const colorData = await getColorUsage(mapName);
                    if (colorData && Object.keys(colorData).length > 0) {
                        data.colorUsage[mapName] = colorData;
                    }
                } catch (error) {
                    console.warn(`Could not export colors from map ${mapName}:`, error);
                }

                // Export map notes
                try {
                    const notesData = await getMapNotes(mapName);
                    if (notesData && (notesData.title || notesData.description)) {
                        data.mapNotes[mapName] = notesData;
                    }
                } catch (error) {
                    console.warn(`Could not export notes from map ${mapName}:`, error);
                }

                // Export map groups
                try {
                    const groupsMap = getMapGroups(mapName);
                    if (groupsMap && groupsMap.size > 0) {
                        data.groups[mapName] = Object.fromEntries(groupsMap);
                    }
                } catch (error) {
                    console.warn(`Could not export groups from map ${mapName}:`, error);
                }

                // Export map layers
                try {
                    const layersData = await getLayers(mapName);
                    if (layersData && layersData.length > 0) {
                        data.layers[mapName] = layersData;
                    }
                } catch (error) {
                    console.warn(`Could not export layers from map ${mapName}:`, error);
                }

                // Export cesium 3D data (camera positions and markers)
                try {
                    const cesium3dData = await getCesium3dDataForExport(mapName);
                    if (cesium3dData) {
                        data.cesium3d[mapName] = cesium3dData;
                    }
                } catch (error) {
                    console.warn(`Could not export 3D data from map ${mapName}:`, error);
                }
            }

            // Add data.json to ZIP without indentation and with maximum compression
            const jsonString = JSON.stringify(data);
            zip.file('data.json', jsonString, {
                compression: 'DEFLATE',
                compressionOptions: { level: 9 }
            });

            // Collect and export used images
            const usedImages = new Set();
            for (const mapName of mapsToExport) {
                const mapData = await getCurrentMapFeatures(mapName);
                if (mapData) {
                    for (const [_category, features] of Object.entries(mapData)) {
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

            // Add images to ZIP with correct extension based on MIME type
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
                } catch (_error) {
                    console.warn('Image not found:', imageId);
                }
            }

            // Generate ZIP file
            const zipBlob = await zip.generateAsync({
                type: 'blob',
                compression: 'DEFLATE',
                compressionOptions: { level: 9 },
                streamFiles: true
            });

            // Apply XOR to ZIP data for masking
            const zipArray = new Uint8Array(await zipBlob.arrayBuffer());
            const maskedData = this.xorData(zipArray);

            // Add identifier at the beginning to detect XOR file
            const identifier = new TextEncoder().encode('EBGXOR');
            const finalArray = new Uint8Array(identifier.length + maskedData.length);
            finalArray.set(identifier, 0);
            finalArray.set(maskedData, identifier.length);

            // Create final blob
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

    /**
     * Handles project import from .ebgeo file
     * @param {Event} event - File input change event
     * @param {boolean} isAdditiveImport - Whether to add to current project or replace
     */
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
            let totalUnavailableCatalogLayers = 0;

            if (isAdditiveImport) {
                await this.loadImagesFromZip(zip);

                const existingMapNames = await getAllMapNamesStore();
                const mapsToImport = Object.keys(data.maps).length;

                if (existingMapNames.length + mapsToImport > 100) {
                    throw new Error(`Limite de mapas excedido. Você tem ${existingMapNames.length} mapas, tentando importar ${mapsToImport}. Limite: 100 mapas.`);
                }

                const mapNameMapping = new Map();
                const newlyCreatedMaps = new Set();

                for (const [originalMapName, mapData] of Object.entries(data.maps)) {
                    // Find unique name
                    let finalMapName = originalMapName;
                    let counter = 1;
                    while (existingMapNames.includes(finalMapName)) {
                        finalMapName = `${originalMapName}_${counter}`;
                        counter++;
                    }

                    mapNameMapping.set(originalMapName, finalMapName);
                    newlyCreatedMaps.add(finalMapName);

                    // Regenerate feature IDs
                    const { newMapData } = await IDUtils.regenerateMapIds(mapData, finalMapName);

                    // Normalizar estrutura para versão atual
                    const { unavailableCatalogLayersCount } = normalizeMapDataForCurrentVersion(newMapData);
                    totalUnavailableCatalogLayers += unavailableCatalogLayersCount;

                    // Get original data from file to preserve colors and notes
                    const originalColorUsage = data.colorUsage?.[originalMapName] || null;
                    const originalNotes = data.mapNotes?.[originalMapName] || null;

                    // Pass colors and notes to preserve original data
                    await addMap(finalMapName, newMapData, originalColorUsage, originalNotes);
                    existingMapNames.push(finalMapName);
                    importedMapsCount++;
                }

                // Import groups with updated map names
                await this.importGroupsAdditively(data.groups, mapNameMapping);

                // Import layers with updated map names (pass newlyCreatedMaps to avoid creating extra default layers)
                await this.importLayersAdditively(data.layers, mapNameMapping, newlyCreatedMaps);

                // Import cesium 3D data additively
                await this.importCesium3dAdditively(data.cesium3d, mapNameMapping);

            } else {
                for (const [mapName, mapData] of Object.entries(data.maps)) {
                    // Normalizar estrutura para versão atual
                    const { unavailableCatalogLayersCount } = normalizeMapDataForCurrentVersion(mapData);
                    totalUnavailableCatalogLayers += unavailableCatalogLayersCount;

                    const colorUsageData = data.colorUsage?.[mapName] || null;
                    const notesData = data.mapNotes?.[mapName] || null;
                    await addMap(mapName, mapData, colorUsageData, notesData);
                    importedMapsCount++;
                }

                setCurrentMap(data.currentMap);

                // Import groups directly (normal import)
                await this.importGroupsDirectly(data.groups);

                // Import layers directly (normal import)
                await this.importLayersDirectly(data.layers);

                // Import cesium 3D data directly (normal import)
                await this.importCesium3dDirectly(data.cesium3d);

                // Restore map order if available
                if (data.mapOrder && Array.isArray(data.mapOrder) && data.mapOrder.length > 0) {
                    await setMapOrder(data.mapOrder);
                }

                // Load images after processing maps (normal import)
                await this.loadImagesFromZip(zip);
            }

            // Notify about unavailable catalog layers
            if (totalUnavailableCatalogLayers > 0) {
                this._notifyUnavailableCatalogLayers(totalUnavailableCatalogLayers);
            }

            const currentBaseLayer = isAdditiveImport ?
                await getCurrentBaseLayer() :
                data.maps[await getCurrentMapName()]?.baseLayer;

            const validBaseLayer = config.getValidBasemapFallback(currentBaseLayer);

            setBaseLayer(validBaseLayer);

            await this.baseLayerControl.switchMap();
            await this.mapControl.updateMapList();

            // Emit event to update sidebar recent maps display
            if (this._eventBus) {
                this._eventBus.emit(EventTypes.LAYERS_CHANGED, { mapName: null });
            }

            const importType = isAdditiveImport ? 'adicionados' : 'carregados';
            this.showLoadSuccess(importedMapsCount, importType);

        } catch (error) {
            console.error('Erro ao importar arquivo:', error);
            alert('Erro ao carregar arquivo .ebgeo: ' + error.message);
        }

        event.target.value = '';
    }

    /**
     * Imports groups directly (normal import - replaces everything)
     * @param {Object} groupsData - Groups data to import
     */
    async importGroupsDirectly(groupsData) {
        if (!groupsData || Object.keys(groupsData).length === 0) {
            return;
        }

        try {
            for (const [mapName, mapGroups] of Object.entries(groupsData)) {
                if (mapGroups && Object.keys(mapGroups).length > 0) {
                    await groupManager.clearMapGroups(mapName);

                    const currentMapName = await getCurrentMapName();
                    if (mapName === currentMapName) {
                        const groupsMap = new Map();
                        Object.entries(mapGroups).forEach(([groupId, groupData]) => {
                            groupsMap.set(groupId, groupData);
                        });
                        groupManager.memoryStore.groups[mapName] = groupsMap;
                    }

                    await groupManager._saveGroupsToDBAsync(mapName);
                }
            }

        } catch (error) {
            console.error('Error importing groups directly:', error);
        }
    }

    /**
     * Imports groups additively (additive import - with conflict resolution)
     * @param {Object} groupsData - Groups data to import
     * @param {Map} mapNameMapping - Mapping of original to final map names
     */
    async importGroupsAdditively(groupsData, mapNameMapping) {
        if (!groupsData || Object.keys(groupsData).length === 0) {
            return;
        }

        try {
            for (const [originalMapName, mapGroups] of Object.entries(groupsData)) {
                const finalMapName = mapNameMapping.get(originalMapName);

                if (!finalMapName || !mapGroups || Object.keys(mapGroups).length === 0) {
                    continue;
                }

                const processedGroups = await this.processGroupsForAdditiveImport(mapGroups, finalMapName);

                const currentMapName = await getCurrentMapName();
                if (finalMapName === currentMapName) {
                    if (!groupManager.memoryStore.groups[finalMapName]) {
                        groupManager.memoryStore.groups[finalMapName] = new Map();
                    }

                    const groupsCache = groupManager.memoryStore.groups[finalMapName];
                    Object.entries(processedGroups).forEach(([groupId, groupData]) => {
                        groupsCache.set(groupId, groupData);
                    });
                }

                await groupManager._saveGroupsToDBAsync(finalMapName);
            }

        } catch (error) {
            console.error('Error importing groups additively:', error);
        }
    }

    /**
     * Processes groups for additive import (new IDs and unique names)
     * @param {Object} mapGroups - Groups to process
     * @param {string} mapName - Target map name
     * @returns {Object} Processed groups
     */
    async processGroupsForAdditiveImport(mapGroups, mapName) {
        const processedGroups = {};
        const existingGroups = getMapGroups(mapName);
        const existingNames = new Set();

        for (const group of existingGroups.values()) {
            existingNames.add(group.name);
        }

        Object.values(mapGroups).forEach(group => {
            const newGroupId = IDUtils.generateUniqueId();

            let finalName = group.name;
            let counter = 1;
            while (existingNames.has(finalName)) {
                finalName = `${group.name}_${counter}`;
                counter++;
            }
            existingNames.add(finalName);

            processedGroups[newGroupId] = {
                ...group,
                id: newGroupId,
                name: finalName
            };
        });

        return processedGroups;
    }

    /**
     * Imports layers directly (normal import - replaces everything)
     * @param {Object} layersData - Layers data to import
     */
    async importLayersDirectly(layersData) {
        if (!layersData || Object.keys(layersData).length === 0) {
            return;
        }

        try {
            for (const [mapName, layers] of Object.entries(layersData)) {
                if (layers && Array.isArray(layers) && layers.length > 0) {
                    await setMapLayers(mapName, { layers });
                }
            }
        } catch (error) {
            console.error('Error importing layers directly:', error);
        }
    }

    /**
     * Imports layers additively (additive import - with conflict resolution)
     * @param {Object} layersData - Layers data to import
     * @param {Map} mapNameMapping - Mapping of original to final map names
     * @param {Set} newlyCreatedMaps - Set of map names that were just created during import
     */
    async importLayersAdditively(layersData, mapNameMapping, newlyCreatedMaps) {
        if (!layersData || Object.keys(layersData).length === 0) {
            return;
        }

        try {
            for (const [originalMapName, layers] of Object.entries(layersData)) {
                const finalMapName = mapNameMapping.get(originalMapName);

                if (!finalMapName || !layers || !Array.isArray(layers) || layers.length === 0) {
                    continue;
                }

                // If this map was just created during import, set layers directly
                // (don't try to merge with the auto-created default layer)
                if (newlyCreatedMaps.has(finalMapName)) {
                    const processedLayers = layers.map(layer => {
                        // Generate new ID to avoid conflicts, but keep 'default' if present
                        const newId = layer.id === 'default' ? 'default' : IDUtils.generateUniqueId();
                        return {
                            ...layer,
                            id: newId
                        };
                    });
                    await setMapLayers(finalMapName, { layers: processedLayers });
                    continue;
                }

                // For existing maps, merge with existing layers
                const existingLayers = await getLayers(finalMapName) || [];
                const existingNames = new Set(existingLayers.map(l => l.name));
                const existingIds = new Set(existingLayers.map(l => l.id));

                const processedLayers = layers.map(layer => {
                    let newId = layer.id;
                    if (existingIds.has(newId) || newId === 'default') {
                        newId = IDUtils.generateUniqueId();
                    }

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

                const mergedLayers = [...existingLayers];
                processedLayers.forEach(layer => {
                    if (layer.id !== 'default' || !mergedLayers.some(l => l.id === 'default')) {
                        mergedLayers.push(layer);
                    }
                });

                await setMapLayers(finalMapName, { layers: mergedLayers });
            }
        } catch (error) {
            console.error('Error importing layers additively:', error);
        }
    }

    /**
     * Imports cesium 3D data directly (normal import - replaces everything)
     * @param {Object} cesium3dData - Cesium 3D data to import
     */
    async importCesium3dDirectly(cesium3dData) {
        if (!cesium3dData || Object.keys(cesium3dData).length === 0) {
            return;
        }

        try {
            for (const [mapName, data] of Object.entries(cesium3dData)) {
                if (data) {
                    await setCesium3dDataForImport(mapName, data);
                }
            }
        } catch (error) {
            console.error('Error importing cesium 3D data directly:', error);
        }
    }

    /**
     * Imports cesium 3D data additively (additive import - with map name mapping)
     * @param {Object} cesium3dData - Cesium 3D data to import
     * @param {Map} mapNameMapping - Mapping of original to final map names
     */
    async importCesium3dAdditively(cesium3dData, mapNameMapping) {
        if (!cesium3dData || Object.keys(cesium3dData).length === 0) {
            return;
        }

        try {
            for (const [originalMapName, data] of Object.entries(cesium3dData)) {
                const finalMapName = mapNameMapping.get(originalMapName);

                if (!finalMapName || !data) {
                    continue;
                }

                // For additive import, we just set the data with the new map name
                // since the map was just created and has no existing 3D data
                await setCesium3dDataForImport(finalMapName, data);
            }
        } catch (error) {
            console.error('Error importing cesium 3D data additively:', error);
        }
    }

    /**
     * Loads images from ZIP file into IndexedDB
     * @param {JSZip} zip - ZIP file object
     */
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
                console.warn('Error loading image:', fileName, imgError);
            }
        }
    }

    /**
     * Shows save success feedback
     * @param {number} mapCount - Number of maps saved
     */
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

    /**
     * Shows load success feedback
     * @param {number} mapCount - Number of maps loaded
     * @param {string} importType - Type of import ('adicionados' or 'carregados')
     */
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
     * Notifies user about unavailable catalog layers during import.
     * @param {number} count - Number of unavailable catalog layers
     * @private
     */
    _notifyUnavailableCatalogLayers(count) {
        const layerWord = count === 1 ? 'camada' : 'camadas';
        showToast(
            `${count} ${layerWord} do catálogo não ${count === 1 ? 'está' : 'estão'} disponível nesta instância.`,
            'warning',
            5000
        );
    }

    /**
     * Processes .ebgeo file directly (for drag & drop)
     * @param {File} file - .ebgeo file to process
     * @param {boolean} isAdditiveImport - Whether to add to current project
     */
    async processFileDirectly(file, isAdditiveImport = false) {
        const fakeEvent = {
            target: {
                files: [file],
                value: ''
            }
        };

        await this.handleImport(fakeEvent, isAdditiveImport);
    }
}
