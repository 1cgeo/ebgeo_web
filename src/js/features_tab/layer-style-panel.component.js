// Path: js/features_tab/layer-style-panel.component.js

/**
 * @fileoverview Inline (sidebar) structured style editor for catalog
 * analysis/data layers — the drill-in replacement for the former modal.
 * Opening it takes over the layers tab: the rest of the tab is hidden and a
 * back-header + style sections + footer are shown in place; closing restores
 * the tab content.
 *
 * Editing model is unchanged: per sub-layer (fill / border / label, or the
 * raster layer), each editable paint property is classified as constant,
 * categorized (case/match) or graduated (interpolate/step) and rendered with
 * the matching control. The classification field and the number of
 * categories/stops are read-only — the user edits the existing outputs and
 * breaks only. Edits apply live to the map, persist debounced to the catalog
 * layer's `styleOverrides` (nested by sub-layer), and can be reset to config
 * defaults.
 */

import {
    setupCleanup,
    addDomListener,
    addScopedDomListener,
    clearScopedListeners,
    cleanup,
    removeElement
} from '@utils/event-cleanup.js';
import { DebouncedPersist } from '@utils/debounced-persist.js';
import { deepClone } from '@utils/deep-utils.js';
import { CATALOG_ITEM_TYPES } from '@catalog/catalog.constants.js';
import { updateCatalogLayer } from '@store';
import {
    VECTOR_SUBLAYERS,
    RASTER_SUBLAYER,
    formatNumber
} from '@layers/layer-style/layer-style.schema.js';
import {
    classifyStyleValue,
    parseCategorized,
    serializeCategorized,
    parseGraduated,
    serializeGraduated,
    graduatedStopsAscending,
    parseColor,
    formatRgba,
    toHex6
} from '@layers/layer-style/style-expression.model.js';

const PERSIST_KEY = 'layer-style';

/** Scope for the rebuildable body controls, cleared before each repopulate. */
const BODY_SCOPE = 'body';

/** Host class that hides the rest of the layers tab while editing a style. */
const EDITING_CLASS = 'layer-style-editing';

/**
 * Lazily-created 2D context used to normalize any CSS color (named, %, hsl) to
 * a concrete rgb/rgba string the pure color parser can decompose.
 * @type {?CanvasRenderingContext2D}
 */
let colorProbeCtx = null;

/**
 * Resolves any CSS color string to a concrete rgb()/rgba()/hex via the browser,
 * so named colors ('cornflowerblue'), percentages and hsl() survive editing
 * instead of collapsing to black. Invalid input yields '#000000'.
 * @param {*} value
 * @returns {string}
 */
function resolveCssColor(value) {
    if (typeof value !== 'string') return '#000000';
    if (!colorProbeCtx) {
        colorProbeCtx = document.createElement('canvas').getContext('2d');
    }
    colorProbeCtx.fillStyle = '#000000';
    try {
        colorProbeCtx.fillStyle = value;
    } catch {
        // Invalid color — fillStyle keeps the prior value.
    }
    return colorProbeCtx.fillStyle;
}

const BACK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>`;

/** Coerces a possibly-string value to a finite number, defaulting to 0. */
function asNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

/**
 * Structured style editor panel for a catalog analysis or data layer.
 * Mounts inline into a host element (the layers tab's `.features-tab-content`).
 */
export class LayerStylePanel {
    /**
     * @param {Object} config
     * @param {Object} config.layer - Catalog layer state.
     * @param {HTMLElement} config.host - Layers tab content to mount into.
     * @param {Object} [config.analysisLayersManager]
     * @param {Object} [config.dataLayersManager]
     * @param {Function} [config.onClose] - Called after the panel is dismissed.
     */
    constructor(config) {
        this._layer = config.layer;
        this._host = config.host || null;
        this._analysisLayersManager = config.analysisLayersManager || null;
        this._dataLayersManager = config.dataLayersManager || null;
        this._onClose = config.onClose || null;

        this._panel = null;
        this._body = null;
        this._backBtn = null;
        this._previousActiveElement = null;
        this._closing = false;
        this._applyScheduled = false;
        this._persist = new DebouncedPersist({ delay: 300 });

        // Working copy of persisted overrides; mutated live, persisted debounced.
        // Keep only sub-layer-nested entries — legacy flat overrides (keyed
        // directly by paint property) are dropped rather than carried forward.
        this._overrides = {};
        for (const [key, value] of Object.entries(deepClone(this._layer.styleOverrides || {}))) {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                this._overrides[key] = value;
            }
        }

        this._resolveTarget();

        setupCleanup(this);
    }

    /** Shows the panel. @returns {Promise<Object>} resolves with final overrides. */
    show() {
        return new Promise((resolve) => {
            this._resolvePromise = resolve;
            if (!this._host) {
                // No host to mount into — resolve immediately as a no-op.
                resolve(this._overrides);
                return;
            }
            this._previousActiveElement = document.activeElement;
            this._render();
            this._host.classList.add(EDITING_CLASS);
            this._host.appendChild(this._panel);
            if (this._backBtn) {
                try { this._backBtn.focus(); } catch { /* focus may be refused */ }
            }
        });
    }

    /** Resolves the manager, inner config id, descriptor and schema. @private */
    _resolveTarget() {
        this._innerId = this._layer.config?.id || null;

        if (this._layer.type === CATALOG_ITEM_TYPES.ANALYSIS_LAYER) {
            this._manager = this._analysisLayersManager;
            this._schemaSublayers = [RASTER_SUBLAYER];
        } else if (this._layer.type === CATALOG_ITEM_TYPES.DATA_LAYER) {
            this._manager = this._dataLayersManager;
            this._schemaSublayers = VECTOR_SUBLAYERS;
        } else {
            this._manager = null;
            this._schemaSublayers = [];
        }

        this._descriptor = (this._manager && this._innerId)
            ? this._manager.getStyleDescriptor(this._innerId)
            : { sublayers: {} };
    }

    /** @private */
    _render() {
        this._panel = document.createElement('div');
        this._panel.className = 'layer-style-panel';

        this._panel.appendChild(this._buildHeader());
        this._body = this._buildBody();
        this._panel.appendChild(this._body);
        this._panel.appendChild(this._buildFooter());
    }

    /** @private */
    _buildHeader() {
        const header = document.createElement('div');
        header.className = 'layer-style-panel__header';

        const backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.className = 'layer-style-panel__back';
        backBtn.setAttribute('aria-label', 'Voltar');
        backBtn.title = 'Voltar';
        backBtn.innerHTML = BACK_ICON;
        addDomListener(this, backBtn, 'click', () => this._close());
        header.appendChild(backBtn);
        this._backBtn = backBtn;

        const title = document.createElement('h3');
        title.className = 'layer-style-panel__title';
        title.textContent = `Estilo · ${this._layer.name}`;
        title.title = this._layer.name;
        header.appendChild(title);

        return header;
    }

    /** @private */
    _buildBody() {
        const body = document.createElement('div');
        body.className = 'layer-style-panel__body';
        this._fillBody(body);
        return body;
    }

    /** Populates (or repopulates) the body sections. @private */
    _fillBody(body) {
        // Drop listeners from the previous build so repeated resets don't
        // accumulate handlers bound to detached control nodes.
        clearScopedListeners(this, BODY_SCOPE);
        body.innerHTML = '';

        const sections = this._schemaSublayers
            .map(schemaSub => this._buildSection(schemaSub))
            .filter(Boolean);

        if (sections.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'layer-style-panel__empty';
            empty.textContent = 'Esta camada não possui estilos configuráveis.';
            body.appendChild(empty);
            return;
        }

        sections.forEach(section => body.appendChild(section));
    }

    /**
     * Builds one sub-layer section, or null when that sub-layer is absent.
     * @private
     */
    _buildSection(schemaSub) {
        const descSub = this._descriptor.sublayers?.[schemaSub.key];
        if (!descSub?.present) return null;

        const section = document.createElement('div');
        section.className = 'settings-section layer-style-section';

        const head = document.createElement('div');
        head.className = 'settings-section__header';
        head.textContent = schemaSub.title;
        section.appendChild(head);

        for (const propSchema of schemaSub.props) {
            section.appendChild(this._buildProp(schemaSub.key, propSchema, descSub.values[propSchema.prop]));
        }

        return section;
    }

    /**
     * Builds a single property block, dispatching on the value's kind.
     * @private
     */
    _buildProp(subKey, propSchema, defaultValue) {
        const effective = this._overrides[subKey]?.[propSchema.prop] ?? defaultValue;
        const kind = classifyStyleValue(effective);

        if (kind === 'categorized') {
            const model = parseCategorized(effective);
            if (model) return this._buildCategorized(subKey, propSchema, model);
        } else if (kind === 'graduated') {
            const model = parseGraduated(effective);
            if (model) return this._buildGraduated(subKey, propSchema, model);
        } else if (kind === 'constant') {
            return this._buildConstant(subKey, propSchema, effective);
        }
        return this._buildUnsupported(propSchema);
    }

    // ===== Property block builders =====

    /** @private */
    _buildConstant(subKey, propSchema, value) {
        const box = this._propBox(propSchema.label);
        const onChange = (v) => this._setOverride(subKey, propSchema.prop, v);
        box.appendChild(this._outputControl(propSchema, value, onChange));
        return box;
    }

    /** @private */
    _buildCategorized(subKey, propSchema, model) {
        const box = this._propBox(propSchema.label, `categorizado por ${model.fieldLabel}`);
        const rows = document.createElement('div');
        rows.className = 'lsx-rows';

        const reserialize = () => this._setOverride(subKey, propSchema.prop, serializeCategorized(model));

        model.categories.forEach((cat) => {
            rows.appendChild(this._valueRow(propSchema, cat.label, cat.output, (v) => {
                cat.output = v;
                reserialize();
            }));
        });
        rows.appendChild(this._valueRow(propSchema, 'Padrão', model.fallback, (v) => {
            model.fallback = v;
            reserialize();
        }));

        box.appendChild(rows);
        return box;
    }

    /** @private */
    _buildGraduated(subKey, propSchema, model) {
        const box = this._propBox(propSchema.label, `graduado por ${model.fieldLabel}`);
        const rows = document.createElement('div');
        rows.className = 'lsx-rows';

        // Only apply/persist while breaks stay strictly ascending — a transient
        // out-of-order edit would otherwise serialize an expression MapLibre
        // rejects, leaving an invalid value persisted in styleOverrides.
        const reserialize = () => {
            if (!graduatedStopsAscending(model)) return;
            this._setOverride(subKey, propSchema.prop, serializeGraduated(model));
        };

        // step layers carry a base output for values below the first break.
        let baseLabelEl = null;
        if (model.op === 'step') {
            const label = model.stops.length ? `< ${model.stops[0].stop}` : 'base';
            const baseRow = this._valueRow(propSchema, label, model.base, (v) => {
                model.base = v;
                reserialize();
            });
            baseLabelEl = baseRow.querySelector('.lsx-row__label');
            rows.appendChild(baseRow);
        }

        model.stops.forEach((stop, i) => {
            rows.appendChild(this._stopRow(propSchema, model, stop, i, reserialize, baseLabelEl));
        });

        box.appendChild(rows);
        return box;
    }

    /** @private */
    _buildUnsupported(propSchema) {
        const box = this._propBox(propSchema.label);
        const note = document.createElement('p');
        note.className = 'lsx-note';
        note.textContent = 'Expressão avançada — não editável por aqui.';
        box.appendChild(note);
        return box;
    }

    // ===== Row builders =====

    /**
     * A read-only-label + editable-output row (categories, step base).
     * @private
     */
    _valueRow(propSchema, label, value, onChange) {
        const row = document.createElement('div');
        row.className = 'lsx-row';

        const lab = document.createElement('span');
        lab.className = 'lsx-row__label';
        lab.textContent = label;
        lab.title = label;
        row.appendChild(lab);

        row.appendChild(this._outputControl(propSchema, value, onChange));
        return row;
    }

    /**
     * A graduated stop row: editable break value + editable output.
     * @private
     */
    _stopRow(propSchema, model, stop, index, reserialize, baseLabelEl) {
        const row = document.createElement('div');
        row.className = 'lsx-row';

        const prefix = model.op === 'step' ? '≥ ' : '= ';
        const pre = document.createElement('span');
        pre.className = 'lsx-row__prefix';
        pre.textContent = prefix;
        row.appendChild(pre);

        const breakInput = document.createElement('input');
        breakInput.type = 'number';
        breakInput.className = 'lsx-break';
        breakInput.value = String(stop.stop);
        addScopedDomListener(this, BODY_SCOPE, breakInput, 'input', () => {
            // valueAsNumber is NaN for an empty/partial field, so clearing the
            // input is ignored rather than snapping the break to 0.
            const n = breakInput.valueAsNumber;
            if (!Number.isFinite(n)) return;
            stop.stop = n;
            // Keep the step base label in sync when the first break changes.
            if (model.op === 'step' && index === 0 && baseLabelEl) {
                baseLabelEl.textContent = `< ${n}`;
            }
            reserialize();
        });
        row.appendChild(breakInput);

        row.appendChild(this._outputControl(propSchema, stop.output, (v) => {
            stop.output = v;
            reserialize();
        }));
        return row;
    }

    /** Color or numeric control depending on the property's output type. @private */
    _outputControl(propSchema, value, onChange) {
        if (propSchema.outputType === 'color') {
            return this._colorControl(value, onChange);
        }
        return this._rangeControl(asNumber(value), propSchema, onChange);
    }

    /** Alpha-aware color control: swatch + hidden native picker + alpha slider. @private */
    _colorControl(initial, onChange) {
        const wrap = document.createElement('div');
        wrap.className = 'lsx-color';

        // Normalize via the browser first, so named/percentage/hsl colors keep
        // their real RGB instead of collapsing to black on the first edit.
        const resolved = resolveCssColor(initial);
        const state = parseColor(resolved) || { r: 0, g: 0, b: 0, a: 1 };

        const swatch = document.createElement('label');
        swatch.className = 'lsx-color__swatch';
        swatch.style.backgroundColor = formatRgba(state);

        const native = document.createElement('input');
        native.type = 'color';
        native.className = 'lsx-color__native';
        native.value = toHex6(resolved);
        swatch.appendChild(native);

        const alpha = document.createElement('input');
        alpha.type = 'range';
        alpha.className = 'lsx-color__alpha';
        alpha.min = '0';
        alpha.max = '1';
        alpha.step = '0.01';
        alpha.value = String(state.a);

        const emit = () => {
            const css = formatRgba(state);
            swatch.style.backgroundColor = css;
            onChange(css);
        };

        addScopedDomListener(this, BODY_SCOPE, native, 'input', () => {
            const parsed = parseColor(native.value);
            if (parsed) {
                state.r = parsed.r;
                state.g = parsed.g;
                state.b = parsed.b;
            }
            emit();
        });
        addScopedDomListener(this, BODY_SCOPE, alpha, 'input', () => {
            state.a = Number(alpha.value);
            emit();
        });

        wrap.appendChild(swatch);
        wrap.appendChild(alpha);
        return wrap;
    }

    /** Numeric range control with a formatted readout. @private */
    _rangeControl(value, propSchema, onChange) {
        const wrap = document.createElement('div');
        wrap.className = 'lsx-range';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'lsx-range__slider';
        slider.min = String(propSchema.min ?? 0);
        slider.max = String(propSchema.max ?? 1);
        slider.step = String(propSchema.step ?? 0.01);
        slider.value = String(value);

        const readout = document.createElement('span');
        readout.className = 'lsx-range__value';
        readout.textContent = formatNumber(propSchema.format, value);

        addScopedDomListener(this, BODY_SCOPE, slider, 'input', () => {
            const n = Number(slider.value);
            readout.textContent = formatNumber(propSchema.format, n);
            onChange(n);
        });

        wrap.appendChild(slider);
        wrap.appendChild(readout);
        return wrap;
    }

    /** Builds a property container with a header (and optional sub-label). @private */
    _propBox(label, subLabel) {
        const box = document.createElement('div');
        box.className = 'lsx-prop';

        const head = document.createElement('div');
        head.className = 'lsx-prop__head';

        const name = document.createElement('span');
        name.className = 'lsx-prop__name';
        name.textContent = label;
        head.appendChild(name);

        if (subLabel) {
            const sub = document.createElement('span');
            sub.className = 'lsx-prop__field';
            sub.textContent = subLabel;
            head.appendChild(sub);
        }

        box.appendChild(head);
        return box;
    }

    /** @private */
    _buildFooter() {
        const footer = document.createElement('div');
        footer.className = 'layer-style-panel__footer';

        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'layer-style-panel__reset';
        resetBtn.textContent = 'Restaurar padrão';
        addDomListener(this, resetBtn, 'click', () => this._resetToDefault());
        footer.appendChild(resetBtn);

        const doneBtn = document.createElement('button');
        doneBtn.type = 'button';
        doneBtn.className = 'layer-style-panel__done';
        doneBtn.textContent = 'Concluir';
        addDomListener(this, doneBtn, 'click', () => this._close());
        footer.appendChild(doneBtn);

        return footer;
    }

    // ===== Override plumbing =====

    /** Records an override, applies it live and schedules persistence. @private */
    _setOverride(subKey, prop, value) {
        if (!this._overrides[subKey]) this._overrides[subKey] = {};
        this._overrides[subKey][prop] = value;
        this._applyLive();
        this._schedulePersist();
    }

    /**
     * Applies overrides to the map, coalesced to one call per frame so dragging
     * a slider doesn't re-apply every sub-layer prop on each 'input' event.
     * @private
     */
    _applyLive() {
        if (!this._manager || !this._innerId || this._applyScheduled) return;
        this._applyScheduled = true;
        requestAnimationFrame(() => {
            this._applyScheduled = false;
            if (!this._panel || !this._manager || !this._innerId) return;
            this._manager.applyStyleOverrides(this._innerId, this._overrides);
        });
    }

    /** @private */
    _schedulePersist() {
        const snapshot = deepClone(this._overrides);
        this._persist.schedule(PERSIST_KEY, () =>
            updateCatalogLayer(this._layer.id, { styleOverrides: snapshot })
        );
    }

    /** Clears all overrides, re-applies config defaults and rebuilds the form. @private */
    _resetToDefault() {
        this._overrides = {};
        this._applyLive();
        this._fillBody(this._body);
        this._schedulePersist();
    }

    // ===== Lifecycle =====

    /** @private */
    _close() {
        // Guard against a second click during teardown.
        if (this._closing) return;
        this._closing = true;

        this._persist.flush(PERSIST_KEY);
        this._destroy();

        if (this._previousActiveElement) {
            try { this._previousActiveElement.focus(); } catch { /* element may be gone */ }
        }
        if (this._onClose) this._onClose();
        if (this._resolvePromise) {
            this._resolvePromise(this._overrides);
        }
    }

    /** @private */
    _destroy() {
        this._persist.destroy();
        cleanup(this);
        if (this._host) {
            this._host.classList.remove(EDITING_CLASS);
        }
        removeElement(this._panel);
        this._panel = null;
        this._body = null;
        this._backBtn = null;
    }
}

/**
 * Convenience helper to show the inline style panel.
 * @param {Object} config - Same options as LayerStylePanel constructor.
 * @returns {Promise<Object>} Resolves with final overrides when panel closes.
 */
export async function showLayerStylePanel(config) {
    const panel = new LayerStylePanel(config);
    return panel.show();
}
