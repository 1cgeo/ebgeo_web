// Path: e2e-ui/temporal-local.spec.js

/**
 * §29.2-7 A BARRA DE LINHA DO TEMPO, MEDIDA PELO EFEITO E NÃO PELO PRÓPRIO BOTÃO.
 *
 * O DEFEITO QUE ESTE ARQUIVO CONSERTA É DELE MESMO (achado C6 da auditoria de 2026-09-21).
 * Três dos quatro casos afirmavam só o RÓTULO do comando que acabaram de clicar: o de
 * reprodução conferia que o botão passava a dizer "Pausar", o de velocidade que o `<select>`
 * passava a valer "5", e o de revelar que o olho ficava `aria-pressed="true"`. Os três são
 * escritos pela própria view (`setPlaying`, `setSpeed`, `setReveal`) no mesmo gesto, sem
 * passar pelo controlador: uma reprodução que não anda, uma velocidade que não chega ao
 * controlador e um revelar que não revela passavam VERDES nos três. O único caso honesto era
 * o §29.3, que mede o cursor, e ele continua aqui.
 *
 * O QUE CADA CASO MEDE AGORA, e por qual sinal:
 *   §29.2 reproduzir → o CURSOR avança e pausar o congela (`aria-valuenow` da régua, que é o
 *         epoch ms publicado por `setCursor`, mais o rótulo de instante);
 *   §29.3 arrastar a régua → o cursor e o rótulo mudam (o caso que já media efeito);
 *   §29.5 velocidade → a TAXA de avanço muda. A asserção é a RAZÃO entre duas velocidades com
 *         folga larga, nunca um valor absoluto: desde 2026-09-21 o multiplicador é fração da
 *         JANELA (1x percorre a janela inteira numa duração-alvo fixa) e não mais unidades por
 *         segundo real, e uma asserção absoluta mediria a fórmula em vez do encanamento;
 *   §29.7 revelar → uma feição FORA da janela volta a ser consultável no mapa
 *         (`queryRenderedFeatures` sobre `point-layer`), e o filtro do MapLibre deixa de citar
 *         a cláusula temporal.
 *
 * O SINAL DE CURSOR NÃO DEPENDE DE IDENTIDADE DE MÓDULO, de propósito: ele é lido do DOM
 * (`aria-valuenow`/`aria-valuetext` da régua, `aria-valuemin`/`aria-valuemax` para os limites),
 * nunca por `import()` do controlador dentro da página, que sob HMR do Vite pode devolver
 * outra instância do módulo e responder sobre um estado que não é o do app.
 *
 * SEM BACKEND: a barra é revelada pelo relógio do card do mapa corrente
 * (`#current-map-temporal-btn`, §1.19), que é estado de VISTA da pessoa. Sem feição temporal o
 * controlador inventa uma janela de agora até agora+24 passos, então régua e rótulos ficam
 * vivos.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { drawPointUI } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** Boots the app and waits for the 2D map + bottom controls to be ready. */
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
 * Opens the Maps tab and clicks the per-map clock toggle, then waits for the temporal
 * bar to be mounted visible. Returns the visible bar locator.
 * @param {import('@playwright/test').Page} page
 */
async function enableTemporalBar(page) {
    await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    const clock = page.locator('#current-map-temporal-btn');
    await expect(clock).toBeVisible({ timeout: 10000 });
    await expect(clock).toHaveAttribute('data-temporal', 'false');

    await clock.click();
    // The toggle persists locally and flips the button state...
    await expect(clock).toHaveAttribute('data-temporal', 'true', { timeout: 5000 });

    // ...and the controller mounts the bar visible (data-hidden flips to "false").
    const bar = page.locator('[data-testid="temporal-bar"]');
    await expect(bar).toHaveAttribute('data-hidden', 'false', { timeout: 5000 });
    await expect(bar).toBeVisible();
    // The fallback now→now+24h window resolves an instant label (not the "—" placeholder).
    await expect.poll(() => bar.locator('.temporal-bar__time').innerText(), { timeout: 6000 }).not.toBe('—');
    return bar;
}

/**
 * O cursor publicado pela régua, em epoch ms.
 *
 * A régua REMOVE `aria-valuenow` quando o cursor não é finito, em vez de escrever `NaN`, então
 * um valor ausente vira `null` aqui e nunca um número inventado por `Number(null) === 0`, que
 * seria um instante perfeitamente plausível de 1970.
 * @param {import('@playwright/test').Locator} track - A `.temporal-bar__track`.
 * @returns {Promise<number|null>}
 */
async function cursorDaRegua(track) {
    const raw = await track.getAttribute('aria-valuenow');
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}

/**
 * Os limites publicados pela régua (`aria-valuemin`/`aria-valuemax`), em epoch ms.
 * @param {import('@playwright/test').Locator} track
 * @returns {Promise<{inicio: number|null, fim: number|null}>}
 */
async function limitesDaRegua(track) {
    const ler = async (attr) => {
        const raw = await track.getAttribute(attr);
        if (raw === null) return null;
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
    };
    return { inicio: await ler('aria-valuemin'), fim: await ler('aria-valuemax') };
}

/**
 * Leva o cursor a uma fração da régua com um gesto de ponteiro de verdade (o mesmo do §29.3).
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} track
 * @param {number} fracao - 0 = início, 1 = fim.
 */
async function levarCursorPara(page, track, fracao) {
    const box = await track.boundingBox();
    expect(box, 'a régua tem caixa na tela').not.toBeNull();
    const x = box.x + Math.min(Math.max(box.width * fracao, 1), box.width - 1);
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.up();
}

/** Clica um botão da barra pelo listener real (a barra encosta no rodapé da viewport). */
const clicar = (locator) => locator.evaluate((el) => el.click());

/** A camada de círculo dos pontos existe no estilo (premissa de toda consulta abaixo). */
const camadaDePontoExiste = (page) => page.evaluate(
    () => Boolean(globalThis.__ebgeoMap?.getLayer('point-layer')),
);

/**
 * A feição está DESENHADA no mapa agora (consulta ao que o MapLibre renderizou).
 * @param {import('@playwright/test').Page} page
 * @param {string} id - Id da feição.
 * @returns {Promise<boolean|null>} `null` quando a camada nem existe, que é outra causa.
 */
const pontoDesenhado = (page, id) => page.evaluate((fid) => {
    const map = globalThis.__ebgeoMap;
    if (!map?.getLayer('point-layer')) return null;
    return map.queryRenderedFeatures({ layers: ['point-layer'] })
        .some((f) => f.properties?.id === fid);
}, id);

/** O filtro vivo da camada cita a cláusula temporal (ou seja, a ocultação está ligada). */
const filtroCitaTempo = (page) => page.evaluate(() => {
    const filtro = globalThis.__ebgeoMap?.getFilter('point-layer');
    return JSON.stringify(filtro ?? null).includes('temporalInicio');
});

/**
 * Escreve a janela de validade da feição na FONTE VIVA e na store, pelos mesmos dois caminhos
 * que o painel de atributos usa (o controle dono pinta a fonte, a op de store grava o disco).
 * Escrever só na store deixaria o filtro do MapLibre lendo a feição sem tempo nenhum.
 * @param {import('@playwright/test').Page} page
 * @param {string} id - Id da feição.
 * @param {number} inicio - Epoch ms.
 * @param {number} fim - Epoch ms.
 */
async function definirJanelaDaFeicao(page, id, inicio, fim) {
    const escrito = await page.evaluate(async ({ fid, ini, end }) => {
        const store = await import('/src/js/store/index.js');
        const colecao = await store.getCurrentMapFeatures();
        const feature = (colecao?.points || []).find((f) => f.properties?.id === fid);
        if (!feature) return null;
        const control = store.getControl('AddPointControl');
        await control?.updateFeaturesProperty?.([feature], 'temporalInicio', ini);
        await control?.updateFeaturesProperty?.([feature], 'temporalFim', end);
        await store.updateFeatureProperty('points', fid, 'temporalInicio', ini);
        await store.updateFeatureProperty('points', fid, 'temporalFim', end);

        const fonte = await globalThis.__ebgeoMap.getSource('points').getData();
        const naFonte = fonte.features.find((f) => f.properties?.id === fid);
        return {
            inicio: naFonte?.properties?.temporalInicio ?? null,
            fim: naFonte?.properties?.temporalFim ?? null,
        };
    }, { fid: id, ini: inicio, end: fim });

    // A fonte viva é a que o filtro lê: conferir aqui separa "o filtro não escondeu" de "a
    // janela nunca chegou à fonte", que na tela são o mesmo ponto desenhado.
    expect(escrito, 'a feição foi encontrada no mapa corrente').not.toBeNull();
    expect(escrito.inicio).toBe(inicio);
    expect(escrito.fim).toBe(fim);
}

describeOrSkip('§29.2-7 Temporal timeline bar (real browser, local playback UI)', () => {
    test('§29.3 arrastar a régua move o instante do cursor (aria-valuenow e o rótulo)', async ({ page }) => {
        await bootApp(page);
        const bar = await enableTemporalBar(page);

        const track = bar.locator('.temporal-bar__track');
        const timeLabel = bar.locator('.temporal-bar__time');

        const valueBefore = await cursorDaRegua(track);
        expect(valueBefore, 'a régua publica um cursor finito').not.toBeNull();
        const textBefore = await timeLabel.innerText();
        const box = await track.boundingBox();
        expect(box).not.toBeNull();

        // Real pointer drag from the left third toward the right edge of the track.
        const yMid = box.y + box.height / 2;
        await page.mouse.move(box.x + box.width * 0.25, yMid);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.9, yMid, { steps: 10 });
        await page.mouse.up();

        // The cursor moved forward: aria-valuenow (epoch ms) increased measurably...
        await expect
            .poll(() => cursorDaRegua(track), { timeout: 6000 })
            .toBeGreaterThan(valueBefore);
        // ...and the displayed instant changed shape too.
        await expect.poll(() => timeLabel.innerText(), { timeout: 6000 }).not.toBe(textBefore);
    });

    test('§29.7 revelar traz de volta ao mapa uma feição FORA da janela', async ({ page }) => {
        await bootApp(page);

        // Uma feição de verdade, desenhada pela ferramenta de verdade. Ela nasce PERMANENTE
        // (sem campos temporais), que é o estado em que todo cursor a mostra.
        const id = await drawPointUI(page, [-47.9, -15.8]);
        expect(id, 'o ponto foi criado').toBeTruthy();

        const bar = await enableTemporalBar(page);
        const track = bar.locator('.temporal-bar__track');
        const reveal = bar.locator('.temporal-bar__reveal');

        // ASSERÇÃO POSITIVA DO ANTES: a camada existe e o ponto ESTÁ desenhado. Sem ela,
        // "sumiu" e "nunca esteve lá" seriam o mesmo verde, e a camada ausente responderia
        // "não desenhado" para sempre.
        expect(await camadaDePontoExiste(page)).toBe(true);
        await expect.poll(() => pontoDesenhado(page, id), { timeout: 10000 }).toBe(true);

        // A janela da feição é posta INTEIRAMENTE antes do início da linha do tempo, lido da
        // própria régua: nenhum instante do intervalo a mostra.
        const limites = await limitesDaRegua(track);
        expect(limites.inicio, 'a régua publica o início da janela').not.toBeNull();
        expect(limites.fim, 'a régua publica o fim da janela').not.toBeNull();
        const duracao = limites.fim - limites.inicio;
        const feicaoInicio = limites.inicio - 3 * duracao;
        const feicaoFim = limites.inicio - 2 * duracao;
        await definirJanelaDaFeicao(page, id, feicaoInicio, feicaoFim);

        // A PREMISSA, conferida em vez de suposta: o cursor está mesmo depois do fim da feição.
        const cursor = await cursorDaRegua(track);
        expect(cursor, 'o cursor é finito').not.toBeNull();
        expect(cursor).toBeGreaterThan(feicaoFim);

        // Com revelar DESLIGADO a feição sai da tela, e o filtro da camada cita a cláusula
        // temporal (o segundo sinal, independente do desenho).
        await expect.poll(() => pontoDesenhado(page, id), { timeout: 10000 }).toBe(false);
        expect(await filtroCitaTempo(page)).toBe(true);

        // LIGAR: a cláusula de ocultação é suprimida e a feição volta a ser consultável.
        await reveal.click();
        await expect(reveal).toHaveAttribute('aria-pressed', 'true', { timeout: 5000 });
        await expect.poll(() => pontoDesenhado(page, id), { timeout: 10000 }).toBe(true);
        await expect.poll(() => filtroCitaTempo(page), { timeout: 5000 }).toBe(false);

        // DESLIGAR: e ela some de novo, que é o controle negativo do gesto anterior.
        await reveal.click();
        await expect(reveal).toHaveAttribute('aria-pressed', 'false', { timeout: 5000 });
        await expect.poll(() => pontoDesenhado(page, id), { timeout: 10000 }).toBe(false);
        await expect.poll(() => filtroCitaTempo(page), { timeout: 5000 }).toBe(true);
    });

    test.describe('reprodução (mede tempo: sem repetição automática)', () => {
        // O retry do config (1) re-executaria um caso que mede taxa e fecharia a rodada verde
        // com o defeito só rotulado `flaky`, que é exatamente a medição única de algo
        // probabilístico que a constituição proíbe. Aqui a corrida É o sujeito.
        test.describe.configure({ retries: 0 });

        test('§29.2 reproduzir faz o CURSOR avançar, e pausar o congela', async ({ page }) => {
            await bootApp(page);
            const bar = await enableTemporalBar(page);

            const track = bar.locator('.temporal-bar__track');
            const timeLabel = bar.locator('.temporal-bar__time');
            const playBtn = bar.locator('.temporal-bar__play');

            // Começa do início da janela, para a medida caber inteira dentro dela.
            await levarCursorPara(page, track, 0.02);
            const antes = await cursorDaRegua(track);
            expect(antes, 'a régua publica um cursor finito').not.toBeNull();
            const rotuloAntes = await timeLabel.innerText();

            await expect(playBtn).toHaveAttribute('aria-label', 'Reproduzir');
            await clicar(playBtn);
            await expect(playBtn).toHaveAttribute('aria-label', 'Pausar', { timeout: 5000 });

            // O EFEITO, e não o rótulo: o cursor anda, e o instante mostrado anda com ele.
            await expect.poll(() => cursorDaRegua(track), { timeout: 15000 }).toBeGreaterThan(antes);
            await expect.poll(() => timeLabel.innerText(), { timeout: 15000 }).not.toBe(rotuloAntes);

            // PAUSAR CONGELA, que é a metade que separa "o botão alterna" de "a reprodução para".
            await clicar(playBtn);
            await expect(playBtn).toHaveAttribute('aria-label', 'Reproduzir', { timeout: 5000 });
            await page.waitForTimeout(300); // deixa o quadro em voo terminar
            const aoPausar = await cursorDaRegua(track);
            // Sem esta linha, dois `null` seguidos (a régua deixou de publicar o cursor) seriam
            // lidos como "congelou", que é o verde mais enganoso possível neste caso.
            expect(aoPausar, 'a régua continua publicando o cursor depois da pausa').not.toBeNull();
            await page.waitForTimeout(1500);
            expect(await cursorDaRegua(track)).toBe(aoPausar);
        });

        test('§29.5 a velocidade escolhida chega ao controlador: a TAXA de avanço muda', async ({ page }) => {
            await bootApp(page);
            const bar = await enableTemporalBar(page);

            const track = bar.locator('.temporal-bar__track');
            const playBtn = bar.locator('.temporal-bar__play');
            const speed = bar.locator('.temporal-bar__speed');

            await expect(speed).toHaveValue('1');

            /**
             * Taxa de avanço do cursor (ms de linha do tempo por ms real) na velocidade pedida.
             * @param {string} valor - Valor da opção do seletor.
             * @returns {Promise<number>}
             */
            const medirTaxa = async (valor) => {
                await speed.selectOption(valor);
                await expect(speed).toHaveValue(valor);
                await levarCursorPara(page, track, 0.02);

                const partida = await cursorDaRegua(track);
                expect(partida, 'a régua publica um cursor finito antes de reproduzir').not.toBeNull();
                await clicar(playBtn);
                await expect(playBtn).toHaveAttribute('aria-label', 'Pausar', { timeout: 5000 });
                // Só começa a medir depois que o cursor JÁ andou: assim a amostra não inclui o
                // intervalo entre o clique e o primeiro quadro, que é ruído puro.
                await expect.poll(() => cursorDaRegua(track), { timeout: 15000 }).toBeGreaterThan(partida);

                const v0 = await cursorDaRegua(track);
                const t0 = Date.now();
                await page.waitForTimeout(1200);
                const v1 = await cursorDaRegua(track);
                const t1 = Date.now();
                expect(v0, 'a amostra tem um cursor de partida').not.toBeNull();
                expect(v1, 'a amostra tem um cursor de chegada').not.toBeNull();

                // A AMOSTRA NÃO PODE TER BATIDO NO FIM DA JANELA: lá a reprodução para sozinha,
                // a taxa satura e a razão entre as duas velocidades vira uma medida do teto.
                await expect(playBtn).toHaveAttribute('aria-label', 'Pausar');
                await clicar(playBtn);
                await expect(playBtn).toHaveAttribute('aria-label', 'Reproduzir', { timeout: 5000 });

                return (v1 - v0) / (t1 - t0);
            };

            const lenta = await medirTaxa('1');
            const rapida = await medirTaxa('5');

            // A reprodução anda nas duas (senão a razão abaixo seria 0/0 com cara de medida).
            expect(lenta).toBeGreaterThan(0);
            expect(rapida).toBeGreaterThan(0);

            // A RAZÃO, com folga larga: o nominal é 5, e o que se mede aqui é que o número
            // escolhido ATRAVESSA até o laço de reprodução, não a fórmula que o converte em
            // avanço. Um seletor que só repinta o próprio valor dá razão 1.
            const razao = rapida / lenta;
            expect(razao, `taxa 1x=${lenta} 5x=${rapida}`).toBeGreaterThan(2);
            expect(razao, `taxa 1x=${lenta} 5x=${rapida}`).toBeLessThan(12);
        });
    });
});
