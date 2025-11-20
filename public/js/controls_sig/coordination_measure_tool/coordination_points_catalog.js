// Path: js\controls_sig\coordination_measure_tool\coordination_points_catalog.js
import { ECHELON_CODES, SUPPLY_CLASSES } from './coordination_measure_constants.js';

// Símbolos de escalão
const ECHELON_SYMBOLS = {
  "00": ``,
  "11": ``,
  "12": ``,
  "13": ``,
  "14": ``,
  "15": ``,
  "16": ``,
  "17": ``,
  "18": ``,
  "21": ``,
  "22": ``,
  "23": ``,
  "25": ``,
  "26": ``
};

const ECHELON_SYMBOLS_FT = {
  "00": ``,
  "11": ``,
  "12": ``,
  "13": ``,
  "14": ``,
  "15": ``,
  "16": ``,
  "17": ``,
  "18": ``,
  "21": ``,
  "22": ``,
  "23": ``,
  "25": ``,
  "26": ``
};

// Ícones de classe de suprimento (mantidos para compatibilidade com o generator)
const SUPPLY_CLASS_ICONS = {
  "I": ``,
  "II": ``,
  "III": ``,
  "IV": ``,
  "V": ``,
  "VI": ``,
  "VII": ``,
  "VIII": ``,
  "IX": ``,
  "X": ``,
  "Agua": ``,
  "Outras": ``
};

const BASE_POINTS = {
  // ===== GERAIS =====
  "130100": {
    code: "130100",
    name: "Ponto genérico",
    category: "Gerais",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "bottom-center",
    textFields: ["tipo", "identificacao", "gdhIni", "gdhFim"]
  },
  
  "130600": {
    code: "130600",
    name: "Ponto de Coordenação",
    category: "Gerais",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },

  // ===== MOVIMENTO E MANOBRA =====
  "130500": {
    code: "130500",
    name: "Ponto de Ligação (numerado)",
    category: "Movimento e Manobra",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    requiresNumber: true,
    textFields: ["numero", "gdhIni", "gdhFim"]
  },
  
  "130700": {
    code: "130700",
    name: "Ponto de Decisão (numerado)",
    category: "Movimento e Manobra",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    requiresNumber: true,
    textFields: ["numero", "gdhIni", "gdhFim"]
  },
  
  "131300": {
    code: "131300",
    name: "Ponto de Interesse (numerado)",
    category: "Movimento e Manobra",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "bottom-center",
    requiresNumber: true,
    textFields: ["numero", "gdhIni", "gdhFim"]
  },
  
  "160100": {
    code: "160100",
    name: "Posto de Observação",
    category: "Movimento e Manobra",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },

  // ===== PASSAGENS =====
  "271500": {
    code: "271500",
    name: "Trilha/travessia para pessoas a pé",
    category: "Passagens",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "bottom-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "290600": {
    code: "290600",
    name: "Travessia/brecha simples",
    category: "Passagens",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "290699": {
    code: "290699",
    name: "Travessia/brecha dupla",
    category: "Passagens",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "290800": {
    code: "290800",
    name: "Travessia para carros de combate",
    category: "Passagens",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "290899_EXT1": {
    code: "290899_EXT1",
    name: "Local de portada leve",
    category: "Passagens",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "290899_EXT2": {
    code: "290899_EXT2",
    name: "Local de portada pesada",
    category: "Passagens",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "290700": {
    code: "290700",
    name: "Local de passadeira",
    category: "Passagens",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "271400": {
    code: "271400",
    name: "Ponte ou passagem tática",
    category: "Passagens",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "271300": {
    code: "271300",
    name: "Local de travessia de assalto",
    category: "Passagens",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },

  // ===== FOGOS =====
  "240601": {
    code: "240601",
    name: "Concentração de fogos",
    category: "Fogos",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "bottom-center",
    textFields: ["numeroConcentracao", "altitude", "gdhIni", "gdhFim"]
  },

  // ===== PROTEÇÃO - OBSTÁCULOS =====
  "271201": {
    code: "271201",
    name: "Destruição planejada",
    category: "Proteção - Obstáculos",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "271203": {
    code: "271203",
    name: "Destruição preparada",
    category: "Proteção - Obstáculos",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "271204": {
    code: "271204",
    name: "Destruição realizada",
    category: "Proteção - Obstáculos",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },

  // ===== PROTEÇÃO - FORTIFICAÇÃO =====
  "280900": {
    code: "280900",
    name: "Abrigo individual",
    category: "Proteção - Fortificação",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "281000": {
    code: "281000",
    name: "Abrigo superficial",
    category: "Proteção - Fortificação",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "281100": {
    code: "281100",
    name: "Abrigo subterrâneo",
    category: "Proteção - Fortificação",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "281200": {
    code: "281200",
    name: "Local fortificado",
    category: "Proteção - Fortificação",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },

  // ===== PROTEÇÃO - MINAS =====
  "280600": {
    code: "280600",
    name: "Mina de qualquer tipo",
    category: "Proteção - Minas",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "280200": {
    code: "280200",
    name: "Mina antipessoal",
    category: "Proteção - Minas",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "280300": {
    code: "280300",
    name: "Mina anticarro",
    category: "Proteção - Minas",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "280700": {
    code: "280700",
    name: "Armadilha",
    category: "Proteção - Minas",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "270701": {
    code: "270701",
    name: "Indicação pontual de campo minado",
    category: "Proteção - Minas",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "270800": {
    code: "270800",
    name: "Área minada",
    category: "Proteção - Minas",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },

  // ===== PROTEÇÃO - QBRN =====
  "281301": {
    code: "281301",
    name: "Evento químico",
    category: "Proteção - QBRN",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "281400": {
    code: "281400",
    name: "Evento biológico",
    category: "Proteção - QBRN",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "281700": {
    code: "281700",
    name: "Evento radiológico",
    category: "Proteção - QBRN",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "281500": {
    code: "281500",
    name: "Evento nuclear",
    category: "Proteção - QBRN",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },

  // ===== CONTROLE AÉREO =====
  "180000": {
    code: "180000",
    name: "Ponto de Controle Aéreo",
    category: "Controle Aéreo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["numero", "gdhIni", "gdhFim"]
  },

  // ===== CONTROLE MARÍTIMO =====
  "210200": {
    code: "210200",
    name: "Ponto de visada",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "210300": {
    code: "210300",
    name: "Meio defendido",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "210500": {
    code: "210500",
    name: "Local de desembarque",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "210600": {
    code: "210600",
    name: "Detonação aérea",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "210700": {
    code: "210700",
    name: "Ponto zero",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "210800": {
    code: "210800",
    name: "Ponto de impacto",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "210900": {
    code: "210900",
    name: "Ponto de impacto previsto",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "211100": {
    code: "211100",
    name: "Ponto de detecção do míssil",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "211200": {
    code: "211200",
    name: "Despistador - Contramedida acústica",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "211300": {
    code: "211300",
    name: "Despistador - Contramedida eletrônica",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "211500": {
    code: "211500",
    name: "Datum",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "211700": {
    code: "211700",
    name: "Submarino submerso reportado",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "211800": {
    code: "211800",
    name: "Santuário",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "211900": {
    code: "211900",
    name: "Centro da Cobertura",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "212000": {
    code: "212000",
    name: "Contato perdido",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "212100": {
    code: "212100",
    name: "Poita",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "212300": {
    code: "212300",
    name: "Fixo acústico",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "212400": {
    code: "212400",
    name: "Fixo eletromagnético",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "212500": {
    code: "212500",
    name: "Detecção de anomalia magnética (MAD)",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "212600": {
    code: "212600",
    name: "Fixo visual",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "212700": {
    code: "212700",
    name: "Formação",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "212800": {
    code: "212800",
    name: "Ancoradouro",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "212900": {
    code: "212900",
    name: "Ponto de entrada no porto",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "213000": {
    code: "213000",
    name: "Posição do DIP",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "213100": {
    code: "213100",
    name: "Busca",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "213200": {
    code: "213200",
    name: "Área de busca",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "213300": {
    code: "213300",
    name: "Centro da busca",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "213400": {
    code: "213400",
    name: "Ponto de referência à navegação",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "213500": {
    code: "213500",
    name: "Sonoboia",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "214100": {
    code: "214100",
    name: "Centro da área vital",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  },
  
  "214700": {
    code: "214700",
    name: "Posição estimada",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "center-center",
    textFields: ["identificacao", "gdhIni", "gdhFim"]
  }
};

// Função para gerar pontos de escalão
function generateEchelonPoints() {
  const echelonPoints = {};
  
  // Escalões normais
  Object.entries(ECHELON_CODES).forEach(([code, label]) => {
    const pointCode = `ECHELON_${code}`;
    echelonPoints[pointCode] = {
      code: pointCode,
      name: `Escalão - ${label}`,
      category: "Escalão",
      svg: `${ECHELON_SYMBOLS[code]}`,
      anchor: "center-center",
      isEchelon: true,
      echelonCode: code,
      textFields: ["status", "gdhIni", "gdhFim"]
    };
  });
  
  // Escalões Força-Tarefa
  Object.entries(ECHELON_CODES).forEach(([code, label]) => {
    const pointCode = `ECHELON_FT_${code}`;
    echelonPoints[pointCode] = {
      code: pointCode,
      name: `Escalão FT - ${label}`,
      category: "Escalão Força-Tarefa",
      svg: `${ECHELON_SYMBOLS_FT[code]}`,
      anchor: "center-center",
      isEchelon: true,
      isForcaTarefa: true,
      echelonCode: code,
      textFields: ["status", "gdhIni", "gdhFim"]
    };
  });
  
  return echelonPoints;
}

// Função para gerar pontos de suprimento
function generateSupplyPoints() {
  const supplyPoints = {};
  
  Object.entries(SUPPLY_CLASSES).forEach(([classCode, className]) => {
    const pointCode = `SUPPLY_${classCode}`;
    supplyPoints[pointCode] = {
      code: pointCode,
      name: `Ponto de Suprimento - ${className}`,
      category: "Logística",
      svg: `${SUPPLY_CLASS_ICONS[classCode]}`,
      anchor: "bottom-center",
      hasSupplyIcon: true,
      supplyClass: classCode,
      textFields: ["identificacao", "gdhIni", "gdhFim"]
    };
  });
  
  return supplyPoints;
}

// Construir catálogo completo unificado
export const COORDINATION_POINTS_CATALOG = {
  ...BASE_POINTS,
  ...generateEchelonPoints(),
  ...generateSupplyPoints()
};

export default COORDINATION_POINTS_CATALOG;