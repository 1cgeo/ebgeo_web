// Path: js\controls_sig\military_symbol_tool\military_symbol_generator.js

import { BrazilianSIDCExtension, normalizeSIDC, getBaseSIDC } from './brazilian_sidc_extension.js';
import { 
    applyBrazilianModifications,
    processEntityExtension 
} from './brazilian_svg_postprocessing.js';

const DEFAULT_SIZE = 100;

export class MilitarySymbolGenerator {
    constructor() {
        this.symbolCache = new Map();
    }

    buildSIDC(properties) {
        // Build 20-digit SIDC according to MIL-STD-2525D standard
        // Structure: A-B-C-D-E-F-G-H-I-J = 10-0-3-10-0-0-16-121100-00-00

        const formatId = "10";                                              // A: 2 digits (always "10")
        const context = "0";                                                // B: 1 digit (0=reality)
        const standardIdentity = properties.standardIdentity || "3";       // C: 1 digit (3=friend)
        const symbolSet = "10";                                            // D: 2 digits (always "10"=land)
        const status = properties.status || "0";                          // E: 1 digit (0=present)
        const hqTfDummy = properties.hqTfDummy || "0";                     // F: 1 digit (0=N/A)
        const echelon = properties.echelon || "16";                       // G: 2 digits (16=battalion)
        const mainIcon = properties.mainIcon || "121100";                 // H: 6 digits (121100=infantry)
        const modifier1 = properties.modifier1 || "00";                   // I: 2 digits
        const modifier2 = properties.modifier2 || "00";                   // J: 2 digits

        const sidc = `${formatId}${context}${standardIdentity}${symbolSet}${status}${hqTfDummy}${echelon}${mainIcon}${modifier1}${modifier2}`;

        return sidc;
    }

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

        return properties;
    }

    canParseSIDC(sidc) {
        try {
            const validation = this.validateSIDC(sidc);
            if (!validation.valid) {
                return { canParse: false, error: validation.error };
            }

            // Additional check: ensure we can extract meaningful properties
            const parsed = this.parseSIDC(sidc);
            
            // Verify core components are present
            if (!parsed.context || !parsed.standardIdentity || !parsed.echelon || !parsed.mainIcon) {
                return { canParse: false, error: 'SIDC missing required components' };
            }

            return { canParse: true, properties: parsed };
        } catch (error) {
            return { canParse: false, error: error.message };
        }
    }

    // Convert any image (SVG/PNG/etc) to PNG blob using canvas
    async convertToPngBlob(dataURL, targetSize = DEFAULT_SIZE) {
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
                    let newWidth, newHeight;
                    if (aspectRatio >= 1) {
                        // Landscape or square
                        newWidth = targetSize;
                        newHeight = Math.round(targetSize / aspectRatio);
                    } else {
                        // Portrait
                        newHeight = targetSize;
                        newWidth = Math.round(targetSize * aspectRatio);
                    }

                    // 4. Create canvas with target size (square for padding)
                    const canvas = document.createElement('canvas');
                    canvas.width = targetSize;
                    canvas.height = targetSize;
                    const ctx = canvas.getContext('2d');

                    // 5. Clear background (transparent)
                    ctx.clearRect(0, 0, targetSize, targetSize);

                    // 6. Calculate position to center image
                    const offsetX = Math.round((targetSize - newWidth) / 2);
                    const offsetY = Math.round((targetSize - newHeight) / 2);

                    // 7. Draw centered image with correct proportions
                    ctx.drawImage(img, offsetX, offsetY, newWidth, newHeight);

                    // 8. Convert canvas to PNG blob
                    canvas.toBlob((blob) => {
                        if (blob) {
                            resolve(blob);
                        } else {
                            reject(new Error('Failed to convert to PNG blob'));
                        }
                    }, 'image/png', 1.0);

                } catch (error) {
                    reject(error);
                }
            };

            img.onerror = () => {
                reject(new Error('Failed to load image for PNG conversion'));
            };

            // Load image from data URL
            img.src = dataURL;
        });
    }

    // Generate symbol blob
    async generateSymbolBlob(properties) {
        // 1. Normalize SIDC to 30 digits
        const sidc30 = normalizeSIDC(properties.sidc);
        if (!sidc30) {
            throw new Error('Invalid SIDC for normalization');
        }
        
        const sidc20 = getBaseSIDC(sidc30);
        const mainIcon = sidc20.substring(10, 16);
        
        // 2. Decode extension
        const extension = BrazilianSIDCExtension.decode(sidc30.substring(20));
        
        // 3. Determine base SIDC for generation
        let baseSIDC = sidc20;
        
        // If has entity extension, use appropriate base SIDC
        if (extension && extension.entityExtension > 0) {
            const entityExt = processEntityExtension(extension);
            if (entityExt && entityExt.baseSIDC) {
                baseSIDC = entityExt.baseSIDC;
                console.log(`Using base SIDC for entity extension: ${baseSIDC}`);
            }
        }

        // Cache key includes sidc30 and fillColor
        const cacheKey = `${sidc30}_${properties.fillColor || 'default'}`;
        if (this.symbolCache.has(cacheKey)) {
            return this.symbolCache.get(cacheKey);
        }

        try {
            const validation = this.validateSIDC(sidc20);
            if (!validation.valid) {
                console.error('Invalid SIDC:', validation.error);
            }

            // 4. Configure symbol options
            const symbolOptions = {
                size: DEFAULT_SIZE * 0.5,
                frame: true,
                fill: true,
                strokeWidth: 3,
                colorMode: 'Light'
            };

            // Apply custom color if defined
            if (properties.fillColor) {
                symbolOptions.fillColor = properties.fillColor;
            }

            // 5. Generate base SVG with milsymbol.js
            const symbol = new ms.Symbol(baseSIDC, symbolOptions);

            // Check if symbol was generated successfully
            if (!symbol || symbol.isValid === false) {
                console.warn('milsymbol.js returned invalid symbol for SIDC:', baseSIDC);
            }

            // 6. Get SVG string
            let svgString = symbol.asSVG();

            // 7. Apply all Brazilian modifications
            svgString = applyBrazilianModifications(svgString, sidc30, mainIcon);

            // 8. Convert modified SVG to data URL
            const svgDataURL = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);

            // 9. Convert to PNG using canvas
            const pngBlob = await this.convertToPngBlob(svgDataURL, DEFAULT_SIZE);

            // 10. Add to cache
            this.symbolCache.set(cacheKey, pngBlob);
            return pngBlob;

        } catch (error) {
            console.error('Error generating symbol:', error);
            throw error;
        }
    }

    // Validate SIDC (accepts 20 or 30 digits)
    validateSIDC(sidc) {
        if (!sidc) {
            return { valid: false, error: 'SIDC is null or undefined' };
        }
        
        // Remove spaces
        sidc = sidc.replace(/\s/g, '');
        
        if (sidc.length !== 20 && sidc.length !== 30) {
            return { valid: false, error: `SIDC must be 20 or 30 digits, got ${sidc.length}` };
        }

        // Validate first 20 digits (APP-6D)
        const sidc20 = sidc.substring(0, 20);
        if (!/^[0-9]{20}$/.test(sidc20)) {
            return { valid: false, error: 'First 20 digits must be numeric' };
        }

        // Verify format ID
        const formatId = sidc20.substring(0, 2);
        if (formatId !== "10") {
            return { valid: false, error: `Format ID must be "10", got "${formatId}"` };
        }
        
        // If 30 digits, validate extension
        if (sidc.length === 30) {
            const extension = sidc.substring(20);
            if (!/^[0-9]{10}$/.test(extension)) {
                return { valid: false, error: 'Extension must be 10 numeric digits' };
            }
            
            const countryCode = extension.substring(0, 3);
            if (countryCode !== '076') {
                return { 
                    valid: false, 
                    error: `Country code must be "076" (Brazil), got "${countryCode}"` 
                };
            }
        }

        return { valid: true };
    }

    // Generate preview for UI (reuses PNG conversion logic)
    async generatePreviewDataURL(sidc, size = 80, customColor = null) {
        try {
            // Normalize to 30 digits
            const sidc30 = normalizeSIDC(sidc);
            if (!sidc30) {
                return null;
            }
            
            const sidc20 = getBaseSIDC(sidc30);
            const mainIcon = sidc20.substring(10, 16);
            
            // Decode extension
            const extension = BrazilianSIDCExtension.decode(sidc30.substring(20));
            
            // Determine base SIDC
            let baseSIDC = sidc20;
            if (extension && extension.entityExtension > 0) {
                const entityExt = processEntityExtension(extension);
                if (entityExt && entityExt.baseSIDC) {
                    baseSIDC = entityExt.baseSIDC;
                }
            }
            
            // Configure symbol options
            const symbolOptions = {
                size: size,
                frame: true,
                fill: true,
                strokeWidth: 2,
                colorMode: 'Light'
            };

            // Apply custom color if defined
            if (customColor) {
                symbolOptions.fillColor = customColor;
            }

            // Generate symbol
            const symbol = new ms.Symbol(baseSIDC, symbolOptions);

            if (!symbol || symbol.isValid === false) {
                console.warn('milsymbol.js returned invalid symbol for SIDC:', baseSIDC);
                return null;
            }

            // Get SVG and apply Brazilian modifications
            let svgString = symbol.asSVG();
            svgString = applyBrazilianModifications(svgString, sidc30, mainIcon);

            // Convert to data URL
            const svgDataURL = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);

            // Convert to PNG and then to data URL
            const pngBlob = await this.convertToPngBlob(svgDataURL, size);

            // Convert blob to data URL
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.readAsDataURL(pngBlob);
            });

        } catch (error) {
            console.error('Error generating preview:', error);
            return null;
        }
    }

    clearCache() {
        this.symbolCache.clear();
    }
}