// Path: js\controls_sig\features_tab.js
import {
    getCurrentMapFeatures,
    updateFeatureProperty,
    getFeatureById,
    getMapHillshadeState,
    setMapHillshadeState,
    getMapAnalysisLayersStates,
    getFeatureDisplayNameFromStorage,
    getFeatureIconFromStorage,
    getAllStorageTypes
} from './store/store.js';
import { FeatureNavigationUtils } from './utilities/feature_navigation_utils.js';
import config from '../config.js';

class FeaturesTab {
    constructor(map, selectionManager = null, analysisLayersManager) {
        this.map = map;
        this.selectionManager = selectionManager;
        this.container = null;
        
        this.analysisLayersManager = analysisLayersManager;

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
            </svg>`
        };
    }

    createUI() {
        this.container = document.createElement('div');
        this.container.className = 'features-tab-content';
        this.container.style.display = 'none';

        // Criar hillshade control apenas se habilitado no config
        const hillshadeContainer = this.createHillshadeControl();
        if (hillshadeContainer) {
            this.container.appendChild(hillshadeContainer);
        }

        // Analysis Layers Control
        const analysisLayersContainer = this.createAnalysisLayersControl();
        this.container.appendChild(analysisLayersContainer);

        // Header with refresh button
        const header = this.createHeader();
        this.container.appendChild(header);

        const featuresList = document.createElement('div');
        featuresList.className = 'features-list';
        this.container.appendChild(featuresList);

        // Adicionar estilos CSS para analysis layers
        this.addAnalysisLayersStyles();

        return this.container;
    }

    /**
     * Adiciona estilos CSS para analysis layers com botões de zoom
     */
    addAnalysisLayersStyles() {
        if (!document.getElementById('analysis-layers-styles')) {
            const style = document.createElement('style');
            style.id = 'analysis-layers-styles';
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
        const terrainControl = this.map._controls?.find(control =>
            control.constructor.name === 'TerrainControl'
        );

        if (!config.map2d?.hillshade?.enabled) {
            return null;
        }

        const hillshadeContainer = document.createElement('div');
        hillshadeContainer.className = 'hillshade-control';
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

        const checkbox = hillshadeContainer.querySelector('#hillshade-toggle');
        checkbox.onchange = this.handleHillshadeToggle.bind(this);

        return hillshadeContainer;
    }

    createAnalysisLayersControl() {
        const container = document.createElement('div');
        container.className = 'analysis-layers-control';
        container.style.cssText = `
            border-bottom: 1px solid #e0e0e0;
            background-color: #f8f9fa;
            display: none;
        `;
        return container;
    }

    createHeader() {
        const header = document.createElement('div');
        header.className = 'features-tab-header';
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 12px;
            border-bottom: 1px solid #e0e0e0;
            background-color: #f8f9fa;
        `;

        const title = document.createElement('span');
        title.textContent = 'Feições';
        title.style.cssText = 'font-weight: 500; font-size: 14px;';

        const refreshButton = document.createElement('button');
        refreshButton.className = 'refresh-button';
        refreshButton.innerHTML = '🔄';
        refreshButton.title = 'Atualizar lista';
        refreshButton.style.cssText = `
            background: none;
            border: 1px solid #ccc;
            border-radius: 4px;
            padding: 4px 8px;
            cursor: pointer;
            font-size: 14px;
            transition: opacity 0.2s ease;
        `;

        refreshButton.onclick = async () => {
            refreshButton.disabled = true;
            refreshButton.style.opacity = '0.6';
            refreshButton.style.cursor = 'not-allowed';

            await this.loadFeatures();

            setTimeout(() => {
                refreshButton.disabled = false;
                refreshButton.style.opacity = '1';
                refreshButton.style.cursor = 'pointer';
            }, 100);
        };

        header.appendChild(title);
        header.appendChild(refreshButton);

        return header;
    }

    /**
     * Renderiza o controle de analysis layers usando o manager
     */
    async renderAnalysisLayersControl() {
        const container = this.container.querySelector('.analysis-layers-control');
        if (!container) return;

        // Verificar se o sistema está habilitado
        if (!this.analysisLayersManager.isEnabled()) {
            container.style.display = 'none';
            return;
        }

        // Construir HTML
        container.innerHTML = this.buildAnalysisLayersHTML();
        
        // Configurar eventos
        await this.attachAnalysisLayersEvents(container);
        
        // Mostrar container
        container.style.display = 'block';
    }

    /**
     * Constrói HTML do controle de analysis layers com botões de zoom
     * @returns {string} HTML do controle
     */
    buildAnalysisLayersHTML() {
        const layersConfig = this.analysisLayersManager.getLayersConfig();
        
        let html = `<div class="analysis-layers-header">Camadas de Análise</div>`;

        // Criar checkbox e botão de zoom para cada layer configurada
        layersConfig.forEach(layerConfig => {
            html += `
                <div class="analysis-layer-item">
                    <label class="analysis-layer-label">
                        <input type="checkbox" data-layer-id="${layerConfig.id}">
                        <span title="${layerConfig.description || ''}">${layerConfig.name}</span>
                    </label>
                    <button class="analysis-layer-zoom" data-layer-id="${layerConfig.id}" title="Zoom para ${layerConfig.name}">
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
        container.querySelectorAll('input[data-layer-id]').forEach(checkbox => {
            const layerId = checkbox.dataset.layerId;
            const layerConfig = this.analysisLayersManager.getLayersConfig().find(l => l.id === layerId);
            
            // Definir estado inicial baseado no estado salvo ou defaultVisibility
            checkbox.checked = layersStates[layerId] ?? layerConfig?.defaultVisibility ?? false;
            
            // Event listener para mudanças
            checkbox.onchange = async (e) => {
                await this.analysisLayersManager.toggleLayer(layerId, e.target.checked);
            };
        });

        // Configurar botões de zoom
        container.querySelectorAll('.analysis-layer-zoom').forEach(button => {
            button.onclick = (e) => {
                e.stopPropagation();
                const layerId = button.dataset.layerId;
                this.analysisLayersManager.zoomToLayer(layerId);
            };
        });
    }

    showLoadingSpinner() {
        const featuresList = this.container.querySelector('.features-list');
        featuresList.innerHTML = `
        <div class="features-loading">
            <div class="spinner"></div>
            <div class="loading-text">Atualizando...</div>
        </div>
    `;

        // Adicionar CSS do spinner dinamicamente se não existir
        if (!document.querySelector('#features-spinner-styles')) {
            const style = document.createElement('style');
            style.id = 'features-spinner-styles';
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

        // Mostrar spinner
        this.showLoadingSpinner();

        try {
            // Garantir pelo menos 500ms de delay para o feedback visual
            const [features] = await Promise.all([
                getCurrentMapFeatures(),
                new Promise(resolve => setTimeout(resolve, 100))
            ]);

            const flatFeatures = this.flattenAndSortFeatures(features);
            this.renderUI(flatFeatures);

        } catch (error) {
            console.error('Erro ao carregar features:', error);

            // Em caso de erro, mostrar mensagem
            const featuresList = this.container.querySelector('.features-list');
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

    flattenAndSortFeatures(features) {
        const flatFeatures = [];
        const validStorageTypes = getAllStorageTypes();

        // Converter features agrupadas em array plano
        Object.entries(features).forEach(([type, featureArray]) => {
            if (!validStorageTypes.includes(type)) {
                return; // Ignora processed_los, processed_visibility, etc.
            }
            if (featureArray.length > 0) {
                featureArray.forEach(feature => {
                    flatFeatures.push({
                        id: feature.properties.id,
                        name: feature.properties.nome || 'Sem nome',
                        visible: feature.properties.visivel ?? true,
                        locked: feature.properties.bloqueado ?? false,
                        rawFeature: feature,
                        type: type,
                        typeLabel: getFeatureDisplayNameFromStorage(type)
                    });
                });
            }
        });

        // Ordenar por tipo alfabético, depois por nome
        flatFeatures.sort((a, b) => {
            // Primeiro por tipo
            const typeCompare = a.typeLabel.localeCompare(b.typeLabel, 'pt-BR');
            if (typeCompare !== 0) return typeCompare;

            // Depois por nome
            return a.name.localeCompare(b.name, 'pt-BR');
        });

        return flatFeatures;
    }

    renderUI(flatFeatures) {
        const featuresList = this.container.querySelector('.features-list');
        featuresList.innerHTML = '';

        if (flatFeatures.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.className = 'features-empty-message';
            emptyMessage.style.cssText = `
                padding: 20px;
                text-align: center;
                color: #666;
                font-size: 14px;
                font-style: italic;
                background-color: #ffffff;
                border-radius: 4px;
            `;
            emptyMessage.textContent = 'Sem feições no mapa';
            featuresList.appendChild(emptyMessage);
            return;
        }

        flatFeatures.forEach(feature => {
            const item = this.createFeatureItem(feature);
            featuresList.appendChild(item);
        });
    }

    createFeatureItem(feature) {
        const item = document.createElement('div');
        item.className = 'feature-item';
        item.dataset.featureId = feature.id;
        item.dataset.featureType = feature.type;

        const typeIconPath = getFeatureIconFromStorage(feature.type);
        const typeIconAlt = feature.typeLabel;
        const visibilityIcon = feature.visible ? this.INLINE_ICONS.EYE_VISIBLE : this.INLINE_ICONS.EYE_HIDDEN;
        const visibilityTitle = feature.visible ? 'Ocultar' : 'Mostrar';
        const lockIcon = feature.locked ? this.INLINE_ICONS.LOCK_LOCKED : this.INLINE_ICONS.LOCK_UNLOCKED;
        const lockTitle = feature.locked ? 'Desbloquear' : 'Bloquear';

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
        const nameDiv = item.querySelector('.feature-name');
        nameDiv.addEventListener('click', () => this.handleFeatureClick(feature));

        const visibilityBtn = item.querySelector('.visibility-toggle');
        visibilityBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleVisibility(feature.id, feature.type);
        });

        const lockBtn = item.querySelector('.lock-toggle');
        lockBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleLock(feature.id, feature.type);
        });

        if (!feature.visible) {
            item.classList.add('feature-hidden');
        }
        if (feature.locked) {
            item.classList.add('feature-locked');
        }
        return item;
    }

    /**
     * Manipula o clique na feature: zoom + seleção (verifica bloqueio atual)
     */
    async handleFeatureClick(feature) {
        try {
            // Verificar estado atual da feature via IndexedDB (não rawFeature)
            const currentFeature = await getFeatureById(feature.type, feature.id);
            const isLocked = currentFeature?.properties?.bloqueado ?? false;

            if (isLocked) {
                await FeatureNavigationUtils.zoomToFeature(feature.rawFeature, this.map);
                return;
            }

            // Se não bloqueada: zoom + seleção normal
            await FeatureNavigationUtils.zoomAndSelectFeature(
                feature.rawFeature,
                this.map,
                this.selectionManager,
                feature.type,
                feature.id
            );
        } catch (error) {
            console.error('Erro ao navegar para feature:', error);

            // Fallback: apenas fazer zoom sem seleção
            try {
                await FeatureNavigationUtils.zoomToFeature(feature.rawFeature, this.map);
            } catch (fallbackError) {
                console.error('Erro no fallback de zoom:', fallbackError);
            }
        }
    }

    /**
     * SIMPLIFICADO: Toggle de visibilidade usando filtros de layer
     * Reutiliza lógica do toggleLock com propagateFeaturePropertyToSource
     */
    async toggleVisibility(featureId, featureType) {
        const feature = await getFeatureById(featureType, featureId);
        if (!feature) return;

        const newVisibility = !(feature.properties.visivel ?? true);

        // 1. Atualizar propriedade no store
        await updateFeatureProperty(featureType, featureId, 'visivel', newVisibility);

        // 2. Propagar para source do mapa (reutiliza lógica do lock)
        this.propagateFeaturePropertyToSource(featureType, featureId, 'visivel', newVisibility);

        // 3. Atualizar botão visual (ícone de olho)
        this.updateVisibilityButton(featureId, newVisibility);

        // 4. Atualizar estado visual do item (classe CSS)
        this.updateItemVisualState(featureId, newVisibility, feature.properties.bloqueado ?? false);

        // 5. Desselecionar feature se ficou invisível e está selecionada
        if (!newVisibility && this.selectionManager?.isFeatureSelected) {
            const selectionManagerType = FeatureNavigationUtils.mapFeatureType(featureType);
            const isSelected = this.selectionManager.isFeatureSelected(selectionManagerType, featureId);

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
        await updateFeatureProperty(featureType, featureId, 'bloqueado', newLockState);

        // 2. Propagar para source do mapa
        this.propagateFeaturePropertyToSource(featureType, featureId, 'bloqueado', newLockState);

        // 3. Atualizar botão visual (ícone de cadeado)
        this.updateLockButton(featureId, newLockState);

        // 4. Atualizar estado visual do item (classe CSS)
        this.updateItemVisualState(featureId, feature.properties.visivel ?? true, newLockState);

        // 5. Desselecionar feature se foi bloqueada e está selecionada
        if (newLockState && this.selectionManager?.isFeatureSelected) {
            const selectionManagerType = FeatureNavigationUtils.mapFeatureType(featureType);
            const isSelected = this.selectionManager.isFeatureSelected(selectionManagerType, featureId);

            if (isSelected && this.selectionManager.deselectFeature) {
                this.selectionManager.deselectFeature(featureId, selectionManagerType);
            }
        }
    }

    /**
     * Propaga alteração de propriedade para o source do Mapbox
     * Pega todas as features do source, atualiza a específica e faz setData
     */
    propagateFeaturePropertyToSource(featureType, featureId, property, value) {
        const source = this.map.getSource(featureType);
        if (!source || !source._data) {
            console.warn(`Source ${featureType} não encontrado ou sem dados`);
            return;
        }

        try {
            // Pegar TODAS as features do source
            const data = JSON.parse(JSON.stringify(source._data));

            const featureIndex = data.features.findIndex(f =>
                (f.properties.id === featureId) || (f.id === featureId)
            );

            if (featureIndex !== -1) {
                // Atualizar propriedade na feature encontrada
                data.features[featureIndex].properties[property] = value;

                // Fazer setData com todo o conjunto atualizado
                source.setData(data);

            } else {
                console.warn(`Feature ${featureId} não encontrada no source ${featureType}`);
            }
        } catch (error) {
            console.error(`Erro ao propagar propriedade para source ${featureType}:`, error);
        }
    }

    updateVisibilityButton(featureId, visible) {
        const btn = this.container.querySelector(`[data-feature-id="${featureId}"] .visibility-toggle`);
        if (btn) {
            const icon = visible ? this.INLINE_ICONS.EYE_VISIBLE : this.INLINE_ICONS.EYE_HIDDEN;
            const title = visible ? 'Ocultar' : 'Mostrar';
            btn.innerHTML = icon;
            btn.title = title;
        }
    }

    updateLockButton(featureId, locked) {
        const btn = this.container.querySelector(`[data-feature-id="${featureId}"] .lock-toggle`);
        if (btn) {
            const icon = locked ? this.INLINE_ICONS.LOCK_LOCKED : this.INLINE_ICONS.LOCK_UNLOCKED;
            const title = locked ? 'Desbloquear' : 'Bloquear';
            btn.innerHTML = icon;
            btn.title = title;

            // Garantir que o SVG tenha a cor correta baseado no CSS
            const svg = btn.querySelector('svg');
            if (svg && locked) {
                svg.style.color = '#dc3545';
            } else if (svg) {
                // Remover estilo inline para usar CSS normal
                svg.style.color = '';
            }
        }
    }

    updateItemVisualState(featureId, visible, locked) {
        const item = this.container.querySelector(`[data-feature-id="${featureId}"]`);
        if (item) {
            // Remover classes antigas primeiro para evitar conflitos
            item.classList.remove('feature-hidden', 'feature-locked');

            // Aplicar classes baseado no estado atual
            if (!visible) {
                item.classList.add('feature-hidden');
            }

            if (locked) {
                item.classList.add('feature-locked');
            }

        } else {
            console.warn(`Item não encontrado para feature: ${featureId}`);
        }
    }

    async show() {
        if (this.container) {
            this.container.style.display = 'block';

            // Carregar estado do hillshade se o control existe
            const hillshadeContainer = this.container.querySelector('.hillshade-control');
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
            this.container.style.display = 'none';
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
        const terrainControl = this.map._controls?.find(control =>
            control.constructor.name === 'TerrainControl'
        );

        if (terrainControl && terrainControl.setHillshadeVisibility) {
            terrainControl.setHillshadeVisibility(enabled);
        }
    }

    async loadHillshadeState() {
        const enabled = await getMapHillshadeState();
        const checkbox = this.container.querySelector('#hillshade-toggle');
        if (checkbox) {
            checkbox.checked = enabled;
            this.applyHillshadeState(enabled);
        }
    }
}

export default FeaturesTab;