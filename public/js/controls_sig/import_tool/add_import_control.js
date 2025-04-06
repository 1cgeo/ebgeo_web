// Path: js\controls_sig\import_tool\add_import_control.js
import { addFeatures } from '../store.js';
import { getCurrentBaseLayer } from '../store.js';

class AddImportControl {
    constructor(toolManager) {
        this.toolManager = toolManager;
        this.isActive = false;
        this.baseLayerControl = null;
        this.defaultProperties = {
            point: {
                color: '#fbb03b',
                opacity: 1,
                size: 10,
                outlinecolor: '#fbb03b',
                source: 'draw',
                customAttributes: {}
            },
            linestring: {
                color: '#fbb03b',
                opacity: 0.7,
                size: 7,
                outlinecolor: '#fbb03b',
                source: 'draw',
                customAttributes: {}
            },
            polygon: {
                color: '#fbb03b',
                opacity: 0.5,
                size: 3,
                outlinecolor: '#fbb03b',
                source: 'draw',
                customAttributes: {}
            }
        };
    }

    setDrawControl(drawControl) {
        this.drawControl = drawControl;
    }

    setBaseLayerControl(baseLayerControl) {
        this.baseLayerControl = baseLayerControl;
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl';

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

        $('input[name="base-layer"]').on('change', this.changeButtonColor);
        this.changeButtonColor();

        return this.container;
    }

    changeButtonColor = () => {
        const color = $('input[name="base-layer"]:checked').val() == 'Carta' ? 'black' : 'white';
        $("#import-tool").html(`<img class="icon-sig-tool" src="./images/icon_import_${color}.svg" alt="IMPORT" />`);
        if (!this.isActive) return;
        $("#import-tool").html('<img class="icon-sig-tool" src="./images/icon_import_red.svg" alt="IMPORT" />');
    }

    onRemove() {
        this.container.parentNode.removeChild(this.container);
        this.map = undefined;
    }

    activate() {
        this.isActive = true;
        this.map.getCanvas().style.cursor = 'pointer';
        this.changeButtonColor();
        this.fileInput.click();
    }

    deactivate() {
        this.isActive = false;
        this.map.getCanvas().style.cursor = '';
        this.changeButtonColor();
    }

    handleMapClick() {
        // Não faz nada ao clicar no mapa
    }

    async handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) {
            this.toolManager.deactivateCurrentTool();
            return;
        }

        try {
            const fileName = file.name.toLowerCase();
            let geoJSON;

            if (fileName.endsWith('.geojson') || fileName.endsWith('.json')) {
                geoJSON = await this.processGeoJSON(file);
            } else if (fileName.endsWith('.zip')) {
                geoJSON = await this.processShapefile(file);
            } else if (fileName.endsWith('.kml')) {
                geoJSON = await this.processKML(file);
            } else if (fileName.endsWith('.kmz')) {
                geoJSON = await this.processKMZ(file);
            } else if (fileName.endsWith('.gpx')) {
                geoJSON = await this.processGPX(file);
            } else {
                throw new Error('Formato de arquivo não suportado');
            }

            if (geoJSON) {
                this.validateAndImportGeoJSON(geoJSON);
            }
        } catch (error) {
            console.error('Erro ao processar arquivo:', error);
            alert(`Erro ao processar arquivo: ${error.message}`);
        }

        // Reset input para permitir selecionar o mesmo arquivo novamente
        this.fileInput.value = '';
        this.toolManager.deactivateCurrentTool();
    }

    async processGeoJSON(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const geoJSON = JSON.parse(e.target.result);
                    resolve(geoJSON);
                } catch (error) {
                    reject(new Error('Arquivo GeoJSON inválido'));
                }
            };
            reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
            reader.readAsText(file);
        });
    }

    async processShapefile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const buffer = e.target.result;
                    // Descompactar ZIP e processar Shapefile usando shp.js
                    const zipFile = await JSZip.loadAsync(buffer);
                    
                    // Extrair arquivos necessários do ZIP
                    const shpFile = Object.values(zipFile.files).find(f => f.name.toLowerCase().endsWith('.shp'));
                    const dbfFile = Object.values(zipFile.files).find(f => f.name.toLowerCase().endsWith('.dbf'));
                    
                    if (!shpFile) {
                        reject(new Error('Arquivo .shp não encontrado no ZIP'));
                        return;
                    }
                    
                    const shpBuffer = await shpFile.async('arraybuffer');
                    let dbfBuffer = null;
                    if (dbfFile) {
                        dbfBuffer = await dbfFile.async('arraybuffer');
                    }
                    
                    // Processar com shp.js
                    const geojson = await shp.parseShp(shpBuffer, dbfBuffer);
                    resolve({
                        type: 'FeatureCollection',
                        features: geojson
                    });
                } catch (error) {
                    console.error('Erro ao processar Shapefile:', error);
                    reject(new Error('Erro ao processar Shapefile'));
                }
            };
            reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
            reader.readAsArrayBuffer(file);
        });
    }

    async processKML(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const kmlContent = e.target.result;
                    const parser = new DOMParser();
                    const kmlDoc = parser.parseFromString(kmlContent, 'text/xml');
                    const geoJSON = toGeoJSON.kml(kmlDoc);
                    resolve(geoJSON);
                } catch (error) {
                    reject(new Error('Arquivo KML inválido'));
                }
            };
            reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
            reader.readAsText(file);
        });
    }

    async processGPX(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const gpxContent = e.target.result;
                    const parser = new DOMParser();
                    const gpxDoc = parser.parseFromString(gpxContent, 'text/xml');
                    const geoJSON = toGeoJSON.gpx(gpxDoc);
                    resolve(geoJSON);
                } catch (error) {
                    reject(new Error('Arquivo GPX inválido'));
                }
            };
            reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
            reader.readAsText(file);
        });
    }

    async processKMZ(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const buffer = e.target.result;
                    const zip = await JSZip.loadAsync(buffer);
                    
                    // Encontrar arquivo KML principal dentro do KMZ
                    let kmlFile = zip.file(/\.kml$/i)[0];
                    if (!kmlFile) {
                        // Alguns KMZ usam doc.kml como nome padrão
                        kmlFile = zip.file('doc.kml');
                    }
                    
                    if (!kmlFile) {
                        reject(new Error('Nenhum arquivo KML encontrado no KMZ'));
                        return;
                    }
                    
                    const kmlContent = await kmlFile.async('string');
                    const parser = new DOMParser();
                    const kmlDoc = parser.parseFromString(kmlContent, 'text/xml');
                    const geoJSON = toGeoJSON.kml(kmlDoc);
                    resolve(geoJSON);
                } catch (error) {
                    reject(new Error('Arquivo KMZ inválido'));
                }
            };
            reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
            reader.readAsArrayBuffer(file);
        });
    }

    validateAndImportGeoJSON(geoJSON) {
        if (!geoJSON || !geoJSON.features || !Array.isArray(geoJSON.features)) {
            throw new Error('GeoJSON inválido ou formato incompatível');
        }

        const points = [];
        const linestrings = [];
        const polygons = [];

        geoJSON.features.forEach(feature => {
            if (!feature.geometry || !feature.geometry.type) {
                console.warn('Feature sem geometria válida foi ignorada');
                return;
            }

            // Atribuir ID único para cada feature
            feature.id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
            
            // Identificar tipo de geometria e aplicar propriedades apropriadas
            let geomType = feature.geometry.type.toLowerCase();
            
            // Extract custom attributes from the feature properties
            const customAttributes = {};
            if (feature.properties) {
                // Filter out internal MapLibre properties
                const excludeProps = ['id', 'mode', 'meta', 'active', 'user_color', 'user_opacity', 
                                      'user_size', 'user_outlinecolor', 'source'];
                
                Object.entries(feature.properties).forEach(([key, value]) => {
                    // Skip null values, standard properties we handle separately, and maplibre internal props
                    if (value !== null && 
                        !excludeProps.includes(key) && 
                        key !== 'customAttributes' &&
                        !key.startsWith('_') && 
                        !key.startsWith('mapbox')) {
                        customAttributes[key] = String(value); // Convert all values to strings
                    }
                });
            }

            if (geomType === 'point' || geomType === 'multipoint') {
                feature.properties = { 
                    ...this.defaultProperties.point,
                    ...feature.properties,
                    customAttributes
                };
                points.push(feature);
            } else if (geomType === 'linestring' || geomType === 'multilinestring') {
                feature.properties = { 
                    ...this.defaultProperties.linestring,
                    ...feature.properties,
                    customAttributes
                };
                linestrings.push(feature);
            } else if (geomType === 'polygon' || geomType === 'multipolygon') {
                feature.properties = { 
                    ...this.defaultProperties.polygon,
                    ...feature.properties,
                    customAttributes
                };
                polygons.push(feature);
            }
        });

        // Adicionar features ao mapa e store
        this.addFeaturesToMap(points, linestrings, polygons);
    }

    addFeaturesToMap(points, linestrings, polygons) {
        const features = [...points, ...linestrings, ...polygons];
        
        if (features.length === 0) {
            alert('Nenhuma geometria válida encontrada no arquivo.');
            return;
        }

        // Adicionar todas as features ao store com uma única entrada no histórico
        addFeatures({
            'points': points,
            'linestrings': linestrings,
            'polygons': polygons
        });

        // Forçar atualização do mapa recarregando o estilo atual
        // Isso aciona o evento 'styledata' que atualizará o mapa
        const currentLayer = getCurrentBaseLayer();
        this.baseLayerControl.switchLayer(currentLayer);

        // Zoom para as features importadas
        this.zoomToFeatures(features);
    }

    zoomToFeatures(features) {
        if (features.length === 0) return;

        // Usar a biblioteca turf para calcular o bounding box
        const bbox = turf.bbox({
            type: 'FeatureCollection',
            features: features
        });

        // Aplicar zoom ao bounding box
        this.map.fitBounds([
            [bbox[0], bbox[1]], // sudoeste
            [bbox[2], bbox[3]]  // nordeste
        ], {
            padding: 50
        });
    }
}

export default AddImportControl;