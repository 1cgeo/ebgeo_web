// Path: tests/unit/cadastro-lotacao-nao-autoriza.test.js

/**
 * @fileoverview O CADASTRO DIZ QUE A ORGANIZAÇÃO MILITAR É LOTAÇÃO, E QUE ELA NÃO AUTORIZA NADA.
 *
 * O campo é OBRIGATÓRIO e, até 2026-08-24, não dizia nada. Numa tela que também pede posto, um
 * campo obrigatório chamado "Organização Militar" se lê como o campo que decide o que a conta vai
 * poder fazer, e ele não decide: `CONSTITUICAO.md` 1.5 diz que a organização declarada no cadastro
 * é LOTAÇÃO e NÃO AUTORIZA NADA, e 10.5 diz que ela continua auto-declarada, escolhida livremente
 * entre as organizações ativas, sem ninguém verificar. Quem amarra papel e escopo de produção é o
 * administrador, por outra coluna (`users.producer_org_id`).
 *
 * ============================ O QUE ESTE ARQUIVO PRENDE ==============================
 *
 * Ele NÃO assere que uma constante existe: isso não prova que a frase chega à tela. Ele monta o
 * formulário DE VERDADE, chamando `SignupModal._createForm()` sobre um `document` falso mínimo, e
 * procura a frase DENTRO do campo da OM na árvore que o método devolve. Apagar a linha que a
 * pendura (mantendo a constante exportada) deixa este arquivo vermelho.
 *
 * Ele roda os DOIS ramos do campo, porque são dois construtores diferentes: `<select>` quando o
 * `/config` serviu a lista controlada, `<input>` de texto quando não serviu. A primeira versão
 * desta correção pendurava a nota dentro de um dos ramos e teria passado verde metade das vezes.
 *
 * ============================ O QUE ELE NÃO PRENDE ==================================
 *
 * O ambiente é node puro, sem jsdom: o `document` daqui é uma maquete de umas poucas propriedades.
 * Ele prova PARENTESCO e TEXTO, nunca desenho: uma nota escondida por CSS, ou com contraste
 * ilegível, passa verde. E ele não julga a frase: que ela use o vocabulário do estatuto é
 * verificado por asserção de palavras ("lotação", "não autoriza"), não por sentido.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SignupModal, LOTACAO_HINT } from '@modals/signup.modal.js';
import config from '@js/config.js';

/** Um nó da maquete: o mínimo que os construtores de campo do modal tocam. */
class FakeNode {
    /** @param {string} tag */
    constructor(tag) {
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.parentElement = null;
        this.attributes = {};
        this.dataset = {};
        this.className = '';
        this.id = '';
        this._text = '';
    }

    /** @param {FakeNode} child @returns {FakeNode} */
    appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    /** @param {string} name @param {string} value */
    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    /** @param {string} name @returns {string|null} */
    getAttribute(name) {
        return this.attributes[name] ?? null;
    }

    /** @param {string} value */
    set textContent(value) {
        this._text = String(value);
        this.children = [];
    }

    /** @returns {string} O texto próprio mais o dos descendentes, como no DOM. */
    get textContent() {
        return this._text + this.children.map((c) => c.textContent).join('');
    }
}

/** Todos os nós da árvore, em pré-ordem. @param {FakeNode} root @returns {FakeNode[]} */
function walk(root) {
    return [root, ...root.children.flatMap(walk)];
}

/** O nó com este `data-testid`. @param {FakeNode} root @param {string} testid */
function byTestId(root, testid) {
    return walk(root).find((node) => node.dataset.testid === testid) ?? null;
}

/** Sobe do nó até a raiz. @param {FakeNode} node @returns {FakeNode[]} */
function ancestors(node) {
    const out = [];
    for (let cur = node?.parentElement; cur; cur = cur.parentElement) out.push(cur);
    return out;
}

let documentoAnterior;

beforeEach(() => {
    documentoAnterior = globalThis.document;
    globalThis.document = { createElement: (tag) => new FakeNode(tag) };
});

afterEach(() => {
    globalThis.document = documentoAnterior;
    delete config.postos;
    delete config.organizacoesMilitares;
});

/**
 * Monta o formulário sem passar pelo `render()` (que precisa de um documento de verdade e do
 * `ModalBase`): `_createForm` só usa métodos do próprio protótipo e o `document` global.
 * @returns {FakeNode}
 */
function montarFormulario() {
    const modal = Object.create(SignupModal.prototype);
    return modal._createForm();
}

describe('cadastro: a Organização Militar se declara como lotação', () => {
    it('a nota chega ao formulário, dentro do campo da OM, no ramo de <select>', () => {
        config.postos = [{ id: 'p1', name: 'Capitão' }];
        config.organizacoesMilitares = [{ id: 'om1', name: '1º BEC' }];

        const form = montarFormulario();
        const om = byTestId(form, 'signup-om');
        const nota = byTestId(form, 'signup-om-hint');

        expect(om, 'o campo da OM existe').not.toBeNull();
        expect(om.tagName, 'com lista controlada ele é um select').toBe('SELECT');
        expect(nota, 'a nota foi pendurada').not.toBeNull();
        expect(nota.textContent).toBe(LOTACAO_HINT);
        // PARENTESCO, e é ele que separa "a nota existe" de "a nota está NO campo": uma nota solta
        // no fim do formulário passaria na asserção de texto e mentiria sobre a que campo se refere.
        expect(ancestors(nota), 'a nota mora no mesmo campo que o controle')
            .toContain(om.parentElement);
        expect(om.getAttribute('aria-describedby')).toBe(nota.id);
    });

    it('a nota chega também no ramo de <input>, quando o /config não serviu a lista', () => {
        // Sem `config.organizacoesMilitares` o modal cai no campo de texto: são dois construtores
        // diferentes, e pendurar a nota só num deles some com ela metade das vezes.
        const form = montarFormulario();
        const om = byTestId(form, 'signup-om');
        const nota = byTestId(form, 'signup-om-hint');

        expect(om.tagName, 'sem lista controlada ele é um input de texto').toBe('INPUT');
        expect(nota, 'a nota foi pendurada também aqui').not.toBeNull();
        expect(nota.textContent).toBe(LOTACAO_HINT);
        expect(ancestors(nota)).toContain(om.parentElement);
    });

    it('nenhum outro campo obrigatório ganhou a nota por engano', () => {
        const form = montarFormulario();
        const notas = walk(form).filter((n) => n.dataset.testid === 'signup-om-hint');
        expect(notas, 'uma nota, num campo só').toHaveLength(1);
        // Controle da própria varredura: o formulário tem mesmo os outros campos, senão a asserção
        // acima estaria contando numa árvore vazia.
        expect(byTestId(form, 'signup-posto')).not.toBeNull();
        expect(byTestId(form, 'signup-email')).not.toBeNull();
    });

    it('a frase usa o vocabulário do estatuto: lotação, e não autoriza nada', () => {
        const texto = LOTACAO_HINT.toLowerCase();
        expect(texto, 'a palavra da cláusula 1.5').toContain('lotação');
        expect(texto, 'a negação da cláusula 1.5').toContain('não autoriza nada');
        // A 10.5: auto-declarada, ninguém verifica.
        expect(texto).toMatch(/declarada por você|ninguém a verifica/);
        // E ela NÃO pode prometer o contrário: nada aqui pode sugerir que o campo dá acesso.
        expect(texto).not.toMatch(/permite|dá acesso|autoriza o/);
    });
});
