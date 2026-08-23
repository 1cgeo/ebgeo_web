// Path: js/street_view_tool/tile-upload-rects.js

/**
 * @fileoverview The rectangle bookkeeping of the 360 partial texture upload: which pieces of the
 * composed canvas go up to the GPU on the next frame, and how many of them.
 *
 * WHY THIS IS A MODULE OF ITS OWN, and not a closure inside `tile-loader.js` (which is where the
 * upstream `ebgeo_360` keeps it). NOT because the loader is untestable in node: it is testable, and
 * four suites already drive it there with `vi.mock` over the vendored three (a first draft of this
 * header claimed the opposite, and the claim was wrong). The reason is narrower and was MEASURED:
 * the envelope guard in `loteParaSubir` is INVISIBLE from the loader. Deleting it leaves
 * `frontend/tests/unit/tile-loader-consertos-de-desempenho.test.js` fully green, because the loader
 * only ever exposes the batch that survived the guard. That guard is the piece whose first version
 * measured WORSE than the defect it replaced, so it is exactly the piece that must have a test which
 * goes red when it is reverted. Exported here, it does; there, it does not.
 *
 * The port cost is real and is written down: this file is the FOURTH known adaptation of
 * `tile-loader.js` against `ebgeo_360/public/calibration/js/tile-loader.js`, on top of the three
 * declared in that repository's commit `741a9a4`. See `.claude/rules/common-tasks.md`
 * §"O par que DIVERGE".
 *
 * THE TWO EXTREMES THIS SITS BETWEEN, both measured by the original author on the real app:
 *
 * - One rectangle per tile zeroes the wasted area and pays 55 canvas read-backs per photo. Measured:
 *   117 ms of `drawImage` on the slow-machine profile, against 10 ms grouped. The machines in the
 *   barracks are generally old, so this is the worse extreme for the operator.
 * - A single bounding box zeroes the read-backs and uploads the whole canvas. Measured on the real
 *   app: 187.3 MB in 3 calls to paint 55 tiles, the largest of them 75.5 MB, which is the entire
 *   6144x3072 canvas. The rectangles of those same 55 tiles add up to 36.9 MB.
 *
 * The cause is geometric, not accidental: the frustum is 9 columns by 6 rows, so the bounding box of
 * any batch already covers almost everything.
 */

/**
 * How many rectangles go up to the GPU per frame, at most.
 *
 * EIGHT IS THE MIDDLE between the two measured costs in the file header. With eight, the 9x6 frustum
 * groups into bands: few read-backs, and an area close to the sum of the tiles instead of the canvas.
 * @constant {number}
 */
export const MAX_PEDACOS = 8;

/**
 * @typedef {object} Retangulo
 * @property {number} x0 - left edge, in canvas pixels
 * @property {number} y0 - top edge, in canvas pixels
 * @property {number} x1 - right edge, exclusive
 * @property {number} y1 - bottom edge, exclusive
 */

/**
 * Area of a rectangle, in canvas pixels.
 *
 * @param {Retangulo} r - the rectangle
 * @returns {number} the area, zero for an empty or inverted rectangle
 */
export function area(r) {
    return (r.x1 - r.x0) * (r.y1 - r.y0);
}

/**
 * The bounding box of two rectangles.
 *
 * @param {Retangulo} a - first rectangle
 * @param {Retangulo} b - second rectangle
 * @returns {Retangulo} a new rectangle enclosing both
 */
export function envolver(a, b) {
    return {
        x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0),
        x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1),
    };
}

/**
 * Adds one rectangle to the pending list, merging the pair that grows the area the least.
 *
 * It MUTATES `pedacos`, which is deliberate: this runs once per tile that lands, and returning a
 * fresh array would allocate on the hot path for no gain. The caller owns the list.
 *
 * A rectangle already contained in a pending one is dropped for free, which is the common case of
 * two tiles sharing a border after the outward rounding.
 *
 * @param {Retangulo[]} pedacos - the pending list, mutated in place
 * @param {Retangulo} novo - the rectangle that just changed on the canvas
 * @param {number} [max=MAX_PEDACOS] - ceiling on the list length
 * @returns {Retangulo[]} the same list, for chaining
 */
export function juntarPedaco(pedacos, novo, max = MAX_PEDACOS) {
    for (const r of pedacos) {
        if (novo.x0 >= r.x0 && novo.y0 >= r.y0 && novo.x1 <= r.x1 && novo.y1 <= r.y1) return pedacos;
    }
    pedacos.push(novo);
    while (pedacos.length > max) {
        let melhorI = 0;
        let melhorJ = 1;
        let menorCusto = Infinity;
        for (let i = 0; i < pedacos.length; i++) {
            for (let j = i + 1; j < pedacos.length; j++) {
                // The cost is the pixel the merge would start uploading WITHOUT needing to.
                const custo = area(envolver(pedacos[i], pedacos[j]))
                    - area(pedacos[i]) - area(pedacos[j]);
                if (custo < menorCusto) { menorCusto = custo; melhorI = i; melhorJ = j; }
            }
        }
        const fundido = envolver(pedacos[melhorI], pedacos[melhorJ]);
        pedacos.splice(melhorJ, 1);
        pedacos.splice(melhorI, 1);
        pedacos.push(fundido);
    }
    return pedacos;
}

/**
 * Decides what actually goes up: the list as it stands, or its single bounding box.
 *
 * THE GUARD AGAINST THE MERGE ITSELF, and it is not a detail. The rectangles in the list may
 * OVERLAP, and each one uploads on its own account: in the worst case eight bands almost the size of
 * the bounding box would upload the same area eight times. Measured by the original author: opening
 * the viewer went from 213.9 to 248.3 MiB when the list first landed WITHOUT this guard, that is,
 * the list came to cost MORE than the single box it was meant to replace.
 *
 * When the sum of the parts already reaches the bounding box, the box is strictly better: same area
 * covered, ONE canvas read-back instead of eight. That makes the worst case of this list exactly the
 * previous behaviour, never worse than it.
 *
 * @param {Retangulo[]} pedacos - the pending list
 * @returns {Retangulo[]} the list to upload, possibly collapsed to a single rectangle
 */
export function loteParaSubir(pedacos) {
    if (pedacos.length <= 1) return pedacos;
    const soma = pedacos.reduce((t, r) => t + area(r), 0);
    const tudo = pedacos.reduce(envolver);
    return soma >= area(tudo) ? [tudo] : pedacos;
}
