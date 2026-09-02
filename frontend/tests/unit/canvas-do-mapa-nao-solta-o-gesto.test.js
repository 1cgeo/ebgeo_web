// Path: tests/unit/canvas-do-mapa-nao-solta-o-gesto.test.js

/**
 * @fileoverview O CANVAS DO MAPA PRECISA SEGURAR O GESTO DE TOQUE, E QUEM DECIDE ISSO E
 * UMA REGRA DE CSS, nao uma linha de JavaScript.
 *
 * O DEFEITO, medido no bundle vendorizado e nao suposto. A folha do MapLibre
 * (`public/vendors/maplibre-gl.css`) dirige `touch-action` a partir das classes
 * `.maplibregl-touch-zoom-rotate` e `.maplibregl-touch-drag-pan`, e o VENDOR REMOVE essas
 * classes toda vez que alguem chama `dragPan.disable()`. Neste app isso acontece em 15
 * sitios (ferramentas de desenho, o manipulador de mover feicao, o proprio manipulador de
 * arraste da camera). Perdida a classe no MEIO do gesto, `touch-action` volta para
 * `pan-x pan-y` e o NAVEGADOR cancela a pinca: no tablet a pessoa ve a pinca virar rolagem,
 * sem erro nenhum e sem nada no console.
 *
 * POR QUE ISTO E TESTE DE CSS: o conserto vive inteiro na folha, e ele tem DUAS metades que
 * nenhum teste de comportamento em node alcanca. A primeira e a declaracao; a segunda e a
 * ANCORA. A pagina do mapa pinta um SEGUNDO canvas do MapLibre (`#mini-map-street-view`) e
 * o estudio de calibracao um terceiro: um seletor nu (`.maplibregl-canvas`) roubaria o
 * gesto dos dois, e o sintoma apareceria longe daqui.
 *
 * O CONTROLE DO PROPRIO VARREDOR esta no ultimo caso: sem ele, um extrator que parasse de
 * casar deixaria os casos acima verdes varrendo string vazia.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const folha = readFileSync(resolve(FRONT, 'src/css/map-controls.css'), 'utf8');

/** A folha SEM COMENTARIO: a prosa acima da regra cita `touch-action` e `#map-sig` varias
 *  vezes, e varrer com ela dentro faria o teste passar por causa da explicacao. */
function semComentarios(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Os seletores de uma regra que declara `touch-action: none`, achatados numa lista.
 * Devolve [] quando nenhuma regra declara.
 */
function seletoresComTouchActionNone(css) {
    const regras = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)];
    return regras
        .filter(([, , corpo]) => /touch-action:\s*none/.test(corpo))
        .flatMap(([, seletor]) => seletor.split(',').map((s) => s.trim()).filter(Boolean));
}

describe('o canvas do mapa 2D nao solta o gesto de toque', () => {
    const limpa = semComentarios(folha);
    const seletores = seletoresComTouchActionNone(limpa);

    it('as DUAS superficies do gesto declaram `touch-action: none`', () => {
        // O container recebe o touchstart e o canvas e o alvo real do movimento; o vendor
        // declara as duas, entao cobrir so uma deixa metade do gesto com a regra dele.
        expect(seletores, 'nenhuma regra de `touch-action: none` sobrou na folha').not.toHaveLength(0);
        expect(
            seletores,
            'o container do canvas perdeu `touch-action: none`: a pinca volta a ser cancelada '
            + 'pelo navegador assim que alguem chamar dragPan.disable()'
        ).toContain('#map-sig .maplibregl-canvas-container');
        expect(seletores).toContain('#map-sig .maplibregl-canvas');
    });

    it('a regra e ANCORADA em #map-sig: o minimapa do 360 fica de fora', () => {
        // `.maplibregl-canvas { touch-action: none }` nu tambem faria os casos acima
        // passarem, e roubaria o gesto do `#mini-map-street-view` e do minimapa da
        // calibracao, que sao outros mapas.
        const doMapLibre = seletores.filter((s) => s.includes('maplibregl-canvas'));
        expect(doMapLibre.length).toBeGreaterThan(0);
        for (const seletor of doMapLibre) {
            expect(
                seletor.startsWith('#map-sig '),
                `seletor \`${seletor}\` nao esta ancorado em #map-sig e alcanca os outros mapas da pagina`
            ).toBe(true);
        }
    });

    it('a especificidade da nossa regra bate a mais forte do vendor', () => {
        // (1,1,0) contra (0,4,0). Nao e aritmetica de sobra: a regra do vendor que perde
        // aqui esta VIVA na folha vendorizada, e e ela que reescreve `touch-action` quando
        // as classes voltam.
        const vendor = readFileSync(resolve(FRONT, 'public/vendors/maplibre-gl.css'), 'utf8');
        expect(
            vendor,
            'a folha vendorizada parou de declarar touch-action: esta guarda ficou sem sujeito'
        ).toMatch(/\.maplibregl-canvas-container[^{]*\{[^}]*touch-action/);
        // Um id vale mais que qualquer numero de classes, entao basta haver um id.
        for (const seletor of seletores.filter((s) => s.includes('maplibregl-canvas'))) {
            expect(seletor).toMatch(/^#[\w-]+\s/);
        }
    });

    it('CONTROLE DO VARREDOR: ele acha a regra, ignora comentario e sabe recusar', () => {
        const amostra = '/* .fake { touch-action: none; } */'
            + ' #map-sig .real { touch-action: none; }'
            + ' .outra { touch-action: manipulation; }';
        const achados = seletoresComTouchActionNone(semComentarios(amostra));
        expect(achados).toEqual(['#map-sig .real']);
        // E a folha real continua tendo corpo depois da poda dos comentarios.
        expect(limpa.length).toBeGreaterThan(1000);
    });
});
