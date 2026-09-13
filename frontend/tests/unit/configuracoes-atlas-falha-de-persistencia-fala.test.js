// Path: tests/unit/configuracoes-atlas-falha-de-persistencia-fala.test.js

/**
 * @fileoverview A FALHA DE PERSISTÊNCIA DA APARÊNCIA CHEGA AO MODAL, E NÃO AO CONSOLE.
 *
 * `saveAtlasAppearance` (`frontend/src/js/store/atlas-appearance.service.js`) deixou de engolir
 * falha de persistência: ela PROPAGA, emitindo `STORE_PERSIST_ERROR`, e o `false` ficou só com o
 * sentido que tem dono (patch vazio, ou permissão recusada). `_handleSave`
 * (`frontend/src/js/modals/atlas-settings.modal.js`) não tinha `catch` em volta da chamada, então
 * a rejeição escapava do handler de clique: o modal ficava aberto, a frase "Configurações salvas."
 * não saía, e nada na tela dizia o que houve. Silêncio com o modal aberto é indistinguível de
 * "nada aconteceu ainda".
 *
 * ============================ O QUE ESTE ARQUIVO PRENDE ==============================
 *
 * A FIAÇÃO, por varredura estrutural do fonte, porque o ambiente é node puro (sem jsdom) e o
 * modal escreve `innerHTML` numa árvore de verdade: montar a tela aqui não é opção.
 *
 *   1. que a chamada a `saveAtlasAppearance` esteja dentro de um `try` cujo `catch` é o PRÓXIMO
 *      bloco (e não o `try` externo do método, que termina em `finally` e existe só para devolver
 *      `_busy`). Apagar o `catch` interno faz a busca cair no externo e reprova;
 *   2. que esse `catch` fale pela porta da casa (`showError`) e devolva, mantendo o modal aberto;
 *   3. o CONTROLE NEGATIVO, que é a metade que discrimina: o ramo de erro NÃO anuncia sucesso
 *      (`showSuccess`, "Configurações salvas.") e NÃO fecha o modal (`this.hide()`).
 *
 * ============================ O QUE ELE NÃO PRENDE ==================================
 *
 * Nada aqui executa `_handleSave`, então não há prova de que a rejeição de fato passe por esse
 * ramo em runtime, nem de que a frase mostrada seja legível. E o `false` de patch vazio ou
 * permissão recusada continua ignorado de propósito: este arquivo não afirma coisa alguma sobre
 * ele.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * O CÓDIGO do modal, sem comentário nenhum. A limpeza não é higiene: o comentário do próprio
 * `catch` explica por que não se anuncia sucesso ali, e citar `showSuccess` na explicação faria a
 * asserção de ausência reprovar sobre a prosa em vez de sobre o código.
 */
const FONTE = readFileSync(resolve(FRONT, 'src/js/modals/atlas-settings.modal.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

/**
 * O bloco `{...}` que começa na posição do `{` dado, com as chaves equilibradas.
 * @param {string} texto
 * @param {number} abre - Índice do `{`.
 * @returns {{corpo: string, fim: number}} O bloco e o índice logo depois do `}`.
 */
function blocoEm(texto, abre) {
    let profundidade = 0;
    for (let i = abre; i < texto.length; i += 1) {
        if (texto[i] === '{') {
            profundidade += 1;
        } else if (texto[i] === '}') {
            profundidade -= 1;
            if (profundidade === 0) return { corpo: texto.slice(abre, i + 1), fim: i + 1 };
        }
    }
    throw new Error('bloco não fecha');
}

/**
 * O corpo de um método do fonte, do `nome(` até a coluna em que a chave fecha.
 * @param {string} nome
 * @returns {string}
 */
function corpoDe(nome) {
    // ANCORADO NO INÍCIO DA LINHA: um `indexOf` solto acharia a CHAMADA e devolveria o corpo da
    // função seguinte, ou seja, um veredito sobre o trecho errado.
    const definicao = new RegExp(`^\\s*${nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\(`, 'm');
    const achado = definicao.exec(FONTE);
    expect(achado, `a definição de ${nome} existe no arquivo`).not.toBeNull();
    return blocoEm(FONTE, FONTE.indexOf('{', achado.index + achado[0].length)).corpo;
}

describe('configurações do atlas: a falha de persistência da aparência fala', () => {
    const CORPO = corpoDe('async _handleSave');

    /** O `try` mais próximo que envolve a gravação da aparência, e o `catch` colado nele. */
    function ramoDaAparencia() {
        const chamada = CORPO.indexOf('saveAtlasAppearance(');
        expect(chamada, '`_handleSave` grava a aparência').toBeGreaterThan(-1);

        const inicioTry = CORPO.lastIndexOf('try', chamada);
        expect(inicioTry, 'a gravação está dentro de um `try`').toBeGreaterThan(-1);

        const { corpo, fim } = blocoEm(CORPO, CORPO.indexOf('{', inicioTry));
        // Se o `try` interno sumir, este `lastIndexOf` acha o `try` EXTERNO do método, cujo bloco
        // também contém a chamada; o que reprova nesse caso é o `catch` exigido logo abaixo,
        // porque o externo é seguido de `finally`.
        expect(corpo, 'o bloco achado é o que contém a gravação').toContain('saveAtlasAppearance(');

        const depois = CORPO.slice(fim);
        const catchLogoDepois = /^\s*catch\s*(\([^)]*\))?\s*\{/.exec(depois);
        expect(catchLogoDepois, 'a gravação da aparência tem `catch` próprio').not.toBeNull();
        return blocoEm(depois, depois.indexOf('{', catchLogoDepois.index)).corpo;
    }

    it('a rejeição da gravação é tratada no lugar do clique, e não escapa do handler', () => {
        expect(ramoDaAparencia()).toContain('showError(');
    });

    it('o ramo de erro devolve, deixando o modal aberto com o que a pessoa escolheu', () => {
        const ramo = ramoDaAparencia();
        expect(ramo, 'sai do `_handleSave` sem seguir para o PATCH de restrições').toContain('return');
        expect(ramo, 'o modal NÃO se fecha em cima de um erro').not.toContain('hide()');
    });

    it('CONTROLE NEGATIVO: o ramo de erro não anuncia sucesso', () => {
        // Sem esta asserção, um `catch` que mostrasse o erro E mantivesse o `showSuccess` do
        // caminho feliz passaria pelas duas de cima, e é exatamente o desfecho que o usuário não
        // pode ver: "Configurações salvas." sobre uma gravação que falhou.
        const ramo = ramoDaAparencia();
        expect(ramo).not.toContain('showSuccess');
        expect(ramo).not.toContain('Configurações salvas.');
    });

    it('o caminho feliz continua existindo, senão o teste acima seria vácuo', () => {
        // Controle da própria varredura: um `_handleSave` que nunca anunciasse sucesso satisfaria
        // as ausências acima sem provar nada.
        expect(CORPO).toContain('Configurações salvas.');
    });
});
