// Path: js/store/image-context.js
import { getActiveScope } from './atlas-namespace.js';
import { readGeneration } from './namespace-generation.js';
import { memoryStore } from './memory-store.js';

// A mount, its snapshot and its selected map must all survive an asynchronous decode.
// Comparing suffixes alone misses leaving and reopening the same atlas.
export function captureImageContext({ includeMap = true } = {}) {
    const scope = getActiveScope();
    const generation = scope ? readGeneration(scope).active : null;
    const mapName = memoryStore.currentMap;
    return () => getActiveScope() === scope
        && (!scope || readGeneration(scope).active === generation)
        && (!includeMap || memoryStore.currentMap === mapName);
}

const tasks = new WeakMap();

/** The last requested bitmap wins even when its predecessor finishes later. */
export function beginImageTask(map, imageId) {
    let pending = tasks.get(map);
    if (!pending) tasks.set(map, pending = new Map());
    const token = {};
    pending.set(imageId, token);
    const currentContext = captureImageContext();
    const isCurrent = () => currentContext() && pending.get(imageId) === token;
    return {
        isCurrent,
        assertCurrent() {
            if (!isCurrent()) throw new DOMException('Carregamento de imagem substituído.', 'AbortError');
        }
    };
}
