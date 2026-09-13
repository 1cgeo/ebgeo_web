// Path: tests/unit/gestos-compostos-fiacao.test.js
//
// A FIAÇÃO DOS GESTOS COMPOSTOS COM O LOTE LÓGICO, medida no TEXTO dos arquivos.
//
// ================= POR QUE TEXTO, E NÃO EXECUÇÃO =============================
//
// O que o lote lógico faz está preso por execução, contra a fila e o despachante REAIS, em
// `tests/integration/gesto-composto-um-lote.test.js`. O que ESTE arquivo cobra é outra coisa:
// que os dois arquivos de conversão de feição de fato ABRAM o gesto. Eles não carregam em node
// puro (arrastam MapLibre, a store e os controles de desenho), então a alternativa a uma
// asserção textual não é uma asserção melhor, é nenhuma asserção. A transferência de camada, que
// carrega, é medida por execução em `tests/store/layer-transfer.test.js`.
//
// ================= A REGRA, E POR QUE ELA É ESTA =============================
//
// Os dois arquivos já agrupavam o gesto para o Ctrl+Z com `startBatchUndo()`, e o trecho que o
// lote lógico precisa envolver é EXATAMENTE o mesmo: da criação da feição nova até a remoção da
// de origem. Então a regra é o pareamento: cada `startBatchUndo()` de conversão tem um
// `withGestureBatch(` aberto ANTES dele. Um trecho com lote de desfazer e sem lote lógico é o
// defeito: um Ctrl+Z desfaz as duas metades aqui, e o servidor pode ter aplicado só uma.
//
// O QUE ELA DELIBERADAMENTE NÃO PEGA: que o gesto FECHE no lugar certo (é o `finally` de
// `withGestureBatch`, preso por execução no arquivo de integração), e qualquer sítio de
// conversão que venha a nascer sem `startBatchUndo()`. O inventário abaixo é escrito à mão de
// propósito, com três arquivos nomeados, porque a propriedade é sobre estes três gestos e não
// sobre uma varredura da árvore; um gesto composto NOVO entra aqui na mão, no commit em que
// nascer.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * @param {string} relativo - Caminho a partir de `frontend/`.
 * @returns {string} O conteúdo do arquivo.
 */
function ler(relativo) {
    return readFileSync(fileURLToPath(new URL(`../../${relativo}`, import.meta.url)), 'utf8');
}

const CONVERSOES = [
    'src/js/tool_manager/helpers/linear-conversion.helpers.js',
    'src/js/tool_manager/helpers/feature-header.helpers.js',
];

describe('Os gestos compostos abrem um lote lógico', () => {
    it.each(CONVERSOES)('%s importa `withGestureBatch` do módulo folha', (arquivo) => {
        const texto = ler(arquivo);
        // Por ARQUIVO, nunca pelo barril de sync: `@store/sync/index.js` arrasta a pilha inteira.
        expect(texto).toContain("import { withGestureBatch } from '@store/sync/gesture-batch.js'");
    });

    it.each(CONVERSOES)('%s abre o gesto antes de cada lote de desfazer', (arquivo) => {
        const texto = ler(arquivo);
        const desfazer = [...texto.matchAll(/startBatchUndo\(\)/g)].map(m => m.index);
        // A CHAMADA, não o nome: a linha do import escreve `withGestureBatch }` e não casa aqui.
        const gestos = [...texto.matchAll(/withGestureBatch\(/g)].map(m => m.index);

        // PISO: a varredura precisa casar alguma coisa, senão os pareamentos abaixo comparariam
        // vazio com vazio, que é a cobertura vazia que a constituição nomeia.
        expect(desfazer.length).toBeGreaterThan(0);
        expect(gestos).toHaveLength(desfazer.length);
        for (const [i, inicioDoDesfazer] of desfazer.entries()) {
            expect(gestos[i]).toBeLessThan(inicioDoDesfazer);
        }
    });

    it('a transferência de camada abre o gesto e diz por que ela não é uma transação só', () => {
        const texto = ler('src/js/store/layer-transfer.operations.js');
        expect(texto).toContain("import { withGestureBatch } from './sync/gesture-batch.js'");
        expect(texto).toContain('withGestureBatch(');
        // A razão de ela ser composta é contrato escrito em `.claude/rules/architecture.md` e no
        // cabeçalho do próprio arquivo; perdê-la é o caminho para alguém "simplificar" a função
        // envolvendo-a em `withMapDocument` e travar a interface no primeiro uso.
        expect(texto).toContain('FIFO');
    });

    it('CONTROLE NEGATIVO: a varredura DISTINGUE um arquivo sem o gesto', () => {
        // Um texto sintético com o lote de desfazer e sem o lote lógico: é exatamente o estado
        // anterior a este commit, e a regra tem de acusá-lo.
        const antes = 'startBatchUndo();\ntry { await addFeature(); } finally { commitBatchUndo(); }';
        const desfazer = [...antes.matchAll(/startBatchUndo\(\)/g)].map(m => m.index);
        const gestos = [...antes.matchAll(/withGestureBatch\(/g)].map(m => m.index);
        expect(desfazer).toHaveLength(1);
        expect(gestos).toHaveLength(0);
    });
});
