// Path: tests/unit/briefing-transition-destroy.test.js

/**
 * @fileoverview Pins the destroy() abort guard of the briefing transition service.
 *
 * A 2D->3D transition waits VIEWER_OPEN_DELAY between the flyTo and open3DViewer().
 * Leaving the presentation (Escape -> exit -> destroy) during that window used to
 * leave the timer alive: it fired after the presentation had ended and opened the
 * Cesium viewer over the normal map. destroy() must now abort the in-flight
 * transition instead.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================================
// Mocks (declared before importing the module under test)
// ============================================================================

const { storeMock, flyToMock, modelsViewerMock, streetViewMock } = vi.hoisted(() => {
    const modelsViewer = {
        isActive: true,
        openViewer: vi.fn(async () => {}),
        closeViewer: vi.fn(async () => {}),
        activate: vi.fn(async () => {}),
    };
    const streetView = {
        isActive: true,
        activate: vi.fn(async () => {}),
    };
    const controls = { modelsViewer, streetView };
    return {
        modelsViewerMock: modelsViewer,
        streetViewMock: streetView,
        flyToMock: vi.fn(async () => {}),
        storeMock: {
            SlideMode: { MAP_2D: 'MAP_2D', VIEWER_3D: 'VIEWER_3D', VIEWER_360: 'VIEWER_360' },
            getCurrentMapNameSync: vi.fn(() => 'Principal'),
            setCurrentMap: vi.fn(async () => {}),
            getEventBus: vi.fn(() => ({ emit: vi.fn(), on: vi.fn() })),
            getControl: vi.fn((name) => controls[name] || null),
        },
    };
});

vi.mock('@store/index.js', () => storeMock);
vi.mock('@js/map/animation.service.js', () => ({ flyTo: flyToMock }));

const { createTransitionService } = await import('@js/briefing/presentation/transition.service.js');

/** Minimal MapLibre stub: only what the transition service touches. */
function fakeMap() {
    return { stop: vi.fn(), getZoom: vi.fn(() => 10), jumpTo: vi.fn() };
}

const SLIDE_3D = { mode: 'VIEWER_3D', modelId: 'm1' };

describe('TransitionService — destroy() aborts an in-flight transition', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        modelsViewerMock.isActive = true;
        streetViewMock.isActive = true;
        // _apply3DCameraFromSlide reads window.Cesium; node has no window.
        globalThis.window = {};
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        delete globalThis.window;
    });

    it('does not open the 3D viewer when destroy() lands during the open delay', async () => {
        const svc = createTransitionService(fakeMap());

        const pending = svc.transitionToSlide(SLIDE_3D);
        // Let the handler run up to (and register) the VIEWER_OPEN_DELAY timer.
        await vi.advanceTimersByTimeAsync(0);
        expect(modelsViewerMock.openViewer).not.toHaveBeenCalled();

        svc.destroy();
        await vi.advanceTimersByTimeAsync(2000);
        await pending;

        expect(modelsViewerMock.openViewer).not.toHaveBeenCalled();
    });

    it('still opens the 3D viewer on the normal path (no destroy)', async () => {
        const svc = createTransitionService(fakeMap());

        const pending = svc.transitionToSlide(SLIDE_3D);
        await vi.advanceTimersByTimeAsync(2000);
        await pending;

        expect(modelsViewerMock.openViewer).toHaveBeenCalledTimes(1);
        expect(modelsViewerMock.openViewer).toHaveBeenCalledWith('m1');
    });

    it('refuses a transition requested after destroy()', async () => {
        const svc = createTransitionService(fakeMap());
        svc.destroy();

        const result = await svc.transitionToSlide(SLIDE_3D);
        await vi.advanceTimersByTimeAsync(2000);

        expect(result).toBe(false);
        expect(modelsViewerMock.openViewer).not.toHaveBeenCalled();
    });

    it('does not fly the 2D map when destroy() lands during a 3D->2D transition', async () => {
        const svc = createTransitionService(fakeMap());

        // Reach VIEWER_3D first, so the next transition uses the 3D->2D handler.
        await vi.advanceTimersByTimeAsync(0);
        const toThreeD = svc.transitionToSlide(SLIDE_3D);
        await vi.advanceTimersByTimeAsync(2000);
        await toThreeD;
        flyToMock.mockClear();

        const pending = svc.transitionToSlide({
            mode: 'MAP_2D',
            position: { longitude: -47.9, latitude: -15.8, zoom: 12 },
        });
        await vi.advanceTimersByTimeAsync(0);
        svc.destroy();
        await vi.advanceTimersByTimeAsync(2000);
        await pending;

        expect(modelsViewerMock.closeViewer).toHaveBeenCalledTimes(1);
        expect(flyToMock).not.toHaveBeenCalled();
    });

    it('leaves no pending delay behind: the aborted transition settles', async () => {
        const svc = createTransitionService(fakeMap());

        const pending = svc.transitionToSlide(SLIDE_3D);
        await vi.advanceTimersByTimeAsync(0);
        svc.destroy();

        // No timer advance at all: destroy() must resolve the pending delay itself.
        await expect(pending).resolves.toBe(true);
        expect(modelsViewerMock.openViewer).not.toHaveBeenCalled();
    });
});
