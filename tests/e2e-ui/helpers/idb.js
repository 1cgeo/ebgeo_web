// Path: e2e-ui/helpers/idb.js

/**
 * Ground-truth IndexedDB reads for the full-chain specs.
 *
 * The existing `readFeatures` (collab-helpers) reads `getCurrentMapFeatures()` — the
 * in-memory `memoryStore` runtime state, NOT the durable store. These helpers instead
 * go through the REPOSITORY (`getRepository().getMap/...`), which reads LocalForage =
 * IndexedDB, bypassing the in-memory cache. That is the actual "did it land in the
 * client's IndexedDB" check the full-chain wants (links 1 and 5 of the chain).
 *
 * All reads happen inside the page via the app's own repository module, so they see
 * exactly what the sync layer persisted (the remote handler writes through the same
 * `getRepository()`).
 */

/**
 * Reads one entity straight from the page's IndexedDB (via the repository).
 * @param {import('@playwright/test').Page} page
 * @param {Object} ref
 * @param {string} ref.entityId
 * @param {string} [ref.entityType='feature'] - 'feature'|'layer'|'group'|'map'|'comment'.
 * @param {string} [ref.mapId] - Map UUID context (required for feature/layer/group/comment).
 * @param {string} [ref.storage] - Feature storage bucket ('lines'…); searched across all if omitted.
 * @returns {Promise<{found: boolean, bucket?: string, props?: Object, [k:string]: any}>}
 */
export function readIdbEntity(page, { entityId, entityType = 'feature', mapId, storage } = {}) {
    return page.evaluate(async (q) => {
        const { getRepository } = await import('/src/js/store/repositories/index.js');
        const repo = getRepository();
        switch (q.entityType) {
            case 'feature': {
                const mapData = await repo.getMap(q.mapId);
                if (!mapData || !mapData.features) return { found: false };
                const buckets = q.storage ? [q.storage] : Object.keys(mapData.features);
                for (const b of buckets) {
                    const arr = mapData.features[b];
                    if (!Array.isArray(arr)) continue;
                    const hit = arr.find((f) => f?.properties?.id === q.entityId);
                    if (hit) return { found: true, bucket: b, props: hit.properties, geometry: hit.geometry };
                }
                return { found: false };
            }
            case 'layer': {
                const layers = (await repo.getLayers?.(q.mapId)) || [];
                const hit = layers.find((l) => l?.id === q.entityId);
                return { found: !!hit, layer: hit || null };
            }
            case 'group': {
                const groups = (await repo.getGroups?.(q.mapId)) || {};
                return { found: !!groups[q.entityId], group: groups[q.entityId] || null };
            }
            case 'map': {
                let mapData = await repo.getMap(q.entityId);
                if (!mapData) {
                    // A locally-created map is NAME-keyed on its author (the sync UUID is the op's
                    // entityId, used by the peer); resolve UUID→name and retry so the author-side
                    // IDB ground-truth finds it too.
                    try {
                        const { mapResolver } = await import('/src/js/store/services/map-resolver.service.js');
                        const name = mapResolver.resolveToName?.(q.entityId);
                        if (name && name !== q.entityId) mapData = await repo.getMap(name);
                    } catch {
                        // resolver unavailable — fall through with mapData=null
                    }
                }
                return { found: !!mapData, map: mapData || null };
            }
            case 'comment': {
                const comments = (await repo.getMapComments?.(q.mapId)) || {};
                return { found: !!comments[q.entityId], comment: comments[q.entityId] || null };
            }
            case 'briefing': {
                // Briefings live in their own side-store (localRepository.saveBriefing), atlas-level.
                const { localRepository } = await import('/src/js/store/repositories/local.repository.js');
                const b = await localRepository.getBriefing?.(q.entityId);
                return { found: !!b, briefing: b || null };
            }
            default:
                return { found: false, unsupported: q.entityType };
        }
    }, { entityId, entityType, mapId, storage });
}

/** Boolean convenience: is the entity present in this page's IndexedDB? */
export async function idbHasEntity(page, ref) {
    const r = await readIdbEntity(page, ref);
    return !!r.found;
}
