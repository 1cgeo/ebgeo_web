// Path: js/terrain/data-layers.manager.js
// Manages vector data layers (molduras, etc.) from config.dataLayers
import config from '../config.js';
import { LAYOUT_PROPS } from '@layers/layer-style/layer-style.schema.js';
import { generatePointImage, needsPerFeatureImage, getSymbolIds } from '@js/draw_tools/point_tool/point-marker-symbols.js';
import { setupCleanup, addDomListener, trackTimer, cleanup, removeElement } from '@utils/event-cleanup.js';
import {
    RETRY_ACTION_LABEL, DISMISS_ACTION_LABEL, layerDisplayName,
    layerLoadFailureNotice, layerLoadFailureCauseNotice, layerLoadFailureStatusDetail,
    layerRetryStillFailingNotice, layerNoticeRegionLabel,
} from './data-layer-phrases.js';

/** Prefix every source and sub-layer of a data layer carries on the map. */
const SOURCE_PREFIX = 'data-';

/** Suffix of the SECOND source a layer may declare (`config.labelSource`). */
const LABEL_SOURCE_SUFFIX = '-label-source';

/**
 * How long failures are collected before the notice is drawn.
 *
 * THIS IS THE WHOLE ANTI-NOISE MECHANISM, together with `_announced`. MapLibre fires one `error`
 * event PER FAILED REQUEST, and a single visible layer at a low zoom asks for dozens of tiles, so
 * a notice raised on the first event would be redrawn dozens of times, and two layers failing
 * together would race to overwrite each other. Waiting a beat turns a burst into one sentence
 * naming every layer involved.
 */
const FAILURE_COALESCE_MS = 700;

/**
 * Manages vector data layers in the system.
 * State persistence is handled by catalogLayers, not by this manager.
 *
 * WHEN A LAYER DOES NOT DRAW, THIS IS WHERE IT IS SAID. Until 2026-08-23 both failure paths ended
 * in `console.error` and nothing else, so a person with a legitimate grant switched a layer on,
 * nothing painted, and the screen stayed silent. The wording lives in `data-layer-phrases.js`,
 * and the header of that file carries the reason it refuses to name a cause (clauses 10.1 and
 * 10.3 of `CONSTITUICAO.md` point in opposite directions, and the client cannot tell them apart).
 *
 * THE ERROR IS AGGREGATED PER LAYER, NEVER PER REQUEST, and the two halves of that are:
 *   - `_failures`, a Map keyed by layerId, so N failed tiles of one layer are ONE entry;
 *   - `_announced`, so a layer that keeps failing (MapLibre retries as the user pans) does not
 *     redraw the notice over and over.
 *
 * TWO DIFFERENT FAILURES END UP IN THE SAME PLACE, and that is deliberate: the SYNCHRONOUS one
 * (`addDataLayer` throwing on a malformed source) and the ASYNCHRONOUS one (the tile request
 * failing later, which is the case that actually happens in production and which no `try/catch`
 * in this file could ever have caught). To the person looking at the map they are one event: the
 * layer is not there.
 */
class DataLayersManager {
    constructor(map) {
        this.map = map;
        this._initializedLayers = new Set();
        /** layerId → `{name, statuses: Set<number>}`, one entry per LAYER however many tiles failed. */
        this._failures = new Map();
        /** layerIds already named on screen, so a second failed tile does not raise a second notice. */
        this._announced = new Set();
        /** True while the notice on screen is the one that follows a retry. */
        this._retried = false;
        this._noticeEl = null;
        this._noticeTextEl = null;
        this._noticeDetailEl = null;
        this._coalesceTimer = null;
        // Bound once so the same reference can be added AND removed: a fresh `.bind()` per call
        // site would register a listener that `removeEventListener` can never match.
        this._onRetryClick = () => this._retryFailedLayers();
        this._onDismissClick = () => this._dismissNotice();
        setupCleanup(this);
        this._watchMapErrors();
    }

    /**
     * Releases the map listeners and the notice. Nothing calls this today (the manager lives as
     * long as the map does), and it exists anyway because a `map.on()` without its `map.off()` is
     * the leak this codebase pairs by convention, not by whether the pairing runs.
     */
    destroy() {
        cleanup(this);
        removeElement(this._noticeEl);
        this._noticeEl = null;
        this._noticeTextEl = null;
        this._noticeDetailEl = null;
        this._failures.clear();
        this._announced.clear();
    }

    /**
     * Checks if data layers system is enabled
     * @returns {boolean}
     */
    isEnabled() {
        return config.dataLayers?.enabled === true &&
               config.dataLayers.layers?.length > 0;
    }

    /**
     * Initial setup - adds all data layers with visibility: 'none'.
     * Layers are only made visible when explicitly added via catalog.
     */
    async setupDataLayers() {
        if (!this.isEnabled()) return;

        try {
            this._initializedLayers.clear();
            // A style reload rebuilds every layer from scratch, so whatever failed against the
            // PREVIOUS style is no longer a statement about what is on screen. Keeping the notice
            // up would accuse a layer that is being asked for again right now.
            this._failures.clear();
            this._announced.clear();
            this._retried = false;
            this._hideNotice();

            for (const layerConfig of config.dataLayers.layers) {
                this.addDataLayer(layerConfig.id);
            }
        } catch (error) {
            console.error('Error setting up data layers:', error);
        }
    }

    /**
     * Gets configuration of a specific layer
     * @param {string} layerId - Layer ID (without 'data-' prefix)
     * @returns {Object|null}
     */
    getLayerConfig(layerId) {
        return config.dataLayers?.layers?.find(l => l.id === layerId) || null;
    }

    /**
     * Gets all layer configurations for UI construction
     * @returns {Array}
     */
    getLayersConfig() {
        return config.dataLayers?.layers || [];
    }

    /**
     * Adds a data layer to the map with visibility: 'none'
     * @param {string} layerId - Layer ID (without 'data-' prefix)
     * @param {string} [beforeId='features-separator']
     * @param {{announceFailure?: boolean}} [options] - `announceFailure` says this call came from
     *   an explicit gesture (a switch, the retry button), so a failure is worth a word on screen.
     *   It defaults to FALSE because `setupDataLayers` re-adds EVERY layer on every style load,
     *   and a notice raised there would accuse layers nobody asked for, on a basemap switch.
     * @returns {boolean} true if layer was added successfully
     */
    addDataLayer(layerId, beforeId = 'features-separator', { announceFailure = false } = {}) {
        const layerConfig = this.getLayerConfig(layerId);
        if (!layerConfig) {
            // NOT reported through the notice, and the boundary matters: a layer with no config at
            // all is a layer the catalog no longer serves, and the catalog already says so in its
            // own words (`attachUnavailableLayerEvents` / `showUnavailableLayerPopover` in
            // `features_tab/catalog-layers.component.js`). The notice below is for the other case:
            // the definition is here and the bytes are not.
            console.warn(`Data layer config not found: ${layerId}`);
            return false;
        }

        const sourceId = `data-${layerConfig.id}`;

        try {
            this._addSourceSafe(sourceId, layerConfig.source);

            // Add label source if different from main source
            const labelSourceId = layerConfig.labelSource ? `data-${layerConfig.id}-label-source` : sourceId;
            if (layerConfig.labelSource) {
                this._addSourceSafe(labelSourceId, layerConfig.labelSource);
            }

            this._registerMarkerImage(layerConfig);

            this._addFillLayer(layerConfig, sourceId, beforeId);
            this._addBorderLayer(layerConfig, sourceId, beforeId);
            this._addLabelLayer(layerConfig, labelSourceId, beforeId);

            this._initializedLayers.add(layerId);
            return true;
        } catch (error) {
            console.error(`Error adding data layer ${layerId}:`, error);
            // The SYNCHRONOUS failure (a malformed source, a style the map refuses) lands in the
            // same aggregation as the asynchronous tile failure. To the person looking at the map
            // the two are one event: the layer is not there.
            if (announceFailure) this._registerFailure(layerId);
            return false;
        }
    }

    /**
     * Toggles visibility of a data layer on the map
     * @param {string} layerId - Layer ID (without 'data-' prefix)
     * @param {boolean} enabled
     */
    async toggleLayer(layerId, enabled) {
        if (!this._initializedLayers.has(layerId)) {
            const added = this.addDataLayer(layerId, undefined, { announceFailure: enabled });
            if (!added) return;
        }

        // Switching a layer OFF retires whatever it was accused of. Without this, turning the
        // layer back on later would be met by a notice about the previous attempt, and a person
        // who dismissed the notice could never get it back for a genuinely new failure.
        if (!enabled && this._failures.has(layerId)) this._clearFailure(layerId);

        this._applyVisibility(layerId, enabled);
    }

    /**
     * Zooms to the extent of a data layer's visible features
     * @param {string} layerId - Layer ID (without 'data-' prefix)
     */
    zoomToLayer(layerId) {
        const layerConfig = this.getLayerConfig(layerId);
        if (!layerConfig) {
            console.warn(`Layer config not found for: ${layerId}`);
            return;
        }

        const bounds = this._getBoundsFromFeatures(layerId, layerConfig);
        if (bounds) {
            this.map.fitBounds(bounds, { padding: 20, duration: 1000, essential: true });
        } else {
            console.warn(`No features found for layer "${layerId}" to calculate bounds`);
        }
    }

    /**
     * @param {string} layerId - Layer ID (without 'data-' prefix)
     * @returns {boolean} true if layer is visible
     */
    isLayerVisible(layerId) {
        const checkLayerId = this.map.getLayer(`data-${layerId}-border`)
            ? `data-${layerId}-border`
            : `data-${layerId}-fill`;

        if (!this.map.getLayer(checkLayerId)) return false;

        return this.map.getLayoutProperty(checkLayerId, 'visibility') === 'visible';
    }

    /**
     * Removes a data layer and its sources from the map
     * @param {string} layerId - Layer ID (without 'data-' prefix)
     */
    removeLayer(layerId) {
        try {
            this._removeLayerSafe(`data-${layerId}-label`);
            this._removeLayerSafe(`data-${layerId}-border`);
            this._removeLayerSafe(`data-${layerId}-fill`);

            this._removeSourceSafe(`data-${layerId}-label-source`);
            this._removeSourceSafe(`data-${layerId}`);

            this._removeImageSafe(this._markerImageId(layerId));

            // Guarded, not unconditional: `_retryFailedLayers` empties the set BEFORE calling this,
            // and an unguarded `_clearFailure` would reset `_retried` there and make the second
            // failure repeat the first sentence word for word.
            if (this._failures.has(layerId)) this._clearFailure(layerId);

            this._initializedLayers.delete(layerId);
        } catch (error) {
            console.warn(`Error removing data layer ${layerId}:`, error);
        }
    }

    /** Removes all data layers from the map */
    removeAllLayers() {
        if (!this.isEnabled()) return;

        for (const layerId of this._initializedLayers) {
            this.removeLayer(layerId);
        }
    }

    // --- Failure reporting (see the class header for the aggregation rule) ---

    /**
     * @private Subscribes to the two map signals that say whether a layer's bytes arrived.
     *
     * `error` is the ONLY place a tile failure surfaces. It is asynchronous and fires long after
     * `addDataLayer` returned, which is why the `try/catch` that used to be this file's whole
     * error story could never have caught the failure that actually happens in production.
     *
     * `sourcedata` is the other half: a layer that starts working again must take its own notice
     * down, or the screen keeps accusing a layer that is drawing perfectly. It is a HOT event, so
     * the handler's first line is the cheapest possible check.
     */
    _watchMapErrors() {
        if (typeof this.map?.on !== 'function') return;

        const onError = (e) => this._handleMapError(e);
        this.map.on('error', onError);
        this._unsubscribers.push(() => this.map.off('error', onError));

        const onSourceData = (e) => this._handleSourceData(e);
        this.map.on('sourcedata', onSourceData);
        this._unsubscribers.push(() => this.map.off('sourcedata', onSourceData));
    }

    /**
     * @private The layer a map source id belongs to, or `null` for anything that is not ours.
     *
     * TWO SOURCES CAN NAME THE SAME LAYER (`config.source` and the independent `config.labelSource`),
     * and both must fold onto the one layer, or a layer with a second source would be counted and
     * announced twice. The literal id is tried FIRST so a layer whose own id happens to end in the
     * suffix is not mistaken for somebody else's label source.
     * @param {*} sourceId
     * @returns {string|null}
     */
    _layerIdFromSourceId(sourceId) {
        if (typeof sourceId !== 'string' || !sourceId.startsWith(SOURCE_PREFIX)) return null;
        const raw = sourceId.slice(SOURCE_PREFIX.length);
        if (this.getLayerConfig(raw)) return raw;
        if (raw.endsWith(LABEL_SOURCE_SUFFIX)) {
            const base = raw.slice(0, -LABEL_SOURCE_SUFFIX.length);
            if (this.getLayerConfig(base)) return base;
        }
        return null;
    }

    /** @private A tile request of ours failed. */
    _handleMapError(e) {
        const layerId = this._layerIdFromSourceId(e?.sourceId);
        if (!layerId) return;
        // Only a layer somebody actually switched ON is worth a word. `setupDataLayers` adds every
        // layer hidden, and a hidden layer fetches no tiles, so this is belt and braces rather
        // than the main filter. It also stops a failure raised during a style reload from
        // accusing a layer the person never asked for.
        if (!this.isLayerVisible(layerId)) return;
        this._registerFailure(layerId, e?.error?.status);
    }

    /** @private A source finished loading: if it was one of the accused, drop the accusation. */
    _handleSourceData(e) {
        if (this._failures.size === 0) return;
        if (!e?.isSourceLoaded) return;
        const layerId = this._layerIdFromSourceId(e.sourceId);
        if (!layerId || !this._failures.has(layerId)) return;
        this._clearFailure(layerId);
    }

    /**
     * @private Records ONE failure against ONE layer, however many requests produced it.
     * @param {string} layerId
     * @param {*} [status] - HTTP status, when a response arrived at all.
     */
    _registerFailure(layerId, status) {
        const entry = this._failures.get(layerId) || { name: '', statuses: new Set() };
        entry.name = layerDisplayName(this.getLayerConfig(layerId)?.name);
        const code = Number(status);
        if (Number.isInteger(code) && code >= 100 && code <= 599) entry.statuses.add(code);
        this._failures.set(layerId, entry);
        // Already named on screen: a second failed tile of the same layer is the same news.
        if (this._announced.has(layerId)) return;
        this._scheduleNotice();
    }

    /** @private Forgets a layer's failures, and takes the notice down when nothing is left. */
    _clearFailure(layerId) {
        this._failures.delete(layerId);
        this._announced.delete(layerId);
        if (this._failures.size === 0) {
            this._retried = false;
            this._hideNotice();
        } else if (this._noticeEl && !this._noticeEl.hidden) {
            this._renderNotice();
        }
    }

    /** @private Collects a burst of per-tile failures into a single notice. */
    _scheduleNotice() {
        if (this._coalesceTimer !== null) return;
        this._coalesceTimer = setTimeout(() => {
            this._coalesceTimer = null;
            this._announceFailures();
        }, FAILURE_COALESCE_MS);
        trackTimer(this, this._coalesceTimer, 'timeout');
    }

    /** @private Draws the notice and marks every layer in it as already said. */
    _announceFailures() {
        if (this._failures.size === 0) return;
        for (const layerId of this._failures.keys()) this._announced.add(layerId);
        this._renderNotice();
    }

    /**
     * @private Builds the notice once. It lives in the map container rather than in the sidebar
     * because it is about the map, and the sidebar can be closed.
     * @returns {HTMLElement|null} `null` when there is no container to host it (a test double).
     */
    _ensureNotice() {
        if (this._noticeEl) return this._noticeEl;
        const host = typeof this.map?.getContainer === 'function' ? this.map.getContainer() : null;
        if (!host) return null;

        const notice = document.createElement('div');
        notice.className = 'data-layer-notice';
        notice.dataset.testid = 'camada-inacessivel-aviso';
        notice.setAttribute('role', 'region');
        notice.setAttribute('aria-label', layerNoticeRegionLabel());
        notice.hidden = true;

        const body = document.createElement('div');
        body.className = 'data-layer-notice__body';

        const text = document.createElement('p');
        text.className = 'data-layer-notice__text';
        text.dataset.testid = 'camada-inacessivel-mensagem';

        const detail = document.createElement('p');
        detail.className = 'data-layer-notice__detail';
        detail.dataset.testid = 'camada-inacessivel-detalhe';

        body.append(text, detail);

        const actions = document.createElement('div');
        actions.className = 'data-layer-notice__actions';

        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'data-layer-notice__btn data-layer-notice__btn--retry';
        retry.dataset.testid = 'camada-inacessivel-tentar-de-novo';
        retry.textContent = RETRY_ACTION_LABEL;
        addDomListener(this, retry, 'click', this._onRetryClick);

        const dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.className = 'data-layer-notice__btn data-layer-notice__btn--dismiss';
        dismiss.dataset.testid = 'camada-inacessivel-dispensar';
        dismiss.textContent = DISMISS_ACTION_LABEL;
        addDomListener(this, dismiss, 'click', this._onDismissClick);

        actions.append(retry, dismiss);
        notice.append(body, actions);
        host.appendChild(notice);

        this._noticeEl = notice;
        this._noticeTextEl = text;
        this._noticeDetailEl = detail;
        return notice;
    }

    /**
     * @private Writes the current failure set into the notice.
     *
     * The names come from the Map, so the sentence is per LAYER by construction: there is no path
     * here that could ever produce one line per failed request.
     */
    _renderNotice() {
        const notice = this._ensureNotice();
        if (!notice) return;

        const names = [];
        const statuses = new Set();
        for (const entry of this._failures.values()) {
            names.push(entry.name);
            for (const code of entry.statuses) statuses.add(code);
        }

        const headline = this._retried ? layerRetryStillFailingNotice(names) : layerLoadFailureNotice(names);
        if (!headline) {
            this._hideNotice();
            return;
        }
        this._noticeTextEl.textContent = headline;
        // Measured fact first, declared ignorance second. Never the other way round: a sentence
        // that opens by saying it does not know reads as an apology, and the status gets skipped.
        const statusDetail = layerLoadFailureStatusDetail(statuses);
        this._noticeDetailEl.textContent = statusDetail
            ? `${statusDetail} ${layerLoadFailureCauseNotice()}`
            : layerLoadFailureCauseNotice();
        notice.hidden = false;
    }

    /** @private */
    _hideNotice() {
        if (this._noticeEl) this._noticeEl.hidden = true;
    }

    /**
     * @private Asks for the failed layers again.
     *
     * DROPPING THE SOURCE IS THE POINT. MapLibre keeps a failed tile cached for the life of the
     * source, so re-adding the layer without removing the source first repaints nothing at all and
     * the button looks inert. `removeLayer` takes the source with it, which is what makes the next
     * `addDataLayer` a genuinely new request.
     */
    _retryFailedLayers() {
        const ids = [...this._failures.keys()];
        this._hideNotice();
        if (ids.length === 0) return;

        const visible = new Map(ids.map((id) => [id, this.isLayerVisible(id)]));
        this._failures.clear();
        this._announced.clear();
        this._retried = true;

        for (const layerId of ids) {
            this.removeLayer(layerId);
            if (this.addDataLayer(layerId, undefined, { announceFailure: true }) && visible.get(layerId)) {
                this._applyVisibility(layerId, true);
            }
        }
    }

    /**
     * @private Silences the notice without retrying.
     *
     * `_failures` and `_announced` are KEPT on purpose: clearing them would let the very next
     * failed tile of the same layer raise the notice again, which turns "Dispensar" into a button
     * that does nothing. The state is released when the layer recovers, is switched off, or is
     * rebuilt by a style reload.
     */
    _dismissNotice() {
        this._retried = false;
        this._hideNotice();
    }

    // --- Private helpers ---

    /** Applies visibility to all sub-layers of a data layer */
    _applyVisibility(layerId, enabled) {
        const visibility = enabled ? 'visible' : 'none';
        const subLayers = [`data-${layerId}-fill`, `data-${layerId}-border`, `data-${layerId}-label`];

        for (const id of subLayers) {
            if (this.map.getLayer(id)) {
                this.map.setLayoutProperty(id, 'visibility', visibility);
            }
        }
    }

    /**
     * Builds a structured style descriptor for a vector data layer: which
     * sub-layers exist and the default (config) value of each editable property.
     * Values may be plain colors/numbers OR data-driven MapLibre expressions
     * (case/match/interpolate/step), preserved verbatim from config.
     *
     * Defaults for absent properties mirror MapLibre's own paint defaults so
     * that applying a descriptor never changes the look of a property the user
     * did not edit.
     * @param {string} layerId
     * @returns {{kind:'vector', sublayers:Object}}
     */
    getStyleDescriptor(layerId) {
        const style = this.getLayerConfig(layerId)?.style || {};
        const fill = style.fill;
        const border = style.border;
        const label = style.label;
        const labelPaint = label?.paint || {};
        const labelLayout = label?.layout || {};

        return {
            kind: 'vector',
            sublayers: {
                fill: {
                    present: !!fill,
                    // Mirror _addFillLayer's own fallbacks (|| not ??) so applying
                    // the descriptor never changes an untouched property.
                    values: {
                        'fill-color': fill?.color || 'rgba(0,0,0,0.1)',
                        'fill-opacity': fill?.opacity ?? 1
                    }
                },
                border: {
                    present: !!border,
                    // Mirror _addBorderLayer's fallbacks exactly (|| 1, || '#666666').
                    values: {
                        'line-color': border?.color || '#666666',
                        'line-width': border?.width || 1,
                        'line-opacity': border?.opacity || 1
                    }
                },
                label: {
                    present: !!label,
                    values: {
                        'text-color': labelPaint['text-color'] ?? '#000000',
                        'text-halo-color': labelPaint['text-halo-color'] ?? 'rgba(0,0,0,0)',
                        'text-halo-width': labelPaint['text-halo-width'] ?? 0,
                        'text-size': labelLayout['text-size'] ?? 16
                    }
                }
            }
        };
    }

    /**
     * Applies user style overrides to the fill / border / label sub-layers,
     * falling back to config defaults for any property not overridden. Accepts
     * scalar values or data-driven expressions.
     * @param {string} layerId
     * @param {Object} overrides - Nested map { fill:{prop:val}, border:{...}, label:{...} }.
     */
    applyStyleOverrides(layerId, overrides) {
        const descriptor = this.getStyleDescriptor(layerId);

        for (const [subKey, sub] of Object.entries(descriptor.sublayers)) {
            if (!sub.present) continue;

            const mapLayerId = `data-${layerId}-${subKey}`;
            if (!this.map.getLayer(mapLayerId)) continue;

            const merged = { ...sub.values, ...(overrides?.[subKey] || {}) };
            for (const [prop, value] of Object.entries(merged)) {
                if (LAYOUT_PROPS.has(prop)) {
                    this._setLayout(mapLayerId, prop, value);
                } else {
                    this._setPaint(mapLayerId, prop, value);
                }
            }
        }
    }

    /** Safely sets a paint property if the layer exists. */
    _setPaint(layerId, prop, value) {
        if (value === undefined || value === null) return;
        if (!this.map.getLayer(layerId)) return;
        try {
            this.map.setPaintProperty(layerId, prop, value);
        } catch (error) {
            console.warn(`Error setting paint ${prop} on ${layerId}:`, error);
        }
    }

    /** Safely sets a layout property if the layer exists. */
    _setLayout(layerId, prop, value) {
        if (value === undefined || value === null) return;
        if (!this.map.getLayer(layerId)) return;
        try {
            this.map.setLayoutProperty(layerId, prop, value);
        } catch (error) {
            console.warn(`Error setting layout ${prop} on ${layerId}:`, error);
        }
    }

    /** Adds a source if it does not already exist */
    _addSourceSafe(sourceId, sourceConfig) {
        if (!this.map.getSource(sourceId)) {
            this.map.addSource(sourceId, sourceConfig);
        }
    }

    /** Adds a layer, inserting before beforeId if it exists */
    _addLayerSafe(layer, beforeId) {
        if (this.map.getLayer(beforeId)) {
            this.map.addLayer(layer, beforeId);
        } else {
            this.map.addLayer(layer);
        }
    }

    /** Safely removes a layer if it exists */
    _removeLayerSafe(layerId) {
        if (this.map.getLayer(layerId)) this.map.removeLayer(layerId);
    }

    /** Safely removes a source if it exists */
    _removeSourceSafe(sourceId) {
        if (this.map.getSource(sourceId)) this.map.removeSource(sourceId);
    }

    /** Safely removes a registered map image if it exists */
    _removeImageSafe(imageId) {
        if (this.map.hasImage(imageId)) this.map.removeImage(imageId);
    }

    /**
     * Stable map-image id for a layer's marker.
     * @param {string} layerId - Layer ID (without 'data-' prefix)
     * @returns {string}
     */
    _markerImageId(layerId) {
        return `data-${layerId}-marker`;
    }

    /**
     * Registers `style.marker` as a map image, reusing the point tool's symbol
     * generator so no external asset is needed. Called from addDataLayer, which
     * setupDataLayers re-runs on every style load — that is what restores the
     * image after a basemap switch wipes it.
     * @param {Object} layerConfig
     */
    _registerMarkerImage(layerConfig) {
        const marker = layerConfig.style?.marker;
        if (!marker) return;

        const imageId = this._markerImageId(layerConfig.id);
        if (this.map.hasImage(imageId)) return;

        // 'circle' is excluded: points render it as a native circle layer, so
        // the generator has no drawer for it and would emit a blank image.
        if (!needsPerFeatureImage(marker.symbol) || !getSymbolIds().includes(marker.symbol)) {
            console.warn(`Unsupported marker symbol "${marker.symbol}" on data layer ${layerConfig.id}`);
            return;
        }

        try {
            const imageData = generatePointImage(
                marker.symbol,
                marker.color || '#3f4fb5',
                marker.borderColor || '#000000',
                // ?? not || so a valid borderWidth of 0 ("no border") is preserved.
                marker.borderWidth ?? 0
            );
            this.map.addImage(imageId, imageData, { pixelRatio: 2 });
        } catch (error) {
            console.warn(`Error registering marker image for ${layerConfig.id}:`, error);
        }
    }

    _addFillLayer(layerConfig, sourceId, beforeId) {
        const fillLayerId = `data-${layerConfig.id}-fill`;
        if (this.map.getLayer(fillLayerId) || !layerConfig.style?.fill) return;

        this._addLayerSafe({
            id: fillLayerId,
            type: 'fill',
            source: sourceId,
            'source-layer': layerConfig.sourceLayer,
            paint: {
                'fill-color': layerConfig.style.fill.color || 'rgba(0,0,0,0.1)',
                'fill-outline-color': layerConfig.style.fill.outlineColor || 'rgba(0,0,0,0)'
            },
            layout: { visibility: 'none' },
            minzoom: layerConfig.minzoom || 0,
            maxzoom: layerConfig.maxzoom || 22
        }, beforeId);
    }

    _addBorderLayer(layerConfig, sourceId, beforeId) {
        const borderLayerId = `data-${layerConfig.id}-border`;
        if (this.map.getLayer(borderLayerId) || !layerConfig.style?.border) return;

        const paint = {
            'line-color': layerConfig.style.border.color || '#666666',
            'line-width': layerConfig.style.border.width || 1,
            'line-opacity': layerConfig.style.border.opacity || 1
        };

        if (layerConfig.style.border.offset) {
            paint['line-offset'] = layerConfig.style.border.offset;
        }

        this._addLayerSafe({
            id: borderLayerId,
            type: 'line',
            source: sourceId,
            'source-layer': layerConfig.sourceLayer,
            paint,
            layout: { visibility: 'none' },
            minzoom: layerConfig.minzoom || 0,
            maxzoom: layerConfig.maxzoom || 22
        }, beforeId);
    }

    _addLabelLayer(layerConfig, labelSourceId, beforeId) {
        const labelLayerId = `data-${layerConfig.id}-label`;
        const label = layerConfig.style?.label;
        const marker = layerConfig.style?.marker;

        // The symbol sub-layer carries the label, the marker, or both — a marker
        // alone is enough to justify creating it.
        if (this.map.getLayer(labelLayerId) || (!label && !marker)) return;

        // Honor any author-specified layout (text-size, text-font, anchor, …) —
        // text-field/visibility are forced afterwards so the layer starts hidden.
        const layout = {
            ...(label?.layout || {}),
            'text-field': label ? (label.textField || ['get', 'name']) : '',
            visibility: 'none'
        };

        // Symbols on polygons are placed at the centroid, so this renders one
        // marker per feature. Gate it by zoom with icon-opacity / icon-size.
        if (marker && !layout['icon-image']) {
            layout['icon-image'] = this._markerImageId(layerConfig.id);
        }

        if (label?.textAllowOverlap) {
            layout['text-allow-overlap'] = true;
        }

        this._addLayerSafe({
            id: labelLayerId,
            type: 'symbol',
            source: labelSourceId,
            'source-layer': layerConfig.labelSourceLayer || layerConfig.sourceLayer,
            layout,
            paint: label?.paint || {},
            minzoom: layerConfig.labelMinzoom || layerConfig.minzoom || 0,
            maxzoom: layerConfig.maxzoom || 22
        }, beforeId);
    }

    /**
     * Tries to calculate bounds from rendered or source features
     * @returns {Array|null} Bounds as [[west, south], [east, north]]
     * @private
     */
    _getBoundsFromFeatures(layerId, layerConfig) {
        const borderLayerId = `data-${layerId}-border`;
        const fillLayerId = `data-${layerId}-fill`;

        // Try rendered features first
        let features = [];
        if (this.map.getLayer(borderLayerId)) {
            features = this.map.queryRenderedFeatures({ layers: [borderLayerId] });
        }
        if (features.length === 0 && this.map.getLayer(fillLayerId)) {
            features = this.map.queryRenderedFeatures({ layers: [fillLayerId] });
        }

        if (features.length > 0) {
            const bounds = this._calculateBounds(features);
            if (bounds) return bounds;
        }

        // Fallback: query source features
        const sourceId = `data-${layerId}`;
        if (this.map.getSource(sourceId)) {
            const sourceFeatures = this.map.querySourceFeatures(sourceId, {
                sourceLayer: layerConfig.sourceLayer
            });
            if (sourceFeatures.length > 0) return this._calculateBounds(sourceFeatures);
        }

        return null;
    }

    /**
     * Calculates bounding box from GeoJSON features
     * @param {Array} features
     * @returns {Array|null} [[west, south], [east, north]]
     * @private
     */
    _calculateBounds(features) {
        let minLng = Infinity;
        let minLat = Infinity;
        let maxLng = -Infinity;
        let maxLat = -Infinity;

        const processCoordinates = (coords) => {
            if (typeof coords[0] === 'number') {
                const [lng, lat] = coords;
                if (lng < minLng) minLng = lng;
                if (lng > maxLng) maxLng = lng;
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
            } else {
                coords.forEach(processCoordinates);
            }
        };

        for (const feature of features) {
            if (feature.geometry?.coordinates) {
                processCoordinates(feature.geometry.coordinates);
            }
        }

        if (minLng === Infinity) return null;

        return [[minLng, minLat], [maxLng, maxLat]];
    }
}

export default DataLayersManager;
