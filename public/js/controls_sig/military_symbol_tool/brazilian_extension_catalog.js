// Path: js\controls_sig\military_symbol_tool\brazilian_extension_catalog.js

/**
 * ========================================
 * SYMBOL SET CATALOGS
 * ========================================
 */

/**
 * Symbol Set 10: Unidades (Land Units)
 */
const SYMBOL_SET_10_CATALOG = {
    mainIcon: {
        labelMappings: {
            '110200': { from: 'CA', to: 'Civ', fontSize: '45' },
            '121700': { from: 'SF', to: 'Cmdos', fontSize: '30' },
            '121800': { from: 'SOF', to: 'Op Esp', fontSize: '30' },
            '150500': { from: 'EW', to: 'GE', fontSize: '45' },
            '151000': { from: 'MI', to: 'IM', fontSize: '45' },
            '162800': { from: 'PA', to: 'Com Soc', fontSize: '30' }
        },
        graphicAdaptations: {
            '111001': {
                type: 'replace',
                find: '<path d="M25,50 100,110 100,90 175,150" stroke-width="3" stroke="black" fill="none" ></path><path d="M 100,108 V 82.5  m -12.5,4.1 4.1,-4.1 4.2,4.1 4.2,-4.1 4,4.1 4,-4.1 5,4.1  M 100,107 c -3.2,0 -5.9,3 -5.9,6 0,3 2.7,6 5.9,6 3,0 6,-3 6,-6 0,-3 -3,-6 -6,-6 z" stroke-width="3" stroke="black" fill="none" ></path>',
                replace: '<path d="M25,50 100,110 100,90 175,150" stroke-width="4" stroke="black" fill="none" ></path><circle cx="100" cy="130" r="10" stroke-width="4" stroke="black" fill="none" ></circle><path d="M100,120 l0,-60 M70,70 l10,-10 10,10 10,-10 10,10 10,-10 10,10" stroke-width="4" stroke="black" fill="none" ></path>'
            },
            '120300': {
                type: 'replace',
                find: '<path d="m 25,90 c 18.8,0 0,20 18.8,20 18.8,0 0,-20 18.8,-20 18.8,0 0,20 18.8,20 18.8,0 0,-20 18.8,-20 18.8,0 0,20 18.8,20 18.8,0 0,-20 18.8,-20 18.8,0 0,20 18.8,20 18.8,0 0,-20 20,-20" stroke-width="3" stroke="black" fill="none" ></path>',
                replace: '<g transform="translate(50,50)" ><g transform="scale(0.5)" ><path d="M 100,145 100,65" stroke-width="4" stroke="black" fill="none" ></path><path d="m 70,70 60,0" stroke-width="4" stroke="black" fill="none" ></path><path d="m 57.8,105.5 c -2.2,0.1 1.3,20.6 2.8,22.1 0.8,0.8 3.5,-3.8 4.6,-2.6 17.4,20.2 33,19.7 34.7,19.6 0,0 0.2,-0 0.3,0 1.7,0.1 17.3,0.5 34.7,-19.6 1,-1.2 3.7,3.4 4.6,2.6 1.4,-1.5 4.9,-21.9 2.8,-22.1 -2.2,-0.1 -4,4.2 -6.7,6.4 -3,2.4 -7.5,3.4 -7.7,4.5 -0.1,0.8 4.9,3.5 3.9,4.9 -5.1,6.3 -15.1,16.6 -31.3,17 l -0.3,4.3 -0.3,-4.3 c -16.2,-0.4 -26.3,-10.7 -31.3,-17 -1.1,-1.3 4,-4.1 3.9,-4.9 -0.2,-1 -4.7,-2 -7.7,-4.5 -2.7,-2.3 -4.5,-6.6 -6.7,-6.4 z" stroke-width="4" stroke="none" fill="black" ></path><circle cx="100" cy="60" r="5" stroke-width="4" stroke="black" fill="none" ></circle></g></g><g transform="scale(2.2)" ><g transform="translate(-54.7,-22)" ><g transform="translate(89.166527,53.75285)" ><g transform="scale(0.002856)" ><path d="M500.83 2885.5l-76.66 116.35 147.66 55.95 8.66 -149.46c-3.01,-66.7 -29.56,-74.33 -79.66,-22.85z" stroke-width="4" stroke="none" fill="black" ></path><path d="M5166.86 5203.93c33.57,76.38 18.4,127.85 -42.24,195.32 90.8,2.75 137.6,-25.92 172.5,-123.66 -43.78,-34.75 -87.2,-58.64 -130.26,-71.66z" stroke-width="4" stroke="none" fill="black" ></path><path d="M349.13 2973.46c-55.91,46.06 -53.73,104.58 -11.83,171.64l4572.77 1773.13 -3297.69 -1278.72c-12.98,85.74 32.73,153.73 113.92,210.09l2912.55 1245.68c153.37,501.54 509.66,628.22 879.03,454.12 78.56,147.83 142.62,295.68 192.15,443.54l1562.63 830.38c75.54,-332.1 214.99,-648.26 431.58,-945.06l-1769.13 -511.86c-163.14,-72.61 -137.63,-307.88 -388.71,-235.31 -53.45,15.4 -93.57,28.68 -147.19,-7.39 -75.61,-50.89 -94.23,-142.88 -64.51,-261.9l-4985.56 -1888.33zm5100.53 2483.42c-289.69,101.16 -495.28,31.2 -570.16,-257.51 234.42,-60.67 432.86,22.8 570.16,257.51z" stroke-width="4" stroke="none" fill="black" ></path><path d="M1965.9 3585.83c-11.82,-30.55 -52.34,-45.9 -108.31,-41.02 -80.27,82.09 -115.13,188.23 -101.31,317.6 37.82,38.56 92.68,62.02 124.62,53.3 -30.63,-140.89 6.09,-246.82 85,-329.88z" stroke-width="4" stroke="none" fill="black" ></path><path d="M647.83 3086.59c-46.26,37.32 -63.78,91.7 -56.7,156.93" stroke-width="4" stroke="none" fill="black" ></path><path d="M7203.4 2885.38l76.66 116.35 -147.66 55.94 -8.66 -149.45c3.02,-66.71 29.57,-74.34 79.66,-22.85z" stroke-width="4" stroke="none" fill="black" ></path><path d="M2537.37 5203.82c-33.56,76.37 -18.39,127.85 42.25,195.31 -90.8,2.76 -137.6,-25.92 -172.5,-123.66 43.78,-34.75 87.2,-58.64 130.25,-71.65z" stroke-width="4" stroke="none" fill="black" ></path><path d="M7355.09 2973.34c55.92,46.06 53.74,104.58 11.84,171.64l-4572.77 1773.13 3297.69 -1278.73c12.97,85.74 -32.73,153.74 -113.93,210.1l-2912.54 1245.67c-153.37,501.55 -509.66,628.23 -879.03,454.13 -78.56,147.83 -142.62,295.68 -192.15,443.54l-1562.64 830.39c-75.53,-332.1 -214.98,-648.26 -431.57,-945.06l1769.13 -511.87c163.13,-72.61 137.63,-307.87 388.7,-235.31 53.45,15.4 93.58,28.67 147.2,-7.4 75.6,-50.88 94.23,-142.87 64.51,-261.9l4985.56 -1888.33zm-5100.52 2483.42c289.69,101.15 495.28,31.2 570.16,-257.51 -234.42,-60.68 -432.86,22.8 -570.16,257.51z" stroke-width="4" stroke="none" fill="black" ></path><path d="M5738.34 3585.72c11.82,-30.55 52.34,-45.9 108.31,-41.03 80.26,82.09 115.13,188.23 101.3,317.6 -37.82,38.56 -92.67,62.02 -124.61,53.3 30.63,-140.89 -6.09,-246.81 -85,-329.87z" stroke-width="4" stroke="none" fill="black" ></path><path d="M7056.39 3086.46c46.27,37.33 63.78,91.71 56.71,156.93" stroke-width="4" stroke="none" fill="black" ></path></g></g></g></g>'
            },
            '120400': {
                type: 'replace',
                find: '<path d="M25,150 L100,52 175,150" stroke-width="3" stroke="black" fill="none" ></path>',
                replace: '<text x="100" y="115" text-anchor="middle" font-size="42" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >AC</text>'
            },
            '120500': {
                type: 'replace',
                find: '<path d="M125,80 C150,80 150,120 125,120 L75,120 C50,120 50,80 75,80 Z" stroke-width="3" stroke="black" fill="none" ></path>',
                replace: '<path d="M125,80 C150,80 150,120 125,120 L75,120 C50,120 50,80 75,80 Z" stroke-width="4" stroke="black" fill="none" ></path><path d="M25,150L175,50" stroke-width="4" stroke="black" fill="black" ></path>'
            },
            '120502': {
                type: 'replace',
                find: '<path d="M125,80 C150,80 150,120 125,120 L75,120 C50,120 50,80 75,80 Z" stroke-width="3" stroke="black" fill="none" ></path><path d="m 25,90 c 18.8,0 0,20 18.8,20 18.8,0 0,-20 18.8,-20 18.8,0 0,20 18.8,20 18.8,0 0,-20 18.8,-20 18.8,0 0,20 18.8,20 18.8,0 0,-20 18.8,-20 18.8,0 0,20 18.8,20 18.8,0 0,-20 20,-20" stroke-width="3" stroke="black" fill="none" ></path>',
                replace: '<path d="M125,80 C150,80 150,120 125,120 L75,120 C50,120 50,80 75,80 Z" stroke-width="4" stroke="black" fill="none" ></path><path d="M25,150L175,50" stroke-width="4" stroke="black" fill="black" ></path><text x="100" y="140" text-anchor="middle" font-size="25" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >Anf</text>'
            },
            '120601': {
                type: 'replace',
                find: '<path d="M60,85 l40,15 40,-15 0,30 -40,-15 -40,15 z" stroke-width="3" stroke="none" fill="black" ></path><path d="M25,150L175,50" stroke-width="3" stroke="black" fill="black" ></path>',
                replace: '<path d="M60,85 l40,15 40,-15 0,30 -40,-15 -40,15 z" stroke-width="3" stroke="none" fill="black" ></path>'
            },
            '120801': {
                type: 'replace',
                find: '<path d="M100,100 L130,88 c15,0 15,24 0,24 L100,100 70,112 c-15,0 -15,-24 0,-24 Z" stroke-width="3" stroke="none" fill="black" ></path><path d="M25,150L175,50" stroke-width="3" stroke="black" fill="black" ></path>',
                replace: '<path d="M100,100 L130,88 c15,0 15,24 0,24 L100,100 70,112 c-15,0 -15,-24 0,-24 Z" stroke-width="3" stroke="none" fill="black" ></path>'
            },
            '121101': {
                type: 'replace',
                find: '<path d="M25,50 L175,150 M25,150 L175,50" stroke-width="3" stroke="black" fill="black" ></path><path d="m 25,90 c 18.8,0 0,20 18.8,20 18.8,0 0,-20 18.8,-20 18.8,0 0,20 18.8,20 18.8,0 0,-20 18.8,-20 18.8,0 0,20 18.8,20 18.8,0 0,-20 18.8,-20 18.8,0 0,20 18.8,20 18.8,0 0,-20 20,-20" stroke-width="3" stroke="black" fill="none" ></path>',
                replace: '<path d="M25,50 L175,150 M25,150 L175,50" stroke-width="3" stroke="black" fill="black" ></path>'
            },
            '130100': {
                type: 'replace',
                find: '<path d="M25,150 C25,110 175,110 175,150" stroke-width="3" stroke="black" fill="none" ></path>',
                replace: '<path d="M25,150 C45,110 155,110 175,150" stroke-width="4" stroke="black" fill="none" ></path><path d="M25,150 L100,52 175,150" stroke-width="4" stroke="black" fill="none" ></path>'
            },
            '130302': {
                type: 'replace',
                find: '<g transform="translate(20,20)" ><g transform="scale(0.8)" ><circle cx="100" cy="100" r="15" stroke-width="3" stroke="black" fill="black" ></circle></g></g><path d="M125,80 C150,80 150,120 125,120 L75,120 C50,120 50,80 75,80 Z" stroke-width="3" stroke="black" fill="none" ></path><path d="M25,150L175,50" stroke-width="3" stroke="black" fill="black" ></path>',
                replace: '<circle cx="100" cy="100" r="15" stroke-width="4" stroke="black" fill="black" ></circle>'
            },
            '160000': {
                type: 'replace',
                find: '<text x="100" y="103" text-anchor="middle" font-size="33" font-family="Arial" font-weight="bold" dominant-baseline="middle" stroke-width="3" stroke="none" fill="black" >SUST</text>',
                replace: '<path d="m 100,80 20,11 0,17 -20,11 -20,-11 0,-17 z" stroke-width="4" stroke="black" fill="none" ></path>'
            },
            '160600': {
                type: 'replace',
                find: '<text x="100" y="103" text-anchor="middle" font-size="39" font-family="Arial" font-weight="bold" dominant-baseline="middle" stroke-width="3" stroke="none" fill="black" >CSS</text>',
                replace: '<path d="m 100,80 20,11 0,17 -20,11 -20,-11 0,-17 z" stroke-width="4" stroke="black" fill="none" ></path>'
            },
            '162400': {
                type: 'replace',
                find: '<text x="100" y="103" text-anchor="middle" font-size="45" font-family="Arial" font-weight="bold" dominant-baseline="middle" stroke-width="3" stroke="none" fill="black" >PS</text>',
                replace: '<g transform="translate(-41,-53)" ><g transform="scale(1.3)" ><path d="m 107.57203,133.44568 c -1.77302,-0.12386 -2.16092,-0.27065 -1.76404,-0.66754 0.16986,-0.16985 0.30883,-0.57564 0.30883,-0.90175 0,-0.32611 0.11906,-0.66651 0.26458,-0.75645 0.14552,-0.0899 0.26459,-0.38611 0.26459,-0.65817 0,-0.87137 0.65392,-1.24862 2.02791,-1.1699 0.70366,0.0403 1.54828,0.0812 1.87693,0.0908 0.48065,0.0141 0.5514,0.10808 0.3616,0.48051 -0.12978,0.25466 -0.35241,0.76068 -0.49473,1.12448 -0.69115,1.76661 -1.13566,2.64152 -1.32004,2.59814 -0.11149,-0.0262 -0.79803,-0.0893 -1.52563,-0.14011 z m -5.61455,-5.54102 -0.85205,-0.67689 1.11663,-2.21537 1.11663,-2.21537 1.94028,-0.006 c 1.06716,-0.003 1.90059,0.0986 1.85209,0.22602 -0.25072,0.65884 -3.83036,5.57224 -4.05695,5.56854 -0.14552,-0.002 -0.648,-0.30891 -1.11663,-0.6812 z m 5.9322,-0.80804 c -0.12513,-0.21064 0.42024,-2.22122 0.97201,-3.58345 0.28029,-0.69198 0.38148,-0.7276 2.0666,-0.7276 0.97454,0 1.83347,0.0996 1.90875,0.22145 0.0753,0.12179 -0.20609,1.10406 -0.62524,2.18281 l -0.7621,1.96136 -1.71763,0.0777 c -0.9447,0.0427 -1.77378,-0.0168 -1.84239,-0.13229 z m 15.82193,-7.46188 c -1.39589,-0.82205 -4.16544,-1.67647 -6.53504,-2.01607 -2.56946,-0.36825 -5.36823,-0.11768 -10.53058,0.94281 -2.51395,0.51643 -3.21842,0.55155 -7.408337,0.36925 -2.546614,-0.1108 -5.195755,-0.21153 -5.886979,-0.22383 -0.691224,-0.0123 -1.257102,-0.0819 -1.257506,-0.15467 -3.97e-4,-0.0728 0.228627,-0.60854 0.508958,-1.19062 0.280331,-0.58208 0.651657,-1.59412 0.82517,-2.24896 0.52411,-1.97801 0.791977,-2.69657 1.726066,-4.63021 1.891208,-3.91495 4.665162,-6.28925 8.846788,-7.5722 1.61625,-0.49588 8.43215,-0.49704 10.05417,-0.002 2.85399,0.87155 4.60557,1.91304 6.54756,3.8932 1.05551,1.07626 1.91911,2.081 1.91911,2.23277 0,0.15176 0.20829,0.59383 0.46288,0.98238 1.0328,1.57626 1.81551,4.48988 2.06191,7.67546 0.20948,2.70838 0.1395,2.81026 -1.33417,1.9424 z" stroke-width="4" stroke="none" fill="black" ></path></g></g>'
            },
            '163700': {
                type: 'replace',
                find: '<path d="M 111,115 C 96.3,110 96.3,89.5 111,84 100,79.7 87.5,86.3 87.5,99.5 87.5,113 100,119 111,115 Z" stroke-width="3" stroke="black" fill="none" ></path>',
                replace: '<path d="m 105,85 c -5,10 -5,20 0,30 m 0,-30 c -20,0 -20,30 0,30" stroke-width="4" stroke="black" fill="none" ></path>'
            }
        },
        extensions: {
            '121899': {
                0: {
                    type: 'text',
                    text: 'FE',
                    position: { x: 100, y: 115 },
                    style: { fontSize: '42', fontWeight: 'bold', fill: 'black' }
                },
                1: {
                    type: 'text',
                    text: 'Prec',
                    position: { x: 100, y: 110 },
                    style: { fontSize: '32', fontWeight: 'bold', fill: 'black' }
                }
            },
            '141299': {
                0: {
                    type: 'text',
                    text: 'PE',
                    position: { x: 100, y: 115 },
                    style: { fontSize: '42', fontWeight: 'bold', fill: 'black' }
                },
                1: {
                    type: 'text',
                    text: 'PA',
                    position: { x: 100, y: 115 },
                    style: { fontSize: '42', fontWeight: 'bold', fill: 'black' }
                },
                2: {
                    type: 'text',
                    text: 'SP',
                    position: { x: 100, y: 115 },
                    style: { fontSize: '42', fontWeight: 'bold', fill: 'black' }
                }
            },
            '159900': {
                0: {
                    type: 'text',
                    text: 'Ciber',
                    position: { x: 100, y: 110 },
                    style: { fontSize: '32', fontWeight: 'bold', fill: 'black' }
                }
            },
            '161199': {
                0: {
                    type: 'svg',
                    svg: '<path d="M70,90 c10,0 10,20 0,20 m10,-10 l40,0 m10,-10 c-10,0 -10,20 0,20" stroke-width="4" stroke="black" fill="none" ></path><path d="M25,120 l150,0" stroke-width="4" stroke="black" fill="none" ></path>'
                }
            },
            '163499': {
                0: {
                    type: 'svg',
                    svg: '<path d="M25,120 l150,0" stroke-width="4" stroke="black" fill="none" ></path><path d="M25,120 L100,52 175,120" stroke-width="4" stroke="black" fill="none" ></path><path d="M25,120 l150,0" stroke-width="4" stroke="black" fill="none" ></path><path d="M100,50L100,120" stroke-width="4" stroke="black" fill="none" ></path><path d="M60,90 L100,120" stroke-width="4" stroke="black" fill="none" ></path><path d="M100,120L140,90" stroke-width="4" stroke="black" fill="none" ></path>'
                },
                1: {
                    type: 'svg',
                    svg: '<path d="M25,120 l150,0" stroke-width="4" stroke="black" fill="none" ></path><path d="M60,120 L60,80 140,80 140,120 M100,80 L100,110" stroke-width="4" stroke="black" fill="none" ></path>'
                },
                2: {
                    type: 'svg',
                    svg: '<path d="M25,120 l150,0" stroke-width="4" stroke="black" fill="none" ></path><path d="M25,50 100,93 100,77 175,120" stroke-width="4" stroke="black" fill="none" ></path>'
                },
                3: {
                    type: 'svg',
                    svg: '<path d="M25,120 l150,0" stroke-width="4" stroke="black" fill="none" ></path><text x="100" y="115" text-anchor="middle" font-size="45" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >X</text>'
                },
                4: {
                    type: 'svg',
                    svg: '<path d="M25,120 l150,0" stroke-width="4" stroke="black" fill="none" ></path><path d="m 100,112 -15,-25 30,0 -15,25 -15,-25" stroke-width="4" stroke="black" fill="none" ></path>'
                },
                5: {
                    type: 'svg',
                    svg: '<path d="M25,120 l150,0" stroke-width="4" stroke="black" fill="none" ></path><text x="100" y="115" text-anchor="middle" font-size="42" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >MB</text>'
                },
                6: {
                    type: 'svg',
                    svg: '<path d="M25,120 l150,0" stroke-width="4" stroke="black" fill="none" ></path><text x="100" y="110" text-anchor="middle" font-size="35" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >IAB</text>'
                },
                7: {
                    type: 'svg',
                    svg: '<path d="M25,120 l150,0" stroke-width="4" stroke="black" fill="none" ></path><text x="100" y="110" text-anchor="middle" font-size="35" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >IAQ</text>'
                },
                8: {
                    type: 'svg',
                    svg: '<path d="M25,120 l150,0" stroke-width="4" stroke="black" fill="none" ></path><g transform="translate(-30,0)" ><path d="m 105,85 c -5,10 -5,20 0,30 m 0,-30 c -20,0 -20,30 0,30" stroke-width="4" stroke="black" fill="none" ></path><g transform="translate(65,20)" ><g transform="scale(0.8)" ><path d="m 65,90 50,0 c 10,0 20,10 20,20 m -40,-30 20,0 m -10,0 0,10" stroke-width="4" stroke="black" fill="none" ></path></g></g></g>'
                },
                9: {
                    type: 'svg',
                    svg: '<path d="M25,120 l150,0" stroke-width="4" stroke="black" fill="none" ></path><g transform="translate(-25,0)" ><path d="m 105,85 c -5,10 -5,20 0,30 m 0,-30 c -20,0 -20,30 0,30" stroke-width="4" stroke="black" fill="none" ></path><g transform="translate(45,0)" ><g transform="scale(1)" ><path d="m 100,112 -15,-25 30,0 -15,25 -15,-25" stroke-width="4" stroke="black" fill="none" ></path></g></g></g>'
                },
                10: {
                    type: 'svg',
                    svg: '<path d="M25,120 l150,0" stroke-width="4" stroke="black" fill="none" ></path><g transform="translate(5,30)" ><g transform="scale(0.7)" ><path d="m 115,95 c 0,15 15,15 15,0 0,-15 -15,-15 -15,0 z m 0,0 -45,0 0,10 10,0 0,-10" stroke-width="4" stroke="black" fill="none" ></path></g></g><g transform="translate(25,0)" ><g transform="scale(1)" ><path d="m 100,112 -15,-25 30,0 -15,25 -15,-25" stroke-width="4" stroke="black" fill="none" ></path></g></g>'
                }
            },
            '209900': {
                0: {
                    type: 'text',
                    text: 'BM',
                    position: { x: 100, y: 115 },
                    style: { fontSize: '42', fontWeight: 'bold', fill: 'black' }
                }
            }
        }
    },
    modifier1: {
        labelMappings: {
            '05': { from: 'BOR', to: 'Fron' },
            '07': { from: 'C', to: 'Q' },
            '09': { from: 'CBT', to: 'Cmb' },
            '12': { from: 'CONST', to: 'Cnst' },
            '14': { from: 'CRC', to: 'CDC' },
            '15': { from: 'D', to: 'Descon' },
            '20': { from: 'DOG', to: 'CG' },
            '25': { from: 'FDC', to: 'CDT' },
            '27': { from: 'FWD', to: 'Avç' },
            '32': { from: 'MET', to: 'Met' },
            '33': { from: 'MCM', to: 'CMM' },
            '36': { from: 'MSE', to: 'SAM' },
            '39': { from: 'MN', to: 'Cbn' },
            '52': { from: 'RAD', to: 'R' },
            '54': { from: 'SEC', to: 'Seg' },
            '63': { from: 'SOF', to: 'Op Esp' },
            '67': { from: 'TA', to: 'BA' },
            '74': { from: 'PLS', to: 'P' },
            '77': { from: 'SPT', to: 'Ap' },
            '79': { from: 'RRC', to: 'Pion' },
            '80': { from: 'TR', to: 'PC' },
            '82': { from: 'JNN', to: 'RTR' }
        },
        graphicAdaptations: {
            '01': {
                type: 'replace',
                find: '<path d="m 105,65 10,0 m -30,0 10,0 M 85,77 c 10,-7 20,-7 30,0" stroke-width="3" stroke="black" fill="none" ></path><path d="m 75.4,60.9 0,9.1 13.1,0 0,-9.1 z m 36,0 0,9.1 13.1,0 0,-9.1 z m -18,0 0,9.1 13.1,0 0,-9.1 z" stroke-width="3" stroke="none" fill="black" ></path>',
                replace: '<path d="M85,55 L100,75 115,55" stroke-width="4" stroke="black" fill="none" ></path>'
            },
            '31': {
                type: 'replace',
                find: '<path d="m 83,70 h 34  m 8,-7 c -10,0 -10,14 0,14  M 75,63 c 10,0 10,14 0,14" stroke-width="3" stroke="black" fill="none" ></path>',
                replace: '<path d="m 84,70 32,0 m 4,-5 c -5,0 -5,10 0,10 M 80,65 c 5,0 5,10 0,10" stroke-width="4" stroke="black" fill="none" ></path>'
            },
            '34': {
                type: 'replace',
                find: '<path d="M 95,78 V 58 c 0,-5 10,-5 10,0 v 20" stroke-width="3" stroke="black" fill="none" ></path>',
                replace: '<path d="M95,80 L95,60 C95,55 105,55 105,60 L105,80 M100,80 L100,55" stroke-width="4" stroke="black" fill="none" ></path>'
            },
            '47': {
                type: 'replace',
                find: '<path d="m 80,65 20,13 20,-13 0,-5 -20,10 -20,-10 z" stroke-width="3" stroke="none" fill="black" ></path>',
                replace: '<text x="100" y="77" text-anchor="middle" font-size="30" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >Nd</text>'
            }
        },
        extensions: {
            '99': {
                1: {
                    type: 'svg',
                    svg: `<g transform="translate(96.6692889798326,51.507999437746555)" ><g transform="scale(0.132064)" ><g transform="translate(-96.6692889798326,-51.507999437746555)" ><path d="M 131.513 194.362 L 131.415 88.863 L 121.847 79.956 L 112.277 89.409 L 112.377 194.323" stroke-width="4" stroke="none" fill="black" ></path><path d="M 133.825 199.361 L 153.515 195.258 L 153.515 216.047 L 133.825 212.491 L 133.825 199.361" stroke-width="4" stroke="none" fill="black" ></path><path d="M 110.149 199.361 L 90.46 195.258 L 90.46 216.047 L 110.149 212.491 L 110.149 199.361" stroke-width="4" stroke="none" fill="black" ></path><path d="M 133.829 195.807 L 110.144 195.807 L 110.144 215.501 L 133.829 215.501 L 133.829 195.807" stroke-width="4" stroke="none" fill="black" ></path><path d="M 110.983 250.139 C 111.136 247.079 112.259 245.32 113.645 245.102 L 130.008 241.268 C 131.579 240.931 132.925 242.823 132.925 245.54 C 132.925 247.238 132.399 249.239 131.621 250.315 Z M 113.645 244.962 L 130.008 241.128 C 131.579 240.749 132.925 238.208 132.925 235.491 C 132.925 232.774 131.579 230.883 130.008 231.219 L 113.645 235.053 C 112.169 235.338 110.824 237.879 110.824 240.597 C 110.824 243.313 112.169 245.205 113.645 244.962 Z M 113.645 234.913 L 130.008 231.079 C 131.579 230.7 132.925 228.16 132.925 225.442 C 132.925 222.725 131.579 220.833 130.008 221.171 L 113.645 225.004 C 112.169 225.289 110.824 227.831 110.824 230.548 C 110.824 233.264 112.169 235.156 113.645 234.913 Z M 113.645 224.864 L 130.008 221.031 C 131.284 220.723 132.412 219.111 132.789 217.014 C 132.877 216.53 133.068 217.39 133.068 216.881 L 111.791 216.815 C 111.053 216.958 112.203 215.928 111.681 216.939 C 111.161 217.949 110.824 219.14 110.824 220.498 C 110.824 223.216 112.169 225.108 113.645 224.864 Z M 130.996 253.491 L 113.324 253.5 L 132.097 253.509 L 134.347 253.544 C 135.839 253.537 137.065 252.819 137.065 251.938 C 137.065 251.057 135.839 250.339 134.347 250.332 L 109.577 250.332 C 108.055 250.339 106.827 251.057 106.827 251.938 C 106.827 252.819 108.055 253.537 109.577 253.544 L 113.224 253.523 C 113.863 257.273 117.559 260.115 122.08 260.115 C 126.603 260.115 130.369 257.211 130.996 253.491" stroke-width="4" stroke="none" fill="black" ></path><path d="M -18.608 63.24 C 17.851 85.68 38.401 97.695 78.174 99.581 C 93.866 99.519 93.992 109.397 89.443 115.965 C 71.765 143.238 90.116 159.362 111.319 161.839 L 111.473 188.053 L 106.347 189.841 L 102.37 185.968 L 92.758 187.756 L 87.455 182.989 L 77.843 185.074 L 72.54 180.01 L 57.293 181.201 L 54.972 173.159 L 39.395 171.968 L 35.086 163.627 L 15.199 165.116 L 5.919 159.456 L 10.228 152.605 L 4.008 152.18 L -4.687 145.158 L -1.042 138.902 L -7.67 138.604 L -13.967 129.668 L -10.654 121.923 L -13.637 121.327 L -20.928 110.007 L -18.608 102.537 L -23.197 101.208 L -27.558 92.432 L -22.254 82.304 L -27.226 74.261 C -24.353 70.587 -21.481 66.914 -18.608 63.24" stroke-width="4" stroke="none" fill="black" ></path><path d="M 262.454 63.24 C 225.996 85.68 205.446 97.695 165.673 99.581 C 149.981 99.519 149.855 109.397 154.404 115.965 C 172.081 143.238 153.731 159.362 132.528 161.839 L 132.373 188.053 L 137.5 189.841 L 141.477 185.968 L 151.089 187.756 L 156.392 182.989 L 166.004 185.074 L 171.307 180.01 L 186.554 181.201 L 188.874 173.159 L 204.452 171.968 L 208.761 163.627 L 228.648 165.116 L 237.928 159.456 L 233.618 152.605 L 239.838 152.18 L 248.534 145.158 L 244.888 138.902 L 251.517 138.604 L 257.814 129.668 L 254.5 121.923 L 257.484 121.327 L 264.776 110.007 L 262.454 102.537 L 267.044 101.208 L 271.404 92.432 L 266.101 82.304 L 271.073 74.261 C 268.2 70.587 265.328 66.914 262.454 63.24" stroke-width="4" stroke="none" fill="black" ></path></g></g></g>`
                },
                2: {
                    type: 'svg',
                    svg: `<g transform="translate(50,15)" ><g transform="scale(0.5)" ><g transform="translate(50,50)" ><g transform="scale(0.5)" ><path d="M 100,145 100,65" stroke-width="4" stroke="black" fill="none" ></path><path d="m 70,70 60,0" stroke-width="4" stroke="black" fill="none" ></path><path d="m 57.8,105.5 c -2.2,0.1 1.3,20.6 2.8,22.1 0.8,0.8 3.5,-3.8 4.6,-2.6 17.4,20.2 33,19.7 34.7,19.6 0,0 0.2,-0 0.3,0 1.7,0.1 17.3,0.5 34.7,-19.6 1,-1.2 3.7,3.4 4.6,2.6 1.4,-1.5 4.9,-21.9 2.8,-22.1 -2.2,-0.1 -4,4.2 -6.7,6.4 -3,2.4 -7.5,3.4 -7.7,4.5 -0.1,0.8 4.9,3.5 3.9,4.9 -5.1,6.3 -15.1,16.6 -31.3,17 l -0.3,4.3 -0.3,-4.3 c -16.2,-0.4 -26.3,-10.7 -31.3,-17 -1.1,-1.3 4,-4.1 3.9,-4.9 -0.2,-1 -4.7,-2 -7.7,-4.5 -2.7,-2.3 -4.5,-6.6 -6.7,-6.4 z" stroke-width="4" stroke="none" fill="black" ></path><circle cx="100" cy="60" r="5" stroke-width="4" stroke="black" fill="none" ></circle></g></g><g transform="scale(2.2)" ><g transform="translate(-54.7,-22)" ><g transform="translate(89.166527,53.75285)" ><g transform="scale(0.002856)" ><path d="M500.83 2885.5l-76.66 116.35 147.66 55.95 8.66 -149.46c-3.01,-66.7 -29.56,-74.33 -79.66,-22.85z" stroke-width="4" stroke="none" fill="black" ></path><path d="M5166.86 5203.93c33.57,76.38 18.4,127.85 -42.24,195.32 90.8,2.75 137.6,-25.92 172.5,-123.66 -43.78,-34.75 -87.2,-58.64 -130.26,-71.66z" stroke-width="4" stroke="none" fill="black" ></path><path d="M349.13 2973.46c-55.91,46.06 -53.73,104.58 -11.83,171.64l4572.77 1773.13 -3297.69 -1278.72c-12.98,85.74 32.73,153.73 113.92,210.09l2912.55 1245.68c153.37,501.54 509.66,628.22 879.03,454.12 78.56,147.83 142.62,295.68 192.15,443.54l1562.63 830.38c75.54,-332.1 214.99,-648.26 431.58,-945.06l-1769.13 -511.86c-163.14,-72.61 -137.63,-307.88 -388.71,-235.31 -53.45,15.4 -93.57,28.68 -147.19,-7.39 -75.61,-50.89 -94.23,-142.88 -64.51,-261.9l-4985.56 -1888.33zm5100.53 2483.42c-289.69,101.16 -495.28,31.2 -570.16,-257.51 234.42,-60.67 432.86,22.8 570.16,257.51z" stroke-width="4" stroke="none" fill="black" ></path><path d="M1965.9 3585.83c-11.82,-30.55 -52.34,-45.9 -108.31,-41.02 -80.27,82.09 -115.13,188.23 -101.31,317.6 37.82,38.56 92.68,62.02 124.62,53.3 -30.63,-140.89 6.09,-246.82 85,-329.88z" stroke-width="4" stroke="none" fill="black" ></path><path d="M647.83 3086.59c-46.26,37.32 -63.78,91.7 -56.7,156.93" stroke-width="4" stroke="none" fill="black" ></path><path d="M7203.4 2885.38l76.66 116.35 -147.66 55.94 -8.66 -149.45c3.02,-66.71 29.57,-74.34 79.66,-22.85z" stroke-width="4" stroke="none" fill="black" ></path><path d="M2537.37 5203.82c-33.56,76.37 -18.39,127.85 42.25,195.31 -90.8,2.76 -137.6,-25.92 -172.5,-123.66 43.78,-34.75 87.2,-58.64 130.25,-71.65z" stroke-width="4" stroke="none" fill="black" ></path><path d="M7355.09 2973.34c55.92,46.06 53.74,104.58 11.84,171.64l-4572.77 1773.13 3297.69 -1278.73c12.97,85.74 -32.73,153.74 -113.93,210.1l-2912.54 1245.67c-153.37,501.55 -509.66,628.23 -879.03,454.13 -78.56,147.83 -142.62,295.68 -192.15,443.54l-1562.64 830.39c-75.53,-332.1 -214.98,-648.26 -431.57,-945.06l1769.13 -511.87c163.13,-72.61 137.63,-307.87 388.7,-235.31 53.45,15.4 93.58,28.67 147.2,-7.4 75.6,-50.88 94.23,-142.87 64.51,-261.9l4985.56 -1888.33zm-5100.52 2483.42c289.69,101.15 495.28,31.2 570.16,-257.51 -234.42,-60.68 -432.86,22.8 -570.16,257.51z" stroke-width="4" stroke="none" fill="black" ></path><path d="M5738.34 3585.72c11.82,-30.55 52.34,-45.9 108.31,-41.03 80.26,82.09 115.13,188.23 101.3,317.6 -37.82,38.56 -92.67,62.02 -124.61,53.3 30.63,-140.89 -6.09,-246.81 -85,-329.87z" stroke-width="4" stroke="none" fill="black" ></path><path d="M7056.39 3086.46c46.27,37.33 63.78,91.71 56.71,156.93" stroke-width="4" stroke="none" fill="black" ></path></g></g></g></g></g></g>`
                },
                3: {
                    type: 'text',
                    position: { x: 100, y: 77 },
                    text: 'Es',
                    style: { fontSize: '30', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', fill: 'black' }
                },
                4: {
                    type: 'text',
                    position: { x: 100, y: 77 },
                    text: 'Gd',
                    style: { fontSize: '30', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', fill: 'black' }
                },
                5: {
                    type: 'text',
                    position: { x: 100, y: 77 },
                    text: 'GE',
                    style: { fontSize: '30', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', fill: 'black' }
                },
                6: {
                    type: 'text',
                    position: { x: 100, y: 77 },
                    text: 'EG',
                    style: { fontSize: '30', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', fill: 'black' }
                },
                7: {
                    type: 'text',
                    position: { x: 100, y: 77 },
                    text: 'RA',
                    style: { fontSize: '30', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', fill: 'black' }
                },
                8: {
                    type: 'text',
                    position: { x: 100, y: 77 },
                    text: 'AAAe',
                    style: { fontSize: '22', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', fill: 'black' }
                },
                9: {
                    type: 'svg',
                    svg: '<path d="m 75,60 0,15 50,-15 0,15 z" stroke-width="4" stroke="black" fill="black" ></path>'
                },
                10: {
                    type: 'text',
                    position: { x: 100, y: 77 },
                    text: 'Armt',
                    style: { fontSize: '22', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', fill: 'black' }
                },
                11: {
                    type: 'svg',
                    svg: '<g transform="translate(50,20)" ><g transform="scale(0.5)" ><path d="M100,80 l0,40 M81,90.5 l38,19 M81,109.5 l38,-19" stroke-width="4" stroke="black" fill="none" ></path><circle cx="100" cy="100" r="20" stroke-width="4" stroke="black" fill="none" ></circle></g></g>'
                },
                12: {
                    type: 'text',
                    position: { x: 100, y: 77 },
                    text: 'Cj',
                    style: { fontSize: '30', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', fill: 'black' }
                },
                13: {
                    type: 'text',
                    position: { x: 100, y: 77 },
                    text: 'Rec Vig',
                    style: { fontSize: '22', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', fill: 'black' }
                },
                14: {
                    type: 'text',
                    position: { x: 100, y: 77 },
                    text: 'Rec',
                    style: { fontSize: '25', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', fill: 'black' }
                },
                15: {
                    type: 'text',
                    position: { x: 100, y: 77 },
                    text: 'Mun',
                    style: { fontSize: '25', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', fill: 'black' }
                },
                16: {
                    type: 'text',
                    position: { x: 100, y: 77 },
                    text: ' Rcd',
                    style: { fontSize: '22', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', fill: 'black' }
                }
            }
        }
    },
    modifier2: {
        labelMappings: {
            '06': { from: 'CLR', to: 'Dobst' },
            '09': { from: 'D', to: 'Descon', fontSize: '20' },
            '10': { from: 'DEM', to: 'Dml' },
            '15': { from: 'H', to: 'P' },
            '16': { from: 'HA', to: 'G' },
            '20': { from: 'LAB', to: 'Lab' },
            '23': { from: 'LA', to: 'Bx' },
            '24': { from: 'M', to: 'Me' },
            '25': { from: 'MA', to: 'Me' },
            '29': { from: 'MC', to: 'MCn' },
            '45': { from: 'SPT', to: 'Ap' },
            '49': { from: 'VTOL', to: 'VSTOL', fontSize: '20' },
            '55': { from: 'K', to: 'Rabst', fontSize: '20' }
        },
        graphicAdaptations: {
            '05': {
                type: 'replace',
                find: '<text x="122" y="133" text-anchor="middle" font-size="18" font-family="Arial" font-weight="bold" dominant-baseline="middle" stroke-width="3" stroke="none" fill="black" >CS</text>',
                replace: '<text x="100" y="140" text-anchor="middle" font-size="25" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >Trg</text>'
            },
            '27': {
                type: 'replace',
                find: '<path d="m 87,142 10,-20 5,10 3,-5 8,15" stroke-width="3" stroke="none" fill="black" ></path>',
                replace: '<path d="M90,140 L100,120 110,140" stroke-width="4" stroke="none" fill="black" ></path>'
            },
            '32': {
                type: 'replace',
                find: '<text x="122" y="135" text-anchor="middle" font-size="16" font-family="Arial" font-weight="bold" stroke-width="3" stroke="none" fill="black" >PEC</text>',
                replace: '<text x="100" y="145" text-anchor="middle" font-size="30" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >Ev</text>'
            },
            '39': {
                type: 'replace',
                find: '<text x="122" y="132" text-anchor="middle" font-size="16" font-family="Arial" font-weight="bold" dominant-baseline="middle" stroke-width="3" stroke="none" fill="black" >RCC</text>',
                replace: '<text x="100" y="140" text-anchor="middle" font-size="25" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >RCC</text>'
            }
        },
        extensions: {
            '99': {
                1: {
                    type: 'svg',
                    svg: `<g transform="translate(0,70)" ><g transform="translate(96.6692889798326,51.507999437746555)" ><g transform="scale(0.132064)" ><g transform="translate(-96.6692889798326,-51.507999437746555)" ><path d="M 131.513 194.362 L 131.415 88.863 L 121.847 79.956 L 112.277 89.409 L 112.377 194.323" stroke-width="4" stroke="none" fill="black" ></path><path d="M 133.825 199.361 L 153.515 195.258 L 153.515 216.047 L 133.825 212.491 L 133.825 199.361" stroke-width="4" stroke="none" fill="black" ></path><path d="M 110.149 199.361 L 90.46 195.258 L 90.46 216.047 L 110.149 212.491 L 110.149 199.361" stroke-width="4" stroke="none" fill="black" ></path><path d="M 133.829 195.807 L 110.144 195.807 L 110.144 215.501 L 133.829 215.501 L 133.829 195.807" stroke-width="4" stroke="none" fill="black" ></path><path d="M 110.983 250.139 C 111.136 247.079 112.259 245.32 113.645 245.102 L 130.008 241.268 C 131.579 240.931 132.925 242.823 132.925 245.54 C 132.925 247.238 132.399 249.239 131.621 250.315 Z M 113.645 244.962 L 130.008 241.128 C 131.579 240.749 132.925 238.208 132.925 235.491 C 132.925 232.774 131.579 230.883 130.008 231.219 L 113.645 235.053 C 112.169 235.338 110.824 237.879 110.824 240.597 C 110.824 243.313 112.169 245.205 113.645 244.962 Z M 113.645 234.913 L 130.008 231.079 C 131.579 230.7 132.925 228.16 132.925 225.442 C 132.925 222.725 131.579 220.833 130.008 221.171 L 113.645 225.004 C 112.169 225.289 110.824 227.831 110.824 230.548 C 110.824 233.264 112.169 235.156 113.645 234.913 Z M 113.645 224.864 L 130.008 221.031 C 131.284 220.723 132.412 219.111 132.789 217.014 C 132.877 216.53 133.068 217.39 133.068 216.881 L 111.791 216.815 C 111.053 216.958 112.203 215.928 111.681 216.939 C 111.161 217.949 110.824 219.14 110.824 220.498 C 110.824 223.216 112.169 225.108 113.645 224.864 Z M 130.996 253.491 L 113.324 253.5 L 132.097 253.509 L 134.347 253.544 C 135.839 253.537 137.065 252.819 137.065 251.938 C 137.065 251.057 135.839 250.339 134.347 250.332 L 109.577 250.332 C 108.055 250.339 106.827 251.057 106.827 251.938 C 106.827 252.819 108.055 253.537 109.577 253.544 L 113.224 253.523 C 113.863 257.273 117.559 260.115 122.08 260.115 C 126.603 260.115 130.369 257.211 130.996 253.491" stroke-width="4" stroke="none" fill="black" ></path><path d="M -18.608 63.24 C 17.851 85.68 38.401 97.695 78.174 99.581 C 93.866 99.519 93.992 109.397 89.443 115.965 C 71.765 143.238 90.116 159.362 111.319 161.839 L 111.473 188.053 L 106.347 189.841 L 102.37 185.968 L 92.758 187.756 L 87.455 182.989 L 77.843 185.074 L 72.54 180.01 L 57.293 181.201 L 54.972 173.159 L 39.395 171.968 L 35.086 163.627 L 15.199 165.116 L 5.919 159.456 L 10.228 152.605 L 4.008 152.18 L -4.687 145.158 L -1.042 138.902 L -7.67 138.604 L -13.967 129.668 L -10.654 121.923 L -13.637 121.327 L -20.928 110.007 L -18.608 102.537 L -23.197 101.208 L -27.558 92.432 L -22.254 82.304 L -27.226 74.261 C -24.353 70.587 -21.481 66.914 -18.608 63.24" stroke-width="4" stroke="none" fill="black" ></path><path d="M 262.454 63.24 C 225.996 85.68 205.446 97.695 165.673 99.581 C 149.981 99.519 149.855 109.397 154.404 115.965 C 172.081 143.238 153.731 159.362 132.528 161.839 L 132.373 188.053 L 137.5 189.841 L 141.477 185.968 L 151.089 187.756 L 156.392 182.989 L 166.004 185.074 L 171.307 180.01 L 186.554 181.201 L 188.874 173.159 L 204.452 171.968 L 208.761 163.627 L 228.648 165.116 L 237.928 159.456 L 233.618 152.605 L 239.838 152.18 L 248.534 145.158 L 244.888 138.902 L 251.517 138.604 L 257.814 129.668 L 254.5 121.923 L 257.484 121.327 L 264.776 110.007 L 262.454 102.537 L 267.044 101.208 L 271.404 92.432 L 266.101 82.304 L 271.073 74.261 C 268.2 70.587 265.328 66.914 262.454 63.24" stroke-width="4" stroke="none" fill="black" ></path></g></g></g></g>`
                },
                2: {
                    type: 'svg',
                    svg: `<g transform="translate(50,85)" ><g transform="scale(0.5)" ><g transform="translate(50,50)" ><g transform="scale(0.5)" ><path d="M 100,145 100,65" stroke-width="4" stroke="black" fill="none" ></path><path d="m 70,70 60,0" stroke-width="4" stroke="black" fill="none" ></path><path d="m 57.8,105.5 c -2.2,0.1 1.3,20.6 2.8,22.1 0.8,0.8 3.5,-3.8 4.6,-2.6 17.4,20.2 33,19.7 34.7,19.6 0,0 0.2,-0 0.3,0 1.7,0.1 17.3,0.5 34.7,-19.6 1,-1.2 3.7,3.4 4.6,2.6 1.4,-1.5 4.9,-21.9 2.8,-22.1 -2.2,-0.1 -4,4.2 -6.7,6.4 -3,2.4 -7.5,3.4 -7.7,4.5 -0.1,0.8 4.9,3.5 3.9,4.9 -5.1,6.3 -15.1,16.6 -31.3,17 l -0.3,4.3 -0.3,-4.3 c -16.2,-0.4 -26.3,-10.7 -31.3,-17 -1.1,-1.3 4,-4.1 3.9,-4.9 -0.2,-1 -4.7,-2 -7.7,-4.5 -2.7,-2.3 -4.5,-6.6 -6.7,-6.4 z" stroke-width="4" stroke="none" fill="black" ></path><circle cx="100" cy="60" r="5" stroke-width="4" stroke="black" fill="none" ></circle></g></g><g transform="scale(2.2)" ><g transform="translate(-54.7,-22)" ><g transform="translate(89.166527,53.75285)" ><g transform="scale(0.002856)" ><path d="M500.83 2885.5l-76.66 116.35 147.66 55.95 8.66 -149.46c-3.01,-66.7 -29.56,-74.33 -79.66,-22.85z" stroke-width="4" stroke="none" fill="black" ></path><path d="M5166.86 5203.93c33.57,76.38 18.4,127.85 -42.24,195.32 90.8,2.75 137.6,-25.92 172.5,-123.66 -43.78,-34.75 -87.2,-58.64 -130.26,-71.66z" stroke-width="4" stroke="none" fill="black" ></path><path d="M349.13 2973.46c-55.91,46.06 -53.73,104.58 -11.83,171.64l4572.77 1773.13 -3297.69 -1278.72c-12.98,85.74 32.73,153.73 113.92,210.09l2912.55 1245.68c153.37,501.54 509.66,628.22 879.03,454.12 78.56,147.83 142.62,295.68 192.15,443.54l1562.63 830.38c75.54,-332.1 214.99,-648.26 431.58,-945.06l-1769.13 -511.86c-163.14,-72.61 -137.63,-307.88 -388.71,-235.31 -53.45,15.4 -93.57,28.68 -147.19,-7.39 -75.61,-50.89 -94.23,-142.88 -64.51,-261.9l-4985.56 -1888.33zm5100.53 2483.42c-289.69,101.16 -495.28,31.2 -570.16,-257.51 234.42,-60.67 432.86,22.8 570.16,257.51z" stroke-width="4" stroke="none" fill="black" ></path><path d="M1965.9 3585.83c-11.82,-30.55 -52.34,-45.9 -108.31,-41.02 -80.27,82.09 -115.13,188.23 -101.31,317.6 37.82,38.56 92.68,62.02 124.62,53.3 -30.63,-140.89 6.09,-246.82 85,-329.88z" stroke-width="4" stroke="none" fill="black" ></path><path d="M647.83 3086.59c-46.26,37.32 -63.78,91.7 -56.7,156.93" stroke-width="4" stroke="none" fill="black" ></path><path d="M7203.4 2885.38l76.66 116.35 -147.66 55.94 -8.66 -149.45c3.02,-66.71 29.57,-74.34 79.66,-22.85z" stroke-width="4" stroke="none" fill="black" ></path><path d="M2537.37 5203.82c-33.56,76.37 -18.39,127.85 42.25,195.31 -90.8,2.76 -137.6,-25.92 -172.5,-123.66 43.78,-34.75 87.2,-58.64 130.25,-71.65z" stroke-width="4" stroke="none" fill="black" ></path><path d="M7355.09 2973.34c55.92,46.06 53.74,104.58 11.84,171.64l-4572.77 1773.13 3297.69 -1278.73c12.97,85.74 -32.73,153.74 -113.93,210.1l-2912.54 1245.67c-153.37,501.55 -509.66,628.23 -879.03,454.13 -78.56,147.83 -142.62,295.68 -192.15,443.54l-1562.64 830.39c-75.53,-332.1 -214.98,-648.26 -431.57,-945.06l1769.13 -511.87c163.13,-72.61 137.63,-307.87 388.7,-235.31 53.45,15.4 93.58,28.67 147.2,-7.4 75.6,-50.88 94.23,-142.87 64.51,-261.9l4985.56 -1888.33zm-5100.52 2483.42c289.69,101.15 495.28,31.2 570.16,-257.51 -234.42,-60.68 -432.86,22.8 -570.16,257.51z" stroke-width="4" stroke="none" fill="black" ></path><path d="M5738.34 3585.72c11.82,-30.55 52.34,-45.9 108.31,-41.03 80.26,82.09 115.13,188.23 101.3,317.6 -37.82,38.56 -92.67,62.02 -124.61,53.3 30.63,-140.89 -6.09,-246.81 -85,-329.87z" stroke-width="4" stroke="none" fill="black" ></path><path d="M7056.39 3086.46c46.27,37.33 63.78,91.71 56.71,156.93" stroke-width="4" stroke="none" fill="black" ></path></g></g></g></g></g></g>`
                },
                3: {
                    type: 'svg',
                    svg: '<path d="m 102.56156,143.71255 3.02817,1.50669 v 2.02272 H 94.430924 v -2.00389 l 3.02817,-1.50668 0.02271,-5.02103 v -3.56331 h 4.996486 z" stroke-width="4" stroke="none" fill="black" ></path><path d="m 99.839992,137.48995 a 4.7958641,4.7724227 0 0 1 -1.230194,1.92855 c -1.453521,1.37485 -3.588381,1.55566 -5.216022,1.06598 -0.427729,-0.1243 -2.835124,-0.90024 -3.637589,-3.36367 a 5.1592445,5.134027 0 0 1 1.400528,-5.29976 5.6361813,5.6086325 0 0 1 3.251498,-1.31082 c 0.162764,0 0.321743,0 0.321743,0 q 0.151408,0 0.272535,0 a 2.1764971,2.1658588 0 0 1 -0.317958,-0.51604 2.3089796,2.2976936 0 0 1 -0.177905,-0.66294 3.6603004,3.6424094 0 0 1 0.124912,-1.42005 5.8784349,5.849702 0 0 1 2.838909,-3.51811 5.2992974,5.2733953 0 0 1 2.539881,-0.4859 5.4734171,5.446664 0 0 1 3.16822,1.26561 c 1.13556,0.96428 2.35062,2.77984 1.89261,4.44849 a 2.8124128,2.7986662 0 0 1 -0.27632,0.66671 c 0.0833,0 0.20818,0 0.35959,-0.0226 a 6.0071321,5.9777702 0 0 1 2.27113,0.42563 5.2122375,5.1867609 0 0 1 2.72157,2.89661 c 0.11355,0.30133 0.88195,2.44836 -0.37853,4.47861 a 5.25766,5.2319614 0 0 1 -3.50132,2.26003 c -0.24225,0.049 -2.67236,0.48214 -4.62931,-1.13001 a 5.3863572,5.3600296 0 0 1 -1.3324,-1.67619 z" stroke-width="4" stroke="none" fill="true" ></path>'
                },
                4: {
                    type: 'text',
                    position: { x: 100, y: 140 },
                    text: 'Anf',
                    style: { fontSize: '25', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', fill: 'black' }
                },
                6: {
                    type: 'text',
                    position: { x: 100, y: 145 },
                    text: 'PM',
                    style: { fontSize: '30', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', fill: 'black' }
                },
                7: {
                    type: 'text',
                    position: { x: 100, y: 145 },
                    text: 'PC',
                    style: { fontSize: '30', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', fill: 'black' }
                },
                8: {
                    type: 'text',
                    position: { x: 100, y: 145 },
                    text: 'PF',
                    style: { fontSize: '30', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', fill: 'black' }
                },
                9: {
                    type: 'text',
                    position: { x: 100, y: 140 },
                    text: 'PRF',
                    style: { fontSize: '25', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', fill: 'black' }
                },
                10: {
                    type: 'text',
                    position: { x: 100, y: 135 },
                    text: 'FNSP',
                    style: { fontSize: '20', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', fill: 'black' }
                },
                11: {
                    type: 'text',
                    position: { x: 100, y: 145 },
                    text: 'GM',
                    style: { fontSize: '30', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', fill: 'black' }
                },
                12: {
                    type: 'text',
                    position: { x: 100, y: 145 },
                    text: 'CC',
                    style: { fontSize: '30', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', fill: 'black' }
                }
            }
        }
    },
        specialModifiers: {
        1: { // Blindado
            type: 'svg',
            svg: '<path d="M125,80 C150,80 150,120 125,120 L75,120 C50,120 50,80 75,80 Z" stroke-width="4" stroke="black" fill="none"></path>'
        },
        2: { // Motorizado
            type: 'svg',
            svg: '<path d="M100,50L100,150" stroke-width="4" stroke="black" fill="black"></path>'
        },
        3: { // Mecanizado
            type: 'svg',
            svg: `<path d="M125,80 C150,80 150,120 125,120 L75,120 C50,120 50,80 75,80 Z" stroke-width="4" stroke="black" fill="none"></path>
                <circle cx="70" cy="125" r="5" stroke-width="4" stroke="black" fill="none"></circle>
                <circle cx="100" cy="125" r="5" stroke-width="4" stroke="black" fill="none"></circle>
                <circle cx="130" cy="125" r="5" stroke-width="4" stroke="black" fill="none"></circle>`
        },
        4: { // Defesa Aérea
            type: 'svg',
            svg: '<path d="M25,150 C45,110 155,110 175,150" stroke-width="4" stroke="black" fill="none"></path>'
        }
    },
};

/**
 * Symbol Set 15: Equipamentos e Viaturas (Equipment and Vehicles)
 */
const SYMBOL_SET_15_CATALOG = {
    mainIcon: {
        labelMappings: {},
        graphicAdaptations: {
            '110300': {
                type: 'replace',
                find: '<circle cx="100" cy="90" r="10" stroke-width="3" stroke="black" fill="none" ></circle>',
                replace: '<circle cx="100" cy="90" r="15" stroke-width="3" stroke="black" fill="none" ></circle>'
            },
            '110900': {
                type: 'replace',
                find: '<path d="m 115,80 0,40 m -30,-40 0,40 m 15,-60 0,60" stroke-width="3" stroke="black" fill="none" ></path>',
                replace: '<path d="m 85,75 15,-15 15,15 m 0,5 0,40 m -30,-40 0,40 m 15,-60 0,60" stroke-width="3" stroke="black" fill="none" ></path>'
            },
            '110901': {
                type: 'replace',
                find: '<path d="m 115,80 0,40 m -30,-40 0,40 m 15,-60 0,60" stroke-width="3" stroke="black" fill="none" ></path>',
                replace: '<path d="m 85,75 15,-15 15,15 m 0,5 0,40 m -30,-40 0,40 m 15,-60 0,60" stroke-width="3" stroke="black" fill="none" ></path>'
            },
            '110902': {
                type: 'replace',
                find: '<path d="m 115,80 0,40 m -30,-40 0,40 m 15,-60 0,60" stroke-width="3" stroke="black" fill="none" ></path>',
                replace: '<path d="m 85,75 15,-15 15,15 m 0,5 0,40 m -30,-40 0,40 m 15,-60 0,60" stroke-width="3" stroke="black" fill="none" ></path>'
            },
            '110903': {
                type: 'replace',
                find: '<path d="m 115,80 0,40 m -30,-40 0,40 m 15,-60 0,60" stroke-width="3" stroke="black" fill="none" ></path>',
                replace: '<path d="m 85,75 15,-15 15,15 m 0,5 0,40 m -30,-40 0,40 m 15,-60 0,60" stroke-width="3" stroke="black" fill="none" ></path>'
            },
            '111300': {
                type: 'replace',
                find: '<g transform="translate(0,0)" ><g transform="scale(1)" ><path d="m 100,140 0,-80 m -15,80 0,-65 c 0,-20 30,-20 30,0 l 0,65" stroke-width="3" stroke="black" fill="none" ></path><path d="m 85,140 30,0" stroke-width="3" stroke="black" fill="none" ></path></g></g>',
                replace: '<path d="m 100,140 0,-80 m -15,80 0,-65 c 0,-20 30,-20 30,0 l 0,65" stroke-width="4" stroke="black" fill="none" ></path>'
            },
            '140500': {
                type: 'replace',
                find: '<g transform="translate(0,0)" ><g transform="scale(1)" ><path d="m 70,65 c 0,15 60,15 60,0 l 0,65 -60,0 z" stroke-width="3" stroke="black" fill="none" ></path><text x="100" y="103" text-anchor="middle" font-size="45" font-family="Arial" font-weight="bold" dominant-baseline="middle" stroke-width="3" stroke="none" fill="black" >B</text></g></g>',
                replace: '<text x="100" y="115" text-anchor="middle" font-size="42" font-family="Arial" font-weight="bold" stroke-width="4" stroke="none" fill="black" >On</text><path d="m 70,65 c 0,15 60,15 60,0 l 0,65 -60,0 z" stroke-width="4" stroke="black" fill="none" ></path>'
            },
            '220100': {
                type: 'replace',
                find: '<g transform="translate(0,0)" ><g transform="scale(1)" >',
                replace: '<g transform="translate(15,30)" ><g transform="scale(0.85)" >'
            },
        },
        extensions: {
            '209900': {
                0: {
                    type: 'svg',
                    svg: '<path d="M 52,66.8 100,110 l 0,-20 47.9,43.1" stroke-width="4" stroke="black" fill="none" ></path>'
                }
            },
            '209901': {
                0: {
                    type: 'svg',
                    svg: '<circle cx="100" cy="130" r="10" stroke-width="4" stroke="black" fill="none" ></circle><path d="M100,120 l0,-60 M70,70 l10,-10 10,10 10,-10 10,10 10,-10 10,10" stroke-width="4" stroke="black" fill="none" ></path>'
                }
            },
            '209902': {
                0: {
                    type: 'svg',
                    svg: '<path d="m 80,60 20,20 20,-20 m -20,0 0,80" stroke-width="4" stroke="black" fill="none" ></path><path d="M70,85 l40,0 10,-10 0,50 -10,-10 -40,0 z M120,85 l10,0 M120,95 l10,0 M120,105 l10,0 M120,115 l10,0" stroke-width="4" stroke="black" fill="black" ></path>'
                }
            },
            '209903': {
                0: {
                    type: 'svg',
                    svg: '<circle cx="100" cy="130" r="10" stroke-width="4" stroke="black" fill="none" ></circle><path d="M100,120 l-15,-40 15,0 0,-20 M70,60 l60,0" stroke-width="4" stroke="black" fill="none" ></path>'
                }
            },
            '209904': {
                0: {
                    type: 'svg',
                    svg: '<path d="M100,140 l0,-80  M70,60 l60,0 M80,70 l40,0" stroke-width="4" stroke="black" fill="none" ></path>'
                }
            },
            '209905': {
                0: {
                    type: 'text',
                    text: 'MCn',
                    position: { x: 100, y: 110 },
                    style: { fontSize: '35', fontWeight: 'bold', fill: 'black' }
                }
            },
            '229900': {
                0: {
                    type: 'text',
                    text: 'GE',
                    position: { x: 100, y: 115 },
                    style: { fontSize: '42', fontWeight: 'bold', fill: 'black' }
                }
            },
            '229901': {
                0: {
                    type: 'svg',
                    svg: '<path d="M120,130 c-40,20 -80,-45 -40,-70 z M100,95 L140,75" stroke-width="4" stroke="black" fill="none" ></path>'
                }
            },
            '229902': {
                0: {
                    type: 'text',
                    text: 'GE',
                    position: { x: 100, y: 115 },
                    style: { fontSize: '42', fontWeight: 'bold', fill: 'black' }
                }
            },
            '229903': {
                0: {
                    type: 'text',
                    text: 'GE',
                    position: { x: 100, y: 115 },
                    style: { fontSize: '42', fontWeight: 'bold', fill: 'black' }
                }
            },
            '229904': {
                0: {
                    type: 'text',
                    text: 'GE',
                    position: { x: 100, y: 115 },
                    style: { fontSize: '42', fontWeight: 'bold', fill: 'black' }
                }
            }
        }
    },
    modifier1: {
        labelMappings: {
            '02': { from: 'C', to: 'Q' },
            '03': { from: 'EWR', to: 'Vig' }
        },
        graphicAdaptations: {},
        extensions: {
            '99': {
                1: {
                    type: 'text',
                    position: { x: 100, y: 77 },
                    text: 'Met',
                    style: { fontSize: '25', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', fill: 'black' }
                },
                2: {
                    type: 'text',
                    position: { x: 100, y: 77 },
                    text: 'Bsc',
                    style: { fontSize: '25', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', fill: 'black' }
                },
                4: {
                    type: 'text',
                    position: { x: 100, y: 77 },
                    text: 'DT',
                    style: { fontSize: '30', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', fill: 'black' }
                },
                5: {
                    type: 'text',
                    position: { x: 100, y: 77 },
                    text: 'VT',
                    style: { fontSize: '30', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', fill: 'black' }
                },
                6: {
                    type: 'text',
                    position: { x: 100, y: 77 },
                    text: 'RN',
                    style: { fontSize: '30', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', fill: 'black' }
                },
                7: {
                    type: 'svg',
                    svg: '<path d="m 120,65 -11,0 m 11,10 -14,0 m 4,-14 -30,0 0,18 25,0 z m 10,2 0,14" stroke-width="4" stroke="black" fill="none" ></path>'
                },
                8: {
                    type: 'text',
                    position: { x: 100, y: 77 },
                    text: 'Rec',
                    style: { fontSize: '25', fontFamily: 'Arial, sans-serif', fontWeight: 'bold', fill: 'black' }
                }
            }
        }
    },
    modifier2: {
        labelMappings: {},
        graphicAdaptations: {},
        extensions: {}
    },
    specialModifiers: {
        1: { // Blindado (apenas esta opção para Equipamentos)
            type: 'svg',
            svg: '<path d="M125,80 C150,80 150,120 125,120 L75,120 C50,120 50,80 75,80 Z" stroke-width="4" stroke="black" fill="none"></path>'
        }
    },

    // Command element NOT supported for equipment
    supportsCommand: false
};

/**
 * Symbol Set Registry
 * Maps symbol set code to its catalog
 */
const SYMBOL_SET_CATALOGS = {
    '10': SYMBOL_SET_10_CATALOG,
    '15': SYMBOL_SET_15_CATALOG
};

/**
 * ========================================
 * PUBLIC API
 * ========================================
 */

/**
 * Get catalog entry with bi-dimensional extension support
 *
 * @param {string} symbolSet - Symbol set code (e.g., "10", "15")
 * @param {string} elementType - Element type: "mainIcon", "modifier1", "modifier2"
 * @param {string} modificationType - Modification type: "labelMappings", "graphicAdaptations", "extensions"
 * @param {string} codeBase - Base code (e.g., "121899", "99")
 * @param {number} [extensionNumber=null] - Extension number (0-31), required for "extensions" type
 * @returns {Object|null} Catalog entry or null if not found
 *
 * @example
 * // Get extension for main icon
 * const ext = getCatalogEntry('10', 'mainIcon', 'extensions', '121899', 1);
 * // Returns: { type: 'text', text: 'Prec', position: {...}, style: {...} }
 *
 * @example
 * // Get label mapping
 * const label = getCatalogEntry('10', 'mainIcon', 'labelMappings', '121800');
 * // Returns: { from: 'SOF', to: 'Op Esp' }
 *
 * @example
 * // Get graphic adaptation
 * const graphic = getCatalogEntry('10', 'mainIcon', 'graphicAdaptations', '120400');
 * // Returns: { type: 'replace', find: '...', replace: '...' }
 */
export function getCatalogEntry(symbolSet, elementType, modificationType, codeBase, extensionNumber = null) {
    // Validate symbol set
    const catalog = SYMBOL_SET_CATALOGS[symbolSet];
    if (!catalog) {
        console.warn(`Symbol set ${symbolSet} not found in catalog`);
        return null;
    }

    // Validate element type
    if (!catalog[elementType]) {
        console.warn(`Element type ${elementType} not found for symbol set ${symbolSet}`);
        return null;
    }

    // Validate modification type
    const modifications = catalog[elementType][modificationType];
    if (!modifications) {
        console.warn(`Modification type ${modificationType} not found for ${symbolSet}/${elementType}`);
        return null;
    }

    // Handle extensions (bi-dimensional)
    if (modificationType === 'extensions') {
        if (extensionNumber === null || extensionNumber === undefined) {
            return null;
        }

        const codeExtensions = modifications[codeBase];
        if (!codeExtensions) {
            // No extensions for this code base
            return null;
        }

        return codeExtensions[String(extensionNumber)] || null;
    }

    // Handle labelMappings and graphicAdaptations (single-dimensional)
    return modifications[codeBase] || null;
}

/**
 * Get entire catalog for a symbol set
 *
 * @param {string} symbolSet - Symbol set code (e.g., "10", "15")
 * @returns {Object|null} Catalog object or null if not found
 *
 * @example
 * const catalog = getSymbolSetCatalog('10');
 * // Returns: { mainIcon: {...}, modifier1: {...}, modifier2: {...} }
 */
export function getSymbolSetCatalog(symbolSet) {
    return SYMBOL_SET_CATALOGS[symbolSet] || null;
}

/**
 * Check if a code base has extensions in the catalog
 *
 * @param {string} symbolSet - Symbol set code
 * @param {string} elementType - Element type
 * @param {string} codeBase - Base code
 * @returns {boolean} True if extensions exist
 */
export function hasExtensions(symbolSet, elementType, codeBase) {
    const catalog = SYMBOL_SET_CATALOGS[symbolSet];
    if (!catalog || !catalog[elementType]) {
        return false;
    }

    const extensions = catalog[elementType].extensions;
    return extensions && extensions[codeBase] !== undefined;
}

/**
 * Get all extension numbers for a code base
 *
 * @param {string} symbolSet - Symbol set code
 * @param {string} elementType - Element type
 * @param {string} codeBase - Base code
 * @returns {Array<number>} Array of extension numbers
 */
export function getExtensionNumbers(symbolSet, elementType, codeBase) {
    const catalog = SYMBOL_SET_CATALOGS[symbolSet];
    if (!catalog || !catalog[elementType]) {
        return [];
    }

    const extensions = catalog[elementType].extensions;
    if (!extensions || !extensions[codeBase]) {
        return [];
    }

    return Object.keys(extensions[codeBase]).map(Number);
}

/**
 * Get list of all available symbol sets
 *
 * @returns {Array<string>} Array of symbol set codes
 */
export function getAvailableSymbolSets() {
    return Object.keys(SYMBOL_SET_CATALOGS);
}

/**
 * ========================================
 * NEW FUNCTIONS - Missing Exports
 * ========================================
 */

/**
 * Check if a section exists for a symbol set
 *
 * @param {string} symbolSet - Symbol set code (e.g., "10", "15")
 * @param {string} sectionName - Section name: "mainIcon", "modifier1", "modifier2", "specialModifiers"
 * @returns {boolean} True if section exists and has content
 *
 * @example
 * hasSection('10', 'modifier2'); // true
 * hasSection('15', 'modifier2'); // false (Equipment doesn't use modifier2)
 */
export function hasSection(symbolSet, sectionName) {
    const catalog = SYMBOL_SET_CATALOGS[symbolSet];
    if (!catalog) {
        return false;
    }

    // Check if section exists
    if (!catalog[sectionName]) {
        return false;
    }

    // For special modifiers, check if object has any keys
    if (sectionName === 'specialModifiers') {
        return Object.keys(catalog[sectionName]).length > 0;
    }

    // For element types (mainIcon, modifier1, modifier2), check if it has any subsections
    const section = catalog[sectionName];
    if (typeof section !== 'object') {
        return false;
    }

    // Check if any subsection has content
    const hasLabelMappings = section.labelMappings && Object.keys(section.labelMappings).length > 0;
    const hasGraphicAdaptations = section.graphicAdaptations && Object.keys(section.graphicAdaptations).length > 0;
    const hasExtensions = section.extensions && Object.keys(section.extensions).length > 0;

    return hasLabelMappings || hasGraphicAdaptations || hasExtensions;
}

/**
 * Check if command element is supported for a symbol set
 *
 * @param {string} symbolSet - Symbol set code (e.g., "10", "15")
 * @returns {boolean} True if command elements are applicable
 *
 * @example
 * supportsCommand('10'); // true (Land Units support command)
 * supportsCommand('15'); // false (Equipment doesn't support command)
 */
export function supportsCommand(symbolSet) {
    const catalog = SYMBOL_SET_CATALOGS[symbolSet];
    if (!catalog) {
        return false;
    }

    // If catalog explicitly defines supportsCommand, use that value
    if (catalog.hasOwnProperty('supportsCommand')) {
        return catalog.supportsCommand;
    }

    // Default: true (most military units support command elements)
    return true;
}

/**
 * Get special modifiers catalog for a symbol set
 *
 * @param {string} symbolSet - Symbol set code (e.g., "10", "15")
 * @returns {Object|null} Special modifiers object or null if not found
 *
 * @example
 * const modifiers = getSpecialModifiers('10');
 * // Returns: { 1: { type: 'svg', svg: '...' }, 2: {...}, ... }
 *
 * const equipmentMods = getSpecialModifiers('15');
 * // Returns: { 1: { type: 'svg', svg: '...' } } (only armored)
 */
export function getSpecialModifiers(symbolSet) {
    const catalog = SYMBOL_SET_CATALOGS[symbolSet];
    if (!catalog) {
        return null;
    }

    return catalog.specialModifiers || null;
}