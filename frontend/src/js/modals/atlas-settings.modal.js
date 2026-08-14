// Path: js/modals/atlas-settings.modal.js

/**
 * @fileoverview Atlas settings modal — a Gestor configures which capabilities (3D, 360, terrain)
 * and which basemaps are available in this atlas. Saves via `apiClient.updateAtlasSettings`
 * (manage-level server-side); the backend broadcasts `atlas_settings_updated`, so every connected
 * client re-gates the UI (the per-atlas overlay is a RESTRICTION over the deploy config — it can
 * only turn capabilities OFF, never enable what the deployment disabled).
 *
 * Exports {@link showAtlasSettingsModal}.
 */

import { ModalBase } from './modal.base.js';
import { addScopedDomListener, clearScopedListeners } from '@utils/event-cleanup.js';
import { escapeHtml } from '@utils/html-escape.js';
import { apiClient } from '@store/sync/api-client.js';
import { showError, showSuccess } from '@utils/toast_service.js';
import config from '@js/config.js';
import { getDeployDataLayers, getDeployAnalysisLayers, getDeployTilesets } from '@store/sync/atlas-settings.service.js';
import { CatalogService } from '@catalog/catalog.service.js';
import { createCatalogFilters, updateFilterCounts } from '@catalog/components/catalog-filters.js';
import { createCatalogHeader } from '@catalog/components/catalog-header.js';
import { createCatalogGrid } from '@catalog/components/catalog-grid.js';
import { CATALOG_TYPE_CONFIG, CATALOG_ITEM_TYPES, CATALOG_MODAL_FILTERS, DEFAULT_THUMBNAILS } from '@catalog/catalog.constants.js';

/* Static inline icons (no user data — safe to inject). */
const ICON_3D = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>';
const ICON_360 = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a13 13 0 0 1 0 18 13 13 0 0 1 0-18z"/></svg>';
const ICON_TERRAIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 20 6-10 4 6 3-4 5 8z"/></svg>';
const ICON_BASEMAP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg>';
const ICON_DATA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 2 9 5-9 5-9-5 9-5z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></svg>';
const ICON_ANALYSIS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 5-6"/></svg>';

/** Feature switches exposed in the modal (backend `settings.features` keys). */
const FEATURE_FIELDS = [
    { key: 'map_3d', label: 'Mapa 3D', icon: ICON_3D },
    { key: 'panoramic_images', label: 'Imagens panorâmicas (360°)', icon: ICON_360 },
    { key: 'terrain_3d', label: 'Terreno 3D', icon: ICON_TERRAIN },
    { key: 'data_layers', label: 'Dados', icon: ICON_DATA },
    { key: 'analysis_layers', label: 'Análise', icon: ICON_ANALYSIS },
];

/**
 * Atlas settings modal.
 * @extends ModalBase
 */
export class AtlasSettingsModal extends ModalBase {
    /**
     * @param {string} atlasId
     * @param {Object} [options]
     * @param {string} [options.atlasName] - Display name for the header title.
     */
    constructor(atlasId, { atlasName } = {}) {
        super({
            id: 'atlas-settings-modal',
            title: atlasName ? `Configurar ${atlasName}` : 'Configurar projeto',
            destroyOnHide: true,
        });
        this._atlasId = atlasId;
        /** @type {Object|null} */
        this._settings = null;
        /** @type {boolean} */
        this._busy = false;
    }

    /** @returns {HTMLElement} */
    render() {
        const overlay = super.render();
        this._overlay.dataset.testid = 'atlas-settings-modal';
        this.getBody().innerHTML = '<div class="sharing__state" data-testid="atlas-settings-loading">Carregando…</div>';
        document.body.appendChild(overlay);
        this._load();
        return overlay;
    }

    /**
     * @private Loads the current settings and renders the form.
     *
     * `destroyOnHide` means Escape during the in-flight fetch tears the DOM down and `getBody()`
     * starts returning undefined, so both paths bail out when the body is gone. Do NOT guard on
     * `this._isOpen`: `_load()` is fired by `render()`, BEFORE `show()`.
     */
    async _load() {
        try {
            this._settings = (await apiClient.getAtlasSettings(this._atlasId)) || {};
            if (!this.getBody()) return; // modal closed while the request was in flight
            this._renderBody();
        } catch {
            const body = this.getBody();
            if (!body) return;
            body.innerHTML =
                '<div class="sharing__state sharing__state--error" data-testid="atlas-settings-error">Não foi possível carregar as configurações.</div>';
        }
    }

    /**
     * @private
     * @returns {string[]} Deploy-ENABLED basemap ids. The per-atlas overlay can only RESTRICT
     * which enabled basemaps are allowed (never re-enable a deploy-disabled one), so listing
     * disabled basemaps here is misleading — they'd show as toggleable yet never render in the
     * base-layer selector (which filters by `enabled`). Only offer what can actually appear.
     */
    _allBasemapIds() {
        if (!config.basemaps) return [];
        return Object.entries(config.basemaps)
            .filter(([, cfg]) => cfg && cfg.enabled !== false)
            .map(([id]) => id);
    }

    /** @private */
    _renderBody() {
        const body = this.getBody();
        if (!body) return; // modal already destroyed — nothing to render into, no state to clear
        clearScopedListeners(this, 'body');
        const features = this._settings.features || {};
        const allowed = Array.isArray(this._settings.basemaps) ? this._settings.basemaps : [];
        const noRestriction = allowed.length === 0;

        const featureRows = FEATURE_FIELDS.map((f) => `
            <li class="atlas-config__item">
                <span class="atlas-config__item-icon">${f.icon}</span>
                <span class="atlas-config__item-label">${escapeHtml(f.label)}</span>
                <label class="atlas-config__switch">
                    <input type="checkbox" data-feature="${escapeHtml(f.key)}"${features[f.key] !== false ? ' checked' : ''}>
                    <span class="atlas-config__switch-track"></span>
                </label>
            </li>
        `).join('');

        const basemapRows = this._allBasemapIds().map((id) => {
            const name = config.basemaps[id]?.name || id;
            const checked = noRestriction || allowed.includes(id);
            return `
                <li class="atlas-config__item">
                    <span class="atlas-config__item-icon">${ICON_BASEMAP}</span>
                    <span class="atlas-config__item-label">${escapeHtml(name)}</span>
                    <label class="atlas-config__switch">
                        <input type="checkbox" data-basemap="${escapeHtml(id)}"${checked ? ' checked' : ''}>
                        <span class="atlas-config__switch-track"></span>
                    </label>
                </li>
            `;
        }).join('');

        body.innerHTML = `
            <div class="atlas-config atlas-config--tabbed">
                <div class="atlas-config__tabs" role="tablist">
                    <button type="button" class="atlas-config__tab atlas-config__tab--active" data-tab="geral" role="tab" aria-selected="true">Geral</button>
                    <button type="button" class="atlas-config__tab" data-tab="catalogo" role="tab" aria-selected="false">Catálogo</button>
                </div>
                <div class="atlas-config__pane" data-pane="geral">
                    <section class="atlas-config__section">
                        <div class="atlas-config__section-head">
                            <h3 class="atlas-config__section-title">Recursos disponíveis</h3>
                            <p class="atlas-config__section-desc">Ligue/desligue uma categoria inteira neste projeto.</p>
                        </div>
                        <ul class="atlas-config__list">${featureRows}</ul>
                    </section>
                    <section class="atlas-config__section">
                        <div class="atlas-config__section-head">
                            <h3 class="atlas-config__section-title">Mapas base</h3>
                            <p class="atlas-config__section-desc">Desmarque para restringir. Tudo marcado = sem restrição.</p>
                        </div>
                        <ul class="atlas-config__list">${basemapRows}</ul>
                    </section>
                </div>
                <div class="atlas-config__pane atlas-config__pane--catalog" data-pane="catalogo" hidden></div>
                <div class="atlas-config__actions">
                    <button type="button" class="atlas-config__btn-cancel" data-action="cancel">Cancelar</button>
                    <button type="button" class="prompt-modal-btn prompt-modal-btn-confirm"
                            data-action="save" data-testid="atlas-settings-save">Salvar configurações</button>
                </div>
            </div>
        `;

        // Store the init promise so _handleSave can await catalog readiness before collapsing.
        this._catalogReady = this._initCatalogTab();
        body.querySelectorAll('[data-tab]').forEach((btn) => {
            addScopedDomListener(this, 'body', btn, 'click', () => this._switchTab(btn.dataset.tab));
        });

        const save = body.querySelector('[data-action="save"]');
        if (save) addScopedDomListener(this, 'body', save, 'click', () => this._handleSave());
        const cancel = body.querySelector('[data-action="cancel"]');
        if (cancel) addScopedDomListener(this, 'body', cancel, 'click', () => this.hide());
    }

    /** @private Switches the active tab pane. */
    _switchTab(tab) {
        const body = this.getBody();
        if (!body) return;
        body.querySelectorAll('[data-tab]').forEach((b) => {
            const active = b.dataset.tab === tab;
            b.classList.toggle('atlas-config__tab--active', active);
            b.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        body.querySelectorAll('[data-pane]').forEach((p) => {
            p.hidden = p.dataset.pane !== tab;
        });
    }

    /** @private Builds CatalogItem-shaped objects for the FULL deploy 3D/360/data/analysis sets. */
    async _buildCatalogItems() {
        const T = CATALOG_ITEM_TYPES;
        const items = [];
        for (const t of getDeployTilesets()) {
            items.push({ id: `3d-${t.id}`, type: T.MODEL_3D, name: t.name, description: t.description || null,
                thumbnail: t.previewThumbnail || DEFAULT_THUMBNAILS[T.MODEL_3D], originalData: t });
        }
        // 360 views come from the sv360 preflight cache (a lazy module) — never overlay-filtered.
        try {
            const { getCachedProjects } = await import('@js/street_view_tool/streetview-api.service.js');
            const serviceUrl = config.streetView360?.serviceUrl || '';
            for (const p of (getCachedProjects() || [])) {
                items.push({ id: `360-${p.id}`, type: T.PANORAMIC_360, name: p.name, description: p.description || null,
                    thumbnail: p.previewThumbnail ? `${serviceUrl}${p.previewThumbnail}` : DEFAULT_THUMBNAILS[T.PANORAMIC_360],
                    originalData: p });
            }
        } catch { /* sv360 unavailable — no 360 items */ }
        for (const l of getDeployDataLayers()) {
            items.push({ id: `data-${l.id}`, type: T.DATA_LAYER, name: l.name, description: l.description || null,
                thumbnail: l.thumbnail || DEFAULT_THUMBNAILS[T.DATA_LAYER], originalData: l });
        }
        for (const l of getDeployAnalysisLayers()) {
            items.push({ id: `analysis-${l.id}`, type: T.ANALYSIS_LAYER, name: l.name, description: l.description || null,
                thumbnail: l.thumbnail || DEFAULT_THUMBNAILS[T.ANALYSIS_LAYER], originalData: l });
        }
        return items;
    }

    /** @private Seeds the allow-set: an EMPTY saved allowlist for a category = ALL of it allowed. */
    _seedCatalogAllowed() {
        const set = new Set();
        const seed = (saved, type) => {
            const ids = this._catalogItems.filter((i) => i.type === type).map((i) => i.originalData.id);
            const allow = Array.isArray(saved) ? saved : [];
            (allow.length === 0 ? ids : allow).forEach((id) => set.add(id));
        };
        seed(this._settings.available_3d_models, CATALOG_ITEM_TYPES.MODEL_3D);
        seed(this._settings.available_360_views, CATALOG_ITEM_TYPES.PANORAMIC_360);
        seed(this._settings.available_data_layers, CATALOG_ITEM_TYPES.DATA_LAYER);
        seed(this._settings.available_analysis_layers, CATALOG_ITEM_TYPES.ANALYSIS_LAYER);
        return set;
    }

    /**
     * @private Composes the Catálogo pane (filters + search + selectable grid), like the real catalog.
     * Never rejects: on any failure `_catalogItems`/`_catalogAllowed` fall back to empty so the
     * `_catalogReady` promise awaited by `_handleSave` always resolves.
     */
    async _initCatalogTab() {
        try {
            this._catalogItems = await this._buildCatalogItems();
        } catch {
            this._catalogItems = [];
        }
        if (!Array.isArray(this._catalogItems)) this._catalogItems = [];
        try {
            this._catalogAllowed = this._seedCatalogAllowed();
        } catch {
            this._catalogAllowed = new Set();
        }
        if (!(this._catalogAllowed instanceof Set)) this._catalogAllowed = new Set();
        this._catalogFiltersActive = new Set();
        this._catalogSearch = '';

        // The pane build is best-effort: a failure here must not reject _catalogReady (the
        // allow-set is already seeded above, so Salvar can still collapse it).
        try {
            const pane = this.getBody().querySelector('[data-pane="catalogo"]');
            const layout = document.createElement('div');
            layout.className = 'catalog-layout';

            this._catalogFiltersEl = createCatalogFilters({
                types: CATALOG_TYPE_CONFIG,
                activeFilters: this._catalogFiltersActive,
                onFilterChange: (type, active) => {
                    if (active) this._catalogFiltersActive.add(type); else this._catalogFiltersActive.delete(type);
                    this._renderCatalogGrid();
                },
            });
            layout.appendChild(this._catalogFiltersEl);

            const main = document.createElement('div');
            main.className = 'catalog-main';
            main.appendChild(createCatalogHeader({ onSearch: (q) => { this._catalogSearch = q; this._renderCatalogGrid(); } }));
            this._catalogGridWrap = document.createElement('div');
            this._catalogGridWrap.className = 'catalog-grid-wrapper';
            main.appendChild(this._catalogGridWrap);
            layout.appendChild(main);
            pane.appendChild(layout);

            updateFilterCounts(this._catalogFiltersEl, this._catalogCounts());
            this._renderCatalogGrid();
        } catch { /* pane unavailable — Salvar still works from the seeded allow-set */ }
    }

    /** @private @returns {Object} item counts per filter type. */
    _catalogCounts() {
        const counts = {};
        for (const type of CATALOG_MODAL_FILTERS) {
            counts[type] = this._catalogItems.filter((i) => i.type === type).length;
        }
        return counts;
    }

    /** @private Re-renders the grid honoring active filters + search; each card is an allow/restrict toggle. */
    _renderCatalogGrid() {
        let items = this._catalogItems;
        if (this._catalogFiltersActive.size > 0) {
            items = items.filter((i) => this._catalogFiltersActive.has(i.type));
        }
        if (this._catalogSearch) {
            items = CatalogService.searchItems(this._catalogSearch, items);
        }
        this._catalogGridWrap.innerHTML = '';
        this._catalogGridWrap.appendChild(createCatalogGrid({
            items,
            selectable: true,
            allowedIds: this._catalogAllowed,
            onToggle: (item, checked) => {
                if (checked) this._catalogAllowed.add(item.originalData.id);
                else this._catalogAllowed.delete(item.originalData.id);
            },
        }));
    }

    /** @private Collects the form, patches the atlas settings, and closes on success. */
    async _handleSave() {
        if (this._busy) return;
        this._busy = true;
        // Whole body is guarded so _busy is ALWAYS reset — otherwise a throw before the network
        // call (e.g. catalog state not yet built) would deadlock the modal (never saves again).
        try {
            // Catalog tab init is async; wait for it so _catalogItems/_catalogAllowed are populated.
            await this._catalogReady;

            // The modal may have been closed (destroyOnHide) while the catalog was initializing.
            const body = this.getBody();
            if (!body) return;

            const features = {};
            for (const f of FEATURE_FIELDS) {
                features[f.key] = !!body.querySelector(`[data-feature="${f.key}"]`)?.checked;
            }

            const allIds = this._allBasemapIds();
            const checked = allIds.filter((id) => body.querySelector(`[data-basemap="${CSS.escape(id)}"]`)?.checked);
            // Empty OR full selection means "no restriction" ([]); a strict subset is the allowlist.
            const basemaps = (checked.length === 0 || checked.length === allIds.length) ? [] : checked;
            // Catálogo tab: collapse the allow-set per category (empty OR full selection = [] = no restriction).
            const collapse = (type) => {
                const ids = this._catalogItems.filter((i) => i.type === type).map((i) => i.originalData.id);
                const allowed = ids.filter((id) => this._catalogAllowed.has(id));
                return (allowed.length === 0 || allowed.length === ids.length) ? [] : allowed;
            };
            const available_3d_models = collapse(CATALOG_ITEM_TYPES.MODEL_3D);
            const available_360_views = collapse(CATALOG_ITEM_TYPES.PANORAMIC_360);
            const available_data_layers = collapse(CATALOG_ITEM_TYPES.DATA_LAYER);
            const available_analysis_layers = collapse(CATALOG_ITEM_TYPES.ANALYSIS_LAYER);

            try {
                await apiClient.updateAtlasSettings(this._atlasId, {
                    features, basemaps, available_3d_models, available_360_views, available_data_layers, available_analysis_layers,
                });
                showSuccess('Configurações salvas.');
                this.hide();
            } catch {
                showError('Não foi possível salvar as configurações.');
            }
        } finally {
            this._busy = false;
        }
    }

    /** Hides the modal, clearing scoped listeners first. */
    hide() {
        clearScopedListeners(this, 'body');
        super.hide();
    }
}

/**
 * Shows the atlas settings modal. The caller decides whether to offer it (Gestor-only); the
 * backend independently enforces 'manage' on the PATCH.
 * @param {string} atlasId
 * @param {Object} [options]
 * @param {string} [options.atlasName]
 * @returns {AtlasSettingsModal}
 */
export function showAtlasSettingsModal(atlasId, options = {}) {
    const modal = new AtlasSettingsModal(atlasId, options);
    modal.render();
    modal.show();
    return modal;
}
