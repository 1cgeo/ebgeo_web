// Path: tests/unit/visibility-recalc-serialization.test.js

/**
 * Viewshed recalculations must be serialized and the progress modal ref-counted.
 *
 * Regression: the debounced parameter change (slider) called
 * `recalculateAfterParameterChange` DIRECTLY, while the drag/move paths went
 * through `recalculateQueue`. A handle drag released inside the 1s debounce
 * window therefore ran concurrently with the slider recalculation: both read
 * `getSource(...).getData()` up front and both `setData()` at the end, so one
 * write was lost, and whichever finished first closed the other's modal.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@store', () => ({
    addFeature: vi.fn(),
    removeFeature: vi.fn(),
    getCurrentMapFeatures: vi.fn(),
    batchUpdateVisibilityFeatures: vi.fn(),
    getActiveLayerIdSync: vi.fn(() => 'layer-1')
}));
vi.mock('@utils', () => ({
    IDUtils: { generateUniqueId: vi.fn(), generateFeatureName: vi.fn() }
}));
vi.mock('@utils/pointer-utils', () => ({ getPointerPosition: vi.fn() }));
vi.mock('@js/snapping', () => ({ getSnappingService: vi.fn(() => null) }));
vi.mock('@js/analysis_tools/visibility_tool/visibility_attributes_panel.js', () => ({
    addVisibilityAttributesToPanel: vi.fn(),
    addVisibilityParametersToPanel: vi.fn()
}));
vi.mock('@js/analysis_tools/visibility_tool/add_visibility_geometry.js', () => ({
    default: class {
        delay() { return Promise.resolve(); }
        isTerrainAvailable() { return true; }
        normalizeCenter(center) { return center; }
    }
}));
vi.mock('@tools', () => ({
    BaseControl: class {
        constructor(toolManager) {
            this.toolManager = toolManager;
            this.selectionManager = toolManager?.selectionManager;
        }
        getSelectedFeature() { return null; }
    }
}));

const { default: AddVisibilityControl } = await import('@js/analysis_tools/visibility_tool/add_visibility_control.js');

/** @returns {Object} Fake DOM node exposing only what the progress modal touches. */
function fakeNode() {
    return { style: {}, textContent: '', classList: { add: vi.fn(), remove: vi.fn() } };
}

/**
 * @returns {Object} A control with the progress-modal DOM replaced by fakes.
 */
function makeControl() {
    const control = new AddVisibilityControl({ selectionManager: {} });
    control.progressModal = fakeNode();
    control.progressBar = fakeNode();
    control.progressText = fakeNode();
    control.progressPercentage = fakeNode();
    return control;
}

const FEATURE = { type: 'Feature', properties: { id: 'vis-1', source: 'visibility' } };

/** Lets every already-scheduled microtask run. */
async function flushMicrotasks() {
    for (let i = 0; i < 10; i += 1) {
        await Promise.resolve();
    }
}

describe('updateFeaturesProperty — recalculation queue', () => {
    let control;

    beforeEach(() => {
        vi.useFakeTimers();
        control = makeControl();
        control.updatePropertyImmediately = vi.fn();
        control.updateSectorOutlineFromProperty = vi.fn();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('waits for an in-flight recalculation before starting the debounced one', async () => {
        let releaseDrag;
        control.recalculateQueue = control.recalculateQueue.then(
            () => new Promise(resolve => { releaseDrag = resolve; })
        );
        control.recalculateAfterParameterChange = vi.fn(async () => {});

        control.updateFeaturesProperty([FEATURE], 'observerHeight', 3);
        vi.advanceTimersByTime(1000);
        await flushMicrotasks();

        // The drag recalculation has not finished: the slider one must not have started.
        expect(control.recalculateAfterParameterChange).not.toHaveBeenCalled();

        releaseDrag();
        await control.recalculateQueue;

        expect(control.recalculateAfterParameterChange).toHaveBeenCalledTimes(1);
        expect(control.recalculateAfterParameterChange).toHaveBeenCalledWith([FEATURE]);
    });

    it('debounces: only the last change of a burst recalculates', async () => {
        control.recalculateAfterParameterChange = vi.fn(async () => {});

        control.updateFeaturesProperty([FEATURE], 'observerHeight', 3);
        vi.advanceTimersByTime(400);
        control.updateFeaturesProperty([FEATURE], 'observerHeight', 5);
        vi.advanceTimersByTime(1000);
        await control.recalculateQueue;

        expect(control.recalculateAfterParameterChange).toHaveBeenCalledTimes(1);
    });

    // Edge case: a rejected recalculation must not poison the chain for the rest of
    // the session, otherwise every later drag or slider change is silently dropped.
    it('survives a rejected recalculation', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        control.recalculateAfterParameterChange = vi.fn()
            .mockRejectedValueOnce(new Error('terreno indisponivel'))
            .mockResolvedValueOnce(undefined);

        control.updateFeaturesProperty([FEATURE], 'observerHeight', 3);
        vi.advanceTimersByTime(1000);
        await control.recalculateQueue;

        control.updateFeaturesProperty([FEATURE], 'observerHeight', 4);
        vi.advanceTimersByTime(1000);
        await control.recalculateQueue;

        expect(control.recalculateAfterParameterChange).toHaveBeenCalledTimes(2);
        errorSpy.mockRestore();
    });

    it('does not recalculate for a property outside the recalculation set', async () => {
        control.recalculateAfterParameterChange = vi.fn(async () => {});

        control.updateFeaturesProperty([FEATURE], 'opacity', 0.2);
        vi.advanceTimersByTime(1000);
        await flushMicrotasks();

        expect(control.recalculateAfterParameterChange).not.toHaveBeenCalled();
        expect(control.updatePropertyImmediately).toHaveBeenCalledWith([FEATURE], 'opacity', 0.2);
    });

    it('never clears a debounce timer it does not own', async () => {
        control.map = undefined; // makes the real recalculation bail into its catch
        const NEWER_TIMER = Symbol('newer pending debounce timer');
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        control.parameterDebounceTimer = NEWER_TIMER;
        await control.recalculateAfterParameterChange([FEATURE]);

        expect(control.parameterDebounceTimer).toBe(NEWER_TIMER);
        errorSpy.mockRestore();
    });
});

describe('progress modal ref-counting', () => {
    let control;

    beforeEach(() => {
        control = makeControl();
    });

    it('stays open while a second recalculation is still running', () => {
        control.showProgressModal();
        control.showProgressModal();
        control.hideProgressModal();

        expect(control.progressModal.classList.remove).not.toHaveBeenCalled();

        control.hideProgressModal();

        expect(control.progressModal.classList.remove).toHaveBeenCalledTimes(1);
    });

    it('opens the modal only once for nested recalculations', () => {
        control.showProgressModal();
        control.showProgressModal();

        expect(control.progressModal.classList.add).toHaveBeenCalledTimes(1);
    });

    // Edge case: an unbalanced hide must not drive the counter negative, which would
    // make the NEXT show a no-op and leave the user without any progress feedback.
    it('floors the counter at zero', () => {
        control.hideProgressModal();
        control.hideProgressModal();
        control.showProgressModal();

        expect(control.progressModal.classList.add).toHaveBeenCalledTimes(1);

        control.hideProgressModal();

        expect(control.progressModal.classList.remove).toHaveBeenCalledTimes(3);
    });
});
