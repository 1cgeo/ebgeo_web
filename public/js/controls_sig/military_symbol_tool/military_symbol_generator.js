// Path: js\controls_sig\military_symbol_tool\military_symbol_generator.js

import { BrazilianSIDCExtension, normalizeSIDC, getBaseSIDC } from './brazilian_sidc_extension.js';
import {
    applyBrazilianModifications
} from './brazilian_svg_postprocessing.js';
import { hasExtensions } from './brazilian_extension_catalog.js';

const DEFAULT_SIZE = 100;

/**
 * Military Symbol Generator
 * Generates military symbols with perfect text scaling
 *
 * Key features:
 * - Unified generation logic (no duplication)
 * - Perfect scaling: generates symbol twice (with/without text) to calculate exact growth
 * - No cache: simplified architecture
 * - Consistent symbol size regardless of text modifiers
 * - Returns actual dimensions for accurate bounding box calculations
 */
export class MilitarySymbolGenerator {
    constructor() {
        // Simplified: no cache
    }

    /**
     * Build 30-digit SIDC from properties
     * Uses extension values directly from properties (no guessing)
     * ALWAYS uses real codes from properties - creates SIDC for storage/display
     * @param {Object} properties - Symbol properties
     * @returns {string} 30-digit SIDC
     */
    buildSIDC(properties) {
        // Build 20-digit SIDC according to MIL-STD-2525D standard
        // Structure: A-B-C-D-E-F-G-H-I-J = 10-0-3-10-0-0-16-121100-00-00

        const formatId = "10";                                              // A: 2 digits (always "10")
        const context = "0";                                                // B: 1 digit (0=reality)
        const standardIdentity = properties.standardIdentity || "3";       // C: 1 digit (3=friend)
        const symbolSet = properties.symbolSet || "10";                    // D: 2 digits (DYNAMIC)
        const status = properties.status || "0";                          // E: 1 digit (0=present)
        const hqTfDummy = properties.hqTfDummy || "0";                     // F: 1 digit (0=N/A)
        const echelon = properties.echelon || "16";                       // G: 2 digits (16=battalion)

        // ALWAYS use real codes from properties (never zero them out)
        const mainIcon = properties.mainIcon || "121100";                 // H: 6 digits (121100=infantry)
        const modifier1 = properties.modifier1 || "00";                   // I: 2 digits
        const modifier2 = properties.modifier2 || "00";                   // J: 2 digits

        const sidc20 = `${formatId}${context}${standardIdentity}${symbolSet}${status}${hqTfDummy}${echelon}${mainIcon}${modifier1}${modifier2}`;

        // Check if extensions exist (null = no extension)
        const hasMainIconExt = properties.mainIconExtension !== null &&
                               properties.mainIconExtension !== undefined;
        const hasMod1Ext = properties.modifier1Extension !== null &&
                           properties.modifier1Extension !== undefined;
        const hasMod2Ext = properties.modifier2Extension !== null &&
                           properties.modifier2Extension !== undefined;

        // Get extension values (default to 0 if not present)
        const mainIconExtension = hasMainIconExt ? properties.mainIconExtension : 0;
        const mod1ExtensionValue = hasMod1Ext ? properties.modifier1Extension : 0;
        const mod2ExtensionValue = hasMod2Ext ? properties.modifier2Extension : 0;

        // Special modifier: "0" means "Not Applicable"
        const specialModifierValue = (properties.specialModifier !== undefined &&
                                      properties.specialModifier !== null &&
                                      properties.specialModifier !== "0" &&
                                      properties.specialModifier !== 0)
            ? parseInt(properties.specialModifier)
            : 0;

        const isCommandValue = properties.isCommand || false;

        // Check if any extension is present
        const hasExtension = hasMainIconExt ||
                             hasMod1Ext ||
                             hasMod2Ext ||
                             specialModifierValue > 0 ||
                             isCommandValue;

        if (!hasExtension) {
            // No extensions, return 30-digit SIDC with default extension
            return sidc20 + '0760000000';
        }

        // Build extension fields
        const extensionFields = {
            entityExtension: mainIconExtension,
            isCommand: isCommandValue,
            specialModifier: specialModifierValue,
            mod1Extension: mod1ExtensionValue,
            mod2Extension: mod2ExtensionValue
        };

        // Encode extension
        const extension = BrazilianSIDCExtension.encode(extensionFields);

        // Return 30-digit SIDC with real codes
        return sidc20 + extension;
    }

    /**
     * Parse SIDC into properties object
     * @param {string} sidc - 20 or 30 digit SIDC
     * @returns {Object} Properties object with all SIDC components
     */
    parseSIDC(sidc) {
        // Validate first
        const validation = this.validateSIDC(sidc);
        if (!validation.valid) {
            throw new Error(`Invalid SIDC: ${validation.error}`);
        }

        // Extract first 20 digits (base SIDC)
        const sidc20 = getBaseSIDC(sidc);

        // Extract each component according to MIL-STD-2525D structure
        const properties = {
            formatId: sidc20.substring(0, 2),        // A: positions 1-2
            context: sidc20.substring(2, 3),         // B: position 3
            standardIdentity: sidc20.substring(3, 4), // C: position 4
            symbolSet: sidc20.substring(4, 6),       // D: positions 5-6
            status: sidc20.substring(6, 7),          // E: position 7
            hqTfDummy: sidc20.substring(7, 8),       // F: position 8
            echelon: sidc20.substring(8, 10),        // G: positions 9-10
            mainIcon: sidc20.substring(10, 16),      // H: positions 11-16
            modifier1: sidc20.substring(16, 18),     // I: positions 17-18
            modifier2: sidc20.substring(18, 20)      // J: positions 19-20
        };

        // Extract all extension fields including entity/mod1/mod2 extensions
        if (sidc.length === 30) {
            const extensionString = sidc.substring(20);
            const extension = BrazilianSIDCExtension.decode(extensionString);

            if (extension) {
                properties.specialModifier = extension.specialModifier.toString();
                properties.isCommand = extension.isCommand;

                properties.mainIconExtension = extension.entityExtension;
                properties.modifier1Extension = extension.mod1Extension;
                properties.modifier2Extension = extension.mod2Extension;
            }
        }

        return properties;
    }

    /**
     * Check if SIDC can be parsed
     * @param {string} sidc - SIDC to check
     * @returns {Object} { canParse: boolean, error?: string, properties?: Object }
     */
    canParseSIDC(sidc) {
        try {
            const validation = this.validateSIDC(sidc);
            if (!validation.valid) {
                return { canParse: false, error: validation.error };
            }

            // Additional check: ensure we can extract meaningful properties
            const parsed = this.parseSIDC(sidc);

            // Verify core components are present
            if (!parsed.context || !parsed.standardIdentity || !parsed.mainIcon) {
                return { canParse: false, error: 'SIDC missing required components' };
            }

            return { canParse: true, properties: parsed };
        } catch (error) {
            return { canParse: false, error: error.message };
        }
    }

    /**
     * Validate SIDC (accepts 20 or 30 digits)
     * @param {string} sidc - SIDC to validate
     * @returns {Object} { valid: boolean, error?: string }
     */
    validateSIDC(sidc) {
        if (!sidc) {
            return { valid: false, error: 'SIDC is null or undefined' };
        }

        // Remove spaces
        const cleanSIDC = sidc.replace(/\s/g, '');

        // Check length (must be 20 or 30 digits)
        if (cleanSIDC.length !== 20 && cleanSIDC.length !== 30) {
            return {
                valid: false,
                error: `Invalid SIDC length: ${cleanSIDC.length} (expected 20 or 30 digits)`
            };
        }

        // Check if all characters are digits
        if (!/^\d+$/.test(cleanSIDC)) {
            return { valid: false, error: 'SIDC must contain only digits' };
        }

        return { valid: true };
    }

    /**
     * Extract viewBox dimensions from SVG string
     * @param {string} svgString - SVG markup
     * @returns {Object|null} { x, y, width, height } or null if not found
     */
    extractViewBoxDimensions(svgString) {
        const match = svgString.match(/viewBox="([^"]+)"/);
        if (!match) return null;

        const [x, y, width, height] = match[1].split(' ').map(Number);
        return { x, y, width, height };
    }

    /**
     * Unified symbol generation with PERFECT text scaling and dimension tracking
     *
     * Strategy:
     * 1. Generate symbol WITHOUT text modifiers → get baseline viewBox (e.g., 100x100)
     * 2. Generate symbol WITH text modifiers → get expanded viewBox (e.g., 150x250)
     * 3. Calculate exact growth factor: expandedViewBox / baseViewBox (e.g., 2.5x)
     * 4. Adjust PNG target size by growth factor (e.g., 100px → 250px)
     * 5. Result: symbol base always same visual size, PNG grows to accommodate text
     *
     * Key insight: Don't adjust milsymbol's internal size, adjust final PNG canvas size.
     * This preserves symbol proportions while accommodating text naturally.
     *
     * @param {string} sidc30 - 30-digit SIDC
     * @param {Object} properties - Symbol properties (includes text modifiers)
     * @param {number} targetSize - Target size for base symbol (default: 100)
     * @param {string} customColor - Optional custom fill color
     * @returns {Promise<Object>} { blob: Blob, width: number, height: number }
     */
    async generateSymbol(sidc30, properties, targetSize = DEFAULT_SIZE, customColor = null) {
        // 1. Prepare SIDC and extract codes
        const sidc20 = getBaseSIDC(sidc30);
        const symbolSetCode = sidc20.substring(4, 6);
        const mainIcon = sidc20.substring(10, 16);
        const modifier1 = sidc20.substring(16, 18);
        const modifier2 = sidc20.substring(18, 20);

        // 2. Create auxiliary SIDC for rendering (zero out Brazilian extensions)
        let renderSIDC = sidc20;

        // Check catalog to see if mainIcon has extensions available
        if (hasExtensions(symbolSetCode, 'mainIcon', mainIcon)) {
            renderSIDC = renderSIDC.substring(0, 10) + '000000' + renderSIDC.substring(16, 20);
        }

        // Check catalog to see if modifier1 has extensions available
        if (hasExtensions(symbolSetCode, 'modifier1', modifier1)) {
            renderSIDC = renderSIDC.substring(0, 16) + '00' + renderSIDC.substring(18, 20);
        }

        // Check catalog to see if modifier2 has extensions available
        if (hasExtensions(symbolSetCode, 'modifier2', modifier2)) {
            renderSIDC = renderSIDC.substring(0, 18) + '00';
        }

        // 3. Configure base symbol options (NO text modifiers)
        const baseOptions = {
            size: targetSize * 0.5,
            frame: true,
            fill: true,
            strokeWidth: 3,
            colorMode: 'Light'
        };

        if (customColor) {
            baseOptions.fillColor = customColor;
        }

        // 4. Generate baseline SVG WITHOUT text modifiers
        const symbolBase = new ms.Symbol(renderSIDC, baseOptions);
        const svgBase = symbolBase.asSVG();
        const viewBoxBase = this.extractViewBoxDimensions(svgBase);

        // 5. Extract text modifiers from properties
        const textModifiers = extractTextModifiers(properties);
        const hasText = Object.keys(textModifiers).length > 0;

        let svgString;
        let finalWidth = targetSize;
        let finalHeight = targetSize;

        if (!hasText) {
            // No text modifiers: use baseline SVG directly
            svgString = svgBase;
        } else {
            // 6. Generate SVG WITH text modifiers (natural size, no adjustment)
            const optionsWithText = { ...baseOptions, ...textModifiers };
            const symbolWithText = new ms.Symbol(renderSIDC, optionsWithText);
            svgString = symbolWithText.asSVG();
            const viewBoxExpanded = this.extractViewBoxDimensions(svgString);

            // 7. Calculate EXACT growth factor independently for each axis
            // This prevents unnecessary padding when text grows more in one direction
            const growthFactorX = viewBoxExpanded.width / viewBoxBase.width;
            const growthFactorY = viewBoxExpanded.height / viewBoxBase.height;

            if (growthFactorX > 1.01) { // More than 1% growth horizontally
                finalWidth = Math.round(targetSize * growthFactorX);
            }

            if (growthFactorY > 1.01) { // More than 1% growth vertically
                finalHeight = Math.round(targetSize * growthFactorY);
            }
        }

        // 9. Apply Brazilian modifications to final SVG
        svgString = applyBrazilianModifications(svgString, sidc30, symbolSetCode);

        // 10. Convert to PNG blob with adjusted target dimensions
        // The finalWidth/finalHeight ensures the symbol maintains visual size
        // while the PNG canvas grows to accommodate text with minimal padding
        const svgDataURL = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
        const blob = await this.convertToPngBlob(svgDataURL, finalWidth, finalHeight);

        // ✅ RETURN DIMENSIONS: Return blob with actual dimensions for accurate bounding boxes
        return {
            blob: blob,
            width: finalWidth,
            height: finalHeight
        };
    }

    /**
     * Generate symbol blob for map rendering with dimensions
     * Returns object with blob and actual dimensions for accurate bounding box calculation
     * @param {Object} properties - Feature properties including sidc and text modifiers
     * @returns {Promise<Object>} { blob: Blob, width: number, height: number }
     */
    async generateSymbolBlob(properties) {
        const sidc30 = normalizeSIDC(properties.sidc);
        if (!sidc30) {
            throw new Error('Invalid SIDC for normalization');
        }

        return await this.generateSymbol(
            sidc30,
            properties,
            DEFAULT_SIZE,
            properties.fillColor
        );
    }

    /**
     * Generate preview data URL for UI display
     * Simplified: delegates to unified generateSymbol() method
     * @param {string} sidc - 20 or 30 digit SIDC
     * @param {number} size - Preview size (default: 80)
     * @param {string} customColor - Optional custom fill color
     * @returns {Promise<string>} Data URL (base64)
     */
    async generatePreviewDataURL(sidc, size = 80, customColor = null) {
        try {
            const sidc30 = normalizeSIDC(sidc);
            if (!sidc30) {
                return null;
            }

            // Parse SIDC to extract properties (including any text modifiers if present)
            const properties = this.parseSIDC(sidc30);

            // Generate symbol with dimensions
            const result = await this.generateSymbol(sidc30, properties, size, customColor);

            // Convert blob to data URL
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.readAsDataURL(result.blob);
            });
        } catch (error) {
            console.error('Error generating preview:', error);
            return null;
        }
    }

    /**
     * Convert SVG data URL to PNG blob using canvas
     * Maintains aspect ratio and centers image in canvas with specified dimensions
     * @param {string} dataURL - SVG data URL
     * @param {number} targetWidth - Target canvas width
     * @param {number} targetHeight - Target canvas height (optional, defaults to targetWidth for square)
     * @returns {Promise<Blob>} PNG blob
     */
    async convertToPngBlob(dataURL, targetWidth = DEFAULT_SIZE, targetHeight = null) {
        // If targetHeight not specified, create square canvas
        if (targetHeight === null) {
            targetHeight = targetWidth;
        }

        return new Promise((resolve, reject) => {
            const img = new Image();

            img.onload = () => {
                try {
                    // 1. Get original image dimensions
                    const originalWidth = img.naturalWidth || img.width;
                    const originalHeight = img.naturalHeight || img.height;

                    // 2. Calculate aspect ratio
                    const aspectRatio = originalWidth / originalHeight;

                    // 3. Calculate new dimensions maintaining proportion
                    // Fit image to canvas while maintaining aspect ratio
                    let newWidth, newHeight;
                    const canvasAspectRatio = targetWidth / targetHeight;

                    if (aspectRatio >= canvasAspectRatio) {
                        // Image is wider than canvas - fit to width
                        newWidth = targetWidth;
                        newHeight = Math.round(targetWidth / aspectRatio);
                    } else {
                        // Image is taller than canvas - fit to height
                        newHeight = targetHeight;
                        newWidth = Math.round(targetHeight * aspectRatio);
                    }

                    // 4. Create canvas with target dimensions
                    const canvas = document.createElement('canvas');
                    canvas.width = targetWidth;
                    canvas.height = targetHeight;
                    const ctx = canvas.getContext('2d');

                    // 5. Clear background (transparent)
                    ctx.clearRect(0, 0, targetWidth, targetHeight);

                    // 6. Center image in canvas
                    const offsetX = (targetWidth - newWidth) / 2;
                    const offsetY = (targetHeight - newHeight) / 2;

                    // 7. Draw resized image centered
                    ctx.drawImage(img, offsetX, offsetY, newWidth, newHeight);

                    // 8. Convert canvas to blob
                    canvas.toBlob(blob => resolve(blob), 'image/png');
                } catch (error) {
                    reject(error);
                }
            };

            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = dataURL;
        });
    }
}

/**
 * ========================================
 * HELPER FUNCTIONS
 * ========================================
 */

/**
 * Extract text modifiers from feature properties
 * Only includes fields that have non-empty values
 * @param {Object} properties - Feature properties
 * @returns {Object} Text modifiers for milsymbol.js (only non-empty)
 */

/**
 * Extract text modifiers from feature properties
 * Only includes fields that have non-empty values
 * Maps our property names to milsymbol.js expected names
 * @param {Object} properties - Feature properties
 * @returns {Object} Text modifiers for milsymbol.js (only non-empty)
 */
function extractTextModifiers(properties) {
    const modifiers = {};

    // Direct fields (pass through without transformation)
    const directFields = [
        'uniqueDesignation',      // C - Designação
        'higherFormation',        // B - Subordinação
        'quantity',               // C1 - Quantidade
        'reinforcedReduced',      // F - Reforço/Redução
        'additionalInformation',  // H - Informações Adicionais
        'type',                   // V - Tipo de Equipamento / Identificação AIS
        'iffSif',                 // P - Código IFF
        'altitudeDepth',          // X - Altitude/Profundidade
        'equipmentTeardownTime',  // X1 - Tempo de Destruição
        'location',               // Y - Localização
        'speed',                  // Z - Velocidade
        'specialHeadquarters',    // AA - Tipo de PC
        'direction'               // Q - Direção/Azimute
    ];

    // Add direct fields
    directFields.forEach(field => {
        const value = properties[field];
        if (value !== null && value !== undefined && value !== '') {
            modifiers[field] = value;
        }
    });

    // MAPPING: dateTimeGroup → dtg (milsymbol.js uses 'dtg' for Field W)
    if (properties.dateTimeGroup && properties.dateTimeGroup !== '') {
        modifiers.dtg = properties.dateTimeGroup;
    }

    // MAPPING: credibility → evaluationRating (milsymbol.js combines J+K into one field)
    // Note: 'credibility' now accepts combined format (e.g., "A1", "B3", "F6")
    if (properties.credibility && properties.credibility !== '') {
        modifiers.evaluationRating = properties.credibility;
    }

    return modifiers;
}