// Path: js/import_export/kmz/kml-style.js

/**
 * @fileoverview Pure mapping from EBGeo feature properties to KML style elements.
 *
 * KML colors are `aabbggrr` (alpha first, RGB byte order reversed) — the single
 * most common source of bugs when writing KML by hand.
 *
 * Two EBGeo concepts have no KML equivalent and are degraded here:
 * - `lineStyle` dash patterns: KML has no dash array, so lines become solid.
 * - `hatch*` fills: KML has no hatch pattern, so the hatch color becomes a solid fill.
 * Both are preserved in <ExtendedData> by the builder so nothing is silently lost.
 *
 * @module import_export/kmz/kml-style
 */

/** Fallback color used when a property is missing or unparseable. */
const FALLBACK_COLOR = '#000000';

/** KML color for fully opaque black, used when parsing fails entirely. */
const FALLBACK_KML_COLOR = 'ff000000';

/**
 * Feature types whose outline is rendered fully opaque by MapLibre.
 * In the app, line/polygon outlines paint at `line-opacity: 1` and only the
 * fill honours `opacity`. The export keeps that same appearance.
 */
const OPAQUE_OUTLINE = true;

/** Lower bound for KML icon scale, so a zero-size icon never disappears entirely. */
const ICON_SCALE_MIN = 0.05;

/** Upper bound for KML icon scale, guarding against absurd blow-ups. */
const ICON_SCALE_MAX = 20;

/**
 * Clamps a value into [0, 1], treating non-finite input as fully opaque.
 * Note `value ?? 1` would NOT guard NaN, hence the explicit isFinite check.
 *
 * @param {*} value - Candidate opacity
 * @returns {number} Opacity in [0, 1]
 */
function normalizeOpacity(value) {
    if (!Number.isFinite(value)) return 1;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

/**
 * Parses a CSS color into RGB byte components.
 * Supports `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()`.
 *
 * @param {string} color - CSS color string
 * @returns {{ r: number, g: number, b: number, a: number }|null} Components, or null if unparseable
 */
function parseColor(color) {
    if (typeof color !== 'string') return null;
    const value = color.trim().toLowerCase();
    if (value === '') return null;

    if (value.startsWith('#')) {
        const hex = value.slice(1);
        if (hex.length === 3) {
            const r = parseInt(hex[0] + hex[0], 16);
            const g = parseInt(hex[1] + hex[1], 16);
            const b = parseInt(hex[2] + hex[2], 16);
            return { r, g, b, a: 1 };
        }
        if (hex.length === 6 || hex.length === 8) {
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
            const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
            return { r, g, b, a };
        }
        return null;
    }

    const rgbMatch = value.match(/^rgba?\(([^)]+)\)$/);
    if (rgbMatch) {
        const parts = rgbMatch[1].split(',').map(p => Number(p.trim()));
        if (parts.length < 3) return null;
        const [r, g, b] = parts;
        if (![r, g, b].every(Number.isFinite)) return null;
        const a = parts.length >= 4 && Number.isFinite(parts[3]) ? parts[3] : 1;
        return { r, g, b, a };
    }

    return null;
}

/**
 * Converts a byte to a two-digit lowercase hex string.
 *
 * @param {number} value - Byte value (clamped to 0-255)
 * @returns {string} Two-digit hex
 */
function toHexByte(value) {
    const clamped = Math.max(0, Math.min(255, Math.round(value)));
    return clamped.toString(16).padStart(2, '0');
}

/**
 * Converts a CSS color plus an opacity multiplier into a KML `aabbggrr` color.
 *
 * The alpha of the source color and the `opacity` argument are multiplied, so
 * an `#rrggbbaa` input and a separate opacity property compose correctly.
 *
 * @param {string} color - CSS color string
 * @param {number} [opacity=1] - Opacity multiplier in [0, 1]
 * @returns {string} Eight-character KML color (`aabbggrr`)
 *
 * @example
 * toKmlColor('#ff0000', 1) // 'ffff0000' -> opaque red (bb=00, gg=00, rr=ff)
 */
export function toKmlColor(color, opacity = 1) {
    const parsed = parseColor(color) || parseColor(FALLBACK_COLOR);
    if (!parsed) return FALLBACK_KML_COLOR;

    const alpha = normalizeOpacity(parsed.a) * normalizeOpacity(opacity);

    return toHexByte(alpha * 255)
        + toHexByte(parsed.b)
        + toHexByte(parsed.g)
        + toHexByte(parsed.r);
}

/**
 * Resolves the outline color/width/opacity for a feature.
 * Different tools name the same concept differently (`lineColor` vs `color`).
 *
 * @param {Object} properties - Feature properties
 * @returns {{ color: string, width: number, opacity: number }} Normalized outline style
 */
export function resolveOutline(properties = {}) {
    const color = properties.lineColor || properties.color || FALLBACK_COLOR;
    const width = Number.isFinite(properties.lineWidth) ? properties.lineWidth : 2;
    const opacity = OPAQUE_OUTLINE
        ? 1
        : normalizeOpacity(properties.lineOpacity ?? properties.opacity);
    return { color, width, opacity };
}

/**
 * Resolves the fill color and opacity for a feature.
 * When a hatch pattern is enabled, the hatch color becomes the solid fill so
 * the exported polygon still reads as the user styled it.
 *
 * @param {Object} properties - Feature properties
 * @returns {{ color: string, opacity: number, degraded: boolean }} Normalized fill style
 */
export function resolveFill(properties = {}) {
    const hatched = properties.hatchEnabled === true && Boolean(properties.hatchColor);
    const color = hatched
        ? properties.hatchColor
        : (properties.fillColor || FALLBACK_COLOR);
    const rawOpacity = properties.fillOpacity ?? properties.opacity;
    return {
        color,
        opacity: normalizeOpacity(rawOpacity),
        degraded: hatched,
    };
}

/**
 * Builds the KML `<LineStyle>` fragment for a feature.
 *
 * @param {Object} properties - Feature properties
 * @returns {string} KML fragment
 */
export function buildLineStyle(properties = {}) {
    const { color, width, opacity } = resolveOutline(properties);
    return `<LineStyle><color>${toKmlColor(color, opacity)}</color><width>${width}</width></LineStyle>`;
}

/**
 * Builds the KML `<PolyStyle>` fragment for a feature.
 *
 * @param {Object} properties - Feature properties
 * @returns {string} KML fragment
 */
export function buildPolyStyle(properties = {}) {
    const { color, opacity } = resolveFill(properties);
    const fill = opacity > 0 ? 1 : 0;
    return `<PolyStyle><color>${toKmlColor(color, opacity)}</color><fill>${fill}</fill><outline>1</outline></PolyStyle>`;
}

/**
 * Normalizes an angle to [0, 360).
 * The app stores rotation as degrees clockwise from north, which is the same
 * convention as KML `<heading>`, so no sign flip is needed here.
 *
 * @param {number} degrees - Angle in degrees
 * @returns {number} Angle in [0, 360)
 */
export function normalizeHeading(degrees) {
    if (!Number.isFinite(degrees)) return 0;
    const wrapped = degrees % 360;
    // `+ 0` collapses -0 to 0 so serialized output never reads "-0".
    const positive = (wrapped < 0 ? wrapped + 360 : wrapped) + 0;
    // A tiny negative input (-1e-15) rounds to exactly 360 after the shift,
    // which would escape the [0, 360) range the caller relies on.
    return positive >= 360 ? 0 : positive;
}

/**
 * Computes the KML `<scale>` for an icon.
 * KML scale multiplies the PNG's own pixel size, so it is the ratio between
 * the size the app draws the symbol at and the symbol's native pixel size.
 *
 * @param {number} desiredPx - On-screen size the app renders, in CSS pixels
 * @param {number} nativePx - Intrinsic pixel size of the exported PNG
 * @returns {number} Scale clamped to [ICON_SCALE_MIN, ICON_SCALE_MAX]
 */
export function iconScale(desiredPx, nativePx) {
    if (!Number.isFinite(desiredPx) || !Number.isFinite(nativePx)) return 1;
    if (desiredPx <= 0 || nativePx <= 0) return ICON_SCALE_MIN;
    const ratio = desiredPx / nativePx;
    return Math.max(ICON_SCALE_MIN, Math.min(ICON_SCALE_MAX, ratio));
}

/**
 * Builds the KML `<IconStyle>` fragment for a point-like feature.
 *
 * @param {Object} options - Icon options
 * @param {string} [options.href] - Relative path of the icon inside the KMZ
 * @param {number} [options.scale=1] - Icon scale
 * @param {number} [options.heading=0] - Rotation in degrees, clockwise from north
 * @param {string} [options.color] - Tint color applied by Google Earth
 * @param {number} [options.opacity=1] - Icon opacity
 * @returns {string} KML fragment
 */
export function buildIconStyle({ href, scale = 1, heading = 0, color, opacity = 1 } = {}) {
    const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const tint = color ? `<color>${toKmlColor(color, opacity)}</color>` : '';
    const icon = href ? `<Icon><href>${href}</href></Icon>` : '';
    return `<IconStyle>${tint}<scale>${safeScale}</scale>`
        + `<heading>${normalizeHeading(heading)}</heading>${icon}`
        + `<hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/></IconStyle>`;
}

/**
 * Builds the KML `<LabelStyle>` fragment.
 *
 * @param {Object} options - Label options
 * @param {string} [options.color] - Label color
 * @param {number} [options.scale=1] - Label scale
 * @param {number} [options.opacity=1] - Label opacity
 * @returns {string} KML fragment
 */
export function buildLabelStyle({ color = FALLBACK_COLOR, scale = 1, opacity = 1 } = {}) {
    const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    return `<LabelStyle><color>${toKmlColor(color, opacity)}</color><scale>${safeScale}</scale></LabelStyle>`;
}

/**
 * Computes a stable signature for a style so identical styles share one
 * `<Style>` element (and one icon PNG) instead of being repeated per feature.
 *
 * @param {string} featureType - EBGeo feature type
 * @param {Object} properties - Feature properties
 * @param {string} [iconKey=''] - Icon identity, when the feature renders an icon
 * @returns {string} Signature usable as a map key
 */
export function styleSignature(featureType, properties = {}, iconKey = '') {
    const outline = resolveOutline(properties);
    const fill = resolveFill(properties);
    return [
        featureType,
        iconKey,
        outline.color,
        outline.width,
        outline.opacity,
        fill.color,
        fill.opacity,
        properties.rotation ?? 0,
        properties.size ?? '',
    ].join('|');
}

/**
 * Reports which style aspects could not be represented in KML, so the caller
 * can record them in <ExtendedData> rather than dropping them silently.
 *
 * @param {Object} properties - Feature properties
 * @returns {Object} Key/value pairs of degraded style information (may be empty)
 */
export function collectDegradedStyle(properties = {}) {
    const degraded = {};

    if (properties.lineStyle && properties.lineStyle !== 'solid') {
        degraded.lineStyle = properties.lineStyle;
    }
    if (properties.hatchEnabled === true) {
        degraded.hatchEnabled = 'true';
        if (properties.hatchType) degraded.hatchType = properties.hatchType;
        if (properties.hatchColor) degraded.hatchColor = properties.hatchColor;
        if (properties.hatchSpacing != null) degraded.hatchSpacing = String(properties.hatchSpacing);
    }

    return degraded;
}
