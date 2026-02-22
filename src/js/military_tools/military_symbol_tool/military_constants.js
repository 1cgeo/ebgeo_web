// Path: js/military_tools/military_symbol_tool/military_constants.js

// Import all symbol set data files
import landUnitsData from './data/unidades.js';
import aeronaves from './data/aeronaves.js';
import misseis from './data/misseis.js';
import espaciais from './data/espaciais.js';
import equipamentosViaturas from './data/equipamentos_viaturas.js';
import instalacoes from './data/instalacoes.js';
import individuosDesembarcados from './data/individuos_desembarcados.js';
import maritimosSuperficie from './data/maritimos_superficie.js';
import submarinos from './data/submarinos.js';
import guerraMinas from './data/guerra_minas.js';
import atividadesEventos from './data/atividades_eventos.js';

// Import text modifiers catalog
import {
    getTextModifiersConfig,
    hasTextModifiers,
    getTextModifierFieldIds
} from './text_modifiers_catalog.js';

/**
 * ========================================
 * SYMBOL SET REGISTRY
 * ========================================
 * Central registry for all symbol sets (dimensions)
 * Maps symbol set code to its data structure
 */
const SYMBOL_SET_REGISTRY = {
    '01': aeronaves.symbol_sets[0],
    '02': misseis.symbol_sets[0],
    '05': espaciais.symbol_sets[0],
    '10': landUnitsData.symbol_sets[0],
    '15': equipamentosViaturas.symbol_sets[0],
    '20': instalacoes.symbol_sets[0],
    '27': individuosDesembarcados.symbol_sets[0],
    '30': maritimosSuperficie.symbol_sets[0],
    '35': submarinos.symbol_sets[0],
    '36': guerraMinas.symbol_sets[0],
    '40': atividadesEventos.symbol_sets[0]
};

/**
 * ========================================
 * HELPER FUNCTIONS
 * ========================================
 */

/**
 * Get symbol set data by code
 * @param {string} symbolSetCode - Symbol set code (e.g., "01", "10")
 * @returns {Object|null} Symbol set data or null if not found
 */
export function getSymbolSetData(symbolSetCode) {
    return SYMBOL_SET_REGISTRY[symbolSetCode] || null;
}

/**
 * Get main icons for a specific symbol set
 * @param {string} symbolSetCode - Symbol set code
 * @returns {Array} Array of main icon objects
 */
export function getMainIcons(symbolSetCode) {
    const symbolSet = SYMBOL_SET_REGISTRY[symbolSetCode];
    return symbolSet ? symbolSet["main icon"] : [];
}

/**
 * Get modifier 1 options for a specific symbol set
 * @param {string} symbolSetCode - Symbol set code
 * @returns {Array} Array of modifier 1 objects
 */
export function getModifier1(symbolSetCode) {
    const symbolSet = SYMBOL_SET_REGISTRY[symbolSetCode];
    return symbolSet ? symbolSet["modifier 1"] : [];
}

/**
 * Get modifier 2 options for a specific symbol set
 * @param {string} symbolSetCode - Symbol set code
 * @returns {Array} Array of modifier 2 objects
 */
export function getModifier2(symbolSetCode) {
    const symbolSet = SYMBOL_SET_REGISTRY[symbolSetCode];
    return symbolSet ? symbolSet["modifier 2"] : [];
}

/**
 * ========================================
 * MILITARY DATA CONSTANTS
 * ========================================
 */
export const MILITARY_DATA = {
    // Field A: Format Identifier (always "10")
    format: "10",

    // Field C: Standard Identity (1 digit)
    standardIdentity: [
        { value: "0", label: "Pendente" },
        { value: "1", label: "Desconhecido" },
        { value: "2", label: "Presumido Amigo" },
        { value: "3", label: "Amigo" },
        { value: "4", label: "Neutro" },
        { value: "5", label: "Suspeito" },
        { value: "6", label: "Hostil" }
    ],

    // Field D: Symbol Set (2 digits) - NOW DYNAMIC
    symbolSets: [
        { value: "01", label: "Aeronaves" },
        { value: "02", label: "Mísseis" },
        { value: "05", label: "Espaciais" },
        { value: "10", label: "Unidades" },
        { value: "15", label: "Equipamentos e Viaturas" },
        { value: "20", label: "Instalações" },
        { value: "27", label: "Indivíduos Desembarcados" },
        { value: "30", label: "Marítimos de Superfície" },
        { value: "35", label: "Submarinos" },
        { value: "36", label: "Guerra de Minas" },
        { value: "40", label: "Atividades e Eventos" }
    ],

    // Field E: Status (1 digit)
    status: [
        { value: "0", label: "Posição atual ou confirmada" },
        { value: "1", label: "Posição planejada, estimada ou suspeita" },
        { value: "2", label: "Confirmado e operacional" },
        { value: "3", label: "Confirmado e danificado" },
        { value: "4", label: "Confirmado e destruído" },
        { value: "5", label: "Confirmado e completo" }
    ],

    // Field F: HQ/TF/Dummy (1 digit)
    hqTfDummy: [
        { value: "0", label: "Não Aplicável" },
        { value: "2", label: "Posto de Comando" },
        { value: "4", label: "Força-Tarefa" },
        { value: "6", label: "Posto de Comando de Força-Tarefa" },
    ],

    // Field G: Echelon (2 digits)
    echelon: [
        { value: "00", label: "Não Especificado" },
        { value: "11", label: "Equipe/Guarnição" },
        { value: "12", label: "Esquadra" },
        { value: "13", label: "Seção" },
        { value: "14", label: "Pelotão/Destacamento" },
        { value: "15", label: "Companhia" },
        { value: "16", label: "Batalhão" },
        { value: "17", label: "Regimento" },
        { value: "18", label: "Brigada" },
        { value: "21", label: "Divisão" },
        { value: "22", label: "Corpo de Exército" },
        { value: "23", label: "Exército" },
        { value: "25", label: "Teatro de Operações" },
        { value: "26", label: "Valor Indeterminado" }
    ],

    // Field G: Mobility (for Equipment and Vehicles - Symbol Set 15)
    mobility: [
        { value: "00", label: "Não Especificado" },
        { value: "31", label: "Sobre rodas – sem tração" },
        { value: "32", label: "Sobre rodas – tracionado" },
        { value: "33", label: "Sobre lagartas" },
        { value: "34", label: "Meia lagarta" },
        { value: "35", label: "Rebocado" },
        { value: "36", label: "Sobre trilhos" },
        { value: "37", label: "Tração animal" },
        { value: "51", label: "Barca" },
        { value: "52", label: "Anfíbio" },
        { value: "41", label: "Sobre a neve (com motor)" },
        { value: "42", label: "Trenó" },
        { value: "61", label: "Reboque naval curto" },
        { value: "62", label: "Reboque naval longo" }
    ],

    // Field G: Leadership (for Dismounted Individuals - Symbol Set 27)
    leadership: [
        { value: "00", label: "Não Especificado" },
        { value: "71", label: "Líder/Comandante" },
        { value: "72", label: "Subchefe/Subcomandante" }
    ],

    // Cross-Cutting Modifier (Brazilian Extension - Bits 10-12)
    // For Units (10) - all options
    specialModifier: [
        { value: "0", label: "Não Aplicável" },
        { value: "1", label: "Blindado" },
        { value: "2", label: "Mecanizado" },
        { value: "3", label: "Motorizado" },
        { value: "4", label: "Defesa Aérea" }
    ],

    // Cross-Cutting Modifier for Equipment and Vehicles (15) - Armored only
    specialModifierEquipment: [
        { value: "0", label: "Não Aplicável" },
        { value: "1", label: "Blindado" }
    ]
};

/**
 * ========================================
 * ENGAGEMENT BAR DATA
 * ========================================
 */
export const ENGAGEMENT_BAR_DATA = {
    stages: [
        { value: "ASN", label: "Fixar/Cobrir" },
        { value: "ENG", label: "Engajar" },
        { value: "MIF", label: "Míssil em Voo" },
        { value: "CF", label: "Cessar Fogo" },
        { value: "CE", label: "Cessar Engajamento" },
        { value: "HF", label: "Suspender Fogo" },
        { value: "TE", label: "Encerrar Engajamento" },
        { value: "BE", label: "Romper Engajamento" },
        { value: "MBE", label: "Gerenciamento por Exceção" },
        { value: "M<T", label: "MBE Menor que Limite" },
        { value: "MLT", label: "Múltiplos Engajamentos" }
    ],
    weapons: [
        { value: "M", label: "Míssil" },
        { value: "BM", label: "Míssil Balístico" },
        { value: "CM", label: "Míssil de Cruzeiro" },
        { value: "GN", label: "Canhão" },
        { value: "T", label: "Torpedo" },
        { value: "A", label: "Aeronave de Ataque" },
        { value: "C", label: "Patrulha Aérea de Combate" },
        { value: "D", label: "Defesa Aérea" },
        { value: "UW", label: "Guerra Submarina/Antissubmarino" },
        { value: "MW", label: "Guerra de Minas" },
        { value: "SW", label: "Guerra de Superfície" },
        { value: "EA", label: "Ataque Eletrônico" },
        { value: "ED", label: "Defesa Eletrônica" },
        { value: "UV", label: "Veículo Não Tripulado" },
        { value: "CW", label: "Sistema de Armas de Defesa Aproximada" },
        { value: "L3", label: "LAMPS" },
        { value: "VA", label: "Foguete Antissubmarino de Lançamento Vertical" }
    ]
};

/**
 * ========================================
 * ECHELON/MOBILITY/LEADERSHIP HELPERS
 * ========================================
 */

/**
 * Get echelon/mobility/leadership data based on symbol set
 * @param {string} symbolSetCode - Symbol set code (e.g., "10", "15", "27")
 * @returns {Object} { data: Array, label: string, applicable: boolean }
 */
export function getEchelonData(symbolSetCode) {
    switch(symbolSetCode) {
        case '10': // Unidades
            return {
                data: MILITARY_DATA.echelon,
                label: 'Escalão',
                applicable: true
            };
        case '15': // Equipamentos e Viaturas
            return {
                data: MILITARY_DATA.mobility,
                label: 'Mobilidade',
                applicable: true
            };
        case '27': // Dismounted Individuals
            return {
                data: MILITARY_DATA.leadership,
                label: 'Liderança',
                applicable: true
            };
        default:
            return {
                data: [],
                label: '',
                applicable: false
            };
    }
}

/**
 * Get special modifier data based on symbol set
 * @param {string} symbolSetCode - Symbol set code
 * @returns {Object} { data: Array, applicable: boolean }
 */
export function getSpecialModifierData(symbolSetCode) {
    switch(symbolSetCode) {
        case '10': // Units - all options
            return {
                data: MILITARY_DATA.specialModifier,
                applicable: true
            };
        case '15': // Equipment and Vehicles - Armored only
            return {
                data: MILITARY_DATA.specialModifierEquipment,
                applicable: true
            };
        default:
            return {
                data: [],
                applicable: false
            };
    }
}

/**
 * Check if command element is applicable for symbol set
 * @param {string} symbolSetCode - Symbol set code
 * @returns {boolean} True if command element is applicable
 */
export function isCommandApplicable(symbolSetCode) {
    // Command element only for Units
    return symbolSetCode === '10';
}

/**
 * Check if Modifier 1 is applicable for symbol set
 * @param {string} symbolSetCode - Symbol set code
 * @returns {boolean} True if Modifier 1 is applicable
 */
export function isModifier1Applicable(symbolSetCode) {
    // Mine Warfare does not have modifier 1
    const noModifier1 = ['36'];
    return !noModifier1.includes(symbolSetCode);
}

/**
 * Check if Modifier 2 is applicable for symbol set
 * @param {string} symbolSetCode - Symbol set code
 * @returns {boolean} True if Modifier 2 is applicable
 */
export function isModifier2Applicable(symbolSetCode) {
    // No modifier 2: Mine Warfare, Equipment/Vehicles, Activities/Events
    const noModifier2 = ['36', '15', '40'];
    return !noModifier2.includes(symbolSetCode);
}

/**
 * Check if engagement bar is applicable for symbol set
 * @param {string} symbolSetCode - Symbol set code
 * @returns {boolean} True if engagement bar is applicable
 */
export function isEngagementBarApplicable(symbolSetCode) {
    const applicable = ['01', '02', '05', '10', '15', '30', '35', '36'];
    return applicable.includes(symbolSetCode);
}

/**
 * Get engagement bar data (stages and weapons)
 * @returns {Object} { stages: Array, weapons: Array }
 */
export function getEngagementBarData() {
    return ENGAGEMENT_BAR_DATA;
}

/**
 * ========================================
 * VALIDATION HELPERS
 * ========================================
 */

/**
 * Check if a symbol set code is valid
 * @param {string} symbolSetCode - Symbol set code to validate
 * @returns {boolean} True if valid
 */
export function isValidSymbolSet(symbolSetCode) {
    return Object.prototype.hasOwnProperty.call(SYMBOL_SET_REGISTRY, symbolSetCode);
}

/**
 * Get list of all available symbol set codes
 * @returns {Array<string>} Array of symbol set codes
 */
export function getAllSymbolSetCodes() {
    return Object.keys(SYMBOL_SET_REGISTRY);
}

/**
 * Check if echelon is applicable for a symbol set
 * Some symbol sets don't use echelon (e.g., Activities, Equipment)
 * @param {string} symbolSetCode - Symbol set code
 * @returns {boolean} True if echelon is applicable
 */
export function isEchelonApplicable(symbolSetCode) {
    // Echelon is primarily for Land Units, Sea Surface, and some others
    const echelonApplicable = ['10', '30', '35'];
    return echelonApplicable.includes(symbolSetCode);
}

/**
 * Check if HQ/TF/Dummy is applicable for a symbol set
 * @param {string} symbolSetCode - Symbol set code
 * @returns {boolean} True if HQ/TF/Dummy is applicable
 */
export function isHqTfApplicable(symbolSetCode) {
    // HQ/TF primarily for military units
    const hqTfApplicable = ['10', '30', '35'];
    return hqTfApplicable.includes(symbolSetCode);
}

// Export registry for direct access if needed
export { SYMBOL_SET_REGISTRY };
// Re-export text modifiers functions
export { getTextModifiersConfig, hasTextModifiers, getTextModifierFieldIds };
