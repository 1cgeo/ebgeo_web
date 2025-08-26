// Path: js\controls_sig\pdf_export_tab.js

import config from '../config.js';

export default class PDFExportTab {
    constructor(map) {
        this.map = map;
        this.orientation = 'landscape';
        this.previewLayer = null;
        this.isVisible = false;

        // Margens e bounds duplos
        this.marginMM = 5; // 5mm de margem
        this.paperBounds = null; // Bounds do A4 completo
        this.usableBounds = null; // Bounds da área útil (com margens)

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
                        Paisagem (A4)
                    </label>
                    <label>
                        <input type="radio" name="pdf-orientation" value="portrait"> 
                        Retrato (A4)
                    </label>
                </div>
                
                <button id="export-pdf-btn" class="export-pdf-btn pure-material-button-contained">
                    Exportar PDF
                </button>
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

        // Camadas para papel A4 (fundo claro)
        if (!this.map.getLayer('pdf-export-preview-fill')) {
            this.map.addLayer({
                id: 'pdf-export-preview-fill',
                type: 'fill',
                source: 'pdf-export-preview',
                filter: ['==', 'type', 'paper'],
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
                filter: ['==', 'type', 'paper'],
                paint: {
                    'line-color': '#508D4E',
                    'line-width': 2,
                    'line-dasharray': [8, 4]
                }
            });
        }

        if (!this.map.getLayer('pdf-export-usable-stroke')) {
            this.map.addLayer({
                id: 'pdf-export-usable-stroke',
                type: 'line',
                source: 'pdf-export-preview',
                filter: ['==', 'type', 'usable'],
                paint: {
                    'line-color': '#508D4E',
                    'line-width': 2,
                    'line-dasharray': [1]
                }
            });
        }
    }

    hidePreview() {
        const layerIds = [
            'pdf-export-preview-fill', 'pdf-export-preview-stroke', // Papel
            'pdf-export-usable-stroke'    // Área útil
        ];

        layerIds.forEach(layerId => {
            if (this.map.getLayer(layerId)) {
                this.map.removeLayer(layerId);
            }
        });

        if (this.map.getSource('pdf-export-preview')) {
            this.map.removeSource('pdf-export-preview');
        }
    }

    // Converter margem em mm para unidades do mapa (graus)
    convertMMToMapUnits(marginMM) {
        const center = this.map.getCenter();
        const bounds = this.map.getBounds();

        // Calcular escala atual baseada na viewport
        const viewportHeight = bounds.getNorth() - bounds.getSouth();
        const mapHeightPixels = this.map.getCanvas().height;

        // Conversão aproximada: mm -> pixels -> graus
        const pixelsPerMM = 3.78; // ~96 DPI padrão
        const marginPixels = marginMM * pixelsPerMM;
        const degreesPerPixel = viewportHeight / mapHeightPixels;

        return marginPixels * degreesPerPixel;
    }

    // Calcular tanto papel A4 quanto área útil
    calculatePaperAndUsableBounds(orientation) {
        const center = this.map.getCenter();
        const bounds = this.map.getBounds();

        const viewportHeight = bounds.getNorth() - bounds.getSouth();
        const scaleFactor = 0.8;
        const baseHeight = viewportHeight * scaleFactor;
        const ratio = 297.0 / 210.0;
        const baseWidth = baseHeight / ratio;

        // Correção de latitude para papel
        const latCorrection = Math.cos(center.lat * Math.PI / 180);

        let paperOffsetLng, paperOffsetLat;

        if (orientation === 'portrait') {
            paperOffsetLat = baseHeight / 2;
            paperOffsetLng = (baseWidth / 2) / latCorrection;
        } else {
            paperOffsetLat = baseWidth / 2;
            paperOffsetLng = (baseHeight / 2) / latCorrection;
        }

        // Bounds do papel A4 completo
        const paper = {
            topLeft: [center.lng - paperOffsetLng, center.lat + paperOffsetLat],
            topRight: [center.lng + paperOffsetLng, center.lat + paperOffsetLat],
            bottomRight: [center.lng + paperOffsetLng, center.lat - paperOffsetLat],
            bottomLeft: [center.lng - paperOffsetLng, center.lat - paperOffsetLat]
        };

        // Calcular área útil (papel - margens)
        const marginDegrees = this.convertMMToMapUnits(this.marginMM);

        const usable = {
            topLeft: [paper.topLeft[0] + marginDegrees / latCorrection, paper.topLeft[1] - marginDegrees],
            topRight: [paper.topRight[0] - marginDegrees / latCorrection, paper.topRight[1] - marginDegrees],
            bottomRight: [paper.bottomRight[0] - marginDegrees / latCorrection, paper.bottomRight[1] + marginDegrees],
            bottomLeft: [paper.bottomLeft[0] + marginDegrees / latCorrection, paper.bottomLeft[1] + marginDegrees]
        };

        return { paper, usable };
    }

    updateBounds() {
        const bounds = this.calculatePaperAndUsableBounds(this.orientation);
        this.paperBounds = bounds.paper;
        this.usableBounds = bounds.usable;

        // Criar features para papel e área útil
        const paperFeature = {
            type: 'Feature',
            properties: { type: 'paper', orientation: this.orientation },
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    this.paperBounds.topLeft,
                    this.paperBounds.topRight,
                    this.paperBounds.bottomRight,
                    this.paperBounds.bottomLeft,
                    this.paperBounds.topLeft
                ]]
            }
        };

        const usableFeature = {
            type: 'Feature',
            properties: { type: 'usable', orientation: this.orientation },
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    this.usableBounds.topLeft,
                    this.usableBounds.topRight,
                    this.usableBounds.bottomRight,
                    this.usableBounds.bottomLeft,
                    this.usableBounds.topLeft
                ]]
            }
        };

        const source = this.map.getSource('pdf-export-preview');
        if (source) {
            source.setData({
                type: 'FeatureCollection',
                features: [paperFeature, usableFeature]
            });
        }
    }

    // Método para obter estilo limpo (sem camadas de preview)
    getCleanStyle() {
        try {
            const currentStyle = this.map.getStyle();
            
            // Verificar se o estilo existe
            if (!currentStyle) {
                throw new Error('Estilo do mapa não disponível');
            }
            
            const cleanStyle = JSON.parse(JSON.stringify(currentStyle));
            
            // Definir IDs das camadas de preview a serem removidas
            const previewLayerIds = [
                'pdf-export-preview-fill',
                'pdf-export-preview-stroke', 
                'pdf-export-usable-stroke'
            ];
            
            // Filtrar camadas removendo as de preview
            cleanStyle.layers = cleanStyle.layers.filter(layer => 
                !previewLayerIds.includes(layer.id)
            );
            
            // Remover source de preview
            if (cleanStyle.sources && cleanStyle.sources['pdf-export-preview']) {
                delete cleanStyle.sources['pdf-export-preview'];
            }
            
            return cleanStyle;
            
        } catch (error) {
            console.error('Erro ao criar estilo limpo:', error);
            // Fallback: retorna estilo original se der erro
            return this.map.getStyle();
        }
    }

    // Corrigir tamanhos zoom-invariant após mudança de zoom
    correctZoomInvariantFeatures(hiddenMap, finalZoom) {
        console.log(`Corrigindo zoom-invariant features para zoom final: ${finalZoom}`);
        
        // Definir tipos e suas propriedades de correção
        const zoomInvariantSources = [
            {
                sourceName: 'texts',
                property: 'calculatedSize',
                baseProperty: 'size',
                maxValue: 255
            },
            {
                sourceName: 'brushes',
                property: 'calculatedLineWidth', 
                baseProperty: 'lineWidth',
                maxValue: Infinity
            },
            {
                sourceName: 'images',
                property: 'calculatedSize',
                baseProperty: 'size', 
                maxValue: 10
            },
            {
                sourceName: 'military_symbols',
                property: 'calculatedSize',
                baseProperty: 'size',
                maxValue: 10
            }
        ];

        // Aplicar correções para cada source
        zoomInvariantSources.forEach(sourceConfig => {
            const source = hiddenMap.getSource(sourceConfig.sourceName);
            const featureCount = source?._data?.features?.length || 0;
            console.log(`Source ${sourceConfig.sourceName}: ${featureCount} features`);
            
            this.correctSourceFeatures(hiddenMap, sourceConfig, finalZoom);
        });
    }

    correctSourceFeatures(hiddenMap, sourceConfig, finalZoom) {
        try {
            const source = hiddenMap.getSource(sourceConfig.sourceName);
            if (!source) {
                console.warn(`Source ${sourceConfig.sourceName} não encontrado no mapa oculto`);
                return;
            }

            const data = source._data;
            if (!data?.features?.length) return;

            let hasChanges = false;

            data.features.forEach(feature => {
                // Validações robustas
                if (!feature?.properties) return;
                if (typeof feature.properties.createdAtZoom !== 'number') return;
                if (typeof feature.properties[sourceConfig.baseProperty] !== 'number') return;

                const zoomDifference = finalZoom - feature.properties.createdAtZoom;
                const scaleFactor = Math.pow(2, zoomDifference);
                const baseValue = feature.properties[sourceConfig.baseProperty];
                
                // Evitar valores inválidos
                if (baseValue <= 0) return;
                
                const newValue = Math.min(baseValue * scaleFactor, sourceConfig.maxValue);

                // Só atualizar se realmente mudou (evitar re-renders desnecessários)
                if (Math.abs(feature.properties[sourceConfig.property] - newValue) > 0.001) {
                    feature.properties[sourceConfig.property] = newValue;
                    hasChanges = true;
                }
            });

            if (hasChanges) {
                source.setData(data);
                console.log(`Corrigido ${sourceConfig.sourceName}: ${hasChanges ? 'atualizado' : 'sem mudanças'}`);
            }

        } catch (error) {
            console.error(`Erro ao corrigir features do source ${sourceConfig.sourceName}:`, error);
        }
    }

    showExportModal() {
        const modal = document.createElement('div');
        modal.id = 'export-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(80, 141, 78, 0.9);
            color: white;
            font-size: 24px;
            font-weight: 600;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 99999;
            backdrop-filter: blur(2px);
        `;
        modal.innerHTML = 'Exportando mapa...';
        document.body.appendChild(modal);
        return modal;
    }

    calculatePreviewPixelBounds() {
        // Usar bounds da área útil para export
        const topLeft = this.map.project([this.usableBounds.topLeft[0], this.usableBounds.topLeft[1]]);
        const bottomRight = this.map.project([this.usableBounds.bottomRight[0], this.usableBounds.bottomRight[1]]);

        return {
            x: Math.round(topLeft.x),
            y: Math.round(topLeft.y),
            width: Math.round(bottomRight.x - topLeft.x),
            height: Math.round(bottomRight.y - topLeft.y)
        };
    }

    cropCanvasArea(sourceCanvas, cropArea) {
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = cropArea.width;
        cropCanvas.height = cropArea.height;

        const ctx = cropCanvas.getContext('2d');
        // Desenha a porção recortada do canvas de origem no novo canvas
        ctx.drawImage(
            sourceCanvas,
            cropArea.x, cropArea.y, cropArea.width, cropArea.height,  // source (de onde cortar)
            0, 0, cropArea.width, cropArea.height                     // destination (onde desenhar)
        );

        return cropCanvas;
    }

    scaleCanvas(sourceCanvas, scaleFactor) {
        const scaledCanvas = document.createElement('canvas');
        scaledCanvas.width = sourceCanvas.width * scaleFactor;
        scaledCanvas.height = sourceCanvas.height * scaleFactor;

        const ctx = scaledCanvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(sourceCanvas, 0, 0, scaledCanvas.width, scaledCanvas.height);

        return scaledCanvas;
    }

    async capturePreviewArea() {
        // Método baseado no screenshot_control.js
        return new Promise((resolve, reject) => {
            try {
                // Garantir que o mapa esteja completamente renderizado
                if (this.map.loaded()) {
                    this.captureMapCanvas(resolve, reject);
                } else {
                    // Se o mapa não estiver carregado, aguardar o evento idle
                    this.map.once('idle', () => {
                        this.captureMapCanvas(resolve, reject);
                    });
                }
            } catch (error) {
                reject(error);
            }
        });
    }

    captureMapCanvas(resolve, reject) {
        // Forçar uma renderização completa (igual screenshot_control)
        this.map.triggerRepaint();

        // Usar requestAnimationFrame para garantir que a renderização foi concluída
        requestAnimationFrame(() => {
            try {
                const canvas = this.map.getCanvas();

                // Calcular área do preview em pixels (área útil)
                const previewPixels = this.calculatePreviewPixelBounds();

                // Verificar se as coordenadas são válidas
                if (previewPixels.width <= 0 || previewPixels.height <= 0) {
                    reject(new Error('Área de preview inválida'));
                    return;
                }

                // Crop da área específica
                const croppedCanvas = this.cropCanvasArea(canvas, previewPixels);

                const baseDPI = 96 * window.devicePixelRatio; // DPI atual da tela
                const targetDPI = 300; // DPI desejado
                const scaleFactor = targetDPI / baseDPI;
                const highResCanvas = this.scaleCanvas(croppedCanvas, scaleFactor);

                // Método 1: Tentar dataURL direto (igual screenshot_control)
                try {
                    const dataURL = highResCanvas.toDataURL('image/png', 1.0);
                    resolve(dataURL);
                } catch (securityError) {
                    console.warn('Erro de segurança com dataURL');
                    reject(securityError);
                }

            } catch (error) {
                console.error('Erro ao processar canvas:', error);
                reject(error);
            }
        });
    }

    async captureHighResArea() {
        // --- 1. Definir Parâmetros de Qualidade ---
        const targetDPI = 200; // Qualidade de impressão padrão
        const screenDPI = 96; // DPI padrão de tela
        const scaleFactor = targetDPI / screenDPI;

        const mapContainer = this.map.getContainer();
        const originalWidth = mapContainer.clientWidth;
        const originalHeight = mapContainer.clientHeight;

        // --- 2. Calcular a área de recorte na resolução da tela ---
        // Usar área útil em vez de área completa
        const screenCropArea = this.calculatePreviewPixelBounds();
        if (screenCropArea.width <= 0 || screenCropArea.height <= 0) {
            throw new Error('A área de pré-visualização para exportação é inválida.');
        }

        // --- 3. Calcular as novas dimensões gigantes para o mapa ---
        const highResWidth = Math.round(originalWidth * scaleFactor);
        const highResHeight = Math.round(originalHeight * scaleFactor);

        // --- 4. Redimensionar o mapa e esperar a renderização ---
        try {
            // Aplicar o novo tamanho ao container do mapa
            mapContainer.style.width = `${highResWidth}px`;
            mapContainer.style.height = `${highResHeight}px`;
            this.map.resize();

            // Aguardar o evento 'idle' que confirma que o mapa foi redesenhado nos detalhes da nova resolução
            await new Promise(resolve => this.map.once('idle', resolve));

            // --- 5. Capturar a imagem do canvas em alta resolução ---
            const highResCanvas = this.map.getCanvas();

            // Calcular as coordenadas de recorte no novo canvas gigante
            const highResCropArea = {
                x: Math.round(screenCropArea.x * scaleFactor),
                y: Math.round(screenCropArea.y * scaleFactor),
                width: Math.round(screenCropArea.width * scaleFactor),
                height: Math.round(screenCropArea.height * scaleFactor)
            };

            // Recortar a área desejada do canvas gigante
            const croppedCanvas = this.cropCanvasArea(highResCanvas, highResCropArea);

            // Converter para DataURL com qualidade máxima
            return croppedCanvas.toDataURL('image/png', 1.0);

        } finally {
            // --- 6. (MUITO IMPORTANTE) Restaurar o tamanho original do mapa ---
            // O bloco 'finally' garante que isso aconteça mesmo se ocorrer um erro.
            mapContainer.style.width = `${originalWidth}px`;
            mapContainer.style.height = `${originalHeight}px`;
            this.map.resize();
        }
    }

    async onExportClick() {
        let modal;
        let hiddenMapContainer;
        let hiddenMap;

        try {
            // 1. Mostrar modal de carregamento
            modal = this.showExportModal();
            await new Promise(resolve => setTimeout(resolve, 100));

            // 2. Definir parâmetros de alta resolução baseados na área útil
            const targetDPI = 300;

            // Calcular dimensões da área útil (A4 - margens)
            const pageWidthInches = this.orientation === 'landscape' ? 11.7 : 8.3;
            const pageHeightInches = this.orientation === 'landscape' ? 8.3 : 11.7;
            const marginInches = this.marginMM / 25.4; // mm para inches

            const usableWidthInches = pageWidthInches - (2 * marginInches);
            const usableHeightInches = pageHeightInches - (2 * marginInches);

            const targetWidthPixels = Math.round(usableWidthInches * targetDPI);
            const targetHeightPixels = Math.round(usableHeightInches * targetDPI);

            // 3. Criar o container invisível
            hiddenMapContainer = document.createElement('div');
            hiddenMapContainer.style.cssText = `
                position: absolute; top: -9999px; left: -9999px;
                width: ${targetWidthPixels}px; height: ${targetHeightPixels}px;
            `;
            document.body.appendChild(hiddenMapContainer);

            hiddenMap = new maplibregl.Map({
                container: hiddenMapContainer,
                style: this.getCleanStyle(), // Usar estilo sem camadas de preview
                center: this.map.getCenter(),
                zoom: this.map.getZoom(),
                preserveDrawingBuffer: true,
                interactive: false,
                fadeDuration: 0
            });

            // 5. Transferir todas as imagens/ícones
            const loadedImages = this.map.listImages();

            const imagePromises = loadedImages.map(id => {
                return new Promise((resolve, reject) => {
                    const image = this.map.getImage(id);
                    if (image) {
                        hiddenMap.addImage(id, image.data, { sdf: image.sdf });
                        resolve();
                    } else {
                        console.warn(`Imagem com ID "${id}" não encontrada no mapa principal.`);
                        resolve();
                    }
                });
            });

            await Promise.all(imagePromises);

            // 6. Enquadrar o mapa na área útil (não na área completa do papel)
            const mapBounds = [this.usableBounds.bottomLeft, this.usableBounds.topRight];
            hiddenMap.fitBounds(mapBounds, { padding: 0, duration: 0 });

            // 7. Aguardar o mapa invisível renderizar TUDO
            await new Promise(resolve => hiddenMap.once('idle', resolve));

            // 6.1. Corrigir tamanhos zoom-invariant após mudança de zoom
            const finalZoom = hiddenMap.getZoom();
            this.correctZoomInvariantFeatures(hiddenMap, finalZoom);

            // 7. Aguardar o mapa invisível renderizar TUDO
            await new Promise(resolve => hiddenMap.once('idle', resolve));

            // 8. Capturar a imagem do canvas em alta resolução
            const imageData = hiddenMap.getCanvas().toDataURL('image/png', 1.0);

            // 9. Gerar o PDF com margens
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF({
                orientation: this.orientation === 'landscape' ? 'l' : 'p',
                unit: 'mm',
                format: 'a4'
            });

            const pageWidthMM = this.orientation === 'landscape' ? 297 : 210;
            const pageHeightMM = this.orientation === 'landscape' ? 210 : 297;
            const usableWidthMM = pageWidthMM - (2 * this.marginMM);
            const usableHeightMM = pageHeightMM - (2 * this.marginMM);

            // Adicionar imagem na posição com margem
            pdf.addImage(imageData, 'PNG', this.marginMM, this.marginMM, usableWidthMM, usableHeightMM);

            // 10. Download
            const fileName = `mapa-completo-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.pdf`;
            pdf.save(fileName);

        } catch (error) {
            console.error('Erro ao exportar PDF com margens:', error);
            alert('Não foi possível exportar o PDF: ' + error.message);
        } finally {
            // 11. Limpeza final
            if (modal && modal.parentNode) {
                document.body.removeChild(modal);
            }
            if (hiddenMap) {
                hiddenMap.remove();
            }
            if (hiddenMapContainer && hiddenMapContainer.parentNode) {
                document.body.removeChild(hiddenMapContainer);
            }
        }
    }

    // ========== MÉTODOS PRESERVADOS PARA FUTURA IMPLEMENTAÇÃO GEOREFERENCIADA ==========

    /**
     * Métodos abaixo preservados para quando implementar PDF georeferenciado com backend
     */

    async captureMapImageGeo() {
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

    setExportStatusGeo(isLoading, message = '') {
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

    /**
     * Métodos abaixo preservados para quando implementar PDF georeferenciado com backend
     */

    async sendToBackendGeo(exportData) {
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

    downloadPDFGeo(pdfBlob) {
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
}