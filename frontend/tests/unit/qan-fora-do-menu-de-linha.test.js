// Path: tests/unit/qan-fora-do-menu-de-linha.test.js

/**
 * @fileoverview Pins the owner's 2026-09-20 request: the right-click menu offers
 * "Exportar QAN" for a POLYGON and NOT for a LINE.
 *
 * TWO HALVES, AND NEITHER IS ENOUGH ALONE
 *
 * 1. THE DECISION. `canExportQAN` (`js/context-menu/qan-menu-gate.js`) is pure and has
 *    zero imports, so it runs here for real. This is the half that says what the product
 *    decided.
 * 2. THE WIRING. `context-menu.control.js` cannot be imported in this node environment
 *    (it pulls the `@store` barrel and MapLibre), so the wiring is read as TEXT: that
 *    `_addQANExportOption` delegates to `canExportQAN` and carries no `'line'` literal of
 *    its own. Without this half, someone re-inlines `source === 'line'` in the drawing
 *    code, the item comes back on screen, and the decision module stays green as dead
 *    code. The scan runs over the method body with comments stripped, because the
 *    fileoverview of the control quotes the word "line" in prose on purpose.
 *
 * WHAT THIS SUITE DELIBERATELY DOES NOT CLAIM
 * - That a line can no longer produce a QAN. It can: the feature panel's "Azimutes" tab
 *   still draws an "Exportar QAN" button for line and polygon alike
 *   (`createObservationsSection`, `js/tool_manager/helpers/observations-editor.helpers.js`).
 *   Only the right-click door was closed.
 * - That the generator changed. `generateQAN` still handles lines; `qan-export.test.js`
 *   pins that and must stay green.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { canExportQAN } from '../../src/js/context-menu/qan-menu-gate.js';

/**
 * Builds a selected-feature stub with the given `source` property.
 * @param {string} source - Feature source type
 * @returns {Object} Minimal feature shape the menu reads
 */
function feicao(source) {
    return { properties: { source, nome: 'Teste' } };
}

describe('canExportQAN - o que o menu de contexto oferece', () => {
    it('NAO oferece para linha (o pedido do dono)', () => {
        expect(canExportQAN([feicao('line')])).toBe(false);
    });

    it('oferece para poligono', () => {
        expect(canExportQAN([feicao('polygon')])).toBe(true);
    });

    it('nao oferece para os demais tipos de feicao', () => {
        for (const tipo of ['point', 'arrow', 'rectangle', 'boundary', 'military_symbol', 'los']) {
            expect(canExportQAN([feicao(tipo)])).toBe(false);
        }
    });
});

describe('canExportQAN - bordas', () => {
    it('exige selecao UNICA: zero ou duas feicoes nao oferecem', () => {
        expect(canExportQAN([])).toBe(false);
        expect(canExportQAN([feicao('polygon'), feicao('polygon')])).toBe(false);
        expect(canExportQAN([feicao('polygon'), feicao('line')])).toBe(false);
    });

    it('falha FECHADO em argumento ausente ou malformado', () => {
        expect(canExportQAN()).toBe(false);
        expect(canExportQAN(null)).toBe(false);
        expect(canExportQAN('polygon')).toBe(false);
        expect(canExportQAN([null])).toBe(false);
        expect(canExportQAN([{}])).toBe(false);
        expect(canExportQAN([{ properties: {} }])).toBe(false);
        expect(canExportQAN([{ properties: { source: undefined } }])).toBe(false);
    });

    it('nao confunde caixa nem espaco no valor de `source`', () => {
        expect(canExportQAN([feicao('Polygon')])).toBe(false);
        expect(canExportQAN([feicao(' polygon')])).toBe(false);
    });
});

// ============================================================================
// Wiring (text scan)
// ============================================================================

const CONTROL_URL = new URL('../../src/js/context-menu/context-menu.control.js', import.meta.url);
const CONTROL_SOURCE = readFileSync(CONTROL_URL, 'utf8');

/**
 * Strips JS comments, walking string literals so a `//` inside a string survives.
 * @param {string} source - Source text
 * @returns {string} Source without comments
 */
function stripComments(source) {
    let out = '';
    let i = 0;
    while (i < source.length) {
        const current = source[i];
        const next = source[i + 1];
        if (current === '/' && next === '/') {
            while (i < source.length && source[i] !== '\n') i++;
            continue;
        }
        if (current === '/' && next === '*') {
            i += 2;
            while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
            i += 2;
            continue;
        }
        if (current === '"' || current === "'" || current === '`') {
            const quote = current;
            out += source[i++];
            while (i < source.length && source[i] !== quote) {
                if (source[i] === '\\') out += source[i++];
                if (i < source.length) out += source[i++];
            }
            if (i < source.length) out += source[i++];
            continue;
        }
        out += source[i++];
    }
    return out;
}

/**
 * Extracts a method body by brace matching from its DECLARATION. Anchoring on the
 * declaration and not on the bare name matters: the first occurrence of the name in this
 * file is the CALL site, and slicing from there returns the caller's `if` block, which
 * silently measures the wrong text.
 * @param {string} source - Source text (comments already stripped)
 * @param {string} name - Method name
 * @returns {string} The method body, braces included
 */
function methodBody(source, name) {
    const declaration = new RegExp(`(^|\\n)\\s*${name}\\s*\\([^)]*\\)\\s*\\{`);
    const found = declaration.exec(source);
    if (!found) return '';
    let i = source.indexOf('{', found.index);
    if (i === -1) return '';
    let depth = 0;
    const from = i;
    while (i < source.length) {
        if (source[i] === '{') {
            depth++;
        } else if (source[i] === '}') {
            depth--;
            if (depth === 0) return source.slice(from, i + 1);
        }
        i++;
    }
    return '';
}

describe('fiacao: o menu CONSULTA o portao em vez de decidir sozinho', () => {
    const code = stripComments(CONTROL_SOURCE);
    const body = methodBody(code, '_addQANExportOption');

    it('o corpo de _addQANExportOption foi encontrado', () => {
        expect(body.length).toBeGreaterThan(0);
        expect(body).toContain('Exportar QAN');
    });

    it('o controle importa o portao', () => {
        expect(code).toMatch(/import\s*\{\s*canExportQAN\s*\}\s*from\s*'\.\/qan-menu-gate\.js'/);
    });

    it('o corpo delega a canExportQAN', () => {
        expect(body).toContain('canExportQAN(selectedFeatures)');
    });

    it("o corpo nao carrega literal 'line' proprio", () => {
        expect(body).not.toMatch(/['"`]line['"`]/);
    });
});
