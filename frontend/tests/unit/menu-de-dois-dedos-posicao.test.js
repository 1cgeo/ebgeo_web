// Path: tests/unit/menu-de-dois-dedos-posicao.test.js

/**
 * @fileoverview O MENU DE DESAMBIGUAÇÃO SUMIA DA TELA NO TOQUE DE DOIS DEDOS, e o defeito
 * não deixava rastro nenhum: o elemento era criado, recebia as linhas, era anexado ao `body`
 * e ficava fora da vista.
 *
 * A CADEIA, e ela tem três elos que só falham JUNTOS. `_setupTwoFingerTap` monta um evento
 * SINTÉTICO para reusar o caminho de Shift+clique, e aquele objeto carregava só `shiftKey`.
 * `_createContextMenuElement` posiciona com `Math.min(e.originalEvent.clientX, ...)`, e
 * `Math.min(undefined, n)` é `NaN`. A declaração `left: "NaNpx"` é inválida, o navegador a
 * DESCARTA em silêncio, e `.feature-selection-menu` é `position: fixed` sem `top`/`left` na
 * folha: sem deslocamento, a caixa fixa fica na posição estática dela, logo depois de um
 * `#map-sig` que ocupa 100% da altura, isto é, abaixo da dobra.
 *
 * POR QUE ESTE TESTE É ESTRUTURAL. O ambiente da suíte é node puro, sem DOM, então não há
 * como criar o elemento e ler o estilo computado. O que dá para prender é a FORMA do código
 * nos dois elos que o conserto tocou, e é o bastante para o defeito não voltar por descuido:
 * ele voltaria por alguém montar o evento sintético sem posição, ou por alguém tirar a
 * reserva do consumidor.
 *
 * AS DUAS PONTAS SÃO PRESAS DE PROPÓSITO, e não só a origem. Consertar apenas o evento
 * sintético deixaria o próximo chamador de `_createContextMenuElement` repetir o buraco, e
 * consertar apenas a reserva esconderia a origem atrás de uma posição plausível.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FONTE = readFileSync(
    join(FRONT, 'src/js/tool_manager/selection_manager.js'),
    'utf8',
);

/** A fonte sem comentários: a prosa deste arquivo cita os símbolos e casaria com tudo. */
const CODIGO = FONTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('o menu de dois dedos nasce onde o dedo tocou', () => {
    it('piso: a leitura achou mesmo os dois elos', () => {
        // Sem isto, um `readFileSync` que devolvesse vazio faria todo o resto passar
        // comparando nada com nada, para sempre.
        expect(CODIGO).toContain('_createContextMenuElement');
        expect(CODIGO).toContain('createTwoFingerTapHandler');
    });

    it('o evento sintético do toque de dois dedos carrega a POSIÇÃO', () => {
        // O bloco do evento falso, do `shiftKey` até o fecho do objeto.
        const falso = CODIGO.match(/shiftKey: true[\s\S]{0,220}?\}/);
        expect(falso, 'o evento sintético de Shift+clique sumiu do arquivo').not.toBeNull();
        expect(falso[0], 'sem `clientX` o menu volta a ser posicionado com NaN')
            .toMatch(/clientX:/);
        expect(falso[0]).toMatch(/clientY:/);
    });

    it('a posição vem do PONTO MÉDIO, e não do ponto relativo ao canvas', () => {
        // `point` é o ponto médio MENOS o retângulo do canvas, para a consulta de feições;
        // `clientX` é coordenada de viewport. Usar `point.x` aqui erraria por um deslocamento
        // que só aparece quando o canvas não começa em zero — o que passou a acontecer no
        // tablet, em que o painel empurra o mapa (`map/tablet-panel-push.js`).
        const falso = CODIGO.match(/shiftKey: true[\s\S]{0,220}?\}/);
        expect(falso[0]).toMatch(/clientX: midpoint\.x/);
        expect(falso[0]).toMatch(/clientY: midpoint\.y/);
    });

    it('o consumidor tem RESERVA, para o próximo chamador sem posição não sumir também', () => {
        const trecho = CODIGO.match(/_createContextMenuElement[\s\S]{0,700}?menu\.style\.top/);
        expect(trecho, 'o posicionamento do menu sumiu do arquivo').not.toBeNull();
        // `Number.isFinite` e NÃO `??`: o defeito era `undefined`, mas `NaN` passa por `??`
        // intacto e volta a produzir `left: "NaNpx"`.
        expect(trecho[0], 'a reserva precisa recusar NaN, e não só ausência')
            .toMatch(/Number\.isFinite\(/);
    });

    it('e o recorte na janela tem as DUAS pontas', () => {
        // O `Math.min` sozinho impede a caixa de passar da borda direita e inferior; sem o
        // `Math.max`, uma posição negativa (dedo perto da borda esquerda numa janela estreita,
        // ou um chamador futuro com coordenada de outro referencial) a joga para fora do outro
        // lado, que é o mesmo defeito espelhado.
        const trecho = CODIGO.match(/_createContextMenuElement[\s\S]{0,700}?menu\.style\.top/);
        expect(trecho[0]).toMatch(/Math\.max\(0, Math\.min\(/);
    });
});
