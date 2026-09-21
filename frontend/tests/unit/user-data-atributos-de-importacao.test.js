// Path: tests/unit/user-data-atributos-de-importacao.test.js

/**
 * @fileoverview Pins the two pure surfaces of `user_data/user_data_manager.js`:
 * `validateAttributeKey` (what the user may name a custom attribute) and
 * `extractAttributesFromImport` (what an imported GeoJSON row is allowed to
 * become).
 *
 * What this suite HOLDS:
 * - the boundary of the 50-character limit, applied AFTER trimming;
 * - the reserved-name check, case-INSENSITIVE on both sides: it used to
 *   lowercase the key and look it up in a set storing several names in camelCase,
 *   so `outlineColor` was refused while `fillColor` and `layerId` sailed through.
 *   The index is derived from the set, so the two cannot drift again;
 * - the import path, case-INSENSITIVE TOO since 2026-09-21 (achado I8 da auditoria
 *   do sistema temporal). Five cases in this file used to be marked OBSERVADO and
 *   pinned the opposite: the import walk compared with `SYSTEM_PROPERTIES.has(key)`
 *   while the manual path compared against the derived lowercase index, so the
 *   same word was reserved on one path and a plain attribute on the other. That
 *   divergence was declared "safe" because it only ever let the import KEEP what
 *   the manual path refused — but the keeping is the damage when the other owner
 *   of the name is the temporal reader: a column spelled `Begin` or `INICIO`
 *   became the validity window AND stayed on the feature as a duplicate user
 *   attribute the person could edit with no effect on the timeline. The two paths
 *   now agree, and the `attributes` collision branch was lowercased with them so a
 *   scalar named `Attributes` is renamed rather than swallowed by the new skip;
 * - what STILL diverges, and it is no longer about case: the import walk accepts
 *   a key whose CHARACTERS `validateAttributeKey` refuses (`a.b`), so an imported
 *   attribute can be one no user could have typed;
 * - the import value rules: `0` and `false` survive (as strings), `null` and
 *   `undefined` are dropped, nested objects are dropped, and a scalar property
 *   literally named `attributes` is renamed rather than lost;
 * - that every value that reaches the attribute map went through the HTML
 *   sanitiser, including the extracted description.
 *
 * What it does NOT reach: everything that needs the store or the DOM (the
 * add/rename/delete operations, image handling, the real `sanitizeHtml`, which
 * uses DOMParser). The environment here is node, and those are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

const sanitizeHtml = vi.fn((s) => `[san]${s}`);

vi.mock('@store', () => ({
    getMapData: vi.fn(),
    updateFeature: vi.fn(),
    getCurrentMapNameSync: vi.fn(),
    getStorageTypeFromSource: vi.fn(),
    getEventBus: vi.fn(() => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn() })),
}));

vi.mock('@utils', () => ({
    IDUtils: { generateUniqueId: () => 'id-fixo' },
}));

vi.mock('@sidebar/panels/notes-panel.js', () => ({
    sanitizeHtml: (...a) => sanitizeHtml(...a),
}));

const userDataManager = (await import('../../src/js/user_data/user_data_manager.js')).default;

beforeEach(() => {
    vi.clearAllMocks();
    sanitizeHtml.mockImplementation((s) => `[san]${s}`);
});

const extract = (props) => userDataManager.extractAttributesFromImport(props);
const validate = (key) => userDataManager.validateAttributeKey(key);

// ============================================================================
// validateAttributeKey — emptiness and length
// ============================================================================

describe('validateAttributeKey — emptiness and type', () => {
    it('refuses nullish and non-string keys with the same reason', () => {
        for (const bad of [null, undefined, 0, false, 42, {}, []]) {
            const out = validate(bad);
            expect(out.valid).toBe(false);
        }
        expect(validate(null).reason).toBe('Chave vazia ou inválida');
        expect(validate(42).reason).toBe('Chave vazia ou inválida');
    });

    it('refuses the empty string as "vazia ou inválida", not as "vazia"', () => {
        // '' is falsy, so it never reaches the trim branch.
        expect(validate('')).toEqual({ valid: false, reason: 'Chave vazia ou inválida' });
    });

    it('refuses a whitespace-only key with the OTHER reason', () => {
        expect(validate('   ')).toEqual({ valid: false, reason: 'Chave vazia' });
        expect(validate('\t\n')).toEqual({ valid: false, reason: 'Chave vazia' });
    });

    it('accepts a one-character key', () => {
        expect(validate('a')).toEqual({ valid: true });
    });
});

describe('validateAttributeKey — the 50-character boundary', () => {
    it('accepts exactly 50 characters and refuses 51', () => {
        expect(validate('a'.repeat(50))).toEqual({ valid: true });
        expect(validate('a'.repeat(51)))
            .toEqual({ valid: false, reason: 'Chave muito longa (máximo 50 caracteres)' });
    });

    it('measures the TRIMMED key, so surrounding spaces are free', () => {
        expect(validate(`  ${'a'.repeat(50)}  `)).toEqual({ valid: true });
    });

    it('counts UTF-16 units, so an accented letter still costs one', () => {
        expect(validate('á'.repeat(50)).valid).toBe(true);
        expect(validate('á'.repeat(51)).valid).toBe(false);
    });
});

// ============================================================================
// validateAttributeKey — the reserved list and its casing hole
// ============================================================================

describe('validateAttributeKey — reserved system properties', () => {
    it('refuses the lowercase core identifiers', () => {
        for (const key of ['id', 'nome', 'name', 'source']) {
            expect(validate(key)).toEqual({ valid: false, reason: 'Chave reservada pelo sistema' });
        }
    });

    it('refuses them in ANY casing, because the key is lowercased first', () => {
        expect(validate('ID').reason).toBe('Chave reservada pelo sistema');
        expect(validate('Nome').reason).toBe('Chave reservada pelo sistema');
        expect(validate('  SOURCE  ').reason).toBe('Chave reservada pelo sistema');
    });

    it('refuses the accented description variant', () => {
        expect(validate('descrição').reason).toBe('Chave reservada pelo sistema');
        expect(validate('Descrição').reason).toBe('Chave reservada pelo sistema');
    });

    it('CONTROLE: a lowercase-spelled reserved name IS caught, so the check is live', () => {
        // 'outlinecolor' is stored lowercase in the set, so it is found.
        expect(validate('outlinecolor').reason).toBe('Chave reservada pelo sistema');
        expect(validate('outlineColor').reason).toBe('Chave reservada pelo sistema');
    });

    it('CONSERTADO: a camelCase reserved name no longer leaks through', () => {
        // The lookup was `SYSTEM_PROPERTIES.has(trimmed.toLowerCase())`, but the
        // set stores 'fillColor', 'layerId', 'groupId', 'fontSize'... in
        // camelCase. Lowercasing the key guaranteed the miss, so the user could
        // create a custom attribute that shadowed a real visual property.
        for (const name of ['fillColor', 'fillcolor', 'FILLCOLOR', 'layerId', 'groupId', 'fontSize']) {
            expect(validate(name), name)
                .toEqual({ valid: false, reason: 'Chave reservada pelo sistema' });
        }
    });

    it('CONSERTADO: EVERY name of the system list is refused, in any casing', () => {
        const system = userDataManager.getSystemProperties();
        expect(system.size).toBeGreaterThan(20);
        for (const name of system) {
            // Underscore-prefixed internals are refused by the character rule
            // rather than this one, so only the reason is allowed to differ.
            expect(validate(name).valid, name).toBe(false);
            expect(validate(name.toUpperCase()).valid, name).toBe(false);
        }
    });

    it('CONTROLE: a name that is NOT in the list stays free', () => {
        // Without this the fix would be indistinguishable from refusing
        // everything.
        expect(validate('minha cota')).toEqual({ valid: true });
        expect(validate('fillColorido')).toEqual({ valid: true });
        expect(validate('cor')).toEqual({ valid: true });
    });

    it('getSystemProperties returns a COPY, so a caller cannot widen the list', () => {
        const first = userDataManager.getSystemProperties();
        first.add('inventada');
        expect(userDataManager.getSystemProperties().has('inventada')).toBe(false);
        expect(validate('inventada')).toEqual({ valid: true });
    });
});

// ============================================================================
// validateAttributeKey — the character allowlist
// ============================================================================

describe('validateAttributeKey — allowed characters', () => {
    it('accepts letters, digits, underscore, hyphen and space', () => {
        expect(validate('Alvo_1 - fase 2')).toEqual({ valid: true });
    });

    it('accepts accented and non-Latin letters (the regex is unicode-aware)', () => {
        expect(validate('Situação')).toEqual({ valid: true });
        expect(validate('Ситуация')).toEqual({ valid: true });
        expect(validate('状況')).toEqual({ valid: true });
    });

    it('refuses punctuation and symbols', () => {
        for (const key of ['a.b', 'a/b', 'a@b', 'a:b', 'a,b', 'a#b', 'a(b)', 'a"b']) {
            expect(validate(key))
                .toEqual({ valid: false, reason: 'Chave contém caracteres inválidos' });
        }
    });

    it('refuses an emoji, which is neither letter nor number', () => {
        expect(validate('alvo 🎯').valid).toBe(false);
    });

    it('a valid key round-trips through trim without changing meaning', () => {
        fc.assert(
            fc.property(
                fc.stringMatching(/^[a-zA-Z0-9_-]{1,40}$/),
                (key) => {
                    fc.pre(!userDataManager.getSystemProperties().has(key.toLowerCase()));
                    expect(validate(key).valid).toBe(true);
                    expect(validate(`  ${key}  `).valid).toBe(true);
                }
            ),
            { numRuns: 200 }
        );
    });
});

// ============================================================================
// extractAttributesFromImport — the guards
// ============================================================================

describe('extractAttributesFromImport — non-object input', () => {
    it('returns the empty shape for nullish and scalar input', () => {
        for (const bad of [null, undefined, 'texto', 42, true]) {
            expect(extract(bad)).toEqual({ attributes: {}, descricao: '' });
        }
    });

    it('an empty object yields the empty shape', () => {
        expect(extract({})).toEqual({ attributes: {}, descricao: '' });
    });

    it('OBSERVADO: an ARRAY is an object, so it is walked by index', () => {
        expect(extract(['a', 'b'])).toEqual({
            attributes: { 0: '[san]a', 1: '[san]b' },
            descricao: '',
        });
    });
});

// ============================================================================
// extractAttributesFromImport — description extraction
// ============================================================================

describe('extractAttributesFromImport — the description', () => {
    it('recognises the four spellings, case-insensitively', () => {
        for (const key of ['descricao', 'descrição', 'description', 'desc',
            'DESCRICAO', 'Description', 'DESC']) {
            const out = extract({ [key]: 'texto' });
            expect(out.descricao).toBe('[san]texto');
            expect(out.attributes).toEqual({});
        }
    });

    it('the FIRST non-empty description wins, and the rest are dropped', () => {
        const out = extract({ desc: 'primeiro', descricao: 'segundo' });
        expect(out.descricao).toBe('[san]primeiro');
        expect(out.attributes).toEqual({});
    });

    it('an empty or nullish description does not consume the slot', () => {
        const out = extract({ desc: '', descricao: null, description: 'terceiro' });
        expect(out.descricao).toBe('[san]terceiro');
    });

    it('a description key is NEVER kept as an attribute, even when its value is empty', () => {
        const out = extract({ desc: '' });
        expect(out.attributes).toEqual({});
        expect(out.descricao).toBe('');
    });

    it('sanitises the description exactly once', () => {
        extract({ descricao: 'texto' });
        expect(sanitizeHtml).toHaveBeenCalledTimes(1);
        expect(sanitizeHtml).toHaveBeenCalledWith('texto');
    });

    it('coerces a non-string description to a string first', () => {
        expect(extract({ desc: 42 }).descricao).toBe('[san]42');
    });
});

// ============================================================================
// extractAttributesFromImport — which keys are dropped
// ============================================================================

describe('extractAttributesFromImport — dropped keys', () => {
    it('drops system properties spelled EXACTLY as the set stores them', () => {
        const out = extract({ id: 'x', nome: 'y', source: 'z', fillColor: '#fff' });
        expect(out.attributes).toEqual({});
    });

    it('CONSERTADO (I8, 2026-09-21): drops a system name in ANY casing', () => {
        // This case used to be marked OBSERVADO and pin the inverse: the import
        // walk compared `SYSTEM_PROPERTIES.has(key)` while validateAttributeKey
        // compared against the derived lowercase index, so the same word was
        // reserved on one path and a plain attribute on the other, one file apart.
        expect(extract({ fillcolor: '#fff' }).attributes).toEqual({});
        expect(extract({ FillColor: '#fff' }).attributes).toEqual({});
        expect(extract({ FILLCOLOR: '#fff' }).attributes).toEqual({});
        expect(extract({ ID: 'x' }).attributes).toEqual({});
        expect(extract({ LayerId: 'x' }).attributes).toEqual({});
    });

    it('CONTROLE: the case-insensitive skip did not start eating neighbours', () => {
        // The same row that loses `FillColor` keeps everything else, so the new
        // lookup is a skip and not a walk that stopped early.
        expect(extract({ FillColor: '#fff', vizinho: 'ok' }).attributes)
            .toEqual({ vizinho: '[san]ok' });
    });

    it('drops keys starting with an underscore', () => {
        expect(extract({ _interno: 'x', __proto_ish: 'y' }).attributes).toEqual({});
    });

    it('drops null and undefined values', () => {
        expect(extract({ a: null, b: undefined }).attributes).toEqual({});
    });

    it('drops nested objects and arrays', () => {
        expect(extract({ a: { b: 1 }, b: [1, 2] }).attributes).toEqual({});
    });
});

// ============================================================================
// extractAttributesFromImport — which values survive
// ============================================================================

describe('extractAttributesFromImport — kept values', () => {
    it('KEEPS 0 and false, as their string forms', () => {
        // The guard is `value === null || value === undefined`, not a falsy
        // test, which is exactly what makes a count of zero survive an import.
        expect(extract({ count: 0, ok: false }).attributes)
            .toEqual({ count: '[san]0', ok: '[san]false' });
    });

    it('keeps an empty string', () => {
        expect(extract({ obs: '' }).attributes).toEqual({ obs: '[san]' });
    });

    it('keeps NaN and Infinity as their string forms', () => {
        expect(extract({ a: NaN, b: Infinity }).attributes)
            .toEqual({ a: '[san]NaN', b: '[san]Infinity' });
    });

    it('the documented mixed row keeps the zero and the false and loses the null', () => {
        expect(extract({ count: 0, ok: false, missing: null }).attributes)
            .toEqual({ count: '[san]0', ok: '[san]false' });
    });

    it('sanitises EVERY kept value, once each', () => {
        const out = extract({ a: '<img onerror=1>', b: 'x' });
        expect(out.attributes.a).toBe('[san]<img onerror=1>');
        expect(sanitizeHtml).toHaveBeenCalledTimes(2);
    });

    it('every value in the result is a string', () => {
        fc.assert(
            fc.property(
                fc.dictionary(
                    fc.stringMatching(/^[a-z]{1,8}$/),
                    fc.oneof(fc.string(), fc.integer(), fc.boolean()),
                    { maxKeys: 6 }
                ),
                (props) => {
                    const out = extract(props);
                    for (const value of Object.values(out.attributes)) {
                        expect(typeof value).toBe('string');
                    }
                }
            ),
            { numRuns: 200 }
        );
    });
});

// ============================================================================
// extractAttributesFromImport — the "attributes" collision
// ============================================================================

describe('extractAttributesFromImport — a property literally named "attributes" (DEFEITO)', () => {
    it('CONTROLE: a neighbouring scalar property IS kept, so the walk reaches this row', () => {
        expect(extract({ attributes: 'texto solto', vizinho: 'ok' }).attributes)
            .toEqual({ attributes_imported: '[san]texto solto', vizinho: '[san]ok' });
    });

    it('CONSERTADO: a scalar `attributes` is renamed to `attributes_imported`', () => {
        // The function always carried an explicit branch for this case, but
        // 'attributes' is also listed in SYSTEM_PROPERTIES and the system skip
        // ran FIRST, so the branch was unreachable and an imported scalar named
        // `attributes` was lost without a trace. The branch now runs before it.
        expect(extract({ attributes: 'texto solto' }).attributes)
            .toEqual({ attributes_imported: '[san]texto solto' });
        expect(extract({ attributes: 0 }).attributes)
            .toEqual({ attributes_imported: '[san]0' });
        expect(extract({ attributes: false }).attributes)
            .toEqual({ attributes_imported: '[san]false' });
    });

    it('CONSERTADO: the value now reaches the sanitiser, which is why the branch mattered', () => {
        extract({ attributes: '<script>' });
        expect(sanitizeHtml).toHaveBeenCalledWith('<script>');
    });

    it('CONTROLE: a NULLISH `attributes` is still dropped, not renamed to "null"', () => {
        // Moving the branch above the null/undefined skip would otherwise have
        // invented an attribute reading "null".
        expect(extract({ attributes: null }).attributes).toEqual({});
        expect(extract({ attributes: undefined }).attributes).toEqual({});
    });

    it('an OBJECT-valued `attributes` is dropped too, which IS the intent', () => {
        expect(extract({ attributes: { a: 1 } }).attributes).toEqual({});
    });

    it('CONSERTADO (I8, 2026-09-21): the differently-cased `Attributes` is RENAMED, not kept', () => {
        // It used to survive under its own name because the system skip below
        // this branch was case-sensitive. Making that skip case-insensitive
        // would have made `Attributes` fall INTO it and vanish without a trace —
        // the very loss this branch exists to prevent — so the branch was
        // lowercased in the same commit.
        expect(extract({ Attributes: 'texto' }).attributes)
            .toEqual({ attributes_imported: '[san]texto' });
        expect(extract({ ATTRIBUTES: 0 }).attributes)
            .toEqual({ attributes_imported: '[san]0' });
    });

    it('CONTROLE: a differently-cased NULLISH `attributes` is still dropped, not renamed', () => {
        expect(extract({ Attributes: null }).attributes).toEqual({});
        expect(extract({ Attributes: { a: 1 } }).attributes).toEqual({});
    });
});

// ============================================================================
// The two policies contrasted
// ============================================================================

describe('the two policies disagree about the same word', () => {
    it('CONSERTADO: `fillColor` is now reserved on BOTH paths', () => {
        // It used to be reserved on import and free on manual creation, which is
        // the pair the camelCase leak created.
        expect(extract({ fillColor: '#fff' }).attributes).toEqual({});
        expect(validate('fillColor').valid).toBe(false);
    });

    it('CONSERTADO (I8, 2026-09-21): `fillcolor` no longer diverges the OTHER way', () => {
        // This used to be the leftover disagreement, excused as "the safe
        // direction" because the import only ever KEPT what the manual path
        // refused. Keeping is the damage when the other owner of the name is a
        // reader that already consumed the column.
        expect(extract({ fillcolor: '#fff' }).attributes).toEqual({});
        expect(validate('fillcolor').valid).toBe(false);
    });

    it('CONSERTADO (I8, 2026-09-21): `ID` is reserved on BOTH paths', () => {
        expect(extract({ ID: 'x' }).attributes).toEqual({});
        expect(validate('ID').valid).toBe(false);
    });

    it('the two paths now agree on every system name, in every casing', () => {
        // The property the pairwise cases above only sample. One name is
        // EXCLUDED and the exclusion is the declared exception, not a hole:
        // `attributes` is renamed to `attributes_imported` instead of dropped
        // (its own describe block above pins that, in three casings), because
        // dropping it is the data loss that branch exists to prevent.
        const nomes = [...userDataManager.getSystemProperties()]
            .filter((n) => n.toLowerCase() !== 'attributes');
        expect(nomes.length).toBeGreaterThan(100);

        for (const nome of nomes) {
            for (const grafia of [nome, nome.toLowerCase(), nome.toUpperCase()]) {
                expect(extract({ [grafia]: 'v' }).attributes, `import manteve "${grafia}"`)
                    .toEqual({});
                expect(validate(grafia).valid, `manual aceitou "${grafia}"`).toBe(false);
            }
        }
    });

    it('OBSERVADO: the divergence that REMAINS is about characters, not case', () => {
        // `a.b` is not a reserved name; it is refused by the character regex of
        // validateAttributeKey, which the import walk does not apply. So an
        // imported attribute can still be one no user could have typed — and
        // `ID`, which used to ride along in this same row, no longer does.
        const imported = extract({ 'a.b': 1, ID: 2 }).attributes;
        expect(Object.keys(imported)).toEqual(['a.b']);
        expect(validate('a.b').valid).toBe(false);
        expect(validate('a.b').reason).toBe('Chave contém caracteres inválidos');
        expect(validate('ID').reason).toBe('Chave reservada pelo sistema');
    });
});
