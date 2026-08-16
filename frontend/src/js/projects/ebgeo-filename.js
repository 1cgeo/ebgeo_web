// Path: js/projects/ebgeo-filename.js

/**
 * @fileoverview The project name a `.ebgeo` carries, alone in a module with NO imports.
 *
 * It used to live in `import-ebgeo.service.js`, next to the server import that also needs it, and
 * that module opens with `import JSZip`. Which was free while the only callers were the map (where
 * JSZip is already paid for) and the page's own dynamic import — and stopped being free when
 * "Seus atlas" grew a SIGNED-OUT path that opens a `.ebgeo` as a LOCAL atlas: that path never
 * parses the archive here (the map's importer does), so pulling ~100 kB of ZIP code in order to
 * strip an extension would be the page's largest single import, for a `replace()`.
 *
 * `import-ebgeo.service.js` re-exports it, so every existing call site is unchanged.
 */

/**
 * The project name carried by the file: its own name, minus the extension.
 *
 * A `.ebgeo` has no atlas-name field — the format predates server atlases and only names MAPS. The
 * filename is what the user themself called this project when they saved it, so it is the closest
 * thing to an authored name; `currentMap` would name one map inside it instead. Falls back to a
 * generic label for an empty/odd filename, and the atlas can be renamed afterwards.
 * @param {string} filename
 * @returns {string}
 */
export function atlasNameFromFilename(filename) {
    const base = String(filename || '').split(/[\\/]/).pop() || '';
    const stem = base.replace(/\.ebgeo$/i, '').trim();
    return stem || 'Projeto importado';
}
