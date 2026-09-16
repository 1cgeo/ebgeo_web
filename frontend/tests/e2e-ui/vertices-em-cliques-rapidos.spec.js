// Path: e2e-ui/vertices-em-cliques-rapidos.spec.js

/**
 * @fileoverview Dois cliques rápidos em pontos diferentes são DOIS vértices.
 *
 * As ferramentas de Linha de Limite e de Linha de Coordenação seguram cada clique num
 * temporizador de 250 ms (o que separa o clique do duplo clique). Até 2026-09-03 um segundo
 * clique dentro dessa janela CANCELAVA o temporizador e re-armava com as coordenadas novas: o
 * vértice pendente sumia sem erro, e a feição nascia sem ele. Medido aqui, neste mesmo spec,
 * antes do conserto: 100 ms entre cliques, um vértice; 400 ms, dois. O clique direito que
 * finaliza tinha o mesmo defeito, descartando o vértice pendente e fechando com o ponto sob o
 * cursor.
 *
 * O que se prova, no navegador real e sem dublê: com 100 ms entre os cliques os dois vértices
 * entram, e um clique direito 100 ms depois do último clique esquerdo conserva o vértice
 * esquerdo (a feição fecha com três vértices, e não com dois). A suíte em `node` não alcança
 * isto, porque o temporizador e o clique moram no controle acoplado ao MapLibre.
 *
 * ESTE ARQUIVO CARREGA UM FLAKE QUE NÃO É DELE NEM DO PRODUTO, e ele está declarado aqui com
 * taxa e mecanismo porque um flake sem nome volta a ser investigado do zero a cada vermelho.
 *
 * O MECANISMO: o processo RENDERIZADOR do Chromium morre durante o boot do mapa, antes de
 * qualquer clique, e a falha aparece como `page.evaluate: Target crashed` na linha do `jumpTo`,
 * logo depois de `map.loaded()` ter respondido verdadeiro. Medido em 2026-09-15 com o ouvinte de
 * `pageerror` armado desde antes do `goto`: nas duas quedas NÃO houve erro de página nenhum, e
 * numa delas a última mensagem do console foi do driver de GL (`GL Driver Message (OpenGL,
 * Performance, ...): GPU stall due to ReadPixels`, severidade alta). Ou seja, não há exceção do
 * app e não há recurso do app faltando (as recusas de `http://localhost/tiles/...` aparecem
 * igualmente nas rodadas VERDES, porque o servidor de tiles não sobe nesta camada): morre o
 * PROCESSO, não o app. Nada no produto nem neste spec pode esperar por isso, porque não existe
 * mais página onde esperar.
 *
 * E NÃO É A PILHA DE WebGL, apesar da mensagem de console, que esta linha leu como causa até a
 * noite de 2026-09-15. Aquela mensagem é saída de depuração do próprio ANGLE sobre SwiftShader
 * (este harness não tem driver de fornecedor nenhum dentro do processo), e a queda acontece na
 * MESMA taxa quando se troca o rasterizador inteiro pelo driver da NVIDIA (`--use-angle=d3d11`):
 * 4 em 128, contra 5 em 160 do padrão. O Windows registra todas elas como a mesma exceção, no mesmo
 * deslocamento do binário, o que a torna um CHECK determinístico do Chromium e não uma parada de
 * driver. Cinco configurações de lançamento foram medidas e NENHUMA reduz a taxa; quatro das
 * cinco bandeiras que a intuição sugere já são o padrão do headless shell. A tabela e o porquê de
 * não se mexer no config estão na seção do flaky de `.claude/rules/testing.md`, e ela existe para
 * que a próxima sessão não refaça a busca.
 *
 * A TAXA, em série e com `--retries=0`: 5 quedas em 160 boots deste arquivo, 3,1%, em quatro
 * baterias (0 em 32, 2 em 32, 3 em 64 e 0 em 32). Ele é o arquivo da suíte que mais boota mapa por minuto
 * (quatro casos, cada um com mapa novo e contexto WebGL novo), e é por isso que a queda aparece
 * AQUI primeiro e não porque ele tenha algo de especial. Repare na variância entre baterias: uma
 * bateria de 32 que volte limpa NÃO é evidência de conserto.
 *
 * O QUE NÃO SE FEZ, e por quê. Não há `test.describe.configure({ retries })` neste arquivo: o
 * `playwright.config.js` já tenta de novo uma vez, então declarar `retries: 1` aqui não mudaria
 * a rodada normal e, pior, venceria um `--retries=0` de linha de comando, que é exatamente a
 * medição em série que a constituição pede para investigar corrida. O precedente do repositório
 * é o inverso (`browser-multi-tab-namespace.spec.js` desliga a retry porque ali a corrida É o
 * sujeito). O que se fez foi dar NOME à queda: `abrirMapaComFerramenta` escuta `crash` e
 * `pageerror` desde antes do `goto` e, ao falhar, diz se houve erro de página antes. Sem erro de
 * página, o vermelho se anuncia como queda do navegador em vez de parecer defeito do mapa.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { esperarFerramentaPronta } from './helpers/ferramenta-pronta.js';
import { clicarNoMapaUI, readFeatures } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const INTERVALO_MS = 100;

const FERRAMENTAS = [
    { toolId: 'coordinationLine', key: 'AddCoordinationLineControl', balde: 'coordination_lines' },
    { toolId: 'boundary', key: 'AddBoundaryControl', balde: 'boundarys' },
];

/**
 * O BOOT, COM O MOTIVO DA FALHA NOMEADO. Sem isto, a morte do renderizador chega como
 * `page.evaluate: Target crashed` numa linha de `jumpTo`, que se lê como defeito do mapa; o
 * `error-context.md` da rodada sai sem instantâneo e sem uma linha de erro de página, porque não
 * há mais página de onde tirá-los. O que separa os dois desfechos é ter ou não havido erro de
 * PÁGINA antes, e isso só se sabe escutando desde antes do `goto`.
 * @private
 */
async function abrirMapaComFerramenta(page, toolId) {
    const erroDePagina = [];
    let morreu = false;
    page.on('crash', () => { morreu = true; });
    page.on('pageerror', (e) => erroDePagina.push(String(e.message).slice(0, 300)));
    try {
        await page.goto('/');
        await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 20000 });
        await page.waitForFunction(() => globalThis.__ebgeoMap && globalThis.__ebgeoMap.loaded(), null, { timeout: 20000 });
        await page.evaluate(() => globalThis.__ebgeoMap.jumpTo({ center: [-51.20, -30.02], zoom: 13 }));
    } catch (erro) {
        const caiu = morreu || /Target crashed|Target closed/.test(String(erro?.message ?? ''));
        throw new Error(
            `${caiu ? 'O PROCESSO DA PÁGINA MORREU' : 'o boot do mapa falhou'} antes de qualquer clique`
            + `\n  erros de página antes disso: ${erroDePagina.length ? erroDePagina.join(' | ') : 'NENHUM'}`
            + `${caiu && !erroDePagina.length ? '\n  Sem erro de página, isto é a queda do renderizador do Chromium descrita no cabeçalho deste arquivo, e NÃO o produto.' : ''}`
            + `\n  original: ${String(erro?.message ?? erro).slice(0, 200)}`,
        );
    }
    await page.waitForTimeout(400);
    const grupo = page.locator('.toolbar-group[data-group-id="military"]');
    await grupo.locator('.toolbar-group-btn').click();
    await expect(grupo.locator('.toolbar-popup')).toHaveAttribute('data-visible', 'true', { timeout: 5000 });
    await grupo.locator(`.toolbar-tool-btn[data-tool-id="${toolId}"]`).click();
    await esperarFerramentaPronta(page, toolId);
}

function vertices(page, key) {
    return page.evaluate(async (k) => {
        const s = await import('/src/js/store/index.js');
        const c = s.getControl?.(k);
        return Array.isArray(c?.drawPoints) ? c.drawPoints.length : null;
    }, key);
}

describeOrSkip('vértices em cliques rápidos (Chromium real)', () => {
    for (const { toolId, key, balde } of FERRAMENTAS) {
        test(`${toolId}: dois cliques a ${INTERVALO_MS} ms são dois vértices`, async ({ page }) => {
            await abrirMapaComFerramenta(page, toolId);

            await clicarNoMapaUI(page, [-51.24, -30.03]);
            await page.waitForTimeout(INTERVALO_MS);
            await clicarNoMapaUI(page, [-51.20, -30.02]);

            // O segundo vértice só entra quando o temporizador dele vence, e é isso que se espera.
            await expect.poll(() => vertices(page, key), { timeout: 5000 }).toBe(2);
        });

        test(`${toolId}: o clique direito ${INTERVALO_MS} ms depois do último clique conserva o vértice pendente`, async ({ page }) => {
            await abrirMapaComFerramenta(page, toolId);

            await clicarNoMapaUI(page, [-51.24, -30.03]);
            await expect.poll(() => vertices(page, key), { timeout: 5000 }).toBe(1);
            await clicarNoMapaUI(page, [-51.20, -30.02]);
            await page.waitForTimeout(INTERVALO_MS);
            await clicarNoMapaUI(page, [-51.16, -30.01], { button: 'right' });

            let feicao = null;
            await expect.poll(async () => {
                const lista = await readFeatures(page, balde);
                feicao = lista[0] ?? null;
                return lista.length;
            }, { timeout: 15000 }).toBe(1);
            expect(feicao.props.baseCoordinates).toHaveLength(3);
        });
    }
});
