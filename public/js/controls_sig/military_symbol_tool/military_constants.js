// Path: js\controls_sig\military_symbol_tool\military_constants.js

// Dados extraídos do arquivo de simbologia militar brasileira
export const MILITARY_DATA = {
    affiliations: [
        { value: "01", label: "Desconhecido" },
        { value: "03", label: "Amigo" },
        { value: "04", label: "Neutro" }, 
        { value: "06", label: "Hostil" }
    ],
    
    dimensions: [
        { value: "01", label: "Terrestre" },
        { value: "02", label: "Ar" },
        { value: "04", label: "Naval/Superfície" },
        { value: "05", label: "Subsuperfície" }
    ],
    
    echelons: [
        { value: "Tu", label: "Turma" },
        { value: "GC", label: "Grupo de Combate" },
        { value: "Pel", label: "Pelotão" },
        { value: "SU", label: "Subunidade (Cia/Esqd/Bia)" },
        { value: "Btl", label: "Batalhão" },
        { value: "Gp", label: "Grupo" },
        { value: "Rgt", label: "Regimento" },
        { value: "GU", label: "Grande Unidade (Brigada)" },
        { value: "DE", label: "Divisão de Exército" },
        { value: "C Ex", label: "Corpo de Exército" },
        { value: "RM", label: "Região Militar" },
        { value: "TO", label: "Teatro de Operações" }
    ],
    
    mainIcons: [
        { value: "0000", label: "Comando Não Especificado", sidc: "000000" },
        { value: "1211", label: "Infantaria", sidc: "1211000000" },
        { value: "1205", label: "Cavalaria Blindada/Mecanizada", sidc: "1205000000" },
        { value: "1213", label: "Cavalaria", sidc: "1213000000" },
        { value: "1303", label: "Artilharia de Campanha", sidc: "1303000000" },
        { value: "1301", label: "Artilharia Antiaérea", sidc: "1301000000" },
        { value: "1407", label: "Engenharia", sidc: "1407000000" },
        { value: "1110", label: "Comunicações", sidc: "1110000000" },
        { value: "1600", label: "Logística", sidc: "1600000000" },
        { value: "1611", label: "Manutenção", sidc: "1611000000" },
        { value: "1613", label: "Saúde", sidc: "1613000000" },
        { value: "1634", label: "Suprimento", sidc: "1634000000" },
        { value: "1636", label: "Transporte", sidc: "1636000000" },
        { value: "1510", label: "Inteligência Militar", sidc: "1510000000" },
        { value: "1505", label: "Guerra Eletrônica", sidc: "1505000000" },
        { value: "1218", label: "Operações Especiais", sidc: "1218000000" },
        { value: "1217", label: "Ações de Comandos", sidc: "1217000000" },
        { value: "1412", label: "Polícia Militar", sidc: "1412000000" },
        { value: "1206", label: "Aviação do Exército", sidc: "1206000000" },
        { value: "1701", label: "Naval", sidc: "1701000000" }
    ],
    
    modifier1: [
        { value: "00", label: "Nenhum" },
        { value: "01", label: "Aeromóvel" },
        { value: "05", label: "Fronteira" },
        { value: "10", label: "Comando e Controle" },
        { value: "12", label: "Construção" },
        { value: "34", label: "Mísseis" },
        { value: "41", label: "Lançadora de Múltiplos Foguetes" },
        { value: "50", label: "Radar" },
        { value: "53", label: "Busca e Salvamento (SAR)" },
        { value: "67", label: "Busca de Alvos" },
        { value: "77", label: "Apoio" },
        { value: "98", label: "Elemento de Comando" }
    ],
    
    modifier2: [
        { value: "00", label: "Nenhum" },
        { value: "01", label: "Paraquedista" },
        { value: "15", label: "Pesado" },
        { value: "19", label: "Leve" },
        { value: "24", label: "Médio" },
        { value: "27", label: "Montanha" },
        { value: "40", label: "Ribeirinho" },
        { value: "45", label: "Apoio" },
        { value: "47", label: "Rebocado" },
        { value: "51", label: "Sobre Rodas" }
    ],
    
    modifierTransversal: [
        { value: "00", label: "Nenhum" },
        { value: "BLD", label: "Blindado" },
        { value: "MEC", label: "Mecanizado" },
        { value: "MTZ", label: "Motorizado" },
        { value: "DEFESA_AEREA", label: "Defesa Aérea" }
    ]
};

export const ECHELON_MAPPING = {
    'Tu': '11',      // Team
    'GC': '12',      // Squad  
    'Pel': '13',     // Section
    'SU': '14',      // Platoon
    'Btl': '15',     // Company
    'Gp': '16',      // Battalion
    'Rgt': '17',     // Regiment
    'GU': '18',      // Brigade
    'DE': '21',      // Division
    'C Ex': '22',    // Corps
    'RM': '23',      // Army
    'TO': '24'       // Army Group
};