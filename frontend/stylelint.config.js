// Path: stylelint.config.js

/**
 * Stylelint Configuration for EBGEO Project
 * @see https://stylelint.io/user-guide/configure
 */
export default {
    extends: ['stylelint-config-standard'],

    rules: {
        // ===== ERROR PREVENTION =====
        'block-no-empty': true,
        'color-no-invalid-hex': true,
        'declaration-block-no-duplicate-properties': true,
        'declaration-block-no-shorthand-property-overrides': true,
        'font-family-no-duplicate-names': true,
        'function-calc-no-unspaced-operator': true,
        'no-duplicate-selectors': true,
        'no-empty-source': true,
        'property-no-unknown': true,
        'selector-pseudo-class-no-unknown': true,
        'selector-pseudo-element-no-unknown': true,
        'string-no-newline': true,
        'unit-no-unknown': true,

        // ===== RELAXED RULES (for legacy/existing code) =====
        'no-descending-specificity': null,
        'selector-class-pattern': null,
        'selector-id-pattern': null,
        'custom-property-pattern': null,
        'keyframes-name-pattern': null,

        // ===== CODE STYLE =====
        'color-hex-length': 'short',
        'declaration-block-single-line-max-declarations': 3,
        'length-zero-no-unit': true,
        'shorthand-property-no-redundant-values': true,

        // ===== FORMATTING =====
        // Note: Formatting rules (indentation, max-empty-lines, etc.) were removed
        // in Stylelint 16.x. Use Prettier or @stylistic/stylelint-plugin if needed.

        // ===== VENDOR PREFIXES (handled by PostCSS/autoprefixer if needed) =====
        'property-no-vendor-prefix': null,
        'value-no-vendor-prefix': null,
        'selector-no-vendor-prefix': null,
        'at-rule-no-vendor-prefix': null,
        'media-feature-name-no-vendor-prefix': null,

        // ===== ALLOW MAPLIBRE/CESIUM SPECIFIC PATTERNS =====
        'selector-type-no-unknown': [true, {
            ignore: ['custom-elements']
        }],

        // ===== DISABLE ANNOYING RULES =====
        'alpha-value-notation': null,
        'color-function-notation': null,
        'declaration-block-no-redundant-longhand-properties': null
    },

    ignoreFiles: [
        'dist/**',
        'node_modules/**',
        '**/*.min.css',
        'public/**'
    ]
};
