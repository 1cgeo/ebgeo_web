// Path: js/military_tools/military_symbol_tool/brazilian_svg_postprocessing.js

import {
    getCatalogEntry,
    getCatalogEntryWithStandardIdentity,
    getCommandElement,
    hasSection,
    supportsCommand,
    getSpecialModifiers,
    hasExtensions
} from './brazilian_extension_catalog.js';
import { BrazilianSIDCExtension } from './brazilian_sidc_extension.js';

/**
 * Apply Brazilian label translations to SVG
 * @param {string} svgString - Base SVG from milsymbol.js
 * @param {string} sidc20 - 20-digit SIDC
 * @param {string} symbolSetCode - Symbol set code (e.g., "10", "15")
 * @returns {string} Modified SVG with Brazilian labels
 */
export function applyBrazilianLabelsToSVG(svgString, sidc20, symbolSetCode) {
    if (!svgString || !sidc20 || !symbolSetCode) {
        return svgString;
    }

    let modifiedSVG = svgString;

    const mainIcon = sidc20.substring(10, 16);
    const modifier1 = sidc20.substring(16, 18);
    const modifier2 = sidc20.substring(18, 20);

    const mainIconMapping = getCatalogEntry(
        symbolSetCode,
        'mainIcon',
        'labelMappings',
        mainIcon
    );
    if (mainIconMapping) {
        modifiedSVG = replaceTextInSVG(modifiedSVG, mainIconMapping);
    }

    if (modifier1 !== '00') {
        const mod1Mapping = getCatalogEntry(
            symbolSetCode,
            'modifier1',
            'labelMappings',
            modifier1
        );
        if (mod1Mapping) {
            modifiedSVG = replaceTextInSVG(modifiedSVG, mod1Mapping);
        }
    }

    if (modifier2 !== '00' && hasSection(symbolSetCode, 'modifier2')) {
        const mod2Mapping = getCatalogEntry(
            symbolSetCode,
            'modifier2',
            'labelMappings',
            modifier2
        );
        if (mod2Mapping) {
            modifiedSVG = replaceTextInSVG(modifiedSVG, mod2Mapping);
        }
    }

    return modifiedSVG;
}

/**
 * Replace text in SVG based on mapping
 * @param {string} svgString - SVG to modify
 * @param {Object} mapping - { from: '...', to: '...', fontSize?: '...' }
 * @returns {string} Modified SVG
 */
function replaceTextInSVG(svgString, mapping) {
    const { from, to, fontSize } = mapping;

    let result = svgString.replace(`>${from}</text>`, `>${to}</text>`);

    if (fontSize && result !== svgString) {
        const pattern = new RegExp(
            `(<text[^>]*?)font-size="[^"]*"([^>]*>${to}</text>)`,
            'g'
        );
        result = result.replace(pattern, `$1font-size="${fontSize}"$2`);
    }

    return result;
}

/**
 * Apply graphic adaptations
 * @param {string} svgString - Base SVG
 * @param {string} code - Element code (6-digit for mainIcon, 2-digit for modifiers)
 * @param {string} elementType - Element type: 'mainIcon', 'modifier1', 'modifier2'
 * @param {string} symbolSetCode - Symbol set code (e.g., "10", "15")
 * @param {string|null} standardIdentity - Standard Identity value ("0"-"6")
 * @returns {string} Modified SVG with adapted element
 */
export function applyGraphicAdaptations(svgString, code, elementType, symbolSetCode, standardIdentity = null) {
    if (!svgString || !code || !elementType || !symbolSetCode) {
        return svgString;
    }

    const adaptation = getCatalogEntryWithStandardIdentity(
        symbolSetCode,
        elementType,
        'graphicAdaptations',
        code,
        null,
        standardIdentity
    );

    if (!adaptation) {
        return svgString;
    }

    return svgString.replace(adaptation.find, adaptation.replace);
}

/**
 * Build text SVG element from descriptor
 * @param {Object} descriptor - { position, text, style }
 * @returns {string} SVG text element
 */
function buildTextElement(descriptor) {
    const fontFamily = descriptor.style.fontFamily || 'Arial, sans-serif';

    return `<text x="${descriptor.position.x}" y="${descriptor.position.y}" text-anchor="middle" font-size="${descriptor.style.fontSize}" font-family="${fontFamily}" font-weight="${descriptor.style.fontWeight}" fill="${descriptor.style.fill}">${descriptor.text}</text>`;
}

/** The four engagement-bar colours a custom colour overrides. */
const ENGAGEMENT_BAR_COLORS = [
    /rgb\(128,224,255\)/g,
    /rgb\(255,255,128\)/g,
    /rgb\(170,255,170\)/g,
    /rgb\(255,128,128\)/g
];

/**
 * Convert HEX color to RGB string
 *
 * Validates first, like `CoordinationMeasureGenerator.hexToRgb` does. Without the
 * test, `parseInt` on a non-hex string wrote NaN channels straight into the SVG:
 * '#fff' became rgb(255,15,NaN) and 'vermelho' became rgb(NaN,NaN,14), silently.
 * @param {string} hex - HEX color (e.g., "#11FF00" or "11FF00")
 * @returns {string|null} RGB string (e.g., "rgb(17,255,0)"), or null when not a 6-digit hex
 */
function hexToRgb(hex) {
    const normalized = String(hex).replace(/^#/, '');

    if (!/^[0-9A-F]{6}$/i.test(normalized)) {
        return null;
    }

    const r = parseInt(normalized.substring(0, 2), 16);
    const g = parseInt(normalized.substring(2, 4), 16);
    const b = parseInt(normalized.substring(4, 6), 16);

    return `rgb(${r},${g},${b})`;
}

/**
 * Repaint the engagement bars with a custom colour, or leave the SVG untouched.
 * @param {string} svgString - SVG to recolour
 * @param {string|null} customColor - Custom color in HEX, or falsy for no change
 * @returns {string} SVG, unchanged when there is no colour or the colour is invalid
 */
function applyEngagementBarColor(svgString, customColor) {
    const customRgb = customColor ? hexToRgb(customColor) : null;

    if (!customRgb) {
        return svgString;
    }

    return ENGAGEMENT_BAR_COLORS.reduce(
        (svg, pattern) => svg.replace(pattern, customRgb),
        svgString
    );
}

/**
 * Complete Brazilian modifications pipeline.
 * Extensions are appended to SVG that already has zeroed codes (no removal needed).
 * @param {string} svgString - Base SVG from milsymbol.js
 * @param {string} sidc30 - SIDC with 30 digits
 * @param {string} symbolSetCode - Symbol set code (e.g., "10", "15")
 * @param {Object} customColor - Custom color
 * @returns {string} SVG with all Brazilian modifications applied
 */
export function applyBrazilianModifications(svgString, sidc30, symbolSetCode, customColor = null) {
    if (!symbolSetCode) {
        console.error('symbolSetCode is required for Brazilian modifications');
        return svgString;
    }

    const extension = BrazilianSIDCExtension.decode(sidc30.substring(20));
    const sidc20 = sidc30.substring(0, 20);

    const standardIdentity = sidc20.substring(3, 4);

    const mainIconCode = sidc20.substring(10, 16);
    const modifier1Code = sidc20.substring(16, 18);
    const modifier2Code = sidc20.substring(18, 20);

    let result = svgString;

    result = applyGraphicAdaptations(result, mainIconCode, 'mainIcon', symbolSetCode, standardIdentity);
    result = applyGraphicAdaptations(result, modifier1Code, 'modifier1', symbolSetCode, standardIdentity);
    result = applyGraphicAdaptations(result, modifier2Code, 'modifier2', symbolSetCode, standardIdentity);

    result = applyBrazilianLabelsToSVG(result, sidc20, symbolSetCode);

    if (!extension) {
        // Apply engagement bar color if custom color is set
        return applyEngagementBarColor(result, customColor);
    }
    if (hasExtensions(symbolSetCode, 'mainIcon', mainIconCode)) {
        const entityExt = getCatalogEntryWithStandardIdentity(
            symbolSetCode,
            'mainIcon',
            'extensions',
            mainIconCode,
            extension.entityExtension,            standardIdentity
        );

        if (entityExt) {
            const svg = entityExt.type === 'text'
                ? buildTextElement(entityExt)
                : entityExt.svg;
            result = result.replace('</svg>', svg + '</svg>');
        } else {
            console.warn(`Entity Extension ${extension.entityExtension} for code ${mainIconCode} not cataloged for Symbol Set ${symbolSetCode}`);
        }
    }

    if (extension.specialModifier > 0) {
        const modifiersCatalog = getSpecialModifiers(symbolSetCode);

        if (modifiersCatalog && modifiersCatalog[extension.specialModifier]) {
            const modifierEntry = modifiersCatalog[extension.specialModifier];

            let modifier = modifierEntry;
            if (modifierEntry.byStandardIdentity && modifierEntry.byStandardIdentity[standardIdentity]) {
                modifier = {
                    ...modifierEntry,
                    ...modifierEntry.byStandardIdentity[standardIdentity]
                };
            }

            const svg = modifier.type === 'text'
                ? buildTextElement(modifier)
                : modifier.svg;
            result = result.replace('</svg>', svg + '</svg>');
        } else {
            console.warn(`Special Modifier ${extension.specialModifier} not cataloged for Symbol Set ${symbolSetCode}`);
        }
    }

    if (hasSection(symbolSetCode, 'modifier2') &&
        hasExtensions(symbolSetCode, 'modifier2', modifier2Code)) {

        const mod2Ext = getCatalogEntryWithStandardIdentity(
            symbolSetCode,
            'modifier2',
            'extensions',
            modifier2Code,
            extension.mod2Extension,            standardIdentity
        );

        if (mod2Ext) {
            const svg = mod2Ext.type === 'text'
                ? buildTextElement(mod2Ext)
                : mod2Ext.svg;
            result = result.replace('</svg>', svg + '</svg>');
        } else {
            console.warn(`Mod2 Extension ${extension.mod2Extension} for code ${modifier2Code} not cataloged for Symbol Set ${symbolSetCode}`);
        }
    }

    if (hasExtensions(symbolSetCode, 'modifier1', modifier1Code)) {
        const mod1Ext = getCatalogEntryWithStandardIdentity(
            symbolSetCode,
            'modifier1',
            'extensions',
            modifier1Code,
            extension.mod1Extension,            standardIdentity
        );

        if (mod1Ext) {
            const svg = mod1Ext.type === 'text'
                ? buildTextElement(mod1Ext)
                : mod1Ext.svg;
            result = result.replace('</svg>', svg + '</svg>');
        } else {
            console.warn(`Mod1 Extension ${extension.mod1Extension} for code ${modifier1Code} not cataloged for Symbol Set ${symbolSetCode}`);
        }
    }

    if (extension.isCommand) {
        if (supportsCommand(symbolSetCode)) {
            const commandEntry = getCommandElement(symbolSetCode, standardIdentity);
            if (commandEntry) {
                result = result.replace('</svg>', commandEntry.svg + '</svg>');
            }
        } else {
            console.warn(`Command element not applicable for Symbol Set ${symbolSetCode}`);
        }
    }

    return applyEngagementBarColor(result, customColor);
}

/**
 * Check for uncataloged extensions and return warnings
 * @param {Object} extension - Decoded extension
 * @param {string} symbolSetCode - Symbol set code (e.g., "10", "15")
 * @param {string} sidc20 - 20-digit base SIDC
 * @returns {Array<string>} Array of warning messages
 */
export function checkCatalogWarnings(extension, symbolSetCode, sidc20) {
    if (!extension) return [];

    const warnings = [];

    const mainIconCode = sidc20 ? sidc20.substring(10, 16) : null;
    const modifier1Code = sidc20 ? sidc20.substring(16, 18) : null;
    const modifier2Code = sidc20 ? sidc20.substring(18, 20) : null;
    const standardIdentity = sidc20 ? sidc20.substring(3, 4) : null;

    if (extension.entityExtension !== null && extension.entityExtension !== undefined) {
        if (mainIconCode && hasExtensions(symbolSetCode, 'mainIcon', mainIconCode)) {
            const entityExt = getCatalogEntryWithStandardIdentity(
                symbolSetCode,
                'mainIcon',
                'extensions',
                mainIconCode,
                extension.entityExtension,
                standardIdentity
            );

            if (!entityExt) {
                warnings.push(`Entity Extension ${extension.entityExtension} not cataloged for icon ${mainIconCode}`);
            }
        }
    }

    if (extension.specialModifier > 0) {
        const modifiersCatalog = getSpecialModifiers(symbolSetCode);
        if (!modifiersCatalog || !modifiersCatalog[extension.specialModifier]) {
            warnings.push(`Special Modifier ${extension.specialModifier} not cataloged for Symbol Set ${symbolSetCode}`);
        }
    }

    if (extension.mod1Extension !== null && extension.mod1Extension !== undefined) {
        if (modifier1Code && modifier1Code !== '00' && hasExtensions(symbolSetCode, 'modifier1', modifier1Code)) {
            const mod1Ext = getCatalogEntryWithStandardIdentity(
                symbolSetCode,
                'modifier1',
                'extensions',
                modifier1Code,
                extension.mod1Extension,
                standardIdentity
            );

            if (!mod1Ext) {
                warnings.push(`Mod1 Extension ${extension.mod1Extension} not cataloged for modifier ${modifier1Code}`);
            }
        }
    }

    if (extension.mod2Extension !== null && extension.mod2Extension !== undefined) {
        if (!hasSection(symbolSetCode, 'modifier2')) {
            if (extension.mod2Extension > 0) {
                warnings.push(`Modifier 2 not applicable for Symbol Set ${symbolSetCode}`);
            }
        } else if (modifier2Code && modifier2Code !== '00' && hasExtensions(symbolSetCode, 'modifier2', modifier2Code)) {
            const mod2Ext = getCatalogEntryWithStandardIdentity(
                symbolSetCode,
                'modifier2',
                'extensions',
                modifier2Code,
                extension.mod2Extension,
                standardIdentity
            );

            if (!mod2Ext) {
                warnings.push(`Mod2 Extension ${extension.mod2Extension} not cataloged for modifier ${modifier2Code}`);
            }
        }
    }

    return warnings;
}
