// Path: js\controls_sig\features_tab.js
import {
  updateFeatureProperty,
  getFeatureById,
  getMapHillshadeState,
  setMapHillshadeState,
  getMapAnalysisLayersStates,
  getFeatureDisplayNameFromStorage,
  getFeatureIconFromStorage,
  getAllStorageTypes,
  getMapGroups,
  getFeatureGroup,
  updateGroupProperty,
  getCurrentMapNameSync,
  getStorageTypeFromSource,
  // LAYER SYSTEM IMPORTS
  getLayers,
  getActiveLayerIdSync,
  setActiveLayer,
  setLayerVisibility,
  setLayerLocked,
  createLayer,
  deleteLayer,
  renameLayer,
  reorderLayers,
} from "./store/store.js";
import { FeatureNavigationUtils } from "./utilities/feature_navigation_utils.js";
import config from "../config.js";

class FeaturesTab {
  constructor(map, selectionManager = null, analysisLayersManager) {
    this.map = map;
    this.selectionManager = selectionManager;
    this.container = null;

    this.analysisLayersManager = analysisLayersManager;

    this._sourceDataHandler = null;
    this._groupsChangedHandler = null;
    this._layersChangedHandler = null; // NEW: Layer system handler
    this._debounceTimer = null;
    this._isVisible = false;
    
    // Flag para suprimir refresh durante atualizações internas
    this._suppressRefresh = false;
    // Flag para suprimir eventos layers-changed emitidos internamente
    this._suppressLayersChangedRefresh = false;
    // Cache do último estado para detectar mudanças estruturais
    this._lastFeatureCount = null;
    this._lastLayerIds = null;
    
    // Instância do Sortable para reordenação de camadas
    this._sortableInstance = null;

    this.INLINE_ICONS = {
      EYE_VISIBLE: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
            </svg>`,
      EYE_HIDDEN: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>`,
      LOCK_LOCKED: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <circle cx="12" cy="16" r="1"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>`,
      LOCK_UNLOCKED: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <circle cx="12" cy="16" r="1"/>
                <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
            </svg>`,
      ZOOM: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="6"></circle>
            <path d="m21 21-4.35-4.35"></path>
            </svg>`,
      GROUP: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>`,
      EXPAND: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9"/>
            </svg>`,
      COLLAPSE: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="18 15 12 9 6 15"/>
            </svg>`,
      // NEW: Layer system icons
      LAYER: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="12 2 2 7 12 12 22 7 12 2"/>
                <polyline points="2 17 12 22 22 17"/>
                <polyline points="2 12 12 17 22 12"/>
            </svg>`,
      ADD: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>`,
      DELETE: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>`,
      DRAG: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="4" y1="8" x2="20" y2="8"/>
                <line x1="4" y1="16" x2="20" y2="16"/>
            </svg>`,
    };
  }

  createUI() {
    this.container = document.createElement("div");
    this.container.className = "features-tab-content";
    this.container.style.display = "none";

    // Criar hillshade control apenas se habilitado no config
    const hillshadeContainer = this.createHillshadeControl();
    if (hillshadeContainer) {
      this.container.appendChild(hillshadeContainer);
    }

    // Analysis Layers Control
    const analysisLayersContainer = this.createAnalysisLayersControl();
    this.container.appendChild(analysisLayersContainer);

    // Header com botão de adicionar camada
    const header = this.createHeader();
    this.container.appendChild(header);

    const featuresList = document.createElement("div");
    featuresList.className = "features-list";
    this.container.appendChild(featuresList);

    // Adicionar estilos CSS para analysis layers
    this.addAnalysisLayersStyles();

    // Adicionar estilos CSS para grupos
    this.addGroupStyles();

    // Adicionar estilos CSS para layers integrados
    this.addLayerStyles();

    return this.container;
  }

  // ============================================================
  // NEW: LAYER SYSTEM METHODS
  // ============================================================

  /**
   * Adiciona nova camada
   */
  async handleAddLayer() {
    const name = prompt('Nome da nova camada:', 'Nova Camada');
    if (!name || !name.trim()) return;

    try {
      const newLayer = await createLayer(name.trim());
      await setActiveLayer(newLayer.id);
      await this.loadFeatures();
      this.emitLayersChanged();
    } catch (error) {
      console.error('Erro ao criar camada:', error);
      alert('Erro ao criar camada: ' + error.message);
    }
  }

  /**
   * Define camada ativa - atualiza apenas indicadores visuais sem reconstruir a lista
   */
  async handleSetActiveLayer(layerId) {
    try {
      const layers = await getLayers();
      const layer = layers.find(l => l.id === layerId);
      
      if (layer && layer.locked) {
        console.warn('Nao e possivel ativar uma camada bloqueada');
        return;
      }
      
      const previousActiveId = getActiveLayerIdSync();
      await setActiveLayer(layerId);
      
      // Atualização incremental: apenas atualizar indicadores visuais
      this._updateActiveLayerIndicators(previousActiveId, layerId);
    } catch (error) {
      console.error('Erro ao definir camada ativa:', error);
    }
  }

  /**
   * Toggle visibilidade da camada
   */
  async handleToggleLayerVisibility(layerId) {
    try {
      const layers = await getLayers();
      const layer = layers.find(l => l.id === layerId);
      if (!layer) return;

      const newVisibility = !layer.visible;
      await setLayerVisibility(layerId, newVisibility);
      
      // Atualização incremental: apenas atualizar indicadores visuais da layer
      this._updateLayerVisibilityIndicator(layerId, newVisibility);
      
      // Emitir evento mas suprimir nosso próprio refresh
      this._suppressLayersChangedRefresh = true;
      this.emitLayersChanged();
      setTimeout(() => { this._suppressLayersChangedRefresh = false; }, 50);
    } catch (error) {
      console.error('Erro ao alterar visibilidade:', error);
    }
  }

  /**
   * Toggle bloqueio da camada
   */
  async handleToggleLayerLock(layerId) {
    try {
      const layers = await getLayers();
      const layer = layers.find(l => l.id === layerId);
      if (!layer) return;

      const newLockState = !layer.locked;
      await setLayerLocked(layerId, newLockState);
      
      // Atualização incremental: apenas atualizar indicadores visuais da layer
      this._updateLayerLockIndicator(layerId, newLockState);
      
      // Emitir evento mas suprimir nosso próprio refresh
      this._suppressLayersChangedRefresh = true;
      this.emitLayersChanged();
      setTimeout(() => { this._suppressLayersChangedRefresh = false; }, 50);
    } catch (error) {
      console.error('Erro ao alterar bloqueio:', error);
    }
  }

  /**
   * Deleta camada e todas as suas features
   */
  async handleDeleteLayer(layerId) {
    const layers = await getLayers();
    
    // Regra: deve existir sempre pelo menos uma camada
    if (layers.length <= 1) {
      alert('Não é possível excluir a única camada existente.');
      return;
    }

    const layer = layers.find(l => l.id === layerId);
    if (!layer) return;

    const confirmed = confirm(`Excluir a camada "${layer.name}"?\n\n⚠️ ATENÇÃO: Todas as feições desta camada serão PERMANENTEMENTE excluídas!`);
    if (!confirmed) return;

    try {
      await deleteLayer(layerId);
      // Sincronizar sources do MapLibre com o IndexedDB
      await this._syncMapSourcesAfterDelete(layerId);
      await this.loadFeatures();
      this.emitLayersChanged();
    } catch (error) {
      console.error('Erro ao excluir camada:', error);
      alert('Erro ao excluir camada: ' + error.message);
    }
  }

  /**
   * Sincroniza as sources do MapLibre após deletar features de uma camada
   * Remove features que pertencem à camada deletada de todas as sources
   */
  async _syncMapSourcesAfterDelete(deletedLayerId) {
    for (const sourceId of this.FEATURE_SOURCES) {
      const source = this.map.getSource(sourceId);
      if (!source) continue;
      
      try {
        const data = await source.getData();
        if (data && data.features && data.features.length > 0) {
          const initialCount = data.features.length;
          // Filtrar removendo features da camada deletada
          data.features = data.features.filter(f => {
            const featureLayerId = f.properties?.layerId || 'default';
            return featureLayerId !== deletedLayerId;
          });
          
          // Só atualizar se houve mudança
          if (data.features.length !== initialCount) {
            source.setData(data);
          }
        }
      } catch (error) {
        console.debug(`Erro ao sincronizar source ${sourceId}:`, error.message);
      }
    }
  }

  /**
   * Renomeia uma camada
   */
  async handleRenameLayer(layerId, newName) {
    if (!newName || !newName.trim()) {
      throw new Error('Nome da camada não pode ser vazio');
    }

    await renameLayer(layerId, newName.trim());
    await this.loadFeatures();
  }

  /**
   * Emite evento de mudanÃ§a nas layers
   */
  emitLayersChanged() {
    document.dispatchEvent(new CustomEvent('layers-changed'));
  }

  /**
   * Adiciona estilos CSS para o sistema de layers integrado
   */
  addLayerStyles() {
    if (document.getElementById('layer-styles')) return;

    const style = document.createElement('style');
    style.id = 'layer-styles';
    style.textContent = `
      /* Botão adicionar camada no header */
      .layer-add-btn {
        background: none;
        border: 1px solid #ccc;
        border-radius: 3px;
        cursor: pointer;
        padding: 2px 6px;
        color: #666;
        display: flex;
        align-items: center;
        transition: all 0.2s;
      }
      
      .layer-add-btn:hover {
        background-color: #e9ecef;
        border-color: #007bff;
        color: #007bff;
      }
      
      /* Container de cada layer na lista */
      .layer-container {
        margin-bottom: 2px;
        border: 1px solid #e0e0e0;
        border-radius: 4px;
        overflow: hidden;
        background-color: #fff;
      }
      
      .layer-container.layer-active {
        border-color: #28a745;
        border-left: 3px solid #28a745;
      }
      
      .layer-container.layer-hidden {
        opacity: 0.6;
      }
      
      .layer-container.layer-locked {
        background-color: #fffbf0;
      }
      
      /* Header da layer */
      .layer-header {
        display: flex;
        align-items: center;
        padding: 6px 8px;
        background-color: #f5f5f5;
        cursor: pointer;
        user-select: none;
        gap: 4px;
      }
      
      .layer-header:hover {
        background-color: #e9ecef;
      }
      
      .layer-header.active {
        background-color: #d4edda;
      }
      
      .layer-radio {
        margin: 0;
        cursor: pointer;
      }
      
      .layer-expand-icon {
        color: #666;
        display: flex;
        align-items: center;
        transition: transform 0.2s ease;
      }
      
      .layer-expand-icon.collapsed {
        transform: rotate(-90deg);
      }
      
      .layer-icon {
        color: #666;
        display: flex;
        align-items: center;
      }
      
      .layer-name {
        flex: 1;
        font-size: 13px;
        font-weight: 500;
        color: #333;
        cursor: pointer;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      
      .layer-count {
        font-size: 11px;
        color: #666;
        background-color: #e9ecef;
        padding: 1px 6px;
        border-radius: 10px;
        margin-right: 4px;
      }
      
      .layer-controls {
        display: flex;
        align-items: center;
        gap: 2px;
      }
      
      .layer-controls button {
        background: none;
        border: none;
        cursor: pointer;
        padding: 3px;
        border-radius: 3px;
        color: #666;
        display: flex;
        align-items: center;
        transition: all 0.2s;
      }
      
      .layer-controls button:hover:not(:disabled) {
        background-color: #fff;
        color: #007bff;
      }
      
      .layer-controls button:disabled {
        cursor: not-allowed;
        opacity: 0.3;
      }
      
      .layer-delete-btn:hover:not(:disabled) {
        color: #dc3545 !important;
      }
      
      /* Conteúdo da layer (features e grupos) */
      .layer-content {
        padding: 4px 4px 4px 16px;
        background-color: #fff;
      }
      
      .layer-content.collapsed {
        display: none;
      }
      
      /* Indicador de grupo split (cross-layer) */
      .group-split-indicator {
        color: #fd7e14;
        font-style: italic;
      }
      
      /* Drag handle para reordenação de camadas */
      .layer-drag-handle {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        cursor: grab;
        color: #999;
        user-select: none;
        flex-shrink: 0;
        transition: color 0.2s ease;
        padding: 0 2px;
      }
      
      .layer-drag-handle:hover {
        color: #007bff;
      }
      
      .layer-drag-handle:active {
        cursor: grabbing;
      }
      
      /* Estados do Sortable para layers */
      .layer-sortable-ghost {
        opacity: 0.4;
        background-color: rgba(0, 123, 255, 0.1) !important;
      }
      
      .layer-sortable-chosen {
        background-color: rgba(0, 123, 255, 0.15) !important;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15) !important;
      }
      
      .layer-sortable-drag {
        opacity: 1 !important;
        background-color: white !important;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2) !important;
      }
    `;
    document.head.appendChild(style);
  }

  // ============================================================
  // END OF LAYER SYSTEM METHODS
  // ============================================================

  /**
   * Adiciona estilos CSS específicos para grupos
   */
  addGroupStyles() {
    if (!document.getElementById("group-styles")) {
      const style = document.createElement("style");
      style.id = "group-styles";
      style.textContent = `
                .group-container {
                    border: 1px solid #e0e0e0;
                    border-radius: 4px;
                    background-color: #f8f9fa;
                    overflow: hidden;
                }
                
                .group-header {
                    display: flex;
                    align-items: center;
                    padding: 8px 12px;
                    background-color: #f0f0f0;
                    border-bottom: 1px solid #e0e0e0;
                    cursor: pointer;
                    user-select: none;
                }
                
                .group-header:hover {
                    background-color: #e9ecef;
                }
                
                .group-header.group-hidden {
                    opacity: 0.6;
                }
                
                .group-header.group-locked {
                    background-color: #ffeaa7;
                }
                
                .group-expand-icon {
                    margin-right: 8px;
                    color: #666;
                    transition: transform 0.2s ease;
                }
                
                .group-expand-icon.expanded {
                    transform: rotate(0deg);
                }
                
                .group-expand-icon.collapsed {
                    transform: rotate(-90deg);
                }
                
                .group-icon {
                    margin-right: 8px;
                    color: #007bff;
                }
                
                .group-name {
                    flex: 1;
                    font-weight: 500;
                    font-size: 14px;
                    color: #333;
                }
                
                .group-count {
                    margin-left: 8px;
                    font-size: 12px;
                    color: #666;
                    background-color: #e9ecef;
                    padding: 2px 6px;
                    border-radius: 10px;
                }
                
                .group-controls {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    margin-left: 8px;
                }
                
                .group-controls button {
                    background: none;
                    border: none;
                    cursor: pointer;
                    padding: 4px;
                    border-radius: 3px;
                    color: #666;
                    transition: all 0.2s ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .group-controls button:hover {
                    background-color: #ffffff;
                    color: #007bff;
                }
                
                .group-controls .lock-toggle svg {
                    color: #dc3545;
                }
                
                .group-features-list {
                    max-height: 0;
                    overflow: hidden;
                    transition: max-height 0.3s ease;
                    background-color: #ffffff;
                }
                
                .group-features-list.expanded {
                    max-height: 500px;
                }
                
                .group-feature-item {
                    display: flex;
                    align-items: center;
                    padding: 6px 12px 6px 32px;
                    border-bottom: 1px solid #f0f0f0;
                    background-color: #ffffff;
                }
                
                .group-feature-item:last-child {
                    border-bottom: none;
                }
                
                .group-feature-item:hover {
                    background-color: #f8f9fa;
                }
                
                .group-feature-item.feature-hidden {
                    opacity: 0.5;
                }
                
                .group-feature-main {
                    display: flex;
                    align-items: center;
                    flex: 1;
                    cursor: pointer;
                }
                
                .group-feature-type-icon {
                    width: 16px;
                    height: 16px;
                    margin-right: 8px;
                }
                
                .group-feature-name {
                    font-size: 13px;
                    color: #555;
                }
                
                .feature-item {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 8px 12px;
                    border-bottom: 1px solid #f0f0f0;
                    background-color: #ffffff;
                    transition: background-color 0.2s ease;
                }
                
                .feature-item:hover {
                    background-color: #f8f9fa;
                }
                
                .feature-item.feature-hidden {
                    opacity: 0.5;
                }
                
                .feature-item.feature-locked {
                    background-color: #ffeaa7;
                }
                
                .feature-main {
                    display: flex;
                    align-items: center;
                    flex: 1;
                    cursor: pointer;
                }
                
                .feature-type-icon {
                    width: 16px;
                    height: 16px;
                    margin-right: 8px;
                }
                
                .feature-name {
                    font-size: 14px;
                    color: #333;
                }
                
                .feature-controls {
                    display: flex;
                    align-items: center;
                    gap: 4px;
                }
                
                .feature-controls button {
                    background: none;
                    border: none;
                    cursor: pointer;
                    padding: 4px;
                    border-radius: 3px;
                    color: #666;
                    transition: all 0.2s ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .feature-controls button:hover {
                    background-color: #e9ecef;
                    color: #007bff;
                }
                
                .feature-controls .lock-toggle svg {
                    color: #dc3545;
                }
            `;
      document.head.appendChild(style);
    }
  }

  /**
   * Adiciona estilos CSS para analysis layers com botões de zoom
   */
  addAnalysisLayersStyles() {
    if (!document.getElementById("analysis-layers-styles")) {
      const style = document.createElement("style");
      style.id = "analysis-layers-styles";
      style.textContent = `
                .analysis-layers-header {
                    padding: 8px 12px 4px 12px;
                    font-weight: 500;
                    font-size: 12px;
                    color: #666;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                
                .analysis-layer-item {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 4px 12px 4px 24px;
                    gap: 8px;
                }
                
                .analysis-layer-label {
                    display: flex;
                    align-items: center;
                    font-size: 12px;
                    cursor: pointer;
                    flex: 1;
                }
                
                .analysis-layer-label input {
                    margin-right: 6px;
                }
                
                .analysis-layer-zoom {
                    background: none;
                    border: none;
                    cursor: pointer;
                    padding: 4px;
                    color: #666;
                    transition: color 0.2s ease;
                    border-radius: 3px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-width: 22px;
                    height: 22px;
                }
                
                .analysis-layer-zoom:hover {
                    color: #007bff;
                    background-color: #f8f9fa;
                }
                
                .analysis-layer-zoom:active {
                    transform: scale(0.95);
                }
            `;
      document.head.appendChild(style);
    }
  }

  createHillshadeControl() {
    // Verificar se hillshade está habilitado no config via análise do terrain control
    const terrainControl = this.map._controls?.find(
      (control) => control.constructor.name === "TerrainControl"
    );

    if (!config.map2d?.hillshade?.enabled) {
      return null;
    }

    const hillshadeContainer = document.createElement("div");
    hillshadeContainer.className = "hillshade-control";
    hillshadeContainer.style.cssText = `
            padding: 8px 12px;
            border-bottom: 1px solid #e0e0e0;
            background-color: #f8f9fa;
        `;

    hillshadeContainer.innerHTML = `
            <label style="display: flex; align-items: center; font-size: 12px; cursor: pointer;">
                <input type="checkbox" id="hillshade-toggle" style="margin-right: 6px;"> 
                Sombreamento
            </label>
        `;

    const checkbox = hillshadeContainer.querySelector("#hillshade-toggle");
    checkbox.onchange = this.handleHillshadeToggle.bind(this);

    return hillshadeContainer;
  }

  createAnalysisLayersControl() {
    const container = document.createElement("div");
    container.className = "analysis-layers-control";
    container.style.cssText = `
            border-bottom: 1px solid #e0e0e0;
            background-color: #f8f9fa;
            display: none;
        `;
    return container;
  }

  createHeader() {
    const header = document.createElement("div");
    header.className = "features-tab-header";
    header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 12px;
            border-bottom: 1px solid #e0e0e0;
            background-color: #f8f9fa;
        `;

    const title = document.createElement("span");
    title.textContent = "Camadas";
    title.style.cssText = "font-weight: 500; font-size: 14px;";

    const addLayerBtn = document.createElement("button");
    addLayerBtn.className = "layer-add-btn";
    addLayerBtn.title = "Nova camada";
    addLayerBtn.innerHTML = this.INLINE_ICONS.ADD;
    addLayerBtn.onclick = () => this.handleAddLayer();

    header.appendChild(title);
    header.appendChild(addLayerBtn);

    return header;
  }

  /**
   * Renderiza o controle de analysis layers usando o manager
   */
  async renderAnalysisLayersControl() {
    const container = this.container.querySelector(".analysis-layers-control");
    if (!container) return;

    // Verificar se o sistema está habilitado
    if (!this.analysisLayersManager.isEnabled()) {
      container.style.display = "none";
      return;
    }

    // Construir HTML
    container.innerHTML = this.buildAnalysisLayersHTML();

    // Configurar eventos
    await this.attachAnalysisLayersEvents(container);

    // Mostrar container
    container.style.display = "block";
  }

  /**
   * Constrói HTML do controle de analysis layers com botões de zoom
   * @returns {string} HTML do controle
   */
  buildAnalysisLayersHTML() {
    const layersConfig = this.analysisLayersManager.getLayersConfig();

    let html = `<div class="analysis-layers-header">Camadas de Análise</div>`;

    // Criar checkbox e botão de zoom para cada layer configurada
    layersConfig.forEach((layerConfig) => {
      html += `
                <div class="analysis-layer-item">
                    <label class="analysis-layer-label">
                        <input type="checkbox" data-layer-id="${
                          layerConfig.id
                        }">
                        <span title="${layerConfig.description || ""}">${
        layerConfig.name
      }</span>
                    </label>
                    <button class="analysis-layer-zoom" data-layer-id="${
                      layerConfig.id
                    }" title="Zoom para ${layerConfig.name}">
                        ${this.INLINE_ICONS.ZOOM}
                    </button>
                </div>
            `;
    });

    // Padding inferior
    html += '<div style="height: 4px;"></div>';

    return html;
  }

  /**
   * Configura eventos dos checkboxes e botões de zoom das analysis layers
   * @param {HTMLElement} container - Container das analysis layers
   */
  async attachAnalysisLayersEvents(container) {
    // Carregar estados salvos
    const layersStates = await getMapAnalysisLayersStates();

    // Configurar checkboxes
    container.querySelectorAll("input[data-layer-id]").forEach((checkbox) => {
      const layerId = checkbox.dataset.layerId;
      const layerConfig = this.analysisLayersManager
        .getLayersConfig()
        .find((l) => l.id === layerId);

      // Definir estado inicial baseado no estado salvo ou defaultVisibility
      checkbox.checked =
        layersStates[layerId] ?? layerConfig?.defaultVisibility ?? false;

      // Event listener para mudanças
      checkbox.onchange = async (e) => {
        await this.analysisLayersManager.toggleLayer(layerId, e.target.checked);
      };
    });

    // Configurar botões de zoom
    container.querySelectorAll(".analysis-layer-zoom").forEach((button) => {
      button.onclick = (e) => {
        e.stopPropagation();
        const layerId = button.dataset.layerId;
        this.analysisLayersManager.zoomToLayer(layerId);
      };
    });
  }

  showLoadingSpinner() {
    const featuresList = this.container.querySelector(".features-list");
    featuresList.innerHTML = `
        <div class="features-loading">
            <div class="spinner"></div>
            <div class="loading-text">Atualizando...</div>
        </div>
    `;

    // Adicionar CSS do spinner dinamicamente se não existir
    if (!document.querySelector("#features-spinner-styles")) {
      const style = document.createElement("style");
      style.id = "features-spinner-styles";
      style.textContent = `
            .features-loading {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 40px 20px;
                background-color: #ffffff;
            }
            
            .spinner {
                width: 24px;
                height: 24px;
                border: 3px solid #f3f3f3;
                border-top: 3px solid #007bff;
                border-radius: 50%;
                animation: spin 1s linear infinite;
                margin-bottom: 12px;
            }
            
            .loading-text {
                color: #666;
                font-size: 14px;
                font-weight: 500;
            }
            
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
      document.head.appendChild(style);
    }
  }

  async loadFeatures() {
    if (!this.container) return;

    const featuresList = this.container.querySelector(".features-list");
    const isInitialLoad = !featuresList || featuresList.children.length === 0 || 
                          featuresList.querySelector('.features-loading') ||
                          featuresList.querySelector('.features-empty-message');

    // Mostrar spinner apenas na carga inicial
    if (isInitialLoad) {
      this.showLoadingSpinner();
    }

    try {
      // Obter features diretamente dos sources do mapa
      // Isso garante que mudanças não salvas (ex: nome editado) sejam refletidas
      const features = await this._getFeaturesFromMapSources();

      // Organizar features por grupos
      const organizedData = await this.organizeFeaturesByGroups(features);
      this.renderOrganizedFeatures(organizedData);
    } catch (error) {
      console.error("Erro ao carregar features:", error);

      // Em caso de erro, mostrar mensagem
      const featuresList = this.container.querySelector(".features-list");
      featuresList.innerHTML = `
            <div class="features-error" style="
                padding: 20px;
                text-align: center;
                color: #dc3545;
                font-size: 14px;
                background-color: #ffffff;
                border-radius: 4px;
            ">
                Erro ao carregar feições
            </div>
        `;
    }
  }

  /**
   * Organiza features por LAYERS, depois por grupos e features soltas
   * Implementa a hierarquia: Layer -> Group -> Feature
   * Grupos cross-layer aparecem em cada layer com indicador "N de M"
   */
  async organizeFeaturesByGroups(features) {
    const currentMapName = getCurrentMapNameSync();
    const groups = getMapGroups(currentMapName);
    const layers = await getLayers();
    const activeLayerId = getActiveLayerIdSync();

    const flatFeatures = this.flattenAndSortFeatures(features);

    const layerData = {};

    layers.forEach(layer => {
      layerData[layer.id] = {
        layer: layer,
        isActive: layer.id === activeLayerId,
        groups: new Map(),
        ungrouped: [],
        featureCount: 0
      };
    });

    if (!layerData['default']) {
      layerData['default'] = {
        layer: { id: 'default', name: 'Padrão', visible: true, locked: false },
        isActive: activeLayerId === 'default',
        groups: new Map(),
        ungrouped: [],
        featureCount: 0
      };
    }

    const groupTotals = new Map();
    if (groups instanceof Map) {
      groups.forEach((group, groupId) => {
        groupTotals.set(groupId, group.features ? group.features.length : 0);
      });
    }

    flatFeatures.forEach((feature) => {
      const layerId = feature.rawFeature?.properties?.layerId || 'default';
      const sourceType = feature.storageType.endsWith("s")
        ? feature.storageType.slice(0, -1)
        : feature.storageType;
      const group = getFeatureGroup(sourceType, feature.id, currentMapName);

      if (!layerData[layerId]) {
        layerData[layerId] = {
          layer: { id: layerId, name: 'Desconhecida', visible: true, locked: false },
          isActive: false,
          groups: new Map(),
          ungrouped: [],
          featureCount: 0
        };
      }

      layerData[layerId].featureCount++;

      if (group) {
        if (!layerData[layerId].groups.has(group.id)) {
          layerData[layerId].groups.set(group.id, {
            groupData: group,
            features: [],
            totalInGroup: groupTotals.get(group.id) || group.features?.length || 0
          });
        }
        layerData[layerId].groups.get(group.id).features.push(feature);
      } else {
        layerData[layerId].ungrouped.push(feature);
      }
    });

    const sortedLayers = Object.values(layerData)
      .sort((a, b) => {
        // Ordenar por order (não reordena por camada ativa)
        const orderA = a.layer.order ?? 999;
        const orderB = b.layer.order ?? 999;
        if (orderA !== orderB) return orderA - orderB;
        // Por fim por nome
        return (a.layer.name || '').localeCompare(b.layer.name || '', 'pt-BR');
      });

    return sortedLayers;
  }

  /**
   * Renderiza features organizadas hierarquicamente por Layer -> Group -> Feature
   */
  renderOrganizedFeatures(organizedLayers) {
    const featuresList = this.container.querySelector(".features-list");
    featuresList.innerHTML = "";

    // Se recebeu formato antigo (objeto com groups e ungrouped), converter
    if (organizedLayers && organizedLayers.groups !== undefined && !Array.isArray(organizedLayers)) {
      const { groups, ungrouped } = organizedLayers;
      if (groups.size === 0 && ungrouped.length === 0) {
        this._renderEmptyMessage(featuresList);
        return;
      }
      // Renderizar no formato antigo para compatibilidade
      const sortedGroups = Array.from(groups.entries()).sort((a, b) =>
        a[1].groupData.name.localeCompare(b[1].groupData.name, "pt-BR")
      );
      sortedGroups.forEach(([groupId, groupInfo]) => {
        const groupItem = this.createGroupItem(groupInfo.groupData, groupInfo.features);
        featuresList.appendChild(groupItem);
      });
      ungrouped.forEach((feature) => {
        const item = this.createFeatureItem(feature);
        featuresList.appendChild(item);
      });
      return;
    }

    // Novo formato: array de layers
    if (!Array.isArray(organizedLayers) || organizedLayers.length === 0) {
      this._renderEmptyMessage(featuresList);
      return;
    }

    // Renderizar cada layer como container colapsável
    organizedLayers.forEach((layerInfo) => {
      const layerContainer = this.createLayerContainer(layerInfo);
      featuresList.appendChild(layerContainer);
    });
    
    // Inicializar Sortable para reordenação de camadas
    this._initLayerSortable(featuresList);
  }

  _renderEmptyMessage(container) {
    const emptyMessage = document.createElement("div");
    emptyMessage.className = "features-empty-message";
    emptyMessage.style.cssText = `
      padding: 20px;
      text-align: center;
      color: #666;
      font-size: 14px;
      font-style: italic;
      background-color: #ffffff;
      border-radius: 4px;
    `;
    emptyMessage.textContent = "Sem feições no mapa";
    container.appendChild(emptyMessage);
  }

  /**
   * Inicializa Sortable.js para reordenação de camadas via drag and drop
   */
  _initLayerSortable(featuresList) {
    // Destruir instância anterior se existir
    if (this._sortableInstance) {
      this._sortableInstance.destroy();
      this._sortableInstance = null;
    }

    // Verificar se Sortable.js está disponível
    if (typeof Sortable === 'undefined') {
      console.warn('Sortable.js não carregado - reordenação de camadas desabilitada');
      return;
    }

    this._sortableInstance = Sortable.create(featuresList, {
      handle: '.layer-drag-handle',
      animation: 150,
      ghostClass: 'layer-sortable-ghost',
      chosenClass: 'layer-sortable-chosen',
      dragClass: 'layer-sortable-drag',
      onEnd: async (evt) => {
        // Extrair nova ordem dos data-layer-id
        const newOrder = Array.from(featuresList.querySelectorAll('.layer-container'))
          .map(el => el.dataset.layerId)
          .filter(Boolean);
        
        // Persistir nova ordem no store
        await reorderLayers(newOrder);
      }
    });
  }

  /**
   * Cria container visual de uma layer com seus grupos e features
   */
  createLayerContainer(layerInfo) {
    const { layer, isActive, groups, ungrouped, featureCount } = layerInfo;

    const container = document.createElement("div");
    container.className = "layer-container";
    container.dataset.layerId = layer.id;

    if (isActive) container.classList.add("layer-active");
    if (!layer.visible) container.classList.add("layer-hidden");
    if (layer.locked) container.classList.add("layer-locked");

    // Header da layer
    const header = this.createLayerHeaderForList(layer, isActive, featureCount);
    container.appendChild(header);

    // Conteúdo (grupos + features soltas)
    const content = document.createElement("div");
    content.className = "layer-content";

    // Renderizar grupos desta layer (ordenados por nome)
    const sortedGroups = Array.from(groups.entries()).sort((a, b) =>
      a[1].groupData.name.localeCompare(b[1].groupData.name, "pt-BR")
    );

    sortedGroups.forEach(([groupId, groupInfo]) => {
      const groupItem = this.createGroupItemInLayer(groupInfo, layer);
      content.appendChild(groupItem);
    });

    // Renderizar features soltas
    ungrouped.forEach((feature) => {
      const item = this.createFeatureItem(feature);
      content.appendChild(item);
    });

    container.appendChild(content);
    return container;
  }

  /**
   * Cria header de layer para a lista de features
   * Inclui: radio para ativar, nome editável, controles de visibilidade/lock/delete
   */
  createLayerHeaderForList(layer, isActive, featureCount) {
    const header = document.createElement("div");
    header.className = "layer-header" + (isActive ? " active" : "");
    header.dataset.layerId = layer.id;

    // Radio para selecionar camada ativa
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "active-layer";
    radio.className = "layer-radio";
    radio.checked = isActive;
    radio.title = "Definir como camada ativa";
    radio.onclick = (e) => {
      e.stopPropagation();
      // Sempre chama handleSetActiveLayer - ele verifica internamente se já é ativa
      this.handleSetActiveLayer(layer.id);
    };

    // Ícone de expansão
    const expandIcon = document.createElement("div");
    expandIcon.className = "layer-expand-icon";
    expandIcon.innerHTML = this.INLINE_ICONS.EXPAND;


    // Nome da layer (editável por duplo-clique)
    const layerName = document.createElement("div");
    layerName.className = "layer-name";
    layerName.textContent = layer.name;
    layerName.title = "Duplo-clique para renomear";
    
    // Duplo-clique para editar nome
    layerName.ondblclick = (e) => {
      e.stopPropagation();
      this.startLayerRenameInline(layer.id, layerName);
    };

    // Contador
    const count = document.createElement("div");
    count.className = "layer-count";
    count.textContent = `(${featureCount})`;

    // Controles
    const controls = document.createElement("div");
    controls.className = "layer-controls";

    // Botão visibilidade
    const visBtn = document.createElement("button");
    visBtn.className = "visibility-toggle";
    visBtn.innerHTML = layer.visible ? this.INLINE_ICONS.EYE_VISIBLE : this.INLINE_ICONS.EYE_HIDDEN;
    visBtn.title = layer.visible ? "Ocultar camada" : "Mostrar camada";
    visBtn.onclick = (e) => {
      e.stopPropagation();
      this.handleToggleLayerVisibility(layer.id);
    };

    // Botão lock
    const lockBtn = document.createElement("button");
    lockBtn.className = "lock-toggle";
    lockBtn.innerHTML = layer.locked ? this.INLINE_ICONS.LOCK_LOCKED : this.INLINE_ICONS.LOCK_UNLOCKED;
    lockBtn.title = layer.locked ? "Desbloquear camada" : "Bloquear camada";
    lockBtn.onclick = (e) => {
      e.stopPropagation();
      this.handleToggleLayerLock(layer.id);
    };

    // Botão delete
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "layer-delete-btn";
    deleteBtn.innerHTML = this.INLINE_ICONS.DELETE;
    deleteBtn.title = "Excluir camada";
    deleteBtn.onclick = (e) => {
      e.stopPropagation();
      this.handleDeleteLayer(layer.id);
    };

    controls.appendChild(visBtn);
    controls.appendChild(lockBtn);
    controls.appendChild(deleteBtn);

    // Drag handle para reordenação
    const dragHandle = document.createElement("div");
    dragHandle.className = "layer-drag-handle";
    dragHandle.innerHTML = this.INLINE_ICONS.DRAG;
    dragHandle.title = "Arraste para reordenar";

    header.appendChild(dragHandle);
    header.appendChild(radio);
    header.appendChild(expandIcon);
    header.appendChild(layerName);
    header.appendChild(count);
    header.appendChild(controls);

    // Click no ícone de expansão para expandir/colapsar
    expandIcon.onclick = (e) => {
      e.stopPropagation();
      this.toggleLayerExpansion(layer.id);
    };
    expandIcon.style.cursor = "pointer";

    return header;
  }

  /**
   * Inicia edição inline do nome da camada
   */
  startLayerRenameInline(layerId, nameElement) {
    const currentName = nameElement.textContent.replace(" ★", "").trim();
    
    // Criar input
    const input = document.createElement("input");
    input.type = "text";
    input.className = "layer-rename-input";
    input.value = currentName;
    input.style.cssText = `
      font-size: inherit;
      padding: 2px 4px;
      border: 1px solid #007bff;
      border-radius: 3px;
      outline: none;
      width: 120px;
    `;

    // Salvar referência ao texto original
    const originalHTML = nameElement.innerHTML;
    
    // Substituir conteúdo pelo input
    nameElement.innerHTML = "";
    nameElement.appendChild(input);
    input.focus();
    input.select();

    const finishEdit = async (save) => {
      const newName = input.value.trim();
      
      if (save && newName && newName !== currentName) {
        try {
          await this.handleRenameLayer(layerId, newName);
        } catch (error) {
          console.error("Erro ao renomear camada:", error);
          nameElement.innerHTML = originalHTML;
        }
      } else {
        nameElement.innerHTML = originalHTML;
      }
    };

    input.onblur = () => finishEdit(true);
    input.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        finishEdit(false);
      }
    };
  }

  /**
   * Toggle expansão da layer
   */
  toggleLayerExpansion(layerId) {
    const container = this.container.querySelector(`.layer-container[data-layer-id="${layerId}"]`);
    if (!container) return;

    const content = container.querySelector(".layer-content");
    const expandIcon = container.querySelector(".layer-expand-icon");

    if (content.classList.contains("collapsed")) {
      content.classList.remove("collapsed");
      expandIcon.classList.remove("collapsed");
    } else {
      content.classList.add("collapsed");
      expandIcon.classList.add("collapsed");
    }
  }

  /**
   * Cria grupo dentro de uma layer (com indicador de split se cross-layer)
   */
  createGroupItemInLayer(groupInfo, layer) {
    const { groupData, features, totalInGroup } = groupInfo;
    const isSplit = features.length < totalInGroup;

    const groupContainer = document.createElement("div");
    groupContainer.className = "group-container";
    groupContainer.dataset.groupId = groupData.id;

    // Header do grupo
    const groupHeader = this.createGroupHeader(groupData, features.length, isSplit, totalInGroup);
    groupContainer.appendChild(groupHeader);

    // Lista de features do grupo
    const featuresList = this.createGroupFeaturesList(groupData, features);
    groupContainer.appendChild(featuresList);

    return groupContainer;
  }

  /**
   * Cria item de grupo com suas features
   */
  createGroupItem(groupData, features) {
    const groupContainer = document.createElement("div");
    groupContainer.className = "group-container";
    groupContainer.dataset.groupId = groupData.id;

    // Header do grupo
    const groupHeader = this.createGroupHeader(groupData, features.length);
    groupContainer.appendChild(groupHeader);

    // Lista de features do grupo
    const featuresList = this.createGroupFeaturesList(groupData, features);
    groupContainer.appendChild(featuresList);

    return groupContainer;
  }

  /**
   * Cria header do grupo com controles
   * @param {Object} groupData - Dados do grupo
   * @param {number} featureCount - Numero de features nesta layer
   * @param {boolean} isSplit - Se o grupo esta dividido entre layers
   * @param {number} totalInGroup - Total de features no grupo (para cross-layer)
   */
  createGroupHeader(groupData, featureCount, isSplit = false, totalInGroup = featureCount) {
    const header = document.createElement("div");
    header.className = "group-header";

    if (!groupData.visible) {
      header.classList.add("group-hidden");
    }
    if (groupData.locked) {
      header.classList.add("group-locked");
    }

    const expandIcon = document.createElement("div");
    expandIcon.className = "group-expand-icon expanded";
    expandIcon.innerHTML = this.INLINE_ICONS.EXPAND;

    const groupIcon = document.createElement("div");
    groupIcon.className = "group-icon";
    groupIcon.innerHTML = this.INLINE_ICONS.GROUP;

    const groupName = document.createElement("div");
    groupName.className = "group-name";
    groupName.textContent = groupData.name;

    const groupCount = document.createElement("div");
    groupCount.className = "group-count";
    if (isSplit) {
      groupCount.innerHTML = `<span class="group-split-indicator">${featureCount} de ${totalInGroup}</span>`;
      groupCount.title = "Este grupo contem feicoes em multiplas camadas";
    } else {
      groupCount.textContent = featureCount;
    }

    const groupControls = this.createGroupControls(groupData);

    header.appendChild(expandIcon);
    header.appendChild(groupIcon);
    header.appendChild(groupName);
    header.appendChild(groupCount);
    header.appendChild(groupControls);

    header.addEventListener("click", (e) => {
      if (!e.target.closest(".group-controls")) {
        this.toggleGroupExpansion(groupData.id);
      }
    });

    return header;
  }

  /**
   * Cria controles especificos do grupo
   */
  createGroupControls(groupData) {
    const controls = document.createElement("div");
    controls.className = "group-controls";

    // BotÃ£o de visibilidade
    const visibilityBtn = document.createElement("button");
    visibilityBtn.className = "visibility-toggle";
    visibilityBtn.title = groupData.visible ? "Ocultar grupo" : "Mostrar grupo";
    visibilityBtn.innerHTML = groupData.visible
      ? this.INLINE_ICONS.EYE_VISIBLE
      : this.INLINE_ICONS.EYE_HIDDEN;

    visibilityBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleGroupVisibility(groupData.id, groupData.visible);
    });

    // BotÃ£o de bloqueio
    const lockBtn = document.createElement("button");
    lockBtn.className = "lock-toggle";
    lockBtn.title = groupData.locked ? "Desbloquear grupo" : "Bloquear grupo";
    lockBtn.innerHTML = groupData.locked
      ? this.INLINE_ICONS.LOCK_LOCKED
      : this.INLINE_ICONS.LOCK_UNLOCKED;

    lockBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleGroupLock(groupData.id, groupData.locked);
    });

    controls.appendChild(visibilityBtn);
    controls.appendChild(lockBtn);

    return controls;
  }

  /**
   * Cria lista de features do grupo
   */
  createGroupFeaturesList(groupData, features) {
    const featuresList = document.createElement("div");
    featuresList.className = "group-features-list expanded";

    features.forEach((feature) => {
      const featureItem = this.createGroupFeatureItem(feature, groupData);
      featuresList.appendChild(featureItem);
    });

    return featuresList;
  }

  /**
   * Cria item de feature dentro do grupo (sem controles individuais)
   */
  createGroupFeatureItem(feature, groupData) {
    const item = document.createElement("div");
    item.className = "group-feature-item";
    item.dataset.featureId = feature.id;
    item.dataset.featureType = feature.storageType;

    // Aplicar estado visual baseado no grupo
    if (!groupData.visible) {
      item.classList.add("feature-hidden");
    }

    const main = document.createElement("div");
    main.className = "group-feature-main";

    const typeIconPath = getFeatureIconFromStorage(feature.storageType);
    const typeIcon = document.createElement("img");
    typeIcon.className = "group-feature-type-icon";
    typeIcon.src = typeIconPath;
    typeIcon.alt = feature.typeLabel;

    const featureName = document.createElement("div");
    featureName.className = "group-feature-name";
    featureName.textContent = feature.name;

    main.appendChild(typeIcon);
    main.appendChild(featureName);

    // Event listener para clique na feature
    main.addEventListener("click", () =>
      this.handleGroupFeatureClick(feature, groupData)
    );

    item.appendChild(main);

    return item;
  }

  /**
   * Manipula clique em feature dentro de grupo
   */
  async handleGroupFeatureClick(feature, groupData) {
    try {
      // Verificar se grupo está bloqueado
      if (groupData.locked) {
        // Se bloqueado, apenas fazer zoom
        await FeatureNavigationUtils.zoomToFeature(
          feature.rawFeature,
          this.map
        );
        return;
      }

      // Se não bloqueado: zoom + seleção do grupo inteiro
      await FeatureNavigationUtils.zoomToFeature(feature.rawFeature, this.map);

      // Selecionar todo o grupo
      if (this.selectionManager) {
        this.selectionManager.deselectAllFeatures();

        // Iterar pelas features do grupo corretamente
        for (const featureRef of groupData.features) {
          // featureRef tem { type: sourceType, id: featureId }
          const completeFeature = await this.selectionManager.getCompleteFeatureFromSource(
            featureRef.type,
            featureRef.id
          );
          if (completeFeature) {
            await this.selectionManager.toggleFeatureSelection(
              featureRef.type,
              featureRef.id,
              completeFeature,
              false
            );
          }
        }

        this.selectionManager.updateUI();
      }
    } catch (error) {
      console.error("Erro ao navegar para feature do grupo:", error);

      // Fallback: apenas fazer zoom
      try {
        await FeatureNavigationUtils.zoomToFeature(
          feature.rawFeature,
          this.map
        );
      } catch (fallbackError) {
        console.error("Erro no fallback de zoom:", fallbackError);
      }
    }
  }

  /**
   * Toggle expansão do grupo
   */
  toggleGroupExpansion(groupId) {
    const groupContainer = this.container.querySelector(
      `[data-group-id="${groupId}"]`
    );
    if (!groupContainer) return;

    const expandIcon = groupContainer.querySelector(".group-expand-icon");
    const featuresList = groupContainer.querySelector(".group-features-list");

    if (featuresList.classList.contains("expanded")) {
      featuresList.classList.remove("expanded");
      expandIcon.classList.remove("expanded");
      expandIcon.classList.add("collapsed");
      expandIcon.innerHTML = this.INLINE_ICONS.COLLAPSE;
    } else {
      featuresList.classList.add("expanded");
      expandIcon.classList.remove("collapsed");
      expandIcon.classList.add("expanded");
      expandIcon.innerHTML = this.INLINE_ICONS.EXPAND;
    }
  }

  /**
   * Toggle visibilidade do grupo
   */
  async toggleGroupVisibility(groupId, currentVisibility) {
    try {
      const newVisibility = !currentVisibility;

      // Atualizar propriedade do grupo
      updateGroupProperty(groupId, "visible", newVisibility);

      // Atualizar todas as features do grupo nos sources do mapa
      const currentMapName = getCurrentMapNameSync();
      const group = getMapGroups(currentMapName).get(groupId);
      if (group) {
        for (const featureRef of group.features) {
          // Usar função correta para conversão de tipos
          const storageType = getStorageTypeFromSource(featureRef.type);
          if (!storageType) {
            console.error(
              `Não foi possível converter tipo ${featureRef.type} para storage type`
            );
            continue;
          }
          await this.propagateFeaturePropertyToSource(
            storageType,
            featureRef.id,
            "visivel",
            newVisibility
          );
        }
      }

      // Atualizar interface visual
      this.updateGroupVisualState(groupId, newVisibility, currentVisibility);
    } catch (error) {
      console.error("Erro ao alterar visibilidade do grupo:", error);
    }
  }

  /**
   * Toggle bloqueio do grupo
   */
  async toggleGroupLock(groupId, currentLockState) {
    try {
      const newLockState = !currentLockState;

      // Atualizar propriedade do grupo
      updateGroupProperty(groupId, "locked", newLockState);

      // Atualizar todas as features do grupo nos sources do mapa
      const currentMapName = getCurrentMapNameSync();
      const group = getMapGroups(currentMapName).get(groupId);
      if (group) {
        for (const featureRef of group.features) {
          // Usar função correta para conversão de tipos
          const storageType = getStorageTypeFromSource(featureRef.type);
          if (!storageType) {
            console.error(
              `Não foi possível converter tipo ${featureRef.type} para storage type`
            );
            continue;
          }
          await this.propagateFeaturePropertyToSource(
            storageType,
            featureRef.id,
            "bloqueado",
            newLockState
          );
        }
      }

      // Atualizar interface visual
      this.updateGroupLockState(groupId, newLockState);

      // Desselecionar grupo se foi bloqueado
      if (newLockState && this.selectionManager) {
        group.features.forEach((featureRef) => {
          const isSelected = this.selectionManager.isFeatureSelected(
            featureRef.type,
            featureRef.id
          );

          if (isSelected) {
            this.selectionManager.toggleFeatureSelection(
              featureRef.type,
              featureRef.id,
              null,
              true
            );
          }
        });
        this.selectionManager.updateUI();
      }
    } catch (error) {
      console.error("Erro ao alterar bloqueio do grupo:", error);
    }
  }

  /**
   * Atualiza estado visual do grupo
   */
  updateGroupVisualState(groupId, visible, locked) {
    const groupContainer = this.container.querySelector(
      `[data-group-id="${groupId}"]`
    );
    if (!groupContainer) return;

    const header = groupContainer.querySelector(".group-header");
    const visibilityBtn = groupContainer.querySelector(".visibility-toggle");
    const featureItems = groupContainer.querySelectorAll(".group-feature-item");

    // Atualizar header
    if (visible) {
      header.classList.remove("group-hidden");
    } else {
      header.classList.add("group-hidden");
    }

    // Atualizar botão
    visibilityBtn.innerHTML = visible
      ? this.INLINE_ICONS.EYE_VISIBLE
      : this.INLINE_ICONS.EYE_HIDDEN;
    visibilityBtn.title = visible ? "Ocultar grupo" : "Mostrar grupo";

    // Atualizar features do grupo
    featureItems.forEach((item) => {
      if (visible) {
        item.classList.remove("feature-hidden");
      } else {
        item.classList.add("feature-hidden");
      }
    });
  }

  /**
   * Atualiza estado de bloqueio do grupo
   */
  updateGroupLockState(groupId, locked) {
    const groupContainer = this.container.querySelector(
      `[data-group-id="${groupId}"]`
    );
    if (!groupContainer) return;

    const header = groupContainer.querySelector(".group-header");
    const lockBtn = groupContainer.querySelector(".lock-toggle");

    // Atualizar header
    if (locked) {
      header.classList.add("group-locked");
    } else {
      header.classList.remove("group-locked");
    }

    // Atualizar botão
    lockBtn.innerHTML = locked
      ? this.INLINE_ICONS.LOCK_LOCKED
      : this.INLINE_ICONS.LOCK_UNLOCKED;
    lockBtn.title = locked ? "Desbloquear grupo" : "Bloquear grupo";

    // Destacar cor do SVG se bloqueado
    const svg = lockBtn.querySelector("svg");
    if (svg && locked) {
      svg.style.color = "#dc3545";
    } else if (svg) {
      svg.style.color = "";
    }
  }

  /**
   * Organiza features em estrutura flat com dados corretos
   */
  flattenAndSortFeatures(features) {
    const flatFeatures = [];
    const validStorageTypes = getAllStorageTypes();

    // Converter features agrupadas em array plano
    Object.entries(features).forEach(([storageType, featureArray]) => {
      if (!validStorageTypes.includes(storageType)) {
        return; // Ignora processed_los, processed_visibility, etc.
      }
      if (featureArray.length > 0) {
        featureArray.forEach((feature) => {
          flatFeatures.push({
            id: feature.properties.id,
            name: feature.properties.nome || "Sem nome",
            visible: feature.properties.visivel ?? true,
            locked: feature.properties.bloqueado ?? false,
            rawFeature: feature,
            storageType: storageType,
            typeLabel: getFeatureDisplayNameFromStorage(storageType),
          });
        });
      }
    });

    // Ordenar por tipo alfabético, depois por nome
    flatFeatures.sort((a, b) => {
      // Primeiro por tipo
      const typeCompare = a.typeLabel.localeCompare(b.typeLabel, "pt-BR");
      if (typeCompare !== 0) return typeCompare;

      // Depois por nome
      return a.name.localeCompare(b.name, "pt-BR");
    });

    return flatFeatures;
  }

  createFeatureItem(feature) {
    const item = document.createElement("div");
    item.className = "feature-item";
    item.dataset.featureId = feature.id;
    item.dataset.featureType = feature.storageType;

    const typeIconPath = getFeatureIconFromStorage(feature.storageType);
    const typeIconAlt = feature.typeLabel;
    const visibilityIcon = feature.visible
      ? this.INLINE_ICONS.EYE_VISIBLE
      : this.INLINE_ICONS.EYE_HIDDEN;
    const visibilityTitle = feature.visible ? "Ocultar" : "Mostrar";
    const lockIcon = feature.locked
      ? this.INLINE_ICONS.LOCK_LOCKED
      : this.INLINE_ICONS.LOCK_UNLOCKED;
    const lockTitle = feature.locked ? "Desbloquear" : "Bloquear";

    item.innerHTML = `
            <div class="feature-main">
                <img class="feature-type-icon" src="${typeIconPath}" alt="${typeIconAlt}" />
                <div class="feature-name">${feature.name}</div>
            </div>
            <div class="feature-controls">
                <button class="visibility-toggle" title="${visibilityTitle}">
                    ${visibilityIcon}
                </button>
                <button class="lock-toggle" title="${lockTitle}">
                    ${lockIcon}
                </button>
            </div>
        `;

    // Event listeners após innerHTML
    const nameDiv = item.querySelector(".feature-name");
    nameDiv.addEventListener("click", () => this.handleFeatureClick(feature));

    const visibilityBtn = item.querySelector(".visibility-toggle");
    visibilityBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleVisibility(feature.id, feature.storageType);
    });

    const lockBtn = item.querySelector(".lock-toggle");
    lockBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleLock(feature.id, feature.storageType);
    });

    if (!feature.visible) {
      item.classList.add("feature-hidden");
    }
    if (feature.locked) {
      item.classList.add("feature-locked");
    }
    return item;
  }

  /**
   * Manipula o clique na feature: zoom + seleção (verifica bloqueio atual)
   */
  async handleFeatureClick(feature) {
    try {
      // Verificar estado atual da feature via IndexedDB (não rawFeature)
      const currentFeature = await getFeatureById(
        feature.storageType,
        feature.id
      );
      const isLocked = currentFeature?.properties?.bloqueado ?? false;

      if (isLocked) {
        await FeatureNavigationUtils.zoomToFeature(
          feature.rawFeature,
          this.map
        );
        return;
      }

      // Se não bloqueada: zoom + seleção normal
      await FeatureNavigationUtils.zoomAndSelectFeature(
        feature.rawFeature,
        this.map,
        this.selectionManager,
        feature.storageType,
        feature.id
      );
    } catch (error) {
      console.error("Erro ao navegar para feature:", error);

      // Fallback: apenas fazer zoom sem seleção
      try {
        await FeatureNavigationUtils.zoomToFeature(
          feature.rawFeature,
          this.map
        );
      } catch (fallbackError) {
        console.error("Erro no fallback de zoom:", fallbackError);
      }
    }
  }

  /**
   * Toggle de visibilidade usando filtros de layer
   */
  async toggleVisibility(featureId, featureType) {
    const feature = await getFeatureById(featureType, featureId);
    if (!feature) return;

    const newVisibility = !(feature.properties.visivel ?? true);

    // 1. Atualizar propriedade no store
    await updateFeatureProperty(
      featureType,
      featureId,
      "visivel",
      newVisibility
    );

    // 2. Propagar para source do mapa
    await this.propagateFeaturePropertyToSource(
      featureType,
      featureId,
      "visivel",
      newVisibility
    );

    // 3. Atualizar botão visual (ícone de olho)
    this.updateVisibilityButton(featureId, newVisibility);

    // 4. Atualizar estado visual do item (classe CSS)
    this.updateItemVisualState(
      featureId,
      newVisibility,
      feature.properties.bloqueado ?? false
    );

    // 5. Desselecionar feature se ficou invisível e está selecionada
    if (!newVisibility && this.selectionManager?.isFeatureSelected) {
      const selectionManagerType =
        FeatureNavigationUtils.mapFeatureType(featureType);
      const isSelected = this.selectionManager.isFeatureSelected(
        selectionManagerType,
        featureId
      );

      if (isSelected && this.selectionManager.deselectFeature) {
        this.selectionManager.deselectFeature(featureId, selectionManagerType);
      }
    }
  }

  /**
   * Toggle de bloqueio com propagação para o source do mapa
   */
  async toggleLock(featureId, featureType) {
    const feature = await getFeatureById(featureType, featureId);
    if (!feature) return;

    const newLockState = !(feature.properties.bloqueado ?? false);

    // 1. Atualizar propriedade no store
    await updateFeatureProperty(
      featureType,
      featureId,
      "bloqueado",
      newLockState
    );

    // 2. Propagar para source do mapa
    await this.propagateFeaturePropertyToSource(
      featureType,
      featureId,
      "bloqueado",
      newLockState
    );

    // 3. Atualizar botão visual (ícone de cadeado)
    this.updateLockButton(featureId, newLockState);

    // 4. Atualizar estado visual do item (classe CSS)
    this.updateItemVisualState(
      featureId,
      feature.properties.visivel ?? true,
      newLockState
    );

    // 5. Desselecionar feature se foi bloqueada e está selecionada
    if (newLockState && this.selectionManager?.isFeatureSelected) {
      const selectionManagerType =
        FeatureNavigationUtils.mapFeatureType(featureType);
      const isSelected = this.selectionManager.isFeatureSelected(
        selectionManagerType,
        featureId
      );

      if (isSelected && this.selectionManager.deselectFeature) {
        this.selectionManager.deselectFeature(featureId, selectionManagerType);
      }
    }
  }

  /**
   * Propaga alteração de propriedade para o source do Mapbox
   * Pega todas as features do source, atualiza a específica e faz setData
   * Suprime refresh automático para evitar reconstrução desnecessária
   */
  async propagateFeaturePropertyToSource(featureType, featureId, property, value) {
    const source = this.map.getSource(featureType);
    if (!source) {
      console.warn(`Source ${featureType} não encontrado`);
      return;
    }

    try {
      // Suprimir refresh durante atualização interna
      this._suppressRefresh = true;
      
      // Pegar TODAS as features do source
      const data = await source.getData();

      const featureIndex = data.features.findIndex(
        (f) => f.properties.id === featureId || f.id === featureId
      );

      if (featureIndex !== -1) {
        // Atualizar propriedade na feature encontrada
        data.features[featureIndex].properties[property] = value;

        // Fazer setData com todo o conjunto atualizado
        source.setData(data);
      } else {
        console.warn(
          `Feature ${featureId} não encontrada no source ${featureType}`
        );
      }
    } catch (error) {
      console.error(
        `Erro ao propagar propriedade para source ${featureType}:`,
        error
      );
    } finally {
      // Restaurar após pequeno delay para garantir que sourcedata já foi processado
      setTimeout(() => {
        this._suppressRefresh = false;
      }, 50);
    }
  }

  updateVisibilityButton(featureId, visible) {
    const btn = this.container.querySelector(
      `[data-feature-id="${featureId}"] .visibility-toggle`
    );
    if (btn) {
      const icon = visible
        ? this.INLINE_ICONS.EYE_VISIBLE
        : this.INLINE_ICONS.EYE_HIDDEN;
      const title = visible ? "Ocultar" : "Mostrar";
      btn.innerHTML = icon;
      btn.title = title;
    }
  }

  updateLockButton(featureId, locked) {
    const btn = this.container.querySelector(
      `[data-feature-id="${featureId}"] .lock-toggle`
    );
    if (btn) {
      const icon = locked
        ? this.INLINE_ICONS.LOCK_LOCKED
        : this.INLINE_ICONS.LOCK_UNLOCKED;
      const title = locked ? "Desbloquear" : "Bloquear";
      btn.innerHTML = icon;
      btn.title = title;

      // Garantir que o SVG tenha a cor correta baseado no CSS
      const svg = btn.querySelector("svg");
      if (svg && locked) {
        svg.style.color = "#dc3545";
      } else if (svg) {
        // Remover estilo inline para usar CSS normal
        svg.style.color = "";
      }
    }
  }

  updateItemVisualState(featureId, visible, locked) {
    const item = this.container.querySelector(
      `[data-feature-id="${featureId}"]`
    );
    if (item) {
      // Remover classes antigas primeiro para evitar conflitos
      item.classList.remove("feature-hidden", "feature-locked");

      // Aplicar classes baseado no estado atual
      if (!visible) {
        item.classList.add("feature-hidden");
      }

      if (locked) {
        item.classList.add("feature-locked");
      }
    } else {
      console.warn(`Item não encontrado para feature: ${featureId}`);
    }
  }

  /**
   * Atualiza indicadores visuais de camada ativa sem reconstruir a lista
   * @param {string} previousActiveId - ID da camada anteriormente ativa
   * @param {string} newActiveId - ID da nova camada ativa
   */
  _updateActiveLayerIndicators(previousActiveId, newActiveId) {
    if (!this.container) return;

    // Remover indicadores da camada anterior
    if (previousActiveId) {
      const prevContainer = this.container.querySelector(
        `.layer-container[data-layer-id="${previousActiveId}"]`
      );
      if (prevContainer) {
        prevContainer.classList.remove("layer-active");
        const prevHeader = prevContainer.querySelector(".layer-header");
        if (prevHeader) {
          prevHeader.classList.remove("active");
        }
        // Desmarcar radio
        const prevRadio = prevContainer.querySelector(".layer-radio");
        if (prevRadio) prevRadio.checked = false;
      }
    }

    // Adicionar indicadores à nova camada ativa
    if (newActiveId) {
      const newContainer = this.container.querySelector(
        `.layer-container[data-layer-id="${newActiveId}"]`
      );
      if (newContainer) {
        newContainer.classList.add("layer-active");
        const newHeader = newContainer.querySelector(".layer-header");
        if (newHeader) {
          newHeader.classList.add("active");
        }
        // Marcar radio
        const newRadio = newContainer.querySelector(".layer-radio");
        if (newRadio) newRadio.checked = true;
      }
    }
  }

  /**
   * Atualiza indicador visual de visibilidade de uma camada
   * @param {string} layerId - ID da camada
   * @param {boolean} visible - Novo estado de visibilidade
   */
  _updateLayerVisibilityIndicator(layerId, visible) {
    if (!this.container) return;

    const layerContainer = this.container.querySelector(
      `.layer-container[data-layer-id="${layerId}"]`
    );
    if (!layerContainer) return;

    // Atualizar classe do container
    if (visible) {
      layerContainer.classList.remove("layer-hidden");
    } else {
      layerContainer.classList.add("layer-hidden");
    }

    // Atualizar botão e ícone
    const visBtn = layerContainer.querySelector(".layer-header .visibility-toggle");
    if (visBtn) {
      visBtn.innerHTML = visible ? this.INLINE_ICONS.EYE_VISIBLE : this.INLINE_ICONS.EYE_HIDDEN;
      visBtn.title = visible ? "Ocultar camada" : "Mostrar camada";
    }
  }

  /**
   * Atualiza indicador visual de bloqueio de uma camada
   * @param {string} layerId - ID da camada
   * @param {boolean} locked - Novo estado de bloqueio
   */
  _updateLayerLockIndicator(layerId, locked) {
    if (!this.container) return;

    const layerContainer = this.container.querySelector(
      `.layer-container[data-layer-id="${layerId}"]`
    );
    if (!layerContainer) return;

    // Atualizar classe do container
    if (locked) {
      layerContainer.classList.add("layer-locked");
    } else {
      layerContainer.classList.remove("layer-locked");
    }

    // Atualizar botão e ícone
    const lockBtn = layerContainer.querySelector(".layer-header .lock-toggle");
    if (lockBtn) {
      lockBtn.innerHTML = locked ? this.INLINE_ICONS.LOCK_LOCKED : this.INLINE_ICONS.LOCK_UNLOCKED;
      lockBtn.title = locked ? "Desbloquear camada" : "Bloquear camada";
      
      // Atualizar cor do SVG
      const svg = lockBtn.querySelector("svg");
      if (svg) {
        svg.style.color = locked ? "#dc3545" : "";
      }
    }
  }

  _setupEventListeners() {
    this._sourceDataHandler = (e) => this._handleSourceData(e);
    this.map.on('sourcedata', this._sourceDataHandler);

    this._groupsChangedHandler = () => this._scheduleRefresh();
    document.addEventListener('groups-changed', this._groupsChangedHandler);

    this._layersChangedHandler = () => {
      if (this._suppressLayersChangedRefresh) return;
      this._scheduleRefresh();
    };
    document.addEventListener('layers-changed', this._layersChangedHandler);
  }

  _removeEventListeners() {
    if (this._sourceDataHandler) {
      this.map.off('sourcedata', this._sourceDataHandler);
      this._sourceDataHandler = null;
    }
    if (this._groupsChangedHandler) {
      document.removeEventListener('groups-changed', this._groupsChangedHandler);
      this._groupsChangedHandler = null;
    }
    // NEW: Remove layer listener
    if (this._layersChangedHandler) {
      document.removeEventListener('layers-changed', this._layersChangedHandler);
      this._layersChangedHandler = null;
    }
  }

  _handleSourceData(e) {
    if (!this._isVisible) return;
    if (this._suppressRefresh) return; // Ignora se estamos em atualização interna
    if (!this._isRelevantSource(e.sourceId)) return;
    this._scheduleRefresh();
  }

  _isRelevantSource(sourceId) {
    return this.FEATURE_SOURCES.includes(sourceId);
  }

  /**
   * Lista de sources de features do mapa
   */
  FEATURE_SOURCES = [
    'points', 'lines', 'polygons', 'texts', 'images',
    'circles', 'rectangles', 'ellipses', 'brushes', 'arrows',
    'boundarys', 'occupied_fronts', 'military_symbols',
    'coordination_measures', 'los', 'visibility'
  ];

  /**
   * Obtém features diretamente dos sources do mapa (não do IndexedDB)
   * Isso garante que mudanças não salvas sejam refletidas no painel
   */
  async _getFeaturesFromMapSources() {
    const features = {};
    
    for (const sourceId of this.FEATURE_SOURCES) {
      features[sourceId] = [];
      
      const source = this.map.getSource(sourceId);
      if (!source) continue;
      
      try {
        const data = await source.getData();
        if (data && data.features) {
          features[sourceId] = data.features;
        }
      } catch (error) {
        // Source pode não ter getData() ou estar vazio
        console.debug(`Não foi possível obter dados do source ${sourceId}:`, error.message);
      }
    }
    
    return features;
  }

  _scheduleRefresh() {
    if (!this._isVisible) return;
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this.loadFeatures();
    }, 300);
  }

  destroy() {
    this._removeEventListeners();
    clearTimeout(this._debounceTimer);
    
    // Destruir instância do Sortable
    if (this._sortableInstance) {
      this._sortableInstance.destroy();
      this._sortableInstance = null;
    }
  }

  async show() {
    if (this.container) {
      this._isVisible = true;
      this.container.style.display = "block";

      if (!this._sourceDataHandler) {
        this._setupEventListeners();
      }

      // Carregar estado do hillshade se o control existe
      const hillshadeContainer =
        this.container.querySelector(".hillshade-control");
      if (hillshadeContainer) {
        await this.loadHillshadeState();
      }

      // Renderizar analysis layers usando o manager
      await this.renderAnalysisLayersControl();

      await this.loadFeatures();
    }
  }

  hide() {
    if (this.container) {
      this._isVisible = false;
      this.container.style.display = "none";
      clearTimeout(this._debounceTimer);
    }
  }

  // ===== HILLSHADE CONTROL METHODS =====

  async handleHillshadeToggle(event) {
    const enabled = event.target.checked;

    // 1. Salvar no store
    await setMapHillshadeState(enabled);

    // 2. Aplicar mudança via terrain control
    this.applyHillshadeState(enabled);
  }

  applyHillshadeState(enabled) {
    const terrainControl = this.map._controls?.find(
      (control) => control.constructor.name === "TerrainControl"
    );

    if (terrainControl && terrainControl.setHillshadeVisibility) {
      terrainControl.setHillshadeVisibility(enabled);
    }
  }

  async loadHillshadeState() {
    const enabled = await getMapHillshadeState();
    const checkbox = this.container.querySelector("#hillshade-toggle");
    if (checkbox) {
      checkbox.checked = enabled;
      this.applyHillshadeState(enabled);
    }
  }
}

export default FeaturesTab;