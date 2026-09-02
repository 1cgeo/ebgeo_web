// Path: js/terrain/layer-failure-notice.js

/**
 * @fileoverview THE ONE PANEL that says a map surface did not draw, shared by every surface.
 *
 * WHY IT IS ONE OBJECT AND NOT ONE PER MANAGER. Until 2026-08-24 this whole mechanism lived
 * inside `DataLayersManager`, covering `config.dataLayers` and nothing else: the raster layers of
 * `config.analysisLayers` and the BASEMAP failed in silence. Giving each manager its own copy
 * would have put two or three panels on the same map, each accusing its own half, and the second
 * copy would have drifted from the first at the first revision. So the panel, the aggregation, the
 * burst timer, the retry and the dismiss live here once, and a manager REGISTERS a surface.
 *
 * THE MAP LISTENERS ARE HERE FOR THE SAME REASON: `error` and `sourcedata` are map-wide, so
 * subscribing per manager would fan the same event out N times and make de-duplication a
 * coincidence of who subscribed first.
 *
 * WHAT A SURFACE HAS TO ANSWER (see `registerSurface`): which layer a map source id belongs to,
 * what that layer is called, whether it is switched on, and, when it can be re-requested, how.
 *
 * ── THE BASEMAP IS DIFFERENT, AND THE DIFFERENCE IS NOT COSMETIC ─────────────────────────────
 *
 * A data layer and an analysis layer are SOURCES added on top of the style. The basemap IS the
 * style (`map.setStyle(config.style)`), so it fails in two shapes and only ONE of them reaches
 * this file. Measured against the vendored MapLibre build (`frontend/public/vendors/maplibre-gl.js`,
 * 2026-08-24), not reasoned by analogy with the tile case:
 *
 *   1. THE TILES OF THE STYLE FAIL (the style document loaded, its raster/vector sources 40x or
 *      time out). Every source a style declares gets `setEventedParent(style, () => ({sourceId}))`
 *      when it is added, so these arrive at `map.on('error')` WITH `e.sourceId` exactly like ours.
 *      This file catches them. The only obstacle is that the ids are the style's own (`osm`,
 *      `satellite`, `bdgex`) and carry no prefix that could identify them, which is what
 *      `_snapshotBasemapSources` exists for: at `style.load` the style's sources are the ONLY
 *      sources on the map, because the app adds its own afterwards (`setupMapFeatures` runs after
 *      `switchLayer` in `baselayers/base-layer.control.js`).
 *
 *   2. THE STYLE DOCUMENT ITSELF FAILS (a basemap whose style is a URL: `carta_ortoimagem.js` is
 *      literally a string, and `config.basemapStyles` may publish one). This does NOT reach here
 *      usably, and pretending otherwise would be the ghost verification the constitution names:
 *      `Style.loadURL` fires an ErrorEvent with NO `sourceId`, and so do sprite failures, glyph
 *      failures and style validation, so "no sourceId" is not the basemap. The bracket that would
 *      disambiguate it (a `styledataloading` with no `style.load` after it) does not fire on the
 *      live path: `map.setStyle(url)` on a map that already has a style takes `_diffStyle`, which
 *      fetches the URL and fires the error with no `dataloading` at all; and the boot load fires
 *      its `styledataloading` before this object exists (`map_sig.js` builds the map at PHASE 3
 *      and the managers two statements later).
 *
 *      That failure IS already known, precisely, one call frame away, and since 2026-08-24 it is
 *      SPOKEN: `BaseLayerControl.switchLayer` calls `reportBasemapFailure` (naming the requested
 *      layer, which is possible there and only there, because the id is still in the variable
 *      before the fallback reassigns it) and `clearBasemapFailure` when the style does resolve.
 *      The paragraph above used to end "until something calls them, shape 2 stays silent"; that
 *      sentence outlived the call site by one lot, and a header that understates its own coverage
 *      sends the next reader to build a second notice next to this one.
 *
 * ── TWO SURFACES DO NOT COME FROM THE MAP AT ALL ────────────────────────────────────────────
 *
 * The 3D viewer (Cesium) and the 360 viewer (Three.js) fetch their own bytes: nothing they ask
 * for is a MapLibre source, so `map.on('error')` never carries them and `resolveLayerId` has
 * nothing to resolve. Until 2026-08-24 that is why they were declared OUT of this panel, and the
 * owner's decision that day was to bring them in through the other door instead: they REPORT
 * directly, from their own load-failure path, through {@link createLoaderFailureSurface}. The
 * basemap was already the proof that the door works ({@link reportBasemapFailure}).
 *
 * TWO CONSEQUENCES follow, and both are declared rather than discovered later:
 *
 *   - A style reload does NOT re-request them, so it must not drop their accusation either.
 *     `rebuiltByStyle: false` is what keeps a basemap switch from silently absolving a 3D model
 *     that is still broken.
 *   - The panel lives in the MAP container, and both viewers hide it (`#map-sig` gets
 *     `display: none` while they are open). So their accusation is READ when the person comes
 *     back to the map, which for the 3D root failure is immediate (the control returns to the
 *     map on the way out) and for the 360 is when the viewer is closed. What speaks INSIDE the
 *     viewer is a toast at the failure site; this panel is the state that outlives it.
 *
 * THE BASEMAP HAS NO RETRY, and the button is not drawn when it is the only thing accused. Asking
 * for it again means `setStyle` with the style the basemap resolves to, which this file cannot
 * compute (the resolution is `resolveBasemapStyle`, over `STYLE_MAP` plus `config.basemapStyles`).
 * A button that cannot do the thing it names is worse than no button: it is the "posto que a
 * pessoa não alcança" of the constitution, and the rule there is that the command is not drawn.
 */

import { setupCleanup, addDomListener, trackTimer, cleanup, removeElement } from '@utils/event-cleanup.js';
import {
    RETRY_ACTION_LABEL, DISMISS_ACTION_LABEL, layerDisplayName, SURFACE_NOUN,
    layerLoadFailureCauseNotice, layerLoadFailureStatusDetail,
    loadFailureHeadline, layerNoticeRegionLabel,
} from './data-layer-phrases.js';
import { relatarErro } from '@js/session/erro-telemetria.js';
import { origemDeSuperficie } from '@js/session/origens-de-erro.js';

/**
 * How long failures are collected before the notice is drawn.
 *
 * THIS IS THE WHOLE ANTI-NOISE MECHANISM, together with `_announced`. MapLibre fires one `error`
 * event PER FAILED REQUEST, and a single visible layer at a low zoom asks for dozens of tiles, so
 * a notice raised on the first event would be redrawn dozens of times, and two layers failing
 * together would race to overwrite each other. Waiting a beat turns a burst into one sentence
 * naming every surface involved.
 */
export const FAILURE_COALESCE_MS = 700;

/** The surface key the basemap is filed under. It is not a registered surface: see the header. */
export const BASEMAP_SURFACE = 'basemap';

// Separator of the composite failure key. NUL rather than a printable character because a layer
// id comes from the server catalog and an administrator can type anything into it; a separator
// the id can contain lets one surface's layer collide with another's.
const KEY_SEP = '\u0000';

/** map instance → its single notice. A WeakMap so a discarded map takes its notice with it. */
const NOTICES = new WeakMap();

/**
 * The notice of a map, created on first use.
 *
 * Every manager of the same map gets the SAME object, which is what keeps one panel on screen and
 * one `map.on('error')` subscription behind it.
 * @param {Object} map - MapLibre map (or a double exposing `on`/`off`/`getContainer`).
 * @returns {LayerFailureNotice}
 */
export function getLayerFailureNotice(map) {
    let notice = NOTICES.get(map);
    if (!notice) {
        notice = new LayerFailureNotice(map);
        NOTICES.set(map, notice);
    }
    return notice;
}

/**
 * @typedef {Object} FailureSurface
 * @property {(sourceId: string) => (string|null)} resolveLayerId - The layer a map source id
 *   belongs to, or null for anything that is not this surface's.
 * @property {(layerId: string) => *} layerName - The name to print. Anything falsy becomes
 *   "Camada sem nome": a layer with no name is still a layer that failed.
 * @property {(layerId: string) => boolean} isVisible - Whether the person actually switched it on.
 * @property {((layerId: string) => void)} [retry] - Re-requests the layer. ABSENT means the
 *   surface cannot be re-requested, and the retry button is not drawn for it.
 * @property {string} [noun] - Which `SURFACE_NOUN` this surface is spoken about as. Defaults to
 *   the layer, which is what every source-backed surface is.
 * @property {boolean} [rebuiltByStyle] - Whether a `style.load` re-requests this surface's bytes.
 *   True for anything that is a map source; FALSE for a viewer that loads on its own, whose
 *   failure survives a basemap switch untouched.
 */

export class LayerFailureNotice {
    /** @param {Object} map */
    constructor(map) {
        this.map = map;
        /** surface key → {@link FailureSurface}. */
        this._surfaces = new Map();
        /** `kind\0layerId` → `{kind, layerId, name, statuses:Set<number>}`, ONE entry per layer. */
        this._failures = new Map();
        /** Keys already named on screen, so a second failed tile does not raise a second notice. */
        this._announced = new Set();
        /** True while the notice on screen is the one that follows a retry. */
        this._retried = false;
        /** Source ids the CURRENT style declares: see `_snapshotBasemapSources`. */
        this._basemapSources = new Set();
        /** Basemap name, when a caller knew it. Null is the honest default: see the phrases file. */
        this._basemapName = null;
        this._noticeEl = null;
        this._noticeTextEl = null;
        this._noticeDetailEl = null;
        this._retryBtnEl = null;
        this._coalesceTimer = null;
        // Bound once so the same reference can be added AND removed: a fresh arrow per call site
        // would register a listener that `removeEventListener` can never match.
        this._onRetryClick = () => this._retryFailures();
        this._onDismissClick = () => this._dismissNotice();
        setupCleanup(this);
        this._watchMap();
        // The map may already carry its boot style by the time the managers are built. Cheap, and
        // it closes the window in which a basemap tile failure would resolve to nothing at all.
        this._snapshotBasemapSources();
    }

    /**
     * Declares a surface this notice speaks for.
     * @param {string} kind - Stable key (`'data'`, `'analysis'`), used in the failure key.
     * @param {FailureSurface} surface
     */
    registerSurface(kind, surface) {
        this._surfaces.set(kind, surface);
    }

    /**
     * Drops a surface and everything it was accused of, and takes the whole notice down with it
     * when it was the last one. Called from a manager's `destroy()`.
     * @param {string} kind
     */
    unregisterSurface(kind) {
        this.clearSurface(kind);
        this._surfaces.delete(kind);
        if (this._surfaces.size === 0) this.destroy();
    }

    /**
     * Releases the map listeners and the panel. Nothing calls this today by itself (the notice
     * lives as long as the map does), and it exists anyway because a `map.on()` without its
     * `map.off()` is the leak this codebase pairs by convention, not by whether the pairing runs.
     */
    destroy() {
        cleanup(this);
        removeElement(this._noticeEl);
        this._noticeEl = null;
        this._noticeTextEl = null;
        this._noticeDetailEl = null;
        this._retryBtnEl = null;
        this._coalesceTimer = null;
        this._failures.clear();
        this._announced.clear();
        this._surfaces.clear();
        NOTICES.delete(this.map);
    }

    // --- Reporting API, used by the managers ---

    /**
     * Records ONE failure against ONE layer, however many requests produced it.
     *
     * THIS IS ALSO THE ONE PLACE THAT REPORTS A SURFACE FAILURE TO THE ERROR TELEMETRY, and it is
     * the only one on purpose. The 3D and 360 viewers report THROUGH here
     * (`createLoaderFailureSurface` ends in this call), so a second `relatarErro` inside
     * `model3d-failure.js` or `photo360-failure.js` would send TWO reports with TWO signatures for
     * ONE failure, spending twice the session's budget of twenty. Which door a `kind` belongs to is
     * `origemDeSuperficie` (`session/origens-de-erro.js`), which answers MAPLIBRE for every surface
     * the map itself fetches.
     *
     * WHAT TRAVELS IS `layerId` AND NEVER `entry.name`. The id is ours (a config key, a tileset id,
     * a photo id); the NAME is a human label that can be typed by a person, and telemetry is the
     * kind of data that ends up in a log, a report and an e-mail attachment. The de-dup by
     * signature also collapses the burst: dozens of failed tiles of one layer are one report.
     * @param {string} kind - Surface key, or {@link BASEMAP_SURFACE}.
     * @param {string} layerId
     * @param {*} [status] - HTTP status, when a response arrived at all.
     */
    report(kind, layerId, status) {
        const key = this._key(kind, layerId);
        const entry = this._failures.get(key) || { kind, layerId, name: null, statuses: new Set() };
        entry.name = this._nameOf(kind, layerId);
        const code = Number(status);
        // A status is an integer in the HTTP range. 0 (what fetch reports for a blocked or aborted
        // request) is NOT a response and must not be recorded as one.
        if (Number.isInteger(code) && code >= 100 && code <= 599) entry.statuses.add(code);
        this._failures.set(key, entry);
        // O `layerId` ENTRA NA MENSAGEM, e portanto na assinatura, de propósito: sem ele duas
        // camadas diferentes da mesma superfície viravam UM relato só, e a segunda sumia como
        // duplicata. A cardinalidade é limitada e conhecida (id de catálogo, id de tileset, id de
        // foto), então isto não abre a porta para um grupo por tile.
        relatarErro(`Superfície do mapa não carregou: ${kind} ${layerId}`, {
            origem: origemDeSuperficie(kind),
            contexto: { camada: layerId, status: code },
        });
        // Already named on screen: a second failed tile of the same layer is the same news.
        if (this._announced.has(key)) return;
        this._scheduleNotice();
    }

    /**
     * Forgets a layer's failures, and takes the notice down when nothing is left. A no-op when the
     * layer was not accused, which is what lets callers call it unconditionally without resetting
     * `_retried` and making a second failure repeat the first sentence word for word.
     * @param {string} kind
     * @param {string} layerId
     */
    clear(kind, layerId) {
        const key = this._key(kind, layerId);
        if (!this._failures.has(key)) return;
        this._failures.delete(key);
        this._announced.delete(key);
        this._afterClear();
    }

    /**
     * Forgets everything one surface was accused of, without touching the others.
     * @param {string} kind
     */
    clearSurface(kind) {
        let removed = false;
        for (const [key, entry] of [...this._failures]) {
            if (entry.kind !== kind) continue;
            this._failures.delete(key);
            this._announced.delete(key);
            removed = true;
        }
        if (removed) this._afterClear();
    }

    /**
     * The basemap did not load. See the file header, shape 2: the caller that can honestly say
     * this is `BaseLayerControl.switchLayer`, not this file.
     * @param {{status?: *, name?: *}} [detail]
     */
    reportBasemapFailure({ status, name } = {}) {
        if (name !== undefined) this._basemapName = name ?? null;
        this.report(BASEMAP_SURFACE, BASEMAP_SURFACE, status);
    }

    /** The basemap is drawing again. */
    clearBasemapFailure() {
        this.clear(BASEMAP_SURFACE, BASEMAP_SURFACE);
    }

    // --- Map signals ---

    /**
     * @private Subscribes to the three map signals that say whether a surface's bytes arrived.
     *
     * `error` is the ONLY place a tile failure surfaces. It is asynchronous and fires long after
     * the manager's `addLayer` returned, which is why a `try/catch` around the add could never
     * have caught the failure that actually happens in production.
     *
     * `sourcedata` is the other half, and it is worth as much as the first: a surface that starts
     * working again must take its own accusation down, or the screen keeps accusing something that
     * is drawing perfectly and teaches the person to ignore the panel. It is a HOT event, so the
     * handler's first line is the cheapest possible check.
     *
     * `style.load` is the basemap's half of both: it re-snapshots which sources belong to the
     * style, and a new style means every accusation was about a map that no longer exists.
     */
    _watchMap() {
        if (typeof this.map?.on !== 'function') return;

        const onError = (e) => this._handleMapError(e);
        this.map.on('error', onError);
        this._unsubscribers.push(() => this.map.off('error', onError));

        const onSourceData = (e) => this._handleSourceData(e);
        this.map.on('sourcedata', onSourceData);
        this._unsubscribers.push(() => this.map.off('sourcedata', onSourceData));

        const onStyleLoad = () => this._handleStyleLoad();
        this.map.on('style.load', onStyleLoad);
        this._unsubscribers.push(() => this.map.off('style.load', onStyleLoad));
    }

    /** @private A tile request failed. */
    _handleMapError(e) {
        const hit = this._resolve(e?.sourceId);
        if (!hit) return;
        // Only a surface somebody actually switched ON is worth a word. The managers add every
        // layer hidden on style load, and a hidden layer fetches no tiles, so this is belt and
        // braces rather than the main filter. It also stops a failure raised during a style reload
        // from accusing a layer the person never asked for.
        if (!this._isVisible(hit)) return;
        this.report(hit.kind, hit.layerId, e?.error?.status);
    }

    /** @private A source finished loading: if it was one of the accused, drop the accusation. */
    _handleSourceData(e) {
        if (this._failures.size === 0) return;
        if (!e?.isSourceLoaded) return;
        const hit = this._resolve(e.sourceId);
        if (!hit) return;
        this.clear(hit.kind, hit.layerId);
    }

    /**
     * @private A style finished loading, which is TWO facts at once.
     *
     * The sources on the map at this instant are the style's own, and only those: `setStyle` tore
     * the previous ones down and the app has not re-added its layers yet. That is the only moment
     * the basemap's source ids can be learned without a name convention, since a style declares
     * whatever ids it likes (`osm`, `satellite`, `bdgex` in this deploy).
     *
     * And a rebuilt style makes a standing accusation a statement about a map that is gone: every
     * SOURCE-BACKED surface is being asked for again right now, so keeping the panel up would
     * accuse layers whose tiles are in flight. What a style reload does NOT re-request is the 3D
     * model and the 360 photo, so their accusation survives it: see the file header.
     */
    _handleStyleLoad() {
        this._snapshotBasemapSources();
        this._clearStyleRebuilt();
    }

    /** @private */
    _snapshotBasemapSources() {
        let sources;
        try {
            sources = this.map?.getStyle?.()?.sources;
        } catch {
            // `getStyle()` throws while the style is still loading. The `style.load` listener
            // takes the snapshot a moment later; there is nothing to do here.
            return;
        }
        if (!sources) return;
        this._basemapSources = new Set(Object.keys(sources));
    }

    /**
     * @private The surface and layer a map source id belongs to, or null for anything unknown.
     *
     * REGISTERED SURFACES ARE ASKED FIRST, and the basemap only gets what none of them claimed.
     * The order is the guard against the one way `_snapshotBasemapSources` could be wrong: if a
     * style reload ever left one of our own sources standing, it would land in the basemap set and
     * a data layer's failure would be reported as the ground going missing.
     * @param {*} sourceId
     * @returns {{kind: string, layerId: string}|null}
     */
    _resolve(sourceId) {
        if (typeof sourceId !== 'string' || !sourceId) return null;
        for (const [kind, surface] of this._surfaces) {
            const layerId = surface.resolveLayerId?.(sourceId);
            if (layerId) return { kind, layerId };
        }
        if (this._basemapSources.has(sourceId)) {
            return { kind: BASEMAP_SURFACE, layerId: BASEMAP_SURFACE };
        }
        return null;
    }

    /** @private The basemap is always "on": it is what the map is made of. */
    _isVisible({ kind, layerId }) {
        if (kind === BASEMAP_SURFACE) return true;
        return this._surfaces.get(kind)?.isVisible?.(layerId) === true;
    }

    /** @private */
    _nameOf(kind, layerId) {
        if (kind === BASEMAP_SURFACE) return this._basemapName;
        const surface = this._surfaces.get(kind);
        return layerDisplayName(surface?.layerName?.(layerId), this._nounOf(kind));
    }

    /** @private The noun a surface is spoken about as. Anything unclassified is a layer. */
    _nounOf(kind) {
        return this._surfaces.get(kind)?.noun || SURFACE_NOUN.CAMADA;
    }

    /** @private */
    _key(kind, layerId) {
        return `${kind}${KEY_SEP}${layerId}`;
    }

    // --- Notice lifecycle ---

    /** @private Collects a burst of per-tile failures into a single notice. */
    _scheduleNotice() {
        if (this._coalesceTimer !== null) return;
        this._coalesceTimer = setTimeout(() => {
            this._coalesceTimer = null;
            this._announceFailures();
        }, FAILURE_COALESCE_MS);
        trackTimer(this, this._coalesceTimer, 'timeout');
    }

    /** @private Draws the notice and marks every surface in it as already said. */
    _announceFailures() {
        if (this._failures.size === 0) return;
        for (const key of this._failures.keys()) this._announced.add(key);
        this._renderNotice();
    }

    /** @private Common tail of every clearing path. */
    _afterClear() {
        if (this._failures.size === 0) {
            this._retried = false;
            this._hideNotice();
        } else if (this._noticeEl && !this._noticeEl.hidden) {
            this._renderNotice();
        }
    }

    /**
     * @private Forgets what a style reload genuinely re-requested, and only that.
     *
     * A surface that loads its own bytes (`rebuiltByStyle: false`) is untouched by `setStyle`, so
     * dropping its accusation here would absolve a 3D model that is still broken the moment the
     * person switched basemap.
     */
    _clearStyleRebuilt() {
        let removed = false;
        for (const [key, entry] of [...this._failures]) {
            if (this._surfaces.get(entry.kind)?.rebuiltByStyle === false) continue;
            this._failures.delete(key);
            this._announced.delete(key);
            removed = true;
        }
        if (removed) this._afterClear();
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
        this._retryBtnEl = retry;
        return notice;
    }

    /**
     * @private Writes the current failure set into the notice.
     *
     * The names come from the Map, so the sentence is per LAYER by construction: there is no path
     * here that could ever produce one line per failed request.
     *
     * THE GROUPING IS BY NOUN, not by surface: two managers both speaking about "camadas" share
     * one sentence and one count, while a 3D model gets its own, because they are different
     * things and pt-BR agrees with each differently.
     *
     * `retried` is decided PER GROUP, and only a group whose every entry can actually be
     * re-requested can carry it: the retry button acts on all retryable entries at once, so
     * anything still standing that is NOT retryable was never asked for again, and saying
     * "após a nova tentativa" about it would describe an attempt that did not happen.
     */
    _renderNotice() {
        const notice = this._ensureNotice();
        if (!notice) return;

        const statuses = new Set();
        let basemapFailed = false;
        let basemapName = null;
        /** noun → {names, retried} */
        const groups = new Map();
        for (const entry of this._failures.values()) {
            if (entry.kind === BASEMAP_SURFACE) {
                basemapFailed = true;
                basemapName = entry.name;
            } else {
                const noun = this._nounOf(entry.kind);
                const group = groups.get(noun) || { noun, names: [], retried: this._retried };
                group.names.push(entry.name);
                group.retried = group.retried
                    && typeof this._surfaces.get(entry.kind)?.retry === 'function';
                groups.set(noun, group);
            }
            for (const code of entry.statuses) statuses.add(code);
        }

        const headline = loadFailureHeadline({
            groups: [...groups.values()], basemapFailed, basemapName,
        });
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
        // The command that cannot act is not drawn: see the file header.
        this._retryBtnEl.hidden = !this._hasRetryable();
        notice.hidden = false;
    }

    /** @private Whether anything currently accused can actually be asked for again. */
    _hasRetryable() {
        for (const entry of this._failures.values()) {
            if (typeof this._surfaces.get(entry.kind)?.retry === 'function') return true;
        }
        return false;
    }

    /** @private */
    _hideNotice() {
        if (this._noticeEl) this._noticeEl.hidden = true;
    }

    /**
     * @private Asks for the failed layers again.
     *
     * DROPPING THE SOURCE IS THE POINT, and it is the surface's job: MapLibre keeps a failed tile
     * cached for the life of the source, so re-adding a layer without removing its source first
     * repaints nothing at all and the button looks inert.
     *
     * WHAT IS NOT RETRYABLE STAYS ACCUSED. Clearing the basemap here because the person clicked a
     * button that never addressed it would silence a failure that is still true, which is the same
     * defect as a notice that outlives the failure, only inverted.
     */
    _retryFailures() {
        const retryable = [...this._failures.values()]
            .filter((entry) => typeof this._surfaces.get(entry.kind)?.retry === 'function');
        if (retryable.length === 0) return;

        for (const entry of retryable) {
            const key = this._key(entry.kind, entry.layerId);
            this._failures.delete(key);
            this._announced.delete(key);
        }
        this._retried = true;
        if (this._failures.size > 0) this._renderNotice();
        else this._hideNotice();

        for (const entry of retryable) {
            this._surfaces.get(entry.kind).retry(entry.layerId);
        }
    }

    /**
     * @private Silences the notice without retrying.
     *
     * `_failures` and `_announced` are KEPT on purpose: clearing them would let the very next
     * failed tile of the same layer raise the notice again, which turns "Dispensar" into a button
     * that does nothing. The state is released when the surface recovers, is switched off, or is
     * rebuilt by a style reload.
     */
    _dismissNotice() {
        this._retried = false;
        this._hideNotice();
    }
}

/**
 * A surface whose bytes are fetched by SOMETHING OTHER THAN THE MAP, wired to whichever map it
 * is attached to.
 *
 * WHY A FACTORY AND NOT A SECOND PANEL. The 3D viewer and the 360 viewer each need exactly three
 * things (hold the map, name what failed, report and retract), and each of them is split across
 * two files: an `IControl` that owns the map and a lazily imported engine that owns the failure.
 * Writing that twice is how the two copies drift; writing it here keeps the notice the single
 * place that knows what a surface is.
 *
 * IT IS INERT UNTIL ATTACHED, on purpose. The engine modules are lazy and can be imported by a
 * test, a deep link or a briefing before any control has run its `onAdd`; reporting into a map
 * that does not exist yet has to be a no-op rather than a throw, because a load failure is the
 * worst possible moment to raise a second error.
 *
 * @param {{kind: string, noun: string}} spec - `kind` is the surface key in the failure map
 *   (unique per notice); `noun` is a `SURFACE_NOUN`, which decides how the sentence agrees.
 * @returns {{attach: Function, detach: Function, report: Function, clear: Function, isAttached: Function}}
 */
export function createLoaderFailureSurface({ kind, noun }) {
    /** The map whose notice this reports into, or null while unattached. */
    let host = null;
    /** id → printable name, learned at report time: the engine knows it, this file cannot. */
    const names = new Map();

    const surface = {
        // A map source id is NEVER one of these. The bytes are fetched by Cesium or by Three.js,
        // so `map.on('error')` cannot carry them and there is nothing here to resolve.
        resolveLayerId: () => null,
        layerName: (id) => names.get(id),
        // Reported means asked for: nothing but an actual load attempt can produce the call.
        isVisible: () => true,
        noun,
        // `setStyle` rebuilds the map's own sources and nothing else: a viewer keeps whatever it
        // loaded, or failed to load, across a basemap switch.
        rebuiltByStyle: false,
    };

    return {
        /** @param {Object} map - The MapLibre map whose panel speaks for this surface. */
        attach(map) {
            if (!map) return;
            host = map;
            getLayerFailureNotice(map).registerSurface(kind, surface);
        },
        /** Hands the surface back, dropping everything it was accused of. */
        detach() {
            if (host) getLayerFailureNotice(host).unregisterSurface(kind);
            host = null;
            names.clear();
        },
        /**
         * @param {string} id - Stable id of what failed (tileset id, photo name).
         * @param {{name?: *, status?: *}} [detail] - `name` is what the panel prints; `status` is
         *   an HTTP code when one was actually observed.
         * @returns {boolean} Whether the accusation reached a panel.
         */
        report(id, { name, status } = {}) {
            if (!host || !id) return false;
            if (name !== undefined) names.set(id, name);
            getLayerFailureNotice(host).report(kind, id, status);
            return true;
        },
        /**
         * Retracts one accusation. A no-op when there was none, so a caller can run it before
         * every load attempt without having to know whether the previous one failed.
         * @param {string} id
         */
        clear(id) {
            if (!host || !id) return;
            getLayerFailureNotice(host).clear(kind, id);
        },
        /** @returns {boolean} Whether a map is attached, which is the only way to report. */
        isAttached() {
            return host !== null;
        },
    };
}

export default LayerFailureNotice;
