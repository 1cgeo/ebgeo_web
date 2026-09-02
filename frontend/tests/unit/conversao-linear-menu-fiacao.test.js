// Path: tests/unit/conversao-linear-menu-fiacao.test.js
//
// A FIAÇÃO ENTRE A DECISÃO E O DESENHO: que o menu de feição de fato consulte
// `linearConversionActions`, e que o item bloqueado saia da forma que deixa o clique VIVO.
//
// ================= POR QUE ESTRUTURAL, E O QUE ISSO CUSTA =====================
//
// O ambiente desta suíte é node puro, sem jsdom, e `feature-header.helpers.js` importa o
// barril da store, o despachante de GeoJSON e o MapLibre: ele não carrega aqui. O que se lê é
// o TEXTO, e é a única camada abaixo do Playwright que enxerga a fiação. O comportamento na
// tela (o clique que dispara e o toast que aparece) é de
// `browser-collab-conversao-linear.spec.js`; a DECISÃO é de `conversao-linear.test.js`. Um
// verde aqui com o modelo errado continua verde, e vice-versa: os três medem coisas
// diferentes de propósito.
//
// ================= O QUE ELE PRENDE ==========================================
//
// 1. QUE A TABELA SEJA CONSULTADA. Sem isto, alguém volta a escrever `if (source === 'line')`
//    no desenho e o modelo vira código morto verde.
// 2. QUE O BLOQUEIO SEJA `aria-disabled` E NUNCA `disabled`. Um botão desabilitado não dispara
//    clique, e o clique É como o motivo chega à pessoa. Esta é a metade da convenção "o POSTO
//    some, o ESTADO recusa o clique" que um teste de decisão não consegue medir.
// 3. QUE AS DUAS CONVERSÕES ANTIGAS TENHAM SUMIDO. Elas eram a segunda porta para o mesmo
//    defeito: sem gate, com `||` comendo zero e deixando artefato órfão.
// 4. QUE A LINHA DE ESTILO DA SETA TENHA SOBREVIVIDO à reescrita. `STYLE_KEYS_BY_TYPE.arrow`
//    ganhou `doubleHeaded` noutra frente da mesma leva, e uma reescrita deste arquivo é
//    exatamente o gesto que a apaga sem que nada mais acuse.
//
// A VARREDURA RODA SOBRE CÓDIGO, NUNCA SOBRE PROSA: os comentários deste arquivo e do próprio
// `feature-header.helpers.js` citam por extenso os símbolos procurados, e uma varredura
// ingênua ficaria verde por causa deles. O caso CONTROLE prova o par.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const URL_MENU = new URL('../../src/js/tool_manager/helpers/feature-header.helpers.js', import.meta.url);
const URL_CSS = new URL('../../src/css/attributes-panel.css', import.meta.url);
const BRUTO = readFileSync(URL_MENU, 'utf8');
const CSS = readFileSync(URL_CSS, 'utf8');

/**
 * Strips JS comments, walking string literals so a `//` inside a string survives.
 * @param {string} fonte - Source text
 * @returns {string} Source without comments
 */
function semComentarios(fonte) {
    let saida = '';
    let i = 0;
    while (i < fonte.length) {
        const atual = fonte[i];
        const proximo = fonte[i + 1];
        if (atual === '/' && proximo === '/') {
            while (i < fonte.length && fonte[i] !== '\n') i++;
            continue;
        }
        if (atual === '/' && proximo === '*') {
            i += 2;
            while (i < fonte.length && !(fonte[i] === '*' && fonte[i + 1] === '/')) i++;
            i += 2;
            continue;
        }
        if (atual === '"' || atual === "'" || atual === '`') {
            const aspa = atual;
            saida += fonte[i++];
            while (i < fonte.length && fonte[i] !== aspa) {
                if (fonte[i] === '\\') saida += fonte[i++];
                if (i < fonte.length) saida += fonte[i++];
            }
            if (i < fonte.length) saida += fonte[i++];
            continue;
        }
        saida += fonte[i++];
    }
    return saida;
}

const FONTE = semComentarios(BRUTO);

/**
 * O BLOCO que desenha as conversões, e não o arquivo inteiro.
 *
 * O recorte importa: `feature-header.helpers.js` tem um `button.disabled = ...` legítimo (o
 * botão de engrenagem, desabilitado quando a seleção mistura tipos), e varrer o arquivo todo
 * pela propriedade proibida acusaria justamente esse. O bloco vai da chamada à tabela até a
 * linha que abre "Cortar Linha", que é o comando seguinte.
 * @returns {string} O trecho do desenho das conversões, sem comentários
 */
function blocoDeConversao() {
    const inicio = FONTE.indexOf('linearConversionActions({');
    const fim = FONTE.indexOf("'Cortar Linha'");
    if (inicio < 0 || fim < 0 || fim <= inicio) return '';
    return FONTE.slice(inicio, fim);
}

describe('a fiação do menu de conversão', () => {
    it('CONTROLE: a varredura enxerga o CÓDIGO e deixou de enxergar a PROSA', () => {
        // O par que a constituição exige de qualquer guarda que varra texto. A prosa escolhida
        // é a que envenenaria este arquivo: o cabeçalho do próprio menu cita as duas funções
        // removidas por nome, então uma remoção de comentários quebrada deixaria o caso
        // "as duas conversões antigas sumiram" vermelho por um motivo falso.
        const PROSA = 'AS CONVERSÕES LINEARES NÃO MORAM MAIS AQUI';
        expect(BRUTO, 'a prosa de controle sumiu do arquivo').toContain(PROSA);
        expect(FONTE, 'a PROSA sobreviveu à remoção de comentários').not.toContain(PROSA);

        // E o outro lado do par: o código continua lá.
        expect(FONTE).toContain('export function createFeatureOptionsButton');
        expect(FONTE).toContain('linearConversionActions');

        // O removedor não pode mexer no conteúdo de um literal de string.
        expect(semComentarios('const s = "a // b"; // fora\nconst t = `c /* d */`;'))
            .toBe('const s = "a // b"; \nconst t = `c /* d */`;');
    });

    it('o bloco de conversão existe, e o recorte não veio vazio', () => {
        // PISO: sem ele, um recorte quebrado deixaria todas as asserções de ausência abaixo
        // vacuamente verdes.
        const bloco = blocoDeConversao();
        expect(bloco.length, 'o recorte do bloco falhou').toBeGreaterThan(300);
        expect(bloco).toContain('LINEAR_CONVERSION_LABELS');
    });

    it('o desenho CONSULTA a tabela, e injeta os três estados que ela pede', () => {
        const bloco = blocoDeConversao();
        // O predicado de posto é `checkPermission`, nunca um nome de papel: comparar posto por
        // igualdade é a lista fechada que a constituição proíbe neste eixo.
        expect(bloco).toMatch(/can:\s*\(key\)\s*=>\s*checkPermission\(key\)\.allowed/);
        expect(bloco).toMatch(/mapLocked:\s*isCurrentMapLockedSync\(\)/);
        expect(bloco).toMatch(/featureLocked:\s*isFeatureEffectivelyLocked\(/);
        expect(bloco).toMatch(/feature:\s*currentFeature/);
    });

    it('o item bloqueado sai com `aria-disabled` e com `title`', () => {
        const bloco = blocoDeConversao();
        expect(bloco).toContain("setAttribute('aria-disabled', 'true')");
        expect(bloco).toMatch(/\.title\s*=\s*blocked/);
    });

    it('o bloco NÃO usa a propriedade `disabled`, que mataria o clique', () => {
        const bloco = blocoDeConversao();
        expect(bloco, 'a propriedade `disabled` voltou ao bloco de conversão')
            .not.toMatch(/\.disabled\s*=/);

        // DISCRIMINAÇÃO: a varredura ACHA a propriedade quando ela existe. O botão de
        // engrenagem, fora do bloco, continua usando-a legitimamente, e é o par que prova que
        // o `not.toMatch` acima não é vacuidade.
        expect(FONTE, 'o arquivo perdeu o `disabled` legítimo do botão de engrenagem')
            .toMatch(/button\.disabled\s*=\s*shouldDisable/);
    });

    it('o clique recusado mostra a frase, e o clique livre converte', () => {
        const bloco = blocoDeConversao();
        expect(bloco).toContain('showWarning(blocked)');
        expect(bloco).toMatch(/convertLinearFeature\(currentFeature,\s*target,\s*selectionManager,\s*uiManager\)/);
        // O `return` depois do aviso: sem ele, o clique recusado avisaria E converteria.
        expect(bloco).toMatch(/showWarning\(blocked\);\s*return;/);
    });

    it('o rótulo vem da tabela, e não de literais espalhados pelo desenho', () => {
        const bloco = blocoDeConversao();
        expect(bloco).toContain('LINEAR_CONVERSION_LABELS[target]');
        // Os rótulos literais das duas conversões antigas não podem ter sobrado no arquivo:
        // duas fontes para o mesmo texto divergem na primeira renomeação.
        expect(FONTE).not.toContain("textContent = 'Converter para Seta'");
        expect(FONTE).not.toContain("textContent = 'Converter para Linha de Limite'");
    });

    it('as DUAS conversões antigas sumiram do arquivo', () => {
        expect(FONTE, '`convertLineToArrow` ainda está no código').not.toContain('convertLineToArrow');
        expect(FONTE, '`convertLineToBoundary` ainda está no código').not.toContain('convertLineToBoundary');
    });

    it('`canSplitArrows` DERIVA do predicado compartilhado, em vez de reescrevê-lo', () => {
        const i = FONTE.indexOf('function canSplitArrows');
        expect(i, 'canSplitArrows sumiu').toBeGreaterThan(-1);
        const corpo = FONTE.slice(i, FONTE.indexOf('\n}', i));
        expect(corpo).toContain('isMergedArrow(');
        // A terceira cópia do predicado de três condições não pode voltar.
        expect(corpo).not.toContain('branches.length');
        expect(corpo).not.toContain('isMerged === true');
    });

    it('`canMergeArrows` NÃO foi tocado: ele tem espelho próprio e guarda próprio', () => {
        // A cópia dele em `military_tools/arrow_tool/arrow-merge.js` é presa por
        // `portao-de-combinar-setas-espelhado.test.js`, que compara os dois corpos. Alinhar um
        // deles por engano numa reescrita deste arquivo é o gesto que aquele guarda pega, e
        // este caso é o aviso antes.
        const i = FONTE.indexOf('function canMergeArrows');
        expect(i).toBeGreaterThan(-1);
        const corpo = FONTE.slice(i, FONTE.indexOf('\n}', i));
        expect(corpo).toMatch(/layerId\s*\?\?\s*'default'/);
    });

    it('a linha de estilo da SETA sobreviveu à reescrita, com a ponta dupla', () => {
        // Ela vem de outra frente da mesma leva, e uma reescrita deste arquivo é justamente o
        // gesto que a apaga em silêncio: nada mais no repositório afirma que `doubleHeaded`
        // conta como estilo para "Selecionar todos com mesmo estilo".
        const linha = /arrow:\s*\[([^\]]*)\]/.exec(FONTE)?.[1] ?? '';
        expect(linha, 'STYLE_KEYS_BY_TYPE.arrow sumiu').not.toBe('');
        for (const chave of ['width', 'fillColor', 'lineColor', 'lineWidth', 'fillOpacity', 'lineOpacity', 'headLengthRatio', 'showArrowHead', 'doubleHeaded']) {
            expect(linha, `STYLE_KEYS_BY_TYPE.arrow perdeu '${chave}'`).toContain(`'${chave}'`);
        }
    });
});

describe('o CSS do item bloqueado', () => {
    it('a classe existe no arquivo que é dono de `.feature-menu-button`', () => {
        expect(CSS).toContain('.feature-menu-button {');
        expect(CSS).toContain('.feature-menu-button--blocked');
    });

    it('ela NÃO se pendura no seletor `:disabled`, que não vale para este bloqueio', () => {
        // O item bloqueado por estado continua habilitado no DOM; casá-lo por `:disabled`
        // deixaria o estilo mudo justamente no caso que ele existe para pintar.
        //
        // Os comentários saem ANTES do recorte: o comentário que explica a especificidade da
        // regra cita `:disabled` por extenso, e sem esta linha o caso ficaria vermelho pela
        // prosa que o justifica.
        const semComentariosCss = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
        const i = semComentariosCss.indexOf('.feature-menu-button--blocked');
        expect(i, 'a classe sumiu do CSS depois de tirar os comentários').toBeGreaterThan(-1);
        const bloco = semComentariosCss.slice(i, i + 400);
        expect(bloco).not.toContain(':disabled');

        // DISCRIMINAÇÃO: a varredura acha `:disabled` onde ele realmente está.
        expect(semComentariosCss).toContain('.feature-menu-button:disabled');
    });
});
