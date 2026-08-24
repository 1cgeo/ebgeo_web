// Path: js/base-layer-selector/base-layer-selector.control.js

/**
 * @fileoverview Base layer selector control.
 * Compact thumbnail-based selector for switching map base layers.
 */

import { LAYER_THUMBNAILS } from './base-layer-selector.constants.js';
import { EventTypes } from '@events/event_types.js';
import config from '@js/config.js';
import {
    setupCleanup,
    subscribe,
    addDomListener,
    cleanup,
    removeElement
} from '@utils/event-cleanup.js';
import { isCurrentMapLockedSync } from '@store/index.js';
import {
    canShareResource,
    isPrivateResource,
    resourceAccessOrigin
} from '@store/sync/resource-access.service.js';
import { privateBadgePhrase } from '@catalog/access-origin-phrases.js';

/** Static icon (no user data) for the share affordance of a private base layer. */
const ICON_SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4"/><path d="m15.4 6.5-6.8 4"/></svg>';

/**
 * Base layer selector control.
 */
export class BaseLayerSelectorControl {
    /**
     * @param {Object} dependencies - Required dependencies
     * @param {Object} dependencies.baseLayerControl - Existing BaseLayerControl instance
     * @param {Object} dependencies.eventBus - EventBus instance
     * @param {Object} dependencies.stateManager - StateManager instance
     */
    constructor(dependencies) {
        this._baseLayerControl = dependencies.baseLayerControl;
        this._eventBus = dependencies.eventBus;
        this._stateManager = dependencies.stateManager;

        this._container = null;
        this._collapsedView = null;
        this._expandedView = null;
        this._thumbnails = new Map();
        this._isExpanded = false;
        this._enabledLayers = [];

        setupCleanup(this);
    }

    /**
     * Initializes the selector and attaches to DOM.
     * @param {HTMLElement} parentElement - Parent to attach to
     */
    init(parentElement) {
        // Get enabled layers from config
        this._loadEnabledLayers();

        // Create container
        this._container = document.createElement('div');
        this._container.className = 'base-layer-selector';
        this._container.id = 'base-layer-selector';
        this._container.dataset.expanded = 'false';
        this._container.dataset.sidebarState = 'collapsed';

        // Create collapsed view (thumbnail)
        this._collapsedView = this._createCollapsedView();
        this._container.appendChild(this._collapsedView);

        // Create expanded view (grid)
        this._expandedView = this._createExpandedView();
        this._container.appendChild(this._expandedView);

        parentElement.appendChild(this._container);

        // Setup event listeners
        this._setupEventListeners();

        // Sync initial state
        this._syncCurrentLayer();

        // Apply initial lock state
        this._applyMapLockState();
    }

    /**
     * Loads enabled layers from config.
     * @private
     */
    _loadEnabledLayers() {
        try {
            this._enabledLayers = config.getEnabledBasemaps().map(([id, cfg]) => ({
                id,
                config: cfg,
            }));
        } catch (_e) {
            // Fallback to default layers
            this._enabledLayers = [
                { id: 'carta-topografica', config: { name: 'Topográfica' } },
                { id: 'osm', config: { name: 'OpenStreetMap' } },
            ];
        }
    }

    /**
     * Creates the collapsed view (single thumbnail).
     * @private
     * @returns {HTMLElement}
     */
    _createCollapsedView() {
        const collapsed = document.createElement('div');
        collapsed.className = 'base-layer-collapsed';

        // Thumbnail preview
        const thumbnail = document.createElement('div');
        thumbnail.className = 'base-layer-thumbnail';
        thumbnail.id = 'base-layer-current-thumb';

        // Create image element
        const img = document.createElement('img');
        img.id = 'base-layer-current-img';
        img.alt = 'Camada base atual';
        thumbnail.appendChild(img);

        // Label
        const label = document.createElement('div');
        label.className = 'base-layer-label';
        label.id = 'base-layer-current-label';
        label.textContent = 'Topográfica';

        collapsed.appendChild(thumbnail);
        collapsed.appendChild(label);

        addDomListener(this, collapsed, 'click', (e) => {
            e.stopPropagation();
            this._toggleExpanded();
        });

        return collapsed;
    }

    /**
     * Creates the expanded view (grid of options).
     * @private
     * @returns {HTMLElement}
     */
    _createExpandedView() {
        const expanded = document.createElement('div');
        expanded.className = 'base-layer-expanded';
        expanded.setAttribute('role', 'listbox');
        expanded.setAttribute('aria-label', 'Camadas base disponíveis');

        // Grid container
        const grid = document.createElement('div');
        grid.className = 'base-layer-grid';

        this._enabledLayers.forEach(({ id, config: layerConfig }) => {
            const option = this._createLayerOption(id, layerConfig);
            grid.appendChild(option);
        });

        expanded.appendChild(grid);

        return expanded;
    }

    /**
     * Creates a layer option element.
     * @private
     * @param {string} layerId - Layer ID
     * @param {Object} layerConfig - Layer configuration from config.js
     * @returns {HTMLElement}
     */
    _createLayerOption(layerId, layerConfig) {
        const option = document.createElement('div');
        option.className = 'base-layer-option';
        option.dataset.layerId = layerId;
        option.dataset.selected = 'false';
        option.setAttribute('role', 'option');
        option.setAttribute('aria-label', layerConfig.name);
        option.tabIndex = 0;

        // Thumbnail
        const thumb = document.createElement('div');
        thumb.className = 'base-layer-option-thumb';

        const img = document.createElement('img');
        const thumbnailConfig = LAYER_THUMBNAILS[layerId];

        // Priority: config.image > LAYER_THUMBNAILS.thumbnail > fallback gradient
        const imageUrl = layerConfig.image || thumbnailConfig?.thumbnail;

        if (imageUrl) {
            img.src = imageUrl;
        } else {
            // Use fallback gradient as background
            thumb.style.background = thumbnailConfig?.fallbackGradient ||
                'linear-gradient(135deg, #ccc 0%, #999 100%)';
        }

        img.alt = layerConfig.name;
        img.loading = 'lazy';

        img.onerror = () => {
            img.style.display = 'none';
            const gradient = thumbnailConfig?.fallbackGradient ||
                'linear-gradient(135deg, #ccc 0%, #999 100%)';
            thumb.style.background = gradient;
        };

        // A miniatura só entra na árvore quando existe fonte para ela. Um `<img>` sem `src`
        // desenha o texto do ALT dentro do quadrado, por cima do gradiente de fallback — e a
        // camada base sem miniatura deixou de ser exceção: toda basemap criada pelo painel
        // nasce sem imagem, e a concedida é justamente uma dessas. O nome já aparece abaixo.
        if (imageUrl) {
            thumb.appendChild(img);
        }

        // O SELO DE RECURSO PRIVADO, o mesmo do cartão do catálogo e pela mesma razão: a
        // camada base privada chega aqui pelo payload aditivo (papel global, concessão
        // pessoal ou empréstimo do atlas em foco), e é indistinguível de uma pública se
        // ninguém disser. Quem a vê precisa saber que ela não está no acervo de todos —
        // e, no caso do empréstimo, que ela sai da lista ao sair do atlas.
        //
        // AS TRÊS ORIGENS SE DISTINGUEM DESDE 2026-08-24, e a frase única de antes ("só quem
        // recebeu acesso a enxerga") era falsa para quem enxerga por PAPEL. O rótulo curto é
        // exigência de tela: o selo mora sobre uma miniatura de duas colunas.
        const privado = isPrivateResource('basemaps', layerId);
        if (privado) {
            const origem = resourceAccessOrigin('basemaps', layerId) ?? null;
            const selagem = privateBadgePhrase(origem, { sujeito: 'Camada base privada' });
            const selo = document.createElement('span');
            selo.className = 'base-layer-option-badge';
            if (selagem.volatil) selo.classList.add('base-layer-option-badge--lent');
            selo.dataset.testid = 'base-layer-private';
            selo.dataset.origem = selagem.origem ?? 'desconhecida';
            selo.textContent = selagem.rotuloCurto;
            selo.title = selagem.title;
            thumb.appendChild(selo);
        }

        // Name
        const name = document.createElement('div');
        name.className = 'base-layer-option-name';
        name.textContent = thumbnailConfig?.label || layerConfig.name;

        option.appendChild(thumb);
        option.appendChild(name);

        // "Compartilhar": só em camada base PRIVADA e só para quem pode repassar (papel
        // global, ou concessão de nível `view_share`).
        //
        // ELE MORA AQUI PORQUE A SUPERFÍCIE DO BASEMAP É ESTE SELETOR. Os outros quatro
        // tipos de recurso têm cartão no catálogo, e é lá que o botão deles vive; o
        // basemap não tem cartão nenhum, então sem este botão um administrador poderia
        // tornar uma camada base privada e ninguém teria como conceder acesso a ela por
        // tela alguma — meia regra, que é exatamente o buraco que a migração 021 fechou
        // do lado do servidor. O painel de Administração NÃO serve para isto: o modal de
        // compartilhamento arrasta o motor de sync, e `admin.html` boota sem a store.
        if (privado && canShareResource('basemaps', layerId)) {
            option.appendChild(this._createShareButton(layerId, layerConfig.name || layerId));
        }

        // Store reference
        this._thumbnails.set(layerId, option);

        // Event listeners
        addDomListener(this, option, 'click', (e) => {
            e.stopPropagation();
            this._handleLayerSelect(layerId);
        });

        addDomListener(this, option, 'keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this._handleLayerSelect(layerId);
            }
        });

        return option;
    }

    /**
     * The "Compartilhar" button of a private base layer.
     *
     * The modal is loaded on demand (`import()`), not statically: it is the catalog's sharing UI,
     * it drags the sync engine with it, and no anonymous boot should pay for a button that only a
     * logged-in grantee ever sees.
     * @private
     * @param {string} layerId - The RAW basemap id (`resource_grants.resource_id`).
     * @param {string} layerName - Display name, for the modal heading.
     * @returns {HTMLElement}
     */
    _createShareButton(layerId, layerName) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'base-layer-option-share';
        btn.dataset.testid = 'base-layer-share';
        btn.title = `Compartilhar ${layerName}`;
        btn.setAttribute('aria-label', `Compartilhar ${layerName}`);
        btn.innerHTML = ICON_SHARE;
        addDomListener(this, btn, 'click', async (e) => {
            // Sem isto o clique escolheria a camada, que é o que o resto do cartão faz.
            e.stopPropagation();
            try {
                const { showResourceShareModal } = await import('@catalog/resource-share.modal.js');
                showResourceShareModal({
                    resourceType: 'basemap',
                    resourceId: layerId,
                    resourceName: layerName,
                });
            } catch (error) {
                console.error('[base-layer-selector] falha ao abrir o compartilhamento:', error);
            }
        });
        return btn;
    }

    /**
     * Sets up event listeners.
     * @private
     */
    _setupEventListeners() {
        // Close on click outside
        addDomListener(this, document, 'click', (e) => {
            if (!this._container.contains(e.target)) {
                this._collapse();
            }
        });

        // Close on escape
        addDomListener(this, document, 'keydown', (e) => {
            if (e.key === 'Escape' && this._isExpanded) {
                this._collapse();
            }
        });

        // UI_LAYOUT_CHANGED covers all sidebar/panel state changes
        subscribe(this, this._eventBus, EventTypes.UI_LAYOUT_CHANGED,
            () => this._updatePosition());

        // Close on any popup close event
        subscribe(this, this._eventBus, EventTypes.UI_CLOSE_ALL_POPUPS,
            () => this._collapse());

        // Listen for base layer changes to sync the selector
        subscribe(this, this._eventBus, EventTypes.BASE_LAYER_CHANGED,
            (payload) => this._setActiveLayer(payload.layer));

        // Listen for map lock changes
        subscribe(this, this._eventBus, EventTypes.MAP_LOCK_CHANGED,
            () => this._applyMapLockState());

        // Per-atlas config changed (Gestor restricted the basemaps, or connect/disconnect) —
        // rebuild the available-basemaps grid and switch off any now-unavailable selection.
        subscribe(this, this._eventBus, EventTypes.ATLAS_SETTINGS_CHANGED,
            () => this.regateBasemaps());
    }

    /**
     * Re-gates the basemap list against the current config (after a per-atlas overlay apply/revert):
     * rebuilds the expanded grid and, if the active basemap is no longer available, switches to the
     * first available one.
     */
    regateBasemaps() {
        this._loadEnabledLayers();
        const availableIds = new Set(this._enabledLayers.map((l) => l.id));

        const grid = this._expandedView?.querySelector('.base-layer-grid');
        if (grid) {
            this._thumbnails.clear();
            grid.textContent = '';
            this._enabledLayers.forEach(({ id, config: layerConfig }) => {
                grid.appendChild(this._createLayerOption(id, layerConfig));
            });
        }

        let current = 'carta-topografica';
        try {
            current = this._stateManager?.get('baseLayer.activeLayer')
                || this._baseLayerControl?.currentLayer || current;
        } catch (_e) {
            // Use default.
        }
        if (!availableIds.has(current) && this._enabledLayers.length > 0) {
            this._handleLayerSelect(this._enabledLayers[0].id);
        } else {
            this._syncCurrentLayer();
        }
    }

    /**
     * Shows or hides the selector based on map lock state.
     * @private
     */
    _applyMapLockState() {
        if (!this._container) return;
        const locked = isCurrentMapLockedSync();
        this._container.style.display = locked ? 'none' : '';
    }

    /**
     * Toggles expanded state.
     * @private
     */
    _toggleExpanded() {
        if (this._isExpanded) {
            this._collapse();
        } else {
            this._expand();
        }
    }

    /**
     * Expands the panel.
     * @private
     */
    _expand() {
        this._isExpanded = true;
        this._container.dataset.expanded = 'true';

        // Emit event for other components
        this._eventBus.emit(EventTypes.BASE_LAYER_SELECTOR_OPENED, {});
    }

    /**
     * Collapses the panel.
     * @private
     */
    _collapse() {
        if (!this._isExpanded) return;

        this._isExpanded = false;
        this._container.dataset.expanded = 'false';

        // Emit event for other components
        this._eventBus.emit(EventTypes.BASE_LAYER_SELECTOR_CLOSED, {});
    }

    /**
     * Handles layer selection.
     * @private
     * @param {string} layerId - Selected layer ID
     */
    async _handleLayerSelect(layerId) {
        // Update visual state immediately
        this._setActiveLayer(layerId);

        // Collapse panel
        this._collapse();

        // Delegate to existing BaseLayerControl
        if (this._baseLayerControl) {
            try {
                // Simulate radio input change event
                const fakeEvent = { target: { value: layerId } };
                await this._baseLayerControl.handleLayerChange(fakeEvent);
            } catch (error) {
                console.error('Error changing base layer:', error);
            }
        }
    }

    /**
     * Sets the active layer visually.
     * @private
     * @param {string} layerId - Layer ID to set as active
     */
    _setActiveLayer(layerId) {
        // Update option elements
        this._thumbnails.forEach((element, id) => {
            element.dataset.selected = (id === layerId).toString();
            element.setAttribute('aria-selected', (id === layerId).toString());
        });

        // Update current layer preview
        this._updateCurrentLayerPreview(layerId);
    }

    /**
     * Updates the current layer preview (collapsed view).
     * @private
     * @param {string} layerId - Current layer ID
     */
    _updateCurrentLayerPreview(layerId) {
        const img = document.getElementById('base-layer-current-img');
        const label = document.getElementById('base-layer-current-label');
        const thumb = document.getElementById('base-layer-current-thumb');

        if (!img || !label || !thumb) return;

        const thumbnailConfig = LAYER_THUMBNAILS[layerId];
        const layerInfo = this._enabledLayers.find(l => l.id === layerId);

        // Priority: config.image > LAYER_THUMBNAILS.thumbnail > fallback gradient
        const imageUrl = layerInfo?.config?.image || thumbnailConfig?.thumbnail;

        if (imageUrl) {
            img.src = imageUrl;
            img.style.display = 'block';
            thumb.style.background = '';

            img.onerror = () => {
                img.style.display = 'none';
                thumb.style.background = thumbnailConfig?.fallbackGradient ||
                    'linear-gradient(135deg, #ccc 0%, #999 100%)';
            };
        } else {
            img.style.display = 'none';
            thumb.style.background = thumbnailConfig?.fallbackGradient ||
                'linear-gradient(135deg, #ccc 0%, #999 100%)';
        }

        label.textContent = thumbnailConfig?.label ||
            layerInfo?.config?.name || layerId;
    }

    /**
     * Syncs with current layer from BaseLayerControl/StateManager.
     * @private
     */
    _syncCurrentLayer() {
        let currentLayer = 'carta-topografica';

        try {
            currentLayer = this._stateManager?.get('baseLayer.activeLayer')
                || this._baseLayerControl?.currentLayer
                || 'carta-topografica';
        } catch (_e) {
            // Use default
        }

        this._setActiveLayer(currentLayer);
    }

    /**
     * Updates position based on sidebar state.
     * @private
     */
    _updatePosition() {
        if (!this._container) return;

        const sidebarExpanded = this._stateManager?.getUnsafe('sidebar.expanded') || false;
        const featurePanelOpen = this._stateManager?.getUnsafe('ui.featurePanelOpen') || false;

        this._container.dataset.sidebarState =
            (sidebarExpanded || featurePanelOpen) ? 'expanded' : 'collapsed';
    }

    /**
     * Destroys the control.
     */
    destroy() {
        this._thumbnails.clear();

        cleanup(this);
        removeElement(this._container);
        this._container = null;
    }
}
