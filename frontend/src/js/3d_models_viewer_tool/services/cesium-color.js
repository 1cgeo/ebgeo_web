// Path: js/3d_models_viewer_tool/services/cesium-color.js

/**
 * @fileoverview Shared Cesium color conversion utility for 3D tools.
 * Provides hex-to-Cesium.Color conversion used by marker, measurement,
 * and viewshed tools.
 */

/**
 * Converts hex color string to Cesium.Color.
 * @param {string} hex - Hex color string (e.g., '#ff0000')
 * @param {number} [alpha=1] - Alpha value (0-1)
 * @returns {Cesium.Color} Cesium color instance
 */
export function hexToCesiumColor(hex, alpha = 1) {
    if (!hex) return Cesium.Color.WHITE.withAlpha(alpha);

    const cleanHex = hex.replace('#', '');
    const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
    const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
    const b = parseInt(cleanHex.substring(4, 6), 16) / 255;

    return new Cesium.Color(r, g, b, alpha);
}
