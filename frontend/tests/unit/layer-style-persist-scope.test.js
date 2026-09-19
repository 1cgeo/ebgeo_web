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

it('does not close or report success after storage failure; Concluir retries the retained edit', async () => {
    state.update.mockRejectedValue(new Error('QuotaExceededError'));
    const onClose = vi.fn();
    const panel = new LayerStylePanel({ layer: { id: 'layer' }, onClose });
    const destroy = vi.spyOn(panel, '_destroy').mockImplementation(() => {});
    panel._overrides = { fill: { color: '#ff0000' } };
    panel._schedulePersist();
    const failed = panel._close();
    await vi.advanceTimersByTimeAsync(7400);
    await failed;
    expect(destroy).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(panel._closing).toBe(false);
    state.update.mockResolvedValue(undefined);
    await panel._close();
    expect(state.update).toHaveBeenLastCalledWith('layer', { styleOverrides: { fill: { color: '#ff0000' } } }, 'Original');
    expect(destroy).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    state.update.mockReset();
});

it('style autosave remains attached to the original map after a map switch', async () => {
    const panel = new LayerStylePanel({ layer: { id: 'shared-layer' } });
    panel._overrides = { fill: { color: '#ff0000' } };
    panel._schedulePersist();
    state.map = 'Other';
    await vi.advanceTimersByTimeAsync(300);
    expect(state.update).toHaveBeenCalledWith('shared-layer', {
        styleOverrides: { fill: { color: '#ff0000' } }
    }, 'Original');
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
