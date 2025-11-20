// Path: js\controls_sig\coordination_measure_tool\coordination_measure_constants.js
export const ECHELON_CODES = {
  "00": "Não Especificado",
  "11": "Equipe/Guarnição",
  "12": "Esquadra",
  "13": "Seção",
  "14": "Pelotão/Destacamento",
  "15": "Companhia",
  "16": "Batalhão",
  "17": "Regimento",
  "18": "Brigada",
  "21": "Divisão",
  "22": "Corpo de Exército",
  "23": "Exército",
  "25": "Teatro de Operações",
  "26": "Valor Indeterminado"
};

export const SUPPLY_CLASSES = {
  "I": "Classe I - Víveres",
  "II": "Classe II - Material de Intendência",
  "III": "Classe III - Combustível",
  "IV": "Classe IV - Material de Construção",
  "V": "Classe V - Munição",
  "VI": "Classe VI - Material de Engenharia",
  "VII": "Classe VII - Viaturas",
  "VIII": "Classe VIII - Material de Saúde",
  "IX": "Classe IX - Sobressalentes",
  "X": "Classe X - Material não-militar",
  "Agua": "Água",
  "Outras": "Outras Classes"
};

export const UI_DATA = {
  pointsList: [
    { code: "130100", label: "Ponto genérico", category: "Gerais" },
    { code: "130600", label: "Ponto de Coordenação", category: "Gerais" },
    { code: "130500", label: "Ponto de Ligação (numerado)", category: "Movimento e Manobra" },
    { code: "130700", label: "Ponto de Decisão (numerado)", category: "Movimento e Manobra" },
    { code: "131300", label: "Ponto de Interesse (numerado)", category: "Movimento e Manobra" },
    { code: "160100", label: "Posto de Observação", category: "Movimento e Manobra" },
    { code: "271500", label: "Trilha/travessia para pessoas a pé", category: "Passagens" },
    { code: "290600", label: "Travessia/brecha simples", category: "Passagens" },
    { code: "290699", label: "Travessia/brecha dupla", category: "Passagens" },
    { code: "290800", label: "Travessia para carros de combate", category: "Passagens" },
    { code: "290899_EXT1", label: "Local de portada leve", category: "Passagens" },
    { code: "290899_EXT2", label: "Local de portada pesada", category: "Passagens" },
    { code: "290700", label: "Local de passadeira", category: "Passagens" },
    { code: "271400", label: "Ponte ou passagem tática", category: "Passagens" },
    { code: "271300", label: "Local de travessia de assalto", category: "Passagens" },
    { code: "240601", label: "Concentração de fogos", category: "Fogos" },
    { code: "271201", label: "Destruição planejada", category: "Proteção - Obstáculos" },
    { code: "271203", label: "Destruição preparada", category: "Proteção - Obstáculos" },
    { code: "271204", label: "Destruição realizada", category: "Proteção - Obstáculos" },
    { code: "280900", label: "Abrigo individual", category: "Proteção - Fortificação" },
    { code: "281000", label: "Abrigo superficial", category: "Proteção - Fortificação" },
    { code: "281100", label: "Abrigo subterrâneo", category: "Proteção - Fortificação" },
    { code: "281200", label: "Local fortificado", category: "Proteção - Fortificação" },
    { code: "280600", label: "Mina de qualquer tipo", category: "Proteção - Minas" },
    { code: "280200", label: "Mina antipessoal", category: "Proteção - Minas" },
    { code: "280300", label: "Mina anticarro", category: "Proteção - Minas" },
    { code: "280700", label: "Armadilha", category: "Proteção - Minas" },
    { code: "270701", label: "Indicação pontual de campo minado", category: "Proteção - Minas" },
    { code: "270800", label: "Área minada", category: "Proteção - Minas" },
    { code: "281301", label: "Evento químico", category: "Proteção - QBRN" },
    { code: "281400", label: "Evento biológico", category: "Proteção - QBRN" },
    { code: "281700", label: "Evento radiológico", category: "Proteção - QBRN" },
    { code: "281500", label: "Evento nuclear", category: "Proteção - QBRN" },
    { code: "321700", label: "Ponto de Suprimento genérico", category: "Logística" },
    { code: "180000", label: "Ponto de Controle Aéreo", category: "Controle Aéreo" },
    { code: "210200", label: "Ponto de visada", category: "Controle Marítimo" },
    { code: "210300", label: "Meio defendido", category: "Controle Marítimo" },
    { code: "210500", label: "Local de desembarque", category: "Controle Marítimo" },
    { code: "210600", label: "Detonação aérea", category: "Controle Marítimo" },
    { code: "210700", label: "Ponto zero", category: "Controle Marítimo" },
    { code: "210800", label: "Ponto de impacto", category: "Controle Marítimo" },
    { code: "210900", label: "Ponto de impacto previsto", category: "Controle Marítimo" },
    { code: "211100", label: "Ponto de detecção do míssil", category: "Controle Marítimo" },
    { code: "211200", label: "Despistador - Contramedida acústica", category: "Controle Marítimo" },
    { code: "211300", label: "Despistador - Contramedida eletrônica", category: "Controle Marítimo" },
    { code: "211500", label: "Datum", category: "Controle Marítimo" },
    { code: "211700", label: "Submarino submerso reportado", category: "Controle Marítimo" },
    { code: "211800", label: "Santuário", category: "Controle Marítimo" },
    { code: "211900", label: "Centro da Cobertura", category: "Controle Marítimo" },
    { code: "212000", label: "Contato perdido", category: "Controle Marítimo" },
    { code: "212100", label: "Poita", category: "Controle Marítimo" },
    { code: "212300", label: "Fixo acústico", category: "Controle Marítimo" },
    { code: "212400", label: "Fixo eletromagnético", category: "Controle Marítimo" },
    { code: "212500", label: "Detecção de anomalia magnética (MAD)", category: "Controle Marítimo" },
    { code: "212600", label: "Fixo visual", category: "Controle Marítimo" },
    { code: "212700", label: "Formação", category: "Controle Marítimo" },
    { code: "212800", label: "Ancoradouro", category: "Controle Marítimo" },
    { code: "212900", label: "Ponto de entrada no porto", category: "Controle Marítimo" },
    { code: "213000", label: "Posição do DIP", category: "Controle Marítimo" },
    { code: "213100", label: "Busca", category: "Controle Marítimo" },
    { code: "213200", label: "Área de busca", category: "Controle Marítimo" },
    { code: "213300", label: "Centro da busca", category: "Controle Marítimo" },
    { code: "213400", label: "Ponto de referência à navegação", category: "Controle Marítimo" },
    { code: "213500", label: "Sonoboia", category: "Controle Marítimo" },
    { code: "214100", label: "Centro da área vital", category: "Controle Marítimo" },
    { code: "214700", label: "Posição estimada", category: "Controle Marítimo" }
  ],
  
  echelonSubtypes: [
    { code: "ECHELON_00", label: "Não Especificado" },
    { code: "ECHELON_11", label: "Equipe/Guarnição" },
    { code: "ECHELON_12", label: "Esquadra" },
    { code: "ECHELON_13", label: "Seção" },
    { code: "ECHELON_14", label: "Pelotão/Destacamento" },
    { code: "ECHELON_15", label: "Companhia" },
    { code: "ECHELON_16", label: "Batalhão" },
    { code: "ECHELON_17", label: "Regimento" },
    { code: "ECHELON_18", label: "Brigada" },
    { code: "ECHELON_21", label: "Divisão" },
    { code: "ECHELON_22", label: "Corpo de Exército" },
    { code: "ECHELON_23", label: "Exército" },
    { code: "ECHELON_25", label: "Teatro de Operações" },
    { code: "ECHELON_26", label: "Valor Indeterminado" }
  ],
  
  echelonFTSubtypes: [
    { code: "ECHELON_FT_00", label: "Não Especificado" },
    { code: "ECHELON_FT_11", label: "Equipe/Guarnição" },
    { code: "ECHELON_FT_12", label: "Esquadra" },
    { code: "ECHELON_FT_13", label: "Seção" },
    { code: "ECHELON_FT_14", label: "Pelotão/Destacamento" },
    { code: "ECHELON_FT_15", label: "Companhia" },
    { code: "ECHELON_FT_16", label: "Batalhão" },
    { code: "ECHELON_FT_17", label: "Regimento" },
    { code: "ECHELON_FT_18", label: "Brigada" },
    { code: "ECHELON_FT_21", label: "Divisão" },
    { code: "ECHELON_FT_22", label: "Corpo de Exército" },
    { code: "ECHELON_FT_23", label: "Exército" },
    { code: "ECHELON_FT_25", label: "Teatro de Operações" },
    { code: "ECHELON_FT_26", label: "Valor Indeterminado" }
  ],
  
  textFieldDefinitions: {
    tipo: { 
      label: "Tipo", 
      type: "text", 
      placeholder: "Ex: P Lib" 
    },
    identificacao: { 
      label: "Identificação", 
      type: "text", 
      placeholder: "Ex: ALFA" 
    },
    gdhIni: { 
      label: "GDH Início", 
      type: "text", 
      placeholder: "Ex: 121400Z JUN", 
      help: "Formato: ddhhmmZ mês" 
    },
    gdhFim: { 
      label: "GDH Fim", 
      type: "text", 
      placeholder: "Ex: 121800Z JUN ou Mdt O", 
      help: "Formato: ddhhmmZ mês ou 'Mdt O'" 
    },
    numero: { 
      label: "Número", 
      type: "number", 
      placeholder: "Ex: 3"
    },
    classeSuprimento: { 
      label: "Classe de Suprimento", 
      type: "select", 
      options: Object.keys(SUPPLY_CLASSES) 
    },
    status: { 
      label: "Status", 
      type: "select", 
      options: ["ocupado", "preparado", "preparado-nao-ocupado"]
    },
    numeroConcentracao: { 
      label: "Nº Concentração", 
      type: "text", 
      placeholder: "Ex: HA 107" 
    },
    altitude: { 
      label: "Altitude", 
      type: "text", 
      placeholder: "Ex: 850 m" 
    }
  }
};