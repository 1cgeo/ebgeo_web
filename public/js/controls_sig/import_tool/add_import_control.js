// Path: js\controls_sig\import_tool\add_import_control.js
import { addFeature } from '../store.js';

class AddImportControl {
    constructor(toolManager) {
        this.toolManager = toolManager;
        this.isActive = false;
        this.drawControl = null;
        this.baseLayerControl = null;
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

        // Input de arquivo oculto
        this.fileInput = document.createElement('input');
        this.fileInput.type = 'file';
        this.fileInput.accept = '.geojson,.json,.zip,.kml,.kmz,.gpx';
        this.fileInput.style.display = 'none';
        this.fileInput.addEventListener('change', this.handleFileSelect.bind(this));
        this.container.appendChild(this.fileInput);

        // Atualizar cor do botão baseado no layer atual
        this.changeButtonColor();

        return this.container;
    }

    changeButtonColor = () => {
        $("#import-tool").html(`<img class="icon-sig-tool" src="./images/icon_import_black.svg" alt="IMPORT" />`);
        if (!this.isActive) return;
        $("#import-tool").html('<img class="icon-sig-tool" src="./images/icon_import_red.svg" alt="IMPORT" />');
    }

    onRemove() {
        this.container.parentNode.removeChild(this.container);
        this.map = undefined;
    }

    activate() {
        this.isActive = true;
        this.changeButtonColor();
        this.fileInput.click(); // Abrir dialog de arquivo imediatamente
    }

    deactivate() {
        this.isActive = false;
        this.changeButtonColor();
    }

    handleMapClick() {
        // Import tool não precisa de interação com o mapa
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
                const importedCount = await this.importGeoJSON(geoJSON);
                this.showImportSuccess(importedCount);
            }
        } catch (error) {
            console.error('Erro ao importar arquivo:', error);
            alert(`Erro ao importar arquivo: ${error.message}`);
        }

        // Reset input
        this.fileInput.value = '';
        this.toolManager.deactivateCurrentTool();
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
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const geoJSON = JSON.parse(e.target.result);
                    if (!geoJSON.features || !Array.isArray(geoJSON.features)) {
                        throw new Error('GeoJSON inválido');
                    }
                    resolve(geoJSON);
                } catch (error) {
                    reject(new Error('Arquivo GeoJSON inválido'));
                }
            };
            reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
            reader.readAsText(file);
        });
    }

    async readShapefile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const zipFile = await JSZip.loadAsync(e.target.result);
                    
                    const shpFile = Object.values(zipFile.files).find(f => f.name.toLowerCase().endsWith('.shp'));
                    const dbfFile = Object.values(zipFile.files).find(f => f.name.toLowerCase().endsWith('.dbf'));
                    
                    if (!shpFile) {
                        throw new Error('Arquivo .shp não encontrado');
                    }
                    
                    const shpBuffer = await shpFile.async('arraybuffer');
                    const dbfBuffer = dbfFile ? await dbfFile.async('arraybuffer') : null;
                    
                    const features = await shp.parseShp(shpBuffer, dbfBuffer);
                    resolve({
                        type: 'FeatureCollection',
                        features: features
                    });
                } catch (error) {
                    reject(new Error('Erro ao processar Shapefile'));
                }
            };
            reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
            reader.readAsArrayBuffer(file);
        });
    }

    async readKML(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const kmlDoc = new DOMParser().parseFromString(e.target.result, 'text/xml');
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

    async readKMZ(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const zip = await JSZip.loadAsync(e.target.result);
                    const kmlFile = zip.file(/\.kml$/i)[0] || zip.file('doc.kml');
                    
                    if (!kmlFile) {
                        throw new Error('Arquivo KML não encontrado no KMZ');
                    }
                    
                    const kmlContent = await kmlFile.async('string');
                    const kmlDoc = new DOMParser().parseFromString(kmlContent, 'text/xml');
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

    async readGPX(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const gpxDoc = new DOMParser().parseFromString(e.target.result, 'text/xml');
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

    async importGeoJSON(geoJSON) {
        const validFeatures = [];

        for (const feature of geoJSON.features) {
            if (!feature.geometry || !feature.geometry.type) {
                continue; // Ignorar features sem geometria
            }

            const geomType = feature.geometry.type.toLowerCase();
            let targetType;

            // Mapear tipos de geometria
            if (geomType.includes('point')) {
                targetType = 'points';
            } else if (geomType.includes('line')) {
                targetType = 'linestrings';
            } else if (geomType.includes('polygon')) {
                targetType = 'polygons';
            } else {
                continue; // Ignorar tipos não suportados
            }

            // Criar feature com propriedades padrões do DrawControl
            const processedFeature = {
                ...feature,
                id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                properties: {
                    ...this.getDefaultProperties(targetType),
                    ...feature.properties // Preservar propriedades originais quando possível
                }
            };

            // Adicionar ao DrawControl e IndexedDB
            this.drawControl.draw.add(processedFeature);
            await addFeature(targetType, processedFeature);
            
            validFeatures.push(processedFeature);
        }

        // Zoom para as features importadas
        if (validFeatures.length > 0) {
            this.zoomToFeatures(validFeatures);
        }

        return validFeatures.length;
    }

    getDefaultProperties(targetType) {
        // Usar as propriedades padrões do DrawControl
        if (targetType === 'points') {
            return { ...this.drawControl.defaultProperties.point };
        } else if (targetType === 'linestrings') {
            return { ...this.drawControl.defaultProperties.linestring };
        } else if (targetType === 'polygons') {
            return { ...this.drawControl.defaultProperties.polygon };
        }
        return {};
    }

    zoomToFeatures(features) {
        if (features.length === 0) return;

        try {
            const bbox = turf.bbox({
                type: 'FeatureCollection',
                features: features
            });

            this.map.fitBounds([
                [bbox[0], bbox[1]], // SW
                [bbox[2], bbox[3]]  // NE
            ], {
                padding: 50,
                maxZoom: 16 // Evitar zoom excessivo
            });
        } catch (error) {
            console.warn('Erro ao calcular zoom:', error);
        }
    }

    showImportSuccess(count) {
        // Feedback simples de sucesso
        const message = count === 1 
            ? `1 geometria importada com sucesso`
            : `${count} geometrias importadas com sucesso`;
        
        // Criar notificação temporária
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #28a745;
            color: white;
            padding: 12px 20px;
            border-radius: 4px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            z-index: 1000;
            font-size: 14px;
        `;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        // Remover após 3 segundos
        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 3000);
    }
}

export default AddImportControl;