// Path: js/draw_tools/point_tool/point-marker-symbols.js

/**
 * @fileoverview Marker symbol definitions and per-feature image generator for points.
 * Shapes and icons are rendered as per-feature canvas images with baked-in
 * fill color, border color, and border width. Circle markers use native
 * MapLibre circle layers and are not generated here.
 */

// ============================================================================
// SYMBOL CATEGORIES
// ============================================================================

const SYMBOL_CATEGORIES = [
    {
        label: 'Formas',
        symbols: [
            { id: 'circle', label: 'Círculo' },
            { id: 'square', label: 'Quadrado' },
            { id: 'diamond', label: 'Losango' },
            { id: 'triangle', label: 'Triângulo' },
            { id: 'star', label: 'Estrela' },
            { id: 'cross', label: 'Cruz' },
            { id: 'x-mark', label: 'X' },
        ],
    },
    {
        label: 'Ícones',
        symbols: [
            { id: 'car', label: 'Veículo' },
            { id: 'drone', label: 'Drone' },
            { id: 'fire', label: 'Incêndio' },
            { id: 'gun', label: 'Armamento' },
            { id: 'news', label: 'Comunicações' },
            { id: 'plane', label: 'Aeronave' },
            { id: 'supply', label: 'Suprimento' },
        ],
    },
];

/** Pre-computed flat list of all symbol IDs. */
const ALL_SYMBOL_IDS = SYMBOL_CATEGORIES.flatMap(cat => cat.symbols.map(s => s.id));

/** Flat list of all symbols for the picker UI. */
const ALL_SYMBOLS = SYMBOL_CATEGORIES.flatMap(cat => cat.symbols);

/** Icon symbol IDs (rendered with colored circle bg + white paths on map). */
export const ICON_SYMBOL_IDS = SYMBOL_CATEGORIES[1].symbols.map(s => s.id);
const ICON_SYMBOL_SET = new Set(ICON_SYMBOL_IDS);

/**
 * All symbol IDs in a flat array.
 * @returns {string[]}
 */
export function getSymbolIds() {
    return ALL_SYMBOL_IDS;
}

/**
 * Get all symbols as a flat list for the picker UI.
 * @returns {Array<{id: string, label: string}>}
 */
export function getAllSymbols() {
    return ALL_SYMBOLS;
}

// ============================================================================
// CANVAS CONSTANTS (2x resolution for crisp rendering at large sizes)
// ============================================================================

const ICON_SIZE = 96;
const PIXEL_RATIO = 2;
const HALF = ICON_SIZE / 2;
const PADDING = Math.round(ICON_SIZE / 12);
const INNER = HALF - PADDING;

/** Half-size of the generated image in CSS pixels (ICON_SIZE / PIXEL_RATIO / 2). */
export const POINT_IMAGE_HALF_SIZE = ICON_SIZE / PIXEL_RATIO / 2; // 24

// ============================================================================
// SHAPE PATH BUILDERS (canvas coordinate system: 0..ICON_SIZE)
// Each function constructs a path via beginPath + moveTo/lineTo/closePath.
// The caller is responsible for fill() and stroke().
// ============================================================================

const SHAPE_DRAWERS = {
    circle(ctx) {
        ctx.beginPath();
        ctx.arc(HALF, HALF, INNER, 0, Math.PI * 2);
    },
    square(ctx) {
        const s = INNER * 1.6;
        ctx.beginPath();
        ctx.rect(HALF - s / 2, HALF - s / 2, s, s);
    },
    diamond(ctx) {
        ctx.beginPath();
        ctx.moveTo(HALF, PADDING);
        ctx.lineTo(ICON_SIZE - PADDING, HALF);
        ctx.lineTo(HALF, ICON_SIZE - PADDING);
        ctx.lineTo(PADDING, HALF);
        ctx.closePath();
    },
    triangle(ctx) {
        ctx.beginPath();
        ctx.moveTo(HALF, PADDING);
        ctx.lineTo(ICON_SIZE - PADDING, ICON_SIZE - PADDING);
        ctx.lineTo(PADDING, ICON_SIZE - PADDING);
        ctx.closePath();
    },
    star(ctx) {
        const spikes = 5;
        const outerR = INNER;
        const innerR = INNER * 0.45;
        ctx.beginPath();
        for (let i = 0; i < spikes * 2; i++) {
            const r = i % 2 === 0 ? outerR : innerR;
            const angle = (Math.PI / spikes) * i - Math.PI / 2;
            const x = HALF + r * Math.cos(angle);
            const y = HALF + r * Math.sin(angle);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
    },
    cross(ctx) {
        const w = INNER * 0.5;
        const hw = w / 2;
        const top = PADDING;
        const bottom = ICON_SIZE - PADDING;
        const left = PADDING;
        const right = ICON_SIZE - PADDING;
        ctx.beginPath();
        ctx.moveTo(HALF - hw, top);
        ctx.lineTo(HALF + hw, top);
        ctx.lineTo(HALF + hw, HALF - hw);
        ctx.lineTo(right, HALF - hw);
        ctx.lineTo(right, HALF + hw);
        ctx.lineTo(HALF + hw, HALF + hw);
        ctx.lineTo(HALF + hw, bottom);
        ctx.lineTo(HALF - hw, bottom);
        ctx.lineTo(HALF - hw, HALF + hw);
        ctx.lineTo(left, HALF + hw);
        ctx.lineTo(left, HALF - hw);
        ctx.lineTo(HALF - hw, HALF - hw);
        ctx.closePath();
    },
    'x-mark'(ctx) {
        const w = INNER * 0.35;
        const hw = w / 2;
        ctx.save();
        ctx.translate(HALF, HALF);
        ctx.rotate(Math.PI / 4);
        ctx.beginPath();
        ctx.moveTo(-hw, -INNER);
        ctx.lineTo(hw, -INNER);
        ctx.lineTo(hw, -hw);
        ctx.lineTo(INNER, -hw);
        ctx.lineTo(INNER, hw);
        ctx.lineTo(hw, hw);
        ctx.lineTo(hw, INNER);
        ctx.lineTo(-hw, INNER);
        ctx.lineTo(-hw, hw);
        ctx.lineTo(-INNER, hw);
        ctx.lineTo(-INNER, -hw);
        ctx.lineTo(-hw, -hw);
        ctx.closePath();
        ctx.restore();
    },
};

// ============================================================================
// ICON SVG PATH DATA (viewBox 0 0 100 100)
// ============================================================================

/**
 * SVG path data for each icon, extracted from source SVGs.
 * Paths are drawn in a 0-100 coordinate system and scaled to canvas size.
 * @type {Record<string, { paths: string[], tx?: number, ty?: number }>}
 */
const ICON_PATH_DATA = {
    car: {
        paths: [
            'M73.716,49.418c-0.204-1.99-0.204-1.703-0.954-3.857c-0.765-2.183-2.379-6.455-3.533-8.981c-1.183-2.555-2.435-4.737-3.348-6.083c-0.906-1.344-1.147-1.459-2.003-1.831c-0.886-0.38-2.019-0.315-3.151-0.387c-1.124-0.101-2.301-0.15-3.554-0.15h-14.27c-1.281,0-2.485,0.049-3.611,0.15c-1.139,0.071-2.3,0.007-3.157,0.386c-0.87,0.371-1.118,0.487-2.003,1.832c-0.935,1.346-2.166,3.528-3.342,6.083c-1.168,2.527-2.782,6.799-3.532,8.981c-0.757,2.155-0.785,1.869-0.962,3.858c-0.191,2.003-0.553,5.804-0.185,7.922c0.348,2.047,1.211,3.436,2.287,4.437c1.068,0.995,2.428,1.511,4.105,1.547c-0.092,2.111-0.092,3.742,0,4.922c0.049,1.168-0.036,1.684,0.481,2.126c0.523,0.424,1.862,0.444,2.676,0.479c0.8,0.051,1.664,0.028,2.102-0.286c0.411-0.357,0.291-0.63,0.375-1.84c0.071-1.245,0.113-3.048,0.099-5.495h23.395c0.058,2.447,0.129,4.25,0.242,5.495c0.092,1.21-0.036,1.482,0.381,1.84c0.433,0.314,1.27,0.337,2.096,0.286c0.793-0.035,2.131-0.056,2.676-0.479c0.496-0.442,0.411-0.958,0.481-2.126c0.078-1.18,0.078-2.813,0-4.922c1.671-0.036,3.03-0.552,4.106-1.547c1.068-1.001,1.926-2.39,2.294-4.437C74.234,55.222,73.915,51.421,73.716,49.418z M33.042,58.107c-2.478,0-4.488-2.032-4.488-4.536c0-2.506,2.01-4.538,4.488-4.538c2.477,0,4.488,2.032,4.488,4.538C37.53,56.075,35.519,58.107,33.042,58.107z M56.384,57.238H43.635c-1.332,0-2.411-0.735-2.411-1.642s1.08-1.642,2.411-1.642h12.749c1.332,0,2.411,0.735,2.411,1.642S57.716,57.238,56.384,57.238z M56.384,52.795H43.635c-1.332,0-2.411-0.734-2.411-1.639c0-0.905,1.08-1.638,2.411-1.638h12.749c1.332,0,2.411,0.733,2.411,1.638C58.795,52.061,57.716,52.795,56.384,52.795z M58.426,44.208c-3.717,0.014-13.322,0.014-16.996,0c-3.646-0.029-3.327,0.029-4.778-0.1c-1.466-0.13-3.178-0.251-3.915-0.673c-0.736-0.458-0.652-0.974-0.481-1.933c0.177-0.981,0.792-2.433,1.437-3.864c0.623-1.46,1.536-3.607,2.195-4.731c0.623-1.13,0.927-1.517,1.62-1.932c0.687-0.421,1.544-0.485,2.486-0.58c0.92-0.121,1.939-0.143,3.058-0.094h13.911c1.111-0.049,2.131-0.027,3.058,0.094c0.92,0.093,1.776,0.157,2.484,0.58c0.688,0.416,0.963,0.802,1.622,1.932c0.658,1.124,1.557,3.271,2.2,4.731c0.603,1.432,1.261,2.883,1.43,3.864c0.156,0.958,0.241,1.474-0.48,1.933c-0.757,0.422-2.436,0.544-3.914,0.673C61.874,44.237,62.086,44.179,58.426,44.208z M66.973,58.107c-2.477,0-4.488-2.032-4.488-4.536c0-2.506,2.012-4.538,4.488-4.538s4.488,2.032,4.488,4.538C71.461,56.075,69.45,58.107,66.973,58.107z',
        ],
    },
    drone: {
        paths: [
            'M29.1901705,12.5343244 C30.1591197,13.4050355 30.7149987,14.6535155 30.7149987,15.9572787 L30.7149987,27.0431052 C30.7149987,28.3484041 30.1591197,29.5953484 29.1886349,30.4675952 L24.5819034,34.6138387 C23.7035533,35.4046962 22.6010088,35.7993572 21.5,35.7993572 C20.3989912,35.7993572 19.2964467,35.4046962 18.4180966,34.6138387 L13.8113651,30.4675952 C12.8424159,29.5968841 12.2865369,28.3484041 12.2865369,27.0446409 L12.2865369,15.9588143 C12.2865369,14.6535155 12.8424159,13.4065711 13.8129006,12.5343244 L18.4196322,8.38808089 C20.177868,6.80636579 22.8252031,6.80636579 24.583439,8.38808089 L29.1901705,12.5343244 Z M1.53903223,10.7514397 C1.93213999,10.7514397 2.32524775,10.6009464 2.6246853,10.3014955 L5.37797518,7.54808267 L10.168976,12.3392974 C10.5835818,11.5684032 11.0980002,10.8481853 11.7613695,10.2508192 L12.1099455,9.93754743 L7.54928131,5.37667961 L10.3025712,2.62173117 C10.9029819,2.02129369 10.9029819,1.04922995 10.3025712,0.45032811 C9.70216052,-0.15010937 8.73167574,-0.15010937 8.13126507,0.45032811 L0.453379163,8.13009241 C-0.147031515,8.73052989 -0.147031515,9.70259363 0.453379163,10.3014955 C0.752816713,10.6009464 1.14592447,10.7514397 1.53903223,10.7514397 Z M31.2432372,10.2508192 C31.9066066,10.8466497 32.4194893,11.5668676 32.8340952,12.3377617 L37.6235604,7.54808267 L40.3768503,10.3014955 C40.6762878,10.6009464 41.0693956,10.7514397 41.4625033,10.7514397 C41.8556111,10.7514397 42.2487189,10.6009464 42.5481564,10.3014955 C43.1485671,9.70105799 43.1485671,8.72899424 42.5481564,8.13009241 L34.8687349,0.451863756 C34.2683243,-0.148573724 33.2978395,-0.148573724 32.6974288,0.451863756 C32.0970181,1.05230124 32.0970181,2.02436498 32.6974288,2.62326682 L35.4522543,5.37667961 L30.8931256,9.93601179 L31.2432372,10.2508192 Z M11.7582984,32.7495648 C11.094929,32.1537342 10.5820462,31.4335164 10.1674404,30.6626222 L5.3764396,35.4538369 L2.62161414,32.7004241 C2.02120346,32.0999866 1.05071869,32.0999866 0.450308008,32.7004241 C-0.150102669,33.3008616 -0.150102669,34.2729253 0.450308008,34.8718272 L8.12972949,42.5500558 C8.42916704,42.8495067 8.8222748,43 9.21538256,43 C9.60849031,43 10.0015981,42.8495067 10.3010356,42.5500558 C10.9014463,41.9496183 10.9014463,40.9775546 10.3010356,40.3786527 L7.54774574,37.6252399 L12.10841,33.0643721 L11.7582984,32.7495648 L11.7582984,32.7495648 Z M40.3783859,32.6988884 L37.625096,35.4538369 L32.8356307,30.6641579 C32.4210249,31.435052 31.9066066,32.1552699 31.2432372,32.752636 L30.8946612,33.0659078 L35.4537898,37.6252399 L32.7005,40.3786527 C32.1000893,40.9790902 32.1000893,41.951154 32.7005,42.5500558 C32.9999375,42.8495067 33.3930453,43 33.786153,43 C34.1792608,43 34.5723685,42.8495067 34.8718061,42.5500558 L42.549692,34.8702915 C43.1501027,34.269854 43.1501027,33.2977903 42.549692,32.6988884 C41.9492813,32.098451 40.9787965,32.098451 40.3783859,32.6988884 L40.3783859,32.6988884 Z',
        ],
        tx: 28,
        ty: 27,
    },
    fire: {
        paths: [
            'M68.621,43.951c-8.432-1.103-11.11,3.58-11.11,4.96s-3.042-13.893,5.991-17.506c-8.732,1.204-14.353,6.223-14.353,11.342c0-9.636,1.205-18.268,7.728-22.483c-16.159,1.205-40.651,49.384-12.948,53.6c29.967,4.561,20.778-21.254,20.778-21.254S63.603,46.586,68.621,43.951z M46.614,70.354c-15.453-2.381-14.03-19.188-1.792-24.416c-1.494,4.425-2.849,9.382,1.969,13.106c0-2.854,3.259-7.456,8.13-8.129c-2.408,4.817-1.443,10.047-0.729,10.335c1.634,0.655,3.439,1.559,8.209-4.581C64.255,66.572,57.581,72.043,46.614,70.354z',
        ],
    },
    gun: {
        paths: [
            'M74.667,41.78v-4.892c0-0.605-0.495-1.097-1.1-1.097H32.033c-0.605,0-1.099,0.492-1.099,1.097v4.892c0,0.487,0.32,0.904,0.761,1.045h-0.103c-0.604,0-1.097,0.493-1.097,1.1v1.428c0,0.604,0.494,1.096,1.097,1.096h0.084c0.355,0.245,3.887,2.784,3.103,6.925c-0.825,4.354-9.889,14.835-3.625,14.835h10.053c0,0,2.424-8.032,4.761-14.331v0.037h10.96c0.067,0.006,0.214,0.012,0.411,0.012c0.392,0,0.978-0.026,1.573-0.22c0.296-0.094,0.601-0.235,0.876-0.464c0.274-0.229,0.51-0.563,0.608-0.969c0.066-0.269,0.256-0.831,0.494-1.478c0.358-0.977,0.831-2.179,1.216-3.131c0.196-0.492,0.37-0.916,0.491-1.217h10.969c0.604,0,1.098-0.492,1.098-1.096v-1.428c0-0.524-0.369-0.964-0.859-1.071C74.295,42.742,74.667,42.302,74.667,41.78z M60.371,48.158c-0.281,0.72-0.575,1.48-0.82,2.146c-0.246,0.669-0.441,1.233-0.538,1.624c-0.026,0.093-0.06,0.146-0.145,0.217c-0.124,0.108-0.384,0.22-0.683,0.279c-0.296,0.058-11.69,0.061-11.69,0.061c1.292-3.346,2.496-5.92,3.173-6.015c0.05-0.006,0.086-0.016,0.108-0.022h1.207c-0.141,0.674-0.502,3.159,1.578,4.391c2.419,1.429,0.606-0.826,0.164-1.485c-0.425-0.642-0.802-2.118-0.11-2.906h8.441C60.863,46.923,60.622,47.524,60.371,48.158z',
        ],
    },
    news: {
        paths: [
            'M75.226,44.4c-1.722-10.877-6.545-19.173-10.741-18.498c-1.857,0.285-3.29,2.258-4.168,5.294c-1.82,1.618-4.603,3.304-7.771,4.906l1.734,3.541l5.396-2.647c-0.152,0.743-0.27,1.585-0.337,2.498c0.017,2.309,0.219,4.771,0.623,7.317c0.439,2.799,1.08,5.43,1.873,7.757c0.271,0.556,0.558,1.046,0.859,1.467l-7.282-0.69l-0.304,3.236c3.658,0.423,7.046,1.18,9.661,2.429c1.854,2.968,3.964,4.64,5.95,4.317C74.922,64.669,76.944,55.293,75.226,44.4z M66.234,55.832c-1.129,0.186-2.714-3.947-3.558-9.208c-0.826-5.245-0.59-9.663,0.538-9.848c1.131-0.168,2.732,3.946,3.561,9.208C67.601,51.245,67.364,55.646,66.234,55.832z',
            'M51.16,36.778l-1.552,0.742c-7.874,3.642-16.913,6.661-19.426,7.504c-0.033,0.017-0.05,0.017-0.084,0.017c-3.473,0.54-5.936,3.524-5.936,6.93c0,0.354,0.034,0.726,0.084,1.097c0.608,3.777,4.131,6.39,7.925,5.851l1.603,9.26c0.286,0.808,1.028,1.938,2.714,1.651l3.339-0.287c1.686-0.304,1.939-1.029,1.653-2.716l-1.4-8.582c3.996-0.188,8.853-0.256,13.457,0.167c0.521,0.051,1.063,0.103,1.567,0.169l0.304-3.236l-1.567-0.152L43.47,54.213c0,0,0,0-0.018,0.001c-1.096,0.085-2.176-0.54-2.9-1.584c-0.438-0.625-0.758-1.4-0.894-2.261c-0.05-0.303-0.066-0.588-0.066-0.875c0-0.456,0.05-0.894,0.167-1.299c0.355-1.399,1.282-2.445,2.497-2.648l9.106-4.47l2.917-1.433l-1.736-3.541C52.088,36.323,51.631,36.56,51.16,36.778z',
        ],
    },
    plane: {
        paths: [
            'M75.256,38.772H55.284c0-0.003,0-0.007,0-0.01v-0.941h-0.008c-0.021-0.146-0.083-0.317-0.177-0.501c-0.211-1.695-0.657-4.573-1.447-7.065h7.854c0.558,0,1.01-0.451,1.01-1.008c0-0.558-0.452-1.009-1.01-1.009H52.88c-0.743-1.589-1.695-2.714-2.903-2.714c-1.221,0-2.157,1.124-2.871,2.714h-8.41c-0.558,0-1.009,0.451-1.009,1.009c0,0.557,0.451,1.008,1.009,1.008h7.676c-0.779,2.617-1.164,5.659-1.325,7.312c-0.029,0.087-0.052,0.17-0.063,0.243l-0.006,0.517c0,0.003,0,0.006,0,0.008l-0.002,0.379l-0.001,0.049v0.009H24.946c-2.148,0-3.83,1.33-3.83,3.026v4.931c0,1.67,1.631,2.984,3.73,3.026l20.925,3.962c0.216,2.189,0.465,4.479,0.731,6.706l-8.028,1.118v5.982l8.767,0.751c0.028,0.002,0.058,0.004,0.086,0.004c0.057,0,0.107-0.021,0.162-0.031c-0.002,0.227-0.007,0.451-0.007,0.683c0,1.318,0.059,2.568,0.164,3.521c0.105,0.946,0.35,3.161,2.37,3.161s2.265-2.215,2.37-3.161c0.085-0.765,0.138-1.724,0.154-2.753c0.075-0.44,0.152-0.92,0.231-1.435c0.027,0.002,0.048,0.015,0.074,0.015c0.028,0,0.056-0.001,0.085-0.003l8.939-0.75v-5.985l-8.088-1.103c0-0.002,0-0.003,0-0.004c0.25-2.21,0.487-4.511,0.693-6.726l20.88-3.953c2.1-0.042,3.73-1.354,3.73-3.026v-4.931C79.086,40.102,77.404,38.772,75.256,38.772z M46.992,38.133c0.21-0.331,1.123-1.564,3.014-1.564c1.725,0,2.816,1.027,3.191,1.506c0.013,0.13,0.021,0.252,0.028,0.365c-0.332-0.02-0.775-0.104-1.209-0.186c-0.606-0.116-1.232-0.237-1.796-0.237c-0.558,0-1.199,0.122-1.817,0.239c-0.51,0.098-1.04,0.198-1.412,0.205L46.992,38.133z',
        ],
    },
    supply: {
        paths: [
            'M26.839,34.492v29.016L50,72.713l23.161-9.205V34.492L50,25.288L26.839,34.492z M65.711,36.235L50,42.48l-15.711-6.245L50,29.991L65.711,36.235z M31.211,39.717l16.603,6.598v20.826l-16.603-6.599V39.717z M52.186,67.139V46.314l16.604-6.597v20.825L52.186,67.139z',
            'M55.324,35.663v1.21c0,0.157-0.203,0.289-0.456,0.289h-3.494v2.272c0,0.165-0.202,0.289-0.443,0.289h-1.86c-0.241,0-0.444-0.124-0.444-0.289v-2.272h-3.493c-0.253,0-0.456-0.132-0.456-0.289v-1.21c0-0.164,0.203-0.288,0.456-0.288h3.493v-2.28c0-0.157,0.203-0.289,0.444-0.289h1.86c0.241,0,0.443,0.132,0.443,0.289v2.28h3.494C55.121,35.375,55.324,35.499,55.324,35.663z',
        ],
    },
};

// ============================================================================
// UNIFIED SYMBOL DRAWING
// ============================================================================

/**
 * Draw a symbol onto a canvas context at the given size (fill only, no stroke).
 * Used by renderSymbolPreview for the picker UI.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} symbolId
 * @param {number} canvasSize - Target canvas dimension
 * @param {string} color - Fill color
 */
function drawSymbol(ctx, symbolId, canvasSize, color) {
    const shapeDrawer = SHAPE_DRAWERS[symbolId];
    if (shapeDrawer) {
        const scale = canvasSize / ICON_SIZE;
        ctx.save();
        ctx.scale(scale, scale);
        ctx.fillStyle = color;
        shapeDrawer(ctx);
        ctx.fill();
        ctx.restore();
        return;
    }

    const iconData = ICON_PATH_DATA[symbolId];
    if (iconData) {
        drawIconPaths(ctx, symbolId, canvasSize, color);
    }
}

/**
 * Draw icon SVG paths onto a canvas context.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} symbolId
 * @param {number} canvasSize - Target canvas dimension
 * @param {string} color - Fill color for the icon paths
 */
function drawIconPaths(ctx, symbolId, canvasSize, color) {
    const iconData = ICON_PATH_DATA[symbolId];
    if (!iconData) return;

    const s = canvasSize / 100;
    ctx.save();
    ctx.scale(s, s);
    if (iconData.tx || iconData.ty) {
        ctx.translate(iconData.tx || 0, iconData.ty || 0);
    }
    ctx.fillStyle = color;
    for (const pathStr of iconData.paths) {
        ctx.fill(getPath2D(pathStr));
    }
    ctx.restore();
}

// ============================================================================
// SHARED RESOURCES (canvas reuse + Path2D cache)
// ============================================================================

/** Shared canvas for generatePointImage (avoids DOM element allocation per call). */
let _sharedCanvas = null;

/** @type {Map<string, Path2D>} Cached Path2D objects by SVG path string. */
const _path2dCache = new Map();

/**
 * Get or create a cached Path2D from an SVG path string.
 * @param {string} pathStr
 * @returns {Path2D}
 */
function getPath2D(pathStr) {
    let p = _path2dCache.get(pathStr);
    if (!p) {
        p = new Path2D(pathStr);
        _path2dCache.set(pathStr, p);
    }
    return p;
}

// ============================================================================
// PER-FEATURE IMAGE GENERATION
// ============================================================================

/**
 * Generate a per-feature marker image with baked-in colors and border.
 * For shapes: draws the shape path with fill + stroke.
 * For icons: draws a colored circle bg with optional border + white icon.
 *
 * @param {string} symbolId - Symbol identifier (e.g. 'triangle', 'car')
 * @param {string} fillColor - Fill color for the shape or icon background
 * @param {string} lineColor - Stroke/border color
 * @param {number} lineWidth - Border width in CSS pixels (0 = no border)
 * @returns {{ width: number, height: number, data: Uint8Array }}
 */
export function generatePointImage(symbolId, fillColor, lineColor, lineWidth) {
    if (!_sharedCanvas) {
        _sharedCanvas = document.createElement('canvas');
        _sharedCanvas.width = ICON_SIZE;
        _sharedCanvas.height = ICON_SIZE;
    }
    const ctx = _sharedCanvas.getContext('2d');
    ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE);

    if (ICON_SYMBOL_SET.has(symbolId)) {
        // Icon: colored circle background with optional border + white icon paths
        ctx.beginPath();
        ctx.arc(HALF, HALF, INNER, 0, Math.PI * 2);
        ctx.fillStyle = fillColor;
        ctx.fill();
        if (lineWidth > 0) {
            ctx.strokeStyle = lineColor;
            ctx.lineWidth = lineWidth * PIXEL_RATIO;
            ctx.stroke();
        }
        drawIconPaths(ctx, symbolId, ICON_SIZE, '#ffffff');
    } else {
        // Shape: construct path, fill, then stroke for even borders
        const drawer = SHAPE_DRAWERS[symbolId];
        if (drawer) {
            ctx.fillStyle = fillColor;
            ctx.lineJoin = 'round';
            drawer(ctx);
            ctx.fill();
            if (lineWidth > 0) {
                ctx.strokeStyle = lineColor;
                ctx.lineWidth = lineWidth * PIXEL_RATIO;
                ctx.stroke();
            }
        }
    }

    const imageData = ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE);
    return {
        width: ICON_SIZE,
        height: ICON_SIZE,
        data: new Uint8Array(imageData.data.buffer),
    };
}

/**
 * Check if a marker symbol requires a per-feature image (non-circle).
 * @param {string} markerSymbol
 * @returns {boolean}
 */
export function needsPerFeatureImage(markerSymbol) {
    return !!markerSymbol && markerSymbol !== 'circle';
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Render a symbol preview to a canvas element for the picker UI.
 * Shapes render as solid colored silhouettes.
 * Icons render as a colored circle background with a white symbol.
 * @param {string} symbolId - Symbol identifier
 * @param {number} [size=32] - Canvas size
 * @param {string} [color='#000000'] - Fill color (shape fill or icon circle bg)
 * @returns {HTMLCanvasElement}
 */
export function renderSymbolPreview(symbolId, size = 32, color = '#000000') {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');

    if (ICON_SYMBOL_SET.has(symbolId)) {
        const circleR = size * 0.42;
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, circleR, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        drawSymbol(ctx, symbolId, size, '#ffffff');
    } else {
        drawSymbol(ctx, symbolId, size, color);
    }

    return canvas;
}
