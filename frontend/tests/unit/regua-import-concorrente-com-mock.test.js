// Path: tests/unit/regua-import-concorrente-com-mock.test.js

/**
 * Régua: nenhum teste resolve `import()` EM PARALELO depois de `vi.resetModules()`.
 *
 * O PORQUÊ, medido em 2026-09-11 no `store-schema-migration-v3.0.test.js`. Ele fazia
 * `vi.resetModules()` e logo seis `import()` num `Promise.all`. As resoluções corriam
 * contra o re-registro do mock de `localforage` no grafo novo, e de vez em quando um
 * módulo pegava o localforage REAL. Como o setup global instala `fake-indexeddb`, esse
 * caminho NÃO FALHA: ele funciona contra um banco de verdade que sobrevive entre os
 * testes do arquivo, e o teste passa a medir o que um teste anterior deixou.
 *
 * O modo de falhar é o pior que existe numa suíte: não quebra, muda de assunto. Aquele
 * arquivo reprovava em 2 de 3 rodadas da suíte inteira e passava SEMPRE isolado, porque
 * sozinho não havia teste anterior de quem herdar o estado. A prova do mecanismo foi a
 * loja em uso não carregar o `__backing` do duplo.
 *
 * A varredura que achou os outros cinco casos virou esta régua para não precisar ser
 * repetida à mão. O conserto é sempre o mesmo e é de graça: `await` um a um.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_TESTES = path.resolve(AQUI, '..');

/**
 * Todo arquivo de teste abaixo de um diretório.
 * @param {string} dir
 * @param {Array<string>} saida
 * @returns {Array<string>}
 */
function arquivosDeTeste(dir, saida = []) {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entrada.name);
        if (entrada.isDirectory()) arquivosDeTeste(p, saida);
        else if (/\.(test|spec)\.m?js$/.test(entrada.name)) saida.push(p);
    }
    return saida;
}

/**
 * Trechos `Promise.all(...)` que contenham `import(`, recortados por equilíbrio de
 * parênteses em vez de regex, porque a chamada ocupa várias linhas.
 * @param {string} fonte
 * @returns {Array<string>}
 */
export function blocosDeImportConcorrente(fonte) {
    const achados = [];
    let i = 0;
    while ((i = fonte.indexOf('Promise.all', i)) !== -1) {
        const abre = fonte.indexOf('(', i);
        if (abre === -1) {
            break;
        }
        let nivel = 0;
        let fim = abre;
        for (; fim < fonte.length; fim++) {
            if (fonte[fim] === '(') {nivel++;} else if (fonte[fim] === ')') {
                nivel--;
                if (nivel === 0) break;
            }
        }
        const trecho = fonte.slice(i, fim + 1);
        if (/\bimport\s*\(/.test(trecho)) achados.push(trecho);
        i = fim + 1;
    }
    return achados;
}

const ARQUIVOS = arquivosDeTeste(RAIZ_TESTES);

describe('nenhum teste importa em paralelo depois de resetModules', () => {
    it('a varredura enxerga a suíte inteira, e não um punhado', () => {
        // CONTROLE da régua: se o caminho estiver errado ela varreria zero arquivos e
        // passaria vazia, que é o jeito clássico de uma régua mentir.
        expect(ARQUIVOS.length).toBeGreaterThan(100);
        expect(ARQUIVOS.some(f => f.endsWith('store-schema-migration-v3.0.test.js'))).toBe(true);
    });

    it('nenhum arquivo junta resetModules, vi.mock e import concorrente', () => {
        const culpados = [];

        for (const arquivo of ARQUIVOS) {
            const fonte = fs.readFileSync(arquivo, 'utf8');
            if (!/vi\.resetModules\s*\(/.test(fonte)) continue;
            if (!/vi\.mock\s*\(/.test(fonte)) continue;
            if (blocosDeImportConcorrente(fonte).length === 0) continue;
            culpados.push(path.relative(RAIZ_TESTES, arquivo).replace(/\\/g, '/'));
        }

        expect(culpados).toEqual([]);
    });
});

describe('a régua REPROVA o pior caso, que é o que a torna régua', () => {
    it('pega o Promise.all de várias linhas, que é a forma em que o defeito apareceu', () => {
        const fonte = [
            'vi.resetModules();',
            'const [a, b] = await Promise.all([',
            "    import('@store/um.js'),",
            "    import('@store/dois.js')",
            ']);',
        ].join('\n');

        expect(blocosDeImportConcorrente(fonte)).toHaveLength(1);
    });

    it('pega também o Promise.all de uma linha só', () => {
        const fonte = "await Promise.all([import('a'), import('b')]);";

        expect(blocosDeImportConcorrente(fonte)).toHaveLength(1);
    });

    it('NÃO acusa Promise.all sem import, que é uso legítimo e comum', () => {
        const fonte = 'await Promise.all([repo.getAtlas(), repo.getMap(id)]);';

        expect(blocosDeImportConcorrente(fonte)).toEqual([]);
    });

    it('NÃO acusa import sequencial, que é o conserto', () => {
        const fonte = [
            'vi.resetModules();',
            "const a = await import('@store/um.js');",
            "const b = await import('@store/dois.js');",
        ].join('\n');

        expect(blocosDeImportConcorrente(fonte)).toEqual([]);
    });

    it('não se perde com parênteses aninhados dentro do bloco', () => {
        const fonte = [
            'await Promise.all([',
            "    import('a').then((m) => m.default(1)),",
            "    import('b')",
            ']);',
            'outraCoisa(Promise.all([1, 2]));',
        ].join('\n');

        expect(blocosDeImportConcorrente(fonte)).toHaveLength(1);
    });
});
