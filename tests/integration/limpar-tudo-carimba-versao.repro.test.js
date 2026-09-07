import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

// Regression test for the "Limpar Todos os Dados" schema-version stamp.
//
// Root cause: clearAllDataStore() (store/store.js) wiped the eight data stores and then
// stamped `schemaVersion` with SCHEMA_VERSION, the LEGACY constant '1.7'
// (store/repository.utils.js:9), instead of ATLAS_SCHEMA_VERSION.
//
// The stamp is inert while the app version does not change: initializeRepository() does NOT
// re-stamp it, because runLegacyMigrations('1.7') finds no '1.7' entry in LEGACY_MIGRATIONS
// (repository.js) and detectMigrationNeeded() answers false through the surviving atlas
// record, which is still on the current version.
//
// It becomes destructive on the NEXT deployment. Once ATLAS_SCHEMA_VERSION moves ahead, the
// surviving atlas record is no longer current, `versionCurrent` is false for '1.7', and the
// whole v1 -> v2.x chain runs over v2.x data: migrateToV2 renumbers every feature id, so the
// image blobs keyed by the OLD ids become unreachable. Measured on the real 2.4 fixture
// (805 features, 149 PNG): 0 of 805 ids survived and the 146 reachable blobs dropped to 0.
//
// Fix: stamp ATLAS_SCHEMA_VERSION. A repository that was just cleared is a new repository,
// and a new repository is born on the current version (the non-additive import already did
// this, import_export/export-import.service.js:566).

// In-memory localforage, one Map per store name (mirrors import-phantom-map.repro.test.js).
const { stores } = vi.hoisted(() => ({ stores: {} }));
vi.mock('localforage', () => ({
    default: {
        createInstance: vi.fn(({ name }) => {
            if (!stores[name]) {
                const map = new Map();
                stores[name] = {
                    setItem: vi.fn(async (k, v) => { map.set(k, v); }),
                    getItem: vi.fn(async (k) => (map.has(k) ? map.get(k) : null)),
                    removeItem: vi.fn(async (k) => { map.delete(k); }),
                    keys: vi.fn(async () => [...map.keys()]),
                    clear: vi.fn(async () => { map.clear(); }),
                    iterate: vi.fn(async (cb) => { for (const [k, v] of map.entries()) cb(v, k); }),
                    _map: map
                };
            }
            return stores[name];
        })
    }
}));

// store-state-manager.js reaches the GroupManager through services.js, whose module graph
// pulls tool_manager and layers (DOM + MapLibre). Only getGroupManager is needed here.
const { grupoStub } = vi.hoisted(() => ({
    grupoStub: { loadGroupsToMemory: vi.fn(async () => {}) }
}));
vi.mock('../../src/js/store/services.js', () => ({
    getGroupManager: () => grupoStub,
    getEventBus: () => { throw new Error('services.js mockado: getEventBus nao deve ser usado'); },
    getStateManager: () => { throw new Error('services.js mockado: getStateManager nao deve ser usado'); },
    getLayerManager: () => { throw new Error('services.js mockado: getLayerManager nao deve ser usado'); },
    getMapResolver: () => { throw new Error('services.js mockado: getMapResolver nao deve ser usado'); }
}));

// SCHEMA_VERSION vem do REEXPORT de store.js de proposito: e por ele que o resto da aplicacao
// le a constante legada (store/index.js faz `export * from './store.js'`, e
// import_export/export-import.service.js importa MIN_SCHEMA_VERSION de '@store').
import { clearAllDataStore, initStoreEvents, SCHEMA_VERSION } from '../../src/js/store/store.js';
import { detectMigrationNeeded } from '../../src/js/store/migration/migration.service.js';
import { ATLAS_SCHEMA_VERSION } from '../../src/js/store/atlas/atlas.entity.js';
import { makeFeature } from '../helpers/test-utils.js';

const APP = 'ebgeo_app_settings';
const ATLAS = 'ebgeo_atlas';
const MAPS = 'ebgeo_maps';
const IMAGES = 'ebgeo_images';

const loja = (nome) => stores[nome];
const chaves = async (nome) => [...loja(nome)._map.keys()];

/** The UI dependencies of clearAllDataStore: nothing here is under test. */
const eventBus = { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
const layerManager = { clearLayersCache: vi.fn(), loadLayersToMemory: vi.fn(async () => {}) };

/**
 * Seeds an installation on the CURRENT version: one map with features, one blob, the atlas
 * record and the settings, exactly the shape local.repository.js reads back.
 */
async function semearInstalacaoCorrente() {
    await loja(MAPS).setItem('Principal', {
        name: 'Principal',
        features: { points: [makeFeature('feicao-1'), makeFeature('feicao-2')] }
    });
    await loja(IMAGES).setItem('feicao-1', 'blob-da-feicao-1');
    await loja(APP).setItem('schemaVersion', ATLAS_SCHEMA_VERSION);
    await loja(APP).setItem('lastActiveMap', 'Principal');
    await loja(APP).setItem('mapOrder', ['Principal']);
    await loja(ATLAS).setItem('current_atlas', {
        id: 'atlas-do-chefe',
        name: 'Atlas do Chefe',
        schemaVersion: ATLAS_SCHEMA_VERSION,
        mapOrder: ['Principal'],
        lastActiveMapId: null,
        settings: { terrainExaggeration: 1.5 }
    });
}

beforeAll(() => {
    // initStoreEvents throws if called twice, so the whole file shares one injection.
    initStoreEvents(eventBus, grupoStub, layerManager);
});

beforeEach(() => {
    for (const nome of Object.keys(stores)) stores[nome]._map.clear();
    vi.clearAllMocks();
});

describe('"Limpar Todos os Dados" e o carimbo de versao de esquema', () => {
    it('PIOR CASO: o estado que o carimbo legado produzia manda o boot para a cadeia v1', async () => {
        // O insumo degenerado, montado a mao: settings em '1.7' (o que a linha antiga gravava)
        // e nenhum registro de atlas para segurar o portao. Sem ver a regua REPROVAR aqui, a
        // assercao `needed: false` dos casos abaixo passaria por um detector cego.
        await loja(APP).setItem('schemaVersion', SCHEMA_VERSION);

        const { needed, currentVersion } = await detectMigrationNeeded();

        expect(SCHEMA_VERSION).toBe('1.7');
        expect(currentVersion).toBe('1.7');
        expect(needed).toBe(true);
    });

    it('depois de limpar tudo, o settings nasce na versao CORRENTE do atlas', async () => {
        await semearInstalacaoCorrente();

        await clearAllDataStore();

        expect(await loja(APP).getItem('schemaVersion')).toBe(ATLAS_SCHEMA_VERSION);
        expect(await loja(APP).getItem('schemaVersion')).not.toBe(SCHEMA_VERSION);
        // A limpeza aconteceu de verdade: o mapa semeado e o blob dele se foram, e o que
        // sobrou em ebgeo_maps e o mapa padrao que o initializeRepository recria.
        expect(await chaves(IMAGES)).toEqual([]);
        expect(await chaves(MAPS)).toEqual(['Principal']);
        expect((await loja(MAPS).getItem('Principal')).features.points).toEqual([]);
    });

    it('a instalacao recem-limpa nao cai na cadeia v1 nem sem o registro de atlas', async () => {
        await semearInstalacaoCorrente();

        await clearAllDataStore();
        // O registro de atlas e a OUTRA metade do portao de detectMigrationNeeded. Apagado
        // ele, so o carimbo do settings responde, que e exatamente o que esta em conserto.
        await loja(ATLAS).removeItem('current_atlas');

        const { needed, currentVersion } = await detectMigrationNeeded();
        expect(needed).toBe(false);
        expect(currentVersion).toBe(ATLAS_SCHEMA_VERSION);
    });

    it('o registro de atlas SOBREVIVE a limpeza, de proposito', async () => {
        await semearInstalacaoCorrente();

        await clearAllDataStore();

        // Decisao registrada: clearAllDataStore nao limpa ebgeo_atlas. O registro guarda o
        // nome e o `settings.terrainExaggeration` que map_sig.js e a modal de configuracoes
        // leem, e o mapOrder VIVO da interface mora no settings (map.operations.js), que a
        // limpeza ja apaga. Se um dia a limpeza tiver de ser total, o gesto certo e
        // localRepository.clearAll(), e nao apagar este registro por conta propria.
        const atlas = await loja(ATLAS).getItem('current_atlas');
        expect(atlas?.name).toBe('Atlas do Chefe');
        expect(atlas?.settings?.terrainExaggeration).toBe(1.5);
        expect(await loja(APP).getItem('mapOrder')).toBeNull();
    });
});
