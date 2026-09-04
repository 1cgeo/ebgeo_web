// Path: js/tool_manager/helpers/preview-scheduler.js

/**
 * @fileoverview One rAF gate for a drawing tool's preview.
 *
 * A mouse fires several `mousemove` events inside a single frame, and only the
 * LAST of them is ever drawn. The old shape of this code did the expensive work
 * on the raw event and then asked for a frame, so the work was repeated 3 to 5
 * times per drawn pixel; some tools also wrapped the drawing in a
 * `setTimeout(..., 8)`, which coalesces nothing (8 ms is under the 16.7 ms of a
 * frame) and only pushes the drawing one timer late.
 *
 * The gate here is the fix: the raw event only PARKS the pointer, and the
 * scheduler hands the last parked one to the callback once per frame.
 *
 * WHY THE SNAPPING IS NOT IN HERE
 * `resolveSnap(pointer)` was considered and left out on purpose. The snapping
 * service takes per-tool arguments (the feature id to exclude while dragging a
 * handle or continuing a line, the indicator policy, the tools that do not snap
 * at all), so a hook here would either be a pass-through with an extra name or
 * would drag that policy into a utility that must stay free of it. The tool
 * calls `snapping.resolve(map, pointer.point, pointer.lngLat, excludeId)` inside
 * its own frame callback instead, which is where it belongs and is what the
 * coordination line already does.
 *
 * No timer lives here, and `requestAnimationFrame` / `cancelAnimationFrame` are
 * injected, so the whole module runs (and is tested) on `node` without
 * `document`.
 *
 * @module tool_manager/helpers/preview-scheduler
 */

/**
 * @typedef {Object} PreviewScheduler
 * @property {(pointer: any) => boolean} request Park a pointer and ask for a frame.
 *   Returns true when this call is the one that scheduled the frame.
 * @property {(callback?: (pointer: any) => void) => any} flush Deliver the parked
 *   pointer NOW, cancelling the scheduled frame. Returns the pointer delivered.
 * @property {() => void} cancel Drop the scheduled frame and the parked pointer.
 * @property {boolean} pending Whether a frame is scheduled and not yet delivered.
 * @property {any} pointer The parked pointer, or null.
 */

/**
 * Build the rAF gate.
 *
 * @param {Object} options - Wiring
 * @param {(callback: () => void) => any} options.raf - `requestAnimationFrame`
 * @param {(id: any) => void} options.caf - `cancelAnimationFrame`
 * @param {(pointer: any) => void} [options.onFrame] - What runs once per frame,
 *   given the last pointer parked by `request`. Required to use `request`;
 *   `flush(callback)` can be driven by hand without it.
 * @returns {PreviewScheduler} The gate
 */
export function createPreviewScheduler({ raf, caf, onFrame } = {}) {
    // Named loudly: a scheduler built without these draws nothing and cancels
    // nothing, and both failures are invisible at the call site.
    if (typeof raf !== 'function') {
        throw new TypeError(
            'createPreviewScheduler: `raf` is required and must be a function, '
            + 'e.g. `raf: (cb) => requestAnimationFrame(cb)`. Without it no preview frame is ever scheduled.',
        );
    }
    if (typeof caf !== 'function') {
        throw new TypeError(
            'createPreviewScheduler: `caf` is required and must be a function, '
            + 'e.g. `caf: (id) => cancelAnimationFrame(id)`. Without it `cancel()` cannot stop a scheduled frame.',
        );
    }
    if (onFrame !== undefined && typeof onFrame !== 'function') {
        throw new TypeError('createPreviewScheduler: `onFrame` must be a function when given.');
    }

    let frameId = null;
    let pointer = null;
    let pending = false;

    /** Clear the gate and hand back the pointer it was holding. */
    const take = () => {
        frameId = null;
        pending = false;
        const parked = pointer;
        pointer = null;
        return parked;
    };

    const scheduler = {
        request(nextPointer = null) {
            if (typeof onFrame !== 'function') {
                throw new TypeError(
                    'createPreviewScheduler: `request` needs an `onFrame` callback; '
                    + 'the scheduled frame would have nothing to deliver the pointer to.',
                );
            }
            // The LAST pointer of the frame wins, which is the one the user sees.
            pointer = nextPointer;
            if (pending) return false;
            pending = true;
            frameId = raf(() => scheduler.flush());
            return true;
        },

        flush(callback) {
            const deliver = callback ?? onFrame;
            if (typeof deliver !== 'function') {
                throw new TypeError('createPreviewScheduler: `flush` needs a callback, or an `onFrame` at creation.');
            }
            // Harmless when we are already inside the frame this id belongs to,
            // and necessary when `flush` is called by hand before it fires.
            if (frameId !== null) caf(frameId);
            const parked = take();
            deliver(parked);
            return parked;
        },

        cancel() {
            if (frameId !== null) caf(frameId);
            take();
        },

        get pending() {
            return pending;
        },

        get pointer() {
            return pointer;
        },
    };

    return scheduler;
}

export default createPreviewScheduler;
