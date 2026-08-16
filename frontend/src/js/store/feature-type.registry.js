// Path: js/store/feature-type.registry.js

/**
 * @fileoverview THE registry of feature types: one row per type, and the only place a
 * type is born.
 *
 * WHY THIS FILE EXISTS. Adding a drawing tool used to mean editing fifteen closed lists
 * spread over ten files, none of which fails loudly when forgotten. It was measured on the
 * sector tool: the tool landed on 2026-02-08 and three of those lists only learned about it
 * between eight and thirteen days later, while the commit that introduced it looked
 * complete. This file does not abolish the lists (see WHAT THIS DOES NOT DO below); it
 * gives them one place to derive from, and gives the guards one thing to compare against.
 *
 * ZERO IMPORTS, AND THAT IS A CONTRACT, NOT AN ACCIDENT. It is what keeps this module (and
 * `store.constants.js` and `repository.utils.js`, which derive from it) loadable in plain
 * node with no alias resolution and no IndexedDB. `registro-tipos-feicao.test.js` asserts
 * the absence of imports by reading this file's own text, because a reader cannot promise
 * it and a future edit will not warn.
 *
 * NOT IN EITHER BARREL, ALSO ON PURPOSE. `store/index.js` and `store/store.js` drag the
 * whole store graph; a peripheral list that wants types must import THIS path directly.
 * Re-exporting the registry from a barrel would hand every future consumer a way to pull
 * the store into a page that has no map.
 *
 * WHAT A ROW IS. Eight fields, three groups, and the split between the two capability
 * fields at the end is the reason capabilities are fields at all rather than one flag:
 *
 *   identity      `type`     singular source type; the value of `properties.source`
 *                 `storage`  the store bucket and the MapLibre source id (irregular:
 *                            `sector` -> `setores`, `boundary` -> `boundarys`)
 *   presentation  `label`    pt-BR name shown to the user; `null` means the type is never
 *                            named in the interface
 *                 `icon`     path of the 16px black icon; `null` alongside a null label
 *   capability    `selectable`     participates in box selection (`getSelectionControlConfig`)
 *                 `copiable`       clipboard copies it (the inverse of UNCOPYABLE_FEATURE_TYPES)
 *                 `imageResource`  carries a blob in the image store
 *                 `selectionBox`   zoom-to uses `properties.selectionBox` instead of the
 *                                  geometry (`SELECTION_BOX_TYPES`, `feature_navigation_utils.js`)
 *
 * `imageResource` and `selectionBox` differ on exactly two types (`text` has a selection box
 * and no image; `coordination_measure` has an image and no selection box). One combined
 * flag would have been wrong for both, in opposite directions.
 *
 * WHAT THIS DOES NOT DO, so nobody plans from the wrong belief: it does not migrate the
 * peripheral lists. Today exactly one file derives from it (`store.constants.js`). The
 * others are inventoried, with a written reason each, by
 * `frontend/tests/unit/registro-tipos-cobertura.test.js`, which is also what turns red when
 * a row lands here and a list that promises completeness never hears about it. Migrating a
 * list is a separate commit, justified by the bug it causes, never by tidiness: three of
 * them decide observable output (the PDF legend, the KMZ export, the feature tab).
 *
 * NOT EVERY STORE BUCKET IS A TYPE. `getEmptyMapData` carries 21 buckets; the extra one is
 * `coordenadas`, an ephemeral reading with no source, no layer and no place in the server
 * contract. It is deliberately absent here.
 */

/**
 * @typedef {Object} FeatureTypeRow
 * @property {string} type - Singular source type, e.g. 'point'
 * @property {string} storage - Store bucket / MapLibre source id, e.g. 'points'
 * @property {string|null} label - pt-BR display name, or null when never shown
 * @property {string|null} icon - Icon path, or null when never shown
 * @property {boolean} selectable - Participates in box selection
 * @property {boolean} copiable - Clipboard copies it
 * @property {boolean} imageResource - Carries a blob in the image store
 * @property {boolean} selectionBox - Zoom-to reads `properties.selectionBox`
 */

/**
 * One row per feature type, in the canonical order: drawing tools, military tools,
 * analysis tools. The order is load-bearing for the constants derived from it in
 * `store.constants.js`, whose key order is preserved verbatim.
 * @constant {ReadonlyArray<FeatureTypeRow>}
 */
export const FEATURE_TYPE_REGISTRY = Object.freeze([
    // ----- drawing tools -----
    Object.freeze({
        type: 'point', storage: 'points',
        label: 'Ponto', icon: './images/icon_point_black.svg',
        selectable: true, copiable: true, imageResource: false, selectionBox: false,
    }),
    Object.freeze({
        type: 'line', storage: 'lines',
        label: 'Linha', icon: './images/icon_line_black.svg',
        selectable: true, copiable: true, imageResource: false, selectionBox: false,
    }),
    Object.freeze({
        type: 'polygon', storage: 'polygons',
        label: 'Polígono', icon: './images/icon_polygon_black.svg',
        selectable: true, copiable: true, imageResource: false, selectionBox: false,
    }),
    Object.freeze({
        type: 'circle', storage: 'circles',
        label: 'Círculo', icon: './images/icon_circle_black.svg',
        selectable: true, copiable: true, imageResource: false, selectionBox: false,
    }),
    Object.freeze({
        type: 'ellipse', storage: 'ellipses',
        label: 'Elipse', icon: './images/icon_ellipse_black.svg',
        selectable: true, copiable: true, imageResource: false, selectionBox: false,
    }),
    Object.freeze({
        type: 'rectangle', storage: 'rectangles',
        label: 'Retângulo', icon: './images/icon_rectangle_black.svg',
        selectable: true, copiable: true, imageResource: false, selectionBox: false,
    }),
    Object.freeze({
        // The irregular plural is the real bucket name, not a typo: `setores`, in Portuguese.
        type: 'sector', storage: 'setores',
        label: 'Setor', icon: './images/icon_sector_black.svg',
        selectable: true, copiable: true, imageResource: false, selectionBox: false,
    }),
    Object.freeze({
        type: 'text', storage: 'texts',
        label: 'Texto', icon: './images/icon_text_black.svg',
        selectable: true, copiable: true, imageResource: false, selectionBox: true,
    }),
    Object.freeze({
        type: 'image', storage: 'images',
        label: 'Imagem', icon: './images/icon_photo_black.svg',
        selectable: true, copiable: true, imageResource: true, selectionBox: true,
    }),
    Object.freeze({
        type: 'brush', storage: 'brushes',
        label: 'Pincel', icon: './images/icon_brush_black.svg',
        selectable: true, copiable: true, imageResource: false, selectionBox: false,
    }),

    // ----- military tools -----
    Object.freeze({
        type: 'arrow', storage: 'arrows',
        label: 'Seta', icon: './images/icon_arrow_black.svg',
        selectable: true, copiable: true, imageResource: false, selectionBox: false,
    }),
    Object.freeze({
        // Also irregular, and also not a typo: the bucket is `boundarys`, with the `y`.
        type: 'boundary', storage: 'boundarys',
        label: 'Limite', icon: './images/icon_boundary_black.svg',
        selectable: true, copiable: true, imageResource: false, selectionBox: false,
    }),
    Object.freeze({
        type: 'occupied_front', storage: 'occupied_fronts',
        label: 'Frente Ocupada', icon: './images/icon_occupied_front_black.svg',
        selectable: true, copiable: true, imageResource: false, selectionBox: false,
    }),
    Object.freeze({
        type: 'military_symbol', storage: 'military_symbols',
        label: 'Símbolo Militar', icon: './images/icon_military_black.svg',
        selectable: true, copiable: true, imageResource: true, selectionBox: true,
    }),
    Object.freeze({
        type: 'coordination_measure', storage: 'coordination_measures',
        label: 'Medida de Coordenação', icon: './images/icon_coordination_black.svg',
        selectable: true, copiable: true, imageResource: true, selectionBox: false,
    }),

    // ----- analysis tools -----
    // The four analysis rows come in two pairs: the INPUT geometry the operator draws
    // (`los`, `visibility`) and the OUTPUT the algorithm writes (`processed_*`). Both
    // pairs are alive and created side by side in `layers/styles/tactical.layers.js`;
    // reading the names as two spellings of one thing is a mistake this repository has
    // already made once, in writing.
    Object.freeze({
        type: 'los', storage: 'los',
        label: 'Linha de Visada', icon: './images/icon_los_black.svg',
        selectable: true, copiable: false, imageResource: false, selectionBox: false,
    }),
    Object.freeze({
        type: 'visibility', storage: 'visibility',
        label: 'Visibilidade', icon: './images/icon_visibility_black.svg',
        selectable: true, copiable: false, imageResource: false, selectionBox: false,
    }),
    Object.freeze({
        // Analysis OUTPUT. The bucket is the source name verbatim, NOT `source + 's'`:
        // the fallback spelling `processed_loss` sent a synced result into a phantom
        // bucket on the receiving peer, where it never rendered.
        //
        // `label`/`icon` are null and `selectable` is false because that is the product
        // today: outputs are drawn, never named in the tab, the legend or the selection.
        // `copiable` is true only because UNCOPYABLE_FEATURE_TYPES lists the two inputs
        // and not these; that is recorded here as observed, not adjudicated.
        type: 'processed_los', storage: 'processed_los',
        label: null, icon: null,
        selectable: false, copiable: true, imageResource: false, selectionBox: false,
    }),
    Object.freeze({
        type: 'processed_visibility', storage: 'processed_visibility',
        label: null, icon: null,
        selectable: false, copiable: true, imageResource: false, selectionBox: false,
    }),
    Object.freeze({
        type: 'magnetic_declination', storage: 'magnetic_declinations',
        label: 'Declinação Magnética', icon: './images/icon_declination_black.svg',
        selectable: true, copiable: true, imageResource: true, selectionBox: true,
    }),
]);
