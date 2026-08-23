// Path: src/modules/streetview360/sv360.floors.js
// Ported VERBATIM from ebgeo_360 `scripts/lib/floors.js` (branch master).
// Pure computation: no I/O, no database. The vocabulary, the level semantics
// (0 is the ground, negative is a basement, positive is a floor) and the
// exported names are unchanged; only the module path and this header are new.
//
// GROUND_LABELS is exported here, where the origin kept it module-private, so a
// caller can read the synonym table instead of re-typing it. The throw message
// now names THIS file, since it names the file the reader has to extend.
/**
 * @module src/modules/streetview360/sv360.floors
 * @description Translates the survey's floor label into the ordered level the
 * viewer stacks, and back into the label the interface prints.
 *
 * The source of truth is the `locate` string the field team writes per photo
 * (`fotos.geojson` calls the same thing `local`, `planta.geojson` calls it
 * `andar`; the three vocabularies are identical, verified across 350 photos,
 * 161 lines and 189 plan features of the Beira-Rio lot).
 *
 * WHY A CLOSED VOCABULARY, and why an unknown value throws: the alternative is
 * to default an unrecognised place to ground level, which puts a photo on the
 * wrong floor without a single line of output. A floor mix-up is invisible in
 * every aggregate — the counts still add up, the map still draws — and only
 * shows as a viewer that walks through a ceiling. Failing the import is the
 * cheap way to find out.
 *
 * Level 0 is the ground: everything outdoors, and every indoor space at grade.
 * Levels rise from 1. Negative levels are accepted for basements but no lot has
 * one yet.
 */

/**
 * The label for a level whose own `locate` string is not at hand, used when
 * building the floor list from photos that already carry a level.
 *
 * @param {number} level - The ordered level
 * @returns {string} A printable label
 */
export function defaultFloorLabel(level) {
  if (level === 0) return 'Térreo';
  if (level < 0) return `${-level}º subsolo`;
  return `${level}º andar`;
}
