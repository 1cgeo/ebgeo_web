// Path: js\controls_sig\military_symbol_tool\brazilian_extension_catalog.js

/**
 * BRAZILIAN LABEL MAPPINGS
 * Maps mainIcon codes to Brazilian abbreviations with font sizes
 * Used for translating American labels to Brazilian Portuguese in SVG symbols
 */
export const BRAZILIAN_LABEL_MAPPINGS = {
    '121700': {
        from: ['SF'],  // American text variations
        to: 'Cmdos',   // Brazilian text
        fontSize: '26' // Smaller font size for "Cmdos"
    },
    '121800': {
        from: ['SOF'], // American text variations
        to: 'FE',      // Brazilian text
    }
};

/**
 * SPECIAL MODIFIERS CATALOG (bits 10-12)
 * Overlaid on center icon
 * 
 * Structure:
 * {
 *   code: number (1-7),
 *   label: string,
 *   abbr: string,
 *   render: {
 *     type: 'svg' | 'text',
 *     position: { x: number, y: number },
 *     svg?: string,
 *     text?: string,
 *     style?: { fontSize, fontFamily, fontWeight, fill }
 *   }
 * }
 * 
 * Binary Calculation Example (Blindado = 1):
 * Bits: 0 000 00000 0 001 00000 00000
 * Decimal: 1024
 * Extension: 0760001024
 * 
 * SIDC Example: 10031000151301000000 0760001024
 */
export const SPECIAL_MODIFIERS_CATALOG = {
    0: { 
        code: 0, 
        label: 'Nenhum',
        render: null
    }
    
    // TODO: Add cases manually as needed
    // Example structure:
    // 1: { 
    //     code: 1, 
    //     label: 'Blindado',
    //     abbr: 'Bld',
    //     render: {
    //         type: 'svg',
    //         position: { x: 100, y: 103 },
    //         svg: '<ellipse cx="100" cy="103" rx="20" ry="10" fill="none" stroke="black" stroke-width="2"/>'
    //     }
    // }
};

/**
 * MODIFIER 2 EXTENSION CATALOG (bits 18-22)
 * Bottom part of frame
 * 
 * Structure: Same as SPECIAL_MODIFIERS_CATALOG
 * 
 * Binary Calculation Example (Selva = 3):
 * Bits: 0 000 00000 0 000 00000 00011
 * Decimal: 3
 * Extension: 0760000003
 * 
 * SIDC Example: 10031000181211000099 0760000003
 * Note: Mod2 = 99 signals extension
 */
export const MOD2_EXTENSION_CATALOG = {
    0: { 
        code: 0, 
        label: 'Nenhum',
        render: null
    }
    
    // TODO: Add cases manually as needed
    // Example structure:
    // 3: { 
    //     code: 3, 
    //     label: 'Selva',
    //     abbr: 'Slv',
    //     render: {
    //         type: 'text',
    //         position: { x: 100, y: 140 },
    //         text: 'Slv',
    //         style: {
    //             fontSize: '11',
    //             fontFamily: 'Arial',
    //             fontWeight: 'bold',
    //             fill: 'black'
    //         }
    //     }
    // }
};

/**
 * ENTITY EXTENSION CATALOG (bits 4-8)
 * Completely new symbols
 * 
 * Structure:
 * {
 *   code: number (0-31),
 *   label: string,
 *   abbr: string,
 *   baseSIDC: string (20 digits - similar symbol to use as base),
 *   render: { ... same as above ... }
 * }
 * 
 * Binary Calculation Example (Guerra Eletrônica = 0):
 * Bits: 0 000 00000 0 000 00000 00000
 * Decimal: 0
 * Extension: 0760000000
 * 
 * SIDC Example: 10031500312299000000 0760000000
 * Note: Entity Type = 99 signals extension
 */
export const ENTITY_EXTENSION_CATALOG = {
    0: { 
        code: 0, 
        label: 'Nenhum',
        render: null
    }
    
    // TODO: Add cases manually as needed
    // Example structure:
    // 0: {
    //     code: 0,
    //     label: 'Guerra Eletrônica',
    //     abbr: 'GE',
    //     baseSIDC: '10031500312200000000', // Sensor as base
    //     render: {
    //         type: 'text',
    //         position: { x: 100, y: 103 },
    //         text: 'GE',
    //         style: {
    //             fontSize: '45',
    //             fontFamily: 'Arial',
    //             fontWeight: 'bold',
    //             fill: 'black'
    //         }
    //     }
    // }
};

/**
 * MODIFIER 1 EXTENSION CATALOG (bits 13-17)
 * Top part of frame
 * 
 * Structure: Same as MOD2_EXTENSION_CATALOG
 * 
 * Binary Calculation: Same pattern as Mod2
 * SIDC Example: Base with Mod1 = 99 signals extension
 */
export const MOD1_EXTENSION_CATALOG = {
    0: { 
        code: 0, 
        label: 'Nenhum',
        render: null
    }
    
    // TODO: Add cases manually as needed
};

/**
 * Get catalog entry by type and code
 * @param {string} catalogType - 'special', 'mod1', 'mod2', 'entity'
 * @param {number} code - Extension code
 * @returns {Object|null} Catalog entry or null
 */
export function getCatalogEntry(catalogType, code) {
    let catalog;
    
    switch(catalogType) {
        case 'special':
            catalog = SPECIAL_MODIFIERS_CATALOG;
            break;
        case 'mod1':
            catalog = MOD1_EXTENSION_CATALOG;
            break;
        case 'mod2':
            catalog = MOD2_EXTENSION_CATALOG;
            break;
        case 'entity':
            catalog = ENTITY_EXTENSION_CATALOG;
            break;
        default:
            return null;
    }
    
    return catalog[code] || null;
}