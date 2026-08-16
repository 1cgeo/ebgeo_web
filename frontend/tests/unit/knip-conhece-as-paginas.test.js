// Path: tests/unit/knip-conhece-as-paginas.test.js
//
// O GUARDA DE CODIGO MORTO PRECISA CONHECER AS QUATRO PAGINAS.
//
// O `knip.json` declarava uma unica entrada, `src/js/index.js`. O plugin do
// Vite dentro do knip acha `index.html` sozinho, mas NAO acha `atlas.html`,
// `admin.html` nem `calibracao.html`. Consequencia: tudo que so essas tres
// paginas alcancam ficava sem consumidor conhecido, e o knip reportava 18
// arquivos "sem uso", dos quais 16 eram as tres paginas INTEIRAS, entry point
// incluso.
//
// O erro nao e a contagem, e a DIRECAO dele: um guarda de codigo morto que
// aponta para codigo vivo convida a apagar produto. Corrigidas as entradas, a
// lista caiu de 18 arquivos para 2 e de 187 exports para 143.
//
// Este teste existe porque a proxima pagina nova cai exatamente no mesmo
// buraco, em silencio: nada quebra, o knip so passa a chamar a pagina de morta.

import { test, describe } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Paginas HTML declaradas como entrada do bundler, lidas do proprio
 * `vite.config.js` para que a lista nao seja uma segunda copia que envelhece.
 *
 * @returns {string[]} nomes de arquivo, por exemplo admin.html
 */
function paginasDoVite() {
    const cfg = readFileSync(join(RAIZ, 'vite.config.js'), 'utf8');
    const bloco = cfg.slice(cfg.indexOf('input:'), cfg.indexOf('input:') + 600);
    return [...bloco.matchAll(/'([\w-]+\.html)'/g)].map(m => m[1]);
}

/**
 * O modulo de entrada que a pagina carrega, lido do proprio HTML.
 *
 * @param {string} html - nome do arquivo, por exemplo admin.html
 * @returns {string|null} caminho relativo a src/, ou null se a pagina nao tem
 */
function moduloDaPagina(html) {
    const texto = readFileSync(join(RAIZ, html), 'utf8');
    const m = texto.match(/<script type="module" src="\/(src\/[^"]+)"/);
    return m ? m[1] : null;
}

describe('o knip conhece todas as paginas do bundler', () => {
    const knip = JSON.parse(readFileSync(join(RAIZ, 'knip.json'), 'utf8'));
    const paginas = paginasDoVite();

    test('o vite declara mais de uma pagina (guarda: senao o resto e vacuo)', () => {
        // Sem esta ancora, um `input:` que deixasse de casar com a regex daria
        // lista vazia e TODOS os casos abaixo passariam sem verificar nada.
        assert.ok(paginas.length >= 4,
            `esperava as quatro paginas, o vite.config.js devolveu: ${paginas.join(', ')}`);
        assert.ok(paginas.includes('index.html'));
        assert.ok(paginas.includes('admin.html'));
        assert.ok(paginas.includes('atlas.html'));
        assert.ok(paginas.includes('calibracao.html'));
    });

    test('cada pagina alcanca seu modulo de entrada pelo knip', () => {
        const semEntrada = [];
        for (const pagina of paginas) {
            const modulo = moduloDaPagina(pagina);
            assert.ok(modulo, `${pagina} nao declara script type=module`);

            // `index.html` e o unico que o plugin do Vite dentro do knip acha
            // sozinho, por convencao de nome. Declara-lo tambem faz o knip
            // reclamar de padrao redundante, entao ele fica de fora da lista.
            if (pagina === 'index.html') continue;

            if (!knip.entry.includes(modulo)) semEntrada.push(`${pagina} -> ${modulo}`);
        }
        assert.deepEqual(semEntrada, [],
            'pagina fora do knip.json: o knip vai reportar o codigo dela como morto. '
            + 'Acrescente o modulo em knip.entry.');
    });

    test('o knip nao aponta para entrada que nao existe mais', () => {
        // O erro simetrico: pagina removida e entrada esquecida faz o knip
        // varrer um caminho inexistente e calar sobre o resto.
        const modulos = paginas.map(moduloDaPagina).filter(Boolean);
        const orfas = knip.entry.filter(e => !modulos.includes(e));
        assert.deepEqual(orfas, [],
            'entrada do knip.json sem pagina correspondente no vite.config.js');
    });
});
