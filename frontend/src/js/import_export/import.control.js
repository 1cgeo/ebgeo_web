// Path: js/import_export/import.control.js
import JSZip from 'jszip';
import * as toGeoJSON from '@tmcw/togeojson';
import shp from 'shpjs';
import { addFeatures, createLayerForImport, getLayers, getCurrentMapNameSync, getEventBus } from '@store';
import { IDUtils } from '@utils/id_utils.js';
import { showSuccess, showError } from '@utils/toast_service.js';
import { getTerrainElevation } from '@js/terrain';
import { EventTypes } from '@events';
import { userDataManager } from '@js/user_data';
import { extractTemporalProperties, buildTrajectoryFromGpxFeature, extractGpxTimes, sanitizeImportedTrajectory } from '@js/temporal/temporal-import.js';

/** Maps source type to Portuguese display name for imported features. */
const TYPE_DISPLAY_NAMES = {
    'points': 'Ponto',
    'lines': 'Linha',
    'polygons': 'Polígono'
};

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

    /**
     * Sets the map reference for use outside of toolbar context (e.g., sidebar import tab)
     * @param {Object} map - MapLibre GL map instance
     */
    setMap(map) {
        this.map = map;
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
        this.fileInput.className = 'hidden-file-input';
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
            showError(`Erro ao importar arquivo: ${error.message}`);
        }

        // Only reset file input if it exists (not when called via processFileDirectly)
        if (this.fileInput) {
            this.fileInput.value = '';
        }
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

    async _readFileWithProgress(file, method = 'text') {
        this._validateFile(file);

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
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

            // 'loadend' is the single exit that fires for EVERY outcome (load, error and
            // abort), always after them. The timeout above calls reader.abort(), which
            // per the File API dispatches 'abort' + 'loadend' but NOT 'error' — cleaning
            // up only in onload/onerror left the progress overlay pinned to the screen
            // forever after a read timeout.
            reader.onloadend = () => {
                clearTimeout(timeout);
                if (progressCallback) this._hideProgressIndicator();
            };

            reader.onload = (e) => {
                resolve(e.target.result);
            };

            reader.onerror = () => {
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
        progressDiv.className = 'import-progress';

        const label = document.createElement('div');
        label.textContent = 'Importando arquivo...';

        const barContainer = document.createElement('div');
        barContainer.className = 'import-progress__bar-container';

        const bar = document.createElement('div');
        bar.className = 'import-progress__bar';
        barContainer.appendChild(bar);

        progressDiv.appendChild(label);
        progressDiv.appendChild(barContainer);
        document.body.appendChild(progressDiv);

        this._progressElement = progressDiv;

        return (percent) => {
            bar.style.width = `${percent}%`;
        };
    }

    _hideProgressIndicator() {
        if (this._progressElement) {
            this._progressElement.remove();
            this._progressElement = null;
        }
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
        } else if (fileName.endsWith('.rar') || fileName.endsWith('.7z')) {
            throw new Error('Formato de compactação não suportado. Extraia os arquivos e recompacte como .zip');
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
                // shp() handles everything: ZIP extraction, .prj reprojection,
                // .cpg encoding, .dbf attributes, and combining into GeoJSON
                const result = await shp(buffer);

                // Multiple shapefiles in ZIP → returns array; pick first
                const geoJSON = Array.isArray(result) ? result[0] : result;

                if (!geoJSON?.features) {
                    throw new Error('Formato de shapefile inválido');
                }

                return geoJSON;
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
                // KML gx:Track carries per-vertex times like GPX → turn timed tracks
                // into moving points too (no-op for untimed KML geometry).
                return this._convertTimedTracksToMovingPoints(toGeoJSON.kml(kmlDoc));
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
                return this._convertTimedTracksToMovingPoints(toGeoJSON.kml(kmlDoc));
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
                const geoJSON = toGeoJSON.gpx(gpxDoc);
                return this._convertTimedTracksToMovingPoints(geoJSON);
            },
            'Arquivo GPX inválido'
        );
    }

    /**
     * Converts timed track features (GPX `<time>` tracks, KML `gx:Track`) that carry
     * per-vertex timestamps into single MOVING POINT features: the trajectory drives
     * an animated marker on the timeline, and the feature is windowed to the track's
     * first/last instant. Tracks WITHOUT times keep their original (LineString)
     * geometry so the existing import path is untouched.
     * @param {Object} geoJSON - FeatureCollection from togeojson.gpx()/.kml().
     * @returns {Object} FeatureCollection with timed tracks turned into points.
     * @private
     */
    _convertTimedTracksToMovingPoints(geoJSON) {
        if (!geoJSON?.features || !Array.isArray(geoJSON.features)) {
            return geoJSON;
        }

        geoJSON.features = geoJSON.features.map((feature) => {
            const geomType = feature?.geometry?.type;
            const isTrack = geomType === 'LineString' || geomType === 'MultiLineString';
            if (!isTrack) return feature;

            const times = extractGpxTimes(feature);
            if (!Array.isArray(times) || times.length === 0) return feature;

            const trajetoria = buildTrajectoryFromGpxFeature(feature);
            if (trajetoria.length === 0) return feature;

            const first = trajetoria[0];
            const last = trajetoria[trajetoria.length - 1];

            return {
                ...feature,
                geometry: {
                    type: 'Point',
                    coordinates: [first.lng, first.lat],
                },
                properties: {
                    ...feature.properties,
                    trajetoria,
                    temporalInicio: first.t,
                    temporalFim: last.t,
                },
            };
        });

        return geoJSON;
    }

    decomposeMultiGeometry(feature) {
        const { geometry, properties } = feature;
        const singularType = geometry.type.replace('Multi', '');

        // Multi* types share the same pattern: each coordinate element becomes a single-geometry feature
        if (geometry.type === 'MultiPoint' || geometry.type === 'MultiLineString' || geometry.type === 'MultiPolygon') {
            return geometry.coordinates.map(coords => ({
                type: 'Feature',
                properties: { ...properties },
                geometry: { type: singularType, coordinates: coords }
            }));
        }

        if (geometry.type === 'GeometryCollection') {
            const features = [];
            for (const geom of geometry.geometries) {
                // A GeometryCollection may legally contain a null geometry member;
                // skip it instead of throwing on geom.type (which aborted the import).
                if (!geom?.type) continue;
                const subFeature = { type: 'Feature', properties: { ...properties }, geometry: geom };
                if (geom.type.startsWith('Multi') || geom.type === 'GeometryCollection') {
                    features.push(...this.decomposeMultiGeometry(subFeature));
                } else {
                    features.push(subFeature);
                }
            }
            return features;
        }

        return [feature];
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

        // If map is not available, return default counters
        if (!this.map) {
            return typeCounters;
        }

        for (const sourceType of Object.keys(typeCounters)) {
            try {
                const source = this.map.getSource(sourceType);
                if (source) {
                    const data = await source.getData();
                    if (data && data.features) {
                        const existingNumbers = [];
                        const expectedPrefix = TYPE_DISPLAY_NAMES[sourceType];

                        data.features.forEach(feature => {
                            if (feature.properties && feature.properties.nome) {
                                const name = feature.properties.nome;
                                const match = name.match(new RegExp(`^${expectedPrefix}\\s*#(\\d+)$`));
                                if (match) {
                                    existingNumbers.push(parseInt(match[1], 10));
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
        const name = `${TYPE_DISPLAY_NAMES[targetType]} #${counters[targetType]}`;
        counters[targetType]++;
        return name;
    }

    /**
     * Calculates elevation profile for line features
     * @param {Array} coordinates - Line coordinates
     * @returns {Array} Profile data with distance and elevation points
     */
    async calculateProfile(coordinates) {
        // If map is not available, return empty profile
        if (!this.map) {
            return [];
        }

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
     * Flattens nested temporal containers produced by some readers so the shared
     * extractTemporalProperties helper (which scans top-level keys) can read them.
     * @tmcw/togeojson emits KML <TimeSpan> as `timespan: { begin, end }`.
     * @param {Object} props - Raw imported feature properties.
     * @returns {Object} A shallow copy with `timespan.begin/end` promoted to top level.
     * @private
     */
    _flattenTemporalSource(props) {
        if (!props || typeof props !== 'object') return {};
        const ts = props.timespan;
        if (ts && typeof ts === 'object') {
            return { ...props, begin: ts.begin, end: ts.end };
        }
        return props;
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
        const { id: featureId, geoJsonId } = IDUtils.generateFeatureIds();
        const featureName = this.generateImportName(targetType, typeCounters);

        // Extract custom attributes and description from imported properties
        const { attributes: extractedAttributes, descricao } = userDataManager.extractAttributesFromImport(
            feature.properties
        );

        // Extract temporal validity (epoch-ms) from the raw imported properties.
        // @tmcw/togeojson emits KML <TimeSpan> as a nested `timespan: { begin, end }`
        // object and KML <TimeStamp> as a top-level `timestamp` string; flatten the
        // nested begin/end here so extractTemporalProperties (which scans top-level
        // keys) catches them without weakening the shared helper.
        const temporalSource = this._flattenTemporalSource(feature.properties);
        const temporal = extractTemporalProperties(temporalSource);

        const baseProperties = {
            ...this.getDefaultProperties(targetType),
            // Note: We no longer spread feature.properties here to avoid mixing
            // imported data with system properties. Custom data goes to 'attributes'.
            id: featureId,
            nome: featureName,
            descricao: descricao,
            source: targetType.slice(0, -1),
            layerId: layerId,
            // User data fields - custom attributes extracted from import, empty images
            attributes: extractedAttributes,
            images: [],
        };

        // Copy temporal validity onto the feature when found. Absent fields stay
        // absent so the feature remains permanent (visible at any cursor).
        if (temporal.temporalInicio !== undefined) {
            baseProperties.temporalInicio = temporal.temporalInicio;
        }
        if (temporal.temporalFim !== undefined) {
            baseProperties.temporalFim = temporal.temporalFim;
        }

        // A timed track (GPX/KML) carried over as a moving point — or any imported
        // GeoJSON that already has a `trajetoria` — exposes its trajectory via the
        // properties. Sanitize it (coerce keypoint times, drop invalid, decimate to
        // 1 min) so a foreign/hand-authored trajectory can't bloat or break rendering.
        const cleanTrajectory = sanitizeImportedTrajectory(feature.properties?.trajetoria);
        if (cleanTrajectory.length > 0) {
            baseProperties.trajetoria = cleanTrajectory;
        }

        // Anchor zoom-correction to the CURRENT zoom (like a freshly-drawn feature),
        // not the spread default of 0 — otherwise the 2^(zoom-createdAtZoom) factor
        // balloons an imported point/label at any non-zero zoom (the GPX/import bug).
        const currentZoom = Number.isFinite(this.map?.getZoom?.()) ? this.map.getZoom() : 0;

        switch (targetType) {
            case 'lines':
                baseProperties.baseCoordinates = feature.geometry.coordinates;
                baseProperties.profileData = JSON.stringify(
                    await this.calculateProfile(feature.geometry.coordinates)
                );
                break;

            case 'polygons': {
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
                // Shape geometry is real-world sized; only the optional label scales.
                baseProperties.labelCreatedAtZoom = currentZoom;
                baseProperties.labelCalculatedSize = baseProperties.labelSize;
                break;
            }

            case 'points':
                baseProperties.sizeCreatedAtZoom = currentZoom;
                baseProperties.calculatedSize = baseProperties.size;
                baseProperties.labelCreatedAtZoom = currentZoom;
                baseProperties.labelCalculatedSize = baseProperties.labelSize;
                break;
        }

        return {
            type: 'Feature',
            id: geoJsonId,
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

        if (totalFeaturesToImport > 1000) {
            throw new Error(`Muitas geometrias para importar: ${totalFeaturesToImport}. Limite máximo: 1000 geometrias.`);
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
        // If map is not available, skip map source updates
        if (!this.map) {
            return;
        }

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

        return controlDefaults[targetType] ? { ...controlDefaults[targetType] } : {};
    }

    zoomToFeatures(features) {
        if (features.length === 0) return;

        // If map is not available, skip zoom
        if (!this.map) {
            return;
        }

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
