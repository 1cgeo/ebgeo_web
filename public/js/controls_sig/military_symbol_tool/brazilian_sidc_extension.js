// Path: js\controls_sig\military_symbol_tool\brazilian_sidc_extension.js

/**
 * Brazilian SIDC Extension Handler
 * Handles encoding/decoding of the 10-digit Brazilian extension (digits 21-30)
 * 
 * Extension Structure (23 bits):
 * Bit 0:      Version (0 = current version)
 * Bits 1-3:   Reserved
 * Bits 4-8:   Entity Extension (0-31)
 * Bit 9:      Command Flag (0 = no, 1 = yes)
 * Bits 10-12: Special Modifier (0-7)
 * Bits 13-17: Modifier 1 Extension (0-31)
 * Bits 18-22: Modifier 2 Extension (0-31)
 */

export class BrazilianSIDCExtension {
    /**
     * Encode extension fields into 10-digit extension string
     * @param {Object} fields - Extension fields
     * @param {number} fields.entityExtension - Entity extension (0-31)
     * @param {boolean} fields.isCommand - Command flag
     * @param {number} fields.specialModifier - Special modifier (0-7)
     * @param {number} fields.mod1Extension - Modifier 1 extension (0-31)
     * @param {number} fields.mod2Extension - Modifier 2 extension (0-31)
     * @returns {string} 10-digit extension string "076XXXXXXX"
     */
    static encode(fields = {}) {
        const {
            entityExtension = 0,
            isCommand = false,
            specialModifier = 0,
            mod1Extension = 0,
            mod2Extension = 0
        } = fields;
        
        // Check if any extension is active
        if (entityExtension === 0 && !isCommand && specialModifier === 0 && 
            mod1Extension === 0 && mod2Extension === 0) {
            return '0760000000'; // Default extension (no extensions)
        }
        
        // Build 23-bit binary string
        let bits = '';
        
        // Bit 0: Version (always 0)
        bits += '0';
        
        // Bits 1-3: Reserved (always 000)
        bits += '000';
        
        // Bits 4-8: Entity Extension (5 bits, 0-31)
        bits += entityExtension.toString(2).padStart(5, '0');
        
        // Bit 9: Command Flag
        bits += isCommand ? '1' : '0';
        
        // Bits 10-12: Special Modifier (3 bits, 0-7)
        bits += specialModifier.toString(2).padStart(3, '0');
        
        // Bits 13-17: Modifier 1 Extension (5 bits, 0-31)
        bits += mod1Extension.toString(2).padStart(5, '0');
        
        // Bits 18-22: Modifier 2 Extension (5 bits, 0-31)
        bits += mod2Extension.toString(2).padStart(5, '0');
        
        // Convert binary to decimal
        const decimalValue = parseInt(bits, 2);
        
        // Pad with zeros to 7 digits
        const extensionCode = decimalValue.toString().padStart(7, '0');
        
        // Return country code + extension code
        return '076' + extensionCode;
    }
    
    /**
     * Decode 10-digit extension into structured fields
     * @param {string} extensionString - "0760001024"
     * @returns {Object} Decoded fields
     */
    static decode(extensionString) {
        // Handle null/undefined or default extension
        if (!extensionString || extensionString === '0760000000') {
            return {
                version: 0,
                reserved: 0,
                entityExtension: 0,
                isCommand: false,
                specialModifier: 0,
                mod1Extension: 0,
                mod2Extension: 0
            };
        }
        
        // Validate length
        if (extensionString.length !== 10) {
            console.error('Extension must be 10 digits, got:', extensionString.length);
            return null;
        }
        
        const countryCode = extensionString.substring(0, 3); // "076"
        const extensionCode = extensionString.substring(3);  // "0001024"
        
        // Validate country code
        if (countryCode !== '076') {
            console.warn('Country code is not Brazil (076):', countryCode);
            return null;
        }
        
        // Convert decimal to 23-bit binary
        const binaryValue = parseInt(extensionCode, 10);
        if (isNaN(binaryValue)) {
            console.error('Invalid extension code (not a number):', extensionCode);
            return null;
        }
        
        const bits = binaryValue.toString(2).padStart(23, '0');
        
        return {
            version: parseInt(bits[0], 2),                      // Bit 0
            reserved: parseInt(bits.substring(1, 4), 2),        // Bits 1-3
            entityExtension: parseInt(bits.substring(4, 9), 2), // Bits 4-8
            isCommand: bits[9] === '1',                         // Bit 9
            specialModifier: parseInt(bits.substring(10, 13), 2), // Bits 10-12
            mod1Extension: parseInt(bits.substring(13, 18), 2), // Bits 13-17
            mod2Extension: parseInt(bits.substring(18, 23), 2)  // Bits 18-22
        };
    }
}

/**
 * Normalize SIDC to 30 digits
 * @param {string} sidc - SIDC with 20 or 30 digits
 * @returns {string} SIDC with 30 digits
 */
export function normalizeSIDC(sidc) {
    if (!sidc) {
        console.error('SIDC is null or undefined');
        return null;
    }
    
    // Remove spaces
    sidc = sidc.replace(/\s/g, '');
    
    // If 20 digits, add default extension
    if (sidc.length === 20) {
        return sidc + '0760000000';
    }
    
    // If 30 digits, return as is
    if (sidc.length === 30) {
        return sidc;
    }
    
    // Invalid length
    console.error(`Invalid SIDC: must be 20 or 30 digits, got ${sidc.length}`);
    return null;
}

/**
 * Extract 20-digit base SIDC
 * @param {string} sidc - SIDC with 20 or 30 digits
 * @returns {string} 20-digit SIDC
 */
export function getBaseSIDC(sidc) {
    if (!sidc) return null;
    
    sidc = sidc.replace(/\s/g, '');
    
    if (sidc.length >= 20) {
        return sidc.substring(0, 20);
    }
    
    return null;
}