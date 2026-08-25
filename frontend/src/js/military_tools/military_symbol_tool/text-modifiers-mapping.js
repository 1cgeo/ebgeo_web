// Path: js/military_tools/military_symbol_tool/text-modifiers-mapping.js

/**
 * @fileoverview THE TRANSLATION FROM OUR FEATURE PROPERTIES TO THE FIELD NAMES `milsymbol.js` WANTS.
 *
 * ZERO IMPORTS, on purpose: this is the last step before a third-party library draws a symbol, and
 * it has to be exercisable in plain node. That is why it is not inside `military_symbol_generator.js`
 * any more, whose module graph pulls the milsymbol loader and the canvas PNG conversion.
 *
 * ================= DO NOT CONFUSE IT WITH `text_modifiers_catalog.js` =======
 *
 * The catalogue answers "WHICH fields does this symbol set offer, and with what label and
 * placeholder", keyed by symbol set. This module answers "given the properties a feature actually
 * carries, what does milsymbol call them". Different questions, and the catalogue is a table while
 * this is a mapping.
 *
 * ================= THE THREE THINGS THAT ARE NOT MECHANICAL =================
 *
 * Fourteen fields pass through under their own name, and those are not the interesting part. What
 * a reader has to know:
 *
 *  1. TWO fields are RENAMED, and only these two: `dateTimeGroup` becomes `dtg`, and `credibility`
 *     becomes `evaluationRating`, which is milsymbol's combined J+K field. Renaming them here and
 *     not at the point of storage is deliberate: our property names are what the UI, the sync
 *     envelope and the `.ebgeo` all speak, and milsymbol's are an implementation detail of the
 *     drawing step.
 *  2. THE FILTER ADMITS ZERO. It is `!== null && !== undefined && !== ''`, not `if (value)`. A
 *     `quantity` of 0 and an `altitudeDepth` of 0 are legitimate values that a person typed, and
 *     the falsy form would drop them silently. This repository spent 2026-08-24 finding that exact
 *     mistake in nine other domains; the form here was already right, and it is pinned so that a
 *     future simplification cannot quietly change it.
 *  3. THE TWO RENAMED FIELDS DO NOT GET THAT COURTESY, and it is a real asymmetry rather than an
 *     oversight to tidy away: their guard is `properties.x && properties.x !== ''`, so a `0` is
 *     dropped. It is harmless today because both carry text (a DTG string, a credibility letter),
 *     but a reader comparing the two halves will see the difference and should know it was looked
 *     at. Changing it would be a behaviour change with no defect behind it.
 */

/**
 * The fields that reach milsymbol under their own name.
 *
 * FROZEN AND EXPORTED because the count and the membership are the contract: a field added to the
 * modal that never reaches this list simply does not draw, with no error anywhere.
 * @type {ReadonlyArray<string>}
 */
export const DIRECT_TEXT_MODIFIER_FIELDS = Object.freeze([
    'uniqueDesignation',
    'higherFormation',
    'quantity',
    'reinforcedReduced',
    'additionalInformation',
    'type',
    'iffSif',
    'altitudeDepth',
    'equipmentTeardownTime',
    'location',
    'speed',
    'specialHeadquarters',
    'direction',
    'engagementBar',
]);

/**
 * The fields whose name differs between us and milsymbol.
 * @type {Readonly<Object<string, string>>}
 */
export const RENAMED_TEXT_MODIFIER_FIELDS = Object.freeze({
    dateTimeGroup: 'dtg',
    credibility: 'evaluationRating',
});

/**
 * Builds the text modifiers object milsymbol.js expects.
 *
 * @param {Object} properties - Feature properties.
 * @returns {Object} Only the modifiers that carry a value; never `undefined` entries.
 */
export function extractTextModifiers(properties) {
    const modifiers = {};
    if (!properties || typeof properties !== 'object') return modifiers;

    for (const field of DIRECT_TEXT_MODIFIER_FIELDS) {
        const value = properties[field];
        // NOT `if (value)`: a quantity of 0 is a value someone typed. See the header.
        if (value !== null && value !== undefined && value !== '') {
            modifiers[field] = value;
        }
    }

    for (const [nosso, deles] of Object.entries(RENAMED_TEXT_MODIFIER_FIELDS)) {
        // Kept as the original truthiness guard, deliberately, so this extraction changes NOTHING.
        // The asymmetry with the loop above is documented in the header.
        if (properties[nosso] && properties[nosso] !== '') {
            modifiers[deles] = properties[nosso];
        }
    }

    return modifiers;
}
