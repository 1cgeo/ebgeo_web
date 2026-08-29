// Path: tests/unit/cena-indoor-carimba-credencial.test.js
//
// TODO `fetch` DE ASSET DA CENA INDOOR CARIMBA A CREDENCIAL — varredura estrutural
// sobre a pasta inteira, não asserção sobre a linha que foi consertada.
//
// O DEFEITO QUE ORIGINOU ESTE ARQUIVO, medido em 2026-08-29 em `dev/tile-privado` com a
// cena `museu-1cgeo` marcada privada: `marcadores.json`, `voxel-meta.json` e `voxel.bin`
// carregavam para o administrador, e os 20 MB de `cena.sog` levavam 404. `loadSplat`
// fazia `fetch(splatUrl)` cru. O servidor estava certo em recusar: o pedido chegava
// anônimo. Na tela isso não se lê como negação de acesso, se lê como visualizador
// quebrado, porque todo o resto da mesma cena aparece.
//
// POR QUE VARREDURA E NÃO UM TESTE DE `loadSplat`. Duas razões, e a segunda é a que
// decide. Primeira: aquele módulo é lazy e arrasta Three.js e o motor de splatting, de
// modo que exercitá-lo em node puro custaria uma pilha de duplos que testaria os duplos.
// Segunda, e maior: prender a linha consertada não impede a PRÓXIMA. O defeito não foi
// alguém escrever um `fetch` errado, foi um `fetch` novo nascer sem que ninguém
// lembrasse do carimbo, e é isso que uma varredura pega e uma asserção pontual não.
//
// FALHA FECHADO: `fetch` novo na pasta reprova até declarar o carimbo ou entrar na
// lista de isenções abaixo, com motivo escrito.
//
// O QUE ELE DELIBERADAMENTE NÃO ALCANÇA, dito para que o verde não seja lido como
// "a cena inteira está credenciada": os endereços que o NAVEGADOR busca sozinho.
// `itens/*.jpg` e a foto do marcador viram `img.src`, o clipe de prévia vira
// `<video src>`, e nenhum dos três aceita cabeçalho — não há API que o carimbe. Para
// eles a única autorização que viaja é o `?atlasId=` de `escoparUrlDeAsset`, que cobre
// o EMPRÉSTIMO do atlas em foco e não o papel global nem a concessão pessoal. Essa
// metade continua aberta por limitação da plataforma, está medida em
// `dev/tile-privado/scripts/confere-3d-indoor.sh` e sai de lá marcada DEFEITO.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PASTA = join(RAIZ, 'src/js/first_person_3d_tool');

/**
 * Isenções, com motivo. Vazia hoje, e a lista existe para que uma exceção futura seja
 * ESCRITA em vez de resolvida afrouxando a regex — que é como um guarda volta a abrir
 * sozinho. Formato: `{ arquivo, trecho, motivo }`.
 */
const ISENCOES = [];

/** Todos os .js da pasta, recursivamente. */
function arquivosJs(dir) {
    const saida = [];
    for (const nome of readdirSync(dir)) {
        const caminho = join(dir, nome);
        if (statSync(caminho).isDirectory()) saida.push(...arquivosJs(caminho));
        else if (nome.endsWith('.js')) saida.push(caminho);
    }
    return saida;
}

/**
 * Acha as chamadas de `fetch(` e devolve a linha inteira de cada uma.
 *
 * A leitura é por LINHA, e isso é suficiente aqui porque as quatro chamadas da pasta
 * cabem numa linha cada; o dia em que uma quebrar em várias, este teste acusa em vez de
 * passar em silêncio, porque a linha isolada não conterá o carimbo.
 */
function chamadasDeFetch(texto) {
    return texto
        .split('\n')
        .map((linha, i) => ({ linha: linha.trim(), numero: i + 1 }))
        .filter(({ linha }) => /(?:^|[^.\w])fetch\s*\(/.test(linha) && !linha.startsWith('*') && !linha.startsWith('//'));
}

describe('cena indoor: todo fetch de asset carimba a credencial', () => {
    const arquivos = arquivosJs(PASTA);

    it('a pasta tem arquivos e chamadas de fetch (senão o verde é vazio)', () => {
        // A guarda contra cobertura vazia: se a pasta for renomeada ou a varredura parar
        // de casar, este teste continuaria verde sem examinar uma linha sequer.
        expect(arquivos.length).toBeGreaterThan(5);
        const total = arquivos.reduce(
            (n, a) => n + chamadasDeFetch(readFileSync(a, 'utf8')).length, 0);
        expect(total).toBeGreaterThanOrEqual(4);
    });

    it('nenhum fetch da pasta sai sem cabeçalho de credencial', () => {
        const nus = [];
        for (const arquivo of arquivos) {
            const texto = readFileSync(arquivo, 'utf8');
            const rel = relative(RAIZ, arquivo).replace(/\\/g, '/');
            for (const { linha, numero } of chamadasDeFetch(texto)) {
                const carimbado = /headers/.test(linha);
                const isento = ISENCOES.some((e) => e.arquivo === rel && linha.includes(e.trecho));
                if (!carimbado && !isento) nus.push(`${rel}:${numero} :: ${linha}`);
            }
        }
        expect(nus, 'fetch de asset sem cabeçalho de credencial. Passe '
            + '`{ headers: await cabecalhosDeAsset() }`, ou declare a isenção com motivo '
            + 'na constante ISENCOES deste arquivo.').toEqual([]);
    });

    it('o fetch do splat carimba, e é o que a cena privada exige', () => {
        // Asserção ABSOLUTA sobre o sítio que originou o guarda, ao lado da varredura.
        // Sem ela, apagar o `fetch` inteiro deixaria a varredura verde por não ter o que
        // varrer, que é a cobertura vazia na direção oposta.
        const texto = readFileSync(join(PASTA, 'first_person_viewer.js'), 'utf8');
        expect(texto).toContain('cabecalhosDeAsset');
        expect(texto).toMatch(/fetch\(splatUrl,\s*\{\s*headers:\s*await cabecalhosDeAsset\(\)\s*\}\)/);
    });
});
