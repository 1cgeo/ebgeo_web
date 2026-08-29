// Path: js/first_person_3d_tool/scene-config.service.js

/**
 * @module first_person_3d_tool/scene-config.service
 * @description Partitions `config.tilesets` into first-person scenes and turns
 * each one into concrete asset URLs, then fetches the two data files a scene
 * needs (curated markers and the collision octree).
 *
 * THE SOURCE IS THE `tilesets` TABLE OF THE BACKEND, not a section of its own.
 * A scene is one catalog row carrying the discriminator `viewer: 'firstPerson'`
 * inside its `config` JSONB, which `listTilesets()` spreads over `id`/`name`.
 * The reason is not cosmetic: the per-atlas restriction (`available_3d_models`
 * in `store/sync/atlas-settings.service.js`) and the "Modelos 3D" toggle gate
 * (`hasTilesets()`) already read `config.tilesets`. A section of its own would
 * sit OUTSIDE both, silently — the closed-list class the constitution forbids.
 *
 * A scene is declared with a single `basePath` — the folder the processing
 * pipeline produced — and every asset address is derived from it here. This is
 * the ONLY module that knows the folder layout; nobody else should concatenate
 * a scene path by hand.
 */

import config from '@js/config.js';
import { cabecalhosDeAsset, escoparUrlDeAsset } from '@store/sync/assets3d-request.js';
import { VIEWER_LEGADO_INDOOR, ehEntradaIndoor, ehEntradaDoCesium } from '@catalog/forma-3d.js';
import { VoxelCollision } from './walk/voxel-collision.js';

// ============================================================
// Folder layout — relative to a scene's basePath
// ============================================================

/**
 * LEGACY discriminator value that marked a `tilesets` row as a first-person scene.
 *
 * Re-exported, not re-declared: the literal now lives in `@catalog/forma-3d.js` next to the
 * declared axis that supersedes it (`config.forma3d === 'indoor'`), so the compat derivation and
 * this name cannot drift apart. Kept exported because callers and test fixtures still build
 * legacy-shaped rows with it; a row that only carries this field still derives to `indoor`.
 */
export const FIRST_PERSON_VIEWER = VIEWER_LEGADO_INDOOR;

/** Default asset paths inside a scene folder, keyed by the override field name. */
const SCENE_LAYOUT = {
    splatUrl: 'cena.sog',
    voxelMetaUrl: 'voxel/voxel-meta.json',
    voxelBinUrl: 'voxel/voxel.bin',
    markersUrl: 'marcadores.json',
    itemsBaseUrl: 'itens',
    previewVideo: 'preview/preview.webm',
    previewThumbnail: 'preview/thumbnail.jpg'
};

/**
 * Matches an address that already stands on its own: protocol, protocol-relative
 * or site-root.
 *
 * The scheme list is an ALLOWLIST, not the generic `[a-z][a-z0-9+.-]*:` pattern
 * a URL grammar would suggest. A marker's `foto` comes from marcadores.json,
 * which is scene content an operator drops in a folder, and it lands in
 * `img.src`. Accepting any scheme would let `javascript:` or `data:` through
 * from that file. Neither executes in an `<img>` today, so this closes a door
 * rather than a hole — but the door leads to whatever else ends up consuming a
 * resolved scene path later.
 */
const ABSOLUTE_URL_RE = /^(?:https?:|\/\/|\/)/i;

// ============================================================
// Path helpers
// ============================================================

/**
 * Strip trailing slashes from a scene base, once and in one place.
 *
 * Without this, a basePath written as '/3d/cena/' produces '/3d/cena//voxel/
 * voxel.bin'. Some servers serve that and some answer 404, so the bug only
 * shows up after deploy, and only on whichever asset the operator did not open
 * while testing. Same reasoning as `optionalBase` in the backend's
 * `src/config.js`, which cleans the 360 and assets3d bases at the env-var door.
 * (This line used to cite STREETVIEW_360_BASE in config.js: that constant was
 * the monolith's, and it does not exist here — the server hydrates the base.)
 *
 * @param {string} basePath - Raw basePath from the catalog entry
 * @returns {string} Base without trailing slashes
 */
function normalizeBase(basePath) {
    return String(basePath).replace(/\/+$/, '');
}

/**
 * Join a scene-relative path onto the scene base, respecting absolute values.
 * @param {string} base - Normalized scene base
 * @param {string} relative - Path relative to the scene folder
 * @returns {string} Resolved URL
 */
function joinScenePath(base, relative) {
    const cleaned = String(relative).replace(/^\.\//, '');
    if (ABSOLUTE_URL_RE.test(cleaned)) return cleaned;
    return `${base}/${cleaned.replace(/^\/+/, '')}`;
}

/**
 * Check that a catalog entry can actually be resolved into a scene.
 * `id` addresses the scene (deep link, catalog); `basePath` addresses its files.
 * @param {Object} scene - Raw catalog entry
 * @returns {boolean} True if usable
 */
function isUsableScene(scene) {
    return Boolean(scene && typeof scene.id === 'string' && scene.id
        && typeof scene.basePath === 'string' && scene.basePath.trim());
}

// ============================================================
// Scene lookup
// ============================================================

/**
 * Check if any first-person scene is configured.
 *
 * Derived from `getFirstPersonScenes()` on purpose: a second rule here would be
 * free to disagree with the partition, and it would disagree exactly on the
 * entries the partition discards (no `id`, no `basePath`), which is the case
 * where the UI would appear and then fail.
 *
 * @returns {boolean} True if at least one usable scene exists
 */
export function hasFirstPersonScenes() {
    return getFirstPersonScenes().length > 0;
}

/**
 * Split a catalog list into the two halves that have DIFFERENT VIEWERS, in one pass.
 *
 * WHY THIS IS ONE FUNCTION AND NOT TWO FILTERS. The two halves have to be complementary, and two
 * filters written apart are free to overlap: that is not hypothetical, it is the bug this
 * function was extracted to fix. The 2D marker layer built its model pins from the WHOLE list
 * (filtering only by position) and then ADDED the scenes, so the single indoor scene in
 * production got two pins stacked under `icon-allow-overlap`, and roughly half the clicks landed
 * on the model pin, whose "Visualizar em 3D" hands the id to the Cesium loader. There
 * `visualizadorDaForma` throws on purpose rather than defaulting, so half the clicks were an
 * exception. No guard caught it because a consumer that filters by NOTHING matches no forbidden
 * pattern.
 *
 * BOTH PREDICATES ARE POSITIVE, and the leftovers get a name. `ehEntradaIndoor` and
 * `ehEntradaDoCesium` both resolve the DECLARED shape (`derivarForma3d`, which still reads the
 * legacy `viewer`/`type` fields), and they are total over the four declared shapes today. Writing
 * one half as "everything the other rejected" is what lets a fifth shape be drawn by a viewer
 * that cannot open it, so an entry that satisfies neither is returned in `unrouted` instead of
 * being swept into the Cesium half.
 *
 * An indoor row missing `id` or `basePath` is also `unrouted`: it cannot be addressed nor
 * resolved, and putting it in either drawable half would only fail later, inside a viewer.
 *
 * @param {Array<Object>|*} entries - A catalog list shaped like `config.tilesets`
 * @returns {{cesium: Array<Object>, scenes: Array<Object>, unrouted: Array<Object>}}
 *   `cesium`: rows the 3D viewer draws. `scenes`: usable walk-through scenes.
 *   `unrouted`: rows with no viewer at all.
 */
export function partitionTilesetEntries(entries) {
    const cesium = [];
    const scenes = [];
    const unrouted = [];

    for (const entry of Array.isArray(entries) ? entries : []) {
        if (ehEntradaIndoor(entry)) {
            (isUsableScene(entry) ? scenes : unrouted).push(entry);
        } else if (ehEntradaDoCesium(entry)) {
            cesium.push(entry);
        } else {
            unrouted.push(entry);
        }
    }

    return { cesium, scenes, unrouted };
}

/**
 * Get every usable first-person scene.
 *
 * Derived from `partitionTilesetEntries` for the same reason `hasFirstPersonScenes` is derived
 * from this function: a second rule here would be free to disagree with the partition, and the
 * disagreement would be invisible, because both answers are well-formed lists.
 *
 * @returns {Array<Object>} Scene entries, or [] when none is configured
 */
export function getFirstPersonScenes() {
    return partitionTilesetEntries(config.tilesets).scenes;
}

/**
 * Find a scene by its configured id.
 * @param {string} id - Scene id
 * @returns {Object|null} Scene entry or null
 */
export function getFirstPersonSceneById(id) {
    if (!id) return null;
    return getFirstPersonScenes().find(scene => scene.id === id) ?? null;
}

// ============================================================
// Asset resolution
// ============================================================

/**
 * Derive every asset URL of a scene from its basePath.
 * Any single URL may be overridden by an explicit key on the scene entry
 * (splatUrl, voxelMetaUrl, voxelBinUrl, markersUrl, itemsBaseUrl, previewVideo,
 * previewThumbnail) for assets that really live outside the folder.
 *
 * @param {Object} scene - Scene entry from the catalog
 * @returns {{splatUrl: string, voxelMetaUrl: string, voxelBinUrl: string,
 *   markersUrl: string, itemsBaseUrl: string, previewVideo: string,
 *   previewThumbnail: string}} Resolved asset URLs
 */
export function resolveSceneAssets(scene) {
    if (!isUsableScene(scene)) {
        throw new Error('resolveSceneAssets: scene needs an id and a basePath');
    }
    const base = normalizeBase(scene.basePath);
    const assets = {};
    for (const [field, relative] of Object.entries(SCENE_LAYOUT)) {
        const override = scene[field];
        const bruto = override
            ? joinScenePath(base, override)
            : `${base}/${relative}`;
        // THE ATLAS SCOPE IS STAMPED HERE, not in each consumer, because some of these seven
        // addresses are NOT fetched by our code: the marker photo and the item photos become
        // an `img.src` and the preview clip becomes a `<video src>`. None of those can carry
        // a header — there is no API to give them one — so for a PRIVATE scene the loan of
        // the atlas in focus is the only authorisation that gets through. With no atlas in
        // focus the URL comes out exactly as it always did.
        //
        // THE SPLAT IS NOT ONE OF THEM, and this comment said it was until 2026-08-29. The
        // engine's loader never touches the network: `loadSplat` (`first_person_viewer.js`)
        // fetches `cena.sog` itself and hands the parser an `ArrayBuffer`. Being on the wrong
        // side of this list is what kept its missing credential invisible — 20 MB of a private
        // scene asked for anonymously, answered 404, and read on screen as a broken viewer.
        // It now stamps `cabecalhosDeAsset()` like the three fetches below.
        assets[field] = escoparUrlDeAsset(bruto);
    }
    return assets;
}

/**
 * Resolve a marker photo path into a URL.
 *
 * The marker's `foto` field is relative to the SCENE FOLDER, not to the site
 * root, so the whole folder can be moved without rewriting marcadores.json. A
 * value that already stands on its own (http(s), protocol-relative, or starting
 * at the site root) is honoured exactly as written.
 *
 * @param {Object} scene - Scene entry from the catalog
 * @param {string} [foto] - Marker `foto` field
 * @returns {string|null} Photo URL, or null when the marker has no photo
 */
export function resolveMarkerPhotoUrl(scene, foto) {
    if (!foto || typeof foto !== 'string' || !foto.trim()) return null;
    if (!isUsableScene(scene)) return null;
    // Same stamp as `resolveSceneAssets`, for the same reason: this ends up in an `img.src`,
    // which carries no header at all.
    return escoparUrlDeAsset(joinScenePath(normalizeBase(scene.basePath), foto.trim()));
}

// ============================================================
// Scene data loading
// ============================================================

/**
 * Load the curated markers of a scene.
 * A failure never throws: a scene with no markers is still walkable, so the
 * viewer opens either way and only the labels are missing.
 *
 * @param {Object} scene - Scene entry from the catalog
 * @returns {Promise<Array<Object>>} Markers, or [] on any failure
 */
export async function loadSceneMarkers(scene) {
    if (!isUsableScene(scene)) return [];
    const { markersUrl } = resolveSceneAssets(scene);
    try {
        const response = await fetch(markersUrl, { headers: await cabecalhosDeAsset() });
        if (!response.ok) {
            console.warn(`[first-person] no markers: HTTP ${response.status} at ${markersUrl}`);
            return [];
        }
        const markers = await response.json();
        if (!Array.isArray(markers)) {
            console.warn('[first-person] marcadores.json is not an array');
            return [];
        }
        return markers;
    } catch (error) {
        console.warn('[first-person] no markers:', error);
        return [];
    }
}

/**
 * Load the collision octree of a scene (voxel-meta.json + voxel.bin).
 *
 * The .bin is one flat Uint32Array holding two consecutive blocks whose lengths
 * only the meta knows: `nodeCount` words of tree nodes followed by
 * `leafDataCount` words of leaf payload.
 *
 * THE SIZE CHECK IS THE POINT. It turns a truncated or mismatched pair of files
 * into one readable error instead of a silent out-of-bounds read: a short
 * `nodes` slice makes the octree answer "empty" for whole branches, and the
 * visitor walks straight through walls with a clean console.
 *
 * @param {Object} scene - Scene entry from the catalog
 * @returns {Promise<{metadata: Object, nodes: Uint32Array, leafData: Uint32Array,
 *   voxels: VoxelCollision}|null>} Collision data, or null when unavailable
 */
export async function loadSceneCollision(scene) {
    if (!isUsableScene(scene)) return null;
    const { voxelMetaUrl, voxelBinUrl } = resolveSceneAssets(scene);

    try {
        // The credential reaches the two files THIS code fetches. It is the arm that serves
        // whoever sees the private scene through a global role or a personal grant, with no
        // atlas in focus — the case the `?atlasId=` stamp alone does not cover.
        const headers = await cabecalhosDeAsset();
        const [metaResponse, binResponse] = await Promise.all([
            fetch(voxelMetaUrl, { headers }),
            fetch(voxelBinUrl, { headers })
        ]);
        if (!metaResponse.ok || !binResponse.ok) {
            console.error('[first-person] voxel unavailable',
                metaResponse.status, binResponse.status);
            return null;
        }

        const metadata = await metaResponse.json();
        const nodeCount = metadata?.nodeCount >>> 0;
        const leafDataCount = metadata?.leafDataCount >>> 0;

        // Read straight off the ArrayBuffer: a Uint32Array view demands a
        // 4-byte aligned offset, and offset zero is the only one guaranteed.
        const buffer = await binResponse.arrayBuffer();
        const words = new Uint32Array(buffer, 0, Math.floor(buffer.byteLength / 4));

        if (nodeCount + leafDataCount > words.length) {
            console.error('[first-person] voxel.bin size does not match voxel-meta.json');
            return null;
        }

        const nodes = words.slice(0, nodeCount);
        const leafData = words.slice(nodeCount, nodeCount + leafDataCount);
        return { metadata, nodes, leafData, voxels: new VoxelCollision(metadata, nodes, leafData) };
    } catch (error) {
        console.error('[first-person] failed to load the voxel octree:', error);
        return null;
    }
}
