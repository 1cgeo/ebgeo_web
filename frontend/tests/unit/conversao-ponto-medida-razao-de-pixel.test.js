// Path: tests/unit/conversao-ponto-medida-razao-de-pixel.test.js

/**
 * @fileoverview A conversão Ponto -> Medida de Coordenação carrega a razão de pixels do gerador.
 *
 * O Núcleo (2026-09-03) rasteriza o símbolo ACIMA do tamanho lógico e devolve `pixelRatio`, e o
 * controle da ferramenta registra a imagem com essa razão. A conversão em
 * `tool_manager/helpers/feature-header.helpers.js` é o OUTRO escritor desse mesmo desenho, e ela
 * copiava `width`, `height` e `anchor` do resultado e deixava a razão de fora: a imagem entrava
 * 1:1 e o símbolo convertido saía quatro vezes maior que o mesmo código desenhado pela
 * ferramenta. O mesmo buraco existe no `main` em bc812832.
 *
 * Este guarda lê a FONTE, porque o módulo é acoplado ao DOM e ao MapLibre e não carrega em
 * `node`. Ele prende três coisas: que o gerador de fato devolve `pixelRatio` (senão a fiação
 * seria vazia), que a conversão grava a razão na feição, e que a passa ao carregador de imagem.
 * Visto reprovando com as duas linhas da conversão revertidas.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pacote = resolve(import.meta.dirname, '../..');
const HELPERS = readFileSync(resolve(pacote, 'src/js/tool_manager/helpers/feature-header.helpers.js'), 'utf8');
const GERADOR = readFileSync(
    resolve(pacote, 'src/js/military_tools/coordination_measure_tool/coordination_measure_generator.js'),
    'utf8',
);

/** O bloco da conversão para medida de coordenação, do gerador até a remoção do ponto. */
function blocoDaConversao() {
    const inicio = HELPERS.indexOf('coordControl.symbolGenerator.generate(');
    const fim = HELPERS.indexOf("await removeFeature('points', pointId)", inicio);
    expect(inicio, 'o gerador da medida de coordenação não foi achado').toBeGreaterThan(-1);
    expect(fim, 'a remoção do ponto não foi achada depois do gerador').toBeGreaterThan(inicio);
    return HELPERS.slice(inicio, fim);
}

describe('conversão Ponto -> Medida de Coordenação: a razão de pixels', () => {
    it('o gerador devolve pixelRatio (senão este guarda não prenderia nada)', () => {
        expect(GERADOR).toMatch(/pixelRatio:\s*result\.pixelRatio/);
    });

    it('a conversão grava a razão na feição, ao lado de width, height e anchor', () => {
        const bloco = blocoDaConversao();
        expect(bloco).toContain('feature.properties.anchor = result.anchor;');
        expect(bloco).toContain('feature.properties.pixelRatio = result.pixelRatio || 1;');
    });

    it('a conversão passa a razão ao carregador de imagem, e não só o blob', () => {
        const bloco = blocoDaConversao();
        expect(bloco).toContain('coordControl.loadSymbolToMap(featureId, result.blob, result.pixelRatio)');
        expect(bloco).not.toMatch(/coordControl\.loadSymbolToMap\(featureId,\s*result\.blob\)/);
    });
});
