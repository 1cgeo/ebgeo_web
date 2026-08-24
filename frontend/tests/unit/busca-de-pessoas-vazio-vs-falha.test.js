// Path: tests/unit/busca-de-pessoas-vazio-vs-falha.test.js
//
// O produto tem TRES buscas de pessoa, e as tres carregavam o MESMO defeito:
// `_renderResultsInto` escrevia string vazia no ramo sem resultado, o que tornava
// INALCANCAVEL o "Nenhum usuario encontrado" que `_renderResults` ja sabia devolver;
// e o `catch` de `_runSearch` chamava exatamente esse par. Resultado: "ninguem
// encontrado" e "a rede caiu" eram a mesma caixa em branco, e quem lia o painel vazio
// depois de um erro de rede concluia que a pessoa procurada nao existe.
//
// A terceira (`catalog/resource-share.modal.js`) foi consertada no mesmo lote e tem
// cobertura propria em `concessao-prazo-e-alcance.test.js`. Este arquivo guarda as duas
// irmas do eixo de ATLAS, que ninguem tinha olhado porque o relatorio de UX que achou o
// defeito estava escrito sobre o eixo de RECURSO.
//
// O QUE ESTE ARQUIVO PROVA e o que ele NAO prova. Ele prova que o sitio existe e tem a
// FORMA certa, lendo o texto do arquivo: as duas telas ficam distintas por construcao.
// Ele nao prova comportamento de DOM, porque o ambiente da suite e `node` e as duas
// classes montam `innerHTML`. O comportamento da frase compartilhada e provado onde ela
// mora, que e `grant-tree.js`.
//
// Controle negativo, conferido caso a caso ao escrever: repondo o ternario, ou fazendo o
// `catch` voltar a chamar `_renderResultsInto([])`, o `it()` correspondente reprova.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchFailureNotice } from '../../src/js/catalog/grant-tree.js';

const PACOTE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** As duas buscas do eixo de ATLAS, por caminho relativo ao `src/` do pacote. */
const IRMAS = Object.freeze([
    'js/modals/sharing.modal.core.js',
    'js/modals/create-atlas.modal.js',
]);

/** Le o arquivo, falhando alto se ele sumir de lugar (renomear nao pode ficar verde). */
function fonte(rel) {
    const texto = readFileSync(join(PACOTE, 'src', rel), 'utf8');
    expect(texto.length, `arquivo vazio ou ausente: ${rel}`).toBeGreaterThan(0);
    return texto;
}

/**
 * Devolve o corpo de um metodo, ancorado no nome e terminado na primeira linha que
 * fecha na indentacao de metodo de classe.
 *
 * Existe para as asserçoes nao vazarem para o arquivo inteiro: `includes` sobre 1700
 * linhas ficaria verde por causa de um vizinho qualquer, que e a cobertura vazia que a
 * casa proibe.
 */
function corpoDeMetodo(texto, assinatura, rel) {
    const inicio = texto.indexOf(assinatura);
    expect(inicio, `ancora ausente em ${rel}: ${assinatura}`).toBeGreaterThan(-1);
    const fim = texto.indexOf('\n    }', inicio);
    expect(fim, `nao achei o fim de ${assinatura} em ${rel}`).toBeGreaterThan(inicio);
    return texto.slice(inicio, fim);
}

describe('busca de pessoas: vazio e falha sao telas distintas', () => {
    it('as duas irmas do eixo de atlas existem e sao as que este arquivo vigia', () => {
        // Guarda contra a varredura que para de casar em silencio: se um dos dois
        // arquivos for renomeado, o resto do describe ficaria verde por vacuidade.
        expect(IRMAS).toHaveLength(2);
        for (const rel of IRMAS) expect(fonte(rel)).toContain('_renderResultsInto(results)');
    });

    for (const rel of IRMAS) {
        describe(rel, () => {
            it('_renderResultsInto renderiza SEMPRE, sem o ternario que apagava o ramo vazio', () => {
                const corpo = corpoDeMetodo(fonte(rel), '_renderResultsInto(results) {', rel);
                expect(corpo).toContain('container.innerHTML = this._renderResults(results);');
                // REPROVA o estado anterior. O ternario e o defeito inteiro: com ele, o
                // ramo de lista vazia de `_renderResults` nunca chega a tela.
                expect(corpo, 'o ternario que torna o ramo vazio inalcancavel voltou')
                    .not.toMatch(/results\.length\s*\?/);
            });

            it('_renderResults tem o ramo de lista vazia, que e o que o conserto revela', () => {
                // Sem esta asserçao o teste acima ficaria verde contra um `_renderResults`
                // que tambem nao dissesse nada: "sempre renderiza" so vale se houver o que
                // renderizar.
                expect(fonte(rel)).toContain('Nenhum usuário encontrado');
            });

            it('o catch de _runSearch cai na FALHA, e nao no mesmo par do vazio', () => {
                const corpo = corpoDeMetodo(fonte(rel), 'async _runSearch(q) {', rel);
                expect(corpo).toContain('} catch {');
                expect(corpo).toContain('this._renderSearchFailure(q);');
                // REPROVA o estado anterior, em que o catch chamava o par do vazio.
                expect(corpo, 'o catch voltou a renderizar o vazio')
                    .not.toContain('this._renderResultsInto([]);\n            this._setResultsHidden(false);\n        }\n    }');
            });

            it('a falha oferece nova tentativa com a MESMA consulta, e nao um beco', () => {
                const corpo = corpoDeMetodo(fonte(rel), '_renderSearchFailure(q) {', rel);
                expect(corpo).toContain('data-action="search-retry"');
                expect(corpo).toContain('role="alert"');
                // A consulta precisa ser reaproveitada: um botao que limpasse o campo
                // obrigaria a redigitar para descobrir se a rede voltou.
                expect(corpo).toMatch(/this\._runSearch\(q\)/);
            });

            it('a frase e a COMPARTILHADA, nunca uma copia local', () => {
                const texto = fonte(rel);
                expect(texto).toContain('searchFailureNotice');
                expect(texto).toMatch(/import \{[^}]*searchFailureNotice[^}]*\} from '@js\/catalog\/grant-tree\.js'/);
                // Uma copia literal do texto no arquivo seria a divergencia comeando.
                expect(texto, 'a frase foi copiada em vez de importada')
                    .not.toContain('Isto é falha ao consultar o servidor');
            });
        });
    }

    it('a frase compartilhada distingue as duas causas no TEXTO, que e onde a pessoa le', () => {
        // Comportamento, e nao texto de arquivo: se a frase deixar de nomear a causa, os
        // blocos acima continuariam verdes com as duas telas de novo indistinguiveis.
        const frase = searchFailureNotice();
        expect(frase.length).toBeGreaterThan(0);
        expect(frase).toContain('não ausência de resultados');
        expect(frase, 'a frase da falha nao pode se parecer com a do vazio')
            .not.toContain('Nenhum usuário encontrado');
    });
});
