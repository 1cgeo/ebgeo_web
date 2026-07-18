// Path: js/phone/phone-drawer.js

/**
 * @fileoverview Left-side navigation drawer for phone layout.
 * Contains Maps, Tools, and Atalhos (chips) sections.
 * Each section has a collapsible header with chevron toggle.
 * Slides in from the left with a backdrop overlay.
 */

import { setupCleanup, addDomListener, cleanup } from '@utils/event-cleanup.js';
import { TOOL_GROUPS } from '@toolbar/toolbar.constants.js';
import { CATALOG_CHIP_CONFIG } from '@catalog/catalog.constants.js';

// ---------------------------------------------------------------------------
// SVG Icons
// ---------------------------------------------------------------------------

const CLOSE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

/** Drawer uses a 16x16 chevron (slightly larger than the bottom sheet's 14x14) */
const CHEVRON_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>';

const EYE_OPEN_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';

const EYE_CLOSED_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

// ---------------------------------------------------------------------------
// Chip configurations (icons from sidebar chips.component + catalog constants)
// ---------------------------------------------------------------------------

const CHIP_CONFIGS = [
    {
        id: 'catalog',
        label: CATALOG_CHIP_CONFIG.label,
        icon: CATALOG_CHIP_CONFIG.icon,
    },
    {
        id: 'tutorial',
        label: 'Tutorial',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    },
    {
        id: 'info',
        label: 'Informações',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    },
    {
        id: 'shortcuts',
        label: 'Atalhos',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"/><path d="M6 8h.001"/><path d="M10 8h.001"/><path d="M14 8h.001"/><path d="M18 8h.001"/><path d="M8 12h.001"/><path d="M12 12h.001"/><path d="M16 12h.001"/><path d="M7 16h10"/></svg>',
    },
];

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Left-side navigation drawer for phone layout.
 * Provides access to maps, tools, and quick-action chips.
 */
export class PhoneDrawer {
    /**
     * @param {Object} options
     * @param {import('maplibre-gl').Map} options.map - MapLibre map instance
     */
    constructor({ map }) {
        setupCleanup(this);
        this._map = map;

        // Callbacks
        /** @private @type {Function|null} */
        this._mapSelectCb = null;
        /** @private @type {Function|null} */
        this._toolSelectCb = null;
        /** @private @type {Function|null} */
        this._mapCreateCb = null;
        /** @private @type {Function|null} */
        this._mapImportCb = null;
        /** @private @type {Function|null} */
        this._mapRenameCb = null;
        /** @private @type {Function|null} */
        this._mapDeleteCb = null;
        /** @private @type {Function|null} */
        this._layerToggleCb = null;
        /** @private @type {Function|null} */
        this._chipSelectCb = null;

        // Collapsible section state (maps open by default)
        /** @private @type {{ maps: boolean, layers: boolean, tools: boolean, chips: boolean }} */
        this._sectionState = { maps: true, layers: false, tools: false, chips: false };

        // State
        /** @private @type {boolean} */
        this._isOpen = false;
        /** @private @type {Array<Object>} */
        this._maps = [];
        /** @private @type {string|null} */
        this._activeMapId = null;
        /** @private @type {Array<Object>} */
        this._layers = [];

        // DOM refs
        /** @private @type {HTMLElement|null} */
        this._backdrop = null;
        /** @private @type {HTMLElement|null} */
        this._drawer = null;
        /** @private @type {HTMLElement|null} */
        this._contentEl = null;
        /** @private @type {HTMLElement|null} */
        this._closeBtn = null;
        /** @private @type {HTMLElement|null} */
        this._mapsContainer = null;
        /** @private @type {HTMLElement|null} */
        this._layersContainer = null;
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    /**
     * Build and mount the drawer DOM into the given parent.
     * @param {HTMLElement} parent
     */
    mount(parent) {
        this._buildDOM();
        parent.appendChild(this._backdrop);
        parent.appendChild(this._drawer);
        this._bindEvents();
    }

    /**
     * Remove all DOM elements and clean up listeners.
     */
    destroy() {
        cleanup(this);
        this._backdrop?.remove();
        this._drawer?.remove();
        this._backdrop = null;
        this._drawer = null;
        this._contentEl = null;
        this._closeBtn = null;
        this._mapsContainer = null;
        this._layersContainer = null;
        this._mapSelectCb = null;
        this._toolSelectCb = null;
        this._mapCreateCb = null;
        this._mapImportCb = null;
        this._mapRenameCb = null;
        this._mapDeleteCb = null;
        this._layerToggleCb = null;
        this._chipSelectCb = null;
    }

    /**
     * Open the drawer with slide animation.
     */
    open() {
        this._isOpen = true;
        this._backdrop.classList.add('phone-drawer-backdrop--open');
        this._drawer.classList.add('phone-drawer--open');
    }

    /**
     * Close the drawer.
     */
    close() {
        this._isOpen = false;
        this._backdrop.classList.remove('phone-drawer-backdrop--open');
        this._drawer.classList.remove('phone-drawer--open');
    }

    /**
     * Whether the drawer is currently open.
     * @returns {boolean}
     */
    isOpen() {
        return this._isOpen;
    }

    // ========================================================================
    // DATA UPDATES (called by orchestrator)
    // ========================================================================

    /**
     * Update the maps list.
     * @param {Array<Object>} maps - Array of map objects with id, nome/name
     * @param {string} activeMapId - Currently active map ID
     */
    updateMaps(maps, activeMapId) {
        this._maps = maps;
        this._activeMapId = activeMapId;
        this._renderMapsContent();
    }

    /**
     * Update the layers list.
     * @param {Array<Object>} layers - Array of layer objects with id, nome, visivel, color
     */
    updateLayers(layers) {
        this._layers = layers || [];
        this._renderLayersContent();
    }

    // ========================================================================
    // CALLBACK REGISTRATION
    // ========================================================================

    /**
     * Register callback for map selection.
     * @param {Function} cb - (mapId: string) => void
     */
    onMapSelect(cb) { this._mapSelectCb = cb; }

    /**
     * Register callback for tool selection.
     * @param {Function} cb - (controlKey: string) => void
     */
    onToolSelect(cb) { this._toolSelectCb = cb; }

    /**
     * Register callback for new map creation.
     * @param {Function} cb - () => void
     */
    onMapCreate(cb) { this._mapCreateCb = cb; }

    /**
     * Register callback for map import action.
     * @param {Function} cb - () => void
     */
    onMapImport(cb) { this._mapImportCb = cb; }

    /**
     * Register callback for renaming the active map.
     * @param {Function} cb - (mapId: string) => void
     */
    onMapRename(cb) { this._mapRenameCb = cb; }

    /**
     * Register callback for deleting a map.
     * @param {Function} cb - (mapId: string) => void
     */
    onMapDelete(cb) { this._mapDeleteCb = cb; }

    /**
     * Register callback for layer visibility toggle.
     * @param {Function} cb - (layerId: string, visible: boolean) => void
     */
    onLayerToggle(cb) { this._layerToggleCb = cb; }

    /**
     * Register callback for chip selection.
     * @param {Function} cb - (chipId: string) => void, chipId is one of: 'catalog', 'tutorial', 'info', 'shortcuts'
     */
    onChipSelect(cb) { this._chipSelectCb = cb; }

    // ========================================================================
    // DOM CONSTRUCTION
    // ========================================================================

    /** @private */
    _buildDOM() {
        // Backdrop
        this._backdrop = document.createElement('div');
        this._backdrop.className = 'phone-drawer-backdrop';

        // Drawer container
        this._drawer = document.createElement('div');
        this._drawer.className = 'phone-drawer';

        // Header
        const header = document.createElement('div');
        header.className = 'phone-drawer__header';

        const title = document.createElement('div');
        title.className = 'phone-drawer__title';
        title.textContent = 'EBGeo';

        const closeBtn = document.createElement('button');
        closeBtn.className = 'phone-drawer__close';
        closeBtn.setAttribute('aria-label', 'Fechar');
        closeBtn.innerHTML = CLOSE_ICON_SVG;
        this._closeBtn = closeBtn;

        header.appendChild(title);
        header.appendChild(closeBtn);

        // Scrollable content
        this._contentEl = document.createElement('div');
        this._contentEl.className = 'phone-drawer__content';

        this._drawer.appendChild(header);
        this._drawer.appendChild(this._contentEl);

        // Build all sections
        this._renderContent();
    }

    /** @private */
    _renderContent() {
        this._contentEl.textContent = '';
        this._buildMapsSection();
        this._buildLayersSection();
        this._buildToolsSection();
        this._buildChipsSection();
    }

    // ========================================================================
    // COLLAPSIBLE SECTION HELPER
    // ========================================================================

    /**
     * Create a collapsible section with header, chevron, and content container.
     * @param {string} sectionKey - Key in _sectionState ('maps', 'tools', 'chips')
     * @param {string} title - Section title (Portuguese)
     * @returns {{ section: HTMLElement, content: HTMLElement }}
     * @private
     */
    _createCollapsibleSection(sectionKey, title) {
        const section = document.createElement('div');
        section.className = 'phone-drawer__section';

        // Clickable header button
        const headerBtn = document.createElement('button');
        headerBtn.className = 'phone-drawer__section-header';
        headerBtn.dataset.section = sectionKey;

        const titleSpan = document.createElement('span');
        titleSpan.className = 'phone-drawer__section-title';
        titleSpan.textContent = title;

        const chevronSpan = document.createElement('span');
        chevronSpan.className = 'phone-drawer__section-chevron';
        chevronSpan.innerHTML = CHEVRON_SVG;

        headerBtn.appendChild(titleSpan);
        headerBtn.appendChild(chevronSpan);

        // Content container
        const content = document.createElement('div');
        content.className = 'phone-drawer__section-content';

        // Apply initial collapsed/expanded state
        const expanded = this._sectionState[sectionKey];
        if (expanded) {
            chevronSpan.classList.add('phone-drawer__section-chevron--expanded');
        } else {
            content.classList.add('phone-drawer__section-content--collapsed');
        }

        section.appendChild(headerBtn);
        section.appendChild(content);
        this._contentEl.appendChild(section);

        return { section, content };
    }

    /**
     * Toggle a section's collapsed/expanded state.
     * @param {string} sectionKey - Key in _sectionState
     * @param {HTMLElement} headerBtn - The clicked header button
     * @private
     */
    _toggleSection(sectionKey, headerBtn) {
        const isExpanded = this._sectionState[sectionKey];
        this._sectionState[sectionKey] = !isExpanded;

        const section = headerBtn.closest('.phone-drawer__section');
        if (!section) return;

        const chevron = headerBtn.querySelector('.phone-drawer__section-chevron');
        const content = section.querySelector('.phone-drawer__section-content');

        if (this._sectionState[sectionKey]) {
            chevron?.classList.add('phone-drawer__section-chevron--expanded');
            content?.classList.remove('phone-drawer__section-content--collapsed');
        } else {
            chevron?.classList.remove('phone-drawer__section-chevron--expanded');
            content?.classList.add('phone-drawer__section-content--collapsed');
        }
    }

    // ========================================================================
    // MAPS SECTION
    // ========================================================================

    /** @private */
    _buildMapsSection() {
        const { content } = this._createCollapsibleSection('maps', 'Mapas');
        this._mapsContainer = content;

        // Action buttons row
        const actions = document.createElement('div');
        actions.className = 'phone-drawer__map-actions';

        const createBtn = document.createElement('button');
        createBtn.className = 'phone-drawer__action-btn';
        createBtn.dataset.action = 'create';
        createBtn.textContent = '+ Novo Mapa';

        const importBtn = document.createElement('button');
        importBtn.className = 'phone-drawer__action-btn';
        importBtn.dataset.action = 'import';
        importBtn.textContent = 'Importar';

        const renameBtn = document.createElement('button');
        renameBtn.className = 'phone-drawer__action-btn';
        renameBtn.dataset.action = 'rename';
        renameBtn.textContent = 'Renomear';

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'phone-drawer__action-btn phone-drawer__action-btn--danger';
        deleteBtn.dataset.action = 'delete';
        deleteBtn.textContent = 'Excluir';

        actions.appendChild(createBtn);
        actions.appendChild(importBtn);
        actions.appendChild(renameBtn);
        actions.appendChild(deleteBtn);
        content.appendChild(actions);

        // Show loading placeholder until updateMaps() provides real data
        const loading = document.createElement('div');
        loading.className = 'phone-drawer__loading';
        loading.textContent = 'Carregando mapas...';
        content.appendChild(loading);

        // Map items will be rendered below the actions row
        this._renderMapsContent();
    }

    /** @private */
    _renderMapsContent() {
        if (!this._mapsContainer) return;

        // Remove loading placeholder and old map items (keep the actions row)
        const loading = this._mapsContainer.querySelector('.phone-drawer__loading');
        if (loading) loading.remove();

        const oldItems = this._mapsContainer.querySelectorAll('.phone-drawer__map-item');
        for (const item of oldItems) {
            item.remove();
        }

        if (this._maps.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'phone-drawer__empty';
            empty.textContent = 'Nenhum mapa';
            this._mapsContainer.appendChild(empty);
            return;
        }

        // Remove empty state if it exists
        const emptyEl = this._mapsContainer.querySelector('.phone-drawer__empty');
        if (emptyEl) emptyEl.remove();

        for (const map of this._maps) {
            const item = document.createElement('button');
            item.className = 'phone-drawer__map-item';
            if (map.id === this._activeMapId) {
                item.classList.add('phone-drawer__map-item--active');
            }
            item.textContent = map.nome || map.name || 'Mapa';
            item.dataset.mapId = map.id;
            this._mapsContainer.appendChild(item);
        }
    }

    // ========================================================================
    // LAYERS SECTION
    // ========================================================================

    /** @private */
    _buildLayersSection() {
        const { content } = this._createCollapsibleSection('layers', 'Camadas');
        this._layersContainer = content;

        // Show loading placeholder until updateLayers() provides real data
        const loading = document.createElement('div');
        loading.className = 'phone-drawer__loading';
        loading.textContent = 'Carregando camadas...';
        content.appendChild(loading);

        this._renderLayersContent();
    }

    /** @private */
    _renderLayersContent() {
        if (!this._layersContainer) return;

        // Remove loading placeholder
        const loading = this._layersContainer.querySelector('.phone-drawer__loading');
        if (loading) loading.remove();

        // Remove old layer items
        const oldItems = this._layersContainer.querySelectorAll('.phone-drawer__layer-item');
        for (const item of oldItems) {
            item.remove();
        }

        if (this._layers.length === 0) {
            // Show empty state only if no layers exist
            if (!this._layersContainer.querySelector('.phone-drawer__empty')) {
                const empty = document.createElement('div');
                empty.className = 'phone-drawer__empty';
                empty.textContent = 'Nenhuma camada';
                this._layersContainer.appendChild(empty);
            }
            return;
        }

        // Remove empty state if it exists
        const empty = this._layersContainer.querySelector('.phone-drawer__empty');
        if (empty) empty.remove();

        for (const layer of this._layers) {
            const item = document.createElement('div');
            item.className = 'phone-drawer__layer-item';
            item.dataset.layerId = layer.id;

            const dot = document.createElement('div');
            dot.className = 'phone-drawer__layer-color';
            if (layer.color) {
                dot.style.backgroundColor = layer.color;
            }

            const name = document.createElement('span');
            name.className = 'phone-drawer__layer-name';
            name.textContent = layer.nome || layer.name || '';

            const eye = document.createElement('button');
            eye.className = 'phone-drawer__layer-eye';
            eye.dataset.layerId = layer.id;
            const isVisible = layer.visivel !== false;
            eye.dataset.visible = String(isVisible);
            eye.setAttribute('aria-label', isVisible ? 'Ocultar camada' : 'Mostrar camada');
            eye.innerHTML = isVisible ? EYE_OPEN_SVG : EYE_CLOSED_SVG;

            item.appendChild(dot);
            item.appendChild(name);
            item.appendChild(eye);
            this._layersContainer.appendChild(item);
        }
    }

    // ========================================================================
    // TOOLS SECTION
    // ========================================================================

    /** @private */
    _buildToolsSection() {
        const { content } = this._createCollapsibleSection('tools', 'Ferramentas');
        const grid = document.createElement('div');
        grid.className = 'phone-drawer__tool-grid';

        for (const group of Object.values(TOOL_GROUPS)) {
            if (!group.tools) continue;
            for (const tool of group.tools) {
                const btn = document.createElement('button');
                btn.className = 'phone-drawer__tool-btn';
                btn.dataset.toolId = tool.id;
                btn.dataset.controlKey = tool.controlKey || tool.id;

                const iconEl = document.createElement('div');
                iconEl.className = 'phone-drawer__tool-icon';
                if (tool.icon) iconEl.innerHTML = tool.icon;

                const label = document.createElement('span');
                label.className = 'phone-drawer__tool-label';
                label.textContent = tool.label || tool.id;

                btn.appendChild(iconEl);
                btn.appendChild(label);
                grid.appendChild(btn);
            }
        }

        content.appendChild(grid);
    }

    // ========================================================================
    // CHIPS SECTION
    // ========================================================================

    /** @private */
    _buildChipsSection() {
        const { content } = this._createCollapsibleSection('chips', 'Atalhos');
        const grid = document.createElement('div');
        grid.className = 'phone-drawer__chip-grid';

        for (const chip of CHIP_CONFIGS) {
            const btn = document.createElement('button');
            btn.className = 'phone-drawer__chip-btn';
            btn.dataset.chipId = chip.id;

            const iconEl = document.createElement('div');
            iconEl.className = 'phone-drawer__chip-icon';
            iconEl.innerHTML = chip.icon;

            const label = document.createElement('span');
            label.className = 'phone-drawer__chip-label';
            label.textContent = chip.label;

            btn.appendChild(iconEl);
            btn.appendChild(label);
            grid.appendChild(btn);
        }

        content.appendChild(grid);
    }

    // ========================================================================
    // EVENT BINDING
    // ========================================================================

    /** @private */
    _bindEvents() {
        // Close on backdrop tap
        addDomListener(this, this._backdrop, 'click', () => this.close());

        // Close button
        addDomListener(this, this._closeBtn, 'click', () => this.close());

        // Delegate clicks on content
        addDomListener(this, this._contentEl, 'click', (e) => {
            // Section header click -> toggle collapse
            const sectionHeader = e.target.closest('.phone-drawer__section-header');
            if (sectionHeader) {
                const sectionKey = sectionHeader.dataset.section;
                if (sectionKey) {
                    this._toggleSection(sectionKey, sectionHeader);
                }
                return;
            }

            // Map action buttons (create / import)
            const actionBtn = e.target.closest('.phone-drawer__action-btn');
            if (actionBtn) {
                const action = actionBtn.dataset.action;
                if (action === 'create' && this._mapCreateCb) {
                    this._mapCreateCb();
                    this.close();
                } else if (action === 'import' && this._mapImportCb) {
                    this._mapImportCb();
                    this.close();
                } else if (action === 'rename' && this._mapRenameCb) {
                    this._mapRenameCb(this._activeMapId);
                    this.close();
                } else if (action === 'delete' && this._mapDeleteCb) {
                    this._mapDeleteCb(this._activeMapId);
                    this.close();
                }
                return;
            }

            // Map item click
            const mapItem = e.target.closest('.phone-drawer__map-item');
            if (mapItem && this._mapSelectCb) {
                this._mapSelectCb(mapItem.dataset.mapId);
                this.close();
                return;
            }

            // Layer eye toggle click
            const eyeBtn = e.target.closest('.phone-drawer__layer-eye');
            if (eyeBtn && this._layerToggleCb) {
                const layerId = eyeBtn.dataset.layerId;
                const currentlyVisible = eyeBtn.dataset.visible === 'true';
                const newVisible = !currentlyVisible;

                // Update UI immediately
                eyeBtn.dataset.visible = String(newVisible);
                eyeBtn.setAttribute('aria-label', newVisible ? 'Ocultar camada' : 'Mostrar camada');
                eyeBtn.innerHTML = newVisible ? EYE_OPEN_SVG : EYE_CLOSED_SVG;

                this._layerToggleCb(layerId, newVisible);
                return;
            }

            // Tool button click
            const toolBtn = e.target.closest('.phone-drawer__tool-btn');
            if (toolBtn && this._toolSelectCb) {
                this._toolSelectCb(toolBtn.dataset.controlKey);
                this.close();
                return;
            }

            // Chip button click
            const chipBtn = e.target.closest('.phone-drawer__chip-btn');
            if (chipBtn && this._chipSelectCb) {
                this._chipSelectCb(chipBtn.dataset.chipId);
                this.close();
            }
        });
    }
}
