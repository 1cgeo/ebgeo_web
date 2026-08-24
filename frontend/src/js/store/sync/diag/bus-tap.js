// Path: js/store/sync/diag/bus-tap.js

/**
 * @fileoverview Installs the SyncLedger event-bus tap: a SINGLE `onAny()` subscription
 * that turns the lifecycle events the remote handler already emits into inbound Spans
 * (`remote.applied`) and probes the rendered MapLibre source for the UI-effect Span
 * (`render.source`). One subscription observes the whole bus.
 *
 * Cost discipline: the handler early-returns when tracing is off (so production / the
 * disabled state pay only a boolean per emit), and it acts ONLY on an allowlist — hot
 * per-frame events (TEMPORAL_CURSOR_CHANGED, presence cursors) reach it but are ignored
 * with a single switch miss, never buffered.
 */

import { EventTypes } from '../../../events/event_types.js';
import { getStorageTypeFromSource } from '../../store.constants.js';
import { getClientId } from '../operation-factory.js';
import { record, isTracing, setTraceClientId } from './trace-core.js';
import { TraceStage, TraceOutcome } from './trace-stages.js';

/** Defers a probe to a microtask so it reads the source AFTER the synchronous
 * lifecycle-event dispatch (where the layer manager calls `setData`). */
const deferProbe = (typeof queueMicrotask === 'function')
    ? queueMicrotask
    : (fn) => { Promise.resolve().then(fn); };

/**
 * Whether the `render.source` probe is enabled. OFF by default: the probe reads the
 * GeoJSON source O(features) on every feature event, which is overhead a heavy session
 * (rapid conflict edits, multi-drag) does not need — the deterministic signal is
 * `remote.applied`, recorded cheaply above. Opt in with `globalThis.__EBGEO_TRACE_RENDER__`
 * when you specifically want the store↔render parity annotation (invariant I6).
 * @returns {boolean}
 */
function renderProbeOn() {
    try {
        return typeof globalThis !== 'undefined' && !!globalThis.__EBGEO_TRACE_RENDER__;
    } catch {
        return false;
    }
}

/**
 * Reads the rendered MapLibre GeoJSON source for a feature and records a
 * `render.source` Span (store↔render parity, invariant I6). Best-effort: never throws.
 * @param {string} featureId
 * @param {string} [featureType] - The feature's `source` type (point/line/...).
 * @param {string} [mapId]
 */
function probeRenderSource(featureId, featureType, mapId) {
    try {
        const map = (typeof globalThis !== 'undefined') ? globalThis.__ebgeoMap : null;
        if (!map || typeof map.getSource !== 'function') {
            record(TraceStage.RENDER_SOURCE, { entityId: featureId, mapId, available: false });
            return;
        }
        const sourceId = featureType ? getStorageTypeFromSource(featureType) : null;
        const src = sourceId ? map.getSource(sourceId) : null;
        // MapLibre 5 wraps what `setData` received: `_data` is `{ geojson }` (or
        // `{ url }`), NOT the collection itself. Reading `_data.features` gave
        // `undefined` on every call, so this probe reported `inSource: false`
        // ALWAYS — and a waiter on `inSource === false` (the delete case) was
        // satisfied vacuously, whatever the map was actually showing. Both shapes
        // are accepted so the probe survives the wrapper changing again.
        // The async `getData()` is the public accessor, but this probe is a
        // synchronous best-effort tap and must not await inside the event path.
        const raw = src && src._data;
        const geo = (raw && Array.isArray(raw.features)) ? raw : (raw && raw.geojson);
        const feats = (geo && Array.isArray(geo.features)) ? geo.features : null;
        record(TraceStage.RENDER_SOURCE, {
            entityId: featureId, mapId, sourceId,
            sourceCount: feats ? feats.length : null,
            inSource: feats ? feats.some((f) => f && f.properties && f.properties.id === featureId) : false,
            outcome: TraceOutcome.OK,
        });
    } catch {
        record(TraceStage.RENDER_SOURCE, { entityId: featureId, mapId, available: false });
    }
}

/**
 * The single wildcard handler. Returns immediately when tracing is off; acts only on
 * an allowlist so hot per-frame events never reach the buffer.
 * @param {string} event
 * @param {Object} payload
 */
function onAnyEvent(event, payload) {
    if (!isTracing()) return;
    try {
        switch (event) {
            case EventTypes.REMOTE_OPERATION_APPLIED: {
                const op = payload && payload.operation;
                // O REPARO DO PRÓPRIO AUTOR NÃO É UM PAR APLICANDO, e carimbá-lo aqui
                // silenciaria o detector de órfã: `reduceLedger` monta `appliedOn` a partir
                // deste estágio SEM excluir o autor (`tests/e2e-ui/helpers/ledger.js`), então
                // um span emitido pelo autor faria a op parecer aplicada em alguém. O silêncio
                // chegaria justamente nas ops em disputa, que é onde a órfã importa. O reparo
                // reentra por `applyRemoteOperation` de propósito (mesmos handlers, mesmos
                // locks, mesmos eventos de ciclo de vida para a tela); só o span é que mentiria.
                if (op && !op.localRepair) {
                    record(TraceStage.REMOTE_APPLIED, {
                        opId: op.id, traceId: op.traceId, clientId: op.clientId,
                        entityType: op.entityType, operationType: op.operationType,
                        entityId: op.entityId, mapId: op.mapId, outcome: TraceOutcome.OK,
                    });
                }
                break;
            }
            case EventTypes.FEATURE_CREATED:
            case EventTypes.FEATURE_MODIFIED:
            case EventTypes.FEATURE_DELETED: {
                if (renderProbeOn() && payload && payload.featureId) {
                    const { featureId, featureType, mapId } = payload;
                    deferProbe(() => probeRenderSource(featureId, featureType, mapId));
                }
                break;
            }
            default:
                break;
        }
    } catch {
        // The tap must never break event delivery.
    }
}

/**
 * Installs the tap on the app event bus. Call once at boot from `initServices`.
 * @param {import('../../../events/event_bus.js').EventBus} eventBus
 * @returns {Function} Unsubscribe function.
 */
export function installSyncTrace(eventBus) {
    setTraceClientId(getClientId());
    return eventBus.onAny(onAnyEvent);
}
