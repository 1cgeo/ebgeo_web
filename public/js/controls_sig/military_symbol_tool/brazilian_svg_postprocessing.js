// Path: js\controls_sig\military_symbol_tool\brazilian_svg_postprocessing.js

import { getCatalogEntry } from './brazilian_extension_catalog.js';
import { BrazilianSIDCExtension } from './brazilian_sidc_extension.js';

/**
 * ========================================
 * SITUAÇÃO 1: ADAPTAÇÃO DE TEXTO
 * ========================================
 * Substitui textos americanos por brasileiros
 * Suporta: Main Icon, Modifier 1, Modifier 2
 */

/**
 * Apply Brazilian label translations to SVG
 * @param {string} svgString - Base SVG from milsymbol.js
 * @param {string} sidc20 - 20-digit SIDC
 * @returns {string} Modified SVG with Brazilian labels
 */
export function applyBrazilianLabelsToSVG(svgString, sidc20) {
    if (!svgString || !sidc20) {
        return svgString;
    }

    let modifiedSVG = svgString;

    // Extract codes from SIDC
    const mainIcon = sidc20.substring(10, 16);    // Positions 11-16
    const modifier1 = sidc20.substring(16, 18);   // Positions 17-18
    const modifier2 = sidc20.substring(18, 20);   // Positions 19-20

    // 1. Process Main Icon labels
    const mainIconMapping = getCatalogEntry('mainIcon', mainIcon);
    if (mainIconMapping) {
        modifiedSVG = replaceTextInSVG(modifiedSVG, mainIconMapping);
    }

    // 2. Process Modifier 1 labels (only if not '00')
    if (modifier1 !== '00') {
        const mod1Mapping = getCatalogEntry('modifier1', modifier1);
        if (mod1Mapping) {
            modifiedSVG = replaceTextInSVG(modifiedSVG, mod1Mapping);
        }
    }

    // 3. Process Modifier 2 labels (only if not '00')
    if (modifier2 !== '00') {
        const mod2Mapping = getCatalogEntry('modifier2', modifier2);
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
    // from agora é string direta, não array
    const americanText = mapping.from;
    
    // Regex to find <text> elements containing the American text
    const textElementRegex = new RegExp(
        `(<text[^>]*>)([^<]*?)${americanText}([^<]*?)(<\\/text>)`, 
        'gi'
    );
    
    // Replace text while maintaining other element content
    const result = svgString.replace(textElementRegex, (match, openTag, beforeText, afterText, closeTag) => {
        // Update the text
        const newContent = beforeText + mapping.to + afterText;
        
        // Modify font-size in opening tag if specified
        let newOpenTag = openTag;
        
        if (mapping.fontSize) {
            if (openTag.includes('font-size=')) {
                // Replace existing font-size
                newOpenTag = openTag.replace(/font-size="[^"]*"/, `font-size="${mapping.fontSize}"`);
            } else {
                // Add font-size if it doesn't exist
                newOpenTag = openTag.replace('>', ` font-size="${mapping.fontSize}">`);
            }
        }
        
        return newOpenTag + newContent + closeTag;
    });

    return result;
}

/**
 * ========================================
 * SITUAÇÃO 2: ADAPTAÇÃO GRÁFICA
 * ========================================
 * Substitui elementos SVG usando find/replace
 */

/**
 * Apply graphic adaptations to Main Icon
 * @param {string} svgString - Base SVG
 * @param {string} mainIcon - 6-digit main icon code
 * @returns {string} Modified SVG with adapted icon
 */
export function applyGraphicAdaptations(svgString, mainIcon) {
    if (!svgString || !mainIcon) {
        return svgString;
    }

    const adaptation = getCatalogEntry('graphic', mainIcon);
    if (!adaptation) {
        return svgString;
    }

    // Usa find/replace direto
    // Se 'find' contém início de tag mas não está completa, usar regex flexível
    let result = svgString;
    
    if (adaptation.find.includes('<text') && !adaptation.find.includes('</text>')) {
        // Caso especial: encontrar tag text completa
        const findPattern = adaptation.find.replace('<text', '<text[^>]*');
        const regex = new RegExp(findPattern + '[^<]*<\\/text>', 'g');
        result = result.replace(regex, adaptation.replace);
    } else {
        // Replace direto
        result = result.replace(adaptation.find, adaptation.replace);
    }

    return result;
}

/**
 * ========================================
 * SITUAÇÃO 3.1: MODIFICADOR ESPECIAL
 * ========================================
 * Adiciona elemento gráfico sobreposto
 */

/**
 * Add special modifier to SVG (overlaid on center icon)
 * @param {string} svgString - Base SVG
 * @param {number} specialModifierCode - Code 1-7
 * @returns {string} Modified SVG or original if not cataloged
 */
export function addSpecialModifierToSVG(svgString, specialModifierCode) {
    if (!specialModifierCode || specialModifierCode === 0) {
        return svgString;
    }
    
    const modifier = getCatalogEntry('special', specialModifierCode);
    
    if (!modifier) {
        console.warn(`Special Modifier ${specialModifierCode} not cataloged`);
        return svgString;
    }
    
    let modifierSVG = '';
    
    if (modifier.type === 'svg') {
        modifierSVG = modifier.svg;
    } else if (modifier.type === 'text') {
        modifierSVG = buildTextElement(modifier);
    }
    
    return insertBeforeEchelon(svgString, modifierSVG);
}

/**
 * ========================================
 * SITUAÇÃO 3.2: MOD2 ESTENDIDO
 * ========================================
 */

/**
 * Add extended Mod2 to SVG (bottom part of frame)
 * @param {string} svgString - Base SVG
 * @param {number} mod2ExtensionCode - Code 1-31
 * @returns {string} Modified SVG or original if not cataloged
 */
export function addExtendedMod2ToSVG(svgString, mod2ExtensionCode) {
    if (!mod2ExtensionCode || mod2ExtensionCode === 0) {
        return svgString;
    }
    
    const mod2 = getCatalogEntry('mod2', mod2ExtensionCode);
    
    if (!mod2) {
        console.warn(`Mod2 Extension ${mod2ExtensionCode} not cataloged`);
        return svgString;
    }
    
    let mod2SVG = '';
    
    if (mod2.type === 'text') {
        mod2SVG = buildTextElement(mod2);
    } else if (mod2.type === 'svg') {
        mod2SVG = mod2.svg;
    }
    
    return insertBeforeEchelon(svgString, mod2SVG);
}

/**
 * ========================================
 * SITUAÇÃO 3.3: ENTITY ESTENDIDO
 * ========================================
 */

/**
 * Process entity extension
 * @param {Object} extension - Decoded extension
 * @returns {Object|null} Extension info or null if not cataloged
 */
export function processEntityExtension(extension) {
    if (!extension || extension.entityExtension === 0) {
        return null;
    }
    
    const entityExt = getCatalogEntry('entity', extension.entityExtension);
    
    if (!entityExt) {
        console.warn(`Entity Extension ${extension.entityExtension} not cataloged`);
        return null;
    }
    
    return entityExt;
}

/**
 * Replace center icon with entity extension
 * @param {string} svgString - Base SVG
 * @param {Object} entityExtension - Entity extension info
 * @returns {string} Modified SVG
 */
export function replaceWithEntityExtensionIcon(svgString, entityExtension) {
    if (!entityExtension) {
        return svgString;
    }
    
    // Remove existing center icon (text with y~103 and font-size=45)
    const centralTextRegex = /<text\s+x="100"\s+y="10[0-9]"\s+[^>]*font-size="45"[^>]*>([^<]*)<\/text>/;
    let result = svgString.replace(centralTextRegex, '');
    
    // Build new icon
    let newIconSVG = '';
    
    if (entityExtension.type === 'text') {
        newIconSVG = buildTextElement(entityExtension);
    } else if (entityExtension.type === 'svg') {
        newIconSVG = entityExtension.svg;
    }
    
    // Insert after frame (first <path> element)
    const framePathRegex = /(<path d="M25,50[^>]*><\/path>)/;
    result = result.replace(framePathRegex, `$1${newIconSVG}`);
    
    return result;
}

/**
 * ========================================
 * SITUAÇÃO 3.4: MOD1 ESTENDIDO
 * ========================================
 */

/**
 * Add extended Mod1 to SVG (top part of frame)
 * @param {string} svgString - Base SVG
 * @param {number} mod1ExtensionCode - Code 1-31
 * @returns {string} Modified SVG or original if not cataloged
 */
export function addExtendedMod1ToSVG(svgString, mod1ExtensionCode) {
    if (!mod1ExtensionCode || mod1ExtensionCode === 0) {
        return svgString;
    }
    
    const mod1 = getCatalogEntry('mod1', mod1ExtensionCode);
    
    if (!mod1) {
        console.warn(`Mod1 Extension ${mod1ExtensionCode} not cataloged`);
        return svgString;
    }
    
    let mod1SVG = '';
    
    if (mod1.type === 'text') {
        mod1SVG = buildTextElement(mod1);
    } else if (mod1.type === 'svg') {
        mod1SVG = mod1.svg;
    }
    
    return insertBeforeEchelon(svgString, mod1SVG);
}

/**
 * ========================================
 * HELPER FUNCTIONS
 * ========================================
 */

/**
 * Build text SVG element from descriptor
 * @param {Object} descriptor - { position, text, style }
 * @returns {string} SVG text element
 */
function buildTextElement(descriptor) {
    return `
        <text 
            x="${descriptor.position.x}" 
            y="${descriptor.position.y}"
            text-anchor="middle"
            font-size="${descriptor.style.fontSize}"
            font-family="${descriptor.style.fontFamily}"
            font-weight="${descriptor.style.fontWeight}"
            fill="${descriptor.style.fill}"
            dominant-baseline="middle"
        >${descriptor.text}</text>
    `;
}

/**
 * Insert SVG before echelon group
 * @param {string} svgString - Original SVG
 * @param {string} elementToInsert - SVG to insert
 * @returns {string} Modified SVG
 */
function insertBeforeEchelon(svgString, elementToInsert) {
    // Insert BEFORE echelon group (last <g transform= element)
    const lastGIndex = svgString.lastIndexOf('<g transform=');
    
    if (lastGIndex > 0) {
        return svgString.substring(0, lastGIndex) + 
               elementToInsert + 
               svgString.substring(lastGIndex);
    }
    
    // Fallback: insert before </svg>
    return svgString.replace('</svg>', `${elementToInsert}</svg>`);
}

/**
 * ========================================
 * PIPELINE COMPLETO
 * ========================================
 */

/**
 * Complete Brazilian modifications pipeline
 * @param {string} svgString - Base SVG from milsymbol.js
 * @param {string} sidc30 - SIDC with 30 digits
 * @param {string} mainIcon - Main icon code (6 digits)
 * @returns {string} SVG with all Brazilian modifications applied
 */
export function applyBrazilianModifications(svgString, sidc30, mainIcon) {
    // Decode extension
    const extension = BrazilianSIDCExtension.decode(sidc30.substring(20));
    const sidc20 = sidc30.substring(0, 20);
    
    let result = svgString;
    
    // 1. SITUAÇÃO 2: Graphic adaptations (if any)
    //    Must be applied BEFORE text replacements
    result = applyGraphicAdaptations(result, mainIcon);
    
    // 2. SITUAÇÃO 1: Replace text labels (Main Icon + Modifiers)
    result = applyBrazilianLabelsToSVG(result, sidc20);
    
    // If no valid extension, return here
    if (!extension) {
        return result;
    }
    
    // 3. SITUAÇÃO 3.3: Entity Extension (if any)
    if (extension.entityExtension > 0) {
        const entityExt = processEntityExtension(extension);
        if (entityExt) {
            result = replaceWithEntityExtensionIcon(result, entityExt);
        }
    }
    
    // 4. SITUAÇÃO 3.1: Special Modifier
    if (extension.specialModifier > 0) {
        result = addSpecialModifierToSVG(result, extension.specialModifier);
    }
    
    // 5. SITUAÇÃO 3.2: Mod2 Extended
    if (extension.mod2Extension > 0) {
        result = addExtendedMod2ToSVG(result, extension.mod2Extension);
    }
    
    // 6. SITUAÇÃO 3.4: Mod1 Extended
    if (extension.mod1Extension > 0) {
        result = addExtendedMod1ToSVG(result, extension.mod1Extension);
    }
    
    return result;
}

/**
 * Check for uncataloged extensions and return warnings
 * @param {Object} extension - Decoded extension
 * @returns {Array<string>} Array of warning messages
 */
export function checkCatalogWarnings(extension) {
    if (!extension) return [];
    
    const warnings = [];
    
    if (extension.entityExtension > 0) {
        const entry = getCatalogEntry('entity', extension.entityExtension);
        if (!entry) {
            warnings.push(`Entity Extension ${extension.entityExtension} not cataloged`);
        }
    }
    
    if (extension.specialModifier > 0) {
        const entry = getCatalogEntry('special', extension.specialModifier);
        if (!entry) {
            warnings.push(`Special Modifier ${extension.specialModifier} not cataloged`);
        }
    }
    
    if (extension.mod1Extension > 0) {
        const entry = getCatalogEntry('mod1', extension.mod1Extension);
        if (!entry) {
            warnings.push(`Mod1 Extension ${extension.mod1Extension} not cataloged`);
        }
    }
    
    if (extension.mod2Extension > 0) {
        const entry = getCatalogEntry('mod2', extension.mod2Extension);
        if (!entry) {
            warnings.push(`Mod2 Extension ${extension.mod2Extension} not cataloged`);
        }
    }
    
    return warnings;
}