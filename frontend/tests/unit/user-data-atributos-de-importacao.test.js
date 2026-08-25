// Path: tests/unit/user-data-atributos-de-importacao.test.js

/**
 * @fileoverview Pins the two pure surfaces of `user_data/user_data_manager.js`:
 * `validateAttributeKey` (what the user may name a custom attribute) and
 * `extractAttributesFromImport` (what an imported GeoJSON row is allowed to
 * become).
 *
 * What this suite HOLDS:
 * - the boundary of the 50-character limit, applied AFTER trimming;
 * - the reserved-name check, now case-INSENSITIVE on both sides: it used to
 *   lowercase the key and look it up in a set storing several names in camelCase,
 *   so `outlineColor` was refused while `fillColor` and `layerId` sailed through.
 *   The index is derived from the set, so the two cannot drift again;
 * - the import path, which still compares case-SENSITIVELY, so the two functions
 *   disagree about `fillcolor` in the SAFE direction only (the manual path refuses
 *   what the import keeps, never the reverse);
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

    it('OBSERVADO: the import comparison is case-SENSITIVE, so `fillcolor` is KEPT', () => {
        // The exact inverse of validateAttributeKey, which lowercases first.
        // The same word is reserved on one path and a plain attribute on the
        // other, and the two are one file apart.
        expect(extract({ fillcolor: '#fff' }).attributes).toEqual({ fillcolor: '[san]#fff' });
        expect(extract({ FillColor: '#fff' }).attributes).toEqual({ FillColor: '[san]#fff' });
        expect(extract({ ID: 'x' }).attributes).toEqual({ ID: '[san]x' });
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

    it('the differently-cased `Attributes` is kept, since the skip is case-sensitive', () => {
        expect(extract({ Attributes: 'texto' }).attributes)
            .toEqual({ Attributes: '[san]texto' });
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

    it('OBSERVADO: the import walk is still case-SENSITIVE, so `fillcolor` diverges the OTHER way', () => {
        // What remains of the disagreement, and it is now the safe direction:
        // the manual path refuses what the import keeps, never the reverse.
        expect(extract({ fillcolor: '#fff' }).attributes).toEqual({ fillcolor: '[san]#fff' });
        expect(validate('fillcolor').valid).toBe(false);
    });

    it('`ID` is free on import and reserved on manual creation', () => {
        expect(extract({ ID: 'x' }).attributes).toEqual({ ID: '[san]x' });
        expect(validate('ID').valid).toBe(false);
    });

    it('OBSERVADO: an imported key can therefore be one no user could have typed', () => {
        const imported = extract({ 'a.b': 1, ID: 2 }).attributes;
        expect(Object.keys(imported).sort()).toEqual(['ID', 'a.b']);
        expect(validate('a.b').valid).toBe(false);
        expect(validate('ID').valid).toBe(false);
    });
});
