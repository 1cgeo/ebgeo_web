// Path: tests/unit/qan-fora-do-menu-de-linha.test.js

/**
 * @fileoverview Pins the owner's requests about "Exportar QAN" on the map's right-click
 * menu. On 2026-09-20 the menu stopped offering it for a LINE; on 2026-09-22 it stopped
 * offering it for a POLYGON too, so the right-click menu offers it for NO geometry. The file
 * name predates the second request and is kept so the history of this guard stays in one
 * place.
 *
 * TWO HALVES, AND NEITHER IS ENOUGH ALONE
 *
 * 1. THE MENU DOES NOT OFFER IT. `context-menu.control.js` cannot be imported in this node
 *    environment (it pulls the `@store` barrel and MapLibre), so every module of
 *    `js/context-menu/` is read as TEXT, comments stripped, and none may mention QAN in
 *    code: no item label, no generator, no path to the QAN module. The scan covers the
 *    FOLDER and not the one file, because the menu is assembled from sibling modules too
 *    (`clipboard-menu-actions.js`), and an item re-added there would come back on screen with
 *    the control file clean. Comments are stripped because the control explains in prose why
 *    the item is gone, and that prose names QAN on purpose.
 *    The polygon-only gate that lived in `js/context-menu/` was deleted with the item, since a
 *    predicate nobody consults is dead code that `npm run knip` would flag.
 *
 * 2. THE PANEL DOOR STAYS. The feature panel's "Azimutes" tab still draws an "Exportar QAN"
 *    button for line and polygon alike, through `createObservationsSection`
 *    (`js/tool_manager/helpers/observations-editor.helpers.js`), and that door was NOT part of
 *    either request. Without this half, a reader of half 1 concludes that QAN left the
 *    product and removes the second door as cleanup, which nobody asked for.
 *
 * WHAT THIS SUITE DELIBERATELY DOES NOT CLAIM
 * - That the generator changed. `generateQAN` still handles lines and polygons;
 *   `qan-export.test.js` pins that and must stay green.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const SRC_JS = new URL('../../src/js/', import.meta.url);
const CONTEXT_MENU_DIR = new URL('context-menu/', SRC_JS);

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
 * Reads a source file under `src/js/` with comments stripped.
 * @param {string} relative - Path relative to `src/js/`
 * @returns {string} Code without comments
 */
function code(relative) {
    return stripComments(readFileSync(new URL(relative, SRC_JS), 'utf8'));
}

// ============================================================================
// Half 1: the right-click menu offers QAN for no geometry
// ============================================================================

describe('menu de contexto: nenhuma geometria ganha "Exportar QAN"', () => {
    const modules = readdirSync(CONTEXT_MENU_DIR).filter((name) => name.endsWith('.js')).sort();

    it('a varredura alcança a pasta do menu, controle incluído', () => {
        // Guard against empty coverage: a renamed folder would leave the loop below with
        // nothing to check, and every assertion inside it would pass by never running.
        expect(modules).toContain('context-menu.control.js');
        expect(modules).toContain('clipboard-menu-actions.js');
        expect(modules.length).toBeGreaterThanOrEqual(2);
    });

    it.each(modules)('%s não cita QAN em código', (name) => {
        const text = stripComments(readFileSync(new URL(name, CONTEXT_MENU_DIR), 'utf8'));
        // One case-insensitive pattern covers the item label ("Exportar QAN"), the generator
        // (`generateQAN`), the lazy import (`import_export/qan/`) and the deleted gate.
        expect(text).not.toMatch(/qan/i);
    });

    it('o portão só de polígono foi apagado, e não ficou como código morto', () => {
        expect(existsSync(new URL('qan-menu-gate.js', CONTEXT_MENU_DIR))).toBe(false);
    });
});

// ============================================================================
// Half 2: the feature panel door stays
// ============================================================================

describe('painel da feição: a aba Azimutes continua exportando QAN', () => {
    const helper = code('tool_manager/helpers/observations-editor.helpers.js');
    const start = helper.indexOf('export function createObservationsSection');
    // Slice up to the next top-level export (or the end), so the assertions below read the
    // function that draws the button and not some neighbour that happens to share the file.
    const nextExport = start === -1 ? -1 : helper.indexOf('\nexport ', start + 1);
    const body = start === -1 ? '' : helper.slice(start, nextExport === -1 ? undefined : nextExport);

    it('createObservationsSection existe e desenha o botão', () => {
        expect(start).toBeGreaterThanOrEqual(0);
        expect(body).toContain("'Exportar QAN'");
    });

    it('o botão chega ao gerador pelo módulo de QAN, que continua existindo', () => {
        expect(body).toContain('generateQAN(feature)');
        expect(body).toContain('import_export/qan/index.js');
        expect(existsSync(new URL('import_export/qan/index.js', SRC_JS))).toBe(true);
    });

    it('o painel da feição ainda monta a seção na aba Azimutes', () => {
        const panel = code('sidebar/panels/feature-panel-content.js');
        expect(panel).toContain('createObservationsSection(');
        expect(panel).toContain('azimutesTab.appendChild(obsSection)');
    });
});
