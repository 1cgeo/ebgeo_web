import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ scope: {}, map: 'Original', update: vi.fn(), warn: vi.fn() }));
vi.mock('@store', () => ({ updateCatalogLayer: state.update, getCurrentMapNameSync: () => state.map }));
vi.mock('@store/atlas-namespace.js', () => ({ getActiveScope: () => state.scope }));
vi.mock('@utils/toast_service.js', () => ({ showWarning: state.warn }));
import { LayerStylePanel } from '../../src/js/features_tab/layer-style-panel.component.js';

beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    state.scope = {};
    state.map = 'Original';
});
afterEach(() => vi.useRealTimers());

/**
 * What the persisted update does to a layer. Since 2026-09-24 the panel hands updateCatalogLayer a
 * FUNCTION of the stored layer (only the touched properties over the current overrides), so these
 * cases apply it to an empty layer instead of comparing an object literal.
 * @param {*} updates - The second argument updateCatalogLayer received.
 */
function applied(updates) {
    return typeof updates === 'function' ? updates({ styleOverrides: {} }) : updates;
}

it('does not close or report success after storage failure; Concluir retries the retained edit', async () => {
    state.update.mockRejectedValue(new Error('QuotaExceededError'));
    const onClose = vi.fn();
    const panel = new LayerStylePanel({ layer: { id: 'layer' }, onClose });
    const destroy = vi.spyOn(panel, '_destroy').mockImplementation(() => {});
    panel._setOverride('fill', 'color', '#ff0000');
    const failed = panel._close();
    await vi.advanceTimersByTimeAsync(7400);
    await failed;
    expect(destroy).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(panel._closing).toBe(false);
    state.update.mockResolvedValue(undefined);
    await panel._close();
    expect(state.update).toHaveBeenLastCalledWith('layer', expect.any(Function), 'Original');
    expect(applied(state.update.mock.lastCall[1])).toEqual({ styleOverrides: { fill: { color: '#ff0000' } } });
    expect(destroy).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    state.update.mockReset();
});

it('style autosave remains attached to the original map after a map switch', async () => {
    const panel = new LayerStylePanel({ layer: { id: 'shared-layer' } });
    panel._setOverride('fill', 'color', '#ff0000');
    state.map = 'Other';
    await vi.advanceTimersByTimeAsync(300);
    expect(state.update).toHaveBeenCalledWith('shared-layer', expect.any(Function), 'Original');
    expect(applied(state.update.mock.lastCall[1])).toEqual({ styleOverrides: { fill: { color: '#ff0000' } } });
});

it('a pending style cannot overwrite an identically named layer in another atlas', async () => {
    const panel = new LayerStylePanel({ layer: { id: 'shared-layer' } });
    panel._schedulePersist();
    state.scope = {};
    await vi.advanceTimersByTimeAsync(300);
    expect(state.update).not.toHaveBeenCalled();
    expect(state.warn).toHaveBeenCalledOnce();
});

it('exhausted storage retries tell the user that the style was not saved', async () => {
    state.update.mockRejectedValue(new Error('QuotaExceededError'));
    const panel = new LayerStylePanel({ layer: { id: 'shared-layer' } });
    panel._schedulePersist();
    await vi.advanceTimersByTimeAsync(7400);
    expect(state.warn).toHaveBeenCalledWith(expect.stringContaining('não foi gravada'));
    state.update.mockReset();
});
