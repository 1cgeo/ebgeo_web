// Path: tests/unit/import-normalize-migracao.test.js

/**
 * @fileoverview Pins `migrateImportDataToV2` and `normalizeMapDataForCurrentVersion`
 * (`src/js/import_export/import-normalize.js`), the two functions a `.ebgeo` passes
 * through before anything is written to the store.
 *
 * WHAT IT PINS
 * - Where sync metadata is (and is NOT) attached: map, feature, layer, group.
 * - The malformed-document guards that already exist (`features` non-array, `groups`
 *   non-object, missing `features` object) and the ones that DO NOT exist (a null entry
 *   inside `maps`, `layers` or `groups` throws).
 * - Idempotence: running either function twice changes nothing and never REPLACES a sync
 *   block that was already there.
 * - Aliasing: both functions are shallow, so the caller's document is written INTO.
 *
 * WHAT IT DOES NOT REACH
 * - The phantom-map invariant ("neither function assigns a map id"), already pinned by
 *   `tests/integration/import-phantom-map.repro.test.js`; it is not duplicated here.
 * - `isV1Format`, the gate that decides whether `migrateImportDataToV2` runs at all: it is
 *   a module-PRIVATE function of `export-import.service.js` and is not exported, so it has
 *   no test seam from node.
 * - The store-backed catalog resolver: it is injected, and only the injection contract is
 *   exercised here.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    migrateImportDataToV2,
    normalizeMapDataForCurrentVersion,
} from '../../src/js/import_export/import-normalize.js';
import { ATLAS_SCHEMA_VERSION } from '../../src/js/store/atlas/atlas.entity.js';

/**
 * The sync block `createSyncMetadata()` actually mints. There are SEVEN fields, not the six
 * that `.claude/rules/architecture.md` names: `deletedAt` rides along with `deleted`.
 */
const SYNC_KEYS = ['createdAt', 'updatedAt', 'version', 'ownerId', 'dirty', 'deleted', 'deletedAt'];

/** @param {any} sync @returns {void} */
function expectSyncShape(sync) {
    expect(sync).toBeTruthy();
    expect(Object.keys(sync).sort()).toEqual([...SYNC_KEYS].sort());
    expect(typeof sync.createdAt).toBe('number');
    expect(sync.ownerId).toBeNull();
}

/** @returns {(layers: Array) => {processed: Array, unavailableCount: number}} */
const semCatalogo = () => vi.fn(() => ({ processed: [], unavailableCount: 0 }));

describe('migrateImportDataToV2 — versao', () => {
    it('carimba SEMPRE a versao corrente, qualquer que seja a de entrada', () => {
        for (const entrada of [{ version: '1.0' }, { version: '1.4' }, { version: '2.3' }, {}]) {
            expect(migrateImportDataToV2(entrada).version).toBe(ATLAS_SCHEMA_VERSION);
        }
        expect(ATLAS_SCHEMA_VERSION).toBe('2.3');
    });

    it('documento minimo (sem maps/layers/groups) atravessa sem lancar e preserva as chaves alheias', () => {
        const out = migrateImportDataToV2({ mapOrder: ['A'], briefings: [] });
        expect(out.mapOrder).toEqual(['A']);
        expect(out.briefings).toEqual([]);
        expect(out.version).toBe(ATLAS_SCHEMA_VERSION);
    });
});

describe('migrateImportDataToV2 — metadado de sync', () => {
    it('poe sync no mapa, na feicao, na camada e no grupo', () => {
        const out = migrateImportDataToV2({
            version: '1.0',
            maps: {
                A: {
                    features: {
                        points: [{ properties: { id: 'p1' } }, { properties: { id: 'p2' } }],
                        lines: [{ properties: { id: 'l1' } }],
                    },
                },
            },
            layers: { A: [{ id: 'default' }, { id: 'l2' }] },
            groups: { A: { g1: { id: 'g1' }, g2: { id: 'g2' } } },
        });

        expectSyncShape(out.maps.A.sync);

        const pontos = out.maps.A.features.points;
        expect(pontos).toHaveLength(2);
        pontos.forEach((f) => expectSyncShape(f.properties.sync));
        expect(out.maps.A.features.lines).toHaveLength(1);
        expectSyncShape(out.maps.A.features.lines[0].properties.sync);

        expect(out.layers.A).toHaveLength(2);
        out.layers.A.forEach((l) => expectSyncShape(l.sync));

        const grupos = Object.values(out.groups.A);
        expect(grupos).toHaveLength(2);
        grupos.forEach((g) => expectSyncShape(g.sync));
    });

    it('IDEMPOTENTE: a segunda passada nao SUBSTITUI nenhum bloco de sync ja existente', () => {
        const data = {
            version: '1.0',
            maps: { A: { features: { points: [{ properties: { id: 'p1' } }] } } },
            layers: { A: [{ id: 'default' }] },
            groups: { A: { g1: { id: 'g1' } } },
        };

        const um = migrateImportDataToV2(data);
        const refs = {
            mapa: um.maps.A.sync,
            feicao: um.maps.A.features.points[0].properties.sync,
            camada: um.layers.A[0].sync,
            grupo: um.groups.A.g1.sync,
        };
        expect(Object.keys(refs)).toHaveLength(4);

        const dois = migrateImportDataToV2(um);

        expect(dois.maps.A.sync).toBe(refs.mapa);
        expect(dois.maps.A.features.points[0].properties.sync).toBe(refs.feicao);
        expect(dois.layers.A[0].sync).toBe(refs.camada);
        expect(dois.groups.A.g1.sync).toBe(refs.grupo);
        expect(dois).toEqual(um);
    });

    it('EDGE: feicao sem `properties`, e com properties null, NAO recebe sync e nao lanca', () => {
        const out = migrateImportDataToV2({
            maps: { A: { features: { points: [{ geometry: {} }, { properties: null }] } } },
        });
        const pontos = out.maps.A.features.points;
        expect(pontos).toHaveLength(2);
        expect(pontos[0].sync).toBeUndefined();
        expect(pontos[0].properties).toBeUndefined();
        expect(pontos[1].properties).toBeNull();
    });

    it('EDGE: colecao de feicoes que NAO e array e pulada (guarda explicita)', () => {
        const out = migrateImportDataToV2({
            maps: { A: { features: { points: 'oops', lines: null, polygons: { 0: {} } } } },
        });
        expect(out.maps.A.features.points).toBe('oops');
        expect(out.maps.A.features.lines).toBeNull();
        expectSyncShape(out.maps.A.sync);
    });

    it('EDGE: mapa sem `features`, camadas nao-array e grupos nao-objeto sao pulados', () => {
        const out = migrateImportDataToV2({
            maps: { A: {} },
            layers: { A: 'nao e array', B: null },
            groups: { A: null, B: 'texto', C: 42 },
        });

        expectSyncShape(out.maps.A.sync);
        expect(out.maps.A.features).toBeUndefined();
        expect(out.layers.A).toBe('nao e array');
        expect(out.groups.A).toBeNull();
    });

    it('CORRIGIDO: uma ENTRADA null dentro de maps/layers/groups e PULADA, nao derruba o import', () => {
        // CONTROLE: as mesmas tres formas com entradas bem formadas continuam migrando.
        const bom = migrateImportDataToV2({
            maps: { A: {} }, layers: { A: [{ id: 'x' }] }, groups: { A: { g: { id: 'g' } } },
        });
        expectSyncShape(bom.maps.A.sync);
        expectSyncShape(bom.layers.A[0].sync);
        expectSyncShape(bom.groups.A.g.sync);

        // O guard de `groups` cobria o CONTEINER null e nunca o MEMBRO: um `.ebgeo` editado
        // a mao com um membro null abortava o import inteiro com um TypeError cru, antes de
        // qualquer coisa aparecer na tela.
        expect(() => migrateImportDataToV2({ maps: { A: null } })).not.toThrow();
        expect(() => migrateImportDataToV2({ layers: { A: [null] } })).not.toThrow();
        expect(() => migrateImportDataToV2({ groups: { A: { g1: null } } })).not.toThrow();
        expect(() => migrateImportDataToV2({ maps: { A: { features: { points: [null] } } } })).not.toThrow();

        // O membro null SOBREVIVE como null (pular nao e apagar), e o irmao bem formado
        // ao lado dele continua sendo migrado: e essa a propriedade que o `continue` compra.
        const misto = migrateImportDataToV2({
            maps: { Bom: {}, Ruim: null },
            layers: { A: [null, { id: 'x' }] },
            groups: { A: { g0: null, g1: { id: 'g1' } } },
        });
        expect(misto.maps.Ruim).toBeNull();
        expect(misto.layers.A[0]).toBeNull();
        expect(misto.groups.A.g0).toBeNull();
        expectSyncShape(misto.maps.Bom.sync);
        expectSyncShape(misto.layers.A[1].sync);
        expectSyncShape(misto.groups.A.g1.sync);
    });

    it('CORRIGIDO: um primitivo no lugar de uma entrada tambem e pulado, sem lancar', () => {
        // `typeof 'x' !== 'object'`, entao a mesma guarda cobre string, numero e booleano;
        // sem ela, `mapData.sync = ...` sobre uma string falha em modo estrito.
        expect(() => migrateImportDataToV2({ maps: { A: 'nao e mapa' } })).not.toThrow();
        expect(() => migrateImportDataToV2({ layers: { A: [42] } })).not.toThrow();
        expect(() => migrateImportDataToV2({ groups: { A: { g: true } } })).not.toThrow();
    });
});

describe('migrateImportDataToV2 — aliasing', () => {
    it('DEFEITO OBSERVADO: a copia e RASA, entao a entrada do chamador tambem e escrita', () => {
        const entrada = {
            version: '1.0',
            maps: { A: { features: { points: [{ properties: { id: 'p1' } }] } } },
            layers: { A: [{ id: 'default' }] },
        };

        const out = migrateImportDataToV2(entrada);

        // CONTROLE: o nivel 1 realmente e copia (a versao nova nao vazou de volta).
        expect(out).not.toBe(entrada);
        expect(entrada.version).toBe('1.0');
        expect(out.version).toBe(ATLAS_SCHEMA_VERSION);

        // OBSERVADO: tudo abaixo do nivel 1 e o MESMO objeto, ja mutado.
        expect(out.maps).toBe(entrada.maps);
        expectSyncShape(entrada.maps.A.sync);
        expectSyncShape(entrada.maps.A.features.points[0].properties.sync);
        expectSyncShape(entrada.layers.A[0].sync);
    });
});

describe('normalizeMapDataForCurrentVersion', () => {
    it('devolve O MESMO objeto (normaliza no lugar), com coordination_measures e sync garantidos', () => {
        const mapData = { features: { points: [] } };
        const { mapData: out, unavailableCatalogLayersCount } = normalizeMapDataForCurrentVersion(mapData, semCatalogo());

        expect(out).toBe(mapData);
        expect(out.features.coordination_measures).toEqual([]);
        expectSyncShape(out.sync);
        expect(unavailableCatalogLayersCount).toBe(0);
    });

    it('EDGE: mapData sem `features` nenhum ganha o objeto e as DUAS chaves, sem lancar', () => {
        // DUAS desde 2026-09-03: `coordination_lines` entrou ao lado de
        // `coordination_measures`, porque o mesmo arquivo antigo que nao tem uma nao tem a
        // outra, e sem o balde a Linha de Coordenacao ativa, aceita clique e nao desenha nada.
        const { mapData } = normalizeMapDataForCurrentVersion({}, semCatalogo());
        expect(mapData.features).toEqual({ coordination_measures: [], coordination_lines: [] });
    });

    it('EDGE: coordination_measures ja presente e PRESERVADO, inclusive nao vazio', () => {
        const existentes = [{ id: 'cm1' }];
        const { mapData } = normalizeMapDataForCurrentVersion(
            { features: { coordination_measures: existentes } }, semCatalogo(),
        );
        expect(mapData.features.coordination_measures).toBe(existentes);
        expect(mapData.features.coordination_measures).toHaveLength(1);
    });

    it('EDGE: coordination_measures com valor FALSY (array vazio nao e falsy, mas null e) e reposto', () => {
        const { mapData } = normalizeMapDataForCurrentVersion(
            { features: { coordination_measures: null } }, semCatalogo(),
        );
        expect(mapData.features.coordination_measures).toEqual([]);
    });

    it('sync existente e preservado por identidade (idempotente em duas passadas)', () => {
        const mapData = { features: {} };
        const um = normalizeMapDataForCurrentVersion(mapData, semCatalogo()).mapData;
        const syncRef = um.sync;
        const dois = normalizeMapDataForCurrentVersion(um, semCatalogo()).mapData;

        expect(dois.sync).toBe(syncRef);
        expect(dois).toBe(um);
    });

    it('catalogLayers vazio NAO chama o resolver; nao vazio chama uma vez e devolve a contagem', () => {
        const vazio = semCatalogo();
        normalizeMapDataForCurrentVersion({ features: {}, catalogLayers: [] }, vazio);
        expect(vazio).not.toHaveBeenCalled();

        const resolver = vi.fn(() => ({ processed: [{ id: 'a', disponivel: true }], unavailableCount: 2 }));
        const { mapData, unavailableCatalogLayersCount } = normalizeMapDataForCurrentVersion(
            { features: {}, catalogLayers: [{ id: 'a' }, { id: 'b' }] }, resolver,
        );

        expect(resolver).toHaveBeenCalledTimes(1);
        expect(resolver.mock.calls[0][0]).toEqual([{ id: 'a' }, { id: 'b' }]);
        expect(mapData.catalogLayers).toEqual([{ id: 'a', disponivel: true }]);
        expect(unavailableCatalogLayersCount).toBe(2);
    });

    it('EDGE: catalogLayers ausente ou sem `.length` pula o resolver e devolve contagem 0', () => {
        for (const catalogLayers of [undefined, null, {}, 0, '']) {
            const resolver = semCatalogo();
            const { unavailableCatalogLayersCount } = normalizeMapDataForCurrentVersion(
                { features: {}, catalogLayers }, resolver,
            );
            expect(resolver).not.toHaveBeenCalled();
            expect(unavailableCatalogLayersCount).toBe(0);
        }
    });

    it('EDGE: resolver que omite `unavailableCount` devolve undefined, nao 0', () => {
        const { unavailableCatalogLayersCount } = normalizeMapDataForCurrentVersion(
            { features: {}, catalogLayers: [{ id: 'a' }] },
            () => ({ processed: [] }),
        );
        expect(unavailableCatalogLayersCount).toBeUndefined();
    });

    it('DEFEITO OBSERVADO: catalogLayers presente SEM resolver injetado lanca TypeError', () => {
        // CONTROLE: sem catalogLayers, o resolver nem e tocado, e a chamada sem ele passa.
        expect(() => normalizeMapDataForCurrentVersion({ features: {} })).not.toThrow();

        expect(() => normalizeMapDataForCurrentVersion({ features: {}, catalogLayers: [{ id: 'a' }] }))
            .toThrow(TypeError);
    });

    it('EDGE: mapData null lanca (nao ha guarda de entrada)', () => {
        expect(() => normalizeMapDataForCurrentVersion(null, semCatalogo())).toThrow(TypeError);
    });
});
