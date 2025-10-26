// Path: js\controls_sig\military_symbol_tool\brazilian_extension_catalog.js

/**
 * ========================================
 * BRAZILIAN LABEL MAPPINGS (Situação 1)
 * ========================================
 * Substitui TEXTO dentro dos símbolos
 * Suporta: Main Icon, Modifier 1, Modifier 2
 */

export const BRAZILIAN_LABEL_MAPPINGS = {
    // Main Icon (6 dígitos: posições 11-16)
    mainIcon: {
        '121700': {
            from: 'SF',         // String direta (não array)
            to: 'Cmdos',
            fontSize: '26'      // Opcional
        },
    },
    
    // Modifier 1 (2 dígitos: posições 17-18)
    modifier1: {
        '77': {
            from: 'SPT',
            to: 'Ap'
        },
    },
    
    // Modifier 2 (2 dígitos: posições 19-20)
    modifier2: {
    }
};

/**
 * ========================================
 * MAIN ICON GRAPHIC ADAPTATIONS (Situação 2)
 * ========================================
 * Substitui elementos SVG completos do Main Icon
 * Usa find/replace pois não dá para identificar elementos específicos
 */

export const MAIN_ICON_GRAPHIC_ADAPTATIONS = {
    '121101': {
        // Infantaria Anfíbia: adiciona ondas
        type: 'replace',
        // SVG a ser encontrado e removido (padrão americano)
        find: '<path d="M25,150 L100,52 175,150" stroke-width="4" stroke="black" fill="none"></path>',
        // Novo SVG brasileiro (com ondas)
        replace: `
            <path d="M25,150 L100,52 175,150" stroke-width="4" stroke="black" fill="none"></path>
            <path d="M25,150 C45,110 155,110 175,150" stroke-width="4" stroke="black" fill="none"></path>
        `
    },
    
    '162400': {
        // Recursos Humanos: texto → guarda-chuva
        type: 'replace',
        find: '<text x="100" y="103" text-anchor="middle" font-size="45"',
        replace: `
            <g transform="translate(100, 103)">
                <!-- Guarda-chuva -->
                <path d="M 0,-20 Q -15,-10 -20,0 L -15,0 Q -10,-5 0,-8 Q 10,-5 15,0 L 20,0 Q 15,-10 0,-20" 
                      fill="none" stroke="black" stroke-width="2"/>
                <line x1="0" y1="-8" x2="0" y2="15" stroke="black" stroke-width="2"/>
                <path d="M 0,15 Q 5,18 8,15" fill="none" stroke="black" stroke-width="2"/>
            </g>
        `
    },
    
    '130300': {
        // Artilharia de Campanha: texto → círculo preenchido
        type: 'replace',
        find: '<text x="100" y="103"',
        replace: '<circle cx="100" cy="103" r="15" fill="black" stroke="black" stroke-width="2"/>'
    }
};

/**
 * ========================================
 * SPECIAL MODIFIERS CATALOG (Situação 3.1)
 * ========================================
 * Bits 10-12: Modificadores especiais sobrepostos
 * Apenas adiciona elementos (não substitui)
 */

export const SPECIAL_MODIFIERS_CATALOG = {
    1: {
        // Blindado
        type: 'svg',
        svg: '<path d="M125,80 C150,80 150,120 125,120 L75,120 C50,120 50,80 75,80 Z" stroke-width="4" stroke="black" fill="none"></path>'
    },
    
    2: {
        // Motorizado
        type: 'svg',
        svg: `<path d="M100,50L100,150" stroke-width="4" stroke="black" fill="black"></path>`
    },
    
    3: {
        // Mecanizado
        type: 'svg',
        svg: `<path d="M125,80 C150,80 150,120 125,120 L75,120 C50,120 50,80 75,80 Z" stroke-width="4" stroke="black" fill="none"></path>
            <circle cx="70" cy="125" r="5" stroke-width="4" stroke="black" fill="none"></circle>
            <circle cx="100" cy="125" r="5" stroke-width="4" stroke="black" fill="none"></circle>
            <circle cx="130" cy="125" r="5" stroke-width="4" stroke="black" fill="none"></circle>`
    },
    
    4: {
        // Defesa Aérea
        type: 'svg',
        svg: '<path d="M25,150 C45,110 155,110 175,150" stroke-width="4" stroke="black" fill="none"></path>'
    }
};

/**
 * ========================================
 * MOD2 EXTENSION CATALOG (Situação 3.2)
 * ========================================
 * Bits 18-22: Modificador 2 estendido (parte inferior)
 * Apenas adiciona elementos (não substitui)
 */

export const MOD2_EXTENSION_CATALOG = {
    3: {
        // Selva
        type: 'svg',
        svg: `
            <g transform="translate(0, 0)">
                <!-- Tree trunk/stem -->
                <path
                    d="m 102.56156,143.71255 3.02817,1.50669 v 2.02272 H 94.430924 v -2.00389 l 3.02817,-1.50668 0.02271,-5.02103 v -3.56331 h 4.996486 z"
                    stroke-width="4" stroke="none" fill="black"/>
                <!-- Tree foliage/canopy (club-shaped) -->
                <path
                    d="m 99.839992,137.48995 a 4.7958641,4.7724227 0 0 1 -1.230194,1.92855 c -1.453521,1.37485 -3.588381,1.55566 -5.216022,1.06598 -0.427729,-0.1243 -2.835124,-0.90024 -3.637589,-3.36367 a 5.1592445,5.134027 0 0 1 1.400528,-5.29976 5.6361813,5.6086325 0 0 1 3.251498,-1.31082 c 0.162764,0 0.321743,0 0.321743,0 q 0.151408,0 0.272535,0 a 2.1764971,2.1658588 0 0 1 -0.317958,-0.51604 2.3089796,2.2976936 0 0 1 -0.177905,-0.66294 3.6603004,3.6424094 0 0 1 0.124912,-1.42005 5.8784349,5.849702 0 0 1 2.838909,-3.51811 5.2992974,5.2733953 0 0 1 2.539881,-0.4859 5.4734171,5.446664 0 0 1 3.16822,1.26561 c 1.13556,0.96428 2.35062,2.77984 1.89261,4.44849 a 2.8124128,2.7986662 0 0 1 -0.27632,0.66671 c 0.0833,0 0.20818,0 0.35959,-0.0226 a 6.0071321,5.9777702 0 0 1 2.27113,0.42563 5.2122375,5.1867609 0 0 1 2.72157,2.89661 c 0.11355,0.30133 0.88195,2.44836 -0.37853,4.47861 a 5.25766,5.2319614 0 0 1 -3.50132,2.26003 c -0.24225,0.049 -2.67236,0.48214 -4.62931,-1.13001 a 5.3863572,5.3600296 0 0 1 -1.3324,-1.67619 z"
                    stroke-width="4" stroke="none" fill="black"/>
            </g>
        `
    },
    
    4: {
        // Pantanal
        type: 'text',
        position: { x: 100, y: 140 },
        text: 'Ptl',
        style: {
            fontSize: '13',
            fontFamily: 'Arial, sans-serif',
            fontWeight: 'bold',
            fill: 'black'
        }
    },
};

/**
 * ========================================
 * ENTITY EXTENSION CATALOG (Situação 3.3)
 * ========================================
 * Bits 4-8: Novos símbolos completos
 * Apenas adiciona elementos (não substitui)
 * 
 * Nota: baseSIDC deve ser definido no processamento,
 * não no catálogo (ver brazilian_sidc_extension.js)
 */

export const ENTITY_EXTENSION_CATALOG = {
    0: {
        // Guerra Eletrônica
        baseSIDC: '10031500312299000000',
        type: 'text',
        position: { x: 100, y: 103 },
        text: 'GE',
        style: {
            fontSize: '45',
            fontFamily: 'Arial, sans-serif',
            fontWeight: 'bold',
            fill: 'black'
        }
    }
};

/**
 * ========================================
 * MOD1 EXTENSION CATALOG (Situação 3.4)
 * ========================================
 * Bits 13-17: Modificador 1 estendido (parte superior)
 * Apenas adiciona elementos (não substitui)
 */

export const MOD1_EXTENSION_CATALOG = {
    14: {
        // Reconhecimento
        type: 'text',
        position: { x: 100, y: 65 },
        text: 'Rec',
        style: {
            fontSize: '13',
            fontFamily: 'Arial, sans-serif',
            fontWeight: 'bold',
            fill: 'black'
        }
    }
};

/**
 * ========================================
 * HELPER FUNCTIONS
 * ========================================
 */

/**
 * Get catalog entry by type and code
 * @param {string} catalogType - 'mainIcon', 'modifier1', 'modifier2', 'graphic', 'special', 'mod1', 'mod2', 'entity'
 * @param {string|number} code - Code to lookup
 * @returns {Object|null} Catalog entry or null
 */
export function getCatalogEntry(catalogType, code) {
    let catalog;
    
    switch(catalogType) {
        case 'mainIcon':
            catalog = BRAZILIAN_LABEL_MAPPINGS.mainIcon;
            break;
        case 'modifier1':
            catalog = BRAZILIAN_LABEL_MAPPINGS.modifier1;
            break;
        case 'modifier2':
            catalog = BRAZILIAN_LABEL_MAPPINGS.modifier2;
            break;
        case 'graphic':
            catalog = MAIN_ICON_GRAPHIC_ADAPTATIONS;
            break;
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
    
    return catalog?.[code] || null;
}