// Path: js/draw_tools/point_tool/point-marker-symbols.js

/**
 * @fileoverview Marker symbol definitions and SDF image generator for points.
 * Generates canvas-based icons and loads them into MapLibre as SDF images
 * so they can be recolored at runtime via `icon-color`.
 */

/**
 * Available marker symbol definitions grouped by category.
 */
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
        ],
    },
    {
        label: 'Ícones',
        symbols: [
            { id: 'pin', label: 'Alfinete' },
            { id: 'flag', label: 'Bandeira' },
            { id: 'arrow-up', label: 'Seta' },
            { id: 'x-mark', label: 'X' },
            { id: 'plus', label: 'Mais' },
            { id: 'ring', label: 'Anel' },
        ],
    },
];

/** Pre-computed flat list of all symbol IDs. */
const ALL_SYMBOL_IDS = SYMBOL_CATEGORIES.flatMap(cat => cat.symbols.map(s => s.id));

/**
 * All symbol IDs in a flat array.
 * @returns {string[]}
 */
export function getSymbolIds() {
    return ALL_SYMBOL_IDS;
}

/**
 * Get symbol categories for the picker UI.
 * @returns {Array}
 */
export function getSymbolCategories() {
    return SYMBOL_CATEGORIES;
}

// --- SDF icon drawing helpers ------------------------------------------------

const ICON_SIZE = 48;
const HALF = ICON_SIZE / 2;
const PADDING = 4;
const INNER = HALF - PADDING;

/**
 * Draw a shape into a canvas context using white fill on transparent bg.
 * SDF rendering will tint the white areas with `icon-color`.
 */
const SHAPE_DRAWERS = {
    circle(ctx) {
        ctx.beginPath();
        ctx.arc(HALF, HALF, INNER, 0, Math.PI * 2);
        ctx.fill();
    },
    square(ctx) {
        const s = INNER * 1.6;
        ctx.fillRect(HALF - s / 2, HALF - s / 2, s, s);
    },
    diamond(ctx) {
        ctx.beginPath();
        ctx.moveTo(HALF, PADDING);
        ctx.lineTo(ICON_SIZE - PADDING, HALF);
        ctx.lineTo(HALF, ICON_SIZE - PADDING);
        ctx.lineTo(PADDING, HALF);
        ctx.closePath();
        ctx.fill();
    },
    triangle(ctx) {
        ctx.beginPath();
        ctx.moveTo(HALF, PADDING);
        ctx.lineTo(ICON_SIZE - PADDING, ICON_SIZE - PADDING);
        ctx.lineTo(PADDING, ICON_SIZE - PADDING);
        ctx.closePath();
        ctx.fill();
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
        ctx.fill();
    },
    cross(ctx) {
        const w = INNER * 0.5;
        ctx.fillRect(HALF - w / 2, PADDING, w, ICON_SIZE - PADDING * 2);
        ctx.fillRect(PADDING, HALF - w / 2, ICON_SIZE - PADDING * 2, w);
    },
    pin(ctx) {
        // Circle on top + triangle pointer below
        const r = INNER * 0.55;
        ctx.beginPath();
        ctx.arc(HALF, HALF - 4, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(HALF - r * 0.6, HALF + 2);
        ctx.lineTo(HALF, ICON_SIZE - PADDING);
        ctx.lineTo(HALF + r * 0.6, HALF + 2);
        ctx.closePath();
        ctx.fill();
    },
    flag(ctx) {
        // Pole + flag
        const poleX = HALF - 6;
        ctx.fillRect(poleX, PADDING, 3, ICON_SIZE - PADDING * 2);
        ctx.beginPath();
        ctx.moveTo(poleX + 3, PADDING + 2);
        ctx.lineTo(ICON_SIZE - PADDING, PADDING + 10);
        ctx.lineTo(poleX + 3, PADDING + 18);
        ctx.closePath();
        ctx.fill();
    },
    'arrow-up'(ctx) {
        const w = INNER * 0.5;
        ctx.beginPath();
        ctx.moveTo(HALF, PADDING);
        ctx.lineTo(ICON_SIZE - PADDING - 4, HALF + 4);
        ctx.lineTo(HALF + w / 2, HALF + 4);
        ctx.lineTo(HALF + w / 2, ICON_SIZE - PADDING);
        ctx.lineTo(HALF - w / 2, ICON_SIZE - PADDING);
        ctx.lineTo(HALF - w / 2, HALF + 4);
        ctx.lineTo(PADDING + 4, HALF + 4);
        ctx.closePath();
        ctx.fill();
    },
    'x-mark'(ctx) {
        const w = INNER * 0.35;
        ctx.save();
        ctx.translate(HALF, HALF);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-w / 2, -INNER, w, INNER * 2);
        ctx.fillRect(-INNER, -w / 2, INNER * 2, w);
        ctx.restore();
    },
    plus(ctx) {
        const w = INNER * 0.4;
        ctx.fillRect(HALF - w / 2, PADDING, w, ICON_SIZE - PADDING * 2);
        ctx.fillRect(PADDING, HALF - w / 2, ICON_SIZE - PADDING * 2, w);
    },
    ring(ctx) {
        const outerR = INNER;
        const innerR = INNER * 0.55;
        ctx.beginPath();
        ctx.arc(HALF, HALF, outerR, 0, Math.PI * 2);
        ctx.arc(HALF, HALF, innerR, 0, Math.PI * 2, true);
        ctx.fill();
    },
};

/**
 * Generate an SDF-ready canvas ImageData for a symbol.
 * @param {string} symbolId - Symbol identifier
 * @returns {{ width: number, height: number, data: Uint8Array }}
 */
function generateSymbolImage(symbolId) {
    const canvas = document.createElement('canvas');
    canvas.width = ICON_SIZE;
    canvas.height = ICON_SIZE;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
    ctx.fillStyle = '#ffffff';

    const drawer = SHAPE_DRAWERS[symbolId];
    if (drawer) {
        drawer(ctx);
    } else {
        // Fallback to circle
        SHAPE_DRAWERS.circle(ctx);
    }

    const imageData = ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE);
    return {
        width: ICON_SIZE,
        height: ICON_SIZE,
        data: new Uint8Array(imageData.data.buffer),
    };
}

/**
 * Load all marker symbol images into a MapLibre map instance.
 * Must be called once when the map is ready.
 * @param {Object} map - MapLibre map instance
 */
export function loadMarkerImages(map) {
    const ids = getSymbolIds();
    for (const id of ids) {
        const imageId = `marker-${id}`;
        if (map.hasImage(imageId)) continue;

        const img = generateSymbolImage(id);
        map.addImage(imageId, img, { sdf: true });
    }
}

/**
 * Render a symbol preview to a canvas element for the picker UI.
 * @param {string} symbolId - Symbol identifier
 * @param {number} [size=32] - Canvas size
 * @param {string} [color='#ffffff'] - Fill color
 * @returns {HTMLCanvasElement}
 */
export function renderSymbolPreview(symbolId, size = 32, color = '#ffffff') {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);

    // Scale to fit
    const scale = size / ICON_SIZE;
    ctx.save();
    ctx.scale(scale, scale);
    ctx.fillStyle = color;

    const drawer = SHAPE_DRAWERS[symbolId];
    if (drawer) {
        drawer(ctx);
    }
    ctx.restore();

    return canvas;
}
