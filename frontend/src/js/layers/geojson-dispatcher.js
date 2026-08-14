// Path: js/layers/geojson-dispatcher.js

/**
 * @fileoverview Serializing, coalescing dispatcher for MapLibre `GeoJSONSource.updateData`.
 *
 * WHY THIS MODULE EXISTS (the measured failure it makes unreachable):
 * back-to-back `updateData` calls LOSE DATA. Measured on the vendored MapLibre 5.18 bundle,
 * with 10 calls issued with no gap between them, only 2 were applied (the first and the last),
 * and waiting 6 s did NOT recover the other 8. That is loss, not a premature read. The same 10
 * calls with a 300 ms gap applied 10/10, and the same 10 changes sent as ONE batch applied 10/10.
 * Reading the bundle explains it: `updateData` folds the incoming diff into a pending one through
 * a merger that keys `add` entries by the TOP-LEVEL `feature.id` and ignores the `promoteId`
 * argument it declares, so features carrying only `properties.id` collapse into a single Map slot.
 *
 * The lesson is not "add a gap between calls". A gap is a race that passes most of the time. The
 * dispatcher makes the losing interleaving IMPOSSIBLE to produce: it owns the source, it keeps a
 * pending batch of its own keyed correctly, and it never issues a second `updateData` for a source
 * while one is in flight. Everything that arrives meanwhile accumulates and leaves as one batch.
 *
 * Three further properties, each answering a measured trap:
 * - `setData` of a whole collection DISCARDS the pending batch for that source. MapLibre replaces
 *   its pending-update slot on `setData`, so a queued diff would either vanish silently or reapply
 *   data the full redraw just removed.
 * - If `updateData` throws (source without a usable key, poisoned by a duplicate or null id), the
 *   dispatcher does NOT swallow it: it rereads the collection, applies the failed batch on top,
 *   writes it back with `setData`, reports through `onError`, and stops diffing that source. A
 *   silently dropped user feature is exactly the failure mode this module exists to kill.
 * - The coalescing logic is a pure function (`coalesceOps`), testable in node without MapLibre.
 *   The scheduling around it is the only part that needs a real map.
 *
 * The precondition on the source side is a resolvable, unique key per feature: `promoteId: 'id'`
 * on the source DECLARATION (see `layers/styles/layer.helpers.js` and `layers/styles/content.layers.js`).
 * Without it `updateData` throws "Cannot update existing geojson data in <source>", which lands on
 * the fallback path above.
 */

/** Key stored in a patch entry to mark a property removal. */
const UNSET = Object.freeze({ op: 'unset' });

/** Milliseconds to wait for the source settle signal before letting the queue move on. */
const SETTLE_TIMEOUT_MS = 2000;

/**
 * Default key extractor. Mirrors `promoteId: 'id'`, falling back to the top-level id.
 * @param {Object} feature - GeoJSON feature
 * @returns {string|number|undefined}
 */
export function defaultKeyOf(feature) {
    return feature?.properties?.id ?? feature?.id;
}

/* ------------------------------------------------------------------------ */
/* Pure coalescing core (no MapLibre, no scheduling, testable in node)        */
/* ------------------------------------------------------------------------ */

/**
 * Creates an empty pending batch.
 *
 * `entries` holds AT MOST ONE slot per key, which is what makes ordering inside the emitted diff
 * irrelevant (MapLibre applies remove, then add, then update, regardless of how the object was
 * built). `replaceAll`, when set, is the base collection a full redraw asked for; entries recorded
 * after it are applied on top of it at flush time.
 * @returns {Object} pending batch
 */
export function createEmptyPending() {
    return { replaceAll: null, entries: new Map(), needsFullData: false };
}

/**
 * @param {Object} pending - Pending batch
 * @returns {boolean} true when there is nothing to send
 */
export function isPendingEmpty(pending) {
    return pending.replaceAll === null && pending.entries.size === 0;
}

/**
 * Copies a pending batch without sharing mutable structure with the original.
 * @param {Object} pending - Pending batch
 * @returns {Object}
 */
function clonePending(pending) {
    const copy = createEmptyPending();
    copy.replaceAll = pending.replaceAll ? pending.replaceAll.slice() : null;
    copy.needsFullData = pending.needsFullData;
    for (const [key, entry] of pending.entries) {
        copy.entries.set(key, entry.kind === 'patch' ? { ...entry, props: new Map(entry.props) } : entry);
    }
    return copy;
}

/**
 * Builds a fresh patch entry from a patch operation.
 * @param {Object} op - Patch operation
 * @returns {Object} patch entry
 */
function newPatchEntry(op) {
    const entry = { kind: 'patch', geometry: op.geometry, clearProps: Boolean(op.clearProps), props: new Map() };
    applyPropChanges(entry, op);
    return entry;
}

/**
 * Folds the property changes of a patch operation into a patch entry.
 * @param {Object} entry - Patch entry (mutated)
 * @param {Object} op - Patch operation
 */
function applyPropChanges(entry, op) {
    if (op.setProps) {
        for (const [key, value] of Object.entries(op.setProps)) {
            entry.props.set(key, { op: 'set', value });
        }
    }
    if (op.unsetProps) {
        const keys = Array.isArray(op.unsetProps) ? op.unsetProps : [op.unsetProps];
        for (const key of keys) {
            // With removeAllProperties already pending, an explicit removal has nothing left to
            // remove: dropping the key is the same result with a smaller diff.
            if (entry.clearProps) entry.props.delete(key);
            else entry.props.set(key, UNSET);
        }
    }
}

/**
 * Applies a patch to a feature, returning a new feature. Never mutates the input.
 * @param {Object} feature - GeoJSON feature
 * @param {Object} patch - Patch entry
 * @returns {Object} patched feature
 */
function applyPatchToFeature(feature, patch) {
    const next = { ...feature };
    if (patch.geometry) next.geometry = patch.geometry;

    const props = patch.clearProps ? {} : { ...(feature.properties || {}) };
    for (const [key, change] of patch.props) {
        if (change.op === 'set') props[key] = change.value;
        else delete props[key];
    }
    next.properties = props;
    return next;
}

/**
 * THE PAIRING RULES. Folds one operation onto whatever is already pending for the same key.
 *
 * Returns the new entry for that key. The decisions, and why:
 * - anything + remove  -> remove. Not "nothing": the key may already exist in the source, and a
 *   `remove` of an absent id is a documented silent no-op, so keeping the remove is correct in both
 *   cases while dropping it would resurrect a feature the caller deleted.
 * - add + patch        -> a single add carrying the final state. The buffered feature is complete,
 *   so the patch is applied to a copy of it and no `update` needs to be emitted at all.
 * - patch + add        -> add. `add` on an existing key is a TOTAL replacement in MapLibre, never a
 *   merge, so an earlier partial patch cannot survive it.
 * - remove + add       -> add, NOT update. Two reasons: `add` on an existing key replaces the whole
 *   feature (no stale property survives), and `update` on a key that never existed is a silent
 *   no-op, which would lose the feature outright in the create case. Dropping the remove is safe
 *   because MapLibre still collects the old geometry from the entry it is about to overwrite, so
 *   the old tiles are invalidated the same way.
 * - remove + patch     -> remove, patch dropped. Patching a feature the caller just removed is a
 *   caller bug, and MapLibre would no-op it anyway.
 * - add + add          -> the later add (total replacement).
 * - patch + patch      -> merged patch: later values win, `clearProps` voids every property change
 *   recorded before it.
 * - remove + remove    -> remove (idempotent).
 * @param {Object|undefined} prev - Entry already pending for this key
 * @param {Object} op - Operation to fold in
 * @returns {Object} new entry
 */
export function mergeEntry(prev, op) {
    if (op.kind === 'remove') return { kind: 'remove' };

    if (op.kind === 'add') return { kind: 'add', feature: op.feature };

    // op.kind === 'patch'
    if (!prev) return newPatchEntry(op);

    if (prev.kind === 'remove') return prev;

    if (prev.kind === 'add') {
        return { kind: 'add', feature: applyPatchToFeature(prev.feature, newPatchEntry(op)) };
    }

    const merged = { kind: 'patch', geometry: op.geometry ?? prev.geometry, clearProps: prev.clearProps, props: new Map(prev.props) };
    if (op.clearProps) {
        merged.clearProps = true;
        merged.props = new Map();
    }
    applyPropChanges(merged, op);
    return merged;
}

/**
 * Folds one operation into a pending batch, MUTATING it. Private fast path: the dispatcher owns its
 * pending object and calling the pure `coalesceOps` per feature would copy the batch once per call.
 * `coalesceOps` runs this exact function on a copy, so the tested logic is the shipped logic.
 * @param {Object} pending - Pending batch (mutated)
 * @param {Object} op - Operation
 * @param {Function} keyOf - Key extractor
 */
function applyOpMutably(pending, op, keyOf) {
    if (op.kind === 'replaceAll') {
        // A full redraw overwrites the source anyway: everything queued before it is dead weight,
        // and replaying it afterwards would resurrect exactly what the redraw removed.
        pending.replaceAll = op.features.slice();
        pending.entries.clear();
        pending.needsFullData = false;
        return;
    }

    const key = op.kind === 'add' ? keyOf(op.feature) : op.id;
    if (key === null || key === undefined) {
        // A keyless feature cannot be diffed and would be discarded in silence by MapLibre.
        // Mark the batch so the dispatcher takes the whole-collection path and keeps the feature.
        pending.needsFullData = true;
        if (op.kind === 'add') {
            pending.entries.set(Symbol('unkeyed'), { kind: 'add', feature: op.feature });
        }
        return;
    }

    pending.entries.set(key, mergeEntry(pending.entries.get(key), op));
}

/**
 * Folds a list of operations into a pending batch. PURE: the input batch is never mutated.
 *
 * Operation shapes:
 * - `{ kind: 'add', feature }`
 * - `{ kind: 'patch', id, geometry?, setProps?, unsetProps?, clearProps? }`
 * - `{ kind: 'remove', id }`
 * - `{ kind: 'replaceAll', features }`
 * @param {Object} pending - Pending batch
 * @param {Array<Object>} ops - Operations, in the order the caller issued them
 * @param {Function} [keyOf] - Key extractor
 * @returns {Object} new pending batch
 */
export function coalesceOps(pending, ops, keyOf = defaultKeyOf) {
    const next = clonePending(pending);
    for (const op of ops) applyOpMutably(next, op, keyOf);
    return next;
}

/**
 * Stamps the promoted key onto the top-level `id` of a feature, copying it when needed.
 *
 * Defense in depth: MapLibre's own diff merger keys `add` entries by `feature.id` and ignores
 * `promoteId`, so a feature carrying only `properties.id` collapses with its neighbours if a diff
 * ever reaches that merger. The dispatcher normally keeps the merger unreachable, but the stamp
 * makes the degraded path correct instead of lossy.
 * @param {Object} feature - GeoJSON feature
 * @param {string|number} key - Promoted key
 * @returns {Object} feature carrying the key at top level
 */
function stampKey(feature, key) {
    return feature.id === key ? feature : { ...feature, id: key };
}

/**
 * Converts a pending batch into a MapLibre diff. PURE.
 *
 * `addOrUpdateProperties` is always an array, even when empty: MapLibre's merger calls
 * `findIndex` on it when fusing two updates of the same id, and throws a TypeError from inside
 * `updateData` when it is undefined.
 * @param {Object} pending - Pending batch
 * @returns {Object|null} diff `{ add?, update?, remove? }`, or null when there is nothing to send
 */
export function pendingToDiff(pending) {
    const add = [];
    const update = [];
    const remove = [];

    for (const [key, entry] of pending.entries) {
        if (typeof key === 'symbol') continue;
        if (entry.kind === 'add') {
            add.push(stampKey(entry.feature, key));
        } else if (entry.kind === 'remove') {
            remove.push(key);
        } else {
            const addOrUpdateProperties = [];
            const removeProperties = [];
            for (const [prop, change] of entry.props) {
                if (change.op === 'set') addOrUpdateProperties.push({ key: prop, value: change.value });
                else removeProperties.push(prop);
            }
            const hasWork = entry.geometry || entry.clearProps || addOrUpdateProperties.length || removeProperties.length;
            if (!hasWork) continue;

            const patch = { id: key, addOrUpdateProperties };
            if (entry.geometry) patch.newGeometry = entry.geometry;
            if (entry.clearProps) patch.removeAllProperties = true;
            else if (removeProperties.length) patch.removeProperties = removeProperties;
            update.push(patch);
        }
    }

    if (!add.length && !update.length && !remove.length) return null;

    const diff = {};
    if (remove.length) diff.remove = remove;
    if (add.length) diff.add = add;
    if (update.length) diff.update = update;
    return diff;
}

/**
 * Applies a pending batch to a plain feature array. PURE: input array and features are not mutated.
 * Used by the whole-collection paths (full redraw, and the fallback after a failed diff).
 * @param {Array<Object>} features - Base features
 * @param {Object} pending - Pending batch
 * @param {Function} [keyOf] - Key extractor
 * @returns {Array<Object>} resulting features
 */
export function applyPendingToFeatures(features, pending, keyOf = defaultKeyOf) {
    const base = pending.replaceAll ? pending.replaceAll : features;
    const result = base.slice();
    const positions = new Map();

    for (let i = 0; i < result.length; i++) {
        const key = keyOf(result[i]);
        if (key !== null && key !== undefined && !positions.has(key)) positions.set(key, i);
    }

    const holes = new Set();
    for (const [key, entry] of pending.entries) {
        const at = typeof key === 'symbol' ? undefined : positions.get(key);
        if (entry.kind === 'remove') {
            if (at !== undefined) holes.add(at);
        } else if (entry.kind === 'add') {
            const feature = typeof key === 'symbol' ? entry.feature : stampKey(entry.feature, key);
            if (at === undefined) {
                positions.set(key, result.length);
                result.push(feature);
            } else {
                result[at] = feature;
                holes.delete(at);
            }
        } else if (at !== undefined) {
            result[at] = applyPatchToFeature(result[at], entry);
            holes.delete(at);
        }
    }

    return holes.size ? result.filter((_, i) => !holes.has(i)) : result;
}

/* ------------------------------------------------------------------------ */
/* Scheduling (needs a map; one queue per source)                            */
/* ------------------------------------------------------------------------ */

/**
 * Default flush scheduler: one animation frame, falling back to a macrotask off-screen and in node.
 * @param {Function} cb - Callback
 * @returns {Object} cancellable handle
 */
function defaultSchedule(cb) {
    if (typeof requestAnimationFrame === 'function') {
        return { raf: requestAnimationFrame(cb) };
    }
    return { timeout: setTimeout(cb, 0) };
}

/**
 * @param {Object} handle - Handle returned by `defaultSchedule`
 */
function defaultCancelSchedule(handle) {
    if (!handle) return;
    if (handle.raf !== undefined && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle.raf);
    if (handle.timeout !== undefined) clearTimeout(handle.timeout);
}

/**
 * One queue for one GeoJSON source. Never issues two overlapping `updateData` calls for it.
 */
export class GeoJsonDispatcher {
    /**
     * @param {Object} map - MapLibre map instance
     * @param {string} sourceId - Source id this dispatcher owns
     * @param {Object} [options] - Options
     * @param {Function} [options.keyOf] - Key extractor, must match the source `promoteId`
     * @param {Function} [options.onError] - Called as (message, error, context) on any failure
     * @param {Function} [options.schedule] - Flush scheduler, for tests
     * @param {Function} [options.cancelSchedule] - Scheduler canceller, for tests
     * @param {number} [options.settleTimeoutMs] - Cap on waiting for the source settle signal
     */
    constructor(map, sourceId, options = {}) {
        this.map = map;
        this.sourceId = sourceId;
        this._keyOf = options.keyOf || defaultKeyOf;
        this._onError = options.onError || null;
        this._schedule = options.schedule || defaultSchedule;
        this._cancelSchedule = options.cancelSchedule || defaultCancelSchedule;
        this._settleTimeoutMs = options.settleTimeoutMs ?? SETTLE_TIMEOUT_MS;

        this._pending = createEmptyPending();
        this._scheduled = null;
        this._pumping = null;
        this._destroyed = false;
        this._diffDisabled = false;
        this._activeSettle = null;
        // Settle timers are per dispatch, so they are held here and deleted as they settle.
        // `@utils/event-cleanup.js` tracks timers in an append-only array sized for a component
        // lifetime, which would grow once per dispatch here; every timer and every map listener
        // this class opens is closed either on settle or in destroy().
        this._timers = new Set();
    }

    /**
     * Queues one or more features as full-feature upserts.
     * @param {Object|Array<Object>} featureOrFeatures - GeoJSON feature(s)
     */
    add(featureOrFeatures) {
        const features = Array.isArray(featureOrFeatures) ? featureOrFeatures : [featureOrFeatures];
        for (const feature of features) {
            if (feature) this._enqueue({ kind: 'add', feature });
        }
    }

    /**
     * Queues a partial change to one feature.
     * @param {string|number} id - Promoted key of the feature
     * @param {Object} changes - `{ geometry, setProps, unsetProps, clearProps }`
     */
    patch(id, changes = {}) {
        this._enqueue({
            kind: 'patch',
            id,
            geometry: changes.geometry,
            setProps: changes.setProps,
            unsetProps: changes.unsetProps,
            clearProps: changes.clearProps,
        });
    }

    /**
     * Queues one or more removals.
     * @param {string|number|Array} idOrIds - Promoted key(s)
     */
    remove(idOrIds) {
        const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
        for (const id of ids) this._enqueue({ kind: 'remove', id });
    }

    /**
     * Escape hatch: rewrites the whole collection and DISCARDS whatever was pending for this source.
     * Use it for the paths where the delta is the collection itself (initial load, map switch,
     * redraw after `setStyle`, mass mutation).
     * @param {Object|Array<Object>} collectionOrFeatures - FeatureCollection or feature array
     */
    setData(collectionOrFeatures) {
        const features = Array.isArray(collectionOrFeatures)
            ? collectionOrFeatures
            : (collectionOrFeatures?.features || []);
        this._enqueue({ kind: 'replaceAll', features });
    }

    /**
     * @returns {boolean} true when nothing is queued and nothing is in flight
     */
    isIdle() {
        return !this._pumping && isPendingEmpty(this._pending);
    }

    /**
     * Sends everything queued and resolves once the source has settled.
     * @returns {Promise<void>}
     */
    async flush() {
        if (this._destroyed) return;
        this._clearSchedule();
        await this._pump();
        while (!this._destroyed && !isPendingEmpty(this._pending)) {
            this._clearSchedule();
            await this._pump();
        }
    }

    /**
     * Drops the queue, the timers and every map listener this dispatcher opened.
     */
    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        this._clearSchedule();
        this._activeSettle?.cancel();
        for (const timer of this._timers) clearTimeout(timer);
        this._timers.clear();
        this._pending = createEmptyPending();
        unregisterDispatcher(this.map, this.sourceId, this);
    }

    /**
     * @param {Object} op - Operation
     */
    _enqueue(op) {
        if (this._destroyed) return;
        applyOpMutably(this._pending, op, this._keyOf);
        this._scheduleFlush();
    }

    _scheduleFlush() {
        if (this._destroyed || this._scheduled !== null || this._pumping) return;
        this._scheduled = this._schedule(() => {
            this._scheduled = null;
            this._pump();
        });
    }

    _clearSchedule() {
        if (this._scheduled !== null) {
            this._cancelSchedule(this._scheduled);
            this._scheduled = null;
        }
    }

    /**
     * @returns {Promise<void>} resolves when the queue has drained
     */
    _pump() {
        if (this._pumping) return this._pumping;
        this._pumping = this._runLoop().finally(() => {
            this._pumping = null;
            // An operation enqueued between the last loop check and this line saw `_pumping` set
            // and skipped scheduling, so the loop would never come back for it.
            if (!this._destroyed && !isPendingEmpty(this._pending)) this._scheduleFlush();
        });
        return this._pumping;
    }

    async _runLoop() {
        while (!this._destroyed && !isPendingEmpty(this._pending)) {
            const batch = this._pending;
            this._pending = createEmptyPending();
            await this._dispatchBatch(batch);
        }
    }

    /**
     * Sends exactly one batch and waits for it. Never throws: a failure lands on the
     * whole-collection fallback so that no queued feature is lost.
     * @param {Object} batch - Pending batch
     */
    async _dispatchBatch(batch) {
        const source = this.map.getSource(this.sourceId);
        if (!source) {
            // Source gone (style switch removes and recreates every custom source). The redraw path
            // repopulates it with a full setData, so the batch is stale, not lost.
            this.destroy();
            return;
        }

        const wholeCollection = batch.replaceAll !== null || batch.needsFullData
            || this._diffDisabled || typeof source.updateData !== 'function';

        if (wholeCollection) {
            await this._writeWholeCollection(source, batch);
            return;
        }

        const diff = pendingToDiff(batch);
        if (!diff) return;

        const settle = this._waitForSettle();
        try {
            source.updateData(diff);
        } catch (error) {
            settle.cancel();
            await this._recover(batch, error);
            return;
        }

        try {
            await settle.promise;
        } catch (error) {
            await this._recover(batch, error);
        }
    }

    /**
     * Fallback after a failed diff. Rereads the collection, replays the failed batch on top and
     * writes it back whole, then stops diffing this source: the usual cause is a key that is null
     * or duplicated somewhere in the collection, which keeps every later diff throwing.
     * @param {Object} batch - Batch that failed
     * @param {Error} error - Failure
     */
    async _recover(batch, error) {
        this._diffDisabled = true;
        this._report(`updateData falhou em "${this.sourceId}", caindo para setData da colecao inteira`, error, batch);
        const source = this.map.getSource(this.sourceId);
        if (!source) {
            this.destroy();
            return;
        }
        try {
            await this._writeWholeCollection(source, batch);
        } catch (fallbackError) {
            this._report(`fallback setData tambem falhou em "${this.sourceId}"`, fallbackError, batch);
        }
    }

    /**
     * @param {Object} source - MapLibre GeoJSONSource
     * @param {Object} batch - Pending batch
     */
    async _writeWholeCollection(source, batch) {
        let current = [];
        if (batch.replaceAll === null) {
            current = await this._readCurrentFeatures(source);
        }
        const features = applyPendingToFeatures(current, batch, this._keyOf);
        const settle = this._waitForSettle();
        try {
            source.setData({ type: 'FeatureCollection', features });
        } catch (error) {
            settle.cancel();
            throw error;
        }
        await settle.promise.catch((error) => {
            this._report(`setData reportou erro em "${this.sourceId}"`, error, null);
        });
    }

    /**
     * @param {Object} source - MapLibre GeoJSONSource
     * @returns {Promise<Array<Object>>} current features, empty when unreadable
     */
    async _readCurrentFeatures(source) {
        if (typeof source.getData !== 'function') return [];
        try {
            const data = await source.getData();
            return data?.features || [];
        } catch (error) {
            this._report(`getData falhou em "${this.sourceId}"`, error, null);
            return [];
        }
    }

    /**
     * Waits for the source to report it finished the round-trip.
     *
     * The signal is the map `sourcedata` event for this source with `sourceDataType === 'content'`
     * plus `source.loaded()`. The promise returned by `updateData` is NOT usable here: it resolves
     * with undefined as soon as the diff is merely queued.
     *
     * The timeout resolves instead of rejecting. A queue that wedges forever is worse than a rare
     * second call, and the degraded case is covered: every feature carries its promoted key at the
     * top level, so even MapLibre's own merger fuses the two diffs correctly.
     * @returns {{promise: Promise<void>, cancel: Function}}
     */
    _waitForSettle() {
        let settled = false;
        let timer = null;
        let onData = null;
        let onError = null;
        let handle = null;
        let resolveNow = null;

        const teardown = () => {
            settled = true;
            if (timer !== null) {
                clearTimeout(timer);
                this._timers.delete(timer);
                timer = null;
            }
            this.map.off('sourcedata', onData);
            this.map.off('error', onError);
            if (this._activeSettle === handle) this._activeSettle = null;
        };

        const promise = new Promise((resolve, reject) => {
            resolveNow = resolve;
            onData = (event) => {
                if (settled || event?.sourceId !== this.sourceId) return;
                if (event.sourceDataType && event.sourceDataType !== 'content') return;
                const source = this.map.getSource(this.sourceId);
                if (source && typeof source.loaded === 'function' && !source.loaded()) return;
                teardown();
                resolve();
            };
            onError = (event) => {
                if (settled || event?.sourceId !== this.sourceId) return;
                teardown();
                reject(event.error || new Error(`Erro na fonte "${this.sourceId}"`));
            };

            this.map.on('sourcedata', onData);
            this.map.on('error', onError);

            timer = setTimeout(() => {
                if (settled) return;
                teardown();
                resolve();
            }, this._settleTimeoutMs);
            this._timers.add(timer);
        });

        // `cancel` resolves instead of leaving the promise dangling, so a destroy in mid flight
        // does not leave `_runLoop` awaiting something that can never settle.
        handle = {
            promise,
            cancel: () => {
                if (settled) return;
                teardown();
                resolveNow();
            },
        };
        this._activeSettle = handle;
        return handle;
    }

    /**
     * @param {string} message - pt-BR message for the operator log
     * @param {Error} error - Underlying error
     * @param {Object|null} batch - Batch involved, when there is one
     */
    _report(message, error, batch) {
        console.error(`[geojson-dispatcher] ${message}`, error);
        if (this._onError) {
            try {
                this._onError(message, error, { sourceId: this.sourceId, batch });
            } catch (handlerError) {
                console.error('[geojson-dispatcher] onError lancou', handlerError);
            }
        }
    }
}

/* ------------------------------------------------------------------------ */
/* Registry: one dispatcher per (map, sourceId)                              */
/* ------------------------------------------------------------------------ */

/** @type {WeakMap<Object, Map<string, GeoJsonDispatcher>>} */
const registry = new WeakMap();

/**
 * @param {Object} map - MapLibre map instance
 * @param {string} sourceId - Source id
 * @param {GeoJsonDispatcher} dispatcher - Dispatcher to forget
 */
function unregisterDispatcher(map, sourceId, dispatcher) {
    const perMap = registry.get(map);
    if (perMap && perMap.get(sourceId) === dispatcher) perMap.delete(sourceId);
}

/**
 * Returns the dispatcher that owns a source, creating it on first use.
 *
 * A source may only be written through ONE dispatcher: a `setData` issued outside it wipes the
 * queued diff without any error.
 * @param {Object} map - MapLibre map instance
 * @param {string} sourceId - Source id
 * @param {Object} [options] - Options, honoured on creation only
 * @returns {GeoJsonDispatcher}
 */
export function getGeoJsonDispatcher(map, sourceId, options = {}) {
    let perMap = registry.get(map);
    if (!perMap) {
        perMap = new Map();
        registry.set(map, perMap);
    }
    let dispatcher = perMap.get(sourceId);
    if (!dispatcher) {
        dispatcher = new GeoJsonDispatcher(map, sourceId, options);
        perMap.set(sourceId, dispatcher);
    }
    return dispatcher;
}

/**
 * Returns the dispatcher that already owns a source, WITHOUT creating one.
 *
 * The difference from `getGeoJsonDispatcher` is the whole point: creating a dispatcher on a source
 * nobody migrated would quietly enlarge the set of sources that must be written through a queue,
 * and every raw writer of those sources would become a data-loss path without a single line of
 * code changing. Ownership is claimed by the tool that migrated the source, never as a side effect
 * of a redraw.
 * @param {Object} map - MapLibre map instance
 * @param {string} sourceId - Source id
 * @returns {GeoJsonDispatcher|null} the owner, or null when the source has none
 */
export function peekGeoJsonDispatcher(map, sourceId) {
    return registry.get(map)?.get(sourceId) || null;
}

/**
 * Replaces a source's whole collection, through the dispatcher when the source has one.
 *
 * This is the ONE function the full-redraw paths should call, and it exists because the redraw is
 * the co-writer the dispatcher cannot see: `setOrCreateSource` (`layers/styles/layer.helpers.js`)
 * writes all sixteen migrated sources, so a raw `getSource(id).setData(fc)` there replaces
 * MapLibre's pending-update slot and the diff a tool just queued disappears with no error.
 *
 * When no dispatcher owns the source there is, by construction, no queue to lose, so the raw write
 * is the correct and cheaper answer: the source is not migrated. This asymmetry is why the function
 * peeks instead of getting.
 *
 * Note the semantics the caller inherits from `GeoJsonDispatcher.setData`: a whole collection is a
 * `replaceAll`, which DISCARDS whatever was queued for that source. That is right for a redraw
 * (the collection being written IS the new truth) and wrong for a read-modify-write, which must
 * `await dispatcher.flush()` before reading so that the copy it modifies already contains the
 * queued work.
 * @param {Object} map - MapLibre map instance
 * @param {string} sourceId - Source id
 * @param {Object} data - FeatureCollection to write
 * @returns {boolean} true when the write went through a dispatcher
 */
export function writeWholeCollection(map, sourceId, data) {
    const dispatcher = peekGeoJsonDispatcher(map, sourceId);
    if (dispatcher) {
        dispatcher.setData(data);
        return true;
    }
    map.getSource(sourceId)?.setData(data);
    return false;
}

/**
 * @param {Object} map - MapLibre map instance
 * @param {string} sourceId - Source id
 */
export function destroyGeoJsonDispatcher(map, sourceId) {
    registry.get(map)?.get(sourceId)?.destroy();
}

/**
 * Drops every dispatcher of a map. Call it when the map itself goes away.
 * @param {Object} map - MapLibre map instance
 */
export function destroyGeoJsonDispatchers(map) {
    const perMap = registry.get(map);
    if (!perMap) return;
    for (const dispatcher of [...perMap.values()]) dispatcher.destroy();
    registry.delete(map);
}
