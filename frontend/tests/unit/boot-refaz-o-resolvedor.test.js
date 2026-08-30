// Path: tests/unit/boot-refaz-o-resolvedor.test.js
//
// QUEM MONTA O REPOSITÓRIO REFAZ O RESOLVEDOR DE MAPAS, LOGO DEPOIS.
//
// O DEFEITO (relatado pelo dono em 2026-08-30): copiar um atlas de servidor para local e abrir
// a cópia mostrava o mapa chamado `fbeae0b2-fc32-4add-91df-a858815cf11e`. Trocar de mapa
// corrigia. A causa NÃO era a escolha do mapa: era o `mapResolver` estar montado contra o
// escopo errado. `initServices()` dispara a montagem dele UMA vez, antes de
// `activateBootAtlasScope()`, então no boot ele não conhece os UUIDs do atlas que está sendo
// aberto — e `resolveToName` devolve a entrada de volta quando não conhece, que é a política
// dele. `adoptMountedLocalAtlas` (troca de slot) já refazia o resolvedor com o repositório
// montado, com o porquê escrito ali; o BOOT era o único caminho fora dessa regra.
//
// POR QUE ESTE TESTE É ESTRUTURAL, E POR QUE ISSO É UMA CONFISSÃO. A primeira tentativa de
// prender este defeito foi um teste de integração (`repository-active-map.test.js`) que
// chamava `mapResolver.initialize(getRepository())` ELE MESMO antes de afirmar. Ficou verde
// COM e SEM o conserto de verdade, porque ele armava no teste justamente o passo que faltava
// na produção. É a forma mais cara de cobertura vazia: o teste não mede o código, mede o
// cenário que ele próprio construiu. Exercitar a sequência real exigiria importar `store.js`
// inteiro (barramento de eventos, sessão, tab-lock, fila de saída) num ambiente node sem DOM,
// que é o motivo de aquele arquivo nunca ter feito isso. Então o que se prende aqui é a ORDEM
// no fonte, que é exatamente o que faltava, e o teste de integração ganhou uma nota dizendo o
// que ele NÃO cobre.
//
// Controle negativo: apague a linha `await mapResolver.initialize(getRepository());` de
// `initializeWithLastActiveMap` (store.js) e o primeiro caso reprova.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const raizSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/js');

/** O corpo de uma função nomeada, do cabeçalho até a linha que fecha na coluna zero. */
function corpoDaFuncao(arquivo, nome) {
    const texto = readFileSync(path.join(raizSrc, arquivo), 'utf8');
    const inicio = texto.indexOf(`function ${nome}(`);
    expect(inicio, `${nome} não existe em ${arquivo} — o teste está apontando para um símbolo morto`)
        .toBeGreaterThan(-1);
    const fim = texto.indexOf('\n}', inicio);
    expect(fim, `não achei o fim de ${nome}`).toBeGreaterThan(inicio);
    return texto.slice(inicio, fim);
}

/**
 * Os DOIS caminhos que montam um repositório e seguem usando nome de mapa na tela. Eles são
 * irmãos por construção: um é o boot, o outro é a troca de slot com a página já de pé.
 */
const CAMINHOS = [
    { arquivo: 'store/store.js', funcao: 'initializeWithLastActiveMap' },
    { arquivo: 'store/map.operations.js', funcao: 'adoptMountedLocalAtlas' },
];

describe('todo caminho que monta o repositório refaz o resolvedor de mapas', () => {
    for (const { arquivo, funcao } of CAMINHOS) {
        it(`${funcao} refaz o resolvedor DEPOIS de initializeRepository`, () => {
            const corpo = corpoDaFuncao(arquivo, funcao);

            const posRepo = corpo.indexOf('initializeRepository(');
            const posResolver = corpo.indexOf('mapResolver.initialize(');

            expect(posRepo, `${funcao} deveria montar o repositório`).toBeGreaterThan(-1);
            expect(
                posResolver,
                `${funcao} NÃO refaz o mapResolver. Sem isso ele fica com o escopo montado antes `
                + 'deste caminho existir, e um mapa chaveado por UUID aparece na tela como UUID.',
            ).toBeGreaterThan(-1);
            expect(
                posResolver,
                `em ${funcao} o mapResolver é refeito ANTES de initializeRepository: ele leria o `
                + 'repositório do escopo anterior, que é o defeito que esta ordem existe para impedir.',
            ).toBeGreaterThan(posRepo);
        });
    }

    it('o boot espera a montagem antiga ANTES de refazer (senão as duas se atropelam)', () => {
        // `initialize()` começa limpando as duas tabelas. Com as duas montagens em voo, a antiga
        // pode terminar depois da nova e escrever por cima com dado de outro escopo — e o defeito
        // volta de forma intermitente, que é pior que voltar sempre.
        const corpo = corpoDaFuncao('store/store.js', 'initializeWithLastActiveMap');
        const posEspera = corpo.indexOf('awaitMapResolverReady(');
        const posResolver = corpo.indexOf('mapResolver.initialize(');

        expect(posEspera).toBeGreaterThan(-1);
        expect(posResolver).toBeGreaterThan(posEspera);
    });

    it('guarda: a leitura do fonte está mesmo achando os corpos (senão tudo acima é vazio)', () => {
        // Sem este caso, um `indexOf` que devolvesse a string inteira por engano faria as
        // comparações de posição passarem sobre um texto que não é o da função.
        for (const { arquivo, funcao } of CAMINHOS) {
            const corpo = corpoDaFuncao(arquivo, funcao);
            expect(corpo.startsWith(`function ${funcao}(`)).toBe(true);
            expect(corpo.length).toBeLessThan(4000);
        }
    });
});
