// Path: js/military_tools/military_symbol_tool/military_constants.js

/**
 * @fileoverview Small, always-available symbol metadata: the fixed option lists
 * (standard identity, status, echelon, mobility…) and the per-symbol-set
 * applicability predicates.
 *
 * The eleven symbol-set TABLES do NOT live here anymore. They are ~215 kB that
 * only the selector modal reads, and they were dragging the whole block into the
 * eager `military-tools` chunk through this file. They now load on demand from
 * `symbol_sets.registry.js`; do not import `./data/` from this module again.
 */

import {
    getTextModifiersConfig,
    hasTextModifiers
} from './text_modifiers_catalog.js';

export const MILITARY_DATA = {
    format: "10",

    standardIdentity: [
        { value: "0", label: "Pendente" },
        { value: "1", label: "Desconhecido" },
        { value: "2", label: "Presumido Amigo" },
        { value: "3", label: "Amigo" },
        { value: "4", label: "Neutro" },
        { value: "5", label: "Suspeito" },
        { value: "6", label: "Hostil" }
    ],

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

    status: [
        { value: "0", label: "Posição atual ou confirmada" },
        { value: "1", label: "Posição planejada, estimada ou suspeita" },
        { value: "2", label: "Confirmado e operacional" },
        { value: "3", label: "Confirmado e danificado" },
        { value: "4", label: "Confirmado e destruído" },
        { value: "5", label: "Confirmado e completo" }
    ],

    hqTfDummy: [
        { value: "0", label: "Não Aplicável" },
        { value: "2", label: "Posto de Comando" },
        { value: "4", label: "Força-Tarefa" },
        { value: "6", label: "Posto de Comando de Força-Tarefa" },
    ],

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

    leadership: [
        { value: "00", label: "Não Especificado" },
        { value: "71", label: "Líder/Comandante" },
        { value: "72", label: "Subchefe/Subcomandante" }
    ],

    specialModifier: [
        { value: "0", label: "Não Aplicável" },
        { value: "1", label: "Blindado" },
        { value: "2", label: "Mecanizado" },
        { value: "3", label: "Motorizado" },
        { value: "4", label: "Defesa Aérea" }
    ],

    specialModifierEquipment: [
        { value: "0", label: "Não Aplicável" },
        { value: "1", label: "Blindado" }
    ]
};

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
 * Get echelon/mobility/leadership data based on symbol set
 * @param {string} symbolSetCode - Symbol set code (e.g., "10", "15", "27")
 * @returns {Object} { data: Array, label: string, applicable: boolean }
 */
export function getEchelonData(symbolSetCode) {
    switch(symbolSetCode) {
        case '10':
            return {
                data: MILITARY_DATA.echelon,
                label: 'Escalão',
                applicable: true
            };
        case '15':
            return {
                data: MILITARY_DATA.mobility,
                label: 'Mobilidade',
                applicable: true
            };
        case '27':
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
        case '10':
            return {
                data: MILITARY_DATA.specialModifier,
                applicable: true
            };
        case '15':
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
    return symbolSetCode === '10';
}

/**
 * Check if Modifier 1 is applicable for symbol set
 * @param {string} symbolSetCode - Symbol set code
 * @returns {boolean} True if Modifier 1 is applicable
 */
export function isModifier1Applicable(symbolSetCode) {
    const noModifier1 = ['36'];
    return !noModifier1.includes(symbolSetCode);
}

/**
 * Check if Modifier 2 is applicable for symbol set
 * @param {string} symbolSetCode - Symbol set code
 * @returns {boolean} True if Modifier 2 is applicable
 */
export function isModifier2Applicable(symbolSetCode) {
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
 * Check if echelon is applicable for a symbol set
 * @param {string} symbolSetCode - Symbol set code
 * @returns {boolean} True if echelon is applicable
 */
export function isEchelonApplicable(symbolSetCode) {
    const echelonApplicable = ['10', '30', '35'];
    return echelonApplicable.includes(symbolSetCode);
}

/**
 * Check if HQ/TF/Dummy is applicable for a symbol set
 * @param {string} symbolSetCode - Symbol set code
 * @returns {boolean} True if HQ/TF/Dummy is applicable
 */
export function isHqTfApplicable(symbolSetCode) {
    const hqTfApplicable = ['10', '30', '35'];
    return hqTfApplicable.includes(symbolSetCode);
}

export { getTextModifiersConfig, hasTextModifiers };
