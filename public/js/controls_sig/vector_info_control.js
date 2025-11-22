// Path: js\controls_sig\vector_info_control.js
import config from '../config.js';

class VectorTileInfoControl {
    constructor(toolManager, uiManager) {
        this.toolManager = toolManager;
        this.uiManager = uiManager;
        this.isActive = false;
        this.map = null;
        this.handleMapClickBound = this.handleMapClick.bind(this);
        this.contextMenu = null;
        this.pendingVectorTileFeatures = null;
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Fechar menu com ESC
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.contextMenu) {
                this._hideVectorTileSelectionMenu();
            }
        });
    }

    onAdd(map) {
        this.map = map;
        this.container = document.createElement('div');
        this.container.className = 'mapboxgl-ctrl-group mapboxgl-ctrl vector-info-control controls-column-left';

        const button = document.createElement('button');
        button.className = 'mapbox-gl-draw_ctrl-draw-btn';
        button.setAttribute("id", "vector-tile-info-tool");
        button.innerHTML = '<img class="icon-sig-tool" src="./images/icon_info_black.svg" alt="INFO" />';
        button.title = 'Informação da carta (N)';
        button.onclick = () => this.toolManager.setActiveTool(this);

        this.container.appendChild(button);

        const isEnabled = config.features?.vector_info ?? true;
        if (!isEnabled) {
            this.container.classList.add('disabled');
            button.disabled = true;
        }

        this.changeButtonColor()

        return this.container;
    }

    changeButtonColor = () => {
        const isEnabled = config.features?.vector_info ?? true;

        if (!isEnabled) {
            // Use setTimeout para garantir que DOM está pronto
            setTimeout(() => {
                $("#vector-tile-info-tool").html('<img class="icon-sig-tool" src="./images/icon_info_gray.svg" alt="INFO" />');
            }, 10);
            return;
        }

        $("#vector-tile-info-tool").html(`<img class="icon-sig-tool" src="./images/icon_info_black.svg" alt="INFO" />`);
        if (!this.isActive) return
        $("#vector-tile-info-tool").html('<img class="icon-sig-tool" src="./images/icon_info_red.svg" alt="INFO" />');
    }

    onRemove() {
        // Remover menu se estiver aberto
        this._hideVectorTileSelectionMenu();
        
        // Remove event listener if still active
        if (this.isActive && this.map) {
            this.map.off('click', this.handleMapClickBound);
        }

        this.container.parentNode.removeChild(this.container);
        this.map = undefined;
    }

    activate() {
        const isEnabled = config.features?.vector_info ?? true;
        if (!isEnabled) {
            return false;
        }

        this.isActive = true;
        this.map.getCanvas().style.cursor = 'help';

        // Add click event listener to map
        this.map.on('click', this.handleMapClickBound);

        // Fechar menu ao mover/dar zoom no mapa
        this.map.on('movestart', () => {
            if (this.contextMenu) {
                this._hideVectorTileSelectionMenu();
            }
        });
        this.map.on('zoomstart', () => {
            if (this.contextMenu) {
                this._hideVectorTileSelectionMenu();
            }
        });

        this.changeButtonColor()
    }

    deactivate() {
        this.isActive = false;
        this.map.getCanvas().style.cursor = '';

        // Remove click event listener from map
        this.map.off('click', this.handleMapClickBound);

        this.changeButtonColor()
        this.uiManager.saveChangesAndClosePanel();
    }

    handleMapClick(e) {
        if (this.isActive) {
            const features = this.map.queryRenderedFeatures(e.point);
            // filtrar para pegar apenas vector tiles, não pegar desenhos, nem grid, nem streetview, nem rotulo dos produtos
            const vectorTileFeatures = features.filter(f => f.sourceLayer && !f.properties.source && !f.sourceLayer.startsWith('grid') && !f.sourceLayer.startsWith('situacao_ponto') && !f.sourceLayer.startsWith('fotos'));
            if (vectorTileFeatures.length > 0) {
                const preferenceOrder = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'];

                vectorTileFeatures.sort((a, b) => {
                    const aPriority = a.sourceLayer.startsWith('cobter_') ? 6 : preferenceOrder.indexOf(a.geometry.type);
                    const bPriority = b.sourceLayer.startsWith('cobter_') ? 6 : preferenceOrder.indexOf(b.geometry.type);

                    return aPriority - bPriority;
                });

                if (vectorTileFeatures.length === 1) {
                    // Única feature: exibir direto
                    this.uiManager.showVectorTileInfoPanel(vectorTileFeatures[0]);
                } else {
                    // Múltiplas features: mostrar menu
                    this._showVectorTileSelectionMenu(vectorTileFeatures, e);
                }
            } else {
                this.uiManager.saveChangesAndClosePanel();
                this._hideVectorTileSelectionMenu();
            }
        }
    }

    /**
     * Mostra menu de seleção de vector tiles
     */
    _showVectorTileSelectionMenu(features, e) {
        // Fechar menu anterior se existir
        this._hideVectorTileSelectionMenu();
        
        if (features.length === 0) return;
        
        // Armazenar features pendentes
        this.pendingVectorTileFeatures = features;
        
        // Criar e exibir menu
        this.contextMenu = this._createContextMenuElement(features, e);
        document.body.appendChild(this.contextMenu);
    }

    /**
     * Criar elemento HTML do menu de contexto
     */
    _createContextMenuElement(features, e) {
        const menu = document.createElement('div');
        menu.className = 'vector-tile-selection-menu';
        
        // Estilos (idênticos ao SelectionManager)
        menu.style.cssText = `
            position: fixed !important;
            background: white !important;
            border: 1px solid #ccc !important;
            border-radius: 6px !important;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15) !important;
            z-index: 999999 !important;
            min-width: 200px !important;
            max-height: 300px !important;
            overflow-y: auto !important;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
            font-size: 14px !important;
            line-height: 1.4 !important;
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
            pointer-events: auto !important;
        `;
        
        // Posicionar próximo ao clique
        const x = Math.min(e.originalEvent.clientX, window.innerWidth - 220);
        const y = Math.min(e.originalEvent.clientY, window.innerHeight - 50);
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
        
        // Header
        const header = document.createElement('div');
        header.textContent = `Selecionar camada (${features.length})`;
        header.style.cssText = `
            padding: 8px 12px !important;
            background: #f5f5f5 !important;
            color: #666 !important;
            border-bottom: 1px solid #ddd !important;
            font-weight: bold !important;
            font-size: 12px !important;
            margin: 0 !important;
        `;
        menu.appendChild(header);
        
        // Item para cada feature
        features.forEach((feature, index) => {
            const item = document.createElement('div');
            const featureName = this._getVectorTileFeatureName(feature);
            item.textContent = featureName;
            
            item.style.cssText = `
                padding: 10px 12px !important;
                cursor: pointer !important;
                border-bottom: ${index < features.length - 1 ? '1px solid #eee' : 'none'} !important;
                transition: background-color 0.2s !important;
                background: white !important;
                color: black !important;
                font-size: 14px !important;
                margin: 0 !important;
            `;
            
            // Hover effects
            item.addEventListener('mouseenter', () => {
                item.style.backgroundColor = '#f0f8ff !important';
            });
            item.addEventListener('mouseleave', () => {
                item.style.backgroundColor = 'white !important';
            });
            
            // Click handler
            item.addEventListener('click', (evt) => {
                evt.stopPropagation();
                this.uiManager.showVectorTileInfoPanel(feature);
                this._hideVectorTileSelectionMenu();
            });
            
            menu.appendChild(item);
        });
        
        return menu;
    }

    /**
     * Obter nome de exibição da vector tile (sourceLayer)
     */
    _getVectorTileFeatureName(feature) {
        return feature.sourceLayer || 'Camada desconhecida';
    }

    /**
     * Esconder menu de seleção
     */
    _hideVectorTileSelectionMenu() {
        if (this.contextMenu) {
            this.contextMenu.remove();
            this.contextMenu = null;
            this.pendingVectorTileFeatures = null;
        }
    }
}

export default VectorTileInfoControl;