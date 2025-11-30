// Path: src/js/controls_sig/coordination_measure_tool/coordination_points_catalog.js

import { ECHELON_CODES, SUPPLY_CLASSES } from './coordination_measure_constants.js';

// ============================================================================
// ECHELON SYMBOLS
// ============================================================================

const ECHELON_SYMBOLS = {
  "00": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "11": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "12": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "13": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "14": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "15": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "16": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "17": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "18": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "21": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "22": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "23": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "25": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "26": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`
};

// ============================================================================
// ECHELON SYMBOLS - TASK FORCE
// ============================================================================

const ECHELON_SYMBOLS_FT = {
  "00": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "11": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "12": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "13": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "14": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "15": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "16": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "17": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "18": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "21": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "22": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "23": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "25": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "26": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`
};

// ============================================================================
// SUPPLY CLASS ICONS
// ============================================================================

const SUPPLY_CLASS_ICONS = {
  "I": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "II": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "III": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "IV": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "V": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "VI": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "VII": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "VIII": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "IX": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "X": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "Agua": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "Outras": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`
};

// ============================================================================
// BASE COORDINATION POINTS
// ============================================================================

const BASE_POINTS = {
  // ===== GERAIS =====
  "130100": {
    code: "130100",
    name: "Ponto genérico",
    category: "Gerais",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
    anchor: "bottom",
    textFields: {
      tipo: {
        position: { x: 100, y: -20 },
        anchor: 'middle',
        fontWeight: 'bold',
        fontSize: 25
      },
      identificacao: {
        position: { x: 150, y: -40 },
        anchor: 'start',
        fontSize: 20
      },
      gdhIni: {
        position: { x: 50, y: -40 },
        anchor: 'end',
        fontSize: 20
      },
      gdhFim: {
        position: { x: 50, y: -10 },
        anchor: 'end',
        fontSize: 20
      }
    }
  },

  "130600": {
    code: "130600",
    name: "Ponto de Coordenação",
    category: "Gerais",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><circle cx="100" cy="100" r="50" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></circle><path d="M 64.64,64.64 L 135.36,135.36 M 135.36,64.64 L 64.64,135.36" stroke-width="4" stroke="black" fill="none" ></path></svg>`,
    anchor: "center",
    textFields: {} // Símbolo autoexplicativo - texto opcional
  },

  // ===== MOVIMENTO E MANOBRA =====
  "130500": {
    code: "130500",
    name: "Ponto de Ligação (numerado)",
    category: "Movimento e Manobra",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="M 50,50 150,50 150,150 50,150z" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path></svg>`,
    anchor: "center",
    textFields: {
      numero: {
        position: { x: 100, y: 115 },
        anchor: 'middle',
        fontSize: 40,
        fontWeight: 'bold'
      }
    }
  },

  "130700": {
    code: "130700",
    name: "Ponto de Decisão (numerado)",
    category: "Movimento e Manobra",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><circle cx="100" cy="100" r="50" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></circle></svg>`,
    anchor: "center",
    textFields: {
      tipo: {
        position: { x: 100, y: 95 },
        anchor: 'middle',
        fontSize: 30,
        fontWeight: 'bold'
      },
      numero: {
        position: { x: 100, y: 130 },
        anchor: 'middle',
        fontSize: 30,
        fontWeight: 'bold'
      }
    }
  },

  "131300": {
    code: "131300",
    name: "Ponto de Interesse (numerado)",
    category: "Movimento e Manobra",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="133" viewBox="46 -29 108 133"><path d="M 129.021,41.957 C 121.48,49.9458 110.986,54.4816 100,54.5 89.0432,54.4928 78.569,49.9914 71.0234,42.0469 L 100,100 Z" stroke-width="4" stroke="black" fill="black" ></path><circle cx="100" cy="15" r="40" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></circle></svg>`,
    anchor: "bottom",
    textFields: {
      numero: {
        position: { x: 100, y: 30 },
        anchor: 'middle',
        fontSize: 40,
        fontWeight: 'bold'
      }
    }
  },

  "160100": {
    code: "160100",
    name: "Posto de Observação",
    category: "Movimento e Manobra",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="118" viewBox="46 36 108 118"><path d="m 100,45 47.6,82.5 -95.2,0 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path></svg>`,
    anchor: "center",
  },

  // ===== PASSAGENS (símbolos autoexplicativos - sem texto) =====
  "271500": {
    code: "271500",
    name: "Trilha/travessia para pessoas a pé",
    category: "Passagens",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="M 70,130 130,70" stroke-width="4" stroke="black" fill="none" ></path><circle cx="70" cy="130" r="16" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></circle><circle cx="130" cy="70" r="16" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></circle></svg>`,
    anchor: "center",
    textFields: {}
  },

  "290600": {
    code: "290600",
    name: "Travessia/brecha simples",
    category: "Passagens",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="128" height="68" viewBox="36 66 128 68"><path d="M 70,100 130,100" stroke-width="4" stroke="black" fill="none" ></path><path d="M 50,80 70,100 50,120" stroke-width="4" stroke="black" fill="none" ></path><path d="M 150,80 130,100 150,120" stroke-width="4" stroke="black" fill="none" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "290699": {
    code: "290699",
    name: "Travessia/brecha dupla",
    category: "Passagens",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="128" height="68" viewBox="36 66 128 68"><path d="M 62,95 138,95 M 62,105 138,105" stroke-width="4" stroke="black" fill="none" ></path><path d="M 50,80 62,100 50,120" stroke-width="4" stroke="black" fill="none" ></path><path d="M 150,80 138,100 150,120" stroke-width="4" stroke="black" fill="none" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "290800": {
    code: "290800",
    name: "Travessia para carros de combate",
    category: "Passagens",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="128" height="96" viewBox="36 52 128 96"><path d="M 140,120 Q 100,80 60,120" stroke-width="4" stroke="black" fill="none" ></path><path d="m 60,90 15,15 m -15,0 15,-15" stroke-width="4" stroke="black" fill="none" ></path><path d="m 140,90 -15,15 m 15,0 -15,-15" stroke-width="4" stroke="black" fill="none" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "290899_EXT1": {
    code: "290899_EXT1",
    name: "Local de portada leve",
    category: "Passagens",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="128" height="96" viewBox="36 52 128 96"><path d="M 140,120 Q 100,80 60,120" stroke-width="4" stroke="black" fill="none" ></path><circle cx="60" cy="120" r="12" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></circle><circle cx="140" cy="120" r="12" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></circle></svg>`,
    anchor: "center",
    textFields: {}
  },

  "290899_EXT2": {
    code: "290899_EXT2",
    name: "Local de portada pesada",
    category: "Passagens",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="128" height="96" viewBox="36 52 128 96"><path d="M 140,120 Q 100,80 60,120" stroke-width="4" stroke="black" fill="none" ></path><circle cx="60" cy="120" r="12" stroke-width="4" stroke="black" fill="black" ></circle><circle cx="140" cy="120" r="12" stroke-width="4" stroke="black" fill="black" ></circle></svg>`,
    anchor: "center",
    textFields: {}
  },

  "290700": {
    code: "290700",
    name: "Local de passadeira",
    category: "Passagens",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="128" height="96" viewBox="36 52 128 96"><path d="M 140,120 Q 100,80 60,120" stroke-width="4" stroke="black" fill="none" ></path><path d="M 85,111 90,100 m 10,0 5,11 M 105,111 110,100 m 10,0 5,11" stroke-width="4" stroke="black" fill="none" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "271400": {
    code: "271400",
    name: "Ponte ou passagem tática",
    category: "Passagens",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="96" height="128" viewBox="52 36 96 128"><path d="M 70,60 70,140 M 130,60 130,140 M 70,100 130,100" stroke-width="4" stroke="black" fill="none" ></path><path d="M 80,50 90,60 M 80,150 90,140" stroke-width="4" stroke="black" fill="none" ></path><path d="M 120,50 110,60 M 120,150 110,140" stroke-width="4" stroke="black" fill="none" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "271300": {
    code: "271300",
    name: "Local de travessia de assalto",
    category: "Passagens",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="128" height="68" viewBox="36 66 128 68"><path d="M 50,100 L 60,80 M 60,120 L 50,100 M 60,80 L 75,100 M 75,100 L 60,120 M 75,100 L 90,80 M 90,120 L 75,100 M 90,80 L 105,100 M 105,100 L 90,120 M 105,100 L 120,80 M 120,120 L 105,100 M 120,80 L 135,100 M 135,100 L 120,120 M 135,100 L 150,80 M 150,120 L 135,100" stroke-width="3" stroke="black" fill="none" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  // ===== FOGOS =====
  "240601": {
    code: "240601",
    name: "Concentração de fogos",
    category: "Fogos",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="M100 50v38m0 24v38m-50-50h38m24 0h38" stroke-width="2" stroke="#000" fill="none"/><circle cx="100" cy="100" r="5"/></svg>`,
    anchor: "center",
    textFields: {
      numeroConcentracao: {
        position: { x: 110, y: 90 },
        anchor: 'start',
        fontSize: 12,
        fontWeight: 'normal'
      },
      altitude: {
        position: { x: 90, y: 115 },
        anchor: 'end',
        fontSize: 12
      }
    }
  },

  // ===== PROTEÇÃO - OBSTÁCULOS (símbolos autoexplicativos - sem texto) =====
  "271201": {
    code: "271201",
    name: "Destruição planejada",
    category: "Proteção - Obstáculos",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="128" height="96" viewBox="36 52 128 96"><path d="M 50,100 150,100" stroke-width="4" stroke="black" fill="none" ></path><path d="M 70,80 70,120 M 100,80 100,120 M 130,80 130,120" stroke-width="4" stroke="black" stroke-dasharray="8,4" fill="none" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "271203": {
    code: "271203",
    name: "Destruição preparada",
    category: "Proteção - Obstáculos",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="128" height="96" viewBox="36 52 128 96"><path d="M 50,100 150,100" stroke-width="4" stroke="black" fill="none" ></path><path d="M 70,80 70,120 M 100,80 100,120 M 130,80 130,120" stroke-width="4" stroke="black" fill="none" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "271204": {
    code: "271204",
    name: "Destruição realizada",
    category: "Proteção - Obstáculos",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="128" height="96" viewBox="36 52 128 96"><path d="M 50,100 150,100" stroke-width="4" stroke="black" fill="none" ></path><path d="M 60,80 80,120 M 80,80 60,120 M 90,80 110,120 M 110,80 90,120 M 120,80 140,120 M 140,80 120,120" stroke-width="4" stroke="black" fill="none" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  // ===== PROTEÇÃO - FORTIFICAÇÃO (símbolos autoexplicativos - sem texto) =====
  "280900": {
    code: "280900",
    name: "Abrigo individual",
    category: "Proteção - Fortificação",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="m 65,65 0,70 70,0 0,-70 -70,0z" stroke-width="4" stroke="black" fill="black" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "281000": {
    code: "281000",
    name: "Abrigo superficial",
    category: "Proteção - Fortificação",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="m 135,135 15,0 m -100,0 15,0 m 0,-70 0,70 70,0 0,-70 -70,0" stroke-width="4" stroke="black" fill="black" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "281100": {
    code: "281100",
    name: "Abrigo subterrâneo",
    category: "Proteção - Fortificação",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="m 135,65 15,0 m -100,0 15,0 m 0,70 0,-70 70,0 0,70 -70,0" stroke-width="4" stroke="black" fill="black" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "281200": {
    code: "281200",
    name: "Local fortificado",
    category: "Proteção - Fortificação",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="m 135,65 15,-15 m -15,85 15,15 M 65,135 50,150 m 15,-85 0,70 70,0 0,-70 -70,0 -15,-15" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  // ===== PROTEÇÃO - MINAS (símbolos autoexplicativos - sem texto) =====
  "280600": {
    code: "280600",
    name: "Mina de qualquer tipo",
    category: "Proteção - Minas",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="m 129,100 c 0,16.016 -12.984,29 -29,29 -16.0163,0 -29,-12.984 -29,-29 0,-16.0163 12.9837,-29 29,-29 16.016,0 29,12.9837 29,29 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "280200": {
    code: "280200",
    name: "Mina antipessoal",
    category: "Proteção - Minas",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="m 129,100 c 0,16.016 -12.984,29 -29,29 -16.0163,0 -29,-12.984 -29,-29 0,-16.0163 12.9837,-29 29,-29 16.016,0 29,12.9837 29,29 z" stroke-width="4" stroke="black" fill="black" ></path><path d="m 50,50 29.5,29.5 m 41,0 L 150,50" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "280300": {
    code: "280300",
    name: "Mina anticarro",
    category: "Proteção - Minas",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="m 129,100 c 0,16.016 -12.984,29 -29,29 -16.0163,0 -29,-12.984 -29,-29 0,-16.0163 12.9837,-29 29,-29 16.016,0 29,12.9837 29,29 z" stroke-width="4" stroke="black" fill="black" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "280700": {
    code: "280700",
    name: "Armadilha",
    category: "Proteção - Minas",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="M 77.2413,87.9311 100,50 122.781,87.9687 M 130,100 c 0,10.24 -13.431,18.541 -30,18.541 -16.5685,0 -30,-8.301 -30,-18.541 0,-10.2399 13.4315,-18.541 30,-18.541 16.569,0 30,8.3011 30,18.541 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path></svg>`,
    anchor: "bottom",
    textFields: {}
  },

  "270701": {
    code: "270701",
    name: "Indicação pontual de campo minado",
    category: "Proteção - Minas",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="158" height="88" viewBox="21 61 158 88"><path d="m 25,65 0,70 150,0 0,-70 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "270800": {
    code: "270800",
    name: "Área minada",
    category: "Proteção - Minas",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="M 50,50 150,50 150,150 50,150 Z" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path><circle cx="80" cy="80" r="10" stroke-width="3" stroke="black" fill="rgb(255,255,255)" ></circle><circle cx="120" cy="80" r="10" stroke-width="3" stroke="black" fill="black" ></circle><circle cx="100" cy="120" r="10" stroke-width="3" stroke="black" fill="black" ></circle><text x="100" y="55" text-anchor="middle" font-size="18" font-family="Arial" font-weight="bold" fill="black">M</text></svg>`,
    anchor: "center",
    textFields: {}
  },

  // ===== PROTEÇÃO - QBRN (símbolos autoexplicativos - sem texto) =====
  "281301": {
    code: "281301",
    name: "Evento químico",
    category: "Proteção - QBRN",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="158" height="118" viewBox="21 -14 158 118"><path d="M 110,60 C 110,40 115,25 80,20 M 90,60 C 90,40 85,25 120,20 m -20,80 -60,-110 120,0 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path><path d="m 120,20 c 10,0 10,15 0,15 -10,0 -10,-15 0,-15 z M 80,35 c 10,0 10,-15 0,-15 -10,0 -10,15 0,15 z" stroke-width="4" stroke="black" fill="black" ></path><text x="100" y="20" text-anchor="middle" font-size="30" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >C</text><text x="100" y="85" text-anchor="middle" font-size="30" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >T</text></svg>`,
    anchor: "center",
    textFields: {}
  },

  "281400": {
    code: "281400",
    name: "Evento biológico",
    category: "Proteção - QBRN",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="158" height="118" viewBox="21 -14 158 118"><path d="M 110,60 C 110,40 115,25 80,20 M 90,60 C 90,40 85,25 120,20 m -20,80 -60,-110 120,0 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path><path d="m 120,20 c 10,0 10,15 0,15 -10,0 -10,-15 0,-15 z M 80,35 c 10,0 10,-15 0,-15 -10,0 -10,15 0,15 z" stroke-width="4" stroke="black" fill="black" ></path><text x="100" y="20" text-anchor="middle" font-size="30" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >B</text></svg>`,
    anchor: "center",
    textFields: {}
  },

  "281700": {
    code: "281700",
    name: "Evento radiológico",
    category: "Proteção - QBRN",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="158" height="118" viewBox="21 -14 158 118"><path d="M 110,60 C 110,40 115,25 80,20 M 90,60 C 90,40 85,25 120,20 m -20,80 -60,-110 120,0 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path><path d="m 120,20 c 10,0 10,15 0,15 -10,0 -10,-15 0,-15 z M 80,35 c 10,0 10,-15 0,-15 -10,0 -10,15 0,15 z" stroke-width="4" stroke="black" fill="black" ></path><text x="100" y="20" text-anchor="middle" font-size="30" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >R</text></svg>`,
    anchor: "center",
    textFields: {}
  },

  "281500": {
    code: "281500",
    name: "Evento nuclear",
    category: "Proteção - QBRN",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="158" height="118" viewBox="21 -14 158 118"><path d="M 110,60 C 110,40 115,25 80,20 M 90,60 C 90,40 85,25 120,20 m -20,80 -60,-110 120,0 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path><path d="m 120,20 c 10,0 10,15 0,15 -10,0 -10,-15 0,-15 z M 80,35 c 10,0 10,-15 0,-15 -10,0 -10,15 0,15 z" stroke-width="4" stroke="black" fill="black" ></path><text x="100" y="20" text-anchor="middle" font-size="30" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >N</text></svg>`,
    anchor: "center",
    textFields: {}
  },

  // ===== CONTROLE AÉREO =====
  "180000": {
    code: "180000",
    name: "Ponto de Controle Aéreo",
    category: "Controle Aéreo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><circle cx="100" cy="100" r="50" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></circle></svg>`,
    anchor: "center",
    textFields: {
      numero: {
        position: { x: 100, y: 115 },
        anchor: 'middle',
        fontSize: 40,
        fontWeight: 'bold'
      }
    }
  },

  // ===== CONTROLE MARÍTIMO (símbolos autoexplicativos - sem texto) =====
  "210200": {
    code: "210200",
    name: "Ponto de visada",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><circle cx="100" cy="100" r="15" stroke-width="4" stroke="black" fill="black" ></circle><circle cx="100" cy="100" r="35" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></circle><circle cx="100" cy="100" r="45" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></circle></svg>`,
    anchor: "center",
    textFields: {}
  },

  "210300": {
    code: "210300",
    name: "Meio defendido",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="m 90,135 0,-30 20,0 0,30 m -50,0 0,-50 -10,0 0,-20 20,0 0,10 20,0 0,-10 20,0 0,10 20,0 0,-10 20,0 0,20 -10,0 0,50 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "210500": {
    code: "210500",
    name: "Local de desembarque",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="58" viewBox="46 46 108 58"><path d="m 100,100 0,-50 m -35,15 35,35 35,-35 m -85,35 100,0" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "210600": {
    code: "210600",
    name: "Detonação aérea",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="m 55,150 90,0 m -35,-95 5,20 15,-10 0,15 15,5 -15,10 15,10 -15,5 5,15 -20,-5 -5,20 -10,-15 -10,20 -5,-25 -20,10 5,-15 L 55,105 70,95 60,85 70,80 70,65 85,75 90,55 100,70 Z" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "210700": {
    code: "210700",
    name: "Ponto zero",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="78" viewBox="46 26 108 78"><path d="M 100 28 C 100 28 65.4398 29.8261 61.6543 55 C 60.2826 64.1213 75.0115 70.4884 82.2363 71.6543 C 89.4611 72.8201 91.7277 55.3462 98.5098 56.0371 L 93 90 C 93 90 70 90 67 97 C 65.0304 101.596 100 100 100 100 C 100 100 134.97 101.596 133 97 C 130 90 107 90 107 90 L 101.49 56.0371 C 108.272 55.3462 110.539 72.8201 117.764 71.6543 C 124.988 70.4884 139.718 64.1213 138.346 55 C 134.56 29.8261 100 28 100 28 z" stroke-width="4" stroke="none" fill="black" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "210800": {
    code: "210800",
    name: "Ponto de impacto",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="m 50,100 40,-10 10,-40 10,40 40,10 -40,10 -10,40 -10,-40 -40,-10" stroke-width="4" stroke="black" fill="black" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "210900": {
    code: "210900",
    name: "Ponto de impacto previsto",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="m 50,100 40,-10 10,-40 10,40 40,10 -40,10 -10,40 -10,-40 -40,-10" stroke-width="4" stroke-dasharray="12,5" stroke="black" fill="rgb(255,255,255)" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "211100": {
    code: "211100",
    name: "Ponto de detecção do míssil",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="78" viewBox="46 26 108 78"><path d="m 95,100 0,-55 -10,0 15,-15 15,15 -10,0 0,55 m -55,0 100,0" stroke-width="4" stroke="black" fill="black" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "211200": {
    code: "211200",
    name: "Despistador - Contramedida acústica",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="78" viewBox="46 26 108 78"><path d="M 107.5,55 92.5518,70 107.5,85 Z M 50,30 150,30 m -90,70 0,-5 80,0 0,5 z m 70,-45 -15,15 15,15 z M 85,55 70,70 85,85 Z m 15,-25 0,33" stroke-width="4" stroke="black" fill="black" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "211300": {
    code: "211300",
    name: "Despistador - Contramedida eletrônica",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="m 80,120 -20,10 20,10 z m 30,0 -20,10 20,10 0,-20 z m 30,0 -20,10 20,10 z m -25,-20 c 0,10 -10,18 -19.4,14 -9.4,-2 -13.8,-14.7 -8,-22.5 5.2,-8.2 18.4,-8.7 24.4,-0.8 2,2.6 3,5.9 3,9.3 z" stroke-width="4" stroke="black" fill="black" ></path><path d="m 50,50 0,100 100,0 0,-100 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path><text x="100" y="80" text-anchor="middle" font-size="30" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >ECM</text></svg>`,
    anchor: "center",
    textFields: {}
  },

  "211500": {
    code: "211500",
    name: "Datum",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="m 100,50 0,50 50,0 C 150,72.3858 127.614,50 100,50 Z m 0,50 -50,0 c 0,27.614 22.3858,50 50,50 z" stroke-width="4" stroke="none" fill="black" ></path><circle cx="100" cy="100" r="50" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></circle></svg>`,
    anchor: "center",
    textFields: {}
  },

  "211700": {
    code: "211700",
    name: "Submarino submerso reportado",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="M 129,122.4 70.9,78.8 m 0,43.6 58.1,-43.6 m -80,-14.5 0,43.6 29,0 0,29 43.6,0 0,-29 29,0 0,-43.6" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "211800": {
    code: "211800",
    name: "Santuário",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="128" height="108" viewBox="36 46 128 108"><path d="M 108.142,100 A 8.14167,8.14167 0 0 1 100,108.142 8.14167,8.14167 0 0 1 91.8583,100 8.14167,8.14167 0 0 1 100,91.8583 8.14167,8.14167 0 0 1 108.142,100 Z M 45,55 l 0,90 m 110,-90 0,90 m -110,-45 110,0" stroke-width="4" stroke="black" fill="black" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "211900": {
    code: "211900",
    name: "Centro da Cobertura",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="m 100,55 0,90 m 8.142,-45 A 8.14167,8.14167 0 0 1 100,108.142 8.14167,8.14167 0 0 1 91.8583,100 8.14167,8.14167 0 0 1 100,91.8583 8.14167,8.14167 0 0 1 108.142,100 Z" stroke-width="4" stroke="black" fill="black" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "212000": {
    code: "212000",
    name: "Contato perdido",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 -4 108 108"><path d="m 65,0 70,0 m -35,80 0,-80 m 0,100 -45,-20 90,0 z" stroke-width="4" stroke="black" fill="black" ></path><text x="75" y="55" text-anchor="middle" font-size="45" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >L</text><text x="125" y="55" text-anchor="middle" font-size="45" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >C</text></svg>`,
    anchor: "center",
    textFields: {}
  },

  "212100": {
    code: "212100",
    name: "Poita",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 -4 108 108"><path d="m 100,15 0,65 M 60,15 80,0 100,15 120,0 140,15" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path><path d="M 100,100 55,80 145,80 Z" stroke-width="4" stroke="black" fill="black" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "212300": {
    code: "212300",
    name: "Fixo acústico",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="M 50,150 150,50 M 50,50 150,150 m -50,-100 0,100" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "212400": {
    code: "212400",
    name: "Fixo eletromagnético",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="m 50,90 15,20 5,-20 15,20 5,-20 20,20 5,-20 15,20 5,-20 15,20 M 50,150 150,50 M 50,50 150,150 m -50,-100 0,100" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "212500": {
    code: "212500",
    name: "Detecção de anomalia magnética (MAD)",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="138" viewBox="46 46 108 138"><path d="m 50,90 15,20 5,-20 15,20 5,-20 20,20 5,-20 15,20 5,-20 15,20 M 50,150 150,50 M 50,50 150,150 m -50,-100 0,100" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path><text x="100" y="180" text-anchor="middle" font-size="35" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >MAD</text></svg>`,
    anchor: "center",
    textFields: {}
  },

  "212600": {
    code: "212600",
    name: "Fixo visual",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="m 150,100 c 0,6.904 -22.386,12.5 -50,12.5 -27.6142,0 -50,-5.596 -50,-12.5 0,-6.9036 22.3858,-12.5 50,-12.5 27.614,0 50,5.5964 50,12.5 z M 50,150 150,50 M 50,50 150,150 m -50,-100 0,100" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "212700": {
    code: "212700",
    name: "Formação",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="m 50,100 100,0 m -50,-50 0,100" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "212800": {
    code: "212800",
    name: "Ancoradouro",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="M 80,140 50,60 150,60 120,140" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "212900": {
    code: "212900",
    name: "Ponto de entrada no porto",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="M 80,140 50,60 150,60 120,140" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "213000": {
    code: "213000",
    name: "Posição do DIP",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="m 80,80 20,20 -20,20 40,0 -20,-20 20,-20 z M 50,150 150,50 M 50,50 150,150" stroke-width="4" stroke="black" fill="black" ></path><text x="60" y="115" text-anchor="middle" font-size="45" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >D</text><text x="140" y="115" text-anchor="middle" font-size="45" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >P</text></svg>`,
    anchor: "center",
    textFields: {}
  },

  "213100": {
    code: "213100",
    name: "Busca",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="m 80,80 20,20 -20,20 40,0 -20,-20 20,-20 z M 50,150 150,50 M 50,50 150,150" stroke-width="4" stroke="black" fill="black" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "213200": {
    code: "213200",
    name: "Área de busca",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="m 80,80 20,20 -20,20 40,0 -20,-20 20,-20 z M 50,150 150,50 M 50,50 150,150" stroke-width="4" stroke="black" fill="black" ></path><text x="60" y="115" text-anchor="middle" font-size="45" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >S</text><text x="140" y="115" text-anchor="middle" font-size="45" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >A</text></svg>`,
    anchor: "center",
    textFields: {}
  },

  "213300": {
    code: "213300",
    name: "Centro da busca",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="m 100,100 -50,10 0,-20 z m 0,0 10,50 -20,0 z m 0,0 50,-10 0,20 z m 0,0 -10,-50 20,0 z" stroke-width="4" stroke="none" fill="black" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "213400": {
    code: "213400",
    name: "Ponto de referência à navegação",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="M 160,160 40,40 M 40,160 160,40" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "213500": {
    code: "213500",
    name: "Sonoboia",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="178" viewBox="56 -14 88 178"><path d="M 100,60 l 0,-35 10,10 0,-45" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path><circle cx="100" cy="100" r="40" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></circle></svg>`,
    anchor: "center",
    textFields: {}
  },

  "214100": {
    code: "214100",
    name: "Centro da área vital",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="128" height="88" viewBox="36 56 128 88"><path d="m 45,100 110,0 m 0,-40 0,85 M 45,60 l 0,80 m 55,-80 0,80" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "214700": {
    code: "214700",
    name: "Posição estimada",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="128" height="128" viewBox="36 36 128 128"><path d="M 160,160 40,160 40,40 160,40 Z" stroke-width="4" stroke-dasharray="12,5" stroke="black" fill="rgb(255,255,255)" ></path><path d="m 140,100 c 1,26 -27,47 -51.8,38 C 63.1,131 51.5,98.3 67,77.4 c 13.8,-21.9 49,-23.2 64,-2.3 6,7 9,15.9 9,24.9 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path><text x="100" y="115" text-anchor="middle" font-size="35" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >EP</text></svg>`,
    anchor: "center",
    textFields: {}
  }
};

// ============================================================================
// ECHELON POINT GENERATION
// ============================================================================

/**
 * Generate all echelon point definitions
 * @returns {Object} Map of echelon point codes to point definitions
 */
function generateEchelonPoints() {
  const echelonPoints = {};

  Object.entries(ECHELON_CODES).forEach(([code, label]) => {
    const pointCode = `ECHELON_${code}`;
    echelonPoints[pointCode] = {
      code: pointCode,
      name: `Escalão - ${label}`,
      category: "Escalão",
      svg: `${ECHELON_SYMBOLS[code]}`,
      anchor: "center",
      isEchelon: true,
      echelonCode: code,
      textFields: {}
    };
  });

  Object.entries(ECHELON_CODES).forEach(([code, label]) => {
    const pointCode = `ECHELON_FT_${code}`;
    echelonPoints[pointCode] = {
      code: pointCode,
      name: `Escalão FT - ${label}`,
      category: "Escalão Força-Tarefa",
      svg: `${ECHELON_SYMBOLS_FT[code]}`,
      anchor: "center",
      isEchelon: true,
      isForcaTarefa: true,
      echelonCode: code,
      textFields: {}
    };
  });

  return echelonPoints;
}

// ============================================================================
// SUPPLY POINT GENERATION
// ============================================================================

/**
 * Generate all supply point definitions
 * @returns {Object} Map of supply point codes to point definitions
 */
function generateSupplyPoints() {
  const supplyPoints = {};

  Object.entries(SUPPLY_CLASSES).forEach(([classCode, className]) => {
    const pointCode = `SUPPLY_${classCode}`;
    supplyPoints[pointCode] = {
      code: pointCode,
      name: `Ponto de Suprimento - ${className}`,
      category: "Logística",
      svg: `${SUPPLY_CLASS_ICONS[classCode]}`,
      anchor: "bottom",
      hasSupplyIcon: true,
      supplyClass: classCode,
      textFields: {
        identificacao: {
          position: { x: 150, y: -40 },
          anchor: 'start',
          fontSize: 20
        },
        gdhIni: {
          position: { x: 50, y: -40 },
          anchor: 'end',
          fontSize: 20
        },
        gdhFim: {
          position: { x: 50, y: -10 },
          anchor: 'end',
          fontSize: 20
        }
      }
    };
  });

  return supplyPoints;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get text fields configuration for a point
 * @param {string} pointCode - Point code
 * @returns {Object} Text fields configuration
 */
export function getTextFieldsConfig(pointCode) {
  const point = COORDINATION_POINTS_CATALOG[pointCode];
  return point?.textFields || {};
}

/**
 * Get available text field names for a point
 * @param {string} pointCode - Point code
 * @returns {Array<string>} Array of text field names
 */
export function getAvailableTextFields(pointCode) {
  const textFields = getTextFieldsConfig(pointCode);
  return Object.keys(textFields);
}

// ============================================================================
// COMPLETE CATALOG EXPORT
// ============================================================================

export const COORDINATION_POINTS_CATALOG = {
  ...BASE_POINTS,
  ...generateEchelonPoints(),
  ...generateSupplyPoints()
};

export default COORDINATION_POINTS_CATALOG;