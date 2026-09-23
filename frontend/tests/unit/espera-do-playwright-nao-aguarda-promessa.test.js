// Path: tests/unit/espera-do-playwright-nao-aguarda-promessa.test.js
//
// CENSO: nenhum `waitForFunction` do Playwright recebe predicado ASSÍNCRONO.
//
// A ARMADILHA. `page.waitForFunction(fn)` avalia `fn` dentro da página e termina quando o valor
// devolvido é VERDADEIRO. Ele não aguarda promessa: um predicado `async` devolve uma promessa, a
// promessa é sempre verdadeira, e a espera termina na PRIMEIRA avaliação, com o valor a que a
// promessa resolver (inclusive `false`). Não há erro nem aviso: a linha lê como uma espera e se
// comporta como uma leitura só. É a classe `verificacao-fantasma` da constituição na forma mais
// pura, uma checagem que não checa.
//
// POR QUE UM CENSO E NÃO UMA NOTA. A lição já tinha sido paga e escrita uma vez, em prosa, no
// comentário de `esperarAtlasPronto` (`frontend/tests/e2e-ui/troca-viva-de-atlas-medida.spec.js`),
// e a mesma forma voltou depois em `esperarEscopoMontado`
// (`frontend/tests/e2e-ui/cadeia-completa-atlas.spec.js`). Ali ela custou uma falha só-Firefox na
// auditoria de 2026-09-22 ("perna 2: Expected 11, Received 0") que se lia como perda de dado depois
// do F5. Medido em 2026-09-23: o produto não perdia nada; a leitura caía no escopo-ponte legado
// porque a espera não tinha esperado. Correção que recorre é guia que não pegou, então a lição
// sai da prosa e vira este arquivo.
//
// O QUE ELE COBRA, em três partes, cada uma com o seu controle:
//   1. a PREMISSA, lida no Playwright INSTALADO: se um dia `waitForFunction` passar a aguardar a
//      promessa, este caso reprova dizendo isso, e a dívida abaixo deixa de ser defeito;
//   2. o DETECTOR, contra fontes sintéticas, para que um detector quebrado não devolva censo vazio;
//   3. o CENSO, sobre todo `.js` de `frontend/tests/` que o git conhece (versionado ou ainda não):
//      sítio novo reprova, e a DÍVIDA DECLARADA é contada por arquivo em igualdade exata, para que
//      consertar um sítio obrigue a riscá-lo daqui (allowlist sem beneficiário reabre sozinha).
//
// O QUE ELE NÃO ALCANÇA: predicado que chega por variável importada de outro arquivo (o detector
// só resolve identificador declarado `async` no MESMO arquivo), e predicado síncrono que devolve
// promessa sem ser `async` (por exemplo, `() => fetch(...)`). Nenhum dos dois existe hoje.
//
// A FORMA CERTA, quando a condição precisa de `await` dentro da página: sondar pelo Node, com
// `expect.poll(() => page.evaluate(async () => ...))`, porque `evaluate` aguarda a promessa; ou
// esperar por um sinal síncrono (DOM, global) e só então ler.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ_PACOTE = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * A DÍVIDA DECLARADA em 2026-09-23: sítios que já existiam quando este censo nasceu, cada um uma
 * espera fantasma, deixados de fora do conserto porque pertencem a outros recortes de trabalho e
 * mudá-los muda o tempo de dezenas de specs. Consertou um? Tire-o daqui no mesmo commit.
 */
const DIVIDA = new Map([
    ['tests/e2e-ui/browser-collab-three-client-flow.spec.js', 1],
    ['tests/e2e-ui/corte-da-divisa-pelo-menu.spec.js', 1],
    ['tests/e2e-ui/exportar-le-todo-mapa.spec.js', 1],
    // Saíram em 2026-09-23 os quatro sítios dos helpers (as duas esperas de ferramenta ativa e a
    // de vértice de `drawViaToolUI`, em `helpers/collab-helpers.js`, e `esperarFerramentaPronta`,
    // em `helpers/ferramenta-pronta.js`): hoje sondam por `expect.poll(() => page.evaluate(...))`.
    ['tests/e2e-ui/imagem-reencodada-gif-bmp.spec.js', 1],
]);

/** Bloco primeiro, linha depois; preserva `://` dentro de string, como os outros guardas da casa. */
const semComentarios = (fonte) => fonte
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * Conta as chamadas de `waitForFunction` cujo PRIMEIRO argumento é uma função assíncrona: literal
 * (`async (...) =>`, `async x =>`, `async function`) ou identificador declarado `async` no mesmo
 * arquivo.
 * @param {string} fonte - Código-fonte.
 * @returns {number}
 */
function contarPredicadosAssincronos(fonte) {
    const codigo = semComentarios(fonte);
    const assincronos = new Set();
    for (const m of codigo.matchAll(/\basync\s+function\s+([A-Za-z_$][\w$]*)/g)) assincronos.add(m[1]);
    for (const m of codigo.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*async\b/g)) {
        assincronos.add(m[1]);
    }
    let n = 0;
    for (const m of codigo.matchAll(/\bwaitForFunction\s*\(\s*(async\b|[A-Za-z_$][\w$]*)/g)) {
        if (m[1] === 'async' || assincronos.has(m[1])) n += 1;
    }
    return n;
}

/** Todo `.js` de `frontend/tests/`, versionado ou ainda não commitado: quem nasce entra no mesmo dia. */
function inventario() {
    let saida;
    try {
        saida = execSync('git ls-files --cached --others --exclude-standard tests', {
            cwd: RAIZ_PACOTE,
            encoding: 'utf8',
        });
    } catch (err) {
        throw new Error(`o inventário deste censo vem de "git ls-files" e o comando FALHOU (${err.message}). `
            + 'Sem inventário não há censo: conserte o comando em vez de afrouxar o piso.');
    }
    return [...new Set(saida.split('\n').map((l) => l.trim()).filter((l) => l.endsWith('.js')))].sort();
}

/** Todos os `.js` sob uma pasta, recursivamente. */
function arquivosJs(pasta) {
    const saida = [];
    for (const nome of readdirSync(pasta)) {
        const caminho = join(pasta, nome);
        if (statSync(caminho).isDirectory()) saida.push(...arquivosJs(caminho));
        else if (nome.endsWith('.js')) saida.push(caminho);
    }
    return saida;
}

describe('waitForFunction não recebe predicado assíncrono', () => {
    it('PREMISSA: o Playwright instalado testa a verdade do valor e não aguarda a promessa', () => {
        const require = createRequire(import.meta.url);
        const raiz = dirname(require.resolve('playwright-core/package.json'));
        const versao = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8')).version;
        const definicao = /waitForFunctionExpression\(progress\w*, expression\w*, isFunction\w*, arg, options, world = "main"\) \{/;
        const fonte = arquivosJs(join(raiz, 'lib'))
            .map((arq) => readFileSync(arq, 'utf8'))
            .find((texto) => definicao.test(texto));
        expect(fonte, `playwright-core ${versao}: a definição de waitForFunctionExpression mudou de lugar `
            + 'ou de forma. Releia a implementação instalada antes de mexer neste censo.').toBeTruthy();
        const inicio = fonte.search(definicao);
        const corpo = fonte.slice(inicio, inicio + 4000);
        // O laço de sondagem: chama o predicado, e o valor (uma promessa, se ele for async) é
        // testado pela verdade e entregue ao `fulfill` sem nova sondagem.
        const lacoSemAwait = /const success = predicate\(\);\s*if \(success\) \{\s*fulfill\(success\);\s*return;/;
        const aguarda = /await predicate\(/;
        expect(corpo).toMatch(lacoSemAwait);
        expect(corpo, `playwright-core ${versao} passou a aguardar o predicado: esta premissa caiu, e a `
            + 'dívida declarada deixa de ser espera fantasma').not.toMatch(aguarda);
        // CONTROLE das duas regex, sobre o MESMO corpo com a única mudança que derrubaria a
        // premissa: sem ele, uma regex que nunca casasse faria a segunda asserção passar à toa.
        const variante = corpo.replace('const success = predicate();', 'const success = await predicate();');
        expect(variante).not.toBe(corpo);
        expect(variante).not.toMatch(lacoSemAwait);
        expect(variante).toMatch(aguarda);
    });

    it('CONTROLE do detector: acusa o predicado assíncrono e poupa o síncrono', () => {
        // O NOME DO MÉTODO É MONTADO, e não escrito: este arquivo também está no inventário do
        // censo, e as sondas abaixo, escritas por extenso, seriam contadas como sítios reais.
        const w = ['waitFor', 'Function'].join('');
        const conta = contarPredicadosAssincronos;
        expect(conta(`await page.${w}(async (n) => n === 1, 1);`)).toBe(1);
        expect(conta(`await page.${w}(\n  async () => true);`)).toBe(1);
        expect(conta(`await page.${w}(async function () { return 1; });`)).toBe(1);
        expect(conta(`page.${w}(async x => x);`)).toBe(1);
        expect(conta(`const pronto = async () => true;\nawait page.${w}(pronto);`)).toBe(1);
        expect(conta(`async function pronto() { return true; }\nawait page.${w}(pronto, null);`)).toBe(1);
        expect(conta(`await page.${w}(() => window.ok === true);`)).toBe(0);
        expect(conta(`const V = () => true;\nawait page.${w}(V, null);`)).toBe(0);
        // `evaluate` AGUARDA a promessa, e é a forma certa: não pode ser acusado.
        expect(conta('await page.evaluate(async () => (await f()).length);')).toBe(0);
        // A prosa que DESCREVE a armadilha não é a armadilha.
        expect(conta(`// nunca use ${w}(async () => ...)\nconst a = 1;`)).toBe(0);
        expect(conta(`/* ${w}(async () => 1) */ const a = 1;`)).toBe(0);
    });

    it('o censo: nenhum sítio fora da dívida declarada, e a dívida contada exatamente', () => {
        const achados = new Map();
        const arquivos = inventario();
        // Piso de vácuo: um inventário vazio deixaria a igualdade abaixo verde sem ter lido nada.
        expect(arquivos.length).toBeGreaterThan(100);
        expect(arquivos).toContain('tests/e2e-ui/cadeia-completa-atlas.spec.js');
        for (const rel of arquivos) {
            const n = contarPredicadosAssincronos(readFileSync(join(RAIZ_PACOTE, rel), 'utf8'));
            if (n > 0) achados.set(rel, n);
        }
        expect(Object.fromEntries([...achados].sort())).toEqual(Object.fromEntries([...DIVIDA].sort()));
    });
});
