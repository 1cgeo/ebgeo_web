// Path: js/layers/layer-style/layer-style.schema.js

/**
 * @fileoverview Declarative schema describing which MapLibre paint/layout
 * properties the structured style editor exposes per sub-layer.
 *
 * The managers supply the concrete default values (the real config expressions);
 * this schema only declares the editable surface: which props, their display
 * label, whether each output is a color or a number, and the scalar-control
 * range used when a property is a plain constant.
 *
 * `outputType` drives the per-category / per-stop editor for data-driven values:
 *   - 'color'  → color + alpha control
 *   - 'number' → numeric control (range)
 *
 * `layout: true` marks a property applied via setLayoutProperty (vs setPaint).
 */

/** Paint/layout props that must be applied with setLayoutProperty. */
export const LAYOUT_PROPS = new Set(['text-size']);

/**
 * Editable sub-layers for vector (data) layers, in display order. `key` matches
 * the manager's MapLibre layer suffix (`data-${id}-${key}`).
 */
export const VECTOR_SUBLAYERS = [
    {
        key: 'fill',
        title: 'Preenchimento',
        props: [
            { prop: 'fill-color', label: 'Cor', outputType: 'color' },
            { prop: 'fill-opacity', label: 'Opacidade', outputType: 'number', min: 0, max: 1, step: 0.01, format: 'percent' }
        ]
    },
    {
        key: 'border',
        title: 'Borda',
        props: [
            { prop: 'line-color', label: 'Cor', outputType: 'color' },
            { prop: 'line-width', label: 'Espessura', outputType: 'number', min: 0, max: 20, step: 0.5, format: 'px' },
            { prop: 'line-opacity', label: 'Opacidade', outputType: 'number', min: 0, max: 1, step: 0.01, format: 'percent' }
        ]
    },
    {
        key: 'label',
        title: 'Rótulo',
        props: [
            { prop: 'text-color', label: 'Cor do texto', outputType: 'color' },
            { prop: 'text-halo-color', label: 'Cor do contorno', outputType: 'color' },
            { prop: 'text-halo-width', label: 'Espessura do contorno', outputType: 'number', min: 0, max: 5, step: 0.5, format: 'px' },
            { prop: 'text-size', label: 'Tamanho', outputType: 'number', min: 8, max: 40, step: 1, format: 'px', layout: true }
        ]
    }
];

/**
 * Editable sub-layer for raster (analysis) layers. Raster paint is always
 * scalar (the tiles are pre-rendered RGB), so these are plain constants.
 */
export const RASTER_SUBLAYER = {
    key: 'raster',
    title: 'Raster',
    props: [
        { prop: 'raster-opacity', label: 'Opacidade', outputType: 'number', min: 0, max: 1, step: 0.01, format: 'percent' },
        { prop: 'raster-brightness-min', label: 'Brilho mínimo', outputType: 'number', min: 0, max: 1, step: 0.01, format: 'percent' },
        { prop: 'raster-brightness-max', label: 'Brilho máximo', outputType: 'number', min: 0, max: 1, step: 0.01, format: 'percent' },
        { prop: 'raster-contrast', label: 'Contraste', outputType: 'number', min: -1, max: 1, step: 0.01, format: 'signed' },
        { prop: 'raster-saturation', label: 'Saturação', outputType: 'number', min: -1, max: 1, step: 0.01, format: 'signed' },
        { prop: 'raster-hue-rotate', label: 'Matiz', outputType: 'number', min: 0, max: 360, step: 1, format: 'deg' }
    ]
};

/**
 * Formats a numeric value for display next to a control.
 * @param {string} format - One of 'percent' | 'signed' | 'deg' | 'px' | 'plain'.
 * @param {number} value
 * @returns {string}
 */
export function formatNumber(format, value) {
    const n = Number(value);
    switch (format) {
        case 'percent': return `${Math.round(n * 100)}%`;
        case 'signed': return n.toFixed(2);
        case 'deg': return `${Math.round(n)}°`;
        case 'px': return `${n}px`;
        default: return String(n);
    }
}
