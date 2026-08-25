// Path: tests/unit/processing-registry.test.js

/**
 * @fileoverview Pins `frontend/src/js/processing/processing.constants.js`: the algorithm
 * registry (`registerAlgorithm`, `getAlgorithm`, `getAllAlgorithms`) and the ring helper
 * `extractBaseCoordinates`.
 *
 * WHAT THIS SUITE PINS
 * - `registerAlgorithm` imposes EXACTLY two things: a truthy `id`, and uniqueness of that
 *   id. Every other field of the definition is optional at registration time and missing
 *   in silence; the symptom only reaches the screen that reads the field. The suite
 *   asserts that a one-field definition registers cleanly, so nobody "fixes" the absence
 *   of validation without noticing it is the declared contract.
 * - `category` has NO reader in `frontend/src/js/processing/`. That is asserted
 *   STRUCTURALLY (a scan of the folder), not by prose, because a reader appearing later is
 *   exactly what would make the constitution's note stale.
 * - `Object.freeze` on the stored definition is SHALLOW, and the registry is a `Map`, so a
 *   prototype key (`__proto__`, `toString`) is a miss instead of a stray function.
 * - `extractBaseCoordinates` returns its INPUT BY REFERENCE when nothing is stripped, and
 *   detects closure with `===` on the first two components.
 *
 * WHAT IT DOES NOT REACH
 * - `PROCESSING_ICONS`, `POLYGON_DEFAULTS` and `SUPPORTED_GEOMETRY_TYPES` are frozen data
 *   with no logic; only their frozen-ness is checked, not their contents (a content
 *   assertion here would be a second copy of the same literal).
 * - The panel wiring of any algorithm (DOM) is out of the `node` environment.
 * - Whether an algorithm's `execute` is CORRECT: see `processing-buffer.test.js` and
 *   `processing-voronoi.test.js`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_PROCESSING = fileURLToPath(
    new URL('../../src/js/processing/', import.meta.url)
);

/**
 * Fresh module graph per test, so the module-level `ALGORITHM_REGISTRY` singleton starts
 * empty. Without this, a duplicate-id test would depend on the order of the file.
 * @returns {Promise<object>} The re-imported module namespace.
 */
async function freshModule() {
    vi.resetModules();
    return import('../../src/js/processing/processing.constants.js');
}

// ============================================================================
// registerAlgorithm — what it imposes
// ============================================================================

describe('registerAlgorithm: o que ele IMPOE', () => {
    /** @type {any} */
    let mod;
    beforeEach(async () => {
        mod = await freshModule();
    });

    it('registra e devolve a definicao pelo id (controle positivo)', () => {
        const def = { id: 'alfa', name: 'Alfa' };
        mod.registerAlgorithm(def);
        expect(mod.getAlgorithm('alfa')).toBeDefined();
        expect(mod.getAlgorithm('alfa').name).toBe('Alfa');
    });

    it('recusa definicao nula/indefinida sem estourar no acesso a propriedade', () => {
        expect(() => mod.registerAlgorithm(null)).toThrow('Algoritmo deve ter um id');
        expect(() => mod.registerAlgorithm(undefined)).toThrow('Algoritmo deve ter um id');
        expect(() => mod.registerAlgorithm({})).toThrow('Algoritmo deve ter um id');
    });

    it('o teste do id e por VERACIDADE, entao string vazia e o numero 0 sao recusados', () => {
        // `!definition?.id` is a truthiness test, not a presence test. An id of `0` is a
        // legitimate Map key and is nevertheless refused; that is the observed contract.
        expect(() => mod.registerAlgorithm({ id: '' })).toThrow('Algoritmo deve ter um id');
        expect(() => mod.registerAlgorithm({ id: 0 })).toThrow('Algoritmo deve ter um id');
        expect(() => mod.registerAlgorithm({ id: false })).toThrow('Algoritmo deve ter um id');
        expect(() => mod.registerAlgorithm({ id: null })).toThrow('Algoritmo deve ter um id');
    });

    it('recusa id duplicado NOMEANDO o id na mensagem', () => {
        mod.registerAlgorithm({ id: 'buffer' });
        expect(() => mod.registerAlgorithm({ id: 'buffer' }))
            .toThrow('Algoritmo "buffer" já registrado');
        // The refusal did not replace the first registration.
        expect(mod.getAllAlgorithms()).toHaveLength(1);
    });

    it('a recusa por duplicidade e por IDENTIDADE de id, nao por igualdade de definicao', () => {
        mod.registerAlgorithm({ id: 'x', name: 'primeiro' });
        expect(() => mod.registerAlgorithm({ id: 'x', name: 'segundo' })).toThrow();
        expect(mod.getAlgorithm('x').name).toBe('primeiro');
    });
});

// ============================================================================
// registerAlgorithm — what it lets through in silence
// ============================================================================

describe('registerAlgorithm: o que ele DEIXA PASSAR em silencio', () => {
    /** @type {any} */
    let mod;
    beforeEach(async () => {
        mod = await freshModule();
    });

    it('uma definicao com SO o id registra sem reclamar, e os campos faltam calados', () => {
        // This is the declared behaviour, not a defect: the symptom of a missing field
        // appears only on the screen that consumes it (the tab card reads `name`,
        // `description` and `icon`; the executor reads `supportedGeometryTypes` and
        // `execute`; the panel reads `createPanel`).
        expect(() => mod.registerAlgorithm({ id: 'so-id' })).not.toThrow();

        const stored = mod.getAlgorithm('so-id');
        expect(stored).toBeDefined();
        expect(stored.name).toBeUndefined();
        expect(stored.description).toBeUndefined();
        expect(stored.icon).toBeUndefined();
        expect(stored.execute).toBeUndefined();
        expect(stored.createPanel).toBeUndefined();
        expect(stored.supportedGeometryTypes).toBeUndefined();
    });

    it('nao valida o TIPO de campo nenhum: execute string e supportedGeometryTypes numero passam', () => {
        expect(() => mod.registerAlgorithm({
            id: 'tipos-errados',
            execute: 'nao sou funcao',
            supportedGeometryTypes: 42,
            createPanel: null,
        })).not.toThrow();

        const stored = mod.getAlgorithm('tipos-errados');
        expect(typeof stored.execute).toBe('string');
        expect(stored.supportedGeometryTypes).toBe(42);
    });
});

// ============================================================================
// `category` has no reader — structural guard
// ============================================================================

/**
 * Recursively lists the `.js` files under a directory.
 * @param {string} dir - Absolute directory path.
 * @returns {string[]} Absolute file paths.
 */
function listJsFiles(dir) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...listJsFiles(full));
        else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

describe('o campo `category` nao tem leitor (guarda estrutural)', () => {
    it('toda mencao a `category` sob src/js/processing/ e ESCRITA ou JSDoc, nunca leitura', () => {
        const files = listJsFiles(SRC_PROCESSING);
        // Cobertura vazia passa verde: if the scan found no files, the loop below would
        // assert nothing at all.
        expect(files.length).toBeGreaterThan(3);

        /** @type {string[]} */
        const reads = [];
        let mentions = 0;

        for (const file of files) {
            const lines = readFileSync(file, 'utf8').split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (!line.includes('category')) continue;
                mentions += 1;
                const isJsDoc = /^\s*\*/.test(line);
                const isWrite = /^\s*category\s*:/.test(line);
                if (!isJsDoc && !isWrite) {
                    reads.push(`${file.slice(SRC_PROCESSING.length)}:${i + 1}: ${line.trim()}`);
                }
            }
        }

        // The scan itself has to be shown to be looking at something.
        expect(mentions).toBeGreaterThan(0);
        expect(reads).toEqual([]);
    });
});

// ============================================================================
// Storage semantics: freeze depth and Map-vs-object keys
// ============================================================================

describe('semantica de armazenamento do registro', () => {
    /** @type {any} */
    let mod;
    beforeEach(async () => {
        mod = await freshModule();
    });

    it('a definicao guardada e congelada: escrever numa propriedade de topo LANCA (modulo ESM e strict)', () => {
        mod.registerAlgorithm({ id: 'frio', name: 'Frio' });
        const stored = mod.getAlgorithm('frio');
        expect(Object.isFrozen(stored)).toBe(true);
        expect(() => { stored.name = 'Quente'; }).toThrow(TypeError);
        expect(mod.getAlgorithm('frio').name).toBe('Frio');
    });

    it('o congelamento e RASO: um objeto aninhado da definicao continua mutavel', () => {
        const def = { id: 'raso', meta: { contagem: 1 } };
        mod.registerAlgorithm(def);
        const stored = mod.getAlgorithm('raso');
        stored.meta.contagem = 99;
        expect(mod.getAlgorithm('raso').meta.contagem).toBe(99);
        // And the caller's own object is the very one that was frozen.
        expect(Object.isFrozen(def)).toBe(true);
    });

    it('o registro e um Map, entao chave de prototipo e MISS e nao funcao herdada', () => {
        // A plain-object registry would answer `getAlgorithm('toString')` with a function.
        expect(mod.getAlgorithm('__proto__')).toBeUndefined();
        expect(mod.getAlgorithm('toString')).toBeUndefined();
        expect(mod.getAlgorithm('constructor')).toBeUndefined();
        expect(mod.getAlgorithm('hasOwnProperty')).toBeUndefined();
    });

    it('`__proto__` e um id REGISTRAVEL e recuperavel, o que so vale por ser Map', () => {
        mod.registerAlgorithm({ id: '__proto__', name: 'patologico' });
        expect(mod.getAlgorithm('__proto__').name).toBe('patologico');
        expect(mod.getAllAlgorithms()).toHaveLength(1);
    });

    it('getAlgorithm de id ausente/nao-string devolve undefined sem lancar', () => {
        expect(mod.getAlgorithm('inexistente')).toBeUndefined();
        expect(mod.getAlgorithm(undefined)).toBeUndefined();
        expect(mod.getAlgorithm(null)).toBeUndefined();
        expect(mod.getAlgorithm(0)).toBeUndefined();
    });
});

// ============================================================================
// getAllAlgorithms
// ============================================================================

describe('getAllAlgorithms', () => {
    /** @type {any} */
    let mod;
    beforeEach(async () => {
        mod = await freshModule();
    });

    it('devolve [] no registro vazio', () => {
        expect(mod.getAllAlgorithms()).toEqual([]);
    });

    it('e um INSTANTANEO: mutar o array devolvido nao altera o registro', () => {
        mod.registerAlgorithm({ id: 'a' });
        const first = mod.getAllAlgorithms();
        first.push({ id: 'intruso' });
        first.length = 0;

        const second = mod.getAllAlgorithms();
        expect(second).toHaveLength(1);
        expect(second[0].id).toBe('a');
        // A new array object each call, never the internal one.
        expect(mod.getAllAlgorithms()).not.toBe(second);
    });

    it('preserva a ordem de REGISTRO, nao a ordem alfabetica', () => {
        mod.registerAlgorithm({ id: 'zulu' });
        mod.registerAlgorithm({ id: 'alfa' });
        mod.registerAlgorithm({ id: 'mike' });
        expect(mod.getAllAlgorithms().map(d => d.id)).toEqual(['zulu', 'alfa', 'mike']);
    });

    it('o registro e um SINGLETON de modulo: dois imports do mesmo grafo veem o mesmo estado', async () => {
        mod.registerAlgorithm({ id: 'compartilhado' });
        const again = await import('../../src/js/processing/processing.constants.js');
        expect(again.getAllAlgorithms().map(d => d.id)).toEqual(['compartilhado']);
        expect(again.getAlgorithm('compartilhado')).toBe(mod.getAlgorithm('compartilhado'));
    });
});

// ============================================================================
// Frozen shared constants
// ============================================================================

describe('constantes compartilhadas', () => {
    /** @type {any} */
    let mod;
    beforeEach(async () => {
        mod = await freshModule();
    });

    it('POLYGON_DEFAULTS, SUPPORTED_GEOMETRY_TYPES e PROCESSING_ICONS sao congelados', () => {
        expect(Object.isFrozen(mod.POLYGON_DEFAULTS)).toBe(true);
        expect(Object.isFrozen(mod.SUPPORTED_GEOMETRY_TYPES)).toBe(true);
        expect(Object.isFrozen(mod.PROCESSING_ICONS)).toBe(true);
        expect(() => mod.SUPPORTED_GEOMETRY_TYPES.push('novo')).toThrow(TypeError);
    });

    it('SUPPORTED_GEOMETRY_TYPES nao tem repetido e traz os tres tipos basicos', () => {
        const list = mod.SUPPORTED_GEOMETRY_TYPES;
        expect(list.length).toBeGreaterThan(0);
        expect(new Set(list).size).toBe(list.length);
        expect(list).toContain('point');
        expect(list).toContain('line');
        expect(list).toContain('polygon');
    });

    it('POLYGON_DEFAULTS traz opacidade e largura como NUMEROS finitos', () => {
        expect(Number.isFinite(mod.POLYGON_DEFAULTS.opacity)).toBe(true);
        expect(Number.isFinite(mod.POLYGON_DEFAULTS.lineWidth)).toBe(true);
        expect(Number.isFinite(mod.POLYGON_DEFAULTS.hatchSpacing)).toBe(true);
    });
});

// ============================================================================
// extractBaseCoordinates
// ============================================================================

describe('extractBaseCoordinates', () => {
    /** @type {(c: any) => any} */
    let extract;
    beforeEach(async () => {
        ({ extractBaseCoordinates: extract } = await freshModule());
    });

    it('remove o vertice de fechamento de um anel fechado', () => {
        const ring = [[0, 0], [1, 0], [1, 1], [0, 0]];
        expect(extract(ring)).toEqual([[0, 0], [1, 0], [1, 1]]);
    });

    it('devolve o anel ABERTO pela MESMA referencia (nao copia)', () => {
        const ring = [[0, 0], [1, 0], [1, 1]];
        expect(extract(ring)).toBe(ring);
    });

    it('nao muta a entrada quando corta', () => {
        const ring = [[0, 0], [1, 0], [0, 0]];
        const before = JSON.stringify(ring);
        extract(ring);
        expect(JSON.stringify(ring)).toBe(before);
    });

    it('null e undefined atravessam inalterados (sem lancar)', () => {
        expect(extract(null)).toBeNull();
        expect(extract(undefined)).toBeUndefined();
    });

    it('vazio e um-elemento atravessam inalterados (guarda length <= 1)', () => {
        const vazio = [];
        const um = [[5, 5]];
        expect(extract(vazio)).toBe(vazio);
        expect(extract(um)).toBe(um);
    });

    it('dois pontos iguais sao um anel "fechado" e viram UM ponto', () => {
        expect(extract([[2, 3], [2, 3]])).toEqual([[2, 3]]);
    });

    it('so as DUAS primeiras componentes decidem: a altitude do vertice de fechamento e ignorada', () => {
        // [lng, lat, z]: the z differs and the ring is still treated as closed.
        expect(extract([[0, 0, 10], [1, 1, 0], [0, 0, 99]])).toEqual([[0, 0, 10], [1, 1, 0]]);
    });

    it('-0 fecha contra 0, porque a comparacao e `===` e nao Object.is', () => {
        expect(extract([[0, 0], [1, 1], [-0, -0]])).toEqual([[0, 0], [1, 1]]);
    });

    it('OBSERVADO: um anel fechado em NaN NAO e detectado, e o vertice de fechamento fica', () => {
        // `NaN === NaN` is false, so the closing test fails and the duplicate survives.
        // Not a defect of this function so much as a consequence of `===`; recorded so
        // that a future `Object.is` (which WOULD match NaN) is a deliberate change.
        const ring = [[NaN, 0], [1, 1], [NaN, 0]];
        expect(extract(ring)).toBe(ring);
        expect(extract(ring)).toHaveLength(3);
    });

    it('OBSERVADO: coordenada com MENOS de duas componentes fecha por undefined === undefined', () => {
        // [1] vs [1]: first[0] === last[0] and first[1] === last[1] are BOTH undefined,
        // so a malformed ring is "closed" and loses a vertex. Garbage in, but the shape
        // of the failure (silent shortening) is worth having pinned.
        expect(extract([[1], [2], [1]])).toEqual([[1], [2]]);
        expect(extract([[], [7, 7], []])).toEqual([[], [7, 7]]);
    });

    it('OBSERVADO: NAO e idempotente quando o anel repete o vertice de fechamento', () => {
        // The backlog suggests "idempotente" as an invariant. It holds for a ring with a
        // single closing vertex, and fails for a doubled one: each pass strips one more.
        const doubled = [[0, 0], [1, 0], [1, 1], [0, 0], [0, 0]];
        const once = extract(doubled);
        expect(once).toEqual([[0, 0], [1, 0], [1, 1], [0, 0]]);
        const twice = extract(once);
        expect(twice).toEqual([[0, 0], [1, 0], [1, 1]]);
        expect(twice).not.toEqual(once);
    });

    it('e idempotente para o anel de fechamento SIMPLES (a metade que vale)', () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.tuple(
                        fc.double({ min: -180, max: 180, noNaN: true }),
                        fc.double({ min: -90, max: 90, noNaN: true })
                    ),
                    { minLength: 2, maxLength: 12 }
                ),
                (open) => {
                    // Build a properly closed ring whose second-to-last point differs from
                    // the first, which is the shape the algorithms actually emit.
                    fc.pre(open[open.length - 1][0] !== open[0][0]
                        || open[open.length - 1][1] !== open[0][1]);
                    const closed = [...open, [open[0][0], open[0][1]]];
                    const once = extract(closed);
                    expect(once).toHaveLength(open.length);
                    expect(extract(once)).toBe(once);
                }
            ),
            { numRuns: 200 }
        );
    });

    it('nunca cresce e corta no MAXIMO um vertice (invariante de tamanho)', () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.tuple(
                        fc.integer({ min: -3, max: 3 }),
                        fc.integer({ min: -3, max: 3 })
                    ),
                    { minLength: 0, maxLength: 10 }
                ),
                (coords) => {
                    const out = extract(coords);
                    expect(out.length).toBeGreaterThanOrEqual(Math.max(0, coords.length - 1));
                    expect(out.length).toBeLessThanOrEqual(coords.length);
                }
            ),
            { numRuns: 300 }
        );
    });
});
