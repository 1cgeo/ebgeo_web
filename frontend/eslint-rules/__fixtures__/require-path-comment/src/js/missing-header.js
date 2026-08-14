/**
 * NEGATIVE CONTROL (positive half) for require-path-comment.
 *
 * This file has no `// Path:` line at all, and opens with a `/**` block just
 * like the eleven `js/calibration/` files did. It MUST be reported, and the
 * autofix MUST insert the header ABOVE this block, not replace it.
 *
 * Its real location ends in `src/js/missing-header.js`, so the expected header
 * is `// Path: js/missing-header.js`.
 */

// EXPECT: require-path-comment

export function semCabecalho() {
    return 'sem cabeçalho';
}
