// Path: tests/unit/migracao-feicao-e-zoom-de-ponto.test.js

/**
 * @fileoverview Pins the two feature-level halves of the schema migration chain:
 * `migrateFeature` / `migrateFeatures` / `createIdMappings`, exported by
 * `frontend/src/js/store/migration/v1-to-v2.migration.js`, and the point-zoom backfill
 * that `migrateToV2_1` runs (the step to 2.1, whose backfill function is private and is
 * therefore driven through the exported step). Migrations are cited by SYMBOL here, never
 * by number.
 *
 * WHY THIS SUITE EXISTS NEXT TO `frontend/tests/store/store-schema-migration.test.js`
 * That suite drives the CHAIN: the orchestration, the version stamps, the three-pass map
 * migration end to end. It never calls `migrateFeature` directly and never feeds the
 * backfill a zoom of 0. This one is the unit-level complement: the id-minting policy of a
 * single feature, and the falsy-zero edge of the backfill.
 *
 * WHAT THIS SUITE PINS
 * - `migrateFeature` mints a UUID only for a TRUTHY old id, and `resolveId` is idempotent
 *   per mappings object, which is what keeps a group's feature references pointing at the
 *   same feature after the rewrite;
 * - the layer policy: the literal `'default'` is preserved verbatim, an unmapped custom id
 *   passes through, and an EMPTY layer id collapses into `'default'`;
 * - that a feature with no `groupId` GAINS the key with value `undefined`;
 * - the backfill's falsy-zero, now FIXED: `sizeCreatedAtZoom: 0` is a legitimate zoom and
 *   survives the step, while `undefined`, `null` and `NaN` still backfill to 10;
 * - that the step to 2.1 stamps ITS OWN target version and not `ATLAS_SCHEMA_VERSION`,
 *   which is the trap its own fileoverview documents: stamping the chain's final version
 *   makes `detectMigrationNeeded` compare equal and the later steps never run, in silence.
 *
 * WHAT IT DOES NOT REACH
 * - Real IndexedDB / localforage: `atlas-namespace.js` is replaced by a scope-keyed
 *   registry of in-memory stores, so nothing here says the databases are named correctly.
 *   The namespacing itself has its own guard in
 *   `frontend/tests/unit/repository-namespace.test.js`.
 * - `migrateToV2` as a whole, `migrateLayers`, `migrateGroups`, `migrateMap`, the version
 *   detector and the orchestration: all in `frontend/tests/store/store-schema-migration.test.js`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Store doubles, keyed by (storeId, scope suffix)
// ---------------------------------------------------------------------------

const { registry, uuidCounter, makeStore, SCOPE_KEY } = vi.hoisted(() => {
    const registry = new Map();
    const SCOPE_KEY = (storeId, scope) => `${storeId}@${scope?.dbSuffix ?? '<none>'}`;

    function makeStore(key) {
        if (registry.has(key)) return registry.get(key);
        const backing = new Map();
        const instance = {
            __key: key,
            __backing: backing,
            getItem: vi.fn(async (k) => (backing.has(k) ? backing.get(k) : null)),
            setItem: vi.fn(async (k, v) => { backing.set(k, v); return v; }),
            removeItem: vi.fn(async (k) => { backing.delete(k); }),
            keys: vi.fn(async () => [...backing.keys()]),
            clear: vi.fn(async () => { backing.clear(); }),
        };
        registry.set(key, instance);
        return instance;
    }

    return { registry, uuidCounter: { value: 0 }, makeStore, SCOPE_KEY };
});

vi.mock('../../src/js/store/atlas-namespace.js', () => ({
    ATLAS_RECORD_KEY: 'current_atlas',
    LEGACY_DB_SUFFIX: '',
    StoreName: {
        MAPS: 'maps',
        ATLAS: 'atlas',
        SETTINGS: 'settings',
        GROUPS: 'groups',
        LAYERS: 'layers',
    },
    localScope: (atlasId, dbSuffix) => ({ kind: 'local', atlasId, dbSuffix }),
    getStoreFor: (storeId, scope) => makeStore(SCOPE_KEY(storeId, scope)),
}));

vi.mock('../../src/js/utilities/uuid.js', () => ({
    generateUUID: vi.fn(() => {
        uuidCounter.value += 1;
        return `uuid-${uuidCounter.value}`;
    }),
    isValidUUID: vi.fn(() => true),
    isLegacyId: vi.fn(() => false),
    isValidId: vi.fn(() => true),
}));

const { createIdMappings, migrateFeature, migrateFeatures } =
    await import('../../src/js/store/migration/v1-to-v2.migration.js');
const { migrateToV2_1 } =
    await import('../../src/js/store/migration/v2-to-v2.1.migration.js');
const { ATLAS_SCHEMA_VERSION } =
    await import('../../src/js/store/atlas/atlas.entity.js');

/** The pre-namespace scope the migration steps default to. */
const legacySuffix = '';
const mapStore = () => makeStore(SCOPE_KEY('maps', { dbSuffix: legacySuffix }));
const atlasStore = () => makeStore(SCOPE_KEY('atlas', { dbSuffix: legacySuffix }));
const appStore = () => makeStore(SCOPE_KEY('settings', { dbSuffix: legacySuffix }));

/**
 * @param {object} props - Feature properties.
 * @returns {object} A v1-shaped feature.
 */
function feat(props) {
    return {
        type: 'Feature',
        properties: { ...props },
        geometry: { type: 'Point', coordinates: [0, 0] },
    };
}

let logSpy;

beforeEach(() => {
    for (const store of registry.values()) store.__backing.clear();
    uuidCounter.value = 0;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    logSpy.mockRestore();
});

// ============================================================================
// createIdMappings
// ============================================================================

describe('createIdMappings', () => {
    it('devolve os QUATRO mapas, todos vazios', () => {
        const m = createIdMappings();
        expect(Object.keys(m).sort()).toEqual(['features', 'groups', 'layers', 'maps']);
        for (const key of Object.keys(m)) {
            expect(m[key], key).toBeInstanceOf(Map);
            expect(m[key].size, key).toBe(0);
        }
    });

    it('cada chamada devolve mapas NOVOS, sem estado compartilhado', () => {
        const a = createIdMappings();
        const b = createIdMappings();
        a.features.set('x', 'y');
        expect(b.features.size).toBe(0);
        expect(a.features).not.toBe(b.features);
    });
});

// ============================================================================
// migrateFeature: id minting
// ============================================================================

describe('migrateFeature: cunhagem de id', () => {
    it('CONTROLE: um id antigo truthy vira UUID e a feicao ganha sync', () => {
        const out = migrateFeature(feat({ id: 'antigo' }), createIdMappings());
        expect(out.properties.id).toBe('uuid-1');
        expect(out.properties.sync).toMatchObject({ version: 1, dirty: true, deleted: false });
        expect(typeof out.properties.sync.createdAt).toBe('number');
    });

    it('resolveId e IDEMPOTENTE dentro do mesmo mappings', () => {
        const mappings = createIdMappings();
        const a = migrateFeature(feat({ id: 'antigo' }), mappings);
        const b = migrateFeature(feat({ id: 'antigo' }), mappings);
        expect(a.properties.id).toBe(b.properties.id);
        expect(mappings.features.size).toBe(1);
    });

    it('ids DISTINTOS recebem UUIDs distintos', () => {
        const mappings = createIdMappings();
        const ids = ['a', 'b', 'c'].map(id => migrateFeature(feat({ id }), mappings).properties.id);
        expect(new Set(ids).size).toBe(3);
        expect(mappings.features.size).toBe(3);
    });

    it('mappings DIFERENTES nao compartilham a resolucao do mesmo id antigo', () => {
        const a = migrateFeature(feat({ id: 'antigo' }), createIdMappings());
        const b = migrateFeature(feat({ id: 'antigo' }), createIdMappings());
        expect(a.properties.id).not.toBe(b.properties.id);
    });

    it('id AUSENTE nao e cunhado: a feicao continua sem id', () => {
        const mappings = createIdMappings();
        const out = migrateFeature(feat({ nome: 'sem id' }), mappings);
        expect(out.properties.id).toBeUndefined();
        expect(mappings.features.size).toBe(0);
    });

    it('OBSERVADO: id falsy (0, string vazia, null) tambem NAO e cunhado e atravessa cru', () => {
        // `oldId ? resolveId(...) : oldId` is a truthiness test. A numeric id of 0 is the
        // falsy-zero shape; here it means the feature reaches v2.0 with `id: 0`, i.e.
        // without the UUID the rest of the schema assumes.
        const mappings = createIdMappings();
        expect(migrateFeature(feat({ id: 0 }), mappings).properties.id).toBe(0);
        expect(migrateFeature(feat({ id: '' }), mappings).properties.id).toBe('');
        expect(migrateFeature(feat({ id: null }), mappings).properties.id).toBeNull();
        expect(mappings.features.size).toBe(0);
    });
});

// ============================================================================
// migrateFeature: layer and group policy
// ============================================================================

describe('migrateFeature: politica de camada e de grupo', () => {
    it("preserva o literal 'default' VERBATIM, mesmo se ele estiver mapeado", () => {
        const mappings = createIdMappings();
        mappings.layers.set('default', 'uuid-nao-usar');
        const out = migrateFeature(feat({ id: 'f', layerId: 'default' }), mappings);
        expect(out.properties.layerId).toBe('default');
    });

    it('camada AUSENTE vira o literal default', () => {
        const out = migrateFeature(feat({ id: 'f' }), createIdMappings());
        expect(out.properties.layerId).toBe('default');
    });

    it('OBSERVADO: camada com id FALSY (vazio, 0, null) tambem colapsa em default', () => {
        const mappings = createIdMappings();
        for (const raw of ['', 0, null, false]) {
            const out = migrateFeature(feat({ id: 'f', layerId: raw }), mappings);
            expect(out.properties.layerId, String(raw)).toBe('default');
        }
    });

    it('camada customizada MAPEADA e remapeada para o UUID da camada', () => {
        const mappings = createIdMappings();
        mappings.layers.set('camada-crua', 'uuid-camada');
        const out = migrateFeature(feat({ id: 'f', layerId: 'camada-crua' }), mappings);
        expect(out.properties.layerId).toBe('uuid-camada');
    });

    it('camada customizada NAO mapeada atravessa crua (nao vira default nem UUID novo)', () => {
        const out = migrateFeature(feat({ id: 'f', layerId: 'orfa' }), createIdMappings());
        expect(out.properties.layerId).toBe('orfa');
    });

    it('grupo mapeado e remapeado, e grupo nao mapeado atravessa cru', () => {
        const mappings = createIdMappings();
        mappings.groups.set('g1', 'uuid-grupo');
        expect(migrateFeature(feat({ id: 'f', groupId: 'g1' }), mappings).properties.groupId)
            .toBe('uuid-grupo');
        expect(migrateFeature(feat({ id: 'f', groupId: 'g9' }), mappings).properties.groupId)
            .toBe('g9');
    });

    it('OBSERVADO: feicao SEM grupo GANHA a chave groupId com valor undefined', () => {
        // The destructure produces `undefined` and the object literal always writes the
        // key, so a v1 feature that had no `groupId` at all comes out of the migration
        // with the key present. Harmless for `?.` readers, visible to `in` and to
        // `Object.keys`, and it is what gets persisted.
        const out = migrateFeature(feat({ id: 'f' }), createIdMappings());
        expect('groupId' in out.properties).toBe(true);
        expect(out.properties.groupId).toBeUndefined();
    });
});

// ============================================================================
// migrateFeature: identity and immutability
// ============================================================================

describe('migrateFeature: identidade e imutabilidade', () => {
    it('feicao null/undefined atravessa inalterada', () => {
        expect(migrateFeature(null, createIdMappings())).toBeNull();
        expect(migrateFeature(undefined, createIdMappings())).toBeUndefined();
    });

    it('feicao SEM properties atravessa pela MESMA referencia, sem ganhar sync', () => {
        const bare = { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] } };
        expect(migrateFeature(bare, createIdMappings())).toBe(bare);
    });

    it('properties null tambem atravessa pela mesma referencia', () => {
        const f = { type: 'Feature', properties: null };
        expect(migrateFeature(f, createIdMappings())).toBe(f);
    });

    it('nao muta a feicao de entrada', () => {
        const original = feat({ id: 'antigo', layerId: 'camada-crua' });
        const antes = JSON.stringify(original);
        migrateFeature(original, createIdMappings());
        expect(JSON.stringify(original)).toBe(antes);
    });

    it('a copia e RASA: geometry continua compartilhada com a entrada', () => {
        const original = feat({ id: 'f' });
        const out = migrateFeature(original, createIdMappings());
        expect(out.geometry).toBe(original.geometry);
        expect(out).not.toBe(original);
        expect(out.properties).not.toBe(original.properties);
    });

    it('preserva toda propriedade que nao seja id/layerId/groupId/sync', () => {
        const out = migrateFeature(
            feat({ id: 'f', nome: 'Alfa', visivel: false, bloqueado: true, size: 0 }),
            createIdMappings()
        );
        expect(out.properties.nome).toBe('Alfa');
        expect(out.properties.visivel).toBe(false);
        expect(out.properties.bloqueado).toBe(true);
        expect(out.properties.size).toBe(0);
    });

    it('SOBRESCREVE um sync preexistente por um sync novo (a migracao nao respeita o antigo)', () => {
        const original = feat({ id: 'f', sync: { version: 99, dirty: false, deleted: true } });
        const out = migrateFeature(original, createIdMappings());
        expect(out.properties.sync.version).toBe(1);
        expect(out.properties.sync.dirty).toBe(true);
        expect(out.properties.sync.deleted).toBe(false);
    });
});

// ============================================================================
// migrateFeatures
// ============================================================================

describe('migrateFeatures', () => {
    it('migra todas as listas e preserva as chaves de tipo', () => {
        const mappings = createIdMappings();
        const out = migrateFeatures(
            { points: [feat({ id: 'p1' }), feat({ id: 'p2' })], lines: [feat({ id: 'l1' })] },
            mappings
        );
        expect(Object.keys(out).sort()).toEqual(['lines', 'points']);
        expect(out.points).toHaveLength(2);
        expect(out.lines).toHaveLength(1);
        expect(mappings.features.size).toBe(3);
    });

    it('null, undefined e nao-objeto atravessam inalterados', () => {
        const m = createIdMappings();
        expect(migrateFeatures(null, m)).toBeNull();
        expect(migrateFeatures(undefined, m)).toBeUndefined();
        expect(migrateFeatures('nao', m)).toBe('nao');
        expect(migrateFeatures(42, m)).toBe(42);
    });

    it('objeto vazio vira objeto vazio NOVO', () => {
        const entrada = {};
        const out = migrateFeatures(entrada, createIdMappings());
        expect(out).toEqual({});
        expect(out).not.toBe(entrada);
    });

    it('valor que NAO e array atravessa sem ser tocado', () => {
        const out = migrateFeatures({ points: 'estragado', lines: null }, createIdMappings());
        expect(out.points).toBe('estragado');
        expect(out.lines).toBeNull();
    });

    it('lista vazia continua lista vazia', () => {
        expect(migrateFeatures({ points: [] }, createIdMappings()).points).toEqual([]);
    });

    it('OBSERVADO: um ARRAY de entrada sai como OBJETO de chaves numericas', () => {
        // `typeof [] === 'object'`, so an array survives the guard and `Object.entries`
        // turns its indices into keys. The migration never feeds it an array, but the
        // shape of the failure (silently changing the container type) is worth pinning.
        const out = migrateFeatures([[feat({ id: 'a' })]], createIdMappings());
        expect(Array.isArray(out)).toBe(false);
        expect(Object.keys(out)).toEqual(['0']);
    });

    it('o mapeamento de camada e COMPARTILHADO entre listas de tipos diferentes', () => {
        const mappings = createIdMappings();
        mappings.layers.set('c1', 'uuid-c1');
        const out = migrateFeatures(
            { points: [feat({ id: 'p', layerId: 'c1' })], lines: [feat({ id: 'l', layerId: 'c1' })] },
            mappings
        );
        expect(out.points[0].properties.layerId).toBe('uuid-c1');
        expect(out.lines[0].properties.layerId).toBe('uuid-c1');
    });
});

// ============================================================================
// The step to 2.1: point zoom backfill
// ============================================================================

describe('degrau para 2.1: preenchimento de sizeCreatedAtZoom', () => {
    it('CONTROLE: preenche 10 no ponto que nao tem o campo, e nao toca em outro tipo', async () => {
        await mapStore().setItem('M', {
            features: {
                points: [feat({ id: 'p1' })],
                lines: [feat({ id: 'l1' })],
            },
        });

        await migrateToV2_1();

        const map = await mapStore().getItem('M');
        expect(map.features.points).toHaveLength(1);
        expect(map.features.points[0].properties.sizeCreatedAtZoom).toBe(10);
        expect('sizeCreatedAtZoom' in map.features.lines[0].properties).toBe(false);
    });

    it('CONTROLE: um valor truthy preexistente e preservado', async () => {
        await mapStore().setItem('M', {
            features: { points: [feat({ id: 'p1', sizeCreatedAtZoom: 14 })] },
        });
        await migrateToV2_1();
        const map = await mapStore().getItem('M');
        expect(map.features.points[0].properties.sizeCreatedAtZoom).toBe(14);
    });

    it('DEFEITO CORRIGIDO: sizeCreatedAtZoom 0 SOBREVIVE, nao e mais sobrescrito por 10', async () => {
        // Zoom 0 is the whole-world zoom level: a legitimate value, not an absence. The
        // backfill used to test TRUTHINESS (`if (!feature.properties.sizeCreatedAtZoom)`)
        // where it meant ABSENCE, rewriting the reference zoom to 10, after which the size
        // zoom correction drew the point at a size the author never chose. The guard that
        // holds: `!Number.isFinite(...)`.
        await mapStore().setItem('M', {
            features: { points: [feat({ id: 'p1', sizeCreatedAtZoom: 0 })] },
        });
        await migrateToV2_1();
        const map = await mapStore().getItem('M');
        expect(map.features.points).toHaveLength(1);
        expect(map.features.points[0].properties.sizeCreatedAtZoom).toBe(0);
    });

    it('o zoom 0 preservado NAO faz o degrau reescrever o mapa a toa', async () => {
        // Identity of the features object is what decides the write, so a point that no
        // longer needs backfilling must leave the map untouched.
        await mapStore().setItem('M', {
            features: { points: [feat({ id: 'p1', sizeCreatedAtZoom: 0 })] },
        });
        mapStore().setItem.mockClear();
        await migrateToV2_1();
        const mapWrites = mapStore().setItem.mock.calls.filter(([key]) => key === 'M');
        expect(mapWrites).toHaveLength(0);
    });

    it('NaN e null continuam sendo sobrescritos (aqui o efeito e desejavel)', async () => {
        // `Number.isFinite` keeps the two cases the truthiness test also caught, which is
        // the half of the old behaviour that was right.
        await mapStore().setItem('M', {
            features: {
                points: [
                    feat({ id: 'p1', sizeCreatedAtZoom: NaN }),
                    feat({ id: 'p2', sizeCreatedAtZoom: null }),
                    feat({ id: 'p3', sizeCreatedAtZoom: Infinity }),
                ],
            },
        });
        await migrateToV2_1();
        const map = await mapStore().getItem('M');
        expect(map.features.points).toHaveLength(3);
        expect(map.features.points[0].properties.sizeCreatedAtZoom).toBe(10);
        expect(map.features.points[1].properties.sizeCreatedAtZoom).toBe(10);
        expect(map.features.points[2].properties.sizeCreatedAtZoom).toBe(10);
    });

    it('nao reescreve o mapa quando nada muda (a identidade do objeto decide a escrita)', async () => {
        await mapStore().setItem('M', {
            features: { points: [feat({ id: 'p1', sizeCreatedAtZoom: 12 })] },
        });
        mapStore().setItem.mockClear();

        await migrateToV2_1();

        // Only the version stamps write; the map itself is not touched.
        const mapWrites = mapStore().setItem.mock.calls.filter(([key]) => key === 'M');
        expect(mapWrites).toHaveLength(0);
    });

    it('reescreve o mapa exatamente UMA vez quando ha o que preencher', async () => {
        await mapStore().setItem('M', { features: { points: [feat({ id: 'p1' })] } });
        mapStore().setItem.mockClear();

        await migrateToV2_1();

        const mapWrites = mapStore().setItem.mock.calls.filter(([key]) => key === 'M');
        expect(mapWrites).toHaveLength(1);
    });

    it('mapa sem features e mapa com points nao-array sao pulados sem lancar', async () => {
        await mapStore().setItem('vazio', { name: 'vazio' });
        await mapStore().setItem('estranho', { features: { points: 'nao e array' } });
        await mapStore().setItem('nulo', null);

        await expect(migrateToV2_1()).resolves.toEqual({ success: true });
        expect((await mapStore().getItem('estranho')).features.points).toBe('nao e array');
    });

    it('ponto sem properties e pulado sem derrubar os vizinhos', async () => {
        await mapStore().setItem('M', {
            features: { points: [{ type: 'Feature' }, null, feat({ id: 'p1' })] },
        });

        await migrateToV2_1();

        const points = (await mapStore().getItem('M')).features.points;
        expect(points).toHaveLength(3);
        expect(points[0].properties).toBeUndefined();
        expect(points[1]).toBeNull();
        expect(points[2].properties.sizeCreatedAtZoom).toBe(10);
    });

    it('OBSERVADO: o preenchimento MUTA as properties no lugar, antes de qualquer escrita', async () => {
        // The step is described as non-destructive, and it is at the database level, but
        // the in-memory object handed back by `getItem` is mutated directly. A caller
        // holding that reference sees the change even if the write that follows fails.
        const held = { features: { points: [feat({ id: 'p1' })] } };
        await mapStore().setItem('M', held);

        await migrateToV2_1();

        expect(held.features.points[0].properties.sizeCreatedAtZoom).toBe(10);
    });
});

// ============================================================================
// The step to 2.1: version stamping
// ============================================================================

describe('degrau para 2.1: carimbo de versao', () => {
    it('carimba a PROPRIA versao alvo, no atlas e no appStore', async () => {
        await atlasStore().setItem('current_atlas', { id: 'a', schemaVersion: '2.0' });
        await migrateToV2_1();

        expect((await atlasStore().getItem('current_atlas')).schemaVersion).toBe('2.1');
        expect(await appStore().getItem('schemaVersion')).toBe('2.1');
    });

    it('o carimbo NAO e ATLAS_SCHEMA_VERSION: carimbar o final do encadeamento mata os degraus seguintes', async () => {
        // This is the trap the step's own fileoverview documents. If this assertion ever
        // fails, `detectMigrationNeeded` starts comparing the chain's final version with
        // itself after only this step ran, and the later backfills never run, in silence.
        await migrateToV2_1();
        const stamped = await appStore().getItem('schemaVersion');
        expect(stamped).toBe('2.1');
        expect(stamped).not.toBe(ATLAS_SCHEMA_VERSION);
    });

    it('sem atlas no banco, so o appStore e carimbado, e a etapa continua bem-sucedida', async () => {
        await expect(migrateToV2_1()).resolves.toEqual({ success: true });
        expect(await atlasStore().getItem('current_atlas')).toBeNull();
        expect(await appStore().getItem('schemaVersion')).toBe('2.1');
    });

    it('o escopo RECEBIDO decide o banco: um sufixo diferente nao toca o banco legado', async () => {
        const slot = { kind: 'local', atlasId: 'a2', dbSuffix: '__a2' };
        const slotMaps = makeStore(SCOPE_KEY('maps', slot));
        const slotApp = makeStore(SCOPE_KEY('settings', slot));

        await mapStore().setItem('legado', { features: { points: [feat({ id: 'antigo' })] } });
        await slotMaps.setItem('novo', { features: { points: [feat({ id: 'p1' })] } });

        await migrateToV2_1(slot);

        expect((await slotMaps.getItem('novo')).features.points[0].properties.sizeCreatedAtZoom)
            .toBe(10);
        expect(await slotApp.getItem('schemaVersion')).toBe('2.1');
        // The pre-namespace databases were not touched.
        expect('sizeCreatedAtZoom' in
            (await mapStore().getItem('legado')).features.points[0].properties).toBe(false);
        expect(await appStore().getItem('schemaVersion')).toBeNull();
    });
});
