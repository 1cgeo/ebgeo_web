import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { activateScope, localScope } from '../../src/js/store/atlas-namespace.js';

const h = vi.hoisted(() => ({ getBlob: vi.fn() }));
vi.mock('../../src/js/store', () => ({
    getCustomIconBlob: (...args) => h.getBlob(...args),
    getEventBus: () => ({ on() {} })
}));
import { ensureCustomIconImage, registerCustomFeatureImage } from '../../src/js/draw_tools/point_tool/point-custom-icons.js';

let images;
beforeEach(() => {
    images = [];
    activateScope(localScope('icons-a', 'icons-a'));
    h.getBlob.mockReset().mockResolvedValue(new Blob(['png']));
    vi.stubGlobal('Image', class { constructor() { images.push(this); } });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:icon');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('a late decode cannot refill the new atlas cache with the old icon', async () => {
    const old = ensureCustomIconImage('same-id');
    await vi.waitFor(() => expect(images).toHaveLength(1));
    activateScope(localScope('icons-b', 'icons-b'));
    const recent = ensureCustomIconImage('same-id');
    await vi.waitFor(() => expect(images).toHaveLength(2));
    images[1].onload();
    expect(await recent).toBe(images[1]);
    images[0].onload();
    expect(await old).toBeNull();
    expect(await ensureCustomIconImage('same-id')).toBe(images[1]);
    expect(h.getBlob).toHaveBeenCalledTimes(2);
});

it('the latest chosen icon wins when an earlier decode arrives last', async () => {
    const map = { hasImage: () => false, addImage: vi.fn(), removeImage: vi.fn() };
    const old = registerCustomFeatureImage(map, 'point', 'icon-a');
    await vi.waitFor(() => expect(images).toHaveLength(1));
    const recent = registerCustomFeatureImage(map, 'point', 'icon-b');
    await vi.waitFor(() => expect(images).toHaveLength(2));
    images[1].onload();
    expect(await recent).toBe(true);
    images[0].onload();
    expect(await old).toBe(false);
    expect(map.addImage).toHaveBeenCalledExactlyOnceWith('point', images[1], { pixelRatio: 2 });
});
