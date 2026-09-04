// Path: js/military_tools/coordination_measure_tool/coordination_points_catalog.js

import { ECHELON_CODES, SUPPLY_CLASSES } from './coordination_measure_constants.js';

// ============================================================================
// ECHELON SYMBOLS
// ============================================================================
//
// A ARTE DE PLACEHOLDER ACABOU EM 2026-09-03, E ESTA NOTA CONTA O QUE ELA ERA.
//
// Durante muito tempo tres tabelas (ECHELON_SYMBOLS, uma segunda de Forca-Tarefa e
// SUPPLY_CLASS_ICONS) repetiam o mesmo desenho em 40 entradas, e a nota que ficava aqui
// dizia que isso era deliberado, a espera de autoria. Ela contava 41 e descrevia um
// retangulo branco: eram 40, e o desenho era o pino do 130100 Ponto generico, que
// conferido contra a p. 181 do MD33-C-01 esta CERTO e nunca foi placeholder.
//
// As 39 restantes foram GERADAS transportando arte que ja estava na casa, nao desenhadas
// do zero: o amplificador de escalao sai da milsymbol vendorizada pelos digitos 9-10 do
// SIDC, a forca-tarefa pelo digito 8, e os doze icones de classe de suprimento dos codigos
// 163700/163800/163900/164100/164400/164500/164700 mais as cinco extensoes 163499 do
// brazilian_extension_catalog. A 40a nao existe: a Tabela 14 do MD33-M-02 nao atribui
// amplificador ao escalao "Nao Especificado", e por isso ele foi REMOVIDO do vocabulario
// em vez de ganhar desenho.
//
// A TABELA DE FORCA-TAREFA SAIU depois disso, e nao por poda: o Nucleo DESENHA o colchete
// (`montarNucleo`, adiante) em vez de guardar uma segunda copia de cada escalao dentro
// dele. As catorze entradas que existiam tinham o colchete de largura FIXA, o que apertava
// os escaloes largos e encostava a barra de cima nas marcas; o colchete desenhado sai da
// largura da marca, com respiro. Sobra UMA tabela de escalao, e as duas familias partem
// dela.
//
// O pino do 130100 continua aparecendo em catorze entradas, e isso e correto: ele e a
// moldura do proprio 130100, do 321700 e das doze classes de suprimento. Nao e repeticao.

const ECHELON_SYMBOLS = {
  "00": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path></svg>`,
  "11": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="104" height="80" viewBox="0 0 104 80"><g transform="translate(-188,-32) scale(2.4)" stroke-width="1.67" stroke="black" fill="none"><circle cx="100" cy="30" r="15" ></circle><path d="M80,40L120,20" ></path></g></svg>`,
  "12": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="44" height="44" viewBox="0 0 44 44"><g transform="translate(-218,-50) scale(2.4)" stroke-width="1.67" stroke="black" fill="none"><circle cx="100" cy="30" r="7.5" fill="black" ></circle></g></svg>`,
  "13": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="116" height="44" viewBox="0 0 116 44"><g transform="translate(-182,-50) scale(2.4)" stroke-width="1.67" stroke="black" fill="none"><circle cx="115" cy="30" r="7.5" fill="black" ></circle><circle cx="85" cy="30" r="7.5" fill="black" ></circle></g></svg>`,
  "14": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="188" height="44" viewBox="0 0 188 44"><g transform="translate(-146,-50) scale(2.4)" stroke-width="1.67" stroke="black" fill="none"><circle cx="100" cy="30" r="7.5" fill="black" ></circle><circle cx="70" cy="30" r="7.5" fill="black" ></circle><circle cx="130" cy="30" r="7.5" fill="black" ></circle></g></svg>`,
  "15": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="8" height="68" viewBox="0 0 8 68"><g transform="translate(-236,-32) scale(2.4)" stroke-width="1.67" stroke="black" fill="none"><path d="M100,40L100,15" ></path></g></svg>`,
  "16": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="56" height="68" viewBox="0 0 56 68"><g transform="translate(-212,-32) scale(2.4)" stroke-width="1.67" stroke="black" fill="none"><path d="M90,40L90,15" ></path><path d="M110,40L110,15" ></path></g></svg>`,
  "17": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="104" height="68" viewBox="0 0 104 68"><g transform="translate(-188,-32) scale(2.4)" stroke-width="1.67" stroke="black" fill="none"><path d="M100,40L100,15" ></path><path d="M120,40L120,15" ></path><path d="M80,40L80,15" ></path></g></svg>`,
  "18": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="68" height="68" viewBox="0 0 68 68"><g transform="translate(-206,-32) scale(2.4)" stroke-width="1.67" stroke="black" fill="none"><path d="M87.5,40 l25,-25 m0,25 l-25,-25" ></path></g></svg>`,
  "21": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="152" height="68" viewBox="0 0 152 68"><g transform="translate(-164,-32) scale(2.4)" stroke-width="1.67" stroke="black" fill="none"><path d="M70,40 l25,-25 m0,25 l-25,-25   M105,40 l25,-25 m0,25 l-25,-25" ></path></g></svg>`,
  "22": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="236" height="68" viewBox="0 0 236 68"><g transform="translate(-122,-32) scale(2.4)" stroke-width="1.67" stroke="black" fill="none"><path d="M52.5,40 l25,-25 m0,25 l-25,-25    M87.5,40 l25,-25 m0,25 l-25,-25    M122.5,40 l25,-25 m0,25 l-25,-25" ></path></g></svg>`,
  "23": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="320" height="68" viewBox="0 0 320 68"><g transform="translate(-80,-32) scale(2.4)" stroke-width="1.67" stroke="black" fill="none"><path d="M35,40 l25,-25 m0,25 l-25,-25   M70,40 l25,-25 m0,25 l-25,-25   M105,40 l25,-25 m0,25 l-25,-25    M140,40 l25,-25 m0,25 l-25,-25" ></path></g></svg>`,
  "25": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="488" height="68" viewBox="0 0 488 68"><g transform="translate(4,-32) scale(2.4)" stroke-width="1.67" stroke="black" fill="none"><path d="M0,40 l25,-25 m0,25 l-25,-25   M35,40 l25,-25 m0,25 l-25,-25   M70,40 l25,-25 m0,25 l-25,-25   M105,40 l25,-25 m0,25 l-25,-25    M140,40 l25,-25 m0,25 l-25,-25     M175,40 l25,-25 m0,25 l-25,-25" ></path></g></svg>`,
  "26": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="152" height="68" viewBox="0 0 152 68"><g transform="translate(-164,-32) scale(2.4)" stroke-width="1.67" stroke="black" fill="none"><path d="M70,27.5 l25,0 m-12.5,12.5 l0,-25   M105,27.5 l25,0 m-12.5,12.5 l0,-25" ></path></g></svg>`
};

// ============================================================================
// SUPPLY CLASS ICONS
// ============================================================================

const SUPPLY_CLASS_ICONS = {
  "I": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path><path d="m 60,30 80,0" stroke-width="4" stroke="black" fill="none"></path><g transform="translate(-69.2,-187.88) scale(1.7)" stroke-width="2.35" stroke="black" fill="none"><path d="M 111,115 C 96.3,110 96.3,89.5 111,84 100,79.7 87.5,86.3 87.5,99.5 87.5,113 100,119 111,115 Z" stroke-width="2.35" stroke="black" fill="none" ></path></g></svg>`,
  "II": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path><path d="m 60,30 80,0" stroke-width="4" stroke="black" fill="none"></path><g transform="translate(0,-113.5) scale(1)" stroke-width="4" stroke="black" fill="none"><path d="m 115,95 c 0,15 15,15 15,0 0,-15 -15,-15 -15,0 z m 0,0 -45,0 0,10 10,0 0,-10" stroke-width="4" stroke="black" fill="none" ></path></g></svg>`,
  "III": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path><path d="m 60,30 80,0" stroke-width="4" stroke="black" fill="none"></path><g transform="translate(-67.5,-186) scale(1.68)" stroke-width="2.39" stroke="black" fill="none"><path d="m 100,120 0,-20 -15,-20 30,0 -15,20 " stroke-width="2.39" stroke="black" fill="none" ></path></g></svg>`,
  "IV": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path><path d="m 60,30 80,0" stroke-width="4" stroke="black" fill="none"></path><g transform="translate(60,-52.5) scale(0.4)" stroke-width="10" stroke="black" fill="none"><path d="M25,120 L100,52 175,120" stroke-width="10" stroke="black" fill="none" ></path><path d="M100,50L100,120" stroke-width="10" stroke="black" fill="none" ></path><path d="M60,90 L100,120" stroke-width="10" stroke="black" fill="none" ></path><path d="M100,120L140,90" stroke-width="10" stroke="black" fill="none" ></path></g></svg>`,
  "V": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path><path d="m 60,30 80,0" stroke-width="4" stroke="black" fill="none"></path><g transform="translate(-91.43,-205.14) scale(1.91)" stroke-width="2.09" stroke="black" fill="none"><path d="m 90,115 0,-25 c 0,-10 20,-10 20,0 l 0,25 m -25,0 30,0" stroke-width="2.09" stroke="black" fill="none" ></path></g></svg>`,
  "VI": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path><path d="m 60,30 80,0" stroke-width="4" stroke="black" fill="none"></path><g transform="translate(25,-93.5) scale(0.75)" stroke-width="5.33" stroke="black" fill="none"><path d="M60,120 L60,80 140,80 140,120 M100,80 L100,110" stroke-width="5.33" stroke="black" fill="none" ></path></g></svg>`,
  "VII": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path><path d="m 60,30 80,0" stroke-width="4" stroke="black" fill="none"></path><g transform="translate(60,-52.5) scale(0.4)" stroke-width="10" stroke="black" fill="none"><path d="M25,50 100,93 100,77 175,120" stroke-width="10" stroke="black" fill="none" ></path></g></svg>`,
  "VIII": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path><path d="m 60,30 80,0" stroke-width="4" stroke="black" fill="none"></path><g transform="translate(60,-52.5) scale(0.4)" stroke-width="10" stroke="black" fill="none"><path d="M100,120 l0,-70 M175,80 l-150,0" stroke-width="10" stroke="black" fill="none" ></path></g></svg>`,
  "IX": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path><path d="m 60,30 80,0" stroke-width="4" stroke="black" fill="none"></path><g transform="translate(-67.67,-186) scale(1.68)" stroke-width="2.39" stroke="black" fill="none"><circle cx="100" cy="100" r="10" stroke-width="2.39" stroke="black" fill="none" ></circle><path d="m 100,110 0,10 m 0,-30 0,-10 m 8.7,14.2 8.4,-4.8 m -8.4,15.9 8,5.4 m -25.4,-5.4 -8.2,5.4 m 8.2,-16.3 -8,-5.4" stroke-width="2.39" stroke="black" fill="none" ></path></g></svg>`,
  "X": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path><path d="m 60,30 80,0" stroke-width="4" stroke="black" fill="none"></path><g transform="translate(-106.79,-222.81) scale(2.07)" stroke-width="1.93" stroke="black" fill="none"><text x="100" y="115" text-anchor="middle" font-size="45" font-family="Arial" font-weight="bold" stroke-width="1.93" stroke="none" fill="black" >X</text></g></svg>`,
  "Agua": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path><path d="m 60,30 80,0" stroke-width="4" stroke="black" fill="none"></path><g transform="translate(14.29,-99.93) scale(0.86)" stroke-width="4.67" stroke="black" fill="none"><path d="m 65,90 50,0 c 10,0 20,10 20,20 m -40,-30 20,0 m -10,0 0,10" stroke-width="4.67" stroke="black" fill="none" ></path></g></svg>`,
  "Outras": `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path><path d="m 60,30 80,0" stroke-width="4" stroke="black" fill="none"></path><g transform="translate(-100,-217.5) scale(2)" stroke-width="2" stroke="black" fill="none"><path d="m 100,112 -15,-25 30,0 -15,25 -15,-25" stroke-width="2" stroke="black" fill="none" ></path></g></svg>`
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
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="76" height="128" viewBox="62 36 76 128"><path d="M 68,50 L 82,50 L 132,100 L 82,150 L 68,150 M 82,50 L 82,42 M 82,150 L 82,158" stroke-width="4" stroke="black" fill="none" ></path></svg>`,
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
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="68" height="118" viewBox="66 41 68 118"><path d="M 72,47 L 128,153" stroke-width="4" stroke="black" fill="none" ></path><path d="M 117.2,110.2 L 101.2,80.0 A 10.4,10.4 0 0 0 82.8,89.8 L 98.8,120.0 A 10.4,10.4 0 0 0 117.2,110.2 Z" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path><path d="M 93.0,86.8 L 107.0,113.2" stroke-width="4" stroke="black" fill="none" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "290899_EXT1": {
    code: "290899_EXT1",
    name: "Local de portada leve",
    category: "Passagens",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="68" height="118" viewBox="66 41 68 118"><path d="M 72,47 L 128,153" stroke-width="4" stroke="black" fill="none" ></path><circle cx="100" cy="100" r="10" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></circle></svg>`,
    anchor: "center",
    textFields: {}
  },

  "290899_EXT2": {
    code: "290899_EXT2",
    name: "Local de portada pesada",
    category: "Passagens",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="68" height="118" viewBox="66 41 68 118"><path d="M 72,47 L 128,153" stroke-width="4" stroke="black" fill="none" ></path><circle cx="100" cy="100" r="10" stroke-width="4" stroke="black" fill="black" ></circle></svg>`,
    anchor: "center",
    textFields: {}
  },

  "290700": {
    code: "290700",
    name: "Local de passadeira",
    category: "Passagens",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="84" height="110" viewBox="58 45 84 110"><path d="M 77.5,69.3 L 122.5,130.7" stroke-width="4" stroke="black" fill="none" ></path><path d="M 64.5,51.6 L 89.4,66.9 L 77.5,69.3 L 71.6,79.9 Z" stroke-width="4" stroke="none" fill="black" ></path><path d="M 135.5,148.4 L 128.4,120.1 L 122.5,130.7 L 110.6,133.1 Z" stroke-width="4" stroke="none" fill="black" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "271400": {
    code: "271400",
    name: "Ponte ou passagem tática",
    category: "Passagens",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="56" height="136" viewBox="72 32 56 136"><path d="M 78,38 L 90,55 L 90,145 L 78,162 M 122,38 L 110,55 L 110,145 L 122,162" stroke-width="4" stroke="black" fill="none" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "271300": {
    code: "271300",
    name: "Local de travessia de assalto",
    category: "Passagens",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="132" height="104" viewBox="34 48 132 104"><path d="M 40,54 L 54,68 L 146,68 L 160,54 M 40,146 L 54,132 L 146,132 L 160,146" stroke-width="4" stroke="black" fill="none" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  // ===== FOGOS =====
  "240601": {
    code: "240601",
    name: "Concentração de fogos",
    category: "Fogos",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="M100 50v38m0 24v38m-50-50h38m24 0h38" stroke-width="2" stroke="black" fill="none"></path><circle cx="100" cy="100" r="5" stroke="none" fill="black"></circle></svg>`,
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
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="122" height="132" viewBox="39 34 122 132"><path d="M 45,160 L 127,40 M 73,160 L 155,40" stroke-width="4" stroke="black" stroke-dasharray="12,5" fill="none" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "271203": {
    code: "271203",
    name: "Destruição preparada",
    category: "Proteção - Obstáculos",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="122" height="132" viewBox="39 34 122 132"><path d="M 45,160 L 127,40 M 73,160 L 155,40" stroke-width="4" stroke="black" fill="none" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "271204": {
    code: "271204",
    name: "Destruição realizada",
    category: "Proteção - Obstáculos",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="122" height="132" viewBox="39 34 122 132"><path d="M 45,160 L 127,40 M 73,160 L 155,40 M 155,160 L 73,40 M 127,160 L 45,40" stroke-width="4" stroke="black" fill="none" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  // ===== PROTEÇÃO - FORTIFICAÇÃO (símbolos autoexplicativos - sem texto) =====
  "280900": {
    code: "280900",
    name: "Abrigo individual",
    category: "Proteção - Fortificação",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="93" viewBox="56 56 88 93"><path d="M 60,145 L 60,60 L 140,60 L 140,145" stroke-width="4" stroke="black" fill="none" ></path></svg>`,
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
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="158" height="158" viewBox="21 21 158 158"><path d="M 100,60 140,100 100,140 60,100 Z" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path><path d="M 100,60 100,28 M 140,100 172,100 M 100,140 100,172 M 60,100 28,100" stroke-width="4" stroke="black" fill="none" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  // ===== PROTEÇÃO - MINAS (símbolos autoexplicativos - sem texto) =====
  "280600": {
    code: "280600",
    name: "Mina de qualquer tipo",
    category: "Proteção - Minas",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="112" height="98" viewBox="44 51 112 98"><ellipse cx="100" cy="100" rx="50" ry="43" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></ellipse></svg>`,
    anchor: "center",
    textFields: {}
  },

  "280200": {
    code: "280200",
    name: "Mina antipessoal",
    category: "Proteção - Minas",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="130" height="118" viewBox="35 31 130 118"><ellipse cx="100" cy="100" rx="50" ry="43" stroke-width="4" stroke="black" fill="black" ></ellipse><path d="M 70,66 L 41,37 M 130,66 L 159,37" stroke-width="4" stroke="black" fill="none" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "280300": {
    code: "280300",
    name: "Mina anticarro",
    category: "Proteção - Minas",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="112" height="98" viewBox="44 51 112 98"><ellipse cx="100" cy="100" rx="50" ry="43" stroke-width="4" stroke="black" fill="black" ></ellipse></svg>`,
    anchor: "center",
    textFields: {}
  },

  "280700": {
    code: "280700",
    name: "Armadilha",
    category: "Proteção - Minas",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="126" height="132" viewBox="37 34 126 132"><ellipse cx="100" cy="132" rx="57" ry="28" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></ellipse><path d="M 52,117 L 100,40 L 148,117" stroke-width="4" stroke="black" fill="none" ></path></svg>`,
    anchor: "bottom",
    textFields: {}
  },

  "270701": {
    code: "270701",
    name: "Indicação pontual de campo minado",
    category: "Proteção - Minas",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="164" height="88" viewBox="18 56 164 88"><rect x="24" y="62" width="152" height="76" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></rect><ellipse cx="52" cy="106" rx="16" ry="14" stroke-width="4" stroke="black" fill="black" ></ellipse><ellipse cx="100" cy="106" rx="16" ry="14" stroke-width="4" stroke="black" fill="black" ></ellipse><ellipse cx="148" cy="106" rx="16" ry="14" stroke-width="4" stroke="black" fill="black" ></ellipse><path d="M 42,95 L 32,85 M 62,95 L 72,85" stroke-width="4" stroke="black" fill="none" ></path><path d="M 90,95 L 80,85 M 110,95 L 120,85" stroke-width="4" stroke="black" fill="none" ></path><path d="M 138,95 L 128,85 M 158,95 L 168,85" stroke-width="4" stroke="black" fill="none" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "270800": {
    code: "270800",
    name: "Área minada",
    category: "Proteção - Minas",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="172" height="59" viewBox="16 64 172 59"><ellipse cx="40" cy="100" rx="22" ry="19" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></ellipse><ellipse cx="100" cy="100" rx="22" ry="19" stroke-width="4" stroke="black" fill="black" ></ellipse><ellipse cx="160" cy="100" rx="22" ry="19" stroke-width="4" stroke="black" fill="black" ></ellipse><path d="M 147,88 136,68 M 173,88 184,68" stroke-width="4" stroke="black" fill="none" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  // ===== PROTEÇÃO - QBRN (símbolos autoexplicativos - sem texto) =====
  "281301": {
    code: "281301",
    name: "Evento químico",
    category: "Proteção - QBRN",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="158" height="118" viewBox="21 -14 158 118"><path d="M 110,60 C 110,40 115,25 80,20 M 90,60 C 90,40 85,25 120,20 m -20,80 -60,-110 120,0 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path><path d="m 120,20 c 10,0 10,15 0,15 -10,0 -10,-15 0,-15 z M 80,35 c 10,0 10,-15 0,-15 -10,0 -10,15 0,15 z" stroke-width="4" stroke="black" fill="black" ></path><text x="100" y="20" text-anchor="middle" font-size="30" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >Q</text></svg>`,
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
  "321700": {
    code: "321700",
    name: "Ponto de Suprimento genérico",
    category: "Logística",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="88" height="168" viewBox="56 -64 88 168"><path d="m 60,45 80,0 m -40,55 -40,-55 0,-105 80,0 0,105 z" stroke-width="4" stroke="black" fill="rgb(255,255,255)"></path><path d="m 60,30 80,0" stroke-width="4" stroke="black" fill="none"></path></svg>`,
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
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><circle cx="100" cy="100" r="45" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></circle><circle cx="100" cy="100" r="35" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></circle><circle cx="100" cy="100" r="17" stroke-width="4" stroke="black" fill="black" ></circle></svg>`,
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
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="m 50,100 40,-10 10,-40 10,40 40,10 -40,10 -10,40 -10,-40 -40,-10 z" stroke-width="4" stroke-dasharray="12,5" stroke="black" fill="rgb(255,255,255)" ></path></svg>`,
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
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="M 50,50 150,50 150,150 50,150 Z" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></path><text x="100" y="80" text-anchor="middle" font-size="30" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >ECM</text><circle cx="100" cy="100" r="13" stroke-width="4" stroke="black" fill="black" ></circle><path d="M 58,130 78,119 78,141 Z M 90,130 110,119 110,141 Z M 122,130 142,119 142,141 Z" stroke-width="4" stroke="black" fill="black" ></path></svg>`,
    anchor: "center",
    textFields: {}
  },

  "211500": {
    code: "211500",
    name: "Datum",
    category: "Controle Marítimo",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><circle cx="100" cy="100" r="50" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></circle><path d="M 100,100 L 100,50 A 50,50 0 0 1 150,100 Z" stroke="none" fill="black" ></path><path d="M 100,100 L 100,150 A 50,50 0 0 1 50,100 Z" stroke="none" fill="black" ></path><circle cx="100" cy="100" r="50" stroke-width="4" stroke="black" fill="none" ></circle></svg>`,
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
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 -4 108 108"><path d="m 65,0 70,0 m -35,80 0,-80 m 0,100 -45,-20 90,0 z" stroke-width="4" stroke="black" fill="black" ></path><text x="75" y="55" text-anchor="middle" font-size="45" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >C</text><text x="125" y="55" text-anchor="middle" font-size="45" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >P</text></svg>`,
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
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="m 80,80 20,20 -20,20 40,0 -20,-20 20,-20 z M 50,150 150,50 M 50,50 150,150" stroke-width="4" stroke="black" fill="black" ></path><text x="60" y="115" text-anchor="middle" font-size="45" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >P</text><text x="140" y="115" text-anchor="middle" font-size="45" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >D</text></svg>`,
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
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="108" height="108" viewBox="46 46 108 108"><path d="m 80,80 20,20 -20,20 40,0 -20,-20 20,-20 z M 50,150 150,50 M 50,50 150,150" stroke-width="4" stroke="black" fill="black" ></path><text x="60" y="115" text-anchor="middle" font-size="45" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >A</text><text x="140" y="115" text-anchor="middle" font-size="45" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >B</text></svg>`,
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
    svg: `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny" width="128" height="128" viewBox="36 36 128 128"><path d="M 160,160 40,160 40,40 160,40 Z" stroke-width="4" stroke-dasharray="12,5" stroke="black" fill="rgb(255,255,255)" ></path><circle cx="100" cy="100" r="40" stroke-width="4" stroke="black" fill="rgb(255,255,255)" ></circle><text x="100" y="114" text-anchor="middle" font-size="35" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >PE</text></svg>`,
    anchor: "center",
    textFields: {}
  }
};

// ============================================================================
// NUCLEO (MD33-M-02)
// ============================================================================

/**
 * O NUCLEO e uma area sem tracado particular, delimitada e identificada. Aqui ele nao e
 * uma area que o usuario desenha: e um SIMBOLO de elipse de tamanho FIXO, que o simbolo de
 * escalao CORTA embaixo, e abaixo do escalao vem a identificacao. O tracado conta a
 * situacao, continuo para ocupado e tracejado para preparado, e quem o aplica e o gerador,
 * porque a situacao e propriedade da feicao e nao do catalogo.
 *
 * O corte e o gesto da figura do manual: a elipse nao passa por tras do escalao, ela ABRE
 * na largura dele, e as duas pontas do arco encostam nos cantos de cima do simbolo. Por
 * isso o contorno e um arco aberto (`path`), nunca um `ellipse` fechado.
 *
 * O codigo do ponto continua sendo `ECHELON_<n>` e `ECHELON_FT_<n>`: mudou o nome na tela,
 * nao o identificador no disco. Renomear o codigo apagaria o simbolo de todo projeto ja
 * salvo, que grava `pointCode` e `echelonCode` no arquivo e no IndexedDB.
 */
// O achatamento e a folga do corte saem da figura do manual, medida pixel a pixel: a
// elipse de cima e 145 por 87 (1,67 para 1) e a de baixo 145 por 60 (2,42 para 1), e a
// abertura para as barras de batalhao tem 28 px contra 12 px de simbolo, ou seja, sobra
// mais de meia largura de simbolo de cada lado. Daqui saem 2,2 para 1 de achatamento e a
// folga lateral do corte.
const NUCLEO_RX = 220;
const NUCLEO_RY = 100;
// O traco NAO e 4 como no resto do catalogo, porque 4 nao quer dizer a mesma coisa aqui: a
// espessura na TELA e o traco vezes a escala do quadro, e o quadro do nucleo e cinco vezes
// mais largo que o do ponto generico `130100`. Com traco 4 o nucleo saia com 0,70 px contra
// 3,64 px do generico.
//
// Mas casar os 3,64 px do generico tambem estava errado, e essa foi a licao: o que limita
// aqui nao e a comparacao com o outro simbolo, e a DENSIDADE DE LINHAS do colchete de
// Forca-Tarefa. Ele tem 25 px de largura na tela com cinco linhas dentro (duas pernas mais
// as barras do escalao), ou seja um passo de 5 px. Com 3,6 px de traco sobra 1,4 px de
// respiro e o colchete vira um borrao; com 2 px sobram 3 px e as barras se separam. Daqui
// sai a espessura, olhada no tamanho real, nao deduzida.
const NUCLEO_TRACO = 11;

// O colchete de Forca-Tarefa e DESENHADO, nao copiado de um segundo jogo de simbolos. As
// catorze versoes que existiam tinham o colchete com largura fixa de 90, o que dava 35 de
// respiro no batalhao e 7,5 no pelotao, no corpo de exercito, no exercito e no teatro de
// operacoes, onde as marcas quase encostavam nas pernas. E o topo do colchete coincidia
// com o topo das marcas nos catorze, entao a barra de cima encostava no simbolo.
//
// Aqui a largura sai da MARCA, com um respiro minimo, e nunca abaixo da largura de sempre:
// os escaloes folgados ficam como estavam e so os apertados alargam.
const NUCLEO_FT_RESPIRO = 16;
const NUCLEO_FT_MEIA_MINIMA = 54;
const NUCLEO_FT_VAO_TOPO = 20;
const NUCLEO_FT_SOBRA = 12;
// Tamanho do quadro na tela, em pixels. O deslizante "Tamanho" continua por cima disto.
//
// Este numero anda JUNTO com o traco e com o corpo do texto, e e a licao que custou tres
// rodadas: a espessura e o corpo na TELA sao o valor em unidades vezes a escala do quadro,
// que e o quadro dividido pela largura do viewBox. Encolher o quadro sozinho devolve o
// simbolo fino e o texto ilegivel, que foi o defeito de origem; engrossar sozinho devolve
// o simbolo pesado. Ao mexer num, meca os tres.
const NUCLEO_TAMANHO_BASE = 106;
const NUCLEO_ESCALA_GLIFO = 0.5;
// Espessura efetiva do traco nos simbolos de escalao do catalogo: o atributo vale 1.67
// dentro de um grupo com `scale(2.4)`.
const TRACO_NATIVO_DO_GLIFO = 4;
const NUCLEO_FOLGA_CORTE = 26;
const NUCLEO_VAO_TEXTO = 12;
// Corpo do texto, medido pela mesma regua do traco. Num simbolo de 75 px de largura ele
// nao pode ser o corpo do ponto generico, que sairia mais largo que a propria elipse: o
// alvo aqui e o menor corpo que ainda se le no mapa.
const NUCLEO_FONTE = 72;
const NUCLEO_MARGEM = 8;
// Teto do corte, para o escalao mais largo do catalogo nao abrir a elipse de lado a lado.
const NUCLEO_CORTE_MAXIMO = 0.8;
// A folga embaixo do texto reproduz a conta do `calculateDynamicViewBox` do gerador
// (descida de 0.3 do corpo, mais a margem de 5 dele). O viewBox ja nasce grande o bastante
// para caber o texto, e por isso o texto NAO empurra o desenho para fora do ponto clicado.
const NUCLEO_FOLGA_TEXTO = NUCLEO_FONTE * 0.3 + 7;

/**
 * Extract viewBox of a catalog SVG
 * @param {string} svg - SVG string
 * @returns {Object} { minX, minY, width, height }
 */
function extrairViewBox(svg) {
  const encontrado = String(svg).match(/viewBox="([^"]+)"/);
  const valores = encontrado ? encontrado[1].trim().split(/\s+/).map(Number) : null;

  if (!valores || valores.length !== 4 || valores.some(Number.isNaN)) {
    throw new Error('Simbolo de escalao sem viewBox utilizavel');
  }

  return { minX: valores[0], minY: valores[1], width: valores[2], height: valores[3] };
}

/**
 * Return only the inner content of an SVG, without the outer <svg> element
 * @param {string} svg - SVG string
 * @returns {string} Inner markup
 */
function conteudoInterno(svg) {
  return String(svg).replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
}

/**
 * Round to two decimals, to keep the generated SVG readable
 * @param {number} valor - Value
 * @returns {number} Rounded value
 */
function arredondar(valor) {
  return Math.round(valor * 100) / 100;
}

/**
 * Poe o traco do simbolo de escalao na MESMA espessura do contorno da elipse. Sao duas
 * correcoes numa: desfazer a escala do glifo, que encolhe o `stroke-width` junto com o
 * desenho, e levar da espessura nativa dele ate a do nucleo.
 *
 * @param {string} conteudo - Inner markup of the echelon glyph
 * @param {number} escala - Applied scale
 * @returns {string} Markup with compensated stroke widths
 */
function compensarTraco(conteudo, escala) {
  const fator = NUCLEO_TRACO / (TRACO_NATIVO_DO_GLIFO * escala);

  return conteudo.replace(
    /stroke-width="([\d.]+)"/g,
    (_, largura) => `stroke-width="${arredondar(Number(largura) * fator)}"`
  );
}

/**
 * Onde a elipse abre, dada a meia largura da abertura. As duas pontas do arco ficam nos
 * cantos de cima do que entra pelo corte, e por isso o corte e mais largo e mais alto
 * quanto mais largo for esse conteudo: o colchete de Forca-Tarefa abre muito mais que as
 * barras de batalhao.
 *
 * @param {number} meiaAbertura - Metade da largura que precisa passar
 * @returns {Object} { xCorte, yCorte } na moldura centrada na elipse
 */
function corteNaElipse(meiaAbertura) {
  const cosseno = Math.min(meiaAbertura / NUCLEO_RX, NUCLEO_CORTE_MAXIMO);

  return {
    xCorte: arredondar(NUCLEO_RX * cosseno),
    yCorte: arredondar(NUCLEO_RY * Math.sqrt(1 - cosseno * cosseno))
  };
}

/**
 * A geometria de um Nucleo, antes de virar SVG. Reune num lugar so as contas que o desenho
 * e a altura do texto precisam, para as duas nao saírem de sincronia.
 *
 * @param {string} glifoSvg - SVG do simbolo de escalao SIMPLES
 * @param {boolean} forcaTarefa - Se o escalao vai dentro do colchete de Forca-Tarefa
 * @returns {Object} Medidas na moldura centrada na elipse
 */
function medidasDoNucleo(glifoSvg, forcaTarefa) {
  const caixa = extrairViewBox(glifoSvg);
  const escala = NUCLEO_ESCALA_GLIFO;
  const largura = caixa.width * escala;
  const altura = caixa.height * escala;

  // A meia largura do colchete sai da MARCA, com respiro, e nunca abaixo da de sempre.
  const meiaColchete = forcaTarefa
    ? Math.max(NUCLEO_FT_MEIA_MINIMA, largura / 2 + NUCLEO_FT_RESPIRO)
    : 0;

  // O corte e SEMPRE mais largo que o que entra nele, com ou sem Forca-Tarefa. Sem esta
  // folga a barra de cima do colchete tapava o corte na medida exata, e a elipse voltava a
  // parecer fechada: o corte existe para ser VISTO.
  const meiaAbertura = (forcaTarefa ? meiaColchete : largura / 2) + NUCLEO_FOLGA_CORTE;

  const { xCorte, yCorte } = corteNaElipse(meiaAbertura);

  // No Forca-Tarefa as marcas descem o vao do topo, para a barra de cima do colchete nao
  // encostar nelas.
  const topoDasMarcas = forcaTarefa ? yCorte + NUCLEO_FT_VAO_TOPO : yCorte;
  const baseDasMarcas = topoDasMarcas + altura;
  const base = forcaTarefa ? baseDasMarcas + NUCLEO_FT_SOBRA : baseDasMarcas;

  return { caixa, escala, xCorte, yCorte, meiaColchete, topoDasMarcas, base };
}

/**
 * Onde a identificacao cai, medida na familia INTEIRA. E a mesma altura para os treze
 * escaloes, e nao a de cada um: posicao de texto que varia por codigo obriga treze
 * configuracoes diferentes, e a primeira que sair do lugar sai calada. Toma o pior caso,
 * que e o escalao cuja base desce mais.
 *
 * @param {Object} tabela - Echelon symbol table
 * @returns {number} Text baseline, in the ellipse-centered frame
 */
function baseDaFamilia(forcaTarefa) {
  const bases = Object.keys(ECHELON_CODES)
    .map(code => medidasDoNucleo(ECHELON_SYMBOLS[code], forcaTarefa).base);

  return Math.round(Math.max(...bases) + NUCLEO_VAO_TEXTO + NUCLEO_FONTE);
}

const NUCLEO_TEXTO_Y = baseDaFamilia(false);
const NUCLEO_TEXTO_Y_FT = baseDaFamilia(true);

/**
 * Monta o simbolo de Nucleo a partir do simbolo de escalao.
 *
 * O desenho e SIMETRICO na vertical em torno do centro da elipse. O `icon-anchor` da
 * camada e 'center', que ancora o meio do bitmap: sem a simetria, o ponto clicado cairia
 * no meio do conjunto elipse-mais-escalao-mais-texto, e a elipse subiria.
 *
 * @param {string} glifoSvg - SVG do simbolo de escalao SIMPLES
 * @param {number} textoY - Altura da identificacao, comum a familia
 * @param {boolean} forcaTarefa - Se desenha o colchete de Forca-Tarefa em volta
 * @returns {Object} { svg, textoY }
 */
function montarNucleo(glifoSvg, textoY, forcaTarefa) {
  const { caixa, escala, xCorte, yCorte, meiaColchete, topoDasMarcas, base } =
    medidasDoNucleo(glifoSvg, forcaTarefa);

  const meiaAltura = Math.ceil(textoY + NUCLEO_FOLGA_TEXTO);
  const meiaLargura = Math.ceil(Math.max(
    NUCLEO_RX + NUCLEO_TRACO / 2 + NUCLEO_MARGEM,
    xCorte + NUCLEO_MARGEM
  ));

  const largura = meiaLargura * 2;
  const altura = meiaAltura * 2;

  const deslocX = arredondar(-(caixa.minX + caixa.width / 2) * escala);
  const deslocY = arredondar(topoDasMarcas - caixa.minY * escala);

  const glifo = compensarTraco(conteudoInterno(glifoSvg), escala);

  // Arco aberto, da ponta direita do corte ate a esquerda, pelo lado de CIMA: o `1 0` sao
  // o arco maior e o sentido anti-horario, que e o caminho que passa pelo topo.
  const contorno = `M ${xCorte} ${yCorte} A ${NUCLEO_RX} ${NUCLEO_RY} 0 1 0 ${-xCorte} ${yCorte}`;

  // O colchete pendura DENTRO do corte, mais estreito que ele: sobra o vao da folga de
  // cada lado, e e por esse vao que se ve a elipse cortada. Colchete da largura exata do
  // corte tapa a abertura, e o desenho volta a parecer uma elipse fechada.
  const colchete = forcaTarefa
    ? `<path d="M ${-meiaColchete} ${arredondar(base)} L ${-meiaColchete} ${yCorte}`
      + ` L ${meiaColchete} ${yCorte} L ${meiaColchete} ${arredondar(base)}"`
      + ` stroke-width="${NUCLEO_TRACO}" stroke="black" fill="none"></path>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny"`
    + ` width="${largura}" height="${altura}"`
    + ` viewBox="${-meiaLargura} ${-meiaAltura} ${largura} ${altura}">`
    + `<path data-nucleo="contorno" d="${contorno}"`
    + ` stroke-width="${NUCLEO_TRACO}" stroke="black" fill="none"></path>`
    + colchete
    + `<g transform="translate(${deslocX},${deslocY}) scale(${escala})">${glifo}</g>`
    + `</svg>`;

  return { svg, textoY };
}

// ============================================================================
// NUCLEO POINT GENERATION
// ============================================================================

/**
 * Generate all nucleus point definitions
 * @returns {Object} Map of nucleus point codes to point definitions
 */
function generateEchelonPoints() {
  const echelonPoints = {};

  const familias = [
    {
      prefixo: 'ECHELON',
      base: NUCLEO_TEXTO_Y,
      nome: 'Núcleo',
      categoria: 'Núcleo',
      forcaTarefa: false
    },
    {
      prefixo: 'ECHELON_FT',
      base: NUCLEO_TEXTO_Y_FT,
      nome: 'Núcleo FT',
      categoria: 'Núcleo Força-Tarefa',
      forcaTarefa: true
    }
  ];

  familias.forEach(familia => {
    Object.entries(ECHELON_CODES).forEach(([code, label]) => {
      const pointCode = `${familia.prefixo}_${code}`;
      // As duas familias partem do MESMO simbolo de escalao: o que separa e o colchete,
      // que o `montarNucleo` desenha em volta.
      const { svg, textoY } = montarNucleo(ECHELON_SYMBOLS[code], familia.base, familia.forcaTarefa);

      echelonPoints[pointCode] = {
        code: pointCode,
        name: `${familia.nome} - ${label}`,
        category: familia.categoria,
        svg,
        anchor: "center",
        tamanhoBase: NUCLEO_TAMANHO_BASE,
        isEchelon: true,
        isNucleo: true,
        isForcaTarefa: familia.forcaTarefa,
        echelonCode: code,
        textFields: {
          identificacao: {
            position: { x: 0, y: textoY },
            anchor: 'middle',
            fontSize: NUCLEO_FONTE
          }
        },
        // A situacao aparece no formulario ALEM do texto, e nao entra em `textFields`
        // porque nao e desenhada como texto: ela troca o tracado da elipse.
        uiFields: ['status', 'identificacao']
      };
    });
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
 * Get the field names the attribute form must offer for a point.
 *
 * Por padrao sao os campos de texto do simbolo. O ponto que precisa oferecer um campo que
 * NAO vira texto no desenho (a situacao do nucleo, que troca o tracado da elipse) declara
 * `uiFields`, e ai a lista do formulario deixa de ser a lista do desenho.
 *
 * @param {string} pointCode - Point code
 * @returns {Array<string>} Array of field names
 */
export function getAvailableTextFields(pointCode) {
  const point = COORDINATION_POINTS_CATALOG[pointCode];

  if (point && Array.isArray(point.uiFields)) {
    return point.uiFields;
  }

  return Object.keys(getTextFieldsConfig(pointCode));
}

// ============================================================================
// COMPLETE CATALOG EXPORT
// ============================================================================

export const COORDINATION_POINTS_CATALOG = {
  ...BASE_POINTS,
  ...generateEchelonPoints(),
  ...generateSupplyPoints()
};

/**
 * The catalog code a symbol is DRAWN with. The Nucleo is stored as the SCREEN code
 * `ECHELON` / `ECHELON_FT`, which is not a catalog key; the drawable key travels in
 * `echelonCode` (defaulting to the battalion, as the control does before it draws). Every
 * writer of the symbol bitmap must resolve through here, or the generator throws
 * `Point ECHELON not found in catalog` and the caller draws nothing.
 *
 * @param {Object} properties - Feature properties (`pointCode`, `echelonCode`)
 * @returns {string} The catalog key to draw
 */
export function resolveDrawablePointCode(properties) {
  const pointCode = properties?.pointCode;
  if (pointCode === 'ECHELON' || pointCode === 'ECHELON_FT') {
    return properties.echelonCode || (pointCode === 'ECHELON' ? 'ECHELON_16' : 'ECHELON_FT_16');
  }
  return pointCode;
}
