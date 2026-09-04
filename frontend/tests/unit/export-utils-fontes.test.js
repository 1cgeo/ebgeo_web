// Path: tests/unit/export-utils-fontes.test.js

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

/**
 * Every source the PDF/Garmin export corrects for zoom must be a source the app
 * actually creates.
 *
 * WHY THIS IS STATIC AND NOT A UNIT TEST. `correctSourceFeatures` reads
 * `hiddenMap.getSource(config.sourceName)` and returns `false` when it comes back
 * undefined. A name that matches nothing is therefore indistinguishable, at
 * runtime, from a map with no features of that type: the correction is skipped in
 * total silence and the symbol exports at the wrong size. There is no exception,
 * no log and no failing render to catch it, so the only place it CAN be caught is
 * before it runs, by comparing the two lists.
 *
 * Found on 2026-09-03: `coordination-measures-source` had zero occurrences
 * anywhere else in the project. The real source is `coordination_measures`, and
 * `coordination-measures-layer` is the LAYER id, not the source. Coordination
 * measures had never been zoom-corrected on export.
 */

const here = dirname(fileURLToPath(import.meta.url));
// `frontend/`, o pacote. Os dois niveis acima de `tests/unit` sao a raiz do PACOTE, nao a
// do monorepo: `src/` e `tests/` sao irmaos dentro de `frontend/`.
const packageRoot = resolve(here, '..', '..');
const srcRoot = join(packageRoot, 'src', 'js');

/** Every source name the exporter declares it will correct. */
function declaredSourceNames() {
    const text = readFileSync(join(srcRoot, 'import_export', 'export-utils.js'), 'utf8');
    return [...text.matchAll(/sourceName:\s*'([^']+)'/g)].map(match => match[1]);
}

/**
 * Every source name that appears as a LITERAL anywhere a source is created.
 *
 * Deliberately NOT "every source the app has": some are created from a variable
 * (terrain, street view, grid, 3D models) and some are assembled by interpolation
 * (`${prefix}-feedback` in shape.layers), so no textual scan can enumerate them
 * all. Claiming completeness would make this file lie. The claim it does make is
 * narrower and true: a name declared in the exporter must appear, spelled out, at
 * some place that creates a source.
 *
 * The scan covers five creators, and breadth matters in ONE direction only: a
 * missing creator would fail a good entry (a false alarm), never hide a bad one,
 * since a name that exists nowhere as a literal cannot be found by any of them.
 *
 * Kept as a text scan rather than an import because the style modules pull in
 * MapLibre, which does not load in the `node` environment this suite runs in.
 *
 * @returns {Set<string>} Source names
 */
function createdSourceNames() {
    const names = new Set();
    // Two shapes, each anchored to its own syntax. A single alternation that allowed
    // `sourceId: algo, 'literal'` would over-match and HIDE a bad entry, which is the one
    // direction the fileoverview promises this scan never fails in.
    const creator = /(?:setOrCreateSource|ensureSource|setSourceData|addSource)\s*\(\s*(?:[^,()]+,\s*)?'([^']+)'/g;
    const declared = /sourceId:\s*'([^']+)'/g;

    for (const entry of readdirSync(srcRoot, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
        const text = readFileSync(join(entry.parentPath ?? entry.path, entry.name), 'utf8');
        for (const match of text.matchAll(creator)) {
            names.add(match[1]);
        }
        for (const match of text.matchAll(declared)) {
            names.add(match[1]);
        }
    }

    return names;
}

describe('ZOOM_INVARIANT_SOURCES aponta para fontes que existem', () => {
    // The two scans below are the instrument, and an instrument that finds
    // nothing would make every assertion below pass vacuously. These two bounds
    // are what make the ruler capable of failing at all.
    //
    // O PISO DE DECLARADAS E OITO, e nao os nove do `main`: a entrada da Linha de
    // Coordenacao nasce com aquela ferramenta, que nao existe neste ramo. Piso, nunca
    // igualdade, para que ela possa chegar sem passar por aqui.
    it('o instrumento acha as duas listas, e nao passa por vazio', () => {
        expect(declaredSourceNames().length).toBeGreaterThanOrEqual(8);
        expect(createdSourceNames().size).toBeGreaterThanOrEqual(25);
    });

    it('o instrumento reprova um nome inventado', () => {
        expect(createdSourceNames().has('fonte-que-nao-existe')).toBe(false);
    });

    it('reconhece as fontes que sabidamente existem', () => {
        const created = createdSourceNames();
        for (const known of ['points', 'lines', 'boundarys', 'coordination_measures', 'military_symbols']) {
            expect(created.has(known), known).toBe(true);
        }
    });

    it('toda fonte declarada na correcao de zoom e criada em algum lugar', () => {
        const created = createdSourceNames();
        const ausentes = declaredSourceNames().filter(name => !created.has(name));
        expect(ausentes).toEqual([]);
    });
});
