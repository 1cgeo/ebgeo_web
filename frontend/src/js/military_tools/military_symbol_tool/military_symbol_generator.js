// Path: js/military_tools/military_symbol_tool/military_symbol_generator.js
/* global ms */

import { BrazilianSIDCExtension, normalizeSIDC, getBaseSIDC } from './brazilian_sidc_extension.js';
import {
    applyBrazilianModifications
} from './brazilian_svg_postprocessing.js';
import { hasExtensions } from './brazilian_extension_catalog.js';
import { convertImageToPngBlob } from '../svg-to-png.js';
import { ensureMilsymbol } from './milsymbol-loader.js';
import { extractTextModifiers } from './text-modifiers-mapping.js';

const DEFAULT_SIZE = 100;

/**
 * Generates military symbols using milsymbol.js with Brazilian extensions.
 * Handles SIDC construction, symbol rendering with text scaling, and PNG conversion.
 */
export class MilitarySymbolGenerator {

    /**
     * Build 30-digit SIDC from properties
     * @param {Object} properties - Symbol properties
     * @returns {string} 30-digit SIDC
     */
    buildSIDC(properties) {
        const formatId = "10";
        const context = "0";
        const standardIdentity = properties.standardIdentity || "3";
        const symbolSet = properties.symbolSet || "10";
        const status = properties.status || "0";
        const hqTfDummy = properties.hqTfDummy || "0";
        const echelon = properties.echelon || "16";
        const mainIcon = properties.mainIcon || "121100";
        const modifier1 = properties.modifier1 || "00";
        const modifier2 = properties.modifier2 || "00";

        const sidc20 = `${formatId}${context}${standardIdentity}${symbolSet}${status}${hqTfDummy}${echelon}${mainIcon}${modifier1}${modifier2}`;

        const hasMainIconExt = properties.mainIconExtension !== null &&
                               properties.mainIconExtension !== undefined;
        const hasMod1Ext = properties.modifier1Extension !== null &&
                           properties.modifier1Extension !== undefined;
        const hasMod2Ext = properties.modifier2Extension !== null &&
                           properties.modifier2Extension !== undefined;

        const mainIconExtension = hasMainIconExt ? properties.mainIconExtension : 0;
        const mod1ExtensionValue = hasMod1Ext ? properties.modifier1Extension : 0;
        const mod2ExtensionValue = hasMod2Ext ? properties.modifier2Extension : 0;

        const specialModifierValue = (properties.specialModifier !== undefined &&
                                      properties.specialModifier !== null &&
                                      properties.specialModifier !== "0" &&
                                      properties.specialModifier !== 0)
            ? parseInt(properties.specialModifier, 10)
            : 0;

        const isCommandValue = properties.isCommand || false;

        const hasExtension = hasMainIconExt ||
                             hasMod1Ext ||
                             hasMod2Ext ||
                             specialModifierValue > 0 ||
                             isCommandValue;

        if (!hasExtension) {
            return sidc20 + '0760000000';
        }

        const extensionFields = {
            entityExtension: mainIconExtension,
            isCommand: isCommandValue,
            specialModifier: specialModifierValue,
            mod1Extension: mod1ExtensionValue,
            mod2Extension: mod2ExtensionValue
        };

        const extension = BrazilianSIDCExtension.encode(extensionFields);
        return sidc20 + extension;
    }

    /**
     * Parse SIDC into properties object
     * @param {string} sidc - 20 or 30 digit SIDC
     * @returns {Object} Properties object with all SIDC components
     */
    parseSIDC(sidc) {
        const validation = this.validateSIDC(sidc);
        if (!validation.valid) {
            throw new Error(`Invalid SIDC: ${validation.error}`);
        }

        const sidc20 = getBaseSIDC(sidc);

        const properties = {
            formatId: sidc20.substring(0, 2),
            context: sidc20.substring(2, 3),
            standardIdentity: sidc20.substring(3, 4),
            symbolSet: sidc20.substring(4, 6),
            status: sidc20.substring(6, 7),
            hqTfDummy: sidc20.substring(7, 8),
            echelon: sidc20.substring(8, 10),
            mainIcon: sidc20.substring(10, 16),
            modifier1: sidc20.substring(16, 18),
            modifier2: sidc20.substring(18, 20)
        };

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

            const parsed = this.parseSIDC(sidc);

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

        if (typeof sidc !== 'string') {
            return { valid: false, error: 'SIDC must be a string' };
        }

        const cleanSIDC = sidc.replace(/\s/g, '');

        if (cleanSIDC.length !== 20 && cleanSIDC.length !== 30) {
            return {
                valid: false,
                error: `Invalid SIDC length: ${cleanSIDC.length} (expected 20 or 30 digits)`
            };
        }

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
     * Generate symbol with text scaling: renders with/without text modifiers
     * to calculate exact growth factor and adjust PNG canvas size accordingly
     * @param {string} sidc30 - 30-digit SIDC
     * @param {Object} properties - Symbol properties (includes text modifiers)
     * @param {number} targetSize - Target size for base symbol (default: 100)
     * @param {string} customColor - Optional custom fill color
     * @returns {Promise<Object>} { blob: Blob, width: number, height: number }
     */
    async generateSymbol(sidc30, properties, targetSize = DEFAULT_SIZE, customColor = null) {
        // The 855 kB milsymbol bundle is loaded on first use, not at boot. This is
        // the single chokepoint every caller passes through, INCLUDING the one that
        // is not a user gesture: `layers/layer_setup.js` regenerates symbol PNGs
        // when a remote atlas snapshot arrives. Awaiting here is what turns "remove
        // the eager script tag" from a race into a safe change.
        await ensureMilsymbol();

        const sidc20 = getBaseSIDC(sidc30);
        const symbolSetCode = sidc20.substring(4, 6);
        const mainIcon = sidc20.substring(10, 16);
        const modifier1 = sidc20.substring(16, 18);
        const modifier2 = sidc20.substring(18, 20);

        // Zero out Brazilian extensions for milsymbol rendering
        let renderSIDC = sidc20;

        if (hasExtensions(symbolSetCode, 'mainIcon', mainIcon)) {
            renderSIDC = renderSIDC.substring(0, 10) + '000000' + renderSIDC.substring(16, 20);
        }

        if (hasExtensions(symbolSetCode, 'modifier1', modifier1)) {
            renderSIDC = renderSIDC.substring(0, 16) + '00' + renderSIDC.substring(18, 20);
        }

        if (hasExtensions(symbolSetCode, 'modifier2', modifier2)) {
            renderSIDC = renderSIDC.substring(0, 18) + '00';
        }

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

        const symbolBase = new ms.Symbol(renderSIDC, baseOptions);
        const svgBase = symbolBase.asSVG();
        const viewBoxBase = this.extractViewBoxDimensions(svgBase);

        const textModifiers = extractTextModifiers(properties);
        const hasText = Object.keys(textModifiers).length > 0;

        let svgString;
        let finalWidth = targetSize;
        let finalHeight = targetSize;

        if (!hasText) {
            svgString = svgBase;
        } else {
            const optionsWithText = { ...baseOptions, ...textModifiers };
            const symbolWithText = new ms.Symbol(renderSIDC, optionsWithText);
            svgString = symbolWithText.asSVG();
            const viewBoxExpanded = this.extractViewBoxDimensions(svgString);

            const growthFactorX = viewBoxExpanded.width / viewBoxBase.width;
            const growthFactorY = viewBoxExpanded.height / viewBoxBase.height;

            if (growthFactorX > 1.01) {
                finalWidth = Math.round(targetSize * growthFactorX);
            }

            if (growthFactorY > 1.01) {
                finalHeight = Math.round(targetSize * growthFactorY);
            }
        }

        svgString = applyBrazilianModifications(svgString, sidc30, symbolSetCode, customColor);

        const svgDataURL = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
        const blob = await this.convertToPngBlob(svgDataURL, finalWidth, finalHeight);

        return {
            blob,
            width: finalWidth,
            height: finalHeight
        };
    }

    /**
     * Generate symbol blob for map rendering with dimensions
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

            const properties = this.parseSIDC(sidc30);
            const result = await this.generateSymbol(sidc30, properties, size, customColor);

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
     * Convert SVG data URL to PNG blob using canvas.
     * Delegates to shared svg-to-png utility.
     * @param {string} dataURL - SVG data URL
     * @param {number} targetWidth - Target canvas width
     * @param {number} targetHeight - Target canvas height (defaults to targetWidth for square)
     * @returns {Promise<Blob>} PNG blob
     */
    async convertToPngBlob(dataURL, targetWidth = DEFAULT_SIZE, targetHeight = null) {
        return convertImageToPngBlob(dataURL, targetWidth, targetHeight);
    }
}

