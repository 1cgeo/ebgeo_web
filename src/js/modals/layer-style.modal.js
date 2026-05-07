// Path: js/modals/layer-style.modal.js

/**
 * @fileoverview Layer style configuration modal for catalog analysis/data layers.
 * Lets the user customize raster (analysis) or vector (data) paint properties,
 * with live preview, debounced persistence, and a "Restaurar padrão" action.
 */

import {
    setupCleanup,
    addDomListener,
    cleanup,
    removeElement
} from '@utils/event-cleanup.js';
import { CATALOG_ITEM_TYPES } from '@catalog/catalog.constants.js';
import { updateCatalogLayer } from '@store';

const PERSIST_DEBOUNCE_MS = 300;

/**
 * Field definitions per layer type. Each defines how to render and persist
 * one MapLibre property override.
 */
const ANALYSIS_FIELDS = [
    { key: 'raster-opacity',          label: 'Opacidade',  kind: 'range',  min: 0,    max: 1,    step: 0.01, format: percent },
    { key: 'raster-brightness-min',   label: 'Brilho mínimo', kind: 'range', min: 0,  max: 1,    step: 0.01, format: percent },
    { key: 'raster-brightness-max',   label: 'Brilho máximo', kind: 'range', min: 0,  max: 1,    step: 0.01, format: percent },
    { key: 'raster-contrast',         label: 'Contraste',  kind: 'range',  min: -1,   max: 1,    step: 0.01, format: signed },
    { key: 'raster-saturation',       label: 'Saturação',  kind: 'range',  min: -1,   max: 1,    step: 0.01, format: signed },
    { key: 'raster-hue-rotate',       label: 'Matiz',      kind: 'range',  min: 0,    max: 360,  step: 1,    format: deg }
];

const DATA_FIELDS_FILL = [
    { key: 'fill-color',     label: 'Cor de preenchimento', kind: 'color' },
    { key: 'fill-opacity',   label: 'Opacidade',            kind: 'range', min: 0, max: 1, step: 0.01, format: percent }
];
const DATA_FIELDS_BORDER = [
    { key: 'line-color',     label: 'Cor da borda',         kind: 'color' },
    { key: 'line-width',     label: 'Espessura',            kind: 'range', min: 0, max: 10, step: 0.5, format: px },
    { key: 'line-opacity',   label: 'Opacidade',            kind: 'range', min: 0, max: 1, step: 0.01, format: percent }
];
const DATA_FIELDS_LABEL = [
    { key: 'text-color',      label: 'Cor do texto',  kind: 'color' },
    { key: 'text-size',       label: 'Tamanho',       kind: 'range', min: 8,  max: 32, step: 1,    format: px },
    { key: 'text-halo-color', label: 'Cor do contorno', kind: 'color' },
    { key: 'text-halo-width', label: 'Espessura do contorno', kind: 'range', min: 0, max: 5, step: 0.5, format: px }
];

function percent(v) { return `${Math.round(v * 100)}%`; }
function signed(v)  { return v.toFixed(2); }
function deg(v)     { return `${Math.round(v)}°`; }
function px(v)      { return `${v}px`; }

const SETTINGS_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.32 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
const CLOSE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

/**
 * Convert any color value to a #RRGGBB hex string accepted by `<input type="color">`.
 * Falls back to '#000000' when alpha-aware formats can't be losslessly mapped.
 */
function toHexColor(value) {
    if (typeof value !== 'string') return '#000000';
    if (/^#[0-9a-f]{6}$/i.test(value)) return value;
    if (/^#[0-9a-f]{3}$/i.test(value)) {
        return '#' + value.slice(1).split('').map(c => c + c).join('');
    }
    const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (rgb) {
        const hex = (n) => Number(n).toString(16).padStart(2, '0');
        return `#${hex(rgb[1])}${hex(rgb[2])}${hex(rgb[3])}`;
    }
    return '#000000';
}

/**
 * Modal that exposes paint properties for a catalog analysis or data layer.
 */
export class LayerStyleModal {
    /**
     * @param {Object} config
     * @param {Object} config.layer - Catalog layer state
     * @param {Object} [config.analysisLayersManager] - Analysis layers manager
     * @param {Object} [config.dataLayersManager] - Data layers manager
     * @param {Function} [config.onChange] - Called with (layerId, mergedOverrides) after each change
     */
    constructor(config) {
        this._layer = config.layer;
        this._analysisLayersManager = config.analysisLayersManager || null;
        this._dataLayersManager = config.dataLayersManager || null;
        this._onChange = config.onChange || null;

        this._overlay = null;
        this._container = null;
        this._previousActiveElement = null;
        this._persistTimer = null;

        this._overrides = { ...(this._layer.styleOverrides || {}) };
        this._defaults = this._loadDefaults();
        this._fields = this._fieldsForType();

        setupCleanup(this);
    }

    /** Shows the modal. */
    show() {
        return new Promise((resolve) => {
            this._resolvePromise = resolve;
            this._previousActiveElement = document.activeElement;
            this._render();
            document.body.appendChild(this._overlay);
            requestAnimationFrame(() => {
                this._overlay.dataset.visible = 'true';
            });
        });
    }

    /** @private */
    _loadDefaults() {
        const innerId = this._layer.config?.id;
        if (!innerId) return {};
        if (this._layer.type === CATALOG_ITEM_TYPES.ANALYSIS_LAYER && this._analysisLayersManager) {
            return this._analysisLayersManager.getDefaultStyle(innerId);
        }
        if (this._layer.type === CATALOG_ITEM_TYPES.DATA_LAYER && this._dataLayersManager) {
            return this._dataLayersManager.getDefaultStyle(innerId);
        }
        return {};
    }

    /** @private */
    _fieldsForType() {
        if (this._layer.type === CATALOG_ITEM_TYPES.ANALYSIS_LAYER) {
            return [{ title: 'Raster', fields: ANALYSIS_FIELDS }];
        }
        if (this._layer.type === CATALOG_ITEM_TYPES.DATA_LAYER) {
            return [
                { title: 'Preenchimento', fields: DATA_FIELDS_FILL },
                { title: 'Borda',         fields: DATA_FIELDS_BORDER },
                { title: 'Rótulo',        fields: DATA_FIELDS_LABEL }
            ];
        }
        return [];
    }

    /** @private */
    _render() {
        this._overlay = document.createElement('div');
        this._overlay.className = 'modal-overlay layer-style-modal-overlay';
        this._overlay.setAttribute('role', 'dialog');
        this._overlay.setAttribute('aria-modal', 'true');
        this._overlay.dataset.visible = 'false';

        this._container = document.createElement('div');
        this._container.className = 'modal-container layer-style-modal-container';

        this._container.appendChild(this._buildHeader());
        this._container.appendChild(this._buildBody());
        this._container.appendChild(this._buildFooter());

        this._overlay.appendChild(this._container);

        addDomListener(this, this._overlay, 'click', (e) => {
            if (e.target === this._overlay) this._close();
        });
        addDomListener(this, document, 'keydown', (e) => {
            if (e.key === 'Escape') this._close();
        });
    }

    /** @private */
    _buildHeader() {
        const header = document.createElement('div');
        header.className = 'modal-header';

        const titleWrap = document.createElement('div');
        titleWrap.className = 'modal-title-wrap';

        const icon = document.createElement('span');
        icon.className = 'modal-title-icon';
        icon.innerHTML = SETTINGS_ICON;
        titleWrap.appendChild(icon);

        const title = document.createElement('h2');
        title.className = 'modal-title';
        title.textContent = `Estilo · ${this._layer.name}`;
        titleWrap.appendChild(title);

        header.appendChild(titleWrap);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'modal-close-btn';
        closeBtn.setAttribute('aria-label', 'Fechar modal');
        closeBtn.innerHTML = CLOSE_ICON;
        addDomListener(this, closeBtn, 'click', () => this._close());
        header.appendChild(closeBtn);

        return header;
    }

    /** @private */
    _buildBody() {
        const body = document.createElement('div');
        body.className = 'modal-body layer-style-modal__body';

        if (this._fields.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'layer-style-modal__empty';
            empty.textContent = 'Esta camada não possui estilos configuráveis.';
            body.appendChild(empty);
            return body;
        }

        for (const section of this._fields) {
            const sectionEl = document.createElement('div');
            sectionEl.className = 'settings-section layer-style-section';

            const head = document.createElement('div');
            head.className = 'settings-section__header';
            head.textContent = section.title;
            sectionEl.appendChild(head);

            for (const field of section.fields) {
                sectionEl.appendChild(this._buildField(field));
            }
            body.appendChild(sectionEl);
        }

        return body;
    }

    /** @private */
    _buildField(field) {
        const wrap = document.createElement('div');
        wrap.className = 'layer-style-field';
        wrap.dataset.fieldKey = field.key;

        const label = document.createElement('label');
        label.className = 'layer-style-field__label';
        label.textContent = field.label;
        wrap.appendChild(label);

        if (field.kind === 'color') {
            this._buildColorControl(wrap, field);
        } else {
            this._buildRangeControl(wrap, field);
        }

        return wrap;
    }

    /** @private */
    _buildRangeControl(wrap, field) {
        const row = document.createElement('div');
        row.className = 'layer-style-field__row';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'layer-style-slider';
        slider.min = String(field.min);
        slider.max = String(field.max);
        slider.step = String(field.step);
        const initial = this._currentValue(field.key);
        slider.value = String(initial);
        slider.dataset.fieldKey = field.key;

        const valueEl = document.createElement('span');
        valueEl.className = 'layer-style-field__value';
        valueEl.textContent = field.format(Number(initial));

        row.appendChild(slider);
        row.appendChild(valueEl);
        wrap.appendChild(row);

        addDomListener(this, slider, 'input', () => {
            const value = Number(slider.value);
            valueEl.textContent = field.format(value);
            this._setOverride(field.key, value);
        });
    }

    /** @private */
    _buildColorControl(wrap, field) {
        const row = document.createElement('div');
        row.className = 'layer-style-field__row';

        const color = document.createElement('input');
        color.type = 'color';
        color.className = 'layer-style-color';
        const initial = toHexColor(this._currentValue(field.key));
        color.value = initial;
        color.dataset.fieldKey = field.key;

        const valueEl = document.createElement('span');
        valueEl.className = 'layer-style-field__value layer-style-field__value--mono';
        valueEl.textContent = initial;

        row.appendChild(color);
        row.appendChild(valueEl);
        wrap.appendChild(row);

        addDomListener(this, color, 'input', () => {
            valueEl.textContent = color.value;
            this._setOverride(field.key, color.value);
        });
    }

    /** @private */
    _buildFooter() {
        const footer = document.createElement('div');
        footer.className = 'layer-style-modal__footer';

        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'layer-style-reset-btn';
        resetBtn.textContent = 'Restaurar padrão';
        addDomListener(this, resetBtn, 'click', () => this._resetToDefault());
        footer.appendChild(resetBtn);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'layer-style-close-btn';
        closeBtn.textContent = 'Concluir';
        addDomListener(this, closeBtn, 'click', () => this._close());
        footer.appendChild(closeBtn);

        return footer;
    }

    /** Returns the current effective value (override or default). @private */
    _currentValue(key) {
        if (Object.prototype.hasOwnProperty.call(this._overrides, key)) {
            return this._overrides[key];
        }
        return this._defaults[key];
    }

    /** Records an override and applies it live + schedules persistence. @private */
    _setOverride(key, value) {
        this._overrides[key] = value;
        this._applyLive();
        this._schedulePersist();
    }

    /** @private */
    _applyLive() {
        const innerId = this._layer.config?.id;
        if (!innerId) return;

        if (this._layer.type === CATALOG_ITEM_TYPES.ANALYSIS_LAYER && this._analysisLayersManager) {
            this._analysisLayersManager.applyStyleOverrides(innerId, this._overrides);
        } else if (this._layer.type === CATALOG_ITEM_TYPES.DATA_LAYER && this._dataLayersManager) {
            this._dataLayersManager.applyStyleOverrides(innerId, this._overrides);
        }

        if (this._onChange) {
            this._onChange(this._layer.id, this._overrides);
        }
    }

    /** @private */
    _schedulePersist() {
        if (this._persistTimer) clearTimeout(this._persistTimer);
        this._persistTimer = setTimeout(() => this._persist(), PERSIST_DEBOUNCE_MS);
    }

    /** @private */
    async _persist() {
        try {
            await updateCatalogLayer(this._layer.id, { styleOverrides: { ...this._overrides } });
        } catch (error) {
            console.warn('Failed to persist layer style overrides:', error);
        }
    }

    /** Resets all fields to defaults and persists. @private */
    _resetToDefault() {
        this._overrides = {};
        this._refreshControlsFromDefaults();
        this._applyLive();
        this._schedulePersist();
    }

    /** @private */
    _refreshControlsFromDefaults() {
        const sliders = this._container.querySelectorAll('.layer-style-slider');
        sliders.forEach(slider => {
            const key = slider.dataset.fieldKey;
            const field = this._findField(key);
            if (!field) return;
            const value = this._defaults[key];
            slider.value = String(value);
            const valueEl = slider.parentElement.querySelector('.layer-style-field__value');
            if (valueEl) valueEl.textContent = field.format(Number(value));
        });

        const colors = this._container.querySelectorAll('.layer-style-color');
        colors.forEach(color => {
            const key = color.dataset.fieldKey;
            const hex = toHexColor(this._defaults[key]);
            color.value = hex;
            const valueEl = color.parentElement.querySelector('.layer-style-field__value');
            if (valueEl) valueEl.textContent = hex;
        });
    }

    /** @private */
    _findField(key) {
        for (const section of this._fields) {
            const f = section.fields.find(field => field.key === key);
            if (f) return f;
        }
        return null;
    }

    /** @private */
    _close() {
        // Flush pending persist before closing.
        if (this._persistTimer) {
            clearTimeout(this._persistTimer);
            this._persistTimer = null;
            this._persist();
        }

        this._overlay.dataset.visible = 'false';

        setTimeout(() => {
            this._destroy();
            if (this._previousActiveElement) {
                try { this._previousActiveElement.focus(); } catch { /* element may be gone */ }
            }
            if (this._resolvePromise) {
                this._resolvePromise(this._overrides);
            }
        }, 200);
    }

    /** @private */
    _destroy() {
        cleanup(this);
        removeElement(this._overlay);
        this._overlay = null;
        this._container = null;
    }
}

/**
 * Convenience helper to show the modal.
 * @param {Object} config - Same options as LayerStyleModal constructor.
 * @returns {Promise<Object>} Resolves with final overrides when modal closes.
 */
export async function showLayerStyleModal(config) {
    const modal = new LayerStyleModal(config);
    return modal.show();
}
