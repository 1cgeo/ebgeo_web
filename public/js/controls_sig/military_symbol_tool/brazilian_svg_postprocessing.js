// Path: js\controls_sig\military_symbol_tool\brazilian_svg_postprocessing.js

import { 
    BRAZILIAN_LABEL_MAPPINGS,
    getCatalogEntry
} from './brazilian_extension_catalog.js';
import { BrazilianSIDCExtension } from './brazilian_sidc_extension.js';

/**
 * Apply Brazilian label translations to SVG
 * Translates American military abbreviations to Brazilian Portuguese
 * @param {string} svgString - Base SVG from milsymbol.js
 * @param {string} mainIcon - Main icon code (6 digits)
 * @returns {string} Modified SVG with Brazilian labels
 */
export function applyBrazilianLabelsToSVG(svgString, mainIcon) {
    if (!svgString || !mainIcon) {
        return svgString;
    }

    // Check if we have a mapping for this mainIcon
    const mapping = BRAZILIAN_LABEL_MAPPINGS[mainIcon];
    if (!mapping) {
        return svgString;
    }

    let modifiedSVG = svgString;

    // Process each American text that should be replaced
    mapping.from.forEach(americanText => {
        
        // Regex to find <text> elements containing the American text
        // Captures: opening tag, content, closing tag
        const textElementRegex = new RegExp(
            `(<text[^>]*>)([^<]*?)${americanText}([^<]*?)(<\\/text>)`, 
            'gi'
        );
        
        // Replace text while maintaining other element content
        modifiedSVG = modifiedSVG.replace(textElementRegex, (match, openTag, beforeText, afterText, closeTag) => {
            // Update the text
            const newContent = beforeText + mapping.to + afterText;
            
            // Modify font-size in opening tag
            let newOpenTag = openTag;
            
            if(mapping.fontSize){
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
    });

    return modifiedSVG;
}

/**
 * Add special modifier to SVG (overlaid on center icon)
 * @param {string} svgString - Base SVG from milsymbol.js
 * @param {number} specialModifierCode - Code 1-7
 * @returns {string} Modified SVG or original if not cataloged
 */
export function addSpecialModifierToSVG(svgString, specialModifierCode) {
    if (!specialModifierCode || specialModifierCode === 0) {
        return svgString;
    }
    
    const modifier = getCatalogEntry('special', specialModifierCode);
    
    if (!modifier || !modifier.render) {
        console.warn(`Special Modifier ${specialModifierCode} not cataloged`);
        return svgString;
    }
    
    let modifierSVG = '';
    
    if (modifier.render.type === 'svg') {
        modifierSVG = modifier.render.svg;
    } else if (modifier.render.type === 'text') {
        modifierSVG = `
            <text 
                x="${modifier.render.position.x}" 
                y="${modifier.render.position.y}"
                text-anchor="middle"
                font-size="${modifier.render.style.fontSize}"
                font-family="${modifier.render.style.fontFamily}"
                font-weight="${modifier.render.style.fontWeight}"
                fill="${modifier.render.style.fill}"
                dominant-baseline="middle"
            >${modifier.render.text}</text>
        `;
    }
    
    // Insert BEFORE echelon group (last <g transform= element)
    const lastGIndex = svgString.lastIndexOf('<g transform=');
    
    if (lastGIndex > 0) {
        return svgString.substring(0, lastGIndex) + 
               modifierSVG + 
               svgString.substring(lastGIndex);
    }
    
    // Fallback: insert before </svg>
    return svgString.replace('</svg>', `${modifierSVG}</svg>`);
}

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
    
    if (!mod2 || !mod2.render) {
        console.warn(`Mod2 Extension ${mod2ExtensionCode} not cataloged`);
        return svgString;
    }
    
    let mod2SVG = '';
    
    if (mod2.render.type === 'text') {
        mod2SVG = `
            <text 
                x="${mod2.render.position.x}" 
                y="${mod2.render.position.y}"
                text-anchor="middle"
                font-size="${mod2.render.style.fontSize}"
                font-family="${mod2.render.style.fontFamily}"
                font-weight="${mod2.render.style.fontWeight}"
                fill="${mod2.render.style.fill}"
                dominant-baseline="middle"
            >${mod2.render.text}</text>
        `;
    } else if (mod2.render.type === 'svg') {
        mod2SVG = mod2.render.svg;
    }
    
    // Insert BEFORE echelon group (last <g transform= element)
    const lastGIndex = svgString.lastIndexOf('<g transform=');
    
    if (lastGIndex > 0) {
        return svgString.substring(0, lastGIndex) + 
               mod2SVG + 
               svgString.substring(lastGIndex);
    }
    
    // Fallback: insert before </svg>
    return svgString.replace('</svg>', `${mod2SVG}</svg>`);
}

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
    
    if (!mod1 || !mod1.render) {
        console.warn(`Mod1 Extension ${mod1ExtensionCode} not cataloged`);
        return svgString;
    }
    
    let mod1SVG = '';
    
    if (mod1.render.type === 'text') {
        mod1SVG = `
            <text 
                x="${mod1.render.position.x}" 
                y="${mod1.render.position.y}"
                text-anchor="middle"
                font-size="${mod1.render.style.fontSize}"
                font-family="${mod1.render.style.fontFamily}"
                font-weight="${mod1.render.style.fontWeight}"
                fill="${mod1.render.style.fill}"
                dominant-baseline="middle"
            >${mod1.render.text}</text>
        `;
    } else if (mod1.render.type === 'svg') {
        mod1SVG = mod1.render.svg;
    }
    
    // Insert BEFORE echelon group
    const lastGIndex = svgString.lastIndexOf('<g transform=');
    
    if (lastGIndex > 0) {
        return svgString.substring(0, lastGIndex) + 
               mod1SVG + 
               svgString.substring(lastGIndex);
    }
    
    return svgString.replace('</svg>', `${mod1SVG}</svg>`);
}

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
    if (!entityExtension || !entityExtension.render) {
        return svgString;
    }
    
    // Remove existing center icon (text with y~103 and font-size=45)
    const centralTextRegex = /<text\s+x="100"\s+y="10[0-9]"\s+[^>]*font-size="45"[^>]*>([^<]*)<\/text>/;
    let result = svgString.replace(centralTextRegex, '');
    
    // Build new icon SVG
    let newIconSVG = '';
    
    if (entityExtension.render.type === 'text') {
        newIconSVG = `
            <text 
                x="${entityExtension.render.position.x}" 
                y="${entityExtension.render.position.y}"
                text-anchor="middle"
                font-size="${entityExtension.render.style.fontSize}"
                font-family="${entityExtension.render.style.fontFamily}"
                font-weight="${entityExtension.render.style.fontWeight}"
                fill="${entityExtension.render.style.fill}"
                dominant-baseline="middle"
            >${entityExtension.render.text}</text>
        `;
    } else if (entityExtension.render.type === 'svg') {
        newIconSVG = entityExtension.render.svg;
    }
    
    // Insert after frame (first <path> element)
    const framePathRegex = /(<path d="M25,50[^>]*><\/path>)/;
    result = result.replace(framePathRegex, `$1${newIconSVG}`);
    
    return result;
}

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
    
    if (!extension) {
        // No valid extension, only apply label modifications (Situation 1)
        return applyBrazilianLabelsToSVG(svgString, mainIcon);
    }
    
    let result = svgString;
    
    // 1. Situation 1: Replace text labels
    result = applyBrazilianLabelsToSVG(result, mainIcon);
    
    // 2. Situation 3.3: Entity Extension (if any)
    if (extension.entityExtension > 0) {
        const entityExt = processEntityExtension(extension);
        if (entityExt) {
            result = replaceWithEntityExtensionIcon(result, entityExt);
        }
    }
    
    // 3. Situation 3.1: Special Modifier
    if (extension.specialModifier > 0) {
        result = addSpecialModifierToSVG(result, extension.specialModifier);
    }
    
    // 4. Situation 3.2: Mod2 Extended
    if (extension.mod2Extension > 0) {
        result = addExtendedMod2ToSVG(result, extension.mod2Extension);
    }
    
    // 5. Situation 3.4: Mod1 Extended (if needed in future)
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
        if (!entry || entry.code === 0) {
            warnings.push(`Entity Extension ${extension.entityExtension} not cataloged`);
        }
    }
    
    if (extension.specialModifier > 0) {
        const entry = getCatalogEntry('special', extension.specialModifier);
        if (!entry || entry.code === 0) {
            warnings.push(`Special Modifier ${extension.specialModifier} not cataloged`);
        }
    }
    
    if (extension.mod1Extension > 0) {
        const entry = getCatalogEntry('mod1', extension.mod1Extension);
        if (!entry || entry.code === 0) {
            warnings.push(`Mod1 Extension ${extension.mod1Extension} not cataloged`);
        }
    }
    
    if (extension.mod2Extension > 0) {
        const entry = getCatalogEntry('mod2', extension.mod2Extension);
        if (!entry || entry.code === 0) {
            warnings.push(`Mod2 Extension ${extension.mod2Extension} not cataloged`);
        }
    }
    
    return warnings;
}