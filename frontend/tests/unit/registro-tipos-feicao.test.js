// Path: tests/unit/registro-tipos-feicao.test.js
//
// THE REGISTRY ITSELF: shape, identity, and the two properties that are contracts rather
// than habits (zero imports, out of both barrels).
//
// This file guards `src/js/store/feature-type.registry.js`, which is where a feature type
// is born. It is born GREEN over correct code, which makes it indistinguishable from a
// blind guard until someone proves it can see. So every structural rule here is ALSO run
// against synthetic rows and synthetic source text that break it on purpose, on every run:
// the proof does not expire, and it does not depend on anybody remembering to mutate the
// real file.
//
// WHAT THE GREEN DOES NOT PROVE. It does not say a row is CORRECT. That `magnetic_declination`
// carries an image and a selection box is a fact about the product that this file records
// and does not adjudicate. What it prevents is a row that is malformed, duplicated, or
// silently reshaped, and a registry that quietly grows an import or slips into a barrel.
//
// The other two halves live in `store-constants-derivadas.test.js` (the six constants that
// derive from the registry still have their exact old shape) and in
// `registro-tipos-cobertura.test.js` (every file in `src/js/` that writes out a list of
// types either derives from the registry or is declared, with a reason).
//
// ACCEPTED FRAGILITIES, all of them breaking toward a red with its own message: the import
// scan is textual, so a dynamic `await import()` written with an unusual spacing would slip
// past it; the barrel check looks for the file's basename, so renaming the registry without
// renaming it here goes quiet (the first case in this file, which imports the module, would
// fail first).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FEATURE_TYPE_REGISTRY } from '@store/feature-type.registry.js';

const ARQ_REGISTRO = fileURLToPath(
    new URL('../../src/js/store/feature-type.registry.js', import.meta.url),
);
const ARQ_BARREL_INDEX = fileURLToPath(new URL('../../src/js/store/index.js', import.meta.url));
const ARQ_BARREL_STORE = fileURLToPath(new URL('../../src/js/store/store.js', import.meta.url));
const ARQ_NAVEGACAO = fileURLToPath(
    new URL('../../src/js/utilities/feature_navigation_utils.js', import.meta.url),
);

/** The eight fields a row carries, written out ABSOLUTELY: deriving them from row zero
 *  would make a typo in row zero the definition of correctness. */
const CAMPOS = ['type', 'storage', 'label', 'icon', 'selectable', 'copiable', 'imageResource', 'selectionBox'];

const TEXTO = ['type', 'storage'];
const TEXTO_OU_NULO = ['label', 'icon'];
const BOOLEANOS = ['selectable', 'copiable', 'imageResource', 'selectionBox'];

/**
 * Every complaint a single row earns. Returning the list (instead of a boolean) is what
 * lets the failure name the row AND the field, and what lets the synthetic controls below
 * assert the exact message rather than "something was wrong".
 * @param {Object} row
 * @returns {string[]}
 */
function defeitosDaLinha(row) {
    const quem = row?.type ?? '(sem type)';
    const out = [];
    if (!row || typeof row !== 'object') return [`${quem}: nao e objeto`];

    const chaves = Object.keys(row).sort();
    const esperadas = [...CAMPOS].sort();
    for (const campo of esperadas) if (!chaves.includes(campo)) out.push(`${quem}: falta o campo '${campo}'`);
    for (const campo of chaves) if (!esperadas.includes(campo)) out.push(`${quem}: campo desconhecido '${campo}'`);

    for (const campo of TEXTO) {
        if (typeof row[campo] !== 'string' || row[campo].length === 0) out.push(`${quem}: '${campo}' precisa ser texto nao vazio`);
    }
    for (const campo of TEXTO_OU_NULO) {
        const v = row[campo];
        if (v !== null && (typeof v !== 'string' || v.length === 0)) out.push(`${quem}: '${campo}' precisa ser texto nao vazio ou null`);
    }
    for (const campo of BOOLEANOS) {
        if (typeof row[campo] !== 'boolean') out.push(`${quem}: '${campo}' precisa ser booleano`);
    }
    // A type with a label and no icon (or the reverse) is a half-migrated row: the tab would
    // name it and the table would draw nothing, or vice versa. The two travel together.
    if ((row.label === null) !== (row.icon === null)) out.push(`${quem}: 'label' e 'icon' precisam ser ambos nulos ou ambos preenchidos`);
    return out;
}

/** Every quoted lower-snake literal inside a source slice. */
function literais(trecho) {
    return [...trecho.matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
}

/**
 * Slices from `abertura` to the first `fecho` after it, or null when the anchor is gone,
 * so the caller's floor (not a comparison against emptiness) reports the breakage.
 * @param {string} fonte @param {string} abertura @param {string} fecho @returns {string|null}
 */
function fatia(fonte, abertura, fecho) {
    const i = fonte.indexOf(abertura);
    if (i === -1) return null;
    const j = fonte.indexOf(fecho, i + abertura.length);
    if (j === -1) return null;
    return fonte.slice(i, j);
}

const fonteRegistro = readFileSync(ARQ_REGISTRO, 'utf8');

describe('registro de tipos: piso e forma', () => {
    it('FLOOR: o registro foi importado e tem linhas', () => {
        // Without this, an empty (or undefined) registry would make every "no duplicates"
        // and "no unknown field" case below pass vacuously, in silence.
        expect(Array.isArray(FEATURE_TYPE_REGISTRY), 'FEATURE_TYPE_REGISTRY nao e array').toBe(true);
        expect(FEATURE_TYPE_REGISTRY.length, 'o registro veio vazio: o import quebrou').toBeGreaterThanOrEqual(21);
    });

    it('ABSOLUTE: os vinte e um tipos, escritos por extenso', () => {
        // Absolute, not derived: comparing the registry with something computed FROM the
        // registry is the tautology that passes green on an empty list.
        expect(FEATURE_TYPE_REGISTRY.map(r => r.type)).toEqual([
            'point', 'line', 'polygon', 'circle', 'ellipse', 'rectangle', 'sector',
            'text', 'image', 'brush',
            'arrow', 'boundary', 'occupied_front', 'coordination_line', 'military_symbol',
            'coordination_measure',
            'los', 'visibility', 'processed_los', 'processed_visibility',
            'magnetic_declination',
        ]);
    });

    it('ABSOLUTE: os quatro buckets irregulares continuam irregulares', () => {
        // `sector -> setores` and `boundary -> boundarys` are the two spellings a well-meaning
        // "fix" regularises, and the two whose regularisation writes into a phantom bucket.
        // The processing outputs are the same class with a different shape.
        const porTipo = Object.fromEntries(FEATURE_TYPE_REGISTRY.map(r => [r.type, r.storage]));
        expect(porTipo.sector).toBe('setores');
        expect(porTipo.boundary).toBe('boundarys');
        expect(porTipo.processed_los).toBe('processed_los');
        expect(porTipo.processed_visibility).toBe('processed_visibility');
    });

    it('toda linha tem exatamente os oito campos, com os tipos certos', () => {
        const defeitos = FEATURE_TYPE_REGISTRY.flatMap(defeitosDaLinha);
        expect(defeitos).toEqual([]);
    });

    it('nenhum type e nenhum storage se repete', () => {
        const tipos = FEATURE_TYPE_REGISTRY.map(r => r.type);
        const buckets = FEATURE_TYPE_REGISTRY.map(r => r.storage);
        expect(new Set(tipos).size, 'type duplicado').toBe(tipos.length);
        // `los` and `visibility` are the two types whose storage name EQUALS the type name,
        // so a duplicate here is a real collision, never that coincidence.
        expect(new Set(buckets).size, 'storage duplicado').toBe(buckets.length);
    });

    it('o array e cada linha estao congelados', () => {
        expect(Object.isFrozen(FEATURE_TYPE_REGISTRY)).toBe(true);
        for (const row of FEATURE_TYPE_REGISTRY) {
            expect(Object.isFrozen(row), `linha '${row.type}' nao esta congelada`).toBe(true);
        }
    });
});

describe('registro de tipos: controle positivo da validacao de linha', () => {
    // The rules above are born green. These cases run the SAME validator over rows broken
    // on purpose, which is the only thing that separates a guard from a decoration.

    const BOA = {
        type: 'foo', storage: 'foos', label: 'Foo', icon: './images/foo.svg',
        selectable: true, copiable: true, imageResource: false, selectionBox: false,
    };

    it('a linha sintetica boa passa (senao o resto nao mediria nada)', () => {
        expect(defeitosDaLinha(BOA)).toEqual([]);
    });

    it('campo faltando e visto, e nomeado', () => {
        const { selectionBox: _ignorado, ...semCampo } = BOA;
        // Two complaints, not one: the field is missing AND its type is wrong. Asserting the
        // pair (rather than the first line) is what keeps this case honest if the validator
        // is ever reordered.
        expect(defeitosDaLinha(semCampo)).toEqual([
            "foo: falta o campo 'selectionBox'",
            "foo: 'selectionBox' precisa ser booleano",
        ]);
    });

    it('campo a mais e visto (o typo que passaria batido)', () => {
        expect(defeitosDaLinha({ ...BOA, selectionbox: false }))
            .toEqual(["foo: campo desconhecido 'selectionbox'"]);
    });

    it('booleano escrito como texto e visto', () => {
        expect(defeitosDaLinha({ ...BOA, imageResource: 'true' }))
            .toEqual(["foo: 'imageResource' precisa ser booleano"]);
    });

    it('rotulo sem icone e visto (linha meio migrada)', () => {
        expect(defeitosDaLinha({ ...BOA, icon: null }))
            .toEqual(["foo: 'label' e 'icon' precisam ser ambos nulos ou ambos preenchidos"]);
    });
});

describe('registro de tipos: as duas propriedades que sao contrato', () => {
    it('ZERO imports: o registro nao importa nada', () => {
        // This is what keeps `store.constants.js` and `repository.utils.js` loadable in plain
        // node with no alias resolution. Prose cannot promise it; a future edit will not warn.
        const linhas = fonteRegistro.split('\n');
        expect(linhas.length, 'o arquivo do registro nao foi lido').toBeGreaterThan(50);
        const ofensores = linhas.filter(l => /^\s*import\s/.test(l) || /\brequire\s*\(/.test(l) || /\bimport\s*\(/.test(l));
        expect(ofensores, 'o registro ganhou um import: ele deixa de carregar em node puro').toEqual([]);
    });

    it('controle positivo: a varredura de import enxerga um import', () => {
        const falso = "// Path: x\nimport { a } from './b.js';\nexport const X = 1;\n";
        expect(falso.split('\n').filter(l => /^\s*import\s/.test(l))).toHaveLength(1);
    });

    it('FORA dos dois barrels', () => {
        // A barrel re-export would hand every future consumer a way to pull the whole store
        // graph into a page that has no map, which is the cost this registry exists to avoid.
        for (const [nome, arq] of [['store/index.js', ARQ_BARREL_INDEX], ['store/store.js', ARQ_BARREL_STORE]]) {
            const fonte = readFileSync(arq, 'utf8');
            expect(fonte.length, `${nome} nao foi lido`).toBeGreaterThan(100);
            expect(fonte, `${nome} passou a reexportar o registro`).not.toContain('feature-type.registry');
        }
    });

    it('controle positivo: a checagem de barrel enxerga a reexportacao', () => {
        const falso = "export * from './store.js';\nexport { FEATURE_TYPE_REGISTRY } from './feature-type.registry.js';\n";
        expect(falso).toContain('feature-type.registry');
    });
});

describe('registro de tipos: o campo selectionBox contra a lista viva', () => {
    // `selectionBox` is the one capability field with no derived consumer yet:
    // `SELECTION_BOX_TYPES` still lives written out by hand in `feature_navigation_utils.js`.
    // A field nobody checks drifts in silence, so it is checked HERE, against that file's own
    // text, without migrating it. When that list finally derives from the registry, this pair
    // of cases becomes redundant and should be deleted, not weakened.
    const fonteNavegacao = readFileSync(ARQ_NAVEGACAO, 'utf8');

    it('FLOOR: a lista viva foi extraida', () => {
        const bloco = fatia(fonteNavegacao, 'const SELECTION_BOX_TYPES = [', ']');
        expect(bloco, 'a ancora SELECTION_BOX_TYPES sumiu: leia ESTE caso, nao o de paridade').not.toBeNull();
        expect(literais(bloco).length).toBeGreaterThanOrEqual(4);
    });

    it('a lista viva e exatamente os tipos com selectionBox no registro', () => {
        const bloco = fatia(fonteNavegacao, 'const SELECTION_BOX_TYPES = [', ']');
        const viva = literais(bloco ?? '');
        const doRegistro = FEATURE_TYPE_REGISTRY.filter(r => r.selectionBox).map(r => r.type);
        // Absolute alongside the comparative, so two identically-wrong copies cannot agree
        // their way to green.
        expect(doRegistro).toEqual(['text', 'image', 'military_symbol', 'magnetic_declination']);
        expect([...viva].sort()).toEqual([...doRegistro].sort());
    });

    it('controle positivo: o extrator devolve VAZIO quando a ancora muda', () => {
        expect(fatia('const OUTRO_NOME = [\'text\'];', 'const SELECTION_BOX_TYPES = [', ']')).toBeNull();
    });
});
