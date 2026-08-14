// Path: tests/unit/military-symbol-tables-lazy.test.js

/**
 * Guards the split between the symbol GENERATOR (always in memory) and the symbol
 * SELECTOR tables (`military_symbol_tool/data/`, loaded on demand when the modal
 * opens).
 *
 * What would break without this file: any `import ... from './data/xxx.js'` added
 * back to a module the map reaches at boot silently pulls the eleven tables into
 * the eager `military-tools` chunk again, and nothing fails. The bundle grows and
 * only a build measurement notices, months later.
 *
 * The three checks are deliberately independent:
 *  1. a whole-tree scan of `src/js` (does not depend on the graph walk),
 *  2. a graph walk from the eager root (does not depend on the scan),
 *  3. a real generation of the Brazilian SVG modifications with the tables
 *     unloaded, which is the user-visible criterion: the map draws the symbols of
 *     a saved project without anyone opening the selector.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, resolve, sep } from 'path';
import { fileURLToPath } from 'url';

import { MilitarySymbolGenerator } from '@js/military_tools/military_symbol_tool/military_symbol_generator.js';
import { applyBrazilianModifications } from '@js/military_tools/military_symbol_tool/brazilian_svg_postprocessing.js';
import { areSymbolSetsLoaded } from '@js/military_tools/military_symbol_tool/symbol_sets.registry.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_JS = resolve(HERE, '../../src/js');
const SYMBOL_TOOL = join(SRC_JS, 'military_tools', 'military_symbol_tool');
const DATA_DIR = join(SYMBOL_TOOL, 'data');
const DATA_BARREL = join(DATA_DIR, 'index.js');
const EAGER_ROOT = join(SYMBOL_TOOL, 'add_military_symbol_control.js');

/** Matches `import x from '...'` and `export { x } from '...'`, never `import(...)`. */
const FROM_IMPORT = /(?:^|\n)\s*(?:import|export)\b[\s\S]*?\sfrom\s*['"]([^'"]+)['"]/g;

/** Matches the side-effect form `import '...';`. */
const BARE_IMPORT = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;

/**
 * Collect every STATIC import specifier of a file (dynamic `import()` excluded).
 * @param {string} filePath - Absolute file path
 * @returns {Array<string>} Specifiers as written in the source
 */
function staticSpecifiers(filePath) {
    const source = readFileSync(filePath, 'utf8');
    const found = [];

    for (const match of source.matchAll(FROM_IMPORT)) {
        found.push(match[1]);
    }
    for (const match of source.matchAll(BARE_IMPORT)) {
        found.push(match[1]);
    }

    return found;
}

/**
 * List every `.js` file under a directory, recursively.
 * @param {string} dir - Absolute directory path
 * @returns {Array<string>} Absolute file paths
 */
function listJsFiles(dir) {
    const out = [];

    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            out.push(...listJsFiles(full));
        } else if (entry.endsWith('.js')) {
            out.push(full);
        }
    }

    return out;
}

/**
 * Resolve a specifier to an absolute path when it is relative; otherwise keep it
 * as written (aliases are compared as strings).
 * @param {string} specifier - Import specifier
 * @param {string} fromFile - Absolute path of the importing file
 * @returns {string} Absolute path or the original specifier
 */
function resolveSpecifier(specifier, fromFile) {
    if (specifier.startsWith('.')) {
        return resolve(dirname(fromFile), specifier);
    }
    return specifier;
}

/**
 * Does this specifier point into the symbol-set data folder?
 * @param {string} specifier - Import specifier
 * @param {string} fromFile - Absolute path of the importing file
 * @returns {boolean} True when it reaches `military_symbol_tool/data/`
 */
function pointsIntoDataDir(specifier, fromFile) {
    const resolved = resolveSpecifier(specifier, fromFile);
    return resolved.startsWith(DATA_DIR + sep) ||
        specifier.includes('military_symbol_tool/data');
}

describe('symbol-set tables are imported statically only by their own barrel', () => {
    const allFiles = listJsFiles(SRC_JS);

    it('scans the whole src/js tree (guard against an empty scan)', () => {
        expect(allFiles.length).toBeGreaterThan(400);
        expect(allFiles).toContain(DATA_BARREL);
    });

    it('sees the 11 static table imports inside the barrel (guard against a regex that matches nothing)', () => {
        const tableImports = staticSpecifiers(DATA_BARREL)
            .filter((specifier) => pointsIntoDataDir(specifier, DATA_BARREL));

        expect(tableImports).toHaveLength(11);
    });

    it('finds no other static importer of the tables anywhere in src/js', () => {
        const offenders = [];

        for (const file of allFiles) {
            if (file === DATA_BARREL) continue;

            for (const specifier of staticSpecifiers(file)) {
                if (pointsIntoDataDir(specifier, file)) {
                    offenders.push(`${file.slice(SRC_JS.length + 1)} -> ${specifier}`);
                }
            }
        }

        expect(offenders).toEqual([]);
    });
});

describe('the eager military-symbol graph never reaches the tables', () => {
    /**
     * Walk static relative imports from a root file.
     * @param {string} root - Absolute path of the entry file
     * @returns {Set<string>} Absolute paths reached
     */
    function walkRelativeGraph(root) {
        const visited = new Set();
        const queue = [root];

        while (queue.length > 0) {
            const current = queue.pop();
            if (visited.has(current)) continue;
            visited.add(current);

            for (const specifier of staticSpecifiers(current)) {
                if (!specifier.startsWith('.')) continue;
                const target = resolve(dirname(current), specifier);
                if (!visited.has(target)) {
                    queue.push(target);
                }
            }
        }

        return visited;
    }

    const reached = walkRelativeGraph(EAGER_ROOT);

    it('reaches the selector modules the tables used to hang from (guard against a walk that goes nowhere)', () => {
        expect(reached).toContain(join(SYMBOL_TOOL, 'military_constants.js'));
        expect(reached).toContain(join(SYMBOL_TOOL, 'symbol_sets.registry.js'));
        expect(reached).toContain(join(SYMBOL_TOOL, 'attributes', 'symbol-selector.modal.js'));
        expect(reached).toContain(join(SYMBOL_TOOL, 'attributes', 'symbol-form.section.js'));
        expect(reached).toContain(join(SYMBOL_TOOL, 'military_symbol_generator.js'));
    });

    it('does not reach the data barrel nor any individual table', () => {
        const dataFilesReached = [...reached].filter((file) => file.startsWith(DATA_DIR + sep));
        expect(dataFilesReached).toEqual([]);
    });
});

describe('symbol generation works with the tables unloaded', () => {
    const generator = new MilitarySymbolGenerator();

    // 20-digit base + Brazilian extension: symbol set 10, main icon 121899
    // ("Forças Especiais" family), entity extension 1 -> the "Prec" text amplifier
    // catalogued in brazilian_extension_catalog.js.
    const properties = {
        standardIdentity: '3',
        symbolSet: '10',
        status: '0',
        hqTfDummy: '0',
        echelon: '16',
        mainIcon: '121899',
        modifier1: '00',
        modifier2: '00',
        mainIconExtension: 1
    };

    it('builds the 30-digit SIDC without loading the tables', () => {
        expect(areSymbolSetsLoaded()).toBe(false);

        const sidc30 = generator.buildSIDC(properties);

        expect(sidc30).toBe('100310001612189900000760016384');
        expect(areSymbolSetsLoaded()).toBe(false);
    });

    it('applies the Brazilian extension to the SVG without loading the tables', () => {
        const sidc30 = generator.buildSIDC(properties);
        const svg = '<svg viewBox="0 0 200 200"><g></g></svg>';

        const result = applyBrazilianModifications(svg, sidc30, '10');

        expect(result).toContain('Prec');
        expect(areSymbolSetsLoaded()).toBe(false);
    });

    it('keeps working for a symbol with no extension at all', () => {
        const sidc30 = generator.buildSIDC({ ...properties, mainIcon: '111000', mainIconExtension: null });
        const svg = '<svg viewBox="0 0 200 200"><g></g></svg>';

        expect(sidc30.slice(20)).toBe('0760000000');
        expect(applyBrazilianModifications(svg, sidc30, '10')).toContain('</svg>');
        expect(areSymbolSetsLoaded()).toBe(false);
    });
});
