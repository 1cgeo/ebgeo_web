// Path: tests/unit/dropdown-scroll-do-painel.test.js

/**
 * @fileoverview A rolagem do contêiner que segura a engrenagem REPOSICIONA o menu de opções
 * da feição; qualquer outra rolagem o fecha.
 *
 * O defeito que esta régua prende foi medido no navegador em 2026-09-05: o foco que o clique dá
 * ao botão rola `.feature-panel-content` para trazê-lo à vista, e o ouvinte global de `scroll`
 * (documento, fase de captura) fechava o menu 1 a 11 ms depois de aberto, em cerca de metade
 * das rodadas. A decisão vive em `dropdown-scroll.model.js`, pura, e o ouvinte em
 * `feature-header.helpers.js` a consulta. A metade do navegador é provada pelo spec
 * `browser-collab-conversao-linear` (abrir o menu depois de selecionar, nos dois postos).
 *
 * Controle negativo: com a decisão trocada por `false` incondicional, o primeiro caso reprova;
 * com `true` incondicional, os três últimos reprovam.
 */

import { describe, it, expect } from 'vitest';
import { scrollKeepsFeatureDropdown } from '../../src/js/tool_manager/helpers/dropdown-scroll.model.js';

/** Um elemento falso que sabe quem contém. */
function elemento(filhos = []) {
    const el = { contains: (x) => x === el || filhos.some((f) => f === x || (f.contains && f.contains(x))) };
    return el;
}

describe('o menu de opções da feição diante de uma rolagem', () => {
    const botao = elemento();
    const painel = elemento([botao]);
    const outraLista = elemento([]);
    const documento = { documentElement: elemento([painel, outraLista]), body: elemento([painel, outraLista]) };
    documento.contains = documento.documentElement.contains;

    it('a rolagem do contêiner que CONTÉM o botão reposiciona (o caso medido: o foco rolou o painel)', () => {
        expect(scrollKeepsFeatureDropdown(painel, botao, documento)).toBe(true);
    });

    it('a rolagem de outra lista, que não contém o botão, fecha', () => {
        expect(scrollKeepsFeatureDropdown(outraLista, botao, documento)).toBe(false);
    });

    it('a rolagem da PÁGINA (document, html ou body) fecha, mesmo que a página contenha o botão', () => {
        expect(scrollKeepsFeatureDropdown(documento, botao, documento)).toBe(false);
        expect(scrollKeepsFeatureDropdown(documento.documentElement, botao, documento)).toBe(false);
        expect(scrollKeepsFeatureDropdown(documento.body, botao, documento)).toBe(false);
    });

    it('sem alvo, sem botão, alvo que não é elemento ou o próprio botão: fecha', () => {
        expect(scrollKeepsFeatureDropdown(null, botao, documento)).toBe(false);
        expect(scrollKeepsFeatureDropdown(painel, null, documento)).toBe(false);
        expect(scrollKeepsFeatureDropdown({}, botao, documento)).toBe(false);
        expect(scrollKeepsFeatureDropdown(botao, botao, documento)).toBe(false);
    });
});
