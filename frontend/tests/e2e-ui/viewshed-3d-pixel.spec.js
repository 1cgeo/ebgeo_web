// Path: e2e-ui/viewshed-3d-pixel.spec.js

/**
 * @fileoverview O PRIMEIRO teste de PIXEL do viewshed 3D deste repositório, e a razão de ele
 * existir está escrita em `docs/wiki/viewshed-3d.md` (o aceite da reescrita foi absorvido por ela): até 2026-09-15 a
 * análise de visibilidade era medida só como ENTIDADE (create/update/delete conferidos no snapshot
 * do servidor, em `browser-cesium3d*.spec.js`), e nenhuma suíte construía um `ViewShed3D`. Quem
 * trocasse o motor e visse a suíte verde não teria medido o motor. Este arquivo é a trava que
 * permite trocá-lo: ele congela o DESENHO, não a entidade.
 *
 * O QUE ELE MEDE, em cinco camadas, da mais frágil para a mais robusta:
 *
 *   1. **Pixel contra referência versionada** (`__referencias__/viewshed-3d.png`), por percentual
 *      de pixels diferentes. É a camada que pega uma mudança de cor, de projeção ou de bias.
 *   2. **Classificação visível/oculto** contra a mesma referência. Separa a ANÁLISE do DESENHO do
 *      tronco, e foi ela que deu o número da troca de motor de 2026-09-15.
 *   3. **Proporção de verde (visível) e vermelho (oculto)**, com folga declarada. Sobrevive a
 *      ruído de rasterização e a uma troca de GPU; morre se o shader parar de separar as duas
 *      metades, que é o defeito que importa.
 *   4. **O tronco de visão desenhado** (o fio de arame branco), contado em pixels.
 *   5. **Um retângulo de chão SEM oclusão**, dentro do setor e longe das duas cunhas de sombra,
 *      onde o vermelho tem de ser residual. É a camada que pega a acne do mapa de sombras, que é
 *      um erro de RESPOSTA (chão visível declarado oculto) e não de estilo.
 *   6. **O painel "Visibilidade #1"** com 120°, 186 m e 1,5 m, que é o contrato do chamador.
 *
 * AS TRÊS ÚLTIMAS SÃO INDEPENDENTES DE PIXEL EXATO DE PROPÓSITO. A referência sozinha é frágil
 * (troca de driver, de versão do Chromium, de tamanho de viewport) e, quando falha, não diz o que
 * mudou. As proporções dizem.
 *
 * A REFERÊNCIA FOI REGERADA EM 2026-09-15, quando o motor deixou de ser o vendor ofuscado e passou
 * a ser `frontend/src/js/3d_models_viewer_tool/services/viewshed-3d.js` (decisão D15). A troca foi
 * medida nas duas imagens e o número que importa é o DA CLASSE: 5,307% dos pixels mudaram, mas só
 * 2,651% mudaram de classe, e a maior parte do resto é o fio de arame, que trocou de tesselação
 * porque o sensor retangular de terceiro não foi portado. Verde e vermelho ficaram em 15,379% e
 * 6,776%, contra 15,192% e 6,943% do vendor, dentro das MESMAS faixas declaradas abaixo, que não
 * precisaram mudar.
 *
 * E FOI REGERADA DE NOVO NO MESMO DIA, PELA REVISÃO, e desta vez as faixas MUDARAM, porque o que
 * mudou foi a resposta. `SHADOW_DEPTH_BIAS` passou de 2e-5 para 8e-5: o valor antigo era o do
 * Cesium, que vale no pipeline dele (onde o receptor tem a normal da superfície), e num
 * pós-processamento de tela cheia ele deixava metade do chão plano listrado de VERMELHO, ou seja,
 * declarado oculto quando o observador o enxerga. Verde e vermelho foram de 15,379% e 6,776% para
 * 17,331% e 4,824%, com a área tingida TOTAL praticamente intacta (195072 contra 195248 pixels,
 * 0,09%): o que aconteceu foi vermelho falso virando verde, e não o setor mudando de tamanho. A
 * quinta camada abaixo é nova e existe para isso: ela mede um retângulo de chão que ninguém oclui
 * e cobra que ele esteja limpo.
 *
 * A CENA É NOSSA, E ISSO É DECLARADO. A captura de 2026-09-14 citada no inventário de vendors usou
 * um tileset local que **não existe neste repositório** (`frontend/public/3d/` é ignorado pelo git,
 * e a única coisa versionada ali são dois `.gitkeep`), então "o mesmo tileset da captura" não é
 * reproduzível em máquina nenhuma, nem naquela, depois de um `git clean`. O que este spec faz é o
 * contrário: monta uma cena DETERMINÍSTICA de primitivas do próprio Cesium (um chão e dois blocos
 * que projetam sombra sobre ele), com câmera fixa, terreno de elipsoide e nenhuma imagem de fundo.
 * Nada nela depende de rede, de disco ou de ordem de carregamento, e é por isso que ela serve de
 * referência de pixel: três rodadas em série deram 0 de 881280 pixels diferentes.
 *
 * DUAS PROPRIEDADES DO MOTOR QUE SÓ A MEDIÇÃO ENTREGA, e que decidem a forma desta cena:
 *
 *   - **Toda primitiva que deva ocluir precisa de `shadows: ShadowMode.ENABLED`.** O viewshed é um
 *     `ShadowMap` com a câmera no observador, e só entra na textura de profundidade quem CASTA. O
 *     padrão de `Primitive` é `ShadowMode.DISABLED` (o de `Cesium3DTileset` é `ENABLED`), então sem
 *     essa linha a cena sai inteira verde e o teste mediria a ausência de oclusão.
 *   - **O GLOBO NUNCA É TINGIDO POR ESTE PÓS-PROCESSAMENTO, e os blocos sobre ele são.** Medido
 *     nesta árvore em 2026-09-15: com o terreno como chão, o leque não pintava um pixel, em
 *     distância nenhuma, enquanto os blocos recebiam verde e vermelho normalmente. Por isso o chão
 *     desta cena é uma PRIMITIVA achatada, e não o globo. Isso não empobrece a medição: a
 *     ferramenta de viewshed 3D existe dentro do visualizador de MODELOS, onde o chão é um tileset,
 *     que casta e é tingido como qualquer primitiva.
 *
 * COMO REGERAR A REFERÊNCIA: `EBGEO_VIEWSHED_REFERENCIA=1 npx playwright test viewshed-3d-pixel`.
 * A imagem produzida em cada rodada fica em `test-results/viewshed-3d-atual.png` para leitura
 * humana, e a rodada sempre a escreve, verde ou vermelha, porque comparar duas imagens é o único
 * jeito de saber o que o percentual significa.
 */

import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DIR_REFERENCIA = path.join(AQUI, '__referencias__');
const REFERENCIA = path.join(DIR_REFERENCIA, 'viewshed-3d.png');
const DIR_SAIDA = path.resolve(AQUI, '../../test-results');
const REGERAR = process.env.EBGEO_VIEWSHED_REFERENCIA === '1';

/** Tileset que este spec registra para si. O documento raiz é servido pela rota interceptada. */
const TILESET_ID = 'e2e-viewshed-pixel';

/**
 * O `tileset.json` que a rota interceptada devolve: raiz VÁLIDA e SEM conteúdo.
 *
 * ELE NÃO É ENFEITE, E A AUSÊNCIA DELE DERRUBA O SPEC INTEIRO DE UM JEITO QUE NÃO SE ADIVINHA.
 * `frontend/public/3d/` é ignorado pelo git, então `/3d/<id>/tileset.json` responde 404 em qualquer
 * checkout limpo; `Cesium3DTileset.fromUrl` rejeita, `openViewerWithTileset` relança depois de
 * acusar, e quem chamou fecha o visualizador. O container volta a `display:none`, o `resize` do
 * Cesium copia `clientWidth` zero para o canvas, e a leitura de pixel morre com
 * "canvas element with a width or height of 0" — uma mensagem que fala do canvas e não da causa.
 * Medido nesta árvore em 2026-09-15, antes desta rota existir.
 *
 * A raiz sem `content` é deliberada: o que oclui nesta cena são as primitivas de `montarCena`, que
 * não dependem de nenhum byte de disco. O tileset existe para que o caminho de produção do
 * visualizador COMPLETE, que é a precondição de tudo o que vem depois.
 */
const TILESET_VAZIO = {
    asset: { version: '1.1' },
    geometricError: 0,
    root: {
        boundingVolume: { region: [-0.754, -0.3997, -0.7538, -0.3995, 0, 60] },
        geometricError: 0,
        refine: 'ADD',
    },
};

/**
 * OS PARÂMETROS SÃO FIXOS E SÃO O SUJEITO DO TESTE. 120° é o padrão do produto
 * (`DEFAULT_VIEWSHED_PARAMS.horizontalAngle`) e cabe num único sub-viewshed, porque o corte em dois
 * ou três só acontece acima de 150° (`MAX_SINGLE_VIEWSHED_ANGLE`).
 */
const PARAMS = { horizontalAngle: 120, verticalAngle: 120, distance: 186, observerHeight: 1.5 };

/** O observador e o alvo, em graus. O alvo fica ao NORTE, na distância pedida. */
const OBSERVADOR = { longitude: -43.2, latitude: -22.9 };
/** 186 m ao norte, em graus de latitude (1 grau ~ 110574 m). */
const PASSO_NORTE = PARAMS.distance / 110574;

/**
 * Altura, em metros acima do elipsoide, do TOPO do chão de primitiva sobre o qual a cena inteira
 * se assenta. É também o `terrainBaseHeight` do viewshed, de modo que o observador fica a 1,5 m
 * acima do chão que ele vê (e não a 1,5 m acima do elipsoide, que é um metro e meio dentro dele).
 */
const PISO = 2;

/** Tamanho da janela, fixo: a referência é do tamanho do canvas, e ele deriva daqui. */
const JANELA = { width: 1280, height: 720 };

/**
 * Registra um tileset no catálogo, como administrador, pela rota real.
 * Copiado em forma de `viewer-3d-open.spec.js`, que carrega a razão por extenso.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function registrarTileset(page) {
    await page.goto('/');
    const creds = await createVerifiedUser({ prefix: 'vspixel', nome: 'Viewshed Pixel', role: 'admin' });

    const criado = await page.evaluate(async ({ url, creds: c, id, obs }) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const api = new ApiClient({ baseUrl: `${url}/api/v1` });
        await api.login(c.username, c.password);
        const res = await fetch(`${url}/api/v1/tilesets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.getAccessToken()}` },
            body: JSON.stringify({
                id,
                name: 'Cena de pixel do viewshed',
                config: {
                    url: `/3d/${id}/tileset.json`,
                    tipo: 'Modelo 3D',
                    // `locate.height` ausente vira `fromDegrees(lon, lat, undefined)`, ou seja,
                    // câmera padrão NO CHÃO olhando para o horizonte. Ver `fixarCamera`.
                    locate: { lon: obs.longitude, lat: obs.latitude, height: 200 },
                    // `heightOffset` ausente vira `Cartesian3.fromRadians(lon, lat, undefined)` no
                    // `modelMatrix` que `createOptimizedTileset` monta, ou seja, NaN.
                    heightOffset: 0,
                },
            }),
        });
        return { status: res.status, body: await res.text() };
    }, { url: state.baseUrl, creds, id: TILESET_ID, obs: OBSERVADOR });

    // 409 E SUCESSO AQUI. O catalogo e GLOBAL e a rodada e UMA: o segundo caso deste arquivo
    // registra o mesmo id que o primeiro ja registrou, e a rota responde CONFLICT. O que
    // interessa e o tileset ESTAR no catalogo ao fim da chamada, nao esta chamada ter sido a que
    // o criou. Tratar 409 como falha faria o segundo caso reprovar por ordem de execucao, que e
    // exatamente o tipo de vermelho que nao fala do produto.
    expect(
        criado.status === 409 || criado.status < 300,
        `o tileset nao esta no catalogo: ${criado.status} ${criado.body}`,
    ).toBe(true);

    // Sessão viva numa URL nua é roteada para `atlas.html`, que não tem mapa nenhum.
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
}

/**
 * Instala a rota que serve o documento raiz do tileset. Ver `TILESET_VAZIO`.
 * @param {import('@playwright/test').Page} page
 */
async function servirTileset(page) {
    await page.route(
        (url) => url.pathname.endsWith(`/3d/${TILESET_ID}/tileset.json`),
        async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(TILESET_VAZIO),
            });
        },
    );
}

/**
 * Sobe o app 2D e espera o mapa responder.
 * @param {import('@playwright/test').Page} page
 */
async function bootar(page) {
    await page.goto('/');
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(
        () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function',
        null,
        { timeout: 20000 },
    );
}

/**
 * Abre o visualizador 3D pelo caminho de produção (deep link) e espera o Cesium vivo.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<boolean>} false quando o ambiente não tem WebGL (caso de pulo honesto)
 */
async function abrirVisualizador3d(page) {
    await page.evaluate((id) => { window.location.hash = `view=3d&tileset=${id}`; }, TILESET_ID);
    return page
        .waitForFunction(
            () => {
                const el = document.getElementById('map-3d-container');
                const visivel = el !== null && el.style.display !== 'none';
                const v = window.map;
                const vivo = !!(v && typeof v.isDestroyed === 'function' && !v.isDestroyed() && v.scene);
                // A CONDICAO NAO PERGUNTA MAIS PELA CLASSE, e a mudanca foi paga: ate
                // 2026-09-15 ela exigia `window.Cesium.ViewShed3D`, que so existia porque um
                // `<script>` ofuscado pendurava a classe no global. Trocado o motor por codigo da
                // casa (`services/viewshed-3d.js`), aquela pergunta passou a ser sempre falsa e o
                // caso inteiro se AUTO-PULOU, verde, sem medir um pixel. Um guarda de ambiente que
                // cita um simbolo do sujeito medido vira um interruptor de desligar o teste.
                return visivel && vivo;
            },
            null,
            { timeout: 30000 },
        )
        .then(() => true)
        .catch(() => false);
}

/**
 * Monta a cena determinística: câmera fixa, dois blocos que castam sombra, sem animação.
 * @param {import('@playwright/test').Page} page
 * @param {{ longitude: number, latitude: number }} obs
 */
async function montarCena(page, obs) {
    await page.evaluate(async ({ obs: o, piso: PISO }) => {
        const C = window.Cesium;
        const viewer = window.map;
        const cena = viewer.scene;

        // Sem animação de relógio e sem iluminação de sol: a cor de cada pixel tem de depender
        // apenas da geometria, senão a referência envelhece por hora do dia.
        viewer.clock.shouldAnimate = false;
        cena.globe.enableLighting = false;
        cena.fog.enabled = false;
        if (cena.skyAtmosphere) cena.skyAtmosphere.show = false;
        cena.globe.showGroundAtmosphere = false;

        // AS TRÊS LINHAS SEGUINTES SÃO O QUE TORNA A REFERÊNCIA COMPARÁVEL, e cada uma fechou um
        // buraco visto na primeira captura desta cena:
        //
        // 1. o `/api/config` do backend descartável traz um servidor de tiles de verdade, e a
        //    primeira imagem saiu com um mapa de ruas por baixo: pixel que depende de rede e de
        //    quem publicou o tile naquele dia não é referência, é sorteio;
        // 2. o provedor de terreno do mesmo config dá ELEVAÇÃO REAL, e com ela o observador a
        //    1,5 m de altura ELIPSOIDAL nasce dezenas de metros ABAIXO do chão, de onde quase tudo
        //    está oculto. Foi o que fez a primeira captura desenhar um tapete verde ao sul e nada
        //    ao norte, com a direção certa o tempo todo. O elipsoide põe o chão em zero, que é a
        //    altura em que a cena está escrita;
        // 3. o globo preto (`map_3d.js` o pinta de preto) aceita a tinta do viewshed, mas o
        //    resultado é (0, 0.5, 0) contra (0,0,0), o que deixa o contraste dependendo de um bit.
        //    O cinza médio separa as três classes de cor com folga.
        viewer.imageryLayers.removeAll();
        viewer.terrainProvider = new C.EllipsoidTerrainProvider();
        cena.globe.baseColor = new C.Color(0.35, 0.35, 0.35, 1.0);

        /**
         * Um bloco opaco, deslocado do observador em metros (leste, norte), assentado sobre `piso`.
         * @param {number} leste
         * @param {number} norte
         * @param {number} largura
         * @param {number} altura
         * @param {number[]} rgb
         * @param {number} [piso]
         */
        const bloco = (leste, norte, largura, altura, rgb, piso = 0) => {
            const base = C.Cartesian3.fromDegrees(o.longitude, o.latitude, 0);
            const enu = C.Transforms.eastNorthUpToFixedFrame(base);
            const deslocado = C.Matrix4.multiplyByPoint(
                enu,
                new C.Cartesian3(leste, norte, piso + altura / 2),
                new C.Cartesian3(),
            );
            const modelo = C.Transforms.eastNorthUpToFixedFrame(deslocado);
            const geometria = C.BoxGeometry.fromDimensions({
                dimensions: new C.Cartesian3(largura, largura, altura),
                vertexFormat: C.PerInstanceColorAppearance.VERTEX_FORMAT,
            });
            const primitiva = new C.Primitive({
                geometryInstances: new C.GeometryInstance({
                    geometry: geometria,
                    modelMatrix: modelo,
                    attributes: {
                        color: C.ColorGeometryInstanceAttribute.fromColor(
                            new C.Color(rgb[0], rgb[1], rgb[2], 1.0),
                        ),
                    },
                }),
                appearance: new C.PerInstanceColorAppearance({ translucent: false, closed: true }),
                asynchronous: false,
                // SEM ESTA LINHA A CENA SAI INTEIRA VERDE: `Primitive` nasce
                // `ShadowMode.DISABLED`, e quem não casta não entra na textura de profundidade
                // do `ShadowMap` do viewshed.
                shadows: C.ShadowMode.ENABLED,
            });
            cena.primitives.add(primitiva);
            return primitiva;
        };

        // O CHÃO É UMA PRIMITIVA, NÃO O GLOBO, e a razão foi medida nesta árvore em 2026-09-15:
        // com o globo como chão, o viewshed tingia os BLOCOS e não tingia um pixel do terreno, em
        // qualquer distância. O globo é `ShadowMode.RECEIVE_ONLY` e é desenhado pelo caminho de
        // profundidade do próprio globo, que não é o que este pós-processamento reconstrói; um
        // tileset 3D, que é o chão real do produto nesta ferramenta, casta e é tingido como
        // qualquer primitiva. Medir sobre o globo seria medir o caso que o produto não usa.
        bloco(0, 40, 520, 2, [0.42, 0.42, 0.44]);

        // Dois blocos sobre esse chão, dentro do setor de 120° e da distância de 186 m: um perto e
        // à esquerda, outro mais longe e à direita. Cada um projeta uma faixa vermelha atrás de si.
        bloco(-22, 46, 16, 22, [0.75, 0.72, 0.68], PISO);
        bloco(26, 92, 20, 26, [0.68, 0.66, 0.62], PISO);

        // O globo precisa estar completo antes de qualquer leitura de pixel.
        await new Promise((resolve) => {
            let restantes = 600;
            const tenta = () => {
                if (cena.globe.tilesLoaded || restantes-- <= 0) { resolve(); return; }
                requestAnimationFrame(tenta);
            };
            tenta();
        });
    }, { obs, piso: PISO });
}

/**
 * Fixa a câmera no enquadramento da referência e CONFERE que ela ficou lá.
 *
 * A CONFERÊNCIA É O PONTO, e ela nasceu de um vermelho real: `loadCesiumAndInitWithTileset`
 * reposiciona a câmera DEPOIS de o visualizador ficar vivo (`restoreCameraPosition`, e no caso sem
 * posição salva um `setView` para `tilesetConfig.locate`). Um `setView` aplicado antes disso é
 * silenciosamente sobrescrito, e o que se fotografa é o CÉU. Na primeira rodada deste spec a imagem
 * saiu preta com estrelas e os três contadores em zero, sem nada dizer que a câmera tinha sido
 * movida por baixo. Por isso aqui se aplica, relê e repete.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ longitude: number, latitude: number }} obs
 */
async function fixarCamera(page, obs) {
    /**
     * Altura e recuo (metros) do enquadramento da referência. Escolhido para que o SETOR INTEIRO
     * caiba no quadro: a abertura de 120° e o corte em 186 m só provam alguma coisa se as duas
     * bordas e o arco distante estiverem na imagem. Com a câmera mais baixa o leque saía pelo topo
     * e a distância deixava de ser medida.
     */
    const ENQUADRAMENTO = { recuoNorte: -180, altura: 260, pitchGraus: -42 };

    /** @returns {Promise<{ altura: number, pitch: number }>} */
    const aplicarELer = () => page.evaluate(async ({ o, e }) => {
        const C = window.Cesium;
        const viewer = window.map;
        const alvo = C.Matrix4.multiplyByPoint(
            C.Transforms.eastNorthUpToFixedFrame(C.Cartesian3.fromDegrees(o.longitude, o.latitude, 0)),
            new C.Cartesian3(0, e.recuoNorte, e.altura),
            new C.Cartesian3(),
        );
        viewer.camera.setView({
            destination: alvo,
            orientation: { heading: 0, pitch: C.Math.toRadians(e.pitchGraus), roll: 0 },
        });
        await new Promise((resolve) => {
            let n = 12;
            const passa = () => (n-- <= 0 ? resolve() : requestAnimationFrame(passa));
            passa();
        });
        const carto = viewer.camera.positionCartographic;
        return { altura: carto.height, pitch: C.Math.toDegrees(viewer.camera.pitch) };
    }, { o: obs, e: ENQUADRAMENTO });

    await expect
        .poll(async () => {
            const lido = await aplicarELer();
            return Math.abs(lido.altura - ENQUADRAMENTO.altura) < 2 &&
                Math.abs(lido.pitch - ENQUADRAMENTO.pitchGraus) < 1;
        }, {
            timeout: 20000,
            message: 'a camera nao para no enquadramento da referencia: alguem a move depois do setView',
        })
        .toBe(true);
}

/**
 * Cria o viewshed pelo caminho do PRODUTO (store + a ferramenta), não por `new ViewShed3D`.
 * É o caminho que a reescrita vai trocar, então é ele que tem de estar sob medição.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ id: string, nome: string, subViewsheds: number }>}
 */
async function criarViewshed(page) {
    return page.evaluate(async ({ id: tilesetId, params, obs, passo, piso }) => {
        const loja = await import('/src/js/store/index.js');
        const ferramenta = await import('/src/js/3d_models_viewer_tool/tools/viewshed_tool_3d.js');
        const { getEventBus } = await import('/src/js/store/services.js');
        const { EventTypes } = await import('/src/js/events/event_types.js');

        const viewshed = await loja.addViewshed(tilesetId, {
            position: { longitude: obs.longitude, latitude: obs.latitude, height: piso },
            targetPosition: { longitude: obs.longitude, latitude: obs.latitude + passo, height: piso },
            terrainBaseHeight: piso,
            direction: { heading: 0, pitch: 0 },
            parameters: {
                horizontalAngle: params.horizontalAngle,
                verticalAngle: params.verticalAngle,
                distance: params.distance,
            },
            observerHeight: params.observerHeight,
        });

        await ferramenta.renderViewshedsForTileset(window.map, tilesetId);

        // A mesma emissão que `handleViewshedComplete` faz depois do clique interativo: é ela que
        // abre o painel de feição. Sem ela o painel não existe e a quarta camada mediria nada.
        getEventBus().emit(EventTypes.VIEWSHED_3D_CLICKED, { viewshed, tilesetId });

        // Deixa o pós-processamento assentar: o uniforme da matriz é recalculado por frame.
        await new Promise((resolve) => {
            let n = 30;
            const passa = () => (n-- <= 0 ? resolve() : requestAnimationFrame(passa));
            passa();
        });

        return {
            id: viewshed.id,
            nome: viewshed.properties.nome,
            subViewsheds: window.map.scene.primitives.length,
        };
    }, { id: TILESET_ID, params: PARAMS, obs: OBSERVADOR, passo: PASSO_NORTE, piso: PISO });
}

/**
 * Lê o canvas do Cesium como PNG e conta as classes de cor que o shader produz.
 *
 * A CONTAGEM É FEITA NO NAVEGADOR de propósito: não há decodificador de PNG em `node_modules`
 * (e `npm install` está fora de questão nesta árvore), e o `getImageData` de um canvas 2D responde
 * a mesma pergunta sem dependência nenhuma.
 *
 * As classes derivam do shader, que faz `mix(cor, vec4(corDoViewshed,1), 0.5)` sobre um globo
 * PRETO: verde vira (0, ~0.5, 0) e vermelho vira (~0.5, 0, 0). O fio de arame do sensor é branco.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ png: string, largura: number, altura: number, verde: number, vermelho: number, arame: number, limpoVermelho: number, limpoTotal: number, total: number }>}
 */
async function lerCanvas(page) {
    return page.evaluate(() => {
        const canvas = window.map.scene.canvas;
        const w = canvas.width;
        const h = canvas.height;

        const espelho = document.createElement('canvas');
        espelho.width = w;
        espelho.height = h;
        const ctx = espelho.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(canvas, 0, 0);
        const dados = ctx.getImageData(0, 0, w, h).data;

        let verde = 0;
        let vermelho = 0;
        let arame = 0;
        // O RETANGULO LIMPO: chao dentro do setor, a direita, abaixo da cunha do bloco distante e
        // longe das duas sombras. Nada nesta cena oclui esta area, entao todo vermelho aqui e
        // ACNE do mapa de sombras, isto e, chao visivel declarado oculto. As coordenadas sao do
        // enquadramento fixo da referencia (canvas 1224x720) e so fazem sentido com ele.
        const LIMPO = { x0: 820, x1: 1000, y0: 300, y1: 370 };
        let limpoVermelho = 0;
        let limpoTotal = 0;
        for (let i = 0; i < dados.length; i += 4) {
            const r = dados[i];
            const g = dados[i + 1];
            const b = dados[i + 2];
            const ehVermelho = r > 40 && r > g + 25 && r > b + 25;
            if (g > 40 && g > r + 25 && g > b + 25) verde++;
            else if (ehVermelho) vermelho++;
            else if (r > 190 && g > 190 && b > 190) arame++;
            const p = i / 4;
            const x = p % w;
            const y = (p - x) / w;
            if (x >= LIMPO.x0 && x < LIMPO.x1 && y >= LIMPO.y0 && y < LIMPO.y1) {
                limpoTotal++;
                if (ehVermelho) limpoVermelho++;
            }
        }

        return {
            png: espelho.toDataURL('image/png'),
            largura: w,
            altura: h,
            verde,
            vermelho,
            arame,
            limpoVermelho,
            limpoTotal,
            total: w * h,
        };
    });
}

/**
 * Compara duas imagens PNG (em data URL) pixel a pixel, DENTRO do navegador.
 * @param {import('@playwright/test').Page} page
 * @param {string} aDataUrl
 * @param {string} bDataUrl
 * @returns {Promise<{ diferentes: number, total: number, razao: number, mesmoTamanho: boolean }>}
 */
async function compararImagens(page, aDataUrl, bDataUrl) {
    return page.evaluate(async ({ a, b }) => {
        /** @param {string} url */
        const carregar = (url) => new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('imagem nao decodificou'));
            img.src = url;
        });

        const [ia, ib] = await Promise.all([carregar(a), carregar(b)]);
        if (ia.width !== ib.width || ia.height !== ib.height) {
            return { diferentes: -1, total: 0, razao: 1, mesmoTamanho: false };
        }

        /** @param {HTMLImageElement} img */
        const pixels = (img) => {
            const c = document.createElement('canvas');
            c.width = img.width;
            c.height = img.height;
            const ctx = c.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(img, 0, 0);
            return ctx.getImageData(0, 0, img.width, img.height).data;
        };

        const pa = pixels(ia);
        const pb = pixels(ib);
        // Tolerância por canal: rasterização de linha e arredondamento de float não são o assunto.
        const TOL = 12;

        /**
         * A CLASSE de um pixel: visível, oculto ou nenhum dos dois.
         *
         * A comparação por classe é a métrica que separa a ANÁLISE do DESENHO do tronco. Duas
         * imagens podem diferir em 5% dos pixels só porque o fio de arame mudou de tesselação,
         * enquanto a resposta "quem enxerga o quê" é a mesma; e podem coincidir em cor de fundo
         * enquanto a resposta inverte. É esta que mede o motor.
         * @param {Uint8ClampedArray} p
         * @param {number} i
         * @returns {number} 1 visível, 2 oculto, 0 nenhum
         */
        const classe = (p, i) => {
            const r = p[i];
            const g = p[i + 1];
            const b = p[i + 2];
            if (g > 40 && g > r + 25 && g > b + 25) return 1;
            if (r > 40 && r > g + 25 && r > b + 25) return 2;
            return 0;
        };

        let diferentes = 0;
        let classeDiferente = 0;
        for (let i = 0; i < pa.length; i += 4) {
            if (
                Math.abs(pa[i] - pb[i]) > TOL ||
                Math.abs(pa[i + 1] - pb[i + 1]) > TOL ||
                Math.abs(pa[i + 2] - pb[i + 2]) > TOL
            ) diferentes++;
            if (classe(pa, i) !== classe(pb, i)) classeDiferente++;
        }
        const total = pa.length / 4;
        return {
            diferentes,
            classeDiferente,
            total,
            razao: diferentes / total,
            razaoClasse: classeDiferente / total,
            mesmoTamanho: true,
        };
    }, { a: aDataUrl, b: bDataUrl });
}

/**
 * Grava um data URL de PNG em disco.
 * @param {string} destino
 * @param {string} dataUrl
 */
function gravarPng(destino, dataUrl) {
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, Buffer.from(dataUrl.split(',')[1], 'base64'));
}

describeOrSkip('viewshed 3D: o desenho congelado em pixel', () => {
    test.use({ viewport: JANELA });

    test('o viewshed de 120°/186 m/1,5 m desenha verde, vermelho, tronco e painel', async ({ page }) => {
        // O CONSOLE DA PAGINA E PARTE DA MEDICAO. Um shader que nao compila, uma uniforme que
        // nao existe ou uma excecao dentro do `update` de uma primitiva deixam a cena PRETA e nao
        // lancam nada no lado do Node: sem esta coleta, a rodada acusa "100% dos pixels diferentes"
        // e cala o motivo. Medido em 2026-09-15, na primeira execucao da reescrita.
        const errosDaPagina = [];
        page.on('pageerror', (erro) => errosDaPagina.push(`pageerror: ${erro.message}`));
        page.on('console', (msg) => {
            // Falha de CARREGAMENTO de recurso fica de fora: o `/api/config` do backend
            // descartavel aponta para um servidor de tiles que esta maquina nao alcanca, e essa
            // recusa e ruido de ambiente, nao defeito do motor. O que interessa aqui e excecao de
            // JavaScript e erro de renderizacao do proprio Cesium.
            if (msg.type() !== 'error') return;
            const texto = msg.text();
            if (texto.includes('Failed to load resource')) return;
            errosDaPagina.push(`console.error: ${texto}`);
        });

        await registrarTileset(page);
        await servirTileset(page);
        await bootar(page);

        const abriu = await abrirVisualizador3d(page);
        if (!abriu) {
            const estado = await page.evaluate(() => ({
                cesium: !!window.Cesium,
                viewer: !!window.map,
                container: document.getElementById('map-3d-container')?.style.display ?? 'ausente',
            }));
            test.skip(
                true,
                `o visualizador Cesium nao inicializou sem cabeca (${JSON.stringify(estado)}); ` +
                    'limite genuino de ambiente (WebGL ausente), nao afrouxe a assercao.',
            );
            return;
        }

        await montarCena(page, OBSERVADOR);
        const criado = await criarViewshed(page);
        expect(criado.nome, 'o nome automatico do primeiro viewshed do mapa').toBe('Visibilidade #1');

        // A CÂMERA SE FIXA DEPOIS DE O VIEWSHED EXISTIR, e a ordem foi paga: aplicada antes, ela
        // era desfeita pelo reposicionamento assíncrono do próprio `map_3d.js` e a imagem saía
        // exatamente igual à de um enquadramento diferente, o que é a assinatura de uma
        // configuração que não chegou a valer.
        await fixarCamera(page, OBSERVADOR);

        // O canvas de tamanho zero é o sintoma de o visualizador ter FECHADO no meio (ver
        // `TILESET_VAZIO`), e a mensagem nativa fala do canvas em vez da causa. Esta verificação
        // existe para nomear a causa quando ela voltar.
        const tamanho = await page.evaluate(() => {
            const c = window.map?.scene?.canvas;
            const cont = document.getElementById('map-3d-container');
            const cam = window.map?.camera;
            return {
                w: c?.width ?? 0,
                h: c?.height ?? 0,
                display: cont?.style.display ?? 'ausente',
                altura: cam ? Math.round(cam.positionCartographic.height) : null,
                pitch: cam ? Math.round(window.Cesium.Math.toDegrees(cam.pitch)) : null,
            };
        });
        console.info(`[viewshed-pixel] camera altura=${tamanho.altura} m pitch=${tamanho.pitch}deg`);
        expect(
            tamanho.w * tamanho.h,
            `o canvas do Cesium esta ${tamanho.w}x${tamanho.h} e o container esta ` +
                `"${tamanho.display}": o visualizador 3D fechou antes da leitura (documento raiz do ` +
                'tileset recusado?), nao ha pixel a medir',
        ).toBeGreaterThan(0);

        expect(
            errosDaPagina,
            'a pagina reportou erro antes da leitura de pixel; a cena preta costuma vir daqui',
        ).toEqual([]);

        const atual = await lerCanvas(page);
        gravarPng(path.join(DIR_SAIDA, 'viewshed-3d-atual.png'), atual.png);

        const proporcaoVerde = atual.verde / atual.total;
        const proporcaoVermelho = atual.vermelho / atual.total;
        console.info(
            `[viewshed-pixel] canvas=${atual.largura}x${atual.altura} ` +
                `verde=${atual.verde} (${(proporcaoVerde * 100).toFixed(3)}%) ` +
                `vermelho=${atual.vermelho} (${(proporcaoVermelho * 100).toFixed(3)}%) ` +
                `arame=${atual.arame}`,
        );

        if (REGERAR || !fs.existsSync(REFERENCIA)) {
            gravarPng(REFERENCIA, atual.png);
            console.info(`[viewshed-pixel] referencia (re)gerada em ${REFERENCIA}`);
        }

        const referencia = 'data:image/png;base64,' + fs.readFileSync(REFERENCIA).toString('base64');
        const diff = await compararImagens(page, atual.png, referencia);
        expect(diff.mesmoTamanho, 'a referencia tem outro tamanho que o canvas desta rodada').toBe(true);
        console.info(
            `[viewshed-pixel] diferentes=${diff.diferentes}/${diff.total} (${(diff.razao * 100).toFixed(3)}%) ` +
                `classe=${diff.classeDiferente} (${(diff.razaoClasse * 100).toFixed(3)}%)`,
        );

        // AS SEIS CAMADAS. Os números vêm de uma medição, não de um chute, e a folga de cada um
        // está declarada. Medido em 2026-09-15 nesta árvore, em TRÊS rodadas em série de cada
        // motor, com 0/881280 pixels diferentes nas três de cada lado:
        //
        //   vendor `cesium-viewshed.js`   verde 133883 (15,192%)  vermelho 61189 (6,943%)  arame 13823
        //   casa, antes da revisão        verde 135534 (15,379%)  vermelho 59714 (6,776%)  arame  9042
        //   casa, com o viés corrigido    verde 152734 (17,331%)  vermelho 42514 (4,824%)  arame  9038
        //
        // A terceira linha é a de hoje. Repare no que ela NÃO mudou: 195248 pixels tingidos contra
        // 195072, ou seja, o setor é o mesmo e o que se moveu foi a CLASSIFICAÇÃO de 17 mil pixels
        // de chão plano, que o viés antigo declarava ocultos por acne.
        //
        // A cena não tem nada probabilístico dentro, e é por isso que ela pôde virar referência.

        // 1%, contra 0% medido: a folga existe para rasterização de linha e arredondamento de
        // float, não para uma mudança de desenho. Um motor que troque a cor, a projeção ou o bias
        // do shadow map move MUITO mais que isso (as listras de acne do bias sozinhas são ~2% do
        // quadro). Se um dia esta linha ficar vermelha numa máquina com outra GPU, a leitura certa
        // é olhar as três camadas abaixo antes de afrouxar esta.
        expect(diff.razao, 'pixels diferentes da referencia').toBeLessThanOrEqual(0.01);

        // A MESMA COMPARAÇÃO, MAS SÓ DA RESPOSTA. Classifica cada pixel em visível, oculto ou
        // nenhum dos dois e compara as classificações. É a camada que sobrevive a uma mudança no
        // DESENHO do tronco e morre quando a ANÁLISE muda, e foi ela que deu o número desta
        // reescrita contra o vendor: 2,651% de classe diferente para 5,307% de pixel diferente,
        // ou seja, metade do movimento de pixel era o fio de arame trocando de tesselação.
        expect(diff.razaoClasse, 'classificacao visivel/oculto diferente da referencia')
            .toBeLessThanOrEqual(0.01);

        // Folga de um quinto em cima e embaixo do medido. O que estas duas cobram é que o shader
        // continue SEPARANDO as duas metades: um motor que pinte tudo de verde (nada oclui) ou
        // tudo de vermelho (tudo oclui) reprova aqui mesmo com a referência regerada.
        expect(proporcaoVerde, 'area visivel (verde)').toBeGreaterThan(0.14);
        expect(proporcaoVerde, 'area visivel (verde)').toBeLessThan(0.21);
        expect(proporcaoVermelho, 'area oculta (vermelho)').toBeGreaterThan(0.036);
        expect(proporcaoVermelho, 'area oculta (vermelho)').toBeLessThan(0.060);

        // O tronco de visão: a malha branca, 9042 pixels medidos (13823 com o vendor, que
        // tesselava mais fino). O piso é deliberadamente baixo, porque o que se cobra aqui é a
        // PRESENÇA do fio de arame; a forma exata dele já está na camada de pixel.
        expect(atual.arame, 'o tronco de visao em fio de arame').toBeGreaterThan(5000);

        // QUINTA CAMADA: O CHÃO QUE NINGUÉM OCLUI. Nada nesta cena tapa o retângulo declarado em
        // `lerCanvas`, então todo vermelho ali é acne do mapa de sombras, ou seja, chão que o
        // observador enxerga e a análise declara oculto. Com o viés de 2e-5 que vigorou até a
        // revisão de 2026-09-15 esta área saía com cerca de um terço de vermelho, em listras
        // paralelas; com 8e-5 ela sai limpa. O controle negativo é direto: baixar
        // `SHADOW_DEPTH_BIAS` de volta reprova aqui.
        const sujeira = atual.limpoVermelho / atual.limpoTotal;
        console.info(
            `[viewshed-pixel] chao limpo: ${atual.limpoVermelho}/${atual.limpoTotal} vermelho ` +
                `(${(sujeira * 100).toFixed(3)}%)`,
        );
        // Medido: 0,000% com 8e-5 e 1,952% com o 2e-5 anterior, ou seja, o teto abaixo separa os
        // dois desfechos com quase quatro vezes de folga.
        expect(
            sujeira,
            'acne do mapa de sombras: chao visivel declarado oculto no retangulo sem oclusao',
        ).toBeLessThan(0.005);

        // Sexta camada: o painel do produto.
        const painel = page.locator('.viewshed-3d-panel-content');
        await expect(painel).toBeVisible({ timeout: 10000 });
        const entradas = painel.locator('.viewshed-observer-height-input');
        await expect(entradas).toHaveCount(3);
        await expect(entradas.nth(0)).toHaveValue(String(PARAMS.horizontalAngle));
        await expect(entradas.nth(1)).toHaveValue(String(PARAMS.distance));
        await expect(entradas.nth(2)).toHaveValue(String(PARAMS.observerHeight));
    });

    test('o gesto interativo de dois cliques completa, e e o `calback` com um L que o faz', async ({ page }) => {
        // O QUE ESTE CASO MEDE, E QUE NENHUM OUTRO MEDIA. `activateViewshedTool` constroi o
        // viewshed passando a opcao `calback`, com UM L, grafia herdada do plugin de terceiro que
        // foi substituido em 2026-09-15. Se o motor corrigir a ortografia sem o chamador mudar
        // junto, o gesto de dois cliques nunca completa: nao ha erro, nao ha toast, nao ha
        // viewshed, e a pessoa fica clicando. O aceite da reescrita chama isso de item 1, e ate
        // aqui ele estava escrito e nao verificado.
        await registrarTileset(page);
        await servirTileset(page);
        await bootar(page);

        const abriu = await abrirVisualizador3d(page);
        if (!abriu) {
            test.skip(true, 'o visualizador Cesium nao inicializou sem cabeca; limite de ambiente');
            return;
        }

        await montarCena(page, OBSERVADOR);
        await fixarCamera(page, OBSERVADOR);

        await page.evaluate(async ({ id }) => {
            const ferramenta = await import('/src/js/3d_models_viewer_tool/tools/viewshed_tool_3d.js');
            ferramenta.activateViewshedTool(window.map, id);
        }, { id: TILESET_ID });

        // Dois cliques REAIS no canvas, sobre o chao da cena: o primeiro fixa o observador, o
        // segundo o alvo. As posicoes sao do enquadramento fixo e caem os dois sobre a primitiva
        // do chao, que e o que `pickScenePosition` precisa achar.
        const canvas = page.locator('#map-3d canvas').first();
        await canvas.click({ position: { x: 612, y: 560 } });
        await canvas.click({ position: { x: 612, y: 300 } });

        const criado = await page.evaluate(async ({ id }) => {
            const loja = await import('/src/js/store/index.js');
            for (let tentativa = 0; tentativa < 60; tentativa++) {
                const lista = await loja.getViewsheds(id);
                if (lista.length > 0) {
                    const v = lista[0];
                    return {
                        nome: v.properties?.nome ?? null,
                        alturaDoObservador: v.observerHeight,
                        anguloHorizontal: v.parameters?.horizontalAngle,
                        temAlvo: !!v.targetPosition,
                        distancia: v.parameters?.distance,
                    };
                }
                await new Promise((r) => setTimeout(r, 100));
            }
            return null;
        }, { id: TILESET_ID });

        expect(
            criado,
            'o gesto de dois cliques nao produziu viewshed nenhum: o retorno do motor nao chegou ' +
                'ao chamador (a grafia de `calback` e o suspeito numero um)',
        ).not.toBeNull();
        expect(criado.nome).toBe('Visibilidade #1');
        // O chamador RECRIA o viewshed com 1,5 m de offset depois do primeiro clique, e e esse
        // numero que prova que ele leu de volta os campos do objeto em vez de inventa-los.
        expect(criado.alturaDoObservador).toBe(1.5);
        expect(criado.temAlvo, 'o segundo clique nao virou `targetPosition`').toBe(true);
        expect(criado.anguloHorizontal).toBe(120);
        expect(criado.distancia, 'a distancia e RECALCULADA dos dois pontos, nao o padrao de 500')
            .not.toBe(500);
    });

    test('um setor de 180 graus desenha os DOIS sub-viewsheds', async ({ page }) => {
        // O QUE ESTE CASO MEDE, E QUE NENHUM OUTRO MEDIA ATE A REVISAO DE 2026-09-15. Acima de 150
        // graus `subViewshedLayout` parte o setor em dois ou tres, e cada pedaco e um `Viewshed3D`
        // proprio com um estagio de pos-processamento proprio. Os dois primeiros casos deste
        // arquivo usam 120 graus, que cabe em UM pedaco, entao o caminho do corte nunca passou por
        // pixel nenhum.
        //
        // E ele estava QUEBRADO. Todos os estagios nasciam com o mesmo `name`, e
        // `PostProcessStageCollection.add` lanca `DeveloperError` num nome repetido: o segundo
        // pedaco explodia, `createCesiumViewsheds` engolia o erro como `console.warn` e devolvia
        // lista vazia, e o primeiro pedaco ficava orfao na cena com o nome ainda tomado. A partir
        // dali NENHUM viewshed daquela sessao voltava a desenhar. O controle negativo e direto:
        // voltar o nome a uma constante reprova a contagem de estagios abaixo.
        await registrarTileset(page);
        await servirTileset(page);
        await bootar(page);

        const abriu = await abrirVisualizador3d(page);
        if (!abriu) {
            test.skip(true, 'o visualizador Cesium nao inicializou sem cabeca; limite de ambiente');
            return;
        }

        await montarCena(page, OBSERVADOR);
        const criado = await page.evaluate(async ({ id: tilesetId, obs, passo, piso }) => {
            const loja = await import('/src/js/store/index.js');
            const ferramenta = await import('/src/js/3d_models_viewer_tool/tools/viewshed_tool_3d.js');
            const viewshed = await loja.addViewshed(tilesetId, {
                position: { longitude: obs.longitude, latitude: obs.latitude, height: piso },
                targetPosition: { longitude: obs.longitude, latitude: obs.latitude + passo, height: piso },
                terrainBaseHeight: piso,
                direction: { heading: 0, pitch: 0 },
                parameters: { horizontalAngle: 180, verticalAngle: 120, distance: 186 },
                observerHeight: 1.5,
            });
            await ferramenta.renderViewshedsForTileset(window.map, tilesetId);
            await new Promise((resolve) => {
                let n = 30;
                const passa = () => (n-- <= 0 ? resolve() : requestAnimationFrame(passa));
                passa();
            });
            return { id: viewshed.id, estagios: window.map.scene.postProcessStages.length };
        }, { id: TILESET_ID, obs: OBSERVADOR, passo: PASSO_NORTE, piso: PISO });

        await fixarCamera(page, OBSERVADOR);

        expect(
            criado.estagios,
            'um setor de 180 graus vira DOIS sub-viewsheds, e cada um registra um estagio de ' +
                'pos-processamento: um estagio so significa que o segundo foi recusado em silencio',
        ).toBe(2);

        const atual = await lerCanvas(page);
        gravarPng(path.join(DIR_SAIDA, 'viewshed-3d-180-atual.png'), atual.png);
        const proporcaoVerde = atual.verde / atual.total;
        console.info(
            `[viewshed-pixel] 180 graus: verde=${atual.verde} (${(proporcaoVerde * 100).toFixed(3)}%) ` +
                `vermelho=${atual.vermelho} arame=${atual.arame}`,
        );
        // Medido em 2026-09-15: 298451 verdes (33,865%). O piso e baixo de proposito, porque o que
        // se cobra aqui e que os DOIS pedacos tenham desenhado; a forma exata e assunto do primeiro
        // caso, que trabalha com referencia de pixel.
        expect(proporcaoVerde, 'area visivel com o setor partido em dois').toBeGreaterThan(0.25);
    });
});
