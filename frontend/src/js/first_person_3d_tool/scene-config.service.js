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
import { VoxelCollision } from './walk/voxel-collision.js';

// ============================================================
// Folder layout — relative to a scene's basePath
// ============================================================

/** Discriminator value that marks a `tilesets` row as a first-person scene. */
export const FIRST_PERSON_VIEWER = 'firstPerson';

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
 * while testing. Same reasoning as STREETVIEW_360_BASE in config.js.
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
 * Get every usable first-person scene.
 *
 * Partitions `config.tilesets` by the `viewer` discriminator: a row without it
 * is a regular Cesium tileset and belongs to the 3D viewer, not here.
 *
 * Entries missing `id` or `basePath` are dropped: they cannot be addressed nor
 * resolved, and letting them through would only fail later, inside the viewer.
 *
 * @returns {Array<Object>} Scene entries, or [] when none is configured
 */
export function getFirstPersonScenes() {
    const tilesets = config.tilesets;
    if (!Array.isArray(tilesets)) return [];
    return tilesets.filter(entry => entry?.viewer === FIRST_PERSON_VIEWER && isUsableScene(entry));
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
        // O ESCOPO DE ATLAS ENTRA AQUI, e não em cada consumidor, porque quatro destes sete
        // endereços NÃO são buscados por código nosso: a foto do marcador vira `img.src`, o
        // clipe de preview vira `<video src>` e o splat vai para um loader de terceiro.
        // Nenhum deles tem como carregar cabeçalho, então, para uma cena PRIVADA, o
        // empréstimo do atlas em foco é a única autorização que atravessa. Sem atlas em foco
        // a URL sai idêntica ao que sempre foi.
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
    // Mesmo carimbo de `resolveSceneAssets`, e pela mesma razão: isto termina num `img.src`,
    // que não carrega cabeçalho nenhum.
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
        // A credencial alcança os dois arquivos que ESTE código busca. Ela é o braço que
        // atende quem vê a cena privada por papel global ou concessão pessoal, sem atlas
        // nenhum em foco — o caso que o carimbo de `?atlasId=` sozinho não cobre.
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
