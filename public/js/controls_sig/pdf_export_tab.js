// Path: js/controls_sig/pdf_export_tab.js
import config from '../config.js';

export default class PDFExportTab {
    constructor(map) {
        this.map = map;
        this.orientation = 'landscape';
        this.previewLayer = null;
        this.isVisible = false;
        this.bounds = null;
        
        // Bind methods
        this.onOrientationChange = this.onOrientationChange.bind(this);
        this.onExportClick = this.onExportClick.bind(this);
        this.onMapMove = this.onMapMove.bind(this);
    }

    createUI() {
        return `
            <div class="pdf-export-container">
                <div class="orientation-selector">
                    <label>
                        <input type="radio" name="pdf-orientation" value="landscape" checked> 
                        📄 Paisagem (A4)
                    </label>
                    <label>
                        <input type="radio" name="pdf-orientation" value="portrait"> 
                        📄 Retrato (A4)
                    </label>
                </div>
                
                <button id="export-pdf-btn" class="export-pdf-btn pure-material-button-contained">
                    📥 Exportar PDF Georreferenciado
                </button>
                
                <div id="export-status" class="export-status" style="display: none;">
                    <div class="loading-spinner"></div>
                    <span>Processando PDF...</span>
                </div>
            </div>
        `;
    }

    show() {
        this.isVisible = true;
        this.showPreview();
        this.updateBounds();
        this.attachEventListeners();
        
        // Atualizar bounds quando o mapa se mover
        this.map.on('move', this.onMapMove);
    }

    hide() {
        this.isVisible = false;
        this.hidePreview();
        this.detachEventListeners();
        
        // Remover listener do mapa
        this.map.off('move', this.onMapMove);
    }

    attachEventListeners() {
        // Radio buttons de orientação
        const orientationInputs = document.querySelectorAll('input[name="pdf-orientation"]');
        orientationInputs.forEach(input => {
            input.addEventListener('change', this.onOrientationChange);
        });

        // Botão de exportar
        const exportBtn = document.getElementById('export-pdf-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', this.onExportClick);
        }
    }

    detachEventListeners() {
        const orientationInputs = document.querySelectorAll('input[name="pdf-orientation"]');
        orientationInputs.forEach(input => {
            input.removeEventListener('change', this.onOrientationChange);
        });

        const exportBtn = document.getElementById('export-pdf-btn');
        if (exportBtn) {
            exportBtn.removeEventListener('click', this.onExportClick);
        }
    }

    onOrientationChange(event) {
        this.orientation = event.target.value;
        this.updateBounds();
    }

    onMapMove() {
        if (this.isVisible) {
            // Debounce updates para melhor performance
            clearTimeout(this.updateTimeout);
            this.updateTimeout = setTimeout(() => {
                this.updateBounds();
            }, 100);
        }
    }

    showPreview() {
        // Criar source se não existir
        if (!this.map.getSource('pdf-export-preview')) {
            this.map.addSource('pdf-export-preview', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
            });
        }

        // Criar layers se não existirem
        if (!this.map.getLayer('pdf-export-preview-fill')) {
            this.map.addLayer({
                id: 'pdf-export-preview-fill',
                type: 'fill',
                source: 'pdf-export-preview',
                paint: {
                    'fill-color': '#508D4E',
                    'fill-opacity': 0.15
                }
            });
        }

        if (!this.map.getLayer('pdf-export-preview-stroke')) {
            this.map.addLayer({
                id: 'pdf-export-preview-stroke',
                type: 'line',
                source: 'pdf-export-preview',
                paint: {
                    'line-color': '#508D4E',
                    'line-width': 2,
                    'line-dasharray': [8, 4]
                }
            });
        }
    }

    hidePreview() {
        const layerIds = ['pdf-export-preview-fill', 'pdf-export-preview-stroke'];
        
        layerIds.forEach(layerId => {
            if (this.map.getLayer(layerId)) {
                this.map.removeLayer(layerId);
            }
        });
        
        if (this.map.getSource('pdf-export-preview')) {
            this.map.removeSource('pdf-export-preview');
        }
    }

    calculateA4Bounds(orientation) {
        const center = this.map.getCenter();
        const bounds = this.map.getBounds();
        
        // Usar APENAS a altura da viewport como base para o cálculo
        const viewportHeight = bounds.getNorth() - bounds.getSouth(); // latitude range
        
        // Usar 80% da altura da viewport como base
        const scaleFactor = 0.8;
        const baseHeight = viewportHeight * scaleFactor;
        
        // Ratio A4: 297mm x 210mm
        const ratio = 297 / 210; // ~1.414
        
        let offsetLng, offsetLat;
        
        if (orientation === 'landscape') {
            // Paisagem: altura menor, largura maior
            offsetLat = baseHeight / 2;
            offsetLng = (baseHeight * ratio) / 2;
        } else {
            // Retrato: altura maior, largura menor  
            offsetLat = baseHeight / 2;
            offsetLng = (baseHeight / ratio) / 2;
        }
        
        return {
            topLeft: [center.lng - offsetLng, center.lat + offsetLat],
            topRight: [center.lng + offsetLng, center.lat + offsetLat],
            bottomRight: [center.lng + offsetLng, center.lat - offsetLat],
            bottomLeft: [center.lng - offsetLng, center.lat - offsetLat]
        };
    }

    updateBounds() {
        this.bounds = this.calculateA4Bounds(this.orientation);
        
        // Atualizar preview no mapa
        const feature = {
            type: 'Feature',
            properties: {
                orientation: this.orientation
            },
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    this.bounds.topLeft,
                    this.bounds.topRight, 
                    this.bounds.bottomRight,
                    this.bounds.bottomLeft,
                    this.bounds.topLeft
                ]]
            }
        };

        const source = this.map.getSource('pdf-export-preview');
        if (source) {
            source.setData({
                type: 'FeatureCollection',
                features: [feature]
            });
        }
    }

    async onExportClick() {
        try {
            this.setExportStatus(true, 'Capturando imagem do mapa...');
            
            // Capturar screenshot do mapa
            const imageData = await this.captureMapImage();
            
            this.setExportStatus(true, 'Enviando para processamento...');
            
            // Preparar dados para o backend
            const exportData = {
                image: imageData,
                bounds: this.bounds,
                orientation: this.orientation,
                paperSize: 'A4',
                projection: 'EPSG:4326',
                timestamp: new Date().toISOString()
            };

            // Enviar para o backend
            const pdfBlob = await this.sendToBackend(exportData);
            
            this.setExportStatus(true, 'Fazendo download...');
            
            // Fazer download do PDF
            this.downloadPDF(pdfBlob);
            
            this.setExportStatus(false);
            
        } catch (error) {
            console.error('Erro ao exportar PDF:', error);
            this.setExportStatus(false);
            alert('Erro ao exportar PDF: ' + error.message);
        }
    }

    async captureMapImage() {
        return new Promise((resolve, reject) => {
            try {
                // Forçar renderização
                this.map.triggerRepaint();
                
                requestAnimationFrame(() => {
                    try {
                        const canvas = this.map.getCanvas();
                        const dataURL = canvas.toDataURL('image/png', 0.9);
                        
                        if (dataURL.length < 100) {
                            throw new Error('Canvas vazio - tente novamente');
                        }
                        
                        resolve(dataURL);
                    } catch (error) {
                        reject(new Error('Erro ao capturar imagem: ' + error.message));
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    async sendToBackend(exportData) {
        const response = await fetch(config.export.pdfApiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(exportData)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Erro do servidor: ${response.status} - ${errorText}`);
        }

        return await response.blob();
    }

    downloadPDF(pdfBlob) {
        const url = URL.createObjectURL(pdfBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `mapa-georeferenciado-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.pdf`;
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Cleanup
        setTimeout(() => URL.revokeObjectURL(url), 100);
    }

    setExportStatus(isLoading, message = '') {
        const statusDiv = document.getElementById('export-status');
        const exportBtn = document.getElementById('export-pdf-btn');
        
        if (statusDiv && exportBtn) {
            if (isLoading) {
                statusDiv.style.display = 'flex';
                statusDiv.querySelector('span').textContent = message;
                exportBtn.disabled = true;
                exportBtn.style.opacity = '0.6';
            } else {
                statusDiv.style.display = 'none';
                exportBtn.disabled = false;
                exportBtn.style.opacity = '1';
            }
        }
    }
}