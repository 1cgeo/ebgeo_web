// Path: e2e-ui/alvos-de-toque.tablet.spec.js

/**
 * @fileoverview A RÉGUA DE ALVO DE TOQUE, que substitui três listas escritas à mão.
 *
 * O relatório de tablet mandava consertar alvo pequeno por inventário: "um `div` de 16 por 16" no
 * 3D, "três alvos" no 360, "sete alvos" na primeira pessoa. Abertas as três listas, parte delas
 * não era alvo nenhum: `.fp3d-crosshair` tem `pointer-events: none`, `.fp3d-list__thumb` é
 * decoração e `.fp3d-key--pad` é dica de tecla desenhada dentro de um texto de ajuda. Contar alvo
 * lendo folha de estilo mede a coisa errada, porque o que a pessoa acerta é a CAIXA do elemento
 * acionável na tela, com padding, borda e o que o leiaute tiver feito com ele.
 *
 * ESTE ARQUIVO MEDE A CAIXA. Ele boota o app no contexto de tablet, revela as barras dos três
 * visualizadores (que são marcação estática de `index.html`, escondida até o motor abrir) e lê
 * `getBoundingClientRect` de tudo o que é acionável, acusando o que fica abaixo de 44 px em
 * qualquer eixo.
 *
 * POR QUE REVELAR EM VEZ DE ABRIR OS MOTORES, e este é o limite declarado: abrir o 3D exige um
 * tileset em disco, abrir o 360 exige projeto publicado e a primeira pessoa exige uma cena de 20
 * MB, de modo que a régua só rodaria onde o acervo está montado e se auto-pularia no resto,
 * medindo zero sem dizer. As três barras são `position: fixed` e a geometria delas não depende do
 * que o motor desenha atrás, então revelá-las mede o mesmo retângulo. O que ISSO não alcança é
 * alvo que só existe depois que o motor carrega (o cartão de um marcador, a linha de um item da
 * cena): esses continuam fora, e é por isso que esta régua é um piso e não um teto.
 *
 * A EXCLUSÃO É MEDIDA, NÃO DECLARADA. Nada entra numa lista de exceção escrita à mão: o que sai da
 * conta sai por uma propriedade que o próprio navegador responde (`pointer-events: none`, caixa
 * zerada, ancestral escondido), que é o que separa um enfeite de um comando.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** A régua de toque da casa, a mesma de `--touch-target-min`. */
const MINIMO_PX = 44;

/**
 * As barras que só aparecem com o motor aberto, e que são marcação estática do `index.html`.
 * Reveladas por estilo direto na página, porque o que se mede é a caixa e não a visibilidade.
 */
const SUPERFICIES = Object.freeze([
    { nome: 'mapa 2D', revelar: [] },
    { nome: 'barra do 3D', revelar: ['#toolbar-3d', '#nav-help-popup'] },
    { nome: 'barra do 360', revelar: ['#toolbar-360', '#nav-help-popup-360', '#close-street-view-button'] },
    { nome: 'barra da primeira pessoa', revelar: ['#toolbar-fp'] },
]);

/** Boota o app e espera o mapa 2D responder. */
async function bootApp(page) {
    await page.goto('/');
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(
        () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function',
        null,
        { timeout: 20000 },
    );
}

/**
 * Mede todo alvo acionável visível e devolve os que ficam abaixo do mínimo.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string[]} revelar - Seletores a tornar visíveis antes de medir.
 * @returns {Promise<{medidos: number, nomes: string[], pequenos: Array<{seletor, w, h}>}>}
 */
function medirAlvos(page, revelar) {
    return page.evaluate((seletoresParaRevelar) => {
        // REVELAR NÃO É UMA LINHA, e a primeira versão disto mediu menos do que dizia.
        //
        // As barras se escondem de TRÊS maneiras diferentes, e cada uma exige um antídoto:
        // `display: none` na própria barra (a da primeira pessoa), `opacity: 0` mais
        // `visibility: hidden` (os dois balões de ajuda, que animam a entrada), e um ANCESTRAL
        // escondido (a barra do 3D). O terceiro é o que enganou: com o pai em `display: none` o
        // filho continua respondendo o próprio `display`, e quem zera é a CAIXA, de modo que a
        // barra saía pela peneira de tamanho e o caso passava medindo a tela do mapa duas vezes.
        //
        // Por isso a subida até o `body`, e por isso o inventário no stdout: foi comparando as
        // listas de dois casos que a falta apareceu.
        for (const sel of seletoresParaRevelar) {
            const el = document.querySelector(sel);
            if (!el) continue;
            for (let no = el; no && no !== document.body; no = no.parentElement) {
                if (getComputedStyle(no).display === 'none') no.style.display = 'flex';
                no.removeAttribute('hidden');
            }
            el.style.visibility = 'visible';
            el.style.opacity = '1';
        }

        /** Um nome curto e estável para a mensagem de falha. */
        const nomeDe = (el) => {
            if (el.id) return `#${el.id}`;
            const classe = [...el.classList].find((c) => !c.startsWith('is-') && !c.includes('active'));
            return classe ? `${el.tagName.toLowerCase()}.${classe}` : el.tagName.toLowerCase();
        };

        const ACIONAVEIS = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [tabindex]:not([tabindex="-1"])';
        const pequenos = [];
        const nomes = [];
        let medidos = 0;

        for (const el of document.querySelectorAll(ACIONAVEIS)) {
            const estilo = getComputedStyle(el);
            // NADA DISTO É LISTA DE EXCEÇÃO: são propriedades que o navegador responde, e cada uma
            // significa "isto não é um alvo agora". Elemento sem caixa não está na tela; elemento
            // que não recebe ponteiro não é acionável, por mais que a marcação diga `button`.
            if (estilo.pointerEvents === 'none') continue;
            if (estilo.visibility === 'hidden' || estilo.display === 'none') continue;
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;

            medidos += 1;
            nomes.push(nomeDe(el));
            if (r.width < 44 || r.height < 44) {
                pequenos.push({
                    seletor: nomeDe(el),
                    w: Math.round(r.width * 10) / 10,
                    h: Math.round(r.height * 10) / 10,
                });
            }
        }
        return { medidos, pequenos, nomes };
    }, revelar);
}

describeOrSkip('a régua de alvo de toque (tablet)', () => {
    for (const { nome, revelar } of SUPERFICIES) {
        test(`${nome}: nenhum comando abaixo de ${MINIMO_PX} px`, async ({ page }) => {
            await bootApp(page);
            const { medidos, pequenos, nomes } = await medirAlvos(page, revelar);

            // O INVENTÁRIO VAI PARA O STDOUT, sempre, e não só quando reprova: a pergunta que
            // mata uma régua é "o que exatamente você mediu", e a resposta tem de estar na
            // saída da rodada VERDE também. Sem ela, um seletor que parasse de casar
            // devolveria zero pequenos com cara de aprovação.
            console.log(`[regua] ${nome}: ${medidos} alvos -> ${[...new Set(nomes)].sort().join(', ')}`);

            // PISO DA PRÓPRIA MEDIÇÃO, e sem ele todo o resto é vácuo: uma página que não bootou,
            // ou um seletor de acionáveis que parou de casar, devolveria zero pequenos e passaria
            // verde sem ter medido nada.
            expect(medidos, 'a régua não achou alvo nenhum: ela parou de medir').toBeGreaterThan(5);

            const lista = pequenos.map((p) => `${p.seletor} ${p.w}x${p.h}`).join('\n  ');
            expect(pequenos, `alvos abaixo de ${MINIMO_PX} px:\n  ${lista}`).toEqual([]);
        });
    }
});
