// Path: js/temporal/temporal-controller.js

/**
 * @fileoverview TemporalController — the brain of the Temporal Module.
 *
 * Owns the temporal state (enabled, cursor, playing, speed, bounds) for the
 * active map, drives the timeline bar, runs the playback loop, and applies the
 * temporal render state (show/hide + trajectory movement). Registered as
 * 'TemporalControl' so the trajectory tool, attribute panels and briefing can
 * read/drive the cursor.
 */

import {
    setupCleanup,
    subscribe,
    cleanup,
} from '../utilities/event-cleanup.js';
import { EventTypes } from '../events';
import { registerControl } from '../store/control.registry.js';
import {
    getCurrentMapNameSync,
    getCurrentMapFeatures,
    getMapTemporalConfig,
    isMapTemporalEnabledSync,
    shiftMapTemporalTimes,
} from '../store';
import {
    DEFAULT_TEMPORAL_SPEED,
    TEMPORAL_RENDER_SUBSTEPS,
    TEMPORAL_PLAYBACK_DURATION_S,
} from './temporal.constants.js';
import { resolveTimelineBounds, clampCursor, unitToMs } from './temporal.utils.js';
import { applyTemporalState, shiftSourcesTemporal, resetTrajectoryCache } from './temporal-render.service.js';
import {
    playbackAdvanceMs,
    filterWindow,
    shouldDeferCursor,
    adoptSyncCursor,
} from './temporal-playback.model.js';
import { ApplicationModeEvents, ViewerMode } from '../mode/application-mode.manager.js';
import { TemporalTimelineBar } from './temporal-timeline-bar.js';

/** Max frame delta (s) applied during playback, so a backgrounded/refocused tab
 *  (huge rAF gap) advances proportionally instead of jumping to the loop point. */
const MAX_FRAME_DT = 0.25;

export class TemporalController {
    /**
     * @param {Object} deps
     * @param {Object} deps.map - MapLibre map instance.
     * @param {Object} deps.eventBus - Event bus.
     * @param {Object} [deps.uiManager] - UI manager (selection highlight refresh).
     * @param {Object} [deps.coordinatesControl] - MouseCoordinatesControl to dock into the bar.
     */
    constructor({ map, eventBus, uiManager, coordinatesControl }) {
        this._map = map;
        this._eventBus = eventBus;
        this._uiManager = uiManager || null;
        // The mouse-coordinates readout is docked into the bar while temporal is
        // enabled, so the bar replaces the floating coordinates panel.
        this._coordinatesControl = coordinatesControl || null;

        this._mapName = null;
        this._enabled = false;
        this._config = null;
        this._bounds = null;
        this._cursor = NaN;
        // The map `_bounds`/`_cursor` actually describe. NOT `_mapName`, which is
        // set at the top of a sync and therefore names the map being loaded, not
        // the one whose timeline is published: telling them apart is what keeps a
        // cursor from being clamped against another map's bounds.
        this._boundsMapName = null;
        // Last cursor per map. The cursor is personal state, not map data: hiding
        // it (temporal off) must not throw it away, so the person finds the same
        // instant when they turn the timeline back on.
        this._cursorByMap = new Map();
        // A cursor asked for a map whose bounds are not published yet, applied at
        // the end of that map's sync (see setCursor / adoptSyncCursor).
        this._pendingCursor = null;
        this._speed = DEFAULT_TEMPORAL_SPEED;
        this._playing = false;
        this._rafId = null;
        this._lastFrameTs = null;
        this._applyRafId = null;
        // Guards against stacking async applies: while one apply is in flight,
        // later frames set _applyPending instead of starting a concurrent apply.
        this._applyInFlight = false;
        this._applyPending = false;
        // True while a map sync holds the apply slot: frames coalesce into
        // _applyPending instead of racing the sync's own apply.
        this._syncApplying = false;
        // Every applyTemporalState call (playback frames AND map syncs) runs on
        // this one chain. Two of them in flight write the same GeoJSON sources
        // through independent getData/setData round-trips, so the later write
        // hands back a collection read before the earlier one landed.
        this._applyChain = Promise.resolve();
        // `enabled` of the last apply performed; null until the first one. Lets the
        // off path skip the undo when there is nothing applied to undo.
        this._renderedEnabled = null;
        this._destroyed = false;
        this._syncToken = 0;
        this._revealHidden = false;

        this._frameBound = this._frame.bind(this);

        this._bar = new TemporalTimelineBar({
            onScrub: (cursor) => this.setCursor(cursor),
            onPlayToggle: () => this.togglePlay(),
            onSpeedChange: (speed) => this.setSpeed(speed),
            onOpenSettings: () => this._openSettings(),
            onToggleReveal: () => this.toggleReveal(),
        });

        setupCleanup(this);
    }

    /**
     * Builds the bar and starts listening for map/temporal changes.
     * @param {HTMLElement} parent
     */
    init(parent) {
        this._bar.mount(parent);

        subscribe(this, this._eventBus, EventTypes.MAP_TEMPORAL_CHANGED, ({ mapName }) => {
            if (!mapName || mapName === getCurrentMapNameSync()) this._syncForActiveMap();
        });
        subscribe(this, this._eventBus, EventTypes.TEMPORAL_CONFIG_CHANGED, ({ mapName }) => {
            if (!mapName || mapName === getCurrentMapNameSync()) this._syncForActiveMap();
        });
        subscribe(this, this._eventBus, EventTypes.LAYERS_CHANGED, () => this._syncForActiveMap());
        // Freeze the timeline when a briefing presentation begins: each slide pins its
        // own cursor, so leaving playback running would drift the cursor between slides.
        subscribe(this, this._eventBus, EventTypes.BRIEFING_PRESENT_STARTED, () => this._stopPlayback());
        // Entering the 3D or the 360 viewer takes the whole screen and the bar lives
        // in the body, below them: playback would keep running, keep moving the
        // cursor and keep filtering the markers those viewers show, with no pause
        // button anywhere on screen. Stop it at the door instead of leaving a
        // control the person cannot reach.
        subscribe(this, this._eventBus, ApplicationModeEvents.VIEWER_MODE_CHANGED, (payload) => {
            if (payload?.currentMode && payload.currentMode !== ViewerMode.MAP_2D) {
                this._stopPlayback();
            }
        });

        this._syncForActiveMap();
        return this;
    }

    // ===== Public API (used by trajectory tool, briefing, etc.) =====

    /** @returns {boolean} Whether temporal control is enabled for the active map. */
    isEnabled() {
        return this._enabled;
    }

    /**
     * Current timeline cursor (epoch ms), or NaN when temporal is off on screen or
     * the timeline of the active map has not been resolved yet.
     *
     * The NaN is a contract, not a leftover: the derivation gate
     * (`temporal-derivation.service.js`) and the trajectory anchor both read this
     * value and treat a finite number as "there is a live cursor to compute with",
     * so a stale cursor surviving the off switch bakes another map's instant into
     * a symbol image. The value is not lost, only unpublished: it is parked per map
     * in `_cursorByMap` and restored when the same map turns temporal back on.
     * @returns {number}
     */
    getCursor() {
        return this._cursor;
    }

    /**
     * Active timeline bounds, or null when temporal is off on screen or the active
     * map's timeline has not been resolved yet. Never the bounds of a map other
     * than the one on screen: a new trajectory anchors its first keypoint here, and
     * the validity section falls back to these bounds, so answering with the
     * previous map's window dates the work in the wrong calendar.
     * @returns {{inicio:number, fim:number}|null}
     */
    getBounds() {
        return this._bounds;
    }

    /**
     * The quantized step cell currently driving the 2D map's show/hide filters, so
     * other surfaces (3D and 360 markers, export) can hide and show on exactly the
     * same boundaries instead of testing the raw instant.
     * @returns {{start: number, end: number}|null} Null when temporal is off on
     *   screen, or there are no bounds/cursor to build a window from.
     */
    getFilterWindow() {
        if (!this._enabled || !this._bounds || !Number.isFinite(this._cursor)) return null;
        return this._filterWindow(this._cursor);
    }

    /**
     * Whether "mostrar feições ocultas" is on: out-of-window features render dimmed
     * instead of hidden. Surfaces that mirror the temporal filter must ask, since
     * in this mode nothing is hidden at all.
     * @returns {boolean}
     */
    isRevealing() {
        return this._revealHidden;
    }

    /** @returns {boolean} Whether playback is currently running. */
    isPlaying() {
        return this._playing;
    }

    /**
     * Active display context for label formatting (mode/origin/unit), mirroring
     * what the bar receives. Used by presence to label a peer's temporal instant.
     * @returns {{ modo: (string|null), origem: (number|null), unidade: (string|null) }}
     */
    getTimeContext() {
        const config = this._config || {};
        const origem = Number.isFinite(config.origem)
            ? config.origem
            : (this._bounds ? this._bounds.inicio : null);
        return { modo: config.modo ?? null, origem, unidade: config.unidade ?? null };
    }

    /** Re-reads config/features for the active map and re-applies render state. */
    sync() {
        return this._syncForActiveMap();
    }

    /**
     * Shifts all feature temporal timestamps (store + live sources) by `deltaMs`.
     * Used by the explicit "Reagendar" action to move the whole exercise to a new
     * real D-Day while keeping the D+N offsets. Does NOT re-sync — the caller
     * persists the new config right after, which triggers a single authoritative
     * sync with the shifted data and new bounds.
     *
     * The two halves are NOT symmetric and the order is the gate: `shiftMapTemporalTimes`
     * consults `guardWrite` and returns 0 when it refuses (role too low, locked map),
     * while `shiftSourcesTemporal` writes straight to the live sources with no gate of
     * its own. Ignoring that 0 let a `read`/`comment` user watch the map reschedule
     * itself with the store untouched, so the count is consumed here rather than by
     * restating the permission hierarchy in the temporal module.
     * @param {number} deltaMs
     * @returns {Promise<{changed: number, hadCandidates: boolean}>} Features shifted, and
     *   whether the map carried anything shiftable at all (which is what separates a
     *   refused write from an empty timeline — both return 0).
     */
    async shiftFeatureTimes(deltaMs) {
        if (!Number.isFinite(deltaMs) || deltaMs === 0) return { changed: 0, hadCandidates: false };

        const changed = await shiftMapTemporalTimes(this._mapName, deltaMs);
        if (changed === 0) {
            return { changed: 0, hadCandidates: await this._hasTemporalFeatures() };
        }

        await shiftSourcesTemporal(this._map, deltaMs);
        return { changed, hadCandidates: true };
    }

    /**
     * Whether the active map holds at least one feature the shift could have moved.
     * Read only on the zero path, where it is the difference between "nothing to do"
     * and "the write was refused".
     * @returns {Promise<boolean>}
     */
    async _hasTemporalFeatures() {
        let fc;
        try {
            fc = await getCurrentMapFeatures(this._mapName);
        } catch {
            return false;
        }
        const features = fc ? Object.values(fc).flat() : [];
        return features.some((f) => {
            const p = f?.properties;
            if (!p) return false;
            return Number.isFinite(p.temporalInicio)
                || Number.isFinite(p.temporalFim)
                || (Array.isArray(p.trajetoria) && p.trajetoria.some((kp) => Number.isFinite(kp?.t)));
        });
    }

    /**
     * Moves the cursor (clamped to bounds), updates the bar and re-applies render.
     *
     * `options.mapName` names the map the instant belongs to, and naming it is what
     * separates "clamp now" from "clamp when that map's timeline is known". A
     * briefing slide restores its cursor right after asking for its map, while the
     * controller may still hold the PREVIOUS map's bounds (or none at all): clamping
     * there pins the instant to the wrong window, and the map's own sync then clamps
     * the already-wrong value a second time, so the slide opens at the start of the
     * timeline. Named for a map that is not the published one, the request is parked
     * and applied once, against the right bounds, at the end of that map's sync.
     *
     * @param {number} cursor - Epoch ms.
     * @param {{mapName?: string}} [options] - `mapName`: the map this instant belongs to.
     */
    setCursor(cursor, options = {}) {
        const mapName = options?.mapName;
        if (shouldDeferCursor(mapName, this._boundsMapName)) {
            this._pendingCursor = { mapName, cursor };
            return;
        }
        // Bounds may not be computed yet (a caller that did not name its map, right
        // after a map switch). Remember the value so the next _syncForActiveMap
        // clamps and applies it.
        if (!this._bounds) {
            this._cursor = cursor;
            return;
        }
        // A request that lands on the published map supersedes anything parked for
        // that same map, which would otherwise overwrite it at the next sync.
        if (this._pendingCursor && this._pendingCursor.mapName === this._boundsMapName) {
            this._pendingCursor = null;
        }
        this._cursor = clampCursor(cursor, this._bounds.inicio, this._bounds.fim);
        this._bar.setCursor(this._cursor);
        this._scheduleApply();
    }

    // ===== Sync with the active map =====

    /**
     * Unpublishes the timeline: parks the cursor under the map it belongs to and
     * leaves `getBounds()` null and `getCursor()` NaN.
     *
     * Called on a map switch and whenever temporal goes off, which are the two
     * moments the published pair stops describing what is on screen. Keeping it
     * meant a new trajectory born on a map with temporal OFF took its anchor from
     * the last map that had it ON, and the validity section read one map's config
     * against another map's window.
     */
    _parkTimeline() {
        if (this._boundsMapName !== null && Number.isFinite(this._cursor)) {
            this._cursorByMap.set(this._boundsMapName, this._cursor);
        }
        this._boundsMapName = null;
        this._bounds = null;
        this._cursor = NaN;
    }

    async _syncForActiveMap() {
        const token = ++this._syncToken;
        const mapName = getCurrentMapNameSync();
        this._mapName = mapName;
        // Another map is coming in: stop answering with this one's timeline BEFORE
        // the awaits below, since every reader that asks during the async window
        // would otherwise get the outgoing map's bounds, cursor and config.
        if (this._boundsMapName !== null && this._boundsMapName !== mapName) {
            this._parkTimeline();
            this._config = null;
        }

        const config = await getMapTemporalConfig(mapName);
        if (token !== this._syncToken) return;
        const wasEnabled = this._enabled;
        this._config = config;
        // THE ON-SCREEN SWITCH, never `config.ativo`: that key is the value SAVED with the view of
        // the map, and reading it here is what made a colleague's gesture flip this timeline.
        // `getMapTemporalConfig` above has just warmed the cache the sync reader falls back to.
        this._enabled = isMapTemporalEnabledSync(mapName);

        if (!this._enabled) {
            this._stopPlayback();
            this._revealHidden = false;
            this._bar.setReveal(false);
            // Return the coordinates readout to its floating position, then hide the bar.
            this._dockCoordinates(false);
            this._bar.setVisible(false);
            this._parkTimeline();
            // Undoing costs a full filter rebuild plus a read of all three moving
            // sources. Pay it only when there is something applied to undo: the
            // enabled→disabled transition, or the first sync of the session. Most
            // maps never turn temporal on, and every LAYERS_CHANGED of theirs (a
            // visibility toggle, a lock, a layer added) used to land right here.
            if (wasEnabled || this._renderedEnabled !== false) {
                await this._applySerialized({ enabled: false, cursor: NaN });
            }
            return;
        }

        // Only read all features when a timeline bound is auto (null) and must be
        // derived from the feature extent. With explicit início/fim — the common
        // case for a configured map — skip the full-feature read entirely (this
        // runs on every LAYERS_CHANGED, most of which are visibility/lock toggles).
        let features = [];
        if (!Number.isFinite(config.inicio) || !Number.isFinite(config.fim)) {
            const fc = await getCurrentMapFeatures(mapName);
            if (token !== this._syncToken) return;
            features = fc ? Object.values(fc).flat() : [];
        }

        let bounds = resolveTimelineBounds(config, features);
        if (!bounds) {
            const now = Date.now();
            const step = unitToMs(config.unidade);
            bounds = { inicio: now, fim: now + 24 * step };
        }
        this._bounds = bounds;
        this._boundsMapName = mapName;

        // Clamp ONCE, here, against the bounds of the map being synced: a cursor
        // parked by `setCursor(..., { mapName })` is consumed now, so it never met
        // another map's bounds on the way.
        const adopted = adoptSyncCursor({
            pending: this._pendingCursor,
            mapName,
            current: this._cursor,
            remembered: this._cursorByMap.get(mapName),
            inicio: bounds.inicio,
            fim: bounds.fim,
        });
        this._cursor = adopted.cursor;
        if (adopted.usedPending) this._pendingCursor = null;

        // Relative mode anchors offsets at `origem`; fall back to the timeline
        // start when no D-Day is set yet, so labels still read D+N.
        const origem = Number.isFinite(config.origem) ? config.origem : bounds.inicio;
        this._bar.setTimeContext({ modo: config.modo, origem });
        this._bar.setBounds(bounds.inicio, bounds.fim, config.unidade);
        this._bar.setCursor(this._cursor);
        this._bar.setSpeed(this._speed);
        this._bar.setReveal(this._revealHidden);
        // Dock the coordinates readout (replacing the floating panel) BEFORE
        // showing the bar, so its measured height includes the coords row.
        this._dockCoordinates(true);
        this._bar.setVisible(true);
        const syncWin = this._filterWindow(this._cursor);
        await this._applySerialized({
            enabled: true,
            cursor: this._cursor,
            filterStart: syncWin.start,
            filterEnd: syncWin.end,
            reveal: this._revealHidden,
        }, { rescanTrajectories: true });
        if (this._destroyed || token !== this._syncToken) return;
        this._uiManager?.updateSelectionHighlight();
        // A playback frame that arrived while the sync held the apply slot was
        // folded into _applyPending instead of racing it; flush it now.
        if (this._applyPending) this._runApply();
        // Announce the (now-resolved) cursor so other views — e.g. open 3D/360
        // marker viewers — filter with the real cursor. On enable, MAP_TEMPORAL_CHANGED
        // fires before this async sync sets the cursor, so without this they would
        // re-filter while getCursor() is still NaN.
        this._eventBus.emit(EventTypes.TEMPORAL_CURSOR_CHANGED, { cursor: this._cursor });
    }

    // ===== Render scheduling (coalesced to one apply per frame) =====

    _scheduleApply() {
        if (this._destroyed) return;
        // An apply is mid-flight (its async getData/setData hasn't settled), or a map
        // sync holds the slot: record that another is wanted and let the holder
        // re-run on completion with the latest cursor, rather than stacking
        // concurrent applies on the sources.
        if (this._applyInFlight || this._syncApplying) {
            this._applyPending = true;
            return;
        }
        if (this._applyRafId) return;
        this._applyRafId = requestAnimationFrame(() => {
            this._applyRafId = null;
            this._runApply();
        });
    }

    /**
     * The current timeline step-cell [start, end] used to drive show/hide.
     * Features appear/disappear on step boundaries (matching the unit shown on the
     * bar): a feature is visible whenever its validity overlaps the cell, and the
     * filters rebuild once per step instead of every frame. The math (including the
     * last cell, which must stay whole) is in `temporal-playback.model.js`.
     * @param {number} cursor - Raw cursor (epoch ms).
     * @returns {{start: number, end: number}} Window for the visibility filters.
     */
    _filterWindow(cursor) {
        if (!this._bounds || !this._config) return { start: cursor, end: cursor };
        return filterWindow({
            cursor,
            inicio: this._bounds.inicio,
            fim: this._bounds.fim,
            unitMs: unitToMs(this._config.unidade),
            substeps: TEMPORAL_RENDER_SUBSTEPS,
        });
    }

    /**
     * Runs one applyTemporalState on the shared chain, so no two of them are ever in
     * flight over the same GeoJSON sources. Both the playback frames and the map
     * sync go through here; the chain is what serializes them.
     * @param {Object} state - applyTemporalState payload.
     * @param {{rescanTrajectories?: boolean}} [options] - `rescanTrajectories` drops
     *   the trajectory cache INSIDE the chain slot, immediately before the apply that
     *   rebuilds it. Resetting it earlier (at the top of the sync, before its awaits)
     *   only meant an apply still settling repopulated it with the outgoing map's
     *   sources before the sync got to use it.
     * @returns {Promise<void>}
     */
    _applySerialized(state, { rescanTrajectories = false } = {}) {
        this._syncApplying = true;
        const next = this._applyChain.then(async () => {
            if (this._destroyed) return;
            if (rescanTrajectories) resetTrajectoryCache();
            await applyTemporalState(this._map, state);
            this._renderedEnabled = state.enabled === true;
        });
        this._applyChain = next.catch(() => {});
        return next.finally(() => {
            this._syncApplying = false;
        });
    }

    /** Runs one temporal apply, then re-runs once if a frame arrived meanwhile. */
    _runApply() {
        if (this._destroyed) return;
        this._applyInFlight = true;
        this._applyPending = false;
        const cursor = this._cursor;
        const win = this._filterWindow(cursor);
        const state = {
            enabled: this._enabled,
            cursor,
            filterStart: win.start,
            filterEnd: win.end,
            reveal: this._revealHidden,
        };
        const next = this._applyChain.then(async () => {
            if (this._destroyed) return;
            await applyTemporalState(this._map, state);
            this._renderedEnabled = state.enabled === true;
        });
        this._applyChain = next.catch(() => {});
        next
            .then(() => this._uiManager?.updateSelectionHighlight())
            .finally(() => {
                this._applyInFlight = false;
                if (this._destroyed) return;
                // Trailing edge: coalesce all frames that landed during the apply
                // into a single follow-up at the newest cursor.
                if (this._applyPending) this._runApply();
            });
        this._eventBus.emit(EventTypes.TEMPORAL_CURSOR_CHANGED, { cursor });
    }

    /** Toggles "reveal hidden" mode: out-of-window features render dimmed but editable. */
    toggleReveal() {
        this._revealHidden = !this._revealHidden;
        this._bar.setReveal(this._revealHidden);
        this._scheduleApply();
    }

    /**
     * Docks the mouse-coordinates readout into the bar's bottom row (so the bar
     * replaces the floating coordinates panel) or returns it to floating.
     * @param {boolean} dock
     */
    _dockCoordinates(dock) {
        const ctrl = this._coordinatesControl;
        if (!ctrl) return;
        if (dock) ctrl.attachTo?.(this._bar.getCoordsSlot());
        else ctrl.detach?.();
    }

    // ===== Playback =====

    togglePlay() {
        if (this._playing) this._stopPlayback();
        else this._startPlayback();
    }

    _startPlayback() {
        if (this._playing || !this._enabled || !this._bounds) return;
        // Pressing play at (or past) the end rewinds to the start, so playback
        // replays from the beginning instead of stopping on the first frame.
        if (this._cursor >= this._bounds.fim) this.setCursor(this._bounds.inicio);
        this._playing = true;
        this._lastFrameTs = null;
        this._bar.setPlaying(true);
        this._rafId = requestAnimationFrame(this._frameBound);
    }

    _stopPlayback() {
        this._playing = false;
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
        this._bar.setPlaying(false);
    }

    _frame(ts) {
        if (!this._playing || !this._bounds) return;
        if (this._lastFrameTs === null) this._lastFrameTs = ts;
        const dt = Math.min((ts - this._lastFrameTs) / 1000, MAX_FRAME_DT);
        this._lastFrameTs = ts;

        // Fraction of the WHOLE window per real second, never a number of division
        // units: the unit is a reading granularity, and tying the speed to it made
        // the same 1x take two frames on one map and seven minutes on another.
        const advance = playbackAdvanceMs({
            inicio: this._bounds.inicio,
            fim: this._bounds.fim,
            speed: this._speed,
            dtSeconds: dt,
            durationS: TEMPORAL_PLAYBACK_DURATION_S,
        });
        // A DEGENERATE WINDOW (`resolveTimelineBounds` never produces one, but a caller
        // could) stops instead of spinning rAF forever on the same instant. The test is on
        // the WINDOW, never on the advance: the FIRST frame of every playback has `dt === 0`
        // by construction (`_lastFrameTs` is seeded with its own timestamp), so an
        // `advance <= 0` stop killed playback before it moved, on every map (measured by
        // `tests/e2e-ui/temporal-local.spec.js` on 2026-09-21, the day the stop was written).
        const degenerate = !(this._bounds.fim > this._bounds.inicio);
        if (degenerate || this._cursor >= this._bounds.fim) {
            // The end instant was shown last frame — stop at the end (no loop).
            this._stopPlayback();
            return;
        }
        // Land exactly on `fim` so end-of-range instants render before stopping.
        const next = Math.min(this._cursor + Math.max(advance, 0), this._bounds.fim);

        this._cursor = next;
        this._bar.setCursor(next);
        this._scheduleApply();
        this._rafId = requestAnimationFrame(this._frameBound);
    }

    setSpeed(speed) {
        if (!Number.isFinite(speed) || speed <= 0) return;
        this._speed = speed;
        this._bar.setSpeed(speed);
    }

    // ===== Settings =====

    async _openSettings() {
        const { showTemporalSettingsModal } = await import('./temporal-settings.modal.js');
        showTemporalSettingsModal(this._mapName, this._eventBus);
    }

    destroy() {
        this._destroyed = true;
        this._stopPlayback();
        if (this._applyRafId) {
            cancelAnimationFrame(this._applyRafId);
            this._applyRafId = null;
        }
        // Detach the coordinates readout before destroying the bar, otherwise it
        // would be torn down together with the bar's DOM subtree.
        this._dockCoordinates(false);
        cleanup(this);
        this._bar.destroy();
    }
}

/**
 * Factory: creates, initialises and registers the temporal controller.
 * @param {Object} deps - { map, eventBus }.
 * @param {HTMLElement} parent - Mount target.
 * @returns {TemporalController}
 */
export function createTemporalController(deps, parent) {
    const controller = new TemporalController(deps);
    controller.init(parent);
    registerControl('TemporalControl', controller);
    return controller;
}
