// Path: js\controls_sig\military_symbol_tool\military_constants.js

export const MILITARY_DATA = {
    // Posições 3-4: Afiliação
    affiliations: [
        { value: "06", label: "Desconhecido" },
        { value: "03", label: "Amigo" },
        { value: "04", label: "Neutro" },
        { value: "01", label: "Hostil" }
    ],

    // Posições 1-2: Symbol Set (Dimensão)
    dimensions: [
        { value: "10", label: "Unidade" },
        { value: "15", label: "Equipamento/Viatura" },
        { value: "01", label: "Aeronave" },
        { value: "30", label: "Instalação" }
    ],

    // Posições 11-12: Escalão
    echelons: [
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
        { value: "24", label: "Teatro de Operações" }
    ],

    // Posições 13-18: Function ID (6 dígitos)
    mainIcons: [
        { value: "121100", label: "Infantaria" },
        { value: "121103", label: "Infantaria Blindada/Mecanizada" },
        { value: "120500", label: "Cavalaria" },
        { value: "120501", label: "Cavalaria Blindada/Mecanizada" },
        { value: "100300", label: "Artilharia de Campanha" },
        { value: "100301", label: "Artilharia de Campanha Autopropulsada" },
        { value: "100100", label: "Artilharia Antiaérea" },
        { value: "130000", label: "Engenharia" },
        { value: "130002", label: "Engenharia Blindada/Mecanizada" },
        { value: "100200", label: "Comunicações" },
        { value: "160000", label: "Logística" },
        { value: "160200", label: "Manutenção" },
        { value: "160400", label: "Suprimento" },
        { value: "160500", label: "Transporte" },
        { value: "110300", label: "Forças Especiais" },
        { value: "110400", label: "Ações de Comandos" },
        { value: "180100", label: "Guerra Eletrônica" },
        { value: "100600", label: "Aviação do Exército" }
    ],

    // Posições 19-20: Modificador Específico (valores reais do SIDC)
    modifier2: [
        { value: "00", label: "Nenhum" },
        { value: "01", label: "Paraquedista" },
        { value: "02", label: "Leve" },
        { value: "03", label: "Médio" },
        { value: "04", label: "Pesado" },
        { value: "05", label: "Montanha" },
        { value: "06", label: "Selva" },
        { value: "07", label: "Sobre Rodas" },
        { value: "08", label: "Carros de Combate" },
        { value: "09", label: "Aeromóvel" },
        { value: "11", label: "Guerra Eletrônica" },
        { value: "12", label: "Motorizado" }
    ],

    // Modificadores lógicos (não entram diretamente no SIDC)
    modifier1: [
        { value: "none", label: "Nenhum" },
        { value: "airmobile", label: "Aeromóvel" },
        { value: "ranger", label: "Caçador" },
        { value: "ew", label: "Guerra Eletrônica" }
    ],

    modifierTransversal: [
        { value: "none", label: "Nenhum" },
        { value: "armored", label: "Blindado" },
        { value: "mechanized", label: "Mecanizado" },
        { value: "motorized", label: "Motorizado" }
    ]
};