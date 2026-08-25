// Path: tests/unit/atlas-entity.test.js

/**
 * @fileoverview Pins `frontend/src/js/store/atlas/atlas.entity.js`: the Atlas entity
 * factory, its validator, and the three pure operations over `mapOrder`.
 *
 * WHAT THIS SUITE PINS
 * - `ATLAS_SCHEMA_VERSION` is the constant `detectMigrationNeeded` compares against, so a
 *   migration step that lands without raising it never runs, in silence. Two structural
 *   assertions guard it: the constant is the version `createAtlas` stamps, and the version
 *   IS ADVANCED past the last chained migration step (the one to 2.2), so the two can
 *   never quietly drift back into equality with an older step. Cited by SYMBOL, never by
 *   number: the numbering has died twice.
 * - `getAtlasTerrainExaggeration` uses `??` and NOT `||`, so an exaggeration of 0 (flat
 *   terrain, a legitimate value) survives. That is the positive control for the
 *   falsy-zero family; the same test records that `??` does not guard NaN.
 * - The three `mapOrder` operations return NEW objects and never mutate their input, and
 *   the shallow spread leaves `settings` SHARED by reference.
 * - `reorderAtlasMaps` guards by (length, membership) and therefore accepts a permutation
 *   that REPEATS one id and drops another. Marked OBSERVADO with the resulting data loss.
 *
 * WHAT IT DOES NOT REACH
 * - Persistence: nothing here touches IndexedDB, `atlas-namespace.js` or the repository.
 *   The chained schema migrations themselves are covered by
 *   `frontend/tests/store/store-schema-migration.test.js`.
 * - `isValidSyncMetadata` is used as-is (real module, not a double); its own edge cases
 *   belong to `frontend/tests/unit/sync-metadata.test.js`.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
    ATLAS_SCHEMA_VERSION,
    DEFAULT_TERRAIN_EXAGGERATION,
    createAtlas,
    isValidAtlas,
    addMapToAtlas,
    removeMapFromAtlas,
    reorderAtlasMaps,
    getAtlasTerrainExaggeration,
} from '../../src/js/store/atlas/atlas.entity.js';

/**
 * @param {string[]} mapOrder - Ids in order.
 * @param {object} [extra] - Fields to override.
 * @returns {object} A valid-shaped atlas.
 */
function atlasWith(mapOrder, extra = {}) {
    return { ...createAtlas('Teste'), mapOrder, ...extra };
}

/**
 * @param {string} version - Dotted version.
 * @returns {number[]} Numeric segments, for ordering comparisons.
 */
function segments(version) {
    return version.split('.').map(Number);
}

// ============================================================================
// ATLAS_SCHEMA_VERSION
// ============================================================================

describe('ATLAS_SCHEMA_VERSION', () => {
    it('e uma string com segmentos NUMERICOS (comparacao por versao, nao lexica)', () => {
        expect(typeof ATLAS_SCHEMA_VERSION).toBe('string');
        const parts = segments(ATLAS_SCHEMA_VERSION);
        expect(parts.length).toBeGreaterThanOrEqual(2);
        for (const part of parts) {
            expect(Number.isFinite(part)).toBe(true);
        }
    });

    it('e exatamente o que createAtlas carimba: a fabrica nao tem versao propria', () => {
        expect(createAtlas().schemaVersion).toBe(ATLAS_SCHEMA_VERSION);
    });

    it('esta ADIANTE do ultimo degrau encadeado (o degrau para 2.2)', () => {
        // If this ever equals the last migration step's TARGET_VERSION, `detectMigrationNeeded`
        // compares equal and the step after it never runs, without an error. Written as an
        // ordering assertion rather than a literal so that raising the constant does not
        // require editing this line.
        const LAST_CHAINED_STEP = '2.2';
        const [maj, min] = segments(ATLAS_SCHEMA_VERSION);
        const [lastMaj, lastMin] = segments(LAST_CHAINED_STEP);
        expect(maj > lastMaj || (maj === lastMaj && min > lastMin)).toBe(true);
    });
});

// ============================================================================
// createAtlas
// ============================================================================

describe('createAtlas', () => {
    it('nasce com os defaults declarados', () => {
        const atlas = createAtlas();
        expect(atlas.name).toBe('Meu Atlas');
        expect(atlas.mapOrder).toEqual([]);
        expect(atlas.lastActiveMapId).toBeNull();
        expect(atlas.settings).toEqual({ terrainExaggeration: DEFAULT_TERRAIN_EXAGGERATION });
        expect(typeof atlas.id).toBe('string');
        expect(atlas.id.length).toBeGreaterThan(0);
    });

    it('gera id NOVO a cada chamada', () => {
        const ids = new Set([createAtlas().id, createAtlas().id, createAtlas().id]);
        expect(ids.size).toBe(3);
    });

    it('cada atlas recebe seu PROPRIO objeto settings e seu proprio mapOrder', () => {
        const a = createAtlas();
        const b = createAtlas();
        expect(a.settings).not.toBe(b.settings);
        expect(a.mapOrder).not.toBe(b.mapOrder);
        a.settings.terrainExaggeration = 3;
        expect(b.settings.terrainExaggeration).toBe(DEFAULT_TERRAIN_EXAGGERATION);
    });

    it('o default do nome vale so para undefined: string vazia sobrevive', () => {
        expect(createAtlas('').name).toBe('');
        expect(createAtlas(undefined).name).toBe('Meu Atlas');
    });

    it('OBSERVADO: createAtlas(null) produz um atlas que isValidAtlas RECUSA', () => {
        // A parameter default fires only on `undefined`, so `null` reaches `name` and the
        // factory hands back an object its own validator rejects. Recorded because the
        // factory is the shape everything else trusts.
        const atlas = createAtlas(null);
        expect(atlas.name).toBeNull();
        expect(isValidAtlas(atlas)).toBe(false);
    });

    it('o produto da fabrica passa no validador (controle positivo)', () => {
        expect(isValidAtlas(createAtlas())).toBe(true);
        expect(isValidAtlas(createAtlas('Operação Sul'))).toBe(true);
    });
});

// ============================================================================
// isValidAtlas
// ============================================================================

describe('isValidAtlas', () => {
    it('recusa nao-objeto sem lancar', () => {
        for (const bad of [null, undefined, 0, '', 'atlas', 42, true, NaN]) {
            expect(isValidAtlas(bad)).toBe(false);
        }
    });

    it('recusa array, porque falta id/name mesmo com typeof object', () => {
        expect(isValidAtlas([])).toBe(false);
    });

    it('recusa quando falta cada campo obrigatorio, um a um', () => {
        // `sync` used to be absent from this list, because its removal produced
        // `undefined` instead of `false`. Since `isValidSyncMetadata` coerces, it belongs.
        const campos = ['id', 'name', 'schemaVersion', 'mapOrder', 'sync'];
        for (const campo of campos) {
            const atlas = createAtlas();
            delete atlas[campo];
            expect(isValidAtlas(atlas), `sem ${campo}`).toBe(false);
        }
        expect(campos).toHaveLength(5);
    });

    it('recusa mapOrder que nao seja array de STRINGS', () => {
        expect(isValidAtlas(atlasWith(['a', 'b']))).toBe(true);
        expect(isValidAtlas(atlasWith(['a', 7]))).toBe(false);
        expect(isValidAtlas(atlasWith(['a', null]))).toBe(false);
        expect(isValidAtlas({ ...createAtlas(), mapOrder: 'a,b' })).toBe(false);
    });

    it('mapOrder VAZIO e valido (atlas recem-criado nao tem mapa)', () => {
        expect(isValidAtlas(atlasWith([]))).toBe(true);
    });

    it('lastActiveMapId aceita null e string, e recusa numero', () => {
        expect(isValidAtlas({ ...createAtlas(), lastActiveMapId: null })).toBe(true);
        expect(isValidAtlas({ ...createAtlas(), lastActiveMapId: 'm1' })).toBe(true);
        expect(isValidAtlas({ ...createAtlas(), lastActiveMapId: 0 })).toBe(false);
        expect(isValidAtlas({ ...createAtlas(), lastActiveMapId: undefined })).toBe(false);
    });

    it('settings AUSENTE e valido, settings null NAO e', () => {
        const semSettings = createAtlas();
        delete semSettings.settings;
        expect(isValidAtlas(semSettings)).toBe(true);

        expect(isValidAtlas({ ...createAtlas(), settings: null })).toBe(false);
        expect(isValidAtlas({ ...createAtlas(), settings: 'nao' })).toBe(false);
        expect(isValidAtlas({ ...createAtlas(), settings: {} })).toBe(true);
    });

    it('sync com FORMA errada reprova o atlas inteiro, e reprova com false', () => {
        expect(isValidAtlas({ ...createAtlas(), sync: {} })).toBe(false);
        expect(isValidAtlas({ ...createAtlas(), sync: { createdAt: 1 } })).toBe(false);
        expect(isValidAtlas({ ...createAtlas(), sync: 'nao' })).toBe(false);
    });

    it('CONTROLE: sync AUSENTE e recusado, e a recusa nunca dependeu do tipo devolvido', () => {
        // The refusal itself always worked: every caller in `frontend/src/js/` reads it as
        // `!isValidAtlas(...)`, and null/undefined are falsy. What was wrong was the
        // declared return TYPE, pinned by the case right below.
        expect(isValidAtlas({ ...createAtlas(), sync: null })).toBeFalsy();
        const semSync = createAtlas();
        delete semSync.sync;
        expect(isValidAtlas(semSync)).toBeFalsy();
    });

    it('DEFEITO CORRIGIDO: sync falsy devolve `false`, nao `null`/`undefined`', () => {
        // Root cause was in `isValidSyncMetadata`
        // (frontend/src/js/store/sync/sync-metadata.js), which opened with
        // `obj && typeof obj === 'object' && ...` and RETURNED the falsy operand instead of
        // coercing; `isValidAtlas` then handed it out through its own `&&` chain. Fixed by
        // wrapping that return in `Boolean(...)`. Low severity in production (the single
        // caller, `store/repositories/local.repository.js`, negates the answer), but any
        // `=== false` or JSON round trip read the leak as "not refused".
        expect(isValidAtlas({ ...createAtlas(), sync: null })).toBe(false);
        const semSync = createAtlas();
        delete semSync.sync;
        expect(isValidAtlas(semSync)).toBe(false);
        expect(isValidAtlas({ ...createAtlas(), sync: 0 })).toBe(false);
        expect(isValidAtlas({ ...createAtlas(), sync: '' })).toBe(false);
    });

    it('schemaVersion e checado como STRING, nunca contra a constante atual', () => {
        // A stale version does NOT make an atlas invalid: it makes it migratable. Pinned
        // because tightening this to `=== ATLAS_SCHEMA_VERSION` would make every atlas
        // read from disk invalid the instant the constant is raised.
        expect(isValidAtlas({ ...createAtlas(), schemaVersion: '1.0' })).toBe(true);
        expect(isValidAtlas({ ...createAtlas(), schemaVersion: 2.3 })).toBe(false);
    });

    it('devolve booleano em TODO caminho, o de sync falsy inclusive', () => {
        // The `!atlas || typeof atlas !== 'object'` early return keeps the non-object
        // cases boolean; the `&&` chain that follows used to leak, and only through
        // `isValidSyncMetadata`, which now coerces.
        expect(isValidAtlas(createAtlas())).toBe(true);
        expect(isValidAtlas(null)).toBe(false);
        expect(typeof isValidAtlas({})).toBe('boolean');
        expect(typeof isValidAtlas({ ...createAtlas(), id: 7 })).toBe('boolean');
        expect(typeof isValidAtlas({ ...createAtlas(), sync: null })).toBe('boolean');
        const semSync = createAtlas();
        delete semSync.sync;
        expect(typeof isValidAtlas(semSync)).toBe('boolean');
    });

    it('campos EXTRAS nao invalidam (o validador nao e exclusivo)', () => {
        expect(isValidAtlas({ ...createAtlas(), campoDesconhecido: { qualquer: 1 } })).toBe(true);
    });
});

// ============================================================================
// addMapToAtlas
// ============================================================================

describe('addMapToAtlas', () => {
    it('sem posicao, acrescenta no FIM', () => {
        expect(addMapToAtlas(atlasWith(['a', 'b']), 'c').mapOrder).toEqual(['a', 'b', 'c']);
    });

    it('posicao 0 insere no inicio, e a posicao === length acrescenta no fim', () => {
        expect(addMapToAtlas(atlasWith(['a', 'b']), 'c', 0).mapOrder).toEqual(['c', 'a', 'b']);
        expect(addMapToAtlas(atlasWith(['a', 'b']), 'c', 2).mapOrder).toEqual(['a', 'b', 'c']);
        expect(addMapToAtlas(atlasWith(['a', 'b']), 'c', 1).mapOrder).toEqual(['a', 'c', 'b']);
    });

    it('posicao FORA da faixa cai no acrescimo ao fim, sem lancar', () => {
        for (const pos of [-1, 3, 99, NaN, Infinity]) {
            expect(addMapToAtlas(atlasWith(['a', 'b']), 'c', pos).mapOrder, `pos=${pos}`)
                .toEqual(['a', 'b', 'c']);
        }
    });

    it('nao muta o atlas de entrada e devolve objeto novo', () => {
        const original = atlasWith(['a']);
        const antes = [...original.mapOrder];
        const novo = addMapToAtlas(original, 'b');
        expect(original.mapOrder).toEqual(antes);
        expect(novo).not.toBe(original);
        expect(novo.mapOrder).not.toBe(original.mapOrder);
    });

    it('a copia e RASA: settings continua COMPARTILHADO com o atlas de entrada', () => {
        const original = atlasWith(['a']);
        const novo = addMapToAtlas(original, 'b');
        expect(novo.settings).toBe(original.settings);
        novo.settings.terrainExaggeration = 3;
        expect(original.settings.terrainExaggeration).toBe(3);
    });

    it('NAO deduplica: acrescentar o mesmo id duas vezes produz repetido', () => {
        const dobrado = addMapToAtlas(addMapToAtlas(atlasWith([]), 'a'), 'a');
        expect(dobrado.mapOrder).toEqual(['a', 'a']);
    });

    it('preserva lastActiveMapId e os demais campos', () => {
        const original = atlasWith(['a'], { lastActiveMapId: 'a', name: 'X' });
        const novo = addMapToAtlas(original, 'b');
        expect(novo.lastActiveMapId).toBe('a');
        expect(novo.name).toBe('X');
        expect(novo.id).toBe(original.id);
    });

    it('acrescentar sempre aumenta o tamanho em UM e preserva o multiconjunto anterior', () => {
        fc.assert(
            fc.property(
                fc.array(fc.string({ minLength: 1, maxLength: 4 }), { maxLength: 8 }),
                fc.string({ minLength: 1, maxLength: 4 }),
                fc.option(fc.integer({ min: -3, max: 12 }), { nil: undefined }),
                (order, id, pos) => {
                    const out = addMapToAtlas(atlasWith(order), id, pos).mapOrder;
                    expect(out).toHaveLength(order.length + 1);
                    const copy = [...out];
                    copy.splice(copy.indexOf(id), 1);
                    expect(copy.sort()).toEqual([...order].sort());
                }
            ),
            { numRuns: 200 }
        );
    });
});

// ============================================================================
// removeMapFromAtlas
// ============================================================================

describe('removeMapFromAtlas', () => {
    it('remove o id e preserva a ordem dos demais', () => {
        expect(removeMapFromAtlas(atlasWith(['a', 'b', 'c']), 'b').mapOrder).toEqual(['a', 'c']);
    });

    it('id ausente e no-op de conteudo, mas devolve objeto NOVO', () => {
        const original = atlasWith(['a', 'b']);
        const novo = removeMapFromAtlas(original, 'z');
        expect(novo.mapOrder).toEqual(['a', 'b']);
        expect(novo).not.toBe(original);
    });

    it('remove TODAS as ocorrencias, porque e filter e nao splice', () => {
        expect(removeMapFromAtlas(atlasWith(['a', 'b', 'a']), 'a').mapOrder).toEqual(['b']);
    });

    it('zera lastActiveMapId quando o removido era o ativo', () => {
        const out = removeMapFromAtlas(atlasWith(['a', 'b'], { lastActiveMapId: 'a' }), 'a');
        expect(out.lastActiveMapId).toBeNull();
    });

    it('preserva lastActiveMapId quando o removido era OUTRO', () => {
        const out = removeMapFromAtlas(atlasWith(['a', 'b'], { lastActiveMapId: 'b' }), 'a');
        expect(out.lastActiveMapId).toBe('b');
    });

    it('remover de um atlas VAZIO nao lanca', () => {
        expect(removeMapFromAtlas(atlasWith([]), 'a').mapOrder).toEqual([]);
    });

    it('nao muta a entrada', () => {
        const original = atlasWith(['a', 'b'], { lastActiveMapId: 'a' });
        removeMapFromAtlas(original, 'a');
        expect(original.mapOrder).toEqual(['a', 'b']);
        expect(original.lastActiveMapId).toBe('a');
    });

    it('add seguido de remove volta ao mapOrder de partida (round-trip)', () => {
        fc.assert(
            fc.property(
                fc.uniqueArray(fc.string({ minLength: 1, maxLength: 4 }), { maxLength: 8 }),
                fc.string({ minLength: 5, maxLength: 8 }),
                (order, novoId) => {
                    fc.pre(!order.includes(novoId));
                    const atlas = atlasWith(order);
                    const ida = addMapToAtlas(atlas, novoId);
                    const volta = removeMapFromAtlas(ida, novoId);
                    expect(volta.mapOrder).toEqual(order);
                }
            ),
            { numRuns: 200 }
        );
    });
});

// ============================================================================
// reorderAtlasMaps
// ============================================================================

describe('reorderAtlasMaps', () => {
    it('aceita uma permutacao legitima', () => {
        expect(reorderAtlasMaps(atlasWith(['a', 'b', 'c']), ['c', 'a', 'b']).mapOrder)
            .toEqual(['c', 'a', 'b']);
    });

    it('recusa tamanho diferente, id estranho e lista vazia de atlas nao vazio', () => {
        const atlas = atlasWith(['a', 'b']);
        expect(() => reorderAtlasMaps(atlas, ['a'])).toThrow('exactly the same map IDs');
        expect(() => reorderAtlasMaps(atlas, ['a', 'b', 'c'])).toThrow('exactly the same map IDs');
        expect(() => reorderAtlasMaps(atlas, ['a', 'z'])).toThrow('exactly the same map IDs');
        expect(() => reorderAtlasMaps(atlas, [])).toThrow('exactly the same map IDs');
    });

    it('atlas VAZIO com nova ordem vazia e um no-op aceito', () => {
        expect(reorderAtlasMaps(atlasWith([]), []).mapOrder).toEqual([]);
    });

    it('nao muta a entrada e devolve objeto novo', () => {
        const original = atlasWith(['a', 'b']);
        const novo = reorderAtlasMaps(original, ['b', 'a']);
        expect(original.mapOrder).toEqual(['a', 'b']);
        expect(novo).not.toBe(original);
    });

    it('OBSERVADO: ADOTA o array recebido por REFERENCIA, entao o chamador pode mutar depois', () => {
        const novaOrdem = ['b', 'a'];
        const out = reorderAtlasMaps(atlasWith(['a', 'b']), novaOrdem);
        expect(out.mapOrder).toBe(novaOrdem);
        novaOrdem.push('intruso');
        expect(out.mapOrder).toEqual(['b', 'a', 'intruso']);
    });

    it('OBSERVADO: [A, A] passa na guarda e DROPA B em silencio', () => {
        // The guard is `newOrder.length === currentSet.size && newOrder.every(id => set.has(id))`.
        // For mapOrder ['a','b'] the set has size 2, so ['a','a'] satisfies BOTH halves and
        // the reorder is accepted: 'b' disappears from the atlas without an error, and a
        // map that still exists in the maps store becomes unreachable from the atlas.
        // A `new Set(newOrder).size === newOrder.length` check would close it.
        const out = reorderAtlasMaps(atlasWith(['a', 'b']), ['a', 'a']);
        expect(out.mapOrder).toEqual(['a', 'a']);
        expect(out.mapOrder).not.toContain('b');
    });

    it('OBSERVADO: um atlas que JA tem repetido nao consegue ser reordenado sem perda', () => {
        // The current set collapses ['a','a'] to size 1, so the only accepted new order is
        // one element long: reordering an already-duplicated atlas necessarily shortens it.
        const atlas = atlasWith(['a', 'a']);
        expect(() => reorderAtlasMaps(atlas, ['a', 'a'])).toThrow('exactly the same map IDs');
        expect(reorderAtlasMaps(atlas, ['a']).mapOrder).toEqual(['a']);
    });

    it('CONTROLE: a guarda de fato REPROVA um id estranho do mesmo tamanho', () => {
        // Ensures the two OBSERVADO cases above are about duplication, not about a guard
        // that never refuses anything.
        expect(() => reorderAtlasMaps(atlasWith(['a', 'b']), ['a', 'x'])).toThrow();
    });

    it('toda permutacao SEM repetido preserva o multiconjunto de ids', () => {
        fc.assert(
            fc.property(
                fc.uniqueArray(fc.string({ minLength: 1, maxLength: 5 }), {
                    minLength: 1,
                    maxLength: 8,
                }),
                (ids) => {
                    const shuffled = [...ids].reverse();
                    const out = reorderAtlasMaps(atlasWith(ids), shuffled);
                    expect([...out.mapOrder].sort()).toEqual([...ids].sort());
                    expect(out.mapOrder).toHaveLength(ids.length);
                }
            ),
            { numRuns: 200 }
        );
    });
});

// ============================================================================
// getAtlasTerrainExaggeration
// ============================================================================

describe('getAtlasTerrainExaggeration', () => {
    it('devolve o valor configurado', () => {
        expect(getAtlasTerrainExaggeration({ settings: { terrainExaggeration: 2.5 } })).toBe(2.5);
    });

    it('CONTROLE DO ZERO: exagero 0 SOBREVIVE, porque o operador e `??` e nao `||`', () => {
        // The whole point of this test: `atlas?.settings?.terrainExaggeration || 1.5` would
        // silently turn "flat terrain" into 1.5x. `??` only falls back on null/undefined.
        expect(getAtlasTerrainExaggeration({ settings: { terrainExaggeration: 0 } })).toBe(0);
        expect(getAtlasTerrainExaggeration({ settings: { terrainExaggeration: -0 } })).toBe(-0);
    });

    it('cai no default para null, undefined, settings ausente e atlas ausente', () => {
        expect(getAtlasTerrainExaggeration(null)).toBe(DEFAULT_TERRAIN_EXAGGERATION);
        expect(getAtlasTerrainExaggeration(undefined)).toBe(DEFAULT_TERRAIN_EXAGGERATION);
        expect(getAtlasTerrainExaggeration({})).toBe(DEFAULT_TERRAIN_EXAGGERATION);
        expect(getAtlasTerrainExaggeration({ settings: {} })).toBe(DEFAULT_TERRAIN_EXAGGERATION);
        expect(getAtlasTerrainExaggeration({ settings: null })).toBe(DEFAULT_TERRAIN_EXAGGERATION);
        expect(getAtlasTerrainExaggeration({ settings: { terrainExaggeration: null } }))
            .toBe(DEFAULT_TERRAIN_EXAGGERATION);
        expect(getAtlasTerrainExaggeration({ settings: { terrainExaggeration: undefined } }))
            .toBe(DEFAULT_TERRAIN_EXAGGERATION);
    });

    it('OBSERVADO: `??` NAO protege NaN nem tipo errado, e os dois passam adiante', () => {
        // `x ?? d` does not guard NaN; the caller receives NaN and hands it to the terrain
        // exaggeration, where it becomes a silent no-op rather than the default.
        expect(getAtlasTerrainExaggeration({ settings: { terrainExaggeration: NaN } })).toBeNaN();
        expect(getAtlasTerrainExaggeration({ settings: { terrainExaggeration: Infinity } }))
            .toBe(Infinity);
        expect(getAtlasTerrainExaggeration({ settings: { terrainExaggeration: false } }))
            .toBe(false);
        expect(getAtlasTerrainExaggeration({ settings: { terrainExaggeration: '2' } })).toBe('2');
    });

    it('nao lanca para entrada nao-objeto (optional chaining ate o fim)', () => {
        for (const bad of [0, '', 'x', true, NaN]) {
            expect(() => getAtlasTerrainExaggeration(bad)).not.toThrow();
            expect(getAtlasTerrainExaggeration(bad)).toBe(DEFAULT_TERRAIN_EXAGGERATION);
        }
    });

    it('o atlas da fabrica devolve o default, e o default e finito e positivo', () => {
        expect(getAtlasTerrainExaggeration(createAtlas())).toBe(DEFAULT_TERRAIN_EXAGGERATION);
        expect(Number.isFinite(DEFAULT_TERRAIN_EXAGGERATION)).toBe(true);
        expect(DEFAULT_TERRAIN_EXAGGERATION).toBeGreaterThan(0);
    });

    it('todo numero finito atravessa sem transformacao (invariante de identidade)', () => {
        fc.assert(
            fc.property(fc.double({ min: -10, max: 10, noNaN: true }), (v) => {
                expect(getAtlasTerrainExaggeration({ settings: { terrainExaggeration: v } }))
                    .toBe(v);
            }),
            { numRuns: 300 }
        );
    });
});
