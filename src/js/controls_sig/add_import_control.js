// Path: js/controls_sig/add_import_control.js
import JSZip from 'jszip';
import * as toGeoJSON from '@tmcw/togeojson';
import shp from 'shpjs';
import { addFeatures, createLayerForImport, getLayers, getCurrentMapNameSync } from './store/store.js';
import { IDUtils } from './id_utils.js';
import { getTerrainElevation } from './terrain_control.js';
import { showSuccess } from './utilities/toast_service.js';
import { EventTypes } from './events/event_types.js';
import { getEventBus } from './services.js';
import userDataManager from './user_data/user_data_manager.js';

class AddImportControl {
    static FILE_LIMITS = {
        maxSize: 50 * 1024 * 1024,
        timeout: 30000,
        chunkSize: 1024 * 1024
    };

    constructor(toolManager) {
        this.toolManager = toolManager;
        this.isActive = false;
        this.pointControl = null;
        this.lineControl = null;
        this.polygonControl = null;
    }

    setControls(pointControl, lineControl, polygonControl) {
        this.pointControl = pointControl;
        this.lineControl = lineControl;
        this.polygonControl = polygonControl;
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl import-control controls-column-left';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "import-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_import_black.svg" alt="IMPORT" />';
        button.title = 'Importar arquivo';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);

        this.fileInput = document.createElement('input');
        this.fileInput.type = 'file';
        this.fileInput.accept = '.geojson,.json,.zip,.kml,.kmz,.gpx';
        this.fileInput.style.display = 'none';
        this.fileInput.addEventListener('change', this.handleFileSelect.bind(this));
        this.container.appendChild(this.fileInput);

        this.changeButtonColor();
        return this.container;
    }

    changeButtonColor() {
        const button = document.getElementById('import-tool');
        if (button) {
            button.innerHTML = `<img class="icon-sig-tool" src="./images/icon_import_black.svg" alt="IMPORT" />`;
        }
    }

    onRemove() {
        this.container.parentNode.removeChild(this.container);
        this.map = undefined;
    }

    activate() {
        this.isActive = true;
        this.changeButtonColor();
        this.fileInput.click();
    }

    deactivate() {
        this.isActive = false;
        this.changeButtonColor();
    }

    handleMapClick() {
    }

    async handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) {
            this.toolManager.deactivateCurrentTool();
            return;
        }

        try {
            const geoJSON = await this.processFile(file);
            if (geoJSON) {
                const fileName = file.name.replace(/\.[^/.]+$/, '');
                const importedCount = await this.importGeoJSON(geoJSON, fileName);
                const message = importedCount === 1
                    ? '1 geometria importada com sucesso'
                    : `${importedCount} geometrias importadas com sucesso`;
                showSuccess(message);
            }
        } catch (error) {
            console.error('Error importing file:', error);
            alert(`Erro ao importar arquivo: ${error.message}`);
        }

        this.fileInput.value = '';
        this.toolManager.deactivateCurrentTool();
    }

    _validateFile(file) {
        if (file.size > AddImportControl.FILE_LIMITS.maxSize) {
            throw new Error(`Arquivo muito grande. Máximo: ${AddImportControl.FILE_LIMITS.maxSize / (1024 * 1024)}MB`);
        }

        if (file.size === 0) {
            throw new Error('Arquivo vazio');
        }
    }

    _createFileReader(cleanup = true) {
        const reader = new FileReader();

        if (cleanup) {
            const originalOnLoad = reader.onload;
            const originalOnError = reader.onerror;

            reader.onload = (e) => {
                try {
                    if (originalOnLoad) originalOnLoad(e);
                } finally {
                    this._cleanupReader(reader);
                }
            };

            reader.onerror = (e) => {
                try {
                    if (originalOnError) originalOnError(e);
                } finally {
                    this._cleanupReader(reader);
                }
            };
        }

        return reader;
    }

    _cleanupReader(reader) {
        reader.onload = null;
        reader.onerror = null;
        reader.onprogress = null;
        reader.abort();
    }

    async _readFileWithProgress(file, method = 'text') {
        this._validateFile(file);

        return new Promise((resolve, reject) => {
            const reader = this._createFileReader();
            let progressCallback = null;

            const timeout = setTimeout(() => {
                reader.abort();
                reject(new Error('Timeout na leitura do arquivo'));
            }, AddImportControl.FILE_LIMITS.timeout);

            if (file.size > AddImportControl.FILE_LIMITS.chunkSize) {
                progressCallback = this._showProgressIndicator();

                reader.onprogress = (e) => {
                    if (e.lengthComputable) {
                        const percentComplete = (e.loaded / e.total) * 100;
                        progressCallback(percentComplete);
                    }
                };
            }

            reader.onload = (e) => {
                clearTimeout(timeout);
                if (progressCallback) this._hideProgressIndicator();
                resolve(e.target.result);
            };

            reader.onerror = () => {
                clearTimeout(timeout);
                if (progressCallback) this._hideProgressIndicator();
                reject(new Error(`Erro ao ler arquivo como ${method}`));
            };

            switch (method) {
                case 'text': reader.readAsText(file); break;
                case 'arraybuffer': reader.readAsArrayBuffer(file); break;
                default: reject(new Error(`Método ${method} não suportado`));
            }
        });
    }

    _showProgressIndicator() {
        const progressDiv = document.createElement('div');
        progressDiv.id = 'import-progress';
        progressDiv.style.cssText = `
            position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
            background: white; padding: 20px; border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3); z-index: 10000;
        `;
        progressDiv.innerHTML = `
            <div>Importando arquivo...</div>
            <div style="margin-top: 10px; background: #f0f0f0; border-radius: 4px; height: 8px;">
                <div id="progress-bar" style="background: #007bff; height: 100%; border-radius: 4px; width: 0%; transition: width 0.3s;"></div>
            </div>
        `;

        document.body.appendChild(progressDiv);

        return (percent) => {
            const bar = document.getElementById('progress-bar');
            if (bar) bar.style.width = `${percent}%`;
        };
    }

    _hideProgressIndicator() {
        const progress = document.getElementById('import-progress');
        if (progress) progress.remove();
    }

    async _processFileWithReader(file, readerMethod, processor, errorMessage) {
        try {
            const content = await this._readFileWithProgress(file, readerMethod);
            return await processor(content);
        } catch (error) {
            throw new Error(`${errorMessage}: ${error.message}`);
        }
    }

    async processFile(file) {
        const fileName = file.name.toLowerCase();

        if (fileName.endsWith('.geojson') || fileName.endsWith('.json')) {
            return await this.readGeoJSON(file);
        } else if (fileName.endsWith('.zip')) {
            return await this.readShapefile(file);
        } else if (fileName.endsWith('.kml')) {
            return await this.readKML(file);
        } else if (fileName.endsWith('.kmz')) {
            return await this.readKMZ(file);
        } else if (fileName.endsWith('.gpx')) {
            return await this.readGPX(file);
        } else {
            throw new Error('Formato não suportado. Use: GeoJSON, Shapefile (ZIP), KML, KMZ ou GPX');
        }
    }

    async readGeoJSON(file) {
        return this._processFileWithReader(
            file,
            'text',
            (content) => {
                const geoJSON = JSON.parse(content);
                if (!geoJSON.features || !Array.isArray(geoJSON.features)) {
                    throw new Error('Estrutura GeoJSON inválida');
                }
                return geoJSON;
            },
            'Arquivo GeoJSON inválido'
        );
    }

    async readShapefile(file) {
        return this._processFileWithReader(
            file,
            'arraybuffer',
            async (buffer) => {
                const zipFile = await JSZip.loadAsync(buffer);

                const shpFile = Object.values(zipFile.files).find(f =>
                    f.name.toLowerCase().endsWith('.shp')
                );
                const dbfFile = Object.values(zipFile.files).find(f =>
                    f.name.toLowerCase().endsWith('.dbf')
                );

                if (!shpFile) {
                    throw new Error('Arquivo .shp não encontrado');
                }

                const shpBuffer = await shpFile.async('arraybuffer');
                const dbfBuffer = dbfFile ? await dbfFile.async('arraybuffer') : null;

                const result = await shp.parseShp(shpBuffer, dbfBuffer);

                if (!Array.isArray(result)) {
                    throw new Error('Formato de shapefile inválido');
                }

                const features = result.map((geometry, index) => {
                    if (geometry.type === 'Feature') {
                        return geometry;
                    }

                    return {
                        type: 'Feature',
                        properties: {
                            name: `Shapefile_${index + 1}`
                        },
                        geometry: {
                            type: geometry.type,
                            coordinates: geometry.coordinates
                        }
                    };
                });

                return {
                    type: 'FeatureCollection',
                    features: features
                };
            },
            'Erro ao processar Shapefile'
        );
    }

    async readKML(file) {
        return this._processFileWithReader(
            file,
            'text',
            (content) => {
                const kmlDoc = new DOMParser().parseFromString(content, 'text/xml');
                return toGeoJSON.kml(kmlDoc);
            },
            'Arquivo KML inválido'
        );
    }

    async readKMZ(file) {
        return this._processFileWithReader(
            file,
            'arraybuffer',
            async (buffer) => {
                const zip = await JSZip.loadAsync(buffer);
                const kmlFile = zip.file(/\.kml$/i)[0] || zip.file('doc.kml');

                if (!kmlFile) {
                    throw new Error('Arquivo KML não encontrado no KMZ');
                }

                const kmlContent = await kmlFile.async('string');
                const kmlDoc = new DOMParser().parseFromString(kmlContent, 'text/xml');
                return toGeoJSON.kml(kmlDoc);
            },
            'Arquivo KMZ inválido'
        );
    }

    async readGPX(file) {
        return this._processFileWithReader(
            file,
            'text',
            (content) => {
                const gpxDoc = new DOMParser().parseFromString(content, 'text/xml');
                return toGeoJSON.gpx(gpxDoc);
            },
            'Arquivo GPX inválido'
        );
    }

    decomposeMultiGeometry(feature) {
        const geometry = feature.geometry;
        const properties = feature.properties;
        const features = [];

        switch (geometry.type) {
            case 'MultiPoint':
                geometry.coordinates.forEach(coord => {
                    features.push({
                        type: 'Feature',
                        properties: { ...properties },
                        geometry: {
                            type: 'Point',
                            coordinates: coord
                        }
                    });
                });
                break;

            case 'MultiLineString':
                geometry.coordinates.forEach(coords => {
                    features.push({
                        type: 'Feature',
                        properties: { ...properties },
                        geometry: {
                            type: 'LineString',
                            coordinates: coords
                        }
                    });
                });
                break;

            case 'MultiPolygon':
                geometry.coordinates.forEach(coords => {
                    features.push({
                        type: 'Feature',
                        properties: { ...properties },
                        geometry: {
                            type: 'Polygon',
                            coordinates: coords
                        }
                    });
                });
                break;

            case 'GeometryCollection':
                geometry.geometries.forEach(geom => {
                    const subFeature = {
                        type: 'Feature',
                        properties: { ...properties },
                        geometry: geom
                    };
                    if (geom.type.startsWith('Multi') || geom.type === 'GeometryCollection') {
                        features.push(...this.decomposeMultiGeometry(subFeature));
                    } else {
                        features.push(subFeature);
                    }
                });
                break;

            default:
                features.push(feature);
        }

        return features;
    }

    getTargetType(geometryType) {
        const type = geometryType.toLowerCase();

        if (type.includes('point')) {
            return 'points';
        } else if (type.includes('line')) {
            return 'lines';
        } else if (type.includes('polygon')) {
            return 'polygons';
        }

        return null;
    }

    /**
     * Analyzes the current map context to determine next available numbers for imported features
     * @returns {Object} Object with counters for points, lines, and polygons
     */
    async getTypeCountersFromMapContext() {
        const typeCounters = {
            points: 1,
            lines: 1,
            polygons: 1
        };

        const typeMap = {
            'points': 'Ponto',
            'lines': 'Linha',
            'polygons': 'Polígono'
        };

        for (const sourceType of Object.keys(typeCounters)) {
            try {
                const source = this.map.getSource(sourceType);
                if (source) {
                    const data = await source.getData();
                    if (data && data.features) {
                        const existingNumbers = [];
                        const expectedPrefix = typeMap[sourceType];

                        data.features.forEach(feature => {
                            if (feature.properties && feature.properties.nome) {
                                const name = feature.properties.nome;
                                const match = name.match(new RegExp(`^${expectedPrefix}\\s*#(\\d+)$`));
                                if (match) {
                                    existingNumbers.push(parseInt(match[1]));
                                }
                            }
                        });

                        if (existingNumbers.length > 0) {
                            const maxNumber = Math.max(...existingNumbers);
                            typeCounters[sourceType] = maxNumber + 1;
                        }
                    }
                }
            } catch (error) {
                console.warn(`Error analyzing source context ${sourceType}:`, error);
            }
        }

        return typeCounters;
    }

    /**
     * Generates unique name based on type and counter
     * @param {string} targetType - Type of feature (points, lines, polygons)
     * @param {Object} counters - Counter object to track naming sequence
     * @returns {string} Generated unique name
     */
    generateImportName(targetType, counters) {
        const typeMap = {
            'points': 'Ponto',
            'lines': 'Linha',
            'polygons': 'Polígono'
        };

        const name = `${typeMap[targetType]} #${counters[targetType]}`;
        counters[targetType]++;
        return name;
    }

    /**
     * Calculates elevation profile for line features
     * @param {Array} coordinates - Line coordinates
     * @returns {Array} Profile data with distance and elevation points
     */
    async calculateProfile(coordinates) {
        try {
            const line = turf.lineString(coordinates);
            const length = turf.length(line, { units: 'meters' });
            const steps = 25;
            const stepLength = length / steps;

            const profileData = [];

            for (let i = 0; i <= steps; i++) {
                const point = turf.along(line, i * stepLength, { units: 'meters' });
                const elevation = await getTerrainElevation(this.map, point.geometry.coordinates);
                profileData.push({
                    distance: i * stepLength,
                    elevation: elevation
                });
            }

            return profileData;
        } catch (error) {
            console.warn('Error calculating elevation profile:', error);
            return [];
        }
    }

    /**
     * Prepares feature for import with all necessary attributes
     * @param {Object} feature - GeoJSON feature
     * @param {string} targetType - Target type (points, lines, polygons)
     * @param {Object} typeCounters - Counters by type
     * @param {string} layerId - Target layer ID
     * @returns {Object} Prepared feature with complete properties
     */
    async prepareFeatureForImportAsync(feature, targetType, typeCounters, layerId) {
        const featureId = IDUtils.generateUniqueId();
        const featureName = this.generateImportName(targetType, typeCounters);

        // Extract custom attributes from imported properties (non-system properties)
        const extractedAttributes = userDataManager.extractAttributesFromImport(
            feature.properties
        );

        const baseProperties = {
            ...this.getDefaultProperties(targetType),
            // Note: We no longer spread feature.properties here to avoid mixing
            // imported data with system properties. Custom data goes to 'attributes'.
            id: featureId,
            nome: featureName,
            source: targetType.slice(0, -1),
            layerId: layerId,
            // User data fields - custom attributes extracted from import, empty images
            attributes: extractedAttributes,
            images: [],
        };

        switch (targetType) {
            case 'lines':
                baseProperties.baseCoordinates = feature.geometry.coordinates;
                baseProperties.profileData = JSON.stringify(
                    await this.calculateProfile(feature.geometry.coordinates)
                );
                break;

            case 'polygons':
                const coords = feature.geometry.coordinates[0];
                if (coords && coords.length > 0) {
                    const lastPoint = coords[coords.length - 1];
                    const firstPoint = coords[0];
                    const isClosedPolygon = (
                        lastPoint[0] === firstPoint[0] &&
                        lastPoint[1] === firstPoint[1]
                    );

                    baseProperties.baseCoordinates = isClosedPolygon
                        ? coords.slice(0, -1)
                        : coords;
                }
                break;

            case 'points':
                break;
        }

        return {
            type: 'Feature',
            id: Date.now().toString() + Math.random(),
            properties: baseProperties,
            geometry: feature.geometry
        };
    }

    async importGeoJSON(geoJSON, fileName = 'Importação') {
        if (!geoJSON.features || !Array.isArray(geoJSON.features)) {
            throw new Error('GeoJSON inválido - features não encontradas');
        }

        const featuresByType = {
            points: [],
            lines: [],
            polygons: []
        };

        const typeCounters = await this.getTypeCountersFromMapContext();

        let totalFeaturesToImport = 0;
        const decomposedFeatures = [];

        for (const originalFeature of geoJSON.features) {
            if (!originalFeature.geometry?.type) continue;

            const features = this.decomposeMultiGeometry(originalFeature);
            for (const feature of features) {
                const targetType = this.getTargetType(feature.geometry.type);
                if (targetType) {
                    decomposedFeatures.push({ feature, targetType });
                    totalFeaturesToImport++;
                }
            }
        }

        if (totalFeaturesToImport > 100) {
            throw new Error(`Muitas geometrias para importar: ${totalFeaturesToImport}. Limite máximo: 100 geometrias.`);
        }

        if (totalFeaturesToImport === 0) {
            throw new Error('Nenhuma geometria válida encontrada para importar');
        }

        const uniqueLayerName = await this._getUniqueLayerName(fileName);
        const importLayer = await createLayerForImport(uniqueLayerName);
        const importLayerId = importLayer.id;

        for (const { feature, targetType } of decomposedFeatures) {
            const preparedFeature = await this.prepareFeatureForImportAsync(
                feature,
                targetType,
                typeCounters,
                importLayerId
            );
            featuresByType[targetType].push(preparedFeature);
        }

        const totalCount = await this.saveAndUpdateMap(featuresByType);

        // Emit layers-changed event via EventBus
        getEventBus().emit(EventTypes.LAYERS_CHANGED, {
            mapName: getCurrentMapNameSync()
        });

        if (totalCount > 0) {
            this.zoomToAllImportedFeatures(featuresByType);
        }

        return totalCount;
    }

    /**
     * Generates unique layer name for import
     * @param {string} baseName - Base name for the layer
     * @returns {string} Unique layer name (adds suffix _2, _3, etc. if name exists)
     */
    async _getUniqueLayerName(baseName) {
        const layers = await getLayers();
        const existingNames = layers.map(l => l.name);

        if (!existingNames.includes(baseName)) {
            return baseName;
        }

        let suffix = 2;
        let candidateName = `${baseName}_${suffix}`;
        while (existingNames.includes(candidateName)) {
            suffix++;
            candidateName = `${baseName}_${suffix}`;
        }

        return candidateName;
    }


    async saveAndUpdateMap(featuresByType) {
        let totalCount = 0;

        try {
            await addFeatures(featuresByType);

            await this.updateMapSources(featuresByType);

            totalCount = Object.values(featuresByType)
                .reduce((sum, features) => sum + features.length, 0);

        } catch (error) {
            console.error('Error saving imported features:', error);
            throw error;
        }

        return totalCount;
    }

    async updateMapSources(featuresByType) {
        for (const [type, features] of Object.entries(featuresByType)) {
            if (features.length === 0) continue;

            const sourceName = type;
            const source = this.map.getSource(sourceName);

            if (source) {
                const currentData = await source.getData();
                currentData.features.push(...features);
                source.setData(currentData);
            }
        }
    }

    zoomToAllImportedFeatures(featuresByType) {
        const allFeatures = Object.values(featuresByType).flat();
        this.zoomToFeatures(allFeatures);
    }

    getDefaultProperties(targetType) {
        const controlDefaults = {
            'points': this.pointControl.constructor.DEFAULT_PROPERTIES,
            'lines': this.lineControl.constructor.DEFAULT_PROPERTIES,
            'polygons': this.polygonControl.constructor.DEFAULT_PROPERTIES
        };

        return { ...controlDefaults[targetType] } || {};
    }

    zoomToFeatures(features) {
        if (features.length === 0) return;

        try {
            const bbox = turf.bbox({
                type: 'FeatureCollection',
                features: features
            });

            this.map.fitBounds([
                [bbox[0], bbox[1]],
                [bbox[2], bbox[3]]
            ], {
                padding: 50,
                maxZoom: 16
            });
        } catch (error) {
            console.warn('Error calculating zoom:', error);
        }
    }

    /**
     * Processes file directly without UI (for drag & drop)
     * @param {File} file - File to process
     */
    async processFileDirectly(file) {
        const fakeEvent = {
            target: {
                files: [file],
                value: ''
            }
        };

        await this.handleFileSelect(fakeEvent);
    }
}

export default AddImportControl;
