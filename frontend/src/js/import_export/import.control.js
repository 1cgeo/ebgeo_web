// Path: js/import_export/import.control.js
import JSZip from 'jszip';
import * as toGeoJSON from '@tmcw/togeojson';
import shp from 'shpjs';
import { addFeatures, createLayerForImport, getLayers, getCurrentMapNameSync, getEventBus } from '@store';
import { IDUtils } from '@utils/id_utils.js';
import { showSuccess, showError } from '@utils/toast_service.js';
import { createTerrainSampler } from '@js/terrain';
import { EventTypes } from '@events';
import { getGeoJsonDispatcher } from '@layers/geojson-dispatcher.js';
import { userDataManager } from '@js/user_data';
import { ensureTurf } from '@utils/turf-loader.js';
import { extractTemporalProperties, buildTrajectoryFromGpxFeature, extractGpxTimes, sanitizeImportedTrajectory } from '@js/temporal/temporal-import.js';

/** Maps source type to Portuguese display name for imported features. */
const TYPE_DISPLAY_NAMES = {
    'points': 'Ponto',
    'lines': 'Linha',
    'polygons': 'Polígono'
};

/**
 * CEILING on how many features to prepare between two progress updates.
 *
 * There is no cap on how many geometries an import may carry (the 1000-geometry
 * limit was removed on 2026-09-02 at the owner's request), so the per-feature
 * preparation loop is the only step that can block the main thread for a long
 * time. It got much cheaper per feature when the terrain profile stopped being
 * computed for every imported line (see shouldComputeProfileOnImport), and that
 * is not the same as bounded: the geometry count still is not.
 * Every step the loop repaints the progress bar and yields the event loop,
 * which is what keeps the browser responsive on large files.
 *
 * The step actually used is ADAPTIVE (see prepareProgressStep): a fixed 100
 * would leave the bar pinned at 0% for every import under 100 geometries, which
 * is most of them. This constant only bounds it from above, so a huge import
 * does not pay for a repaint plus a macrotask every few features.
 * Persistence stays a single batched write; it is NOT chunked.
 */
const PREPARE_PROGRESS_STEP = 100;

/**
 * Progress-update stride for a run of this many features: about twenty updates,
 * never coarser than PREPARE_PROGRESS_STEP and never finer than every feature.
 *
 * Exported for unit testing; it is pure and depends on nothing in the class.
 * It deliberately does NOT live in a module of its own: import.control.js is on
 * the map page eager graph, and a new leaf would spend a slot of the import_export
 * budget asserted by tests/unit/teto-de-peso-da-pagina-do-mapa.test.js.
 * @param {number} total - Number of features about to be prepared
 * @returns {number} Features to prepare between two progress updates
 */
export function prepareProgressStep(total) {
    return Math.max(1, Math.min(PREPARE_PROGRESS_STEP, Math.ceil(total / 20)));
}

/**
 * Whether an imported line feature must carry an elevation profile from birth.
 *
 * IT IS THE SAME CONDITION EVERY OTHER LINE SITE ALREADY USES, and the import was the only
 * one that did not ask it. `recalculateMovedLineFeatures`, the two vertex editors, the
 * continuation of a line and `line-split.js` all guard their `calculateProfile` with
 * `properties.profile`; the import computed one for EVERY line unconditionally, while the
 * default properties of the line control are born `profile: false`. Nothing could read it:
 * `showProfilePanel` needs `profileData` AND `profile`, and the only gesture that turns
 * `profile` on (`line_attributes_panel.js`) goes through `updateFeaturesProperty`, which
 * recalculates the profile from `baseCoordinates` at that moment. The imported profile was
 * therefore recomputed before it was ever shown.
 *
 * The cost it was paying is per line and not per import: 26 `turf.along` plus 26 terrain
 * queries, and about 1.6 kB of JSON written to IndexedDB and pushed through sync. Measured
 * on a synthetic 2000-line file, that is 52k `turf.along` calls, 52k terrain queries and
 * 3.2 MB of dead payload. The figure was 104k queries when this was written, because each
 * sample queried TWICE (a fixed reference point at [0, 0] that cancelled an offset MapLibre
 * 5.18 does not apply); `terrain/terrain-elevation.js` ended the double query on
 * 2026-09-04, and the batch sampler below made each of the 26 a single DEM read.
 *
 * It reads the flag rather than answering a constant `false` so that a line control whose
 * defaults ever ship `profile: true` keeps getting a profile at import time without anyone
 * having to remember this file.
 *
 * Pure and exported for unit testing; it deliberately does NOT live in a module of its own,
 * for the same reason as {@link prepareProgressStep}.
 * @param {{profile?: boolean}|null|undefined} properties - The prepared feature properties.
 * @returns {boolean}
 */
export function shouldComputeProfileOnImport(properties) {
    return properties?.profile === true;
}

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

        // O FUNIL DA IMPORTACAO, e ele cobre os dois sitios de Turf deste arquivo:
        // `calculateProfile` (perfil de elevacao de linha, ja assincrono) e `zoomToFeatures`
        // (o `turf.bbox` do enquadramento final, sincrono e no meio de `updateMapSources`).
        // O `await` fica aqui em vez de nos dois porque este e o gesto: escolher o arquivo.
        // `processFileDirectly` (arrastar e soltar) delega para ca, entao os dois caminhos de
        // entrada passam por esta linha.
        //
        // Ele vem DEPOIS da guarda de arquivo vazio: cancelar o seletor de arquivo nao pode
        // baixar 619 kB.
        await ensureTurf();

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

    /**
     * Shows the blocking progress overlay.
     * @param {string} [initialMessage] - First line shown above the bar.
     * @returns {(percent: number, message?: string) => void} Updater; the second
     *   argument is optional so existing single-argument callers keep working.
     */
    _showProgressIndicator(initialMessage = 'Importando arquivo...') {
        const progressDiv = document.createElement('div');
        progressDiv.className = 'import-progress';

        const label = document.createElement('div');
        label.textContent = initialMessage;

        const barContainer = document.createElement('div');
        barContainer.className = 'import-progress__bar-container';

        const bar = document.createElement('div');
        bar.className = 'import-progress__bar';
        barContainer.appendChild(bar);

        progressDiv.appendChild(label);
        progressDiv.appendChild(barContainer);
        document.body.appendChild(progressDiv);

        this._progressElement = progressDiv;

        return (percent, message) => {
            bar.style.width = `${percent}%`;
            if (message) label.textContent = message;
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
            // A hand-edited or truncated file can declare the collection and omit its member
            // list; `for..of undefined` threw a TypeError out of the per-feature loop of
            // importGeoJSON, which has no catch, so ONE malformed collection aborted the whole
            // file. The null MEMBER already had a guard below; the missing CONTAINER did not.
            if (!Array.isArray(geometry.geometries)) {
                return features;
            }
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
                        // ONE SCAN, no `Math.max(...array)`. Spreading an array into the call
                        // pushes one argument per element onto the stack, which above ~125k
                        // elements throws RangeError; the per-source try/catch below swallowed
                        // it and the counter fell back to 1, so on a big map EVERY imported
                        // name collided with an existing one, with only a console.warn. Same
                        // class already closed in `add_brush_geometry.getBoundingBox`.
                        let maxNumber = 0;
                        const expectedPrefix = TYPE_DISPLAY_NAMES[sourceType];
                        const namePattern = new RegExp(`^${expectedPrefix}\\s*#(\\d+)$`);

                        data.features.forEach(feature => {
                            if (feature.properties && feature.properties.nome) {
                                const name = feature.properties.nome;
                                const match = name.match(namePattern);
                                if (match) {
                                    const parsed = parseInt(match[1], 10);
                                    if (Number.isFinite(parsed) && parsed > maxNumber) {
                                        maxNumber = parsed;
                                    }
                                }
                            }
                        });

                        if (maxNumber > 0) {
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
     *
     * Throws on a type outside the three buckets instead of naming the feature
     * "undefined #undefined" and poisoning `counters[targetType]` with NaN (every later
     * feature of that type then got the SAME undefined name). `getTargetType` only ever
     * yields points/lines/polygons or null, and the null is filtered by the caller, so the
     * throw marks a caller bug rather than writing garbage into user data. A counter that is
     * absent or non-finite restarts at 1: `x ?? 1` would not catch the NaN.
     *
     * @param {string} targetType - Type of feature (points, lines, polygons)
     * @param {Object} counters - Counter object to track naming sequence
     * @returns {string} Generated unique name
     * @throws {Error} If targetType is not one of the three known buckets
     */
    generateImportName(targetType, counters) {
        if (!Object.hasOwn(TYPE_DISPLAY_NAMES, targetType)) {
            throw new Error(`Tipo de importação desconhecido: ${targetType}`);
        }
        const current = Number.isFinite(counters[targetType]) ? counters[targetType] : 1;
        const name = `${TYPE_DISPLAY_NAMES[targetType]} #${current}`;
        counters[targetType] = current + 1;
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
            // Um amostrador por linha importada, e nao um por amostra: o zoom de consulta
            // se resolve uma vez so para as 26.
            const sampler = createTerrainSampler(this.map);

            for (let i = 0; i <= steps; i++) {
                const point = turf.along(line, i * stepLength, { units: 'meters' });
                const elevation = sampler.elevation(point.geometry.coordinates);
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
                // Only when the profile is ON, which is the convention of every other line
                // site (see shouldComputeProfileOnImport). A line born `profile: false`
                // gets its profile the moment the panel switch turns it on.
                if (shouldComputeProfileOnImport(baseProperties)) {
                    baseProperties.profileData = JSON.stringify(
                        await this.calculateProfile(feature.geometry.coordinates)
                    );
                }
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

        if (totalFeaturesToImport === 0) {
            throw new Error('Nenhuma geometria válida encontrada para importar');
        }

        const uniqueLayerName = await this._getUniqueLayerName(fileName);
        const importLayer = await createLayerForImport(uniqueLayerName);
        const importLayerId = importLayer.id;

        // Preparation is the only per-feature step, so it is the one that can freeze
        // the UI now that the geometry count is unbounded. Report progress and yield
        // the event loop periodically; persistence below stays a single batched write,
        // which must NOT be chunked (each chunk would rewrite the whole map).
        //
        // The overlay is a single slot (this._progressElement), and no caller reaches
        // here with one standing: the read overlay of _readFileWithProgress is removed
        // in reader.onloadend, before processFile resolves, and the CSV path never
        // opens one (it reads through file.text()).
        const updateProgress = this._showProgressIndicator(
            `Preparando ${totalFeaturesToImport} geometrias...`
        );
        const progressStep = prepareProgressStep(totalFeaturesToImport);
        let totalCount = 0;

        try {
            let preparedCount = 0;

            for (const { feature, targetType } of decomposedFeatures) {
                const preparedFeature = await this.prepareFeatureForImportAsync(
                    feature,
                    targetType,
                    typeCounters,
                    importLayerId
                );
                featuresByType[targetType].push(preparedFeature);
                preparedCount++;

                if (preparedCount % progressStep === 0) {
                    updateProgress(
                        (preparedCount / totalFeaturesToImport) * 100,
                        `Preparando geometrias: ${preparedCount} de ${totalFeaturesToImport}`
                    );
                    // Hand the thread back so the browser can repaint the bar.
                    await new Promise((resolve) => setTimeout(resolve, 0));
                }
            }

            updateProgress(100, `Salvando ${totalFeaturesToImport} geometrias...`);
            // Yield once more so the "Salvando" message is actually painted before
            // the single batched write takes the thread.
            await new Promise((resolve) => setTimeout(resolve, 0));

            totalCount = await this.saveAndUpdateMap(featuresByType);
        } finally {
            this._hideProgressIndicator();
        }

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
            // Queued as one batch instead of a read-modify-write: every source named here is
            // dispatcher-owned, and a raw `setData` replaces MapLibre's pending-update slot,
            // dropping a queued diff with no error. An import is a pure append, so nothing has
            // to be read back first.
            if (this.map.getSource(sourceName)) {
                getGeoJsonDispatcher(this.map, sourceName).add(features);
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
