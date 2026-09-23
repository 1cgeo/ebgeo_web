// Path: js/military_tools/engineering_symbol_tool/engineering_catalog.js
// Approved C 5-36 table 6-4 geometry. Context is deliberately absent.
export const ENGINEERING_CATALOG = [
  {
    "number": 2,
    "title": "Ponto crítico",
    "variants": [
      {
        "label": "Exemplo",
        "body": "<path d=\"M115 40Q120 31 125 40L157 105Q163 115 150 115H90Q77 115 83 105Z M120 115V149\" /><text x=\"120\" y=\"95\" font-size=\"28\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial, sans-serif\">3</text>",
        "anchor": [
          120,
          149
        ]
      }
    ]
  },
  {
    "number": 3,
    "title": "Limite de trecho",
    "variants": [
      {
        "label": "Exemplo",
        "body": "<path d=\"M109.75 122L119.75 103L132.75 119\" data-part=\"section-limit\"/>",
        "anchor": [
          119.75,
          103
        ]
      }
    ]
  },
  {
    "number": 5,
    "title": "Rampas",
    "variants": [
      {
        "label": "5 a 7%",
        "body": "<line x1=\"108\" y1=\"155\" x2=\"108\" y2=\"42\" /><path d=\"M 111.48 49.20 L 108.00 42.00 L 104.52 49.20\" /><text x=\"140\" y=\"120\" font-size=\"17\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial, sans-serif\">6</text><path d=\"M102 141l6 -6 6 6\" />",
        "anchor": [
          108,
          155
        ]
      },
      {
        "label": "7 a 10%",
        "body": "<line x1=\"108\" y1=\"155\" x2=\"108\" y2=\"42\" /><path d=\"M 111.48 49.20 L 108.00 42.00 L 104.52 49.20\" /><text x=\"140\" y=\"120\" font-size=\"17\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial, sans-serif\">9</text><path d=\"M102 141l6 -6 6 6\" /><path d=\"M102 119l6 -6 6 6\" />",
        "anchor": [
          108,
          155
        ]
      },
      {
        "label": "11 a 14%",
        "body": "<line x1=\"108\" y1=\"155\" x2=\"108\" y2=\"42\" /><path d=\"M 111.48 49.20 L 108.00 42.00 L 104.52 49.20\" /><text x=\"140\" y=\"120\" font-size=\"17\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial, sans-serif\">11</text><path d=\"M102 141l6 -6 6 6\" /><path d=\"M102 119l6 -6 6 6\" /><path d=\"M102 97l6 -6 6 6\" />",
        "anchor": [
          108,
          155
        ]
      },
      {
        "label": "Acima de 14%",
        "body": "<line x1=\"108\" y1=\"155\" x2=\"108\" y2=\"42\" /><path d=\"M 111.48 49.20 L 108.00 42.00 L 104.52 49.20\" /><text x=\"140\" y=\"120\" font-size=\"17\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial, sans-serif\">17</text><path d=\"M102 141l6 -6 6 6\" /><path d=\"M102 119l6 -6 6 6\" /><path d=\"M102 97l6 -6 6 6\" /><path d=\"M102 75l6 -6 6 6\" />",
        "anchor": [
          108,
          155
        ]
      }
    ]
  },
  {
    "number": 6,
    "title": "Curva fechada",
    "variants": [
      {
        "label": "Exemplo",
        "body": "<polygon points=\"110.67323766,108.47555685 86.17974009,137.66577057 73.14702225,101.85867259\" data-part=\"equilateral-outer\"/><text x=\"79\" y=\"160\" font-size=\"17\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\" data-part=\"\">26</text>",
        "anchor": [
          110.67323765728999,
          108.47555684683529
        ]
      }
    ]
  },
  {
    "number": 7,
    "title": "Sequência de curvas fechadas",
    "variants": [
      {
        "label": "Exemplo",
        "body": "<polygon points=\"110.67323766,108.47555685 86.17974009,137.66577057 73.14702225,101.85867259\" data-part=\"equilateral-outer\"/><polygon points=\"99.39692621,112.57979857 88.26351822,125.84807753 82.33955557,109.57212390\" data-part=\"equilateral-inner\"/><text x=\"79\" y=\"160\" font-size=\"17\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\" data-part=\"\">1/15</text>",
        "anchor": [
          110.67323765728999,
          108.47555684683529
        ]
      }
    ]
  },
  {
    "number": 8,
    "title": "Ponte — símbolo completo",
    "variants": [
      {
        "label": "Exemplo",
        "body": "<circle cx=\"120\" cy=\"104\" r=\"70\" data-part=\"bridge-outline\"/><line x1=\"50\" y1=\"104\" x2=\"190\" y2=\"104\" /><circle cx=\"120\" cy=\"59\" r=\"5.8\" data-part=\"wheel\"/><path d=\"M110 89h24l-6 7h-24Z\" data-part=\"track\"/><g data-part=\"two-way-flow\"><line x1=\"84\" y1=\"82\" x2=\"84\" y2=\"71\" /><polygon points=\"80.70000000,75.00000000 84.00000000,69.00000000 87.30000000,75.00000000\" fill=\"currentColor\" stroke=\"none\"/><line x1=\"97\" y1=\"70\" x2=\"97\" y2=\"81\" /><polygon points=\"93.70000000,77.00000000 97.00000000,83.00000000 100.30000000,77.00000000\" fill=\"currentColor\" stroke=\"none\"/></g><g data-part=\"one-way-flow\"><line x1=\"151\" y1=\"82\" x2=\"151\" y2=\"71\" /><polygon points=\"147.70000000,75.00000000 151.00000000,69.00000000 154.30000000,75.00000000\" fill=\"currentColor\" stroke=\"none\"/></g><g data-part=\"bridge-leader\"><line x1=\"52.2\" y1=\"121.4\" x2=\"16\" y2=\"154\" /><polygon points=\"16.00000000,154.00000000 20.40000000,144.30000000 26.10000000,150.50000000\" fill=\"currentColor\" stroke=\"none\"/></g><text x=\"120\" y=\"128\" font-size=\"18\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\" data-part=\"order\">3</text><text x=\"89\" y=\"64\" font-size=\"14\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\" data-part=\"wheels-two\">80</text><text x=\"151\" y=\"64\" font-size=\"14\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\" data-part=\"wheels-one\">100</text><text x=\"89\" y=\"99\" font-size=\"14\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\" data-part=\"tracks-two\">60</text><text x=\"151\" y=\"99\" font-size=\"14\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\" data-part=\"tracks-one\">80</text><text x=\"25\" y=\"109\" font-size=\"16\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\" data-part=\"clearance\">4</text><text x=\"214\" y=\"109\" font-size=\"16\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\" data-part=\"length\">100</text><text x=\"120\" y=\"195\" font-size=\"16\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\" data-part=\"width\">9</text><line x1=\"17\" y1=\"115\" x2=\"33\" y2=\"115\" data-example-underline=\"true\"/>",
        "anchor": [
          16,
          154
        ]
      }
    ]
  },
  {
    "number": 9,
    "title": "Ponte — símbolo abreviado",
    "variants": [
      {
        "label": "Exemplo",
        "body": "<circle cx=\"130\" cy=\"90\" r=\"40\" /><line x1=\"90\" y1=\"90\" x2=\"170\" y2=\"90\" /><text x=\"130\" y=\"81\" font-size=\"23\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial, sans-serif\">80</text><text x=\"130\" y=\"116\" font-size=\"23\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial, sans-serif\">40</text><line x1=\"96\" y1=\"111\" x2=\"62\" y2=\"135\" /><path d=\"M 65.88 128.00 L 62.00 135.00 L 69.89 133.69\" />",
        "anchor": [
          62,
          135
        ]
      }
    ]
  },
  {
    "number": 10,
    "title": "Contorno de fácil utilização",
    "variants": [
      {
        "label": "Forma 1",
        "body": "<line x1=\"155\" y1=\"73\" x2=\"74\" y2=\"73\" /><path d=\"M 81.20 69.52 L 74.00 73.00 L 81.20 76.48\" /><path d=\"M155 73V127\" /><line x1=\"155\" y1=\"127\" x2=\"74\" y2=\"127\" /><path d=\"M 81.20 123.52 L 74.00 127.00 L 81.20 130.48\" />",
        "anchor": [
          120,
          100
        ]
      },
      {
        "label": "Forma 2",
        "body": "<line x1=\"155\" y1=\"63\" x2=\"74\" y2=\"63\" /><path d=\"M 81.20 59.52 L 74.00 63.00 L 81.20 66.48\" /><path d=\"M155 63V83l-24 22 49 -15 -25 25v22\" /><line x1=\"155\" y1=\"137\" x2=\"74\" y2=\"137\" /><path d=\"M 81.20 133.52 L 74.00 137.00 L 81.20 140.48\" />",
        "anchor": [
          120,
          100
        ]
      }
    ]
  },
  {
    "number": 11,
    "title": "Contorno de difícil utilização",
    "variants": [
      {
        "label": "Exemplo",
        "body": "<line x1=\"155\" y1=\"64\" x2=\"74\" y2=\"64\" /><path d=\"M 81.20 60.52 L 74.00 64.00 L 81.20 67.48\" /><path d=\"M155 64V90 M140 90h30 M140 110h30 M155 110V136\" /><line x1=\"155\" y1=\"136\" x2=\"74\" y2=\"136\" /><path d=\"M 81.20 132.52 L 74.00 136.00 L 81.20 139.48\" />",
        "anchor": [
          120,
          100
        ]
      }
    ]
  },
  {
    "number": 13,
    "title": "Vau",
    "variants": [
      {
        "label": "Sem indicação de acesso difícil",
        "body": "<text x=\"130\" y=\"66\" font-size=\"19\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\">4 / V / ? / Y</text><text x=\"130\" y=\"143\" font-size=\"17\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\">15 / 3 / P / 0,75</text><path d=\"M34 94L26 99L34 104\"/><line x1=\"26\" y1=\"99\" x2=\"52\" y2=\"99\"/><line x1=\"52\" y1=\"99\" x2=\"225\" y2=\"99\" stroke-dasharray=\"9 6\"/>",
        "anchor": [
          26,
          99
        ]
      },
      {
        "label": "Acesso difícil à esquerda",
        "body": "<text x=\"130\" y=\"66\" font-size=\"19\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\">4 / V / ? / Y</text><text x=\"130\" y=\"143\" font-size=\"17\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\">15 / 3 / P / 0,75</text><path d=\"M34 94L26 99L34 104\"/><line x1=\"26\" y1=\"99\" x2=\"52\" y2=\"99\"/><path data-part=\"ford-access-left\" d=\"M52 99 L65.000 119 L78.000 79 L91.000 119 L104.000 79 L117.000 119 L130.000 79 L143.000 119 L156 99\"/><line x1=\"156\" y1=\"99\" x2=\"225\" y2=\"99\" stroke-dasharray=\"9 6\"/>",
        "anchor": [
          26,
          99
        ]
      }
    ]
  },
  {
    "number": 14,
    "title": "Balsa",
    "variants": [
      {
        "label": "Exemplo",
        "body": "<path d=\"M58 84l23 44h64l23 -44 M112 84V128\"/><polygon points=\"25,84 32,80 32,88\" fill=\"currentColor\" stroke=\"none\"/><line x1=\"25\" y1=\"84\" x2=\"171\" y2=\"84\"/><path data-part=\"ferry-access-right\" d=\"M171 84 L175.857 76 L180.714 92 L185.571 76 L190.429 92 L195.286 76 L200.143 92 L205 84\"/><line x1=\"205\" y1=\"84\" x2=\"219\" y2=\"84\"/><text x=\"85\" y=\"72\" font-size=\"17\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\">4</text><text x=\"139\" y=\"72\" font-size=\"17\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\">V</text><text x=\"91\" y=\"115\" font-size=\"21\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\">60</text><text x=\"138\" y=\"116\" font-size=\"24\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\">?</text><text x=\"111\" y=\"155\" font-size=\"21\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\">20</text>",
        "anchor": [
          25,
          84
        ]
      }
    ]
  },
  {
    "number": 15,
    "title": "Redução de largura",
    "variants": [
      {
        "label": "Exemplo",
        "body": "<defs><pattern id=\"dots\" width=\"5\" height=\"5\" patternUnits=\"userSpaceOnUse\"><circle cx=\"1.5\" cy=\"1.5\" r=\".7\" fill=\"currentColor\" stroke=\"none\" /></pattern></defs><path d=\"M111 98L75 78V119Z M129 98L165 78V119Z\" fill=\"url(#dots)\" /><text x=\"52\" y=\"105\" font-size=\"21\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial, sans-serif\">4</text><text x=\"195\" y=\"105\" font-size=\"21\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial, sans-serif\">120</text>",
        "anchor": [
          120,
          100
        ]
      }
    ]
  },
  {
    "number": 16,
    "title": "Passagem sob arco",
    "variants": [
      {
        "label": "Exemplo",
        "body": "<path d=\"M52 114H72\" /><path d=\"M72 114a48 48 0 0 1 96 0h20\" /><text x=\"52\" y=\"99\" font-size=\"20\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial, sans-serif\">4</text><text x=\"192\" y=\"97\" font-size=\"17\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial, sans-serif\">3,5/4,5</text>",
        "anchor": [
          120,
          114
        ]
      }
    ]
  },
  {
    "number": 17,
    "title": "Passagem sob estrutura retangular",
    "variants": [
      {
        "label": "Exemplo",
        "body": "<path d=\"M48 125H82V77H158V125H199\" data-part=\"rectangular-portal\"/><path d=\"M82 106H92Q98 106 98 112V119Q98 125 92 125H82 M158 106H148Q142 106 142 112V119Q142 125 148 125H158\" data-part=\"inner-curbs\"/><text x=\"47\" y=\"104\" font-size=\"20\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\" data-part=\"widths\">4/6</text><text x=\"187\" y=\"104\" font-size=\"20\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\" data-part=\"clearance\">7</text>",
        "anchor": [
          120,
          101
        ]
      }
    ]
  },
  {
    "number": 18,
    "title": "Túnel",
    "variants": [
      {
        "label": "Exemplo",
        "body": "<path d=\"M70 120A50 58 0 0 1 170 120\" data-part=\"tunnel-vault\"/><path d=\"M72.47 102H92V120 M167.53 102H148V120\" data-part=\"tunnel-curbs\"/><path d=\"M216 120H34 M43 112L34 120L43 128\" data-part=\"tunnel-leader\"/><text x=\"120\" y=\"107\" font-size=\"23\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\" data-part=\"order\">1</text><text x=\"46\" y=\"108\" font-size=\"21\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\" data-part=\"clearance\">4</text><text x=\"203\" y=\"108\" font-size=\"21\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\" data-part=\"length\">800</text><text x=\"120\" y=\"149\" font-size=\"21\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial,sans-serif\" data-part=\"widths\">5/6</text>",
        "anchor": [
          34,
          120
        ]
      }
    ]
  },
  {
    "number": 19,
    "title": "Passagem de nível",
    "variants": [
      {
        "label": "Exemplo",
        "body": "<path d=\"M48 97l12 12 M48 109l12 -12\" /><text x=\"53\" y=\"132\" font-size=\"17\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial, sans-serif\">4,2</text>",
        "anchor": [
          118,
          103
        ]
      }
    ]
  },
  {
    "number": 20,
    "title": "Cobertura",
    "variants": [
      {
        "label": "Folhas temporárias · círculos",
        "body": "<circle cx=\"120\" cy=\"58\" r=\"4\"/><circle cx=\"120\" cy=\"86\" r=\"4\"/><circle cx=\"120\" cy=\"114\" r=\"4\"/><circle cx=\"120\" cy=\"142\" r=\"4\"/>",
        "anchor": [
          120,
          100
        ]
      },
      {
        "label": "Folhas permanentes · ângulos",
        "body": "<path d=\"M115 61l5 -7 5 7\"/><path d=\"M115 89l5 -7 5 7\"/><path d=\"M115 117l5 -7 5 7\"/><path d=\"M115 145l5 -7 5 7\"/>",
        "anchor": [
          120,
          100
        ]
      }
    ]
  },
  {
    "number": 21,
    "title": "Coberta",
    "variants": [
      {
        "label": "Folhas temporárias · círculos",
        "body": "<circle cx=\"98\" cy=\"58\" r=\"4\"/><circle cx=\"98\" cy=\"86\" r=\"4\"/><circle cx=\"98\" cy=\"114\" r=\"4\"/><circle cx=\"98\" cy=\"142\" r=\"4\"/><circle cx=\"120\" cy=\"58\" r=\"4\"/><circle cx=\"120\" cy=\"86\" r=\"4\"/><circle cx=\"120\" cy=\"114\" r=\"4\"/><circle cx=\"120\" cy=\"142\" r=\"4\"/><circle cx=\"142\" cy=\"58\" r=\"4\"/><circle cx=\"142\" cy=\"86\" r=\"4\"/><circle cx=\"142\" cy=\"114\" r=\"4\"/><circle cx=\"142\" cy=\"142\" r=\"4\"/>",
        "anchor": [
          120,
          100
        ]
      },
      {
        "label": "Folhas permanentes · ângulos",
        "body": "<path d=\"M93 61l5 -7 5 7\"/><path d=\"M93 89l5 -7 5 7\"/><path d=\"M93 117l5 -7 5 7\"/><path d=\"M93 145l5 -7 5 7\"/><path d=\"M115 61l5 -7 5 7\"/><path d=\"M115 89l5 -7 5 7\"/><path d=\"M115 117l5 -7 5 7\"/><path d=\"M115 145l5 -7 5 7\"/><path d=\"M137 61l5 -7 5 7\"/><path d=\"M137 89l5 -7 5 7\"/><path d=\"M137 117l5 -7 5 7\"/><path d=\"M137 145l5 -7 5 7\"/>",
        "anchor": [
          120,
          100
        ]
      }
    ]
  },
  {
    "number": 22,
    "title": "Deslocamento fora da estrada",
    "variants": [
      {
        "label": "Possível",
        "body": "<line x1=\"76\" y1=\"100\" x2=\"191\" y2=\"100\" /><path d=\"M 183.80 103.48 L 191.00 100.00 L 183.80 96.52\" />",
        "anchor": [
          76,
          100
        ]
      },
      {
        "label": "Rodas / folhas permanentes",
        "body": "<path d=\"M76 100h43 M139 100h52\" /><circle cx=\"129\" cy=\"100\" r=\"10\" /><path d=\"M94 72l5 -7 5 7\" /><path d=\"M94 140l5 -7 5 7\" /><path d=\"M124 72l5 -7 5 7\" /><path d=\"M124 140l5 -7 5 7\" /><path d=\"M154 72l5 -7 5 7\" /><path d=\"M154 140l5 -7 5 7\" /><path d=\"M180 72l5 -7 5 7\" /><path d=\"M180 140l5 -7 5 7\" />",
        "anchor": [
          76,
          100
        ]
      },
      {
        "label": "Lagartas / folhas temporárias",
        "body": "<path d=\"M76 100h43 M139 100h52\" /><rect x=\"120\" y=\"88\" width=\"18\" height=\"24\" /><circle cx=\"99\" cy=\"69\" r=\"4\" /><circle cx=\"99\" cy=\"137\" r=\"4\" /><circle cx=\"129\" cy=\"69\" r=\"4\" /><circle cx=\"129\" cy=\"137\" r=\"4\" /><circle cx=\"159\" cy=\"69\" r=\"4\" /><circle cx=\"159\" cy=\"137\" r=\"4\" /><circle cx=\"185\" cy=\"69\" r=\"4\" /><circle cx=\"185\" cy=\"137\" r=\"4\" />",
        "anchor": [
          76,
          100
        ]
      }
    ]
  },
  {
    "number": 23,
    "title": "Obstáculos",
    "variants": [
      {
        "label": "Planejado",
        "body": "<path d=\"M70 118L170 66 M74 126L174 74\" stroke-dasharray=\"9 7\" />",
        "anchor": [
          120,
          100
        ]
      },
      {
        "label": "Preparado",
        "body": "<path d=\"M70 118L170 66 M74 126L174 74\" />",
        "anchor": [
          120,
          100
        ]
      },
      {
        "label": "Realizado",
        "body": "<path d=\"M70 118L170 66 M74 126L174 74\" /><path d=\"M91 63L149 145 M99 59L157 141\" />",
        "anchor": [
          120,
          100
        ]
      }
    ]
  },
  {
    "number": 26,
    "title": "Dado desconhecido ou duvidoso",
    "variants": [
      {
        "label": "Exemplo",
        "body": "<text x=\"120\" y=\"119\" font-size=\"62\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial, sans-serif\">?</text>",
        "anchor": [
          120,
          100
        ]
      }
    ]
  },
  {
    "number": 27,
    "title": "Área de estacionamento",
    "variants": [
      {
        "label": "Exemplo",
        "body": "<path d=\"M120 100H76a44 44 0 0 1 44 -44Z M120 100h44a44 44 0 0 1 -44 44Z\" fill=\"currentColor\" /><circle cx=\"120\" cy=\"100\" r=\"44\" /><line x1=\"76\" y1=\"100\" x2=\"164\" y2=\"100\" /><line x1=\"120\" y1=\"56\" x2=\"120\" y2=\"144\" />",
        "anchor": [
          120,
          100
        ]
      }
    ]
  },
  {
    "number": 28,
    "title": "Posto de controle de trânsito",
    "variants": [
      {
        "label": "Exemplo",
        "body": "<circle cx=\"120\" cy=\"100\" r=\"44\" /><text x=\"120\" y=\"119\" font-size=\"53\" fill=\"currentColor\" stroke=\"none\" text-anchor=\"middle\" font-family=\"Arial, sans-serif\">T</text>",
        "anchor": [
          120,
          100
        ]
      }
    ]
  }
];
