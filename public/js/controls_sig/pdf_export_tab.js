// Path: js\controls_sig\pdf_export_tab.js

import config from '../config.js';

export default class PDFExportTab {
    constructor(map) {
        this.map = map;
        this.orientation = 'landscape';
        this.scale = '1:25000'; // Escala padrão
        this.previewLayer = null;
        this.isVisible = false;

        // Margens e bounds duplos
        this.marginMM = 5; // 5mm de margem
        this.paperBounds = null; // Bounds do A4 completo
        this.usableBounds = null; // Bounds da área útil (com margens)

        // Escalas disponíveis
        this.availableScales = [
            { value: '1:1000', label: '1:1.000' },
            { value: '1:5000', label: '1:5.000' },
            { value: '1:10000', label: '1:10.000' },
            { value: '1:25000', label: '1:25.000' },
            { value: '1:50000', label: '1:50.000' },
            { value: '1:100000', label: '1:100.000' },
            { value: '1:250000', label: '1:250.000' },
            { value: '1:500000', label: '1:500.000' },
            { value: '1:1000000', label: '1:1.000.000' }
        ];

        // Bind methods
        this.onOrientationChange = this.onOrientationChange.bind(this);
        this.onScaleChange = this.onScaleChange.bind(this);
        this.onExportClick = this.onExportClick.bind(this);
        this.onMapMove = this.onMapMove.bind(this);
    }

    createUI() {
        const scaleOptions = this.availableScales.map(scale =>
            `<option value="${scale.value}" ${scale.value === this.scale ? 'selected' : ''}>${scale.label}</option>`
        ).join('');

        return `
            <div class="pdf-export-container">
                <div class="scale-selector">
                    <label for="pdf-scale-select" class="scale-label">Escala:</label>
                    <select id="pdf-scale-select" class="scale-select">
                        ${scaleOptions}
                    </select>
                </div>
                
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

        // Dar zoom para enquadrar o preview da escala padrão
        this.zoomToPreviewArea();

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
        // Combo de escala
        const scaleSelect = document.getElementById('pdf-scale-select');
        if (scaleSelect) {
            scaleSelect.addEventListener('change', this.onScaleChange);
        }

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
        const scaleSelect = document.getElementById('pdf-scale-select');
        if (scaleSelect) {
            scaleSelect.removeEventListener('change', this.onScaleChange);
        }

        const orientationInputs = document.querySelectorAll('input[name="pdf-orientation"]');
        orientationInputs.forEach(input => {
            input.removeEventListener('change', this.onOrientationChange);
        });

        const exportBtn = document.getElementById('export-pdf-btn');
        if (exportBtn) {
            exportBtn.removeEventListener('click', this.onExportClick);
        }
    }

    onScaleChange(event) {
        this.scale = event.target.value;
        this.updateBounds();
        // Dar zoom para enquadrar a nova escala
        this.zoomToPreviewArea();
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
                // Apenas atualizar bounds (recentrar preview), sem zoom automático
                this.updateBoundsOnly();
            }, 100);
        }
    }

    // Método para atualizar apenas os bounds sem zoom
    updateBoundsOnly() {
        // Nova lógica: usar escala em vez de viewport
        const bounds = this.calculateBoundsFromScale(this.scale, this.orientation);
        this.paperBounds = bounds.paper;
        this.usableBounds = bounds.usable;

        // Atualizar apenas os dados do source (sem zoom)
        const paperFeature = {
            type: 'Feature',
            properties: { type: 'paper', orientation: this.orientation, scale: this.scale },
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
            properties: { type: 'usable', orientation: this.orientation, scale: this.scale },
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

    // Nova lógica: calcular bounds baseado na escala cartográfica
    calculateBoundsFromScale(scale, orientation) {
        const center = this.map.getCenter();

        // Extrair denominador da escala (ex: "1:25000" → 25000)
        const denominator = parseInt(scale.split(':')[1]);

        // Dimensões do papel A4 em metros no terreno
        let realWidthMeters, realHeightMeters;

        if (orientation === 'landscape') {
            realWidthMeters = (297 / 1000) * denominator;  // 297mm → metros → terreno
            realHeightMeters = (210 / 1000) * denominator; // 210mm → metros → terreno
        } else {
            realWidthMeters = (210 / 1000) * denominator;  // 210mm → metros → terreno  
            realHeightMeters = (297 / 1000) * denominator; // 297mm → metros → terreno
        }

        // Conversão metros → graus (considerando distorção da latitude)
        const latCorrection = Math.cos(center.lat * Math.PI / 180);

        const heightDegrees = realHeightMeters / 111320;  // Latitude é constante
        const widthDegrees = realWidthMeters / (111320 * latCorrection);  // Longitude varia

        // Calcular offsets a partir do centro
        const offsetLat = heightDegrees / 2;
        const offsetLng = widthDegrees / 2;

        // Bounds do papel A4 completo
        const paper = {
            topLeft: [center.lng - offsetLng, center.lat + offsetLat],
            topRight: [center.lng + offsetLng, center.lat + offsetLat],
            bottomRight: [center.lng + offsetLng, center.lat - offsetLat],
            bottomLeft: [center.lng - offsetLng, center.lat - offsetLat]
        };

        // Calcular área útil (papel - margens)
        const marginDegrees = this.convertMMToMapUnitsFromScale(this.marginMM, scale);

        const usable = {
            topLeft: [paper.topLeft[0] + marginDegrees / latCorrection, paper.topLeft[1] - marginDegrees],
            topRight: [paper.topRight[0] - marginDegrees / latCorrection, paper.topRight[1] - marginDegrees],
            bottomRight: [paper.bottomRight[0] - marginDegrees / latCorrection, paper.bottomRight[1] + marginDegrees],
            bottomLeft: [paper.bottomLeft[0] + marginDegrees / latCorrection, paper.bottomLeft[1] + marginDegrees]
        };

        return { paper, usable };
    }

    // Converter margem em mm para graus baseado na escala
    convertMMToMapUnitsFromScale(marginMM, scale) {
        const denominator = parseInt(scale.split(':')[1]);
        const marginMeters = (marginMM / 1000) * denominator;
        return marginMeters / 111320; // Converter metros para graus
    }

    updateBounds() {
        // Nova lógica: usar escala em vez de viewport
        const bounds = this.calculateBoundsFromScale(this.scale, this.orientation);
        this.paperBounds = bounds.paper;
        this.usableBounds = bounds.usable;

        // Criar features para papel e área útil (mantém lógica original)
        const paperFeature = {
            type: 'Feature',
            properties: { type: 'paper', orientation: this.orientation, scale: this.scale },
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
            properties: { type: 'usable', orientation: this.orientation, scale: this.scale },
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

    // Dar zoom para enquadrar a área do preview
    zoomToPreviewArea() {
        if (!this.paperBounds) return;

        // Usar bounds do papel (não área útil) para dar margem visual
        const mapBounds = [
            this.paperBounds.bottomLeft,  // [lng_min, lat_min]
            this.paperBounds.topRight     // [lng_max, lat_max]
        ];

        // Aplicar zoom suave com padding para melhor visualização
        this.map.fitBounds(mapBounds, {
            padding: 50,  // 50px de padding ao redor do preview
            duration: 1000  // Animação de 1 segundo
        });
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

        let anyChanges = false;

        // Aplicar correções para cada source e verificar se houve mudanças
        zoomInvariantSources.forEach(sourceConfig => {
            const sourceHasChanges = this.correctSourceFeatures(hiddenMap, sourceConfig, finalZoom);
            if (sourceHasChanges) {
                anyChanges = true;
            }
        });

        return anyChanges; // Retorna true se pelo menos um source teve mudanças
    }

    correctSourceFeatures(hiddenMap, sourceConfig, finalZoom) {
        try {
            const source = hiddenMap.getSource(sourceConfig.sourceName);
            if (!source) {
                console.warn(`Source ${sourceConfig.sourceName} não encontrado no mapa oculto`);
                return false; // Retorna false se source não existe
            }

            const data = source._data;
            if (!data?.features?.length) return false; // Retorna false se não há features

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
            }

            return hasChanges; // Retorna se houve mudanças neste source

        } catch (error) {
            console.error(`Erro ao corrigir features do source ${sourceConfig.sourceName}:`, error);
            return false; // Retorna false em caso de erro
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
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 99999;
            backdrop-filter: blur(2px);
            font-family: Arial, sans-serif;
        `;

        modal.innerHTML = `
            <div style="text-align: center;">
                <div style="font-size: 24px; font-weight: 600; margin-bottom: 20px;">
                    Exportando mapa...
                </div>
                <div id="export-progress-text" style="font-size: 16px; margin-bottom: 15px; opacity: 0.9;">
                    Preparando...
                </div>
                <div style="width: 300px; height: 8px; background: rgba(255,255,255,0.3); border-radius: 4px; overflow: hidden;">
                    <div id="export-progress-bar" style="
                        height: 100%;
                        background: #B4E380;
                        width: 0%;
                        border-radius: 4px;
                        transition: width 0.3s ease;
                    "></div>
                </div>
                <div style="font-size: 12px; margin-top: 10px; opacity: 0.7;">
                    Isso pode levar alguns segundos...
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        return modal;
    }

    updateProgress(percent, text) {
        const progressBar = document.getElementById('export-progress-bar');
        const progressText = document.getElementById('export-progress-text');

        if (progressBar) {
            progressBar.style.width = percent + '%';
        }
        if (progressText) {
            progressText.textContent = text;
        }
    }

    // Calcular dimensões fixas A4 em pixels
    calculateA4PixelSize() {
        const targetDPI = 300; // DPI fixo para qualidade

        // Dimensões A4 em inches (sempre fixo!)
        let widthInches, heightInches;
        if (this.orientation === 'landscape') {
            widthInches = 11.7;  // 297mm
            heightInches = 8.3;  // 210mm  
        } else {
            widthInches = 8.3;   // 210mm
            heightInches = 11.7; // 297mm
        }

        return {
            width: Math.round(widthInches * targetDPI),
            height: Math.round(heightInches * targetDPI)
        };
    }





    async onExportClick() {
        let modal;
        let hiddenMapContainer;
        let hiddenMap;

        try {
            // 1. Mostrar modal de progresso
            modal = this.showExportModal();
            this.updateProgress(10, 'Inicializando...');
            await new Promise(resolve => setTimeout(resolve, 200));

            // 2. Calcular dimensões FIXAS A4 (não baseado na escala!)
            const canvasSize = this.calculateA4PixelSize(); // Sempre A4 fixo

            this.updateProgress(20, 'Preparando dados...');

            // 3. Criar container invisível com tamanho A4 fixo
            hiddenMapContainer = document.createElement('div');
            hiddenMapContainer.style.cssText = `
                position: absolute; top: -9999px; left: -9999px;
                width: ${canvasSize.width}px; height: ${canvasSize.height}px;
            `;
            document.body.appendChild(hiddenMapContainer);

            this.updateProgress(30, 'Criando mapa de exportação...');

            // 4. Criar mapa invisível
            hiddenMap = new maplibregl.Map({
                container: hiddenMapContainer,
                style: this.getCleanStyle(),
                center: this.map.getCenter(),
                zoom: this.map.getZoom(),
                preserveDrawingBuffer: true,
                interactive: false,
                fadeDuration: 0
            });

            this.updateProgress(40, 'Transferindo recursos...');

            // 5. Transferir imagens/ícones
            const loadedImages = this.map.listImages();
            const imagePromises = loadedImages.map(id => {
                return new Promise((resolve) => {
                    const image = this.map.getImage(id);
                    if (image) {
                        hiddenMap.addImage(id, image.data, { sdf: image.sdf });
                    }
                    resolve();
                });
            });
            await Promise.all(imagePromises);

            this.updateProgress(60, 'Enquadrando área...');

            // 6. Enquadrar APENAS a área útil (preview) no canvas A4 fixo
            const mapBounds = [this.usableBounds.bottomLeft, this.usableBounds.topRight];
            hiddenMap.fitBounds(mapBounds, { padding: 0, duration: 0 });

            // 7. Aguardar renderização
            await new Promise(resolve => hiddenMap.once('idle', resolve));

            this.updateProgress(70, 'Corrigindo elementos...');

            // 8. Corrigir zoom-invariant features
            const finalZoom = hiddenMap.getZoom();
            const hadChanges = this.correctZoomInvariantFeatures(hiddenMap, finalZoom);

            // 9. Aguardar renderização final
            if (hadChanges) {
                await new Promise(resolve => hiddenMap.once('idle', resolve));
            }

            this.updateProgress(80, 'Finalizando...');

            // 10. Capturar imagem
            const imageData = hiddenMap.getCanvas().toDataURL('image/png', 1.0);

            this.updateProgress(90, 'Gerando PDF...');

            // 11. Gerar PDF sempre A4
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

            // Adicionar imagem na área útil (com margens)
            pdf.addImage(imageData, 'PNG', this.marginMM, this.marginMM, usableWidthMM, usableHeightMM);

            this.updateProgress(100, 'Fazendo download...');

            // 12. Download
            const fileName = `mapa-${this.scale.replace(':', '-')}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.pdf`;
            pdf.save(fileName);

            // Pequena pausa antes de fechar
            setTimeout(() => {
                if (modal && modal.parentNode) {
                    document.body.removeChild(modal);
                }
            }, 800);

        } catch (error) {
            console.error('Erro ao exportar PDF:', error);
            alert('Não foi possível exportar o PDF: ' + error.message);
            if (modal && modal.parentNode) {
                document.body.removeChild(modal);
            }
        } finally {
            // Limpeza obrigatória
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