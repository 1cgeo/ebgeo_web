import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@store', () => ({ registerControl: vi.fn(), getStateManager: vi.fn() }));
vi.mock('../../src/js/draw_tools/rectangle_tool/add_rectangle_control.js', () => ({ default: class a {} }));
import { FERRAMENTAS, seedControl, initToolRegistry, resetToolRegistry, ensureControl } from '@tools/tool-registry.js';
import ToolManager from '@tools/tool_manager.js';

afterEach(() => resetToolRegistry());

it('all eager controls retain their UI identity when class names are minified', () => {
    for (const [key, descriptor] of Object.entries(FERRAMENTAS)) {
        const control = new (class a {})();
        seedControl(key, control);
        expect(ToolManager.prototype._inferToolType.call({}, control)).toBe(descriptor.tipoDeUi);
    }
});

it('a dynamically loaded minified control also receives its stable UI type', async () => {
    initToolRegistry({ map: { on: vi.fn() }, toolManager: {}, selectionManager: {
        registerControlFactory: vi.fn(), registerControl: vi.fn() } });
    const control = await ensureControl('rectangleControl', { comTurf: false });
    expect(control.constructor.name).toBe('a');
    expect(ToolManager.prototype._inferToolType.call({}, control)).toBe('rectangle');
});
