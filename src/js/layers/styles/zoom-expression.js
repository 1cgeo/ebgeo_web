// Path: js/layers/styles/zoom-expression.js

/**
 * @fileoverview Zoom-invariant sizing as a MapLibre style expression.
 *
 * Every tool that keeps a feature at a constant SIZE ON THE GROUND while the
 * map zooms computes `base * 2^(zoom - createdAtZoom)` in JavaScript and writes
 * the result into a `calculated*` property, which the layer reads. That forced
 * fifteen `zoom` handlers to rewrite their collections on every frame of a zoom
 * gesture (see `tool_manager/helpers/zoom-correction.helpers.js`).
 *
 * The same number is what a composite expression computes on the GPU for free:
 * `['interpolate', ['exponential', 2], ['zoom'], z0, v0, z1, v1, ...]` with
 * `vk = base * 2^(zk - anchor)` at integer stops reproduces `base * 2^(zoom -
 * anchor)` EXACTLY between stops, because the interpolation factor of an
 * exponential-base-2 interpolate is `(2^(zoom - zk) - 1) / (2^(zk+1 - zk) - 1)`,
 * which is `2^(zoom - zk) - 1`, and `vk + (vk+1 - vk) * (2^(zoom - zk) - 1)`
 * collapses to `vk * 2^(zoom - zk)`. The clamp (`min`) lives inside each stop
 * value: where both neighbouring stops are clamped the value is the clamp, and
 * where the clamp bites between two stops the interpolation deviates from a
 * hard `min` inside that one zoom level only, which is invisible at the sizes
 * the clamps guard (255 px text, 500 px circles).
 *
 * The JavaScript pass keeps running at the END of a gesture (`zoomend`), so the
 * stored `calculated*` property is still right for the consumers that read it
 * (export, selection boxes, feature header); it no longer runs per frame.
 */

/** Integer zoom stops covering the whole MapLibre zoom range. */
export const ZOOM_STOPS = Object.freeze(Array.from({ length: 25 }, (_, z) => z));

/**
 * Builds the composite expression for one sized property.
 *
 * @param {Object} spec
 * @param {Array} spec.base - Expression for the base value, e.g. `['coalesce', ['get', 'size'], 10]`
 * @param {string} spec.anchor - Property holding the zoom the feature was anchored at
 * @param {number|null} [spec.anchorDefault=null] - Anchor used when the property is
 *   not a number; `null` means "no reference, no scaling" (factor 1), which is
 *   what `zoomScaleFactor` does in the JavaScript helper
 * @param {string} [spec.disabledFlag] - Property that, when `=== false`, disables
 *   the scaling and leaves the base value
 * @param {number} [spec.maxValue] - Upper clamp of the scaled value
 * @param {number} [spec.divideBy] - Divisor applied to the whole result (icon
 *   sizes are pixels over the image's half size)
 * @returns {Array} MapLibre expression
 */
export function zoomScaledExpression(spec) {
    const { base, anchor, anchorDefault = null, disabledFlag, maxValue, divideBy } = spec;
    if (!Array.isArray(base) || typeof anchor !== 'string') {
        throw new Error('zoomScaledExpression: base expression and anchor property are required');
    }

    const anchorExpr = anchorDefault === null
        ? ['get', anchor]
        : ['coalesce', ['get', anchor], anchorDefault];

    const stopValue = (z) => {
        let scaled = ['*', base, ['^', 2, ['-', z, anchorExpr]]];
        if (Number.isFinite(maxValue)) scaled = ['min', maxValue, scaled];

        const branches = [];
        if (disabledFlag) branches.push(['==', ['get', disabledFlag], false], base);
        if (anchorDefault === null) branches.push(['!=', ['typeof', ['get', anchor]], 'number'], base);

        const value = branches.length ? ['case', ...branches, scaled] : scaled;
        return Number.isFinite(divideBy) ? ['/', value, divideBy] : value;
    };

    const expression = ['interpolate', ['exponential', 2], ['zoom']];
    for (const z of ZOOM_STOPS) expression.push(z, stopValue(z));
    return expression;
}
