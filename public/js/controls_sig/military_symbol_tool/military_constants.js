// Path: js\controls_sig\military_symbol_tool\military_constants.js

import landUnitsData from './land_units.js';

export const MILITARY_DATA = {
    // Campo A: Identificador de formato (sempre "10")
    format: "10",


    // Campo C: Standard Identity (1 dígito)
    standardIdentity: [
        { value: "0", label: "Pendente" },
        { value: "1", label: "Desconhecido" },
        { value: "2", label: "Presumido Amigo" },
        { value: "3", label: "Amigo" },
        { value: "4", label: "Neutro" },
        { value: "5", label: "Suspeito" },
        { value: "6", label: "Hostil" }
    ],

    // Campo D: Symbol Set (sempre "10" para Land Unit)
    symbolSet: "10",

    // Campo E: Status (1 dígito)
    status: [
        { value: "0", label: "Posição atual ou confirmada" },
        { value: "1", label: "Posição planejada, estimada ou suspeita" },
        { value: "2", label: "Confirmado e operacional" },
        { value: "3", label: "Confirmado e danificado" },
        { value: "4", label: "Confirmado e destruído" },
        { value: "5", label: "Confirmado e completo" }
    ],

    // Campo F: HQ/TF/Dummy (1 dígito)
    hqTfDummy: [
        { value: "0", label: "Não Aplicável" },
        { value: "2", label: "Posto de Comando" },
        { value: "4", label: "Força-Tarefa" },
        { value: "6", label: "Posto de Comando de Força-Tarefa" },
    ],

    // Campo G: Escalão (2 dígitos)
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

    // Campo H: Ícone Principal (6 dígitos) - do land_units.json
    mainIcons: landUnitsData.symbol_sets[0]["main icon"],

    // Campo I: Modificador 1 (2 dígitos) - do land_units.json
    modifier1: landUnitsData.symbol_sets[0]["modifier 1"],

    // Campo J: Modificador 2 (2 dígitos) - do land_units.json
    modifier2: landUnitsData.symbol_sets[0]["modifier 2"]
,

    // Modificador Transversal (Extensão Brasileira - Bits 10-12)
    // Modificador especial sobreposto ao ícone principal
    specialModifier: [
        { value: "0", label: "Não Aplicável" },
        { value: "1", label: "Blindado" },
        { value: "2", label: "Mecanizado" },
        { value: "3", label: "Motorizado" },
        { value: "4", label: "Defesa Aérea" }
    ]
};