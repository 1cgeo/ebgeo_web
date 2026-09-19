// Path: js/store/settings.operations.js

/**
 * @fileoverview Settings, notes, grid, hillshade, and image operations.
 */

import { CATALOG_ITEM_TYPES } from '../catalog/catalog.constants.js';
import { catalogLayerReferenceId } from '../catalog/catalog-layer.ref.js';
import { getCatalogLayers } from './catalog.operations.js';
import { isCurrentMapLockedSync } from './map.operations.js';
import {
    deleteImageCompat as removeImageData,
    getGridStyleCompat as getGridStyleRepo,
    getImageCompat as getImageData,
    getMapNotesCompat as getMapNotesRepo,
    hasImageCompat as hasImageData,
    saveImageCompat as storeImageData,
    setGridStyleCompat as setGridStyleRepo,
    setMapNotesCompat as setMapNotesRepo
} from './repositories/index.js';
import { mapResolver } from './services/map-resolver.service.js';
import mapManager from './store-state-manager.js';
import { OperationType } from './sync/index.js';
// Leaf module (zero imports): keeps the vocabulary out of the sync barrel's graph.
import { EntityType } from './sync/operation-types.js';
import { runTransaction } from './store-transaction.js';
import { checkPermission, GuardAction } from './sync/permission-guard.js';
import { emitStoreError, StoreErrorEvents } from './store-errors.js';
import { fetchImageBlob } from './sync/image-sync.js';
import { readMapRevision } from './map-revision.js';
import { captureImageContext } from './image-context.js';

// ===== HELPERS =====

/**
 * Checks if a catalog layer is active (visible and available).
 *
 * @param {Object} layer - Catalog layer object
 * @returns {boolean}
 */
function isCatalogLayerActive(layer) {
    return layer?.visible === true && layer?.status !== 'unavailable';
}

/**
 * Resolves the target map name, falling back to the current map.
 *
 * @param {string|null} mapName
 * @returns {string}
 */
function resolveMapName(mapName) {
    return mapName || mapManager.getCurrentMapName();
}

// ===== MAP NOTES =====

/**
 * Gets map notes.
 *
 * @param {string} [mapName=null] - Map name (null = current)
 * @returns {Promise<import('./store.types.js').MapNotes>} Map notes
 */
export async function getMapNotes(mapName = null) {
    return getMapNotesRepo(resolveMapName(mapName));
}

/**
 * Sets map notes.
 *
 * @param {string} mapName - Map name
 * @param {import('./store.types.js').MapNotes} notes - Notes data
 * @returns {Promise<void>}
 */
export async function setMapNotes(mapName, notes) {
    // Same gate, same reason as `setMapTemporalConfig` (the long version of the rationale
    // lives there): the tail of this function enqueues a `mapNotes` op, which the server
    // refuses for a reader, and a refused op stops the whole outbound queue. It is permissive
    // offline and on a local store, so notes keep working for the anonymous user and through
    // a `.ebgeo` import.
    const perm = checkPermission(GuardAction.UPDATE_MAP);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
            operation: 'setMapNotes',
            reason: perm.reason,
            required: perm.required
        });
        return;
    }

    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot set map notes.');
        return;
    }

    const targetMap = resolveMapName(mapName);
    await runTransaction(async tx => {
        const mapId = mapResolver.resolveToId(targetMap) || targetMap;
        const previousNotes = await getMapNotesRepo(targetMap);
        // SEMPRE `update`, pela razão escrita por extenso em `setGridStyle` abaixo: as notas são
        // `maps.notes_title`/`notes_description`, colunas de um mapa que já existe.
        // A REVISÃO DO MAPA viaja no `previousData`, porque as notas são uma UNIDADE do mapa e não
        // uma entidade própria do servidor: sem ela, esta escrita é aplicada por ordem de chegada.
        // Ela custa uma leitura do documento do mapa, num gesto que se faz um por vez.
        const previous = { ...(previousNotes ?? {}), ...(await readMapRevision(targetMap)) };
        tx.recordOperation(EntityType.MAP_NOTES, OperationType.UPDATE, mapId, mapId, notes, previous);
        return () => setMapNotesRepo(targetMap, notes);
    });
}

/**
 * Checks if a map has notes (title or description not empty).
 *
 * @param {string} [mapName=null] - Map name (null = current)
 * @returns {Promise<boolean>} True if map has notes
 */
export async function hasMapNotes(mapName = null) {
    const notes = await getMapNotes(mapName);
    return !!(notes && (notes.title?.trim() || notes.description?.trim()));
}

// ===== GRID STYLE =====

/**
 * Gets grid style.
 *
 * @param {string} mapName - Map name
 * @returns {Promise<import('./store.types.js').GridStyle>} Grid style
 */
export async function getGridStyle(mapName) {
    return getGridStyleRepo(mapName);
}

/**
 * Sets grid style.
 *
 * @param {string} mapName - Map name
 * @param {import('./store.types.js').GridStyle} gridStyle - Grid style
 * @returns {Promise<void>}
 */
export async function setGridStyle(mapName, gridStyle) {
    // Same gate, same reason as `setMapNotes` above: `logGridStyleOperation` at the tail is a
    // map-setting write the server refuses for a reader.
    const perm = checkPermission(GuardAction.UPDATE_MAP);
    if (!perm.allowed) {
        emitStoreError(StoreErrorEvents.STORE_OPERATION_BLOCKED, {
            operation: 'setGridStyle',
            reason: perm.reason,
            required: perm.required
        });
        return;
    }

    if (isCurrentMapLockedSync()) {
        console.warn('Map is locked. Cannot set grid style.');
        return;
    }

    const targetMap = resolveMapName(mapName);
    await runTransaction(async tx => {
        const mapId = mapResolver.resolveToId(targetMap) || targetMap;
        const previousGridStyle = await getGridStyleRepo(targetMap);
        // SEMPRE `update`, e nunca `create`. Uma sub-entidade de mapa não é uma linha própria no
        // servidor: ela é uma COLUNA de um mapa que já existe (aqui, `maps.grid_style`), e quem
        // cria a linha é a op de `map`, a única que carrega o nome. O tipo decidido por "havia
        // valor local antes?" produzia `create` na PRIMEIRA gravação de cada mapa, e custava duas
        // coisas, as duas medidas em 2026-09-16: no servidor, o ramo de criação de mapa inseria a
        // linha inteira com o nome nulo e o Postgres reprovava por NOT NULL antes de olhar o
        // `ON CONFLICT` (o lote voltava com "campo obrigatório ausente", e ligar a grade pela
        // primeira vez nunca chegava lá); e no contrato, `entityMutationContract` só monta o
        // PATCH para `update`, então a op viajava sem a lista de unidades alteradas e a disputa
        // passava a ser julgada sobre o bloco em vez da unidade. A base observada NÃO dependia
        // disto: ela sai do `previous` logo abaixo, que carrega a revisão do mapa nos dois casos.

        // Mesma razão de `setMapNotes` acima: a grade é uma unidade do mapa, e a base observada
        // que o servidor lê é a do MAPA.
        const previous = { ...(previousGridStyle ?? {}), ...(await readMapRevision(targetMap)) };
        tx.recordOperation(EntityType.GRID_STYLE, OperationType.UPDATE, mapId, mapId, gridStyle, previous);
        return () => setGridStyleRepo(targetMap, gridStyle);
    });
}

// ===== HILLSHADE =====

// ===== ANALYSIS LAYERS =====

/**
 * Gets all analysis layers states from catalog layers.
 *
 * @param {string} [mapName=null] - Map name
 * @returns {Promise<Object>} Analysis layers states { layerId: boolean }
 */
export async function getMapAnalysisLayersStates(mapName = null) {
    const catalogLayers = await getCatalogLayers(mapName);
    const states = {};

    catalogLayers?.forEach(layer => {
        if (layer.type === CATALOG_ITEM_TYPES.ANALYSIS_LAYER) {
            // One resolution order for the whole client (prefix, then the two legacy carriers):
            // this call site had its own, inverted, and could key the state map by an id the
            // availability check had already rejected.
            const layerId = catalogLayerReferenceId(layer);
            if (layerId) states[layerId] = isCatalogLayerActive(layer);
        }
    });

    return states;
}

// ===== IMAGE MANAGEMENT =====

/**
 * Stores an image.
 *
 * @param {string} imageId - Image ID
 * @param {Blob} blob - Image blob
 * @returns {Promise<void>}
 */
export async function storeImage(imageId, blob) {
    await storeImageData(imageId, blob);
}

/**
 * Gets an image.
 *
 * @param {string} imageId - Image ID
 * @returns {Promise<Blob|null>} Image blob or null
 */
export async function getImage(imageId) {
    const isCurrent = captureImageContext({ includeMap: false });
    const local = await getImageData(imageId);
    if (!isCurrent()) return null;
    if (local) return local;
    // §17.14: a collaborator may reference a photo uploaded by someone else that is
    // not cached locally (the imageId is the backend image id for online-created
    // features) — fetch it from the backend by id and cache it for next render.
    const remote = await fetchImageBlob(imageId);
    if (!isCurrent()) return null;
    if (remote) {
        await storeImageData(imageId, remote).catch(() => {});
    }
    return isCurrent() ? remote : null;
}

/**
 * Removes an image.
 *
 * @param {string} imageId - Image ID
 * @returns {Promise<void>}
 */
export async function removeImage(imageId) {
    await removeImageData(imageId);
}

/**
 * Checks if an image exists.
 *
 * @param {string} imageId - Image ID
 * @returns {Promise<boolean>} True if image exists
 */
export async function hasImage(imageId) {
    return hasImageData(imageId);
}
