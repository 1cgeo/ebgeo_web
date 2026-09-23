// Path: js/layers/styles/icon-offset.expression.js

/**
 * @fileoverview The data-driven `icon-offset` of the coordination measures
 * layer, kept in a module of its own so it can be compiled by MapLibre's own
 * parser in a node unit test.
 *
 * WHY A SEPARATE FILE. `symbol.layers.js` imports `getControl` from the store
 * barrel, which drags the whole persistence layer (LocalForage and friends)
 * into any test that merely wants to validate a style expression. This module
 * is pure data, `symbol.layers.js` uses THIS constant, and the test compiles
 * THIS constant — so what is validated is literally what the layer applies.
 *
 * WHAT IT DOES. Symbol bitmaps are cropped to the drawn content, so the
 * bitmap centre is not always the point the drawing must sit on (the nucleus of
 * a coordination measure anchors its ELLIPSE CENTRE, with the echelon glyph and
 * the identification text hanging below it). The generator writes the
 * difference into `properties.iconOffset` as `[dx, dy]` in ICON PIXELS —
 * i.e. at `icon-size` 1, positive right/down — and MapLibre shifts the shaped
 * icon by it before rotation and alignment
 * (`maplibre-gl/src/symbol/shaping.ts:740` `x1 = dx - image.displaySize[0] * horizontalAlign`).
 * Features generated before the crop carry no `iconOffset` and coalesce to
 * `[0, 0]`, which is the style default anyway.
 *
 * `icon-offset` is `"property-type": "data-driven"` in the style spec
 * (`@maplibre/maplibre-gl-style-spec/src/reference/v8.json:1980`), so a
 * `['get', ...]` is legal here and MapLibre evaluates it per feature
 * (`maplibre-gl/src/symbol/symbol_layout.ts:236`).
 *
 * @see src/js/tool_manager/helpers/hit-test.model.js - the JavaScript replica
 *   of this shift, used to rebuild the drawn rectangle for the hit-test
 */

/**
 * Tile queries evaluate layout before GeoJSONFeature decodes the JSON-prefixed
 * properties. Accept that representation as well as the worker's numeric pair;
 * otherwise querying a correctly drawn icon warns and reports a zero offset.
 * `semiliteral` builds a numeric pair without changing persisted properties.
 * @constant {Array}
 */
export const ICON_OFFSET_EXPRESSION = [
    'let', 'offset', ['get', 'iconOffset'],
    ['case', ['==', ['typeof', ['var', 'offset']], 'string'],
        ['let', 'text', ['string', ['var', 'offset']],
            ['let', 'start', ['+', ['index-of', '[', ['var', 'text']], 1],
            'comma', ['index-of', ',', ['var', 'text']],
            'end', ['index-of', ']', ['var', 'text']],
            ['case', ['all',
                ['>', ['var', 'start'], 0],
                ['>', ['var', 'comma'], ['var', 'start']],
                ['>', ['var', 'end'], ['var', 'comma']],
            ],
            ['array', 'number', 2, ['semiliteral', [
                ['to-number', ['slice', ['var', 'text'], ['var', 'start'], ['var', 'comma']], 0],
                ['to-number', ['slice', ['var', 'text'], ['+', ['var', 'comma'], 1], ['var', 'end']], 0],
            ]]],
            ['literal', [0, 0]]]]],
        ['array', 'number', 2, ['var', 'offset'], ['literal', [0, 0]]],
    ],
];
