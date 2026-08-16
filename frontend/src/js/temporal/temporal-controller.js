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
    shiftMapTemporalTimes,
} from '../store';
import { DEFAULT_TEMPORAL_SPEED, TEMPORAL_RENDER_SUBSTEPS } from './temporal.constants.js';
import { resolveTimelineBounds, clampCursor, unitToMs, quantizeCursor } from './temporal.utils.js';
import { applyTemporalState, shiftSourcesTemporal, resetTrajectoryCache } from './temporal-render.service.js';
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
        this._speed = DEFAULT_TEMPORAL_SPEED;
        this._playing = false;
        this._rafId = null;
        this._lastFrameTs = null;
        this._applyRafId = null;
        // Guards against stacking async applies: while one apply is in flight,
        // later frames set _applyPending instead of starting a concurrent apply.
        this._applyInFlight = false;
        this._applyPending = false;
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

        this._syncForActiveMap();
        return this;
    }

    // ===== Public API (used by trajectory tool, briefing, etc.) =====

    /** @returns {boolean} Whether temporal control is enabled for the active map. */
    isEnabled() {
        return this._enabled;
    }

    /** @returns {number} Current timeline cursor (epoch ms), or NaN when off. */
    getCursor() {
        return this._cursor;
    }

    /** @returns {{inicio:number, fim:number}|null} Active timeline bounds. */
    getBounds() {
        return this._bounds;
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
     * @param {number} cursor - Epoch ms.
     */
    setCursor(cursor) {
        // Bounds may not be computed yet (e.g. a briefing slide restores the
        // cursor right after switching maps, before the async sync finishes).
        // Remember the value so the next _syncForActiveMap clamps and applies it.
        if (!this._bounds) {
            this._cursor = cursor;
            return;
        }
        this._cursor = clampCursor(cursor, this._bounds.inicio, this._bounds.fim);
        this._bar.setCursor(this._cursor);
        this._scheduleApply();
    }

    // ===== Sync with the active map =====

    async _syncForActiveMap() {
        const token = ++this._syncToken;
        const mapName = getCurrentMapNameSync();
        this._mapName = mapName;
        // The feature set may have changed (map switch, config change, trajectory
        // edit) — force the next render pass to rescan which sources actually
        // carry trajectories before playback starts reusing the cached list.
        resetTrajectoryCache();

        const config = await getMapTemporalConfig(mapName);
        if (token !== this._syncToken) return;
        this._config = config;
        this._enabled = config.ativo === true;

        if (!this._enabled) {
            this._stopPlayback();
            this._revealHidden = false;
            this._bar.setReveal(false);
            // Return the coordinates readout to its floating position, then hide the bar.
            this._dockCoordinates(false);
            this._bar.setVisible(false);
            await applyTemporalState(this._map, { enabled: false, cursor: this._cursor });
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

        this._cursor = clampCursor(
            Number.isFinite(this._cursor) ? this._cursor : bounds.inicio,
            bounds.inicio,
            bounds.fim
        );

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
        await applyTemporalState(this._map, {
            enabled: true,
            cursor: this._cursor,
            filterStart: syncWin.start,
            filterEnd: syncWin.end,
            reveal: this._revealHidden,
        });
        this._uiManager?.updateSelectionHighlight();
        // Announce the (now-resolved) cursor so other views — e.g. open 3D/360
        // marker viewers — filter with the real cursor. On enable, MAP_TEMPORAL_CHANGED
        // fires before this async sync sets the cursor, so without this they would
        // re-filter while getCursor() is still NaN.
        this._eventBus.emit(EventTypes.TEMPORAL_CURSOR_CHANGED, { cursor: this._cursor });
    }

    // ===== Render scheduling (coalesced to one apply per frame) =====

    _scheduleApply() {
        if (this._destroyed) return;
        // An apply is mid-flight (its async getData/setData hasn't settled): record
        // that another is wanted and let the in-flight one re-run on completion with
        // the latest cursor, rather than stacking concurrent applies on the sources.
        if (this._applyInFlight) {
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
     * filters rebuild once per step instead of every frame. The end instant of the
     * range collapses to a point so the final state renders fully before stopping.
     * @param {number} cursor - Raw cursor (epoch ms).
     * @returns {{start: number, end: number}} Window for the visibility filters.
     */
    _filterWindow(cursor) {
        if (!this._bounds || !this._config) return { start: cursor, end: cursor };
        if (cursor >= this._bounds.fim) return { start: this._bounds.fim, end: this._bounds.fim };
        const substeps = TEMPORAL_RENDER_SUBSTEPS > 0 ? TEMPORAL_RENDER_SUBSTEPS : 1;
        const step = unitToMs(this._config.unidade) / substeps;
        const start = quantizeCursor(cursor, step, this._bounds.inicio);
        return { start, end: start + step };
    }

    /** Runs one temporal apply, then re-runs once if a frame arrived meanwhile. */
    _runApply() {
        if (this._destroyed) return;
        this._applyInFlight = true;
        this._applyPending = false;
        const cursor = this._cursor;
        const win = this._filterWindow(cursor);
        applyTemporalState(this._map, {
            enabled: this._enabled,
            cursor,
            filterStart: win.start,
            filterEnd: win.end,
            reveal: this._revealHidden,
        })
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

        const advance = unitToMs(this._config.unidade) * this._speed * dt;
        if (this._cursor >= this._bounds.fim) {
            // The end instant was shown last frame — stop at the end (no loop).
            this._stopPlayback();
            return;
        }
        // Land exactly on `fim` so end-of-range instants render before stopping.
        const next = Math.min(this._cursor + advance, this._bounds.fim);

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
