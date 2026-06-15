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
    getStateManager,
} from '../store';
import { DEFAULT_TEMPORAL_SPEED } from './temporal.constants.js';
import { resolveTimelineBounds, clampCursor, unitToMs } from './temporal.utils.js';
import { applyTemporalState } from './temporal-render.service.js';
import { TemporalTimelineBar } from './temporal-timeline-bar.js';

/** Max frame delta (s) applied during playback, so a backgrounded/refocused tab
 *  (huge rAF gap) advances proportionally instead of jumping to the loop point. */
const MAX_FRAME_DT = 0.25;

export class TemporalController {
    /**
     * @param {Object} deps
     * @param {Object} deps.map - MapLibre map instance.
     * @param {Object} deps.eventBus - Event bus.
     */
    constructor({ map, eventBus, uiManager }) {
        this._map = map;
        this._eventBus = eventBus;
        this._uiManager = uiManager || null;

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
        // Keep the bar beside the search bar as the sidebar/feature panel opens.
        subscribe(this, this._eventBus, EventTypes.UI_LAYOUT_CHANGED, () => this._updateSidebarState());

        this._updateSidebarState();
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

    /** Re-reads config/features for the active map and re-applies render state. */
    sync() {
        return this._syncForActiveMap();
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

        const config = await getMapTemporalConfig(mapName);
        if (token !== this._syncToken) return;
        this._config = config;
        this._enabled = config.ativo === true;

        if (!this._enabled) {
            this._stopPlayback();
            this._revealHidden = false;
            this._bar.setReveal(false);
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

        this._bar.setBounds(bounds.inicio, bounds.fim, config.unidade);
        this._bar.setCursor(this._cursor);
        this._bar.setSpeed(this._speed);
        this._bar.setReveal(this._revealHidden);
        this._bar.setVisible(true);
        await applyTemporalState(this._map, { enabled: true, cursor: this._cursor, reveal: this._revealHidden });
        this._uiManager?.updateSelectionHighlight();
        // Announce the (now-resolved) cursor so other views — e.g. open 3D/360
        // marker viewers — filter with the real cursor. On enable, MAP_TEMPORAL_CHANGED
        // fires before this async sync sets the cursor, so without this they would
        // re-filter while getCursor() is still NaN.
        this._eventBus.emit(EventTypes.TEMPORAL_CURSOR_CHANGED, { cursor: this._cursor });
    }

    // ===== Render scheduling (coalesced to one apply per frame) =====

    _scheduleApply() {
        if (this._applyRafId || this._destroyed) return;
        this._applyRafId = requestAnimationFrame(() => {
            this._applyRafId = null;
            if (this._destroyed) return;
            applyTemporalState(this._map, { enabled: this._enabled, cursor: this._cursor, reveal: this._revealHidden })
                .then(() => this._uiManager?.updateSelectionHighlight());
            this._eventBus.emit(EventTypes.TEMPORAL_CURSOR_CHANGED, { cursor: this._cursor });
        });
    }

    /** Toggles "reveal hidden" mode: out-of-window features render dimmed but editable. */
    toggleReveal() {
        this._revealHidden = !this._revealHidden;
        this._bar.setReveal(this._revealHidden);
        this._scheduleApply();
    }

    _updateSidebarState() {
        const sm = getStateManager();
        const expanded = !!(sm?.getUnsafe?.('sidebar.expanded') || sm?.getUnsafe?.('ui.featurePanelOpen'));
        this._bar.setSidebarState(expanded);
    }

    // ===== Playback =====

    togglePlay() {
        if (this._playing) this._stopPlayback();
        else this._startPlayback();
    }

    _startPlayback() {
        if (this._playing || !this._enabled || !this._bounds) return;
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
        let next;
        if (this._cursor >= this._bounds.fim) {
            // The end instant was shown last frame — loop back to the start now.
            next = this._bounds.inicio;
        } else {
            // Land exactly on `fim` so end-of-range instants render before looping.
            next = Math.min(this._cursor + advance, this._bounds.fim);
        }

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
