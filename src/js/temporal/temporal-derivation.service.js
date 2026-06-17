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

/** Formats a m/s speed as the Z amplifier string (rounded km/h), or '' when undefined. */
function formatSpeedAmplifier(mps) {
    if (!Number.isFinite(mps) || mps <= 0) return '';
    return `${Math.round(mps * 3.6)} km/h`;
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
        setupCleanup(this);
    }

    init() {
        subscribe(this, this._eventBus, EventTypes.TEMPORAL_CURSOR_CHANGED, ({ cursor }) => this._onCursor(cursor));
        subscribe(this, this._eventBus, EventTypes.LAYERS_CHANGED, () => this._refreshEnabled());
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
            for (const feature of data?.features || []) {
                await this._deriveSymbol(gen, feature, cursor);
            }
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
                for (const feature of data?.features || []) {
                    if (!this._applied.has(feature.properties?.id)) continue;
                    const result = await gen.generateSymbolBlob(feature.properties);
                    await loadImageToMap(this._map, feature.properties.id, result.blob, { replaceExisting: true });
                }
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
