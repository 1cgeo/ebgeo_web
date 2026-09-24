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
const { TEMPORAL_SOURCE_KEYS } = await import('../../src/js/temporal/temporal-import.js');

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

    it('the Portuguese key wins over the foreign ones, then the first non-empty; the rest are dropped', () => {
        // Changed on 2026-09-23: it was "the FIRST wins" (desc -> 'primeiro'). Our own KMZ writes
        // the exact description in the ExtendedData `descricao` and a generated balloon in
        // `<description>`, which the converter lists FIRST; the first-wins rule put the balloon
        // (or "[object Object]") in the description on every round trip.
        const out = extract({ desc: 'primeiro', descricao: 'segundo' });
        expect(out.descricao).toBe('[san]segundo');
        expect(out.attributes).toEqual({});
        expect(extract({ desc: 'primeiro', description: 'segundo' }).descricao).toBe('[san]primeiro');
    });

    it('a CDATA description (an object from the KML converter) gives its text, never "[object Object]"', () => {
        const out = extract({ description: { '@type': 'html', value: '<b>Nota</b>' } });
        expect(out.descricao).toBe('[san]<b>Nota</b>');
        expect(extract({ description: { '@type': 'html' } }).descricao).toBe('');
    });

    it('a balloon OUR export generated is not a description (the real one is in `descricao`)', () => {
        const balao = { '@type': 'html', value: '<div data-ebgeo="balao"><h3>PC</h3></div>' };
        expect(extract({ description: balao }).descricao).toBe('');
        expect(extract({ description: balao, descricao: 'real' }).descricao).toBe('[san]real');
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

describe('extractAttributesFromImport — reserved keys', () => {
    // UNTIL 2026-09-23 THIS BLOCK PINNED THE LOSS: "drops system properties". A shapefile column
    // named `ID`, `TYPE` or `NOME`, and the `<name>` of every KML placemark, vanished on import
    // without a trace (measured in Chromium). The contract now: the file's name becomes the
    // feature's `nome`; a reserved key no reader consumes is KEPT as `<key>_importado`; a reserved
    // key is never written under its own name (the I8 property, still asserted below).

    it('the name becomes `nome`, and the other reserved keys are kept with the suffix', () => {
        const out = extract({ id: 'x', nome: 'y', source: 'z', fillColor: '#fff' });
        expect(out.nome).toBe('y');
        expect(out.attributes).toEqual({
            id_importado: '[san]x',
            source_importado: '[san]z',
            fillColor_importado: '[san]#fff',
        });
    });

    it('CONSERTADO (I8, 2026-09-21): a reserved name is never kept UNDER ITS OWN NAME, in any casing', () => {
        // I8 closed the leak of a reserved name through a different casing. What it kept
        // afterwards was the drop; what must hold is that no reserved spelling lands as a key.
        expect(extract({ fillcolor: '#fff' }).attributes).toEqual({ fillcolor_importado: '[san]#fff' });
        expect(extract({ FillColor: '#fff' }).attributes).toEqual({ FillColor_importado: '[san]#fff' });
        expect(extract({ FILLCOLOR: '#fff' }).attributes).toEqual({ FILLCOLOR_importado: '[san]#fff' });
        expect(extract({ ID: 'x' }).attributes).toEqual({ ID_importado: '[san]x' });
        expect(extract({ LayerId: 'x' }).attributes).toEqual({ LayerId_importado: '[san]x' });
    });

    it('CONTROLE: the reserved branch did not start eating neighbours', () => {
        expect(extract({ FillColor: '#fff', vizinho: 'ok' }).attributes)
            .toEqual({ FillColor_importado: '[san]#fff', vizinho: '[san]ok' });
    });

    it('a key a READER consumes is still skipped, not kept (temporal columns)', () => {
        const out = extract({ inicio: '2026-01-01', FIM: '2026-02-01', timespan: 'x', vizinho: 'ok' });
        expect(out.attributes).toEqual({ vizinho: '[san]ok' });
    });

    it('the FIRST non-empty name wins, in any casing; an empty one does not take the slot', () => {
        expect(extract({ NAME: '  ', Nome: 'Base Alfa' }).nome).toBe('Base Alfa');
        expect(extract({ name: 'KML' }).nome).toBe('KML');
        expect(extract({ vizinho: 'ok' }).nome).toBeUndefined();
        expect(extract({ name: 42 }).nome).toBe('42');
    });

    it('the same name written twice is consumed once (our own KMZ: <name> and ExtendedData nome)', () => {
        const out = extract({ name: 'Base Alfa', nome: 'Base Alfa' });
        expect(out.nome).toBe('Base Alfa');
        expect(out.attributes).toEqual({});
    });

    it('`nome` wins over `name`, and a SECOND, different name is kept, not lost', () => {
        // `nome` first because our own KMZ writes the exact name there and puts the LABEL text of
        // a labelled point in the placemark `<name>`.
        const out = extract({ name: 'Base Alfa', NOME: 'Base Bravo' });
        expect(out.nome).toBe('Base Bravo');
        expect(out.attributes).toEqual({ name_importado: '[san]Base Alfa' });
    });

    it('a collision takes a numeric suffix and never overwrites a key of the file', () => {
        const out = extract({ ID: '1', ID_importado: 'da planilha' });
        expect(out.attributes).toEqual({ ID_importado_2: '[san]1', ID_importado: '[san]da planilha' });
        const depois = extract({ ID_importado: 'da planilha', ID: '1' });
        expect(depois.attributes).toEqual({ ID_importado: '[san]da planilha', ID_importado_2: '[san]1' });
    });

    it('ROUND TRIP: a kept key re-imported stays as it is (no `_importado_importado`)', () => {
        const primeira = extract({ ID: '7', TYPE: 'ponte' }).attributes;
        const segunda = extract(primeira).attributes;
        expect(Object.keys(segunda)).toEqual(['ID_importado', 'TYPE_importado']);
        expect(Object.keys(segunda).some((k) => k.includes('_importado_importado'))).toBe(false);
    });

    it('a reserved key with a nullish or object value is still skipped', () => {
        expect(extract({ ID: null, color: { r: 1 }, type: undefined }).attributes).toEqual({});
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
    it('CONSERTADO: `fillColor` is reserved on BOTH paths, and the import keeps it under another name', () => {
        expect(Object.keys(extract({ fillColor: '#fff' }).attributes)).toEqual(['fillColor_importado']);
        expect(validate('fillColor').valid).toBe(false);
        expect(validate('fillColor_importado').valid).toBe(true);
    });

    it('CONSERTADO (I8, 2026-09-21): `fillcolor` does not come back under its own name either', () => {
        // Keeping it UNDER ITS OWN NAME is the damage I8 closed (a reader may already have
        // consumed the column). Keeping it under `_importado` is what the person can see and edit.
        expect(extract({ fillcolor: '#fff' }).attributes).not.toHaveProperty('fillcolor');
        expect(validate('fillcolor').valid).toBe(false);
    });

    it('CONSERTADO (I8, 2026-09-21): `ID` is reserved on BOTH paths', () => {
        expect(extract({ ID: 'x' }).attributes).toEqual({ ID_importado: '[san]x' });
        expect(validate('ID').valid).toBe(false);
    });

    it('on every system name, in every casing: never kept under a reserved name, and never lost', () => {
        // The property the pairwise cases above only sample. `attributes` is EXCLUDED (renamed to
        // `attributes_imported`, pinned by its own block). Every other reserved name either fills
        // `descricao` or `nome`, or is kept under a NON-reserved name, or is one a reader consumes
        // (the temporal columns), and only that last kind may leave no trace.
        const consumidas = new Set([...TEMPORAL_SOURCE_KEYS, 'temporalinicio', 'temporalfim',
            'trajetoria', 'timespan']);
        const nomes = [...userDataManager.getSystemProperties()]
            .filter((n) => n.toLowerCase() !== 'attributes');
        expect(nomes.length).toBeGreaterThan(100);

        let mantidas = 0;
        for (const nome of nomes) {
            for (const grafia of [nome, nome.toLowerCase(), nome.toUpperCase()]) {
                const out = extract({ [grafia]: 'v' });
                const chaves = Object.keys(out.attributes);
                for (const chave of chaves) {
                    expect(validate(chave).reason, `import manteve "${chave}" reservado`)
                        .not.toBe('Chave reservada pelo sistema');
                }
                if (chaves.length === 1) mantidas++;
                const guardado = chaves.length === 1 || out.descricao !== '' || out.nome === 'v';
                if (!guardado) {
                    expect(consumidas.has(grafia.toLowerCase()), `import perdeu "${grafia}"`).toBe(true);
                }
                expect(validate(grafia).valid, `manual aceitou "${grafia}"`).toBe(false);
            }
        }
        // Vacuum control: most reserved names are now KEPT, not consumed.
        expect(mantidas).toBeGreaterThan(200);
    });

    it('OBSERVADO: the divergence that REMAINS is about characters, not case', () => {
        // `a.b` is not a reserved name; it is refused by the character regex of
        // validateAttributeKey, which the import walk does not apply. So an
        // imported attribute can still be one no user could have typed. `ID` rides along
        // under `ID_importado`, a name the manual path accepts.
        const imported = extract({ 'a.b': 1, ID: 2 }).attributes;
        expect(Object.keys(imported)).toEqual(['a.b', 'ID_importado']);
        expect(validate('a.b').valid).toBe(false);
        expect(validate('a.b').reason).toBe('Chave contém caracteres inválidos');
        expect(validate('ID').reason).toBe('Chave reservada pelo sistema');
    });
});
