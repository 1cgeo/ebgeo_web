// Path: e2e-ui/vazamento-viewers.spec.js

/**
 * §30 VAZAMENTO DE RECURSO ao abrir e fechar os visualizadores, em Chromium real, contra o
 * backend real e um modelo 3D REAL (`backend/data/models3d/serra_dourada.3dtiles`, servido por
 * `/api/v1/assets3d/m/...`).
 *
 * O QUE ESTE SPEC PRENDE. Abrir e fechar o visualizador 3D deixava para trás um listener de
 * clique por abertura (`initActiveToolChip3D`, `map_3d.js`), pendurado num botão que nunca sai
 * do documento. Medido em 2026-08-31 numa bancada de catorze ciclos: +1 listener vivo por
 * ciclo, monotônico, confirmado pelas duas sondas independentes (a de `helpers/sonda-vazamento.js`
 * e o `Memory.getDOMCounters.jsEventListeners` do próprio Chrome, que concordaram no mesmo
 * número). O 360 e a primeira pessoa, medidos com a mesma bancada, não acumulam nada: trinta e
 * cinco panorâmicas de 5120x2560 navegadas em sequência deixam a memória plana.
 *
 * A ORDEM DOS DOIS TESTES NÃO É ARBITRÁRIA. §30.1 exercita o PIOR CASO num vazador deliberado e
 * exige que a régua o reprove; só então §30.2 deixa a régua julgar o app. Régua vista só passar
 * em código bom não foi vista funcionar, e uma sonda que conte errado devolve verde silencioso,
 * que é o único resultado pior que vermelho.
 *
 * POR QUE A CONTAGEM É DE LISTENER VIVO, e não de memória. Memória de processo tem amplitude de
 * dezenas de megabytes entre ciclos, e afirmação dentro da amplitude é invenção; a contagem de
 * listener é inteira, determinística e não passa por coletor de lixo. O crescimento de MEMÓRIA
 * do visualizador 3D é assunto da bancada, que roda fora da suíte por ser cara.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { seedModelo3d } from './helpers/catalog-seed.js';
import { SONDA_VAZAMENTO, contarRecursos, diferencaPorTipo } from './helpers/sonda-vazamento.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** O id que este spec registra para si. */
const TILESET_ID = 'serra_dourada';

/**
 * O modelo REAL do repositório. Um tileset cujo `tileset.json` responde 404 abre uma cena vazia
 * e volta para o 2D sem erro nenhum, e o ciclo passaria a medir o nada com cara de medir o 3D.
 */
const TILESET_URL = '/api/v1/assets3d/m/serra_dourada/tileset.json';

/** Ciclos de aquecimento (primeira importação de módulo, primeiro shader) e ciclos medidos. */
const AQUECIMENTO = 2;
const MEDIDOS = 4;

/**
 * Registra um tileset no catálogo PELA ROTA, como administrador.
 *
 * Pela rota, e não por `INSERT`: o `GET /api/config` é memoizado no processo do backend e a
 * invalidação está pendurada na escrita que passa pelo roteador (`config.cache.js`), então um
 * `UPDATE` direto deixaria o app vendo o catálogo velho. A conta nasce no lado Node com o
 * e-mail confirmado e é promovida no Postgres, porque não existe caminho de autosserviço para
 * `admin`, e inventar um para um teste seria inventar uma funcionalidade do produto.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function registrarTileset(page) {
    await page.goto('/');
    const creds = await createVerifiedUser({ prefix: 'vaz3dadm', nome: 'Vazamento Admin', role: 'admin' });

    /** Uma escrita de catálogo pela rota, autenticada. Devolve status e corpo. */
    const escreverNoCatalogo = (metodo, caminho, corpo) => page.evaluate(
        async ({ url, creds: c, metodo: m, caminho: p, corpo: b }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const api = new ApiClient({ baseUrl: `${url}/api/v1` });
            await api.login(c.username, c.password);
            const res = await fetch(`${url}/api/v1${p}`, {
                method: m,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${api.getAccessToken()}`,
                },
                body: JSON.stringify(b),
            });
            return { status: res.status, body: await res.text() };
        },
        { url: state.baseUrl, creds, metodo, caminho, corpo },
    );

    const corpoDoTileset = {
        name: 'Modelo 3D do teste de vazamento',
        config: {
            url: TILESET_URL,
            tipo: 'Modelo 3D',
            forma3d: 'tiles3d',
            locate: { lon: -49.234532321267736, lat: -16.69905348466392, height: 511.8 },
        },
    };

    // 1) A metade de CATÁLOGO. 409 é sucesso: o `retries: 1` do config roda este registro de
    // novo com o mesmo id, e reprovar a segunda tentativa esconderia a falha real atrás de um
    // conflito de id.
    const criado = await escreverNoCatalogo('POST', '/tilesets', { id: TILESET_ID, ...corpoDoTileset });
    expect(
        criado.status === 409 || criado.status < 300,
        `o tileset nao foi registrado no catalogo: ${criado.status} ${criado.body}`,
    ).toBe(true);

    // 2) A metade de PRODUÇÃO, que diz QUAL arquivo serve os bytes. Sem ela o JOIN de
    // `resolverModelo3d` não acha nada e a rota responde 404 "3D model not found", o
    // visualizador volta para o 2D, e o teste ficaria verde sem ter aberto modelo nenhum.
    await seedModelo3d(state.dbName, { modelId: TILESET_ID });

    // 3) Uma segunda escrita PELA ROTA, depois do INSERT. O índice de modelos
    // (`models3d.index.js`) é memoizado e sua invalidação está pendurada na escrita de
    // catálogo, então um `INSERT` puro ficaria invisível por até sessenta segundos: a rota
    // volta a ser chamada só para derrubar o memo.
    const atualizado = await escreverNoCatalogo('PUT', `/tilesets/${TILESET_ID}`, corpoDoTileset);
    expect(
        atualizado.status < 300,
        `nao foi possivel invalidar o indice de modelos: ${atualizado.status} ${atualizado.body}`,
    ).toBe(true);

    // Derruba a sessão antes do boot: sessão viva numa URL nua é roteada para `atlas.html`,
    // que não tem mapa nenhum, e o `bootar` esperaria para sempre por um botão que não existe.
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
}

/** Sobe o app e espera o mapa 2D. */
async function bootar(page) {
    await page.goto('/');
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(
        () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function',
        null,
        { timeout: 20000 },
    );
}

/** O container do visualizador 3D está à mostra? */
function container3dVisivel(page) {
    return page.evaluate(() => {
        const el = document.getElementById('map-3d-container');
        return el !== null && el.style.display !== 'none';
    });
}

/**
 * Um ciclo completo de produção: abre pelo deep link (o mesmo caminho do popup, do catálogo e
 * do link compartilhado) e fecha pelo botão.
 * @param {import('@playwright/test').Page} page
 * @param {string[]} [falhasDeRede] Buffer que o chamador esvazia e lê em caso de falha.
 * @returns {Promise<{abriu: boolean, botoesDeFerramenta: number}>} `botoesDeFerramenta` é a
 *   PROVA de que o ciclo alcançou o trecho sob teste: `registerToolEventListeners` sai antes de
 *   registrar coisa alguma quando `.button-tool-3d` não casa com nada, e um ciclo que não passa
 *   por lá fica verde com o defeito presente.
 */
async function cicloAbreFecha(page, falhasDeRede = []) {
    falhasDeRede.length = 0;
    await page.evaluate((id) => { window.location.hash = `view=3d&tileset=${id}`; }, TILESET_ID);

    const abriu = await page
        .waitForFunction(
            () => {
                const el = document.getElementById('map-3d-container');
                const visivel = el !== null && el.style.display !== 'none';
                const v = window.map;
                const vivo = !!(v && typeof v.isDestroyed === 'function' && !v.isDestroyed() && v.scene);
                return visivel && vivo;
            },
            null,
            // Sessenta segundos, e não trinta: com a máquina carregada (logo depois da suíte
            // de backend) o Cesium não subiu dentro de trinta em 1 de 3 rodadas, e o spec se
            // pulou por limite de ambiente que não era limite nenhum. Pulo por lentidão é a
            // pior saída das três, porque não reprova nem verifica.
            { timeout: 60000 },
        )
        .then(() => true)
        .catch(() => false);

    if (!abriu) return { abriu: false, botoesDeFerramenta: 0 };

    // Deixa a cena assentar antes de fechar: fechar no meio da carga mede o vizinho, e não o
    // ciclo. O `registerToolEventListeners` do app roda num `setTimeout(…, 100)` depois da
    // abertura, então fechar antes disso pularia justamente o trecho sob teste.
    await page.waitForTimeout(2500);
    const botoesDeFerramenta = await page.evaluate(
        () => document.querySelectorAll('.button-tool-3d').length,
    );

    await page.locator('#close-3d-viewer-button').evaluate((el) => el.click());
    await expect.poll(() => container3dVisivel(page), { timeout: 8000 }).toBe(false);
    await page.waitForTimeout(500);
    return { abriu: true, botoesDeFerramenta };
}

describeOrSkip('§30 vazamento de recurso ao abrir e fechar visualizador', () => {
    /**
     * Respostas de erro do ciclo corrente. Um ciclo que não abre precisa dizer POR QUE não
     * abriu: sem isso, "falhou em abrir" é indistinguível de ambiente sem WebGL, de asset
     * ausente e de defeito do produto, e as três pedem coisas diferentes de quem lê.
     */
    const falhasDeRede = [];

    test.beforeEach(async ({ page }) => {
        await page.addInitScript(SONDA_VAZAMENTO);
        page.on('response', async (res) => {
            if (res.status() < 400) return;
            // Quem respondeu importa tanto quanto o número: o app fala com o Vite, que faz proxy
            // para o backend, e um 404 do proxy e um 404 da rota pedem coisas opostas de quem lê.
            let quem = '';
            try {
                const h = res.headers();
                quem = ` [servidor=${h.server ?? h['x-powered-by'] ?? '?'}]`;
                if (res.url().includes('/assets3d/')) quem += ` corpo=${(await res.text()).slice(0, 120)}`;
            } catch { /* resposta já descartada */ }
            falhasDeRede.push(`${res.status()} ${res.url().slice(-80)}${quem}`);
        });
        page.on('requestfailed', (req) => {
            falhasDeRede.push(`ABORTOU ${req.url().slice(-90)} ${req.failure()?.errorText ?? ''}`);
        });
    });

    test('§30.1 a régua reprova o PIOR CASO (controle do instrumento)', async ({ page }) => {
        await bootar(page);

        const antes = await contarRecursos(page);
        const CICLOS = 3;
        for (let i = 0; i < CICLOS; i++) {
            await page.evaluate(() => window.__sondaVazamento.vazarDeProposito());
        }
        const depois = await contarRecursos(page);

        // O vazador retém, por chamada, 20 listeners de `document`, 1 contexto WebGL e 1 timer.
        // Se qualquer uma das três contas não bater, a sonda não está medindo o que se pensa que
        // ela mede, e o §30.2 abaixo não pode ser lido.
        expect(
            depois.listeners - antes.listeners,
            `a sonda nao viu os listeners retidos; cresceu em: ${diferencaPorTipo(antes, depois)}`,
        ).toBe(20 * CICLOS);
        expect(depois.contextosWebgl - antes.contextosWebgl).toBe(CICLOS);
        expect(depois.intervalos - antes.intervalos).toBe(CICLOS);
    });

    test('§30.2 abrir e fechar o visualizador 3D nao acumula listener', async ({ page }) => {
        test.setTimeout(300000);
        await registrarTileset(page);
        await bootar(page);

        for (let i = 0; i < AQUECIMENTO; i++) {
            const { abriu } = await cicloAbreFecha(page, falhasDeRede);
            if (!abriu) {
                // O motivo do `skip` não aparece no relator de linha, e um pulo sem motivo
                // visível é o mesmo que um verde sem verificação.
                console.log(`[§30.2] aquecimento ${i + 1} nao abriu. Rede: ${falhasDeRede.join(' | ') || '(nada)'}`);
                test.skip(
                    true,
                    'o visualizador Cesium nao subiu neste ambiente (sem WebGL, ou o asset 3D nao e servido); '
                    + `a asserção de vazamento nao pode ser lida, e enfraquecê-la seria inventar verde. `
                    + `Respostas de erro no ciclo: ${falhasDeRede.slice(0, 5).join(' | ') || '(nenhuma)'}`,
                );
                return;
            }
        }

        const antes = await contarRecursos(page);
        for (let i = 0; i < MEDIDOS; i++) {
            const { abriu, botoesDeFerramenta } = await cicloAbreFecha(page, falhasDeRede);
            expect(
                abriu,
                `o ciclo medido ${i + 1} falhou em abrir o visualizador. Respostas de erro: `
                + `${falhasDeRede.slice(0, 5).join(' | ') || '(nenhuma)'}`,
            ).toBe(true);
            // Sem barra de ferramentas 3D no documento, `registerToolEventListeners` retorna
            // antes de registrar nada, e este teste ficaria verde COM o defeito presente. A
            // cobertura vazia é o modo de falha mais caro deste repositório, e ela se prende
            // aqui, e não na leitura do resultado.
            expect(
                botoesDeFerramenta,
                `o ciclo ${i + 1} abriu o visualizador mas nao havia botao .button-tool-3d no `
                + 'documento: o trecho sob teste nao foi exercitado, e o verde abaixo nao valeria',
            ).toBeGreaterThan(0);
        }
        const depois = await contarRecursos(page);

        expect(
            depois.listeners - antes.listeners,
            `${MEDIDOS} ciclos de abrir e fechar deixaram listener vivo para tras. Cresceu em: `
            + `${diferencaPorTipo(antes, depois)}`,
        ).toBe(0);

        // Um contexto WebGL por abertura quebraria a tela sem erro nenhum depois de cerca de
        // dezesseis, então ele é asserido junto, e não em teste separado.
        expect(
            depois.contextosWebgl - antes.contextosWebgl,
            'o visualizador criou contexto WebGL novo a cada abertura',
        ).toBe(0);
    });
});
