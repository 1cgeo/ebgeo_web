// Path: js\controls_sig\import_tool\add_import_control.js
import { addFeatures } from '../store.js';
import { IDUtils } from '../id_utils.js';

class AddImportControl {
    // ✅ CORREÇÃO 7: Configurações de limite de arquivo
    static FILE_LIMITS = {
        maxSize: 50 * 1024 * 1024,    // 50MB
        timeout: 30000,               // 30 segundos
        chunkSize: 1024 * 1024        // 1MB chunks para progresso
    };

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
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl import-control controls-column-left';

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

    _validateFile(file) {
        if (file.size > AddImportControl.FILE_LIMITS.maxSize) {
            throw new Error(`Arquivo muito grande. Máximo: ${AddImportControl.FILE_LIMITS.maxSize / (1024*1024)}MB`);
        }
        
        if (file.size === 0) {
            throw new Error('Arquivo vazio');
        }
    }

    _createFileReader(cleanup = true) {
        const reader = new FileReader();
        
        if (cleanup) {
            // Auto-cleanup após uso
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
        reader.abort(); // Cancela operação se ainda ativa
    }

    async _readFileWithProgress(file, method = 'text') {
        this._validateFile(file);
        
        return new Promise((resolve, reject) => {
            const reader = this._createFileReader();
            let progressCallback = null;
            
            // Setup timeout
            const timeout = setTimeout(() => {
                reader.abort();
                reject(new Error('Timeout na leitura do arquivo'));
            }, AddImportControl.FILE_LIMITS.timeout);
            
            // Setup progress (se arquivo grande)
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
            
            // Iniciar leitura
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

    // ✅ CORREÇÃO 9: Usar apenas async/await, eliminar Promise constructors
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
                
                const features = await shp.parseShp(shpBuffer, dbfBuffer);
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

    async importGeoJSON(geoJSON) {
        const validFeatures = [];
        const featuresByType = {
            points: [],
            linestrings: [],
            polygons: []
        };

        const pendingFeatures = [];
        
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

            // Preparar feature SEM ID final (Draw vai gerar)
            const preparedFeature = {
                type: 'Feature',
                properties: {
                    ...this.getDefaultProperties(targetType),
                    ...feature.properties, // Preservar propriedades originais quando possível
                    source: 'draw' // ✅ Marcar como draw para integração
                },
                geometry: feature.geometry
            };

            pendingFeatures.push({ feature: preparedFeature, targetType });
        }

        for (const { feature, targetType } of pendingFeatures) {
            try {
                // ✅ Draw gera ID primeiro
                const ids = this.drawControl.draw.add(feature);
                
                if (ids.length > 0) {
                    // ✅ Buscar feature com ID final do Draw
                    const finalFeature = this.drawControl.draw.get(ids[0]);
                    
                    // ✅ Sincronizar IDs (padrão obrigatório do sistema)
                    finalFeature.properties.id = finalFeature.id;
                    
                    // ✅ Agrupar para persistência
                    featuresByType[targetType].push(finalFeature);
                    validFeatures.push(finalFeature);
                }
            } catch (error) {
                console.warn('Erro ao adicionar feature ao Draw:', error);
                // Continuar com próximas features
            }
        }

        // ✅ FASE 3: Persistir em batch (com IDs sincronizados)
        if (Object.values(featuresByType).some(arr => arr.length > 0)) {
            try {
                // Usar addFeatures que registra ação única para undo/redo
                await addFeatures(featuresByType);
                
                if (validFeatures.length > 0) {
                    this.zoomToFeatures(validFeatures);
                }
            } catch (error) {
                // ✅ ROLLBACK: Remover features do Draw se persistência falhou
                validFeatures.forEach(f => {
                    try {
                        this.drawControl.draw.delete(f.id);
                    } catch (deleteError) {
                        console.warn('Erro no rollback da feature:', deleteError);
                    }
                });
                throw error;
            }
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