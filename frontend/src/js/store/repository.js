// Path: js/store/repository.js

/**
 * @fileoverview Repository facade - backward compatibility layer.
 *
 * This file exists for backward compatibility during the migration to the
 * new repository pattern. New code should import directly from:
 * - ./repository.utils.js - for utility functions (cleanFeature, compareVersions, etc.)
 * - ./memory-store.js - for runtime memory state
 * - ./repositories/index.js - for data access operations
 *
 * The following functions are still implemented here because they need whole-store
 * access for initialization and bulk operations:
 * - initializeRepository() - initializes the data layer and runs migrations
 * - clearAllAtlasStores() - the single bulk clear of every per-atlas database
 *
 * Which DATABASE those stores are is decided by the namespace factory
 * (`atlas-namespace.js`) at CALL time, never at module load; the accessors below and the
 * ones in `repositories/local.repository.js` share one resolver on purpose.
 */

import { StoreName, listAtlasStores } from './atlas-namespace.js';
import { ensureAtlasScope, getScopedStore } from './repositories/local.repository.js';
import {
    detectMigrationNeeded,
    migrateActiveSlot,
    safelyMigrate
} from './migration/migration.service.js';
import { ATLAS_SCHEMA_VERSION } from './atlas/atlas.entity.js';
import config from '../config.js';
import { createSyncMetadata } from './sync/sync-metadata.js';
import { DEFAULT_MAP_NAME } from './store.constants.js';

// Re-export from repository.utils.js for backward compatibility
export {
    SCHEMA_VERSION,
    MIN_SCHEMA_VERSION,
    MAX_SCHEMA_VERSION,
    cleanFeature,
    isInternalProperty,
    compareVersions,
    getEmptyMapData,
    getDefaultLayer,
    getEmptyCesium3dData,
    getEmptyStreetview360Data
} from './repository.utils.js';

// Re-export from memory-store.js for backward compatibility
export { memoryStore, resetMemoryStore } from './memory-store.js';

// Import for internal use
import {
    SCHEMA_VERSION,
    MIN_SCHEMA_VERSION,
    compareVersions,
    getEmptyMapData,
    getEmptyCesium3dData
} from './repository.utils.js';
import { memoryStore } from './memory-store.js';

// ===== STORE ACCESSORS =====
// Resolved through the namespace factory on every call, never captured at module load:
// a handle taken here at import time is bound to whichever atlas was active when this
// module was first evaluated, and would keep writing there after a switch, silently.
// `getScopedStore` (repositories/local.repository.js) is shared with the repository
// implementation so both halves of this front resolve through ONE code path.

const mapStore = () => getScopedStore(StoreName.MAPS);
const imageStore = () => getScopedStore(StoreName.IMAGES);
const appStore = () => getScopedStore(StoreName.SETTINGS);
const groupStore = () => getScopedStore(StoreName.GROUPS);
const layerStore = () => getScopedStore(StoreName.LAYERS);
const cesium3dStore = () => getScopedStore(StoreName.CESIUM3D);

// ===== HELPER FUNCTIONS FOR INITIALIZATION =====

/**
 * Clears all legacy stores and resets schema version.
 */
async function clearLegacyStores() {
    // EM PARALELO, pela mesma razao de `clearAllAtlasStores` logo abaixo: sao cinco bancos
    // IndexedDB distintos, sem dependencia nenhuma entre si, e o laco com `await` dentro
    // pagava cinco idas ao disco EM FILA por uma ordem que ninguem pediu. No boot de uma
    // instalacao NOVA (o caso medido: `schemaVersion` nulo) esta funcao e o trecho mais caro
    // de `initializeRepository`, porque cada `clear()` tambem CRIA o banco: tres deles
    // (imagens, grupos, camadas) o boot nao toca por mais nada. Medido em A/B pareado, com o
    // banco vazio: 8,0 ms em serie contra 3,5 ms em paralelo (mediana de 5 boots de cada,
    // alternados na mesma sessao).
    //
    // `allSettled` E NAO `all`: com `all` a primeira rejeicao devolve o controle e as outras
    // quatro limpezas seguem sem observador, o que transforma um erro em rejeicoes nao
    // tratadas e num apagamento parcial silencioso. Com `allSettled` todas sao aguardadas e
    // so entao a primeira falha e relancada, para que `checkAndCleanLegacyData` continue
    // vendo como falha o que falhou.
    const resultados = await Promise.allSettled([
        mapStore().clear(),
        imageStore().clear(),
        appStore().clear(),
        groupStore().clear(),
        layerStore().clear()
    ]);
    const falha = resultados.find((resultado) => resultado.status === 'rejected');
    if (falha) throw falha.reason;

    // After clearing, the store is EMPTY — a brand-new repository. It will be rebuilt at the current
    // schema (getEmptyMapData produces v2.2), so stamp it at the CURRENT version, NOT the legacy 1.7.
    // This is the fresh-install (null version) and too-old-to-migrate (data discarded) path; either
    // way there is nothing to migrate, so the Atlas migration chain must be skipped. Pre-existing
    // repos at a still-supported older version are NOT cleared here and DO migrate (runLegacyMigrations
    // + detectMigrationNeeded), honoring "migrate old repos per their version; create new ones current".
    await appStore().setItem('schemaVersion', ATLAS_SCHEMA_VERSION);
}

/**
 * Checks and cleans incompatible legacy data.
 */
async function checkAndCleanLegacyData() {
    try {
        const currentSchemaVersion = await appStore().getItem('schemaVersion');

        if (!currentSchemaVersion || compareVersions(currentSchemaVersion, MIN_SCHEMA_VERSION) < 0) {
            await clearLegacyStores();
        }
    } catch (error) {
        console.warn('Error checking schema version:', error);
        try {
            await clearLegacyStores();
        } catch (cleanupError) {
            console.error('Critical error cleaning data:', cleanupError);
        }
    }
}

// ===== LEGACY MIGRATION FUNCTIONS =====

/**
 * Runs a per-map migration function on all maps and logs progress.
 * @param {Function} migrateFn - async (mapName, mapData?) => boolean
 * @param {string} label - Log label for the migration version
 * @param {boolean} [needsData=true] - Whether the migration needs map data loaded
 */
async function runMigrationForAllMaps(migrateFn, label, needsData = true) {
    const mapNames = await mapStore().keys();
    let migratedCount = 0;

    for (const mapName of mapNames) {
        if (needsData) {
            const mapData = await mapStore().getItem(mapName);
            if (mapData) {
                const wasMigrated = await migrateFn(mapName, mapData);
                if (wasMigrated) migratedCount++;
            }
        } else {
            const wasMigrated = await migrateFn(mapName);
            if (wasMigrated) migratedCount++;
        }
    }

    if (migratedCount > 0) {
        console.log(`Migrated ${migratedCount} map(s) to ${label}`);
    }
}

async function migrateMapTo14(mapName, mapData) {
    if (!mapData.features.coordination_measures) {
        mapData.features.coordination_measures = [];
        await mapStore().setItem(mapName, mapData);
        return true;
    }
    return false;
}

async function migrateMapTo15(mapName, mapData) {
    let modified = false;

    for (const featureType of Object.keys(mapData.features)) {
        const features = mapData.features[featureType];
        if (!Array.isArray(features)) continue;

        for (const feature of features) {
            if (feature.properties && !feature.properties.layerId) {
                feature.properties.layerId = 'default';
                modified = true;
            }
        }
    }

    if (modified) {
        await mapStore().setItem(mapName, mapData);
    }
    return modified;
}

async function migrateMapTo16(mapName, mapData) {
    if (!mapData?.features) {
        return false;
    }

    let modified = false;

    for (const featureType of Object.keys(mapData.features)) {
        const features = mapData.features[featureType];
        if (!Array.isArray(features)) continue;

        for (const feature of features) {
            if (feature.properties) {
                if (feature.properties.attributes === undefined) {
                    feature.properties.attributes = {};
                    modified = true;
                }
                if (feature.properties.images === undefined) {
                    feature.properties.images = [];
                    modified = true;
                }
            }
        }
    }

    if (modified) {
        await mapStore().setItem(mapName, mapData);
    }
    return modified;
}

async function migrateMapTo17(mapName) {
    const key = `cesium3d_${mapName}`;
    const existingData = await cesium3dStore().getItem(key);
    if (!existingData || existingData.cameraPositions === undefined || existingData.markers === undefined) {
        await cesium3dStore().setItem(key, getEmptyCesium3dData());
        return true;
    }
    return false;
}

/**
 * Ordered legacy migrations with their per-map functions and log labels.
 * Each entry: [migrateFn, label, needsData]
 */
const LEGACY_MIGRATIONS = [
    { version: '1.3', fn: migrateMapTo14, label: 'v1.4' },
    { version: '1.4', fn: migrateMapTo15, label: 'v1.5 (added layerId to features)' },
    { version: '1.5', fn: migrateMapTo16, label: 'v1.6 (added attributes and images to features)' },
    { version: '1.6', fn: migrateMapTo17, label: 'v1.7 (initialized cesium3d data)', needsData: false }
];

/**
 * Runs all applicable legacy migrations from the given schema version.
 * @param {string|null} currentVersion - Current schema version
 */
async function runLegacyMigrations(currentVersion) {
    if (!currentVersion) {
        await appStore().setItem('schemaVersion', SCHEMA_VERSION);
        return;
    }

    const startIndex = LEGACY_MIGRATIONS.findIndex(m => m.version === currentVersion);
    if (startIndex === -1) return;

    for (let i = startIndex; i < LEGACY_MIGRATIONS.length; i++) {
        const { fn, label, needsData } = LEGACY_MIGRATIONS[i];
        await runMigrationForAllMaps(fn, label, needsData !== false);
    }

    await appStore().setItem('schemaVersion', SCHEMA_VERSION);
}

// ===== INITIALIZATION =====

/**
 * GRAVA o mapa padrão em branco no escopo montado e o deixa corrente.
 *
 * POR QUE É UMA FUNÇÃO E NÃO UM BLOCO. Dois caminhos precisam do mesmo mapa em branco:
 * `initializeRepository`, quando o escopo não tem mapa nenhum, e o wipe de `store.js` que
 * NÃO vai reinicializar o repositório (a saída da conta, onde a linha seguinte destrói o
 * namespace que a inicialização acabaria de preparar). Copiar o bloco resolveria o mesmo
 * dia e divergiria no seguinte: a condicional do hillshade é a metade que envelhece, e duas
 * cópias dela produzem dois mapas em branco diferentes conforme o caminho.
 *
 * A INVARIANTE ESTÁ NO `setItem`, não no retorno: quem chama devolve este nome aos ouvintes
 * de `ALL_DATA_CLEARED`, que leem o registro pelo nome. Devolver `DEFAULT_MAP_NAME` sem
 * gravar faria essa leitura achar um registro ausente, e o mapa em branco viraria mapa
 * nenhum.
 *
 * @returns {Promise<string>} O nome do mapa padrão, já gravado no escopo montado.
 */
export async function seedBlankDefaultMap() {
    const newMapData = getEmptyMapData();

    if (config.map2d?.hillshade?.enabled === true) {
        // Reference + per-atlas state, like every other catalog-layer write. Hillshade
        // refers to no catalog resource (its definition is the static `config.map2d`
        // block), so the reference is the bare id and the type; the name is resolved on
        // read by `catalogLayerDisplayName`.
        newMapData.catalogLayers = [{
            id: 'hillshade',
            type: 'hillshade',
            visible: true,
            opacity: 1,
            status: 'active',
            sync: createSyncMetadata(null)
        }];
    }

    await mapStore().setItem(DEFAULT_MAP_NAME, newMapData);
    memoryStore.currentMap = DEFAULT_MAP_NAME;
    return DEFAULT_MAP_NAME;
}

/**
 * Initializes the repository, runs migrations, and returns the last active map.
 * @returns {Promise<string>} Last active map name
 */
export async function initializeRepository() {
    try {
        await checkAndCleanLegacyData();

        const currentSchemaVersion = await appStore().getItem('schemaVersion');
        await runLegacyMigrations(currentSchemaVersion);

        // ===== TWO MIGRATION TARGETS, AND THEY ARE NOT INTERCHANGEABLE =====
        // First the INSTALLATION upgrade, on the pre-namespace databases: it is what
        // registers local slot #1 and what discards a store whose origin marker says the
        // data belongs to a server atlas. Aiming this pass at the mounted scope instead
        // would point it at an empty namespace on exactly the boot where the residue it
        // has to reach sits in the unsuffixed databases.
        const { needed } = await detectMigrationNeeded();
        if (needed) {
            console.log('Running v2.0 migration...');
            const result = await safelyMigrate();
            if (result.success) {
                console.log('v2.0 migration completed successfully');
            } else {
                console.error('v2.0 migration failed:', result.error);
            }
        }

        // Then the MOUNTED slot, which the pass above cannot speak for: with one namespace
        // per atlas, a slot carrying older data used to be compared against slot #1's stamp
        // and skipped, with no error and no log. `migrateActiveSlot` returns without
        // touching storage when the mounted scope is not a namespaced local slot that needs
        // work; the reasons are enumerated in `migration.service.js`.
        await migrateActiveSlot();

        const allMapNames = await mapStore().keys();
        if (allMapNames.length === 0) {
            return await seedBlankDefaultMap();
        }

        const lastActiveMap = await appStore().getItem('lastActiveMap');
        const activeMap = (lastActiveMap && allMapNames.includes(lastActiveMap))
            ? lastActiveMap
            : allMapNames[0];

        memoryStore.currentMap = activeMap;
        return activeMap;
    } catch (error) {
        console.error('Error initializing repository:', error);
        memoryStore.currentMap = DEFAULT_MAP_NAME;
        return DEFAULT_MAP_NAME;
    }
}

// ===== BULK CLEAR (DERIVED FROM THE STORE LIST, NOT HAND-LISTED) =====

/**
 * EMPTIES every per-atlas database of the atlas currently mounted. One function replaces
 * the two parallel hand-written lists that lived in `store.js` (the wipe on logout and the
 * wipe on "clear everything"), which nothing forced to stay in sync: a side-store added to
 * one list and forgotten in the other left server data behind on exactly one of the paths.
 *
 * The list is now DERIVED, not hand-written: `listAtlasStores()` returns exactly the
 * descriptors marked `perAtlas`, so a database added to the factory is wiped here without
 * anyone remembering this function. The hand-written half that used to sit above (a table
 * of module-level handles keyed by store id, with a throw for the entry someone forgot)
 * disappeared with the lazy accessors: there is nothing left to forget.
 *
 * What it covers, and why it is worth naming: the atlas record (atlas-level settings such
 * as `terrainExaggeration` that a remote atlas writes), the ENTIRE app-settings store
 * (per-map color usage, notes, grid style, temporal config, saved position, base layer,
 * map lock, plus the schema version and the origin marker), and every side-store (groups,
 * layers, 3D, 360, briefings, spatial comments, images).
 *
 * CLEAR IS NOT DELETE. `clear()` empties a database and leaves it standing, which is what
 * unmounting the current atlas means. Destroying a slot's databases is `dropAtlasDatabases`
 * (`atlas-namespace.js`), reached only by deleting a local atlas.
 *
 * @returns {Promise<void>}
 */
export async function clearAllAtlasStores() {
    // `listAtlasStores()` resolves against the ACTIVE scope and throws when there is none,
    // so the scope has to be settled before the set is resolved. O `.map` abaixo é síncrono e
    // roda depois desta linha, então a ordem continua a mesma que o laço tinha.
    ensureAtlasScope();

    // EM PARALELO, e a razão é que não há dependência nenhuma entre os dez: são bancos
    // IndexedDB distintos, e o laço com `await` dentro pagava dez idas ao disco em fila por
    // uma ordem que ninguém pediu. Esta função só espera; o tempo dela é latência, não conta.
    //
    // `allSettled` E NÃO `all`, e a diferença importa aqui: com `all` a primeira rejeição
    // devolve o controle a quem chamou e as outras nove limpezas seguem sem observador, o que
    // transforma um erro em nove rejeições não tratadas e num wipe parcial silencioso. Com
    // `allSettled` toda limpeza é aguardada, e só então a primeira falha é relançada, para que
    // o chamador continue vendo um wipe que falhou como falha.
    const resultados = await Promise.allSettled(
        listAtlasStores().map(({ store }) => store.clear())
    );

    const falha = resultados.find(resultado => resultado.status === 'rejected');
    if (falha) throw falha.reason;
}

// ===== APP SETTINGS (needed by store.js for setSchemaVersion) =====

/**
 * Sets an app setting.
 * @param {string} key - Setting key
 * @param {any} value - Setting value
 */
export async function setAppSetting(key, value) {
    await appStore().setItem(key, value);
}

// ===== COLOR USAGE =====
//
// O `getColorUsage` que morava aqui SAIU em 2026-09-01, e o motivo e que ele lia a chave errada.
// Ele montava `color_usage_${mapName}` com o nome CRU, enquanto o escritor
// (`setColorUsageCompat`, em `repositories/index.js`) monta a chave RESOLVIDA, que num mapa
// keyado por UUID e o UUID. Os dois batem neste mesmo store de settings, entao a divergencia era
// so a string, e medida ela custava a secao inteira: gravado sob `color_usage_<uuid>`, lido sob
// `color_usage_<nome>`, o retorno era `{}` e o `colorUsage` sumia do `.ebgeo` e do envio ao
// servidor de todo mapa de atlas sincronizado ou importado.
//
// Nao foi substituido por nada aqui de proposito. O leitor com resolucao e fallback ja existia
// (`getColorUsageCompat`), `store-state-manager.js` ja o usava, e o barril passou a exporta-lo
// sob o mesmo apelido. Deixar o irmao errado de pe, ainda que sem chamador, so daria a alguem o
// que reimportar. Guarda: `frontend/tests/integration/coloruso-le-a-chave-resolvida.test.js`.

