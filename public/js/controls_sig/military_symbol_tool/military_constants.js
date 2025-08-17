// Path: js\controls_sig\military_symbol_tool\military_constants.js

import landUnitsData from './land_units.js';

export const MILITARY_DATA = {
    // Campo A: Identificador de formato (sempre "10")
    format: "10",

    // Campo B: Contexto (1 dígito)
    context: [
        { value: "0", label: "Realidade" },
        { value: "1", label: "Exercício" },
        { value: "2", label: "Simulação" }
    ],

    // Campo C: Standard Identity (1 dígito)
    standardIdentity: [
        { value: "0", label: "Pendente" },
        { value: "1", label: "Desconhecido" },
        { value: "2", label: "Amigo Presumido" },
        { value: "3", label: "Amigo" },
        { value: "4", label: "Neutro" },
        { value: "5", label: "Suspeito/Joker" },
        { value: "6", label: "Hostil/Faker" }
    ],

    // Campo D: Symbol Set (sempre "10" para Land Unit)
    symbolSet: "10",

    // Campo E: Status (1 dígito)
    status: [
        { value: "0", label: "Presente" },
        { value: "1", label: "Planejado/Antecipado/Suspeito" },
        { value: "2", label: "Presente/Totalmente Capaz" },
        { value: "3", label: "Presente/Danificado" },
        { value: "4", label: "Presente/Destruído" },
        { value: "5", label: "Presente/Capacidade Total" }
    ],

    // Campo F: HQ/TF/Dummy (1 dígito)
    hqTfDummy: [
        { value: "0", label: "Não Aplicável" },
        { value: "1", label: "Falso/Dummy" },
        { value: "2", label: "Quartel-General" },
        { value: "3", label: "Falso/Dummy Quartel-General" },
        { value: "4", label: "Força-Tarefa" },
        { value: "5", label: "Falso/Dummy Força-Tarefa" },
        { value: "6", label: "QG Força-Tarefa" },
        { value: "7", label: "Falso/Dummy QG Força-Tarefa" }
    ],

    // Campo G: Escalão (2 dígitos)
    echelon: [
        { value: "00", label: "Não Especificado" },
        { value: "11", label: "Equipe/Guarnição" },
        { value: "12", label: "Esquadra" },
        { value: "13", label: "Seção" },
        { value: "14", label: "Pelotão/Destacamento" },
        { value: "15", label: "Companhia/Bateria/Tropa" },
        { value: "16", label: "Batalhão/Esquadrão" },
        { value: "17", label: "Regimento/Grupo" },
        { value: "18", label: "Brigada" },
        { value: "21", label: "Divisão" },
        { value: "22", label: "Corpo/MEF" },
        { value: "23", label: "Exército" },
        { value: "24", label: "Grupo de Exércitos/Frente" },
        { value: "25", label: "Região/Teatro" },
        { value: "26", label: "Comando" }
    ],

    // Campo H: Ícone Principal (6 dígitos) - do land_units.json
    mainIcons: landUnitsData.symbol_sets[0]["main icon"],

    // Campo I: Modificador 1 (2 dígitos) - do land_units.json
    modifier1: landUnitsData.symbol_sets[0]["modifier 1"],

    // Campo J: Modificador 2 (2 dígitos) - do land_units.json
    modifier2: landUnitsData.symbol_sets[0]["modifier 2"]
};