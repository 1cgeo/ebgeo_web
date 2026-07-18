// Path: js/temporal/temporal-derivation.service.js

/**
 * @fileoverview Derives military-symbol attributes from the trajectory + timeline
 * cursor during playback and re-renders the symbol image — throttled.
 *
 * For a moving military symbol with `autoDirection`/`autoSpeed` enabled, the
 * direction-of-movement modifier (Q) and the speed amplifier (Z) are recomputed
 * from the segment heading/speed at the cursor and baked into a fresh symbol PNG.
 *
 * The regeneration is IMAGE-ONLY: it calls generateSymbolBlob + loadImageToMap and
 * never writes the source/store feature properties. That keeps the canonical
 * (authored) values intact, avoids IndexedDB image churn, and — crucially — does
 * NOT touch the GeoJSON source data, so it cannot race with the per-frame geometry
 * displacement that moves the symbol along the trajectory. Throttle comes from
 * quantizing the heading (and only regenerating when the quantized value changes)
 * plus an in-flight guard that drops cursor events while a regen pass is running.
 *
 * On temporal disable the touched symbols are regenerated from their canonical
 * properties, restoring the authored appearance.
 */

import { setupCleanup, subscribe, cleanup } from '../utilities/event-cleanup.js';
import { EventTypes } from '../events';
import { getControl, registerControl } from '../store';
import { loadImageToMap } from '@utils';
import { normalizeTrajectory, headingAtSorted, speedAtSorted } from './temporal-model.js';

/** Heading quantization (degrees): the symbol re-renders only when it turns this much. */
const DIRECTION_STEP_DEG = 5;
const MIL_SOURCE = 'military_symbols';
const MIL_CONTROL = 'AddMilitarySymbolControl';
/** Debounce for the auto-gate rescan: LAYERS_CHANGED fires in bursts (visibility /
 *  lock toggles), so coalesce them into one getData scan instead of one per event. */
const GATE_REFRESH_DEBOUNCE_MS = 150;

/**
 * Formats a m/s speed as the Z amplifier string, or '' when undefined. Adaptive
 * precision so slow movers don't render as "0 km/h": whole km/h at speed, one or
 * two decimals below 10 km/h.
 */
function formatSpeedAmplifier(mps) {
    if (!Number.isFinite(mps) || mps <= 0) return '';
    const kmh = mps * 3.6;
    if (kmh >= 10) return `${Math.round(kmh)} km/h`;
    if (kmh >= 1) return `${kmh.toFixed(1)} km/h`;
    return `${kmh.toFixed(2)} km/h`;
}

export class TemporalDerivationService {
    /**
     * @param {Object} deps
     * @param {Object} deps.map - MapLibre map instance.
     * @param {Object} deps.eventBus - Event bus.
     */
    constructor({ map, eventBus }) {
        this._map = map;
        this._eventBus = eventBus;
        this._applied = new Map(); // featureId -> { direction, speed } last applied (throttle + restore set)
        this._enabled = false;     // any auto military symbol present? (gates the per-cursor getData)
        this._busy = false;        // in-flight regen pass (drops overlapping cursor events)
        this._refreshTimer = null; // debounce handle for the gate rescan
        setupCleanup(this);
    }

    init() {
        subscribe(this, this._eventBus, EventTypes.TEMPORAL_CURSOR_CHANGED, ({ cursor }) => this._onCursor(cursor));
        subscribe(this, this._eventBus, EventTypes.LAYERS_CHANGED, () => this._scheduleRefresh());
        subscribe(this, this._eventBus, EventTypes.MAP_TEMPORAL_CHANGED, ({ enabled }) => {
            if (!enabled) {
                // Close the gate synchronously BEFORE restoring, so a cursor event
                // can't slip in and re-derive over the just-restored canonical image
                // (_refreshEnabled is async and would re-open the gate — features
                // still carry autoDirection/autoSpeed when temporal is merely off).
                this._enabled = false;
                this._restoreAll();
                return;
            }
            this._refreshEnabled();
        });
        this._refreshEnabled();
        return this;
    }

    /** Public: re-evaluate the auto gate (called when a binding toggle changes). */
    refreshEnabled() {
        return this._refreshEnabled();
    }

    /**
     * Re-syncs one symbol's image after its auto bindings change: repaints from the
     * canonical (authored) properties — clearing any stale derived direction/speed —
     * then re-derives whichever bindings are still enabled at the current cursor.
     * Without this, turning a binding OFF would leave its last derived modifier baked
     * into the image until temporal is disabled. Image-only, like the playback path.
     * @param {string} featureId
     * @returns {Promise<void>}
     */
    async reapplyFeature(featureId) {
        if (!featureId) return;
        const gen = getControl(MIL_CONTROL)?.symbolGenerator;
        const source = this._safeSource();
        if (!gen || !source) return;

        let feature;
        try {
            const data = await source.getData();
            feature = (data?.features || []).find((f) => f.properties?.id === featureId);
        } catch {
            return;
        }
        if (!feature) return;

        // Drop the throttle/restore record and repaint from canonical props.
        this._applied.delete(featureId);
        try {
            const result = await gen.generateSymbolBlob(feature.properties);
            await loadImageToMap(this._map, featureId, result.blob, { replaceExisting: true });
        } catch {
            return;
        }

        // Re-open the gate, then re-apply any still-enabled binding at the current cursor.
        await this._refreshEnabled();
        const cursor = getControl('TemporalControl')?.getCursor?.();
        if (this._enabled && Number.isFinite(cursor)) {
            await this._deriveSymbol(gen, feature, cursor);
        }
    }

    /** Coalesces bursty LAYERS_CHANGED events into a single debounced gate rescan. */
    _scheduleRefresh() {
        if (this._refreshTimer) clearTimeout(this._refreshTimer);
        this._refreshTimer = setTimeout(() => {
            this._refreshTimer = null;
            this._refreshEnabled();
        }, GATE_REFRESH_DEBOUNCE_MS);
    }

    /** Cheap gate: whether any military symbol opts into auto direction/speed. */
    async _refreshEnabled() {
        const source = this._safeSource();
        if (!source) {
            this._enabled = false;
            return;
        }
        try {
            const data = await source.getData();
            this._enabled = (data?.features || []).some(
                (f) => f.properties?.autoDirection === true || f.properties?.autoSpeed === true
            );
        } catch {
            this._enabled = false;
        }
    }

    async _onCursor(cursor) {
        if (!this._enabled || this._busy || !Number.isFinite(cursor)) return;
        const gen = getControl(MIL_CONTROL)?.symbolGenerator;
        const source = this._safeSource();
        if (!gen || !source) return;

        this._busy = true;
        try {
            const data = await source.getData();
            // Independent per-feature regens — run them concurrently so several
            // symbols turning in the same frame don't serialize blob generation.
            await Promise.all((data?.features || []).map((feature) => this._deriveSymbol(gen, feature, cursor)));
        } catch {
            /* source not ready — try again on the next cursor event */
        } finally {
            this._busy = false;
        }
    }

    async _deriveSymbol(gen, feature, cursor) {
        const p = feature.properties;
        if (!p?.id || (p.autoDirection !== true && p.autoSpeed !== true)) return;
        const traj = normalizeTrajectory(p.trajetoria);
        if (traj.length < 2) return;
        const heading = headingAtSorted(traj, cursor);
        if (heading === null) return;

        const last = this._applied.get(p.id) || {};
        const overrides = {};
        if (p.autoDirection === true) {
            overrides.direction = String((Math.round(heading / DIRECTION_STEP_DEG) * DIRECTION_STEP_DEG) % 360);
        }
        if (p.autoSpeed === true) {
            overrides.speed = formatSpeedAmplifier(speedAtSorted(traj, cursor));
        }

        const dirChanged = 'direction' in overrides && overrides.direction !== last.direction;
        const speedChanged = 'speed' in overrides && overrides.speed !== last.speed;
        if (!dirChanged && !speedChanged) return; // throttle: nothing meaningful changed

        // Image-only regen with the canonical props + the derived overrides. No source
        // or store writes, so this can't clobber the concurrent geometry displacement.
        const result = await gen.generateSymbolBlob({ ...p, ...overrides });
        await loadImageToMap(this._map, p.id, result.blob, { replaceExisting: true });
        this._applied.set(p.id, { ...last, ...overrides });
    }

    /** Regenerates every touched symbol from its canonical (authored) properties. */
    async _restoreAll() {
        if (this._applied.size === 0) return;
        const gen = getControl(MIL_CONTROL)?.symbolGenerator;
        const source = this._safeSource();
        if (gen && source) {
            try {
                const data = await source.getData();
                await Promise.all(
                    (data?.features || [])
                        .filter((feature) => this._applied.has(feature.properties?.id))
                        .map(async (feature) => {
                            const result = await gen.generateSymbolBlob(feature.properties);
                            await loadImageToMap(this._map, feature.properties.id, result.blob, { replaceExisting: true });
                        })
                );
            } catch {
                /* best-effort restore */
            }
        }
        this._applied.clear();
    }

    _safeSource() {
        try {
            const s = this._map?.getSource(MIL_SOURCE);
            return s && typeof s.getData === 'function' ? s : null;
        } catch {
            return null;
        }
    }

    destroy() {
        if (this._refreshTimer) {
            clearTimeout(this._refreshTimer);
            this._refreshTimer = null;
        }
        cleanup(this);
        this._applied.clear();
    }
}

/**
 * Creates and initialises the temporal derivation service.
 * @param {Object} deps - { map, eventBus }.
 * @returns {TemporalDerivationService}
 */
export function createTemporalDerivationService(deps) {
    const service = new TemporalDerivationService(deps).init();
    registerControl('TemporalDerivation', service);
    return service;
}
