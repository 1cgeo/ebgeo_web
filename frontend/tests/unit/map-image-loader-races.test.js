import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { loadImageToMap } from '../../src/js/utilities/map-image-loader.js';
import { memoryStore } from '../../src/js/store/memory-store.js';
import { beginImageTask } from '../../src/js/store/image-context.js';
import { activateScope, localScope } from '../../src/js/store/atlas-namespace.js';

let images;
let map;
beforeEach(() => {
    vi.useFakeTimers();
    images = [];
    vi.stubGlobal('Image', class { constructor() { images.push(this); } });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    let registered = true;
    map = { hasImage: () => registered, removeImage: vi.fn(() => { registered = false; }), addImage: vi.fn(() => { registered = true; }) };
    activateScope(localScope('a', 'image-loader-a'));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('a decode completing after timeout cannot replace a newer bitmap', async () => {
    const pending = loadImageToMap(map, 'id', new Blob(['old']), { timeout: 10, replaceExisting: true });
    const failed = expect(pending).rejects.toThrow('Timeout');
    await vi.advanceTimersByTimeAsync(10);
    await failed;
    images[0].onload();
    expect(map.removeImage).not.toHaveBeenCalled();
    expect(map.addImage).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
});

it('latest requested decode wins even if the old decode finishes last', async () => {
    const old = loadImageToMap(map, 'id', new Blob(['old']), { replaceExisting: true });
    const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' });
    const recent = loadImageToMap(map, 'id', new Blob(['new']), { replaceExisting: true });
    images[1].onload();
    await recent;
    images[0].onload();
    await rejected;
    expect(map.addImage).toHaveBeenCalledExactlyOnceWith('id', images[1], { pixelRatio: 1 });
});

it('a decode from the previous atlas cannot install its image', async () => {
    const pending = loadImageToMap(map, 'same-id', new Blob(['old']), { replaceExisting: true });
    activateScope(localScope('b', 'image-loader-b'));
    images[0].onload();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(map.addImage).not.toHaveBeenCalled();
});


it('rejects a bitmap decode after replacing the snapshot inside the same atlas', async () => {
    let generation = null;
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ active: generation, known: [], cursor: 0 }) });
    const pending = loadImageToMap(map, 'id', new Blob(['old']));
    generation = 'new-snapshot';
    images[0].onload();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(map.addImage).not.toHaveBeenCalled();
});

it('generated bitmap tasks invalidate the old request and detect a selected-map switch', () => {
    const old = beginImageTask(map, 'id');
    const recent = beginImageTask(map, 'id');
    expect(() => old.assertCurrent()).toThrow();
    expect(recent.isCurrent()).toBe(true);
    const previous = memoryStore.currentMap;
    memoryStore.currentMap = 'Different map';
    expect(() => recent.assertCurrent()).toThrow();
    memoryStore.currentMap = previous;
});
