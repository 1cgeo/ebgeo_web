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
 *
 * ## A COSTURA ENTRE SUB-VIEWSHEDS TEM REFERÊNCIA PRÓPRIA DESDE 2026-09-16, E EM OUTRO ENQUADRAMENTO
 *
 * Os dois últimos casos deste arquivo medem a EMENDA, e o que eles provam não é o que a revisão de
 * 2026-09-15 achou ter provado. Aquela revisão mediu a emenda no enquadramento largo dos primeiros
 * casos, leu "0 px de chão cru" e registrou "fresta, não faixa". O número estava certo e a
 * conclusão não: com a folga de 0,1 grau que vigorava, a cunha cega media 0,32 m a 186 m, e naquele
 * enquadramento um pixel vale cerca de 0,42 m. **A fresta não estava ausente, estava sub-pixel.**
 *
 * Por isso estes dois casos aproximam a câmera até o chão valer cerca de 0,046 m por pixel
 * (`ENQUADRAMENTO_COSTURA`) e põem um MURO em cima da emenda, a 115 m: é o que transforma as quatro
 * perguntas em coisas que um pixel pode responder. As quatro réguas, e o que cada uma veria se a
 * costura estivesse errada:
 *
 *   1. **Fresta** (chão CRU entre dois tingidos), varrida na coluna da emenda INTEIRA, do arco de
 *      distância até a borda de baixo do quadro: chão, muro e sombra do muro. Ela vê uma corrida
 *      contínua de pixels sem tinta: 64 px com folga de 1,5 grau, 4 px com 0,1, e 2 px no TOPO DO
 *      MURO com folga zero e o eixo de azimute de cada pedaço.
 *
 *      **ELA VARRIA DUAS FAIXAS SEPARADAS, E O MURO CAÍA NO VÃO ENTRE ELAS.** Chão (linhas 470 a
 *      710) e sombra (190 a 330), com o muro em 339 a 455: a primeira versão destes casos media dos
 *      dois lados da fenda sem tocá-la, passou verde, e duas referências versionadas nasceram com
 *      ela dentro. A segunda armadilha estava no classificador: a face de cima do muro SEM TINTA é
 *      (211, 205, 193), e o piso de branco de 190 a chamava de fio de arame, que é justamente o que
 *      a régua usa para ZERAR a corrida. Faixa única e piso 235 fecham as duas.
 *   2. **Faixa saturada** (a mediana do canal OPOSTO à tinta, nas colunas da emenda, contra a mesma
 *      mediana a mais de 5 graus dali). Uma tinta só deixa o canal oposto em ~62; duas misturas
 *      sobre o mesmo pixel deixam ~31. Com os pedaços SOBREPOSTOS (folga negativa) a mediana da
 *      emenda cai para 31 e as duas metades da régua divergem por um fator de dois.
 *   3. **Sombra contínua**: descendo as colunas da emenda dentro da faixa da sombra do muro, o
 *      vermelho não pode se interromper. Com folga positiva a sombra é cortada em duas pela mesma
 *      cunha cega, e essa é a forma mais grave do defeito: a análise não responde NADA numa linha
 *      que atravessa o obstáculo e a sombra dele.
 *   4. **Pixel e classe contra referência versionada**, como nos primeiros casos.
 *
 * TRÊS PEDAÇOS SÃO 320 GRAUS, E NÃO 300. `subViewshedLayout` corta em dois até
 * `MAX_SINGLE_VIEWSHED_ANGLE * 2` INCLUSIVE, então 300 ainda são dois pedaços e 300,0001 já são
 * três. Um caso de costura escrito com 300 mediria o corte em dois duas vezes.
 *
 * O QUE ESTES DOIS CASOS NÃO ALCANÇAM, DECLARADO. O muro desta cena fica 5,5 m acima do olho do
 * observador, o que põe a régua da fresta na faixa de elevação onde o defeito de 2026-09-16 morava
 * (ele crescia com a tangente da elevação). Um obstáculo MUITO mais alto, ou muito mais perto,
 * exercitaria elevações maiores; o que prende esse regime não é pixel, é a bisseção do ângulo de
 * corte, e ela vive fora daqui. E a MALHA do tronco continua desenhada no referencial da câmera do
 * observador, enquanto a tinta passou a medir azimute em torno da vertical local: as duas coincidem
 * exatamente com visada horizontal e divergem com o QUADRADO da inclinação da visada (0,002 grau
 * nesta cena, que tem 0,46 grau de inclinação; 4 graus para um observador 40 m acima do alvo a 100
 * m). A tinta é a resposta, a malha é anotação, e a divergência entre as duas não tem régua.
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

/** Referência da emenda, uma por número de sub-viewsheds. Ver o cabeçalho, seção da costura. */
const REFERENCIA_COSTURA = {
    180: path.join(DIR_REFERENCIA, 'viewshed-3d-costura-180.png'),
    320: path.join(DIR_REFERENCIA, 'viewshed-3d-costura-320.png'),
};

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
 * @param {{ muroNaEmenda?: boolean }} [opcoes] - `muroNaEmenda` acrescenta o obstáculo que os casos
 *   de costura precisam. Ele fica FORA da cena dos primeiros casos de propósito: acrescentá-lo lá
 *   invalidaria a referência de pixel de 2026-09-15 sem nada a ganhar.
 */
async function montarCena(page, obs, opcoes = {}) {
    await page.evaluate(async ({ obs: o, piso: PISO, muroNaEmenda }) => {
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
         * @param {number} [profundidade] - Norte-sul, em metros. Ausente = igual à largura, que é a
         *   forma dos três blocos originais; o muro da costura é largo e fino.
         */
        const bloco = (leste, norte, largura, altura, rgb, piso = 0, profundidade = largura) => {
            const base = C.Cartesian3.fromDegrees(o.longitude, o.latitude, 0);
            const enu = C.Transforms.eastNorthUpToFixedFrame(base);
            const deslocado = C.Matrix4.multiplyByPoint(
                enu,
                new C.Cartesian3(leste, norte, piso + altura / 2),
                new C.Cartesian3(),
            );
            const modelo = C.Transforms.eastNorthUpToFixedFrame(deslocado);
            const geometria = C.BoxGeometry.fromDimensions({
                dimensions: new C.Cartesian3(largura, profundidade, altura),
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

        // O MURO DA COSTURA: 34 m de largura, 6 m de espessura, 7 m de altura, centrado
        // EXATAMENTE na direção da emenda (o norte, ver `criarViewshedDeCostura`) a 115 m.
        //
        // As três medidas são escolhidas, não arredondadas. Ele é LARGO para atravessar a emenda
        // com folga dos dois lados; é FINO para que a câmera aproximada enxergue por cima dele o
        // chão que ele mesmo sombreia (um bloco de base quadrada esconderia a sombra atrás de si e
        // a régua da sombra não mediria nada); e é BAIXO o bastante para caber no quadro e alto o
        // bastante para a sombra dele alcançar o corte de distância, porque a 1,5 m de altura de
        // observador qualquer obstáculo acima do olho sombreia até o infinito.
        if (muroNaEmenda) bloco(0, 115, 34, 7, [0.72, 0.70, 0.66], PISO, 6);

        // O globo precisa estar completo antes de qualquer leitura de pixel.
        await new Promise((resolve) => {
            let restantes = 600;
            const tenta = () => {
                if (cena.globe.tilesLoaded || restantes-- <= 0) { resolve(); return; }
                requestAnimationFrame(tenta);
            };
            tenta();
        });
    }, { obs, piso: PISO, muroNaEmenda: opcoes.muroNaEmenda === true });
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
 * @param {{ recuoNorte: number, altura: number, pitchGraus: number }} [enquadramento]
 */
async function fixarCamera(page, obs, enquadramento) {
    /**
     * Altura e recuo (metros) do enquadramento da referência. Escolhido para que o SETOR INTEIRO
     * caiba no quadro: a abertura de 120° e o corte em 186 m só provam alguma coisa se as duas
     * bordas e o arco distante estiverem na imagem. Com a câmera mais baixa o leque saía pelo topo
     * e a distância deixava de ser medida.
     */
    const ENQUADRAMENTO = enquadramento ?? { recuoNorte: -180, altura: 260, pitchGraus: -42 };

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

// ==================== A COSTURA ENTRE SUB-VIEWSHEDS ====================

/**
 * Os dois cortes que existem. `pedacos` é o que `subViewshedLayout` devolve, e é asserido: 300
 * graus ainda são DOIS (a fronteira é inclusiva), então o caso de três é 320.
 */
const CASOS_DE_COSTURA = [
    { angulo: 180, pedacos: 2 },
    { angulo: 320, pedacos: 3 },
];

/**
 * O enquadramento da emenda, e cada número dele foi medido, não escolhido por gosto.
 *
 * A câmera fica 60 m ao NORTE do observador, 30 m acima do chão, inclinada 22 graus para baixo,
 * olhando para o norte com rumo zero. Três propriedades saem daí, e as três são necessárias:
 *
 *   - o chão à frente vale cerca de 0,046 m por pixel, contra os 0,42 m do enquadramento largo dos
 *     primeiros casos. É esse fator de nove que separa uma cunha de 0,1 grau (0,175 m a 100 m,
 *     quase 4 px aqui e menos de meio pixel lá) de uma medição que não vê nada;
 *   - o muro a 115 m cabe no quadro com chão LIMPO abaixo dele (linhas de `FAIXA_DE_CHAO`) e a
 *     SOMBRA dele acima (linhas de `FAIXA_DE_SOMBRA`), que é o que permite medir a fresta e a
 *     continuidade da sombra na mesma imagem;
 *   - a emenda cai na COLUNA CENTRAL do canvas, porque o setor é montado com a emenda apontando
 *     para o norte e a câmera olha o norte de um ponto exatamente ao norte do observador.
 */
const ENQUADRAMENTO_COSTURA = { recuoNorte: 60, altura: 30, pitchGraus: -22 };

/**
 * A COLUNA DA EMENDA INTEIRA, do arco de distância até a borda de baixo do quadro.
 *
 * ERAM DUAS FAIXAS SEPARADAS ATÉ 2026-09-16, E PELO VÃO ENTRE ELAS PASSOU UM DEFEITO REAL. A régua
 * da fresta varria o chão (470 a 710) e a sombra (190 a 330); o MURO mora entre as duas, nas linhas
 * 339 a 455, e a emenda abria ali uma fenda de 2 px de largura por 16 de altura (setor de 180) e
 * por 25 (setor de 320), na face de cima do muro e na borda alta da face frontal. As duas faixas
 * passavam de um lado e do outro sem tocá-la, e duas referências versionadas nasceram com a fenda
 * dentro. Quem a achou foi leitura de imagem, não a suíte.
 *
 * O topo é 200 e não zero porque acima do arco o chão está FORA do alcance pedido e é cru por
 * direito. Quem garante que o arco não entrou na janela é a guarda das âncoras, que exige as duas
 * bordas tingidas ao longo de toda esta faixa.
 */
const FAIXA_DA_EMENDA = { y0: 200, y1: 719 };
/**
 * Linhas de chão sem oclusão, entre a câmera e o muro. Só a régua da SATURAÇÃO usa esta faixa, e o
 * motivo é que ela compara COR: para isso os dois lados têm de ser o mesmo material.
 */
const FAIXA_DE_CHAO = { y0: 470, y1: 710 };
/** Linhas dentro da sombra que o muro projeta, entre ele e o corte de distância. */
const FAIXA_DE_SOMBRA = { y0: 190, y1: 330 };
/** Meia largura, em pixels, da faixa de colunas que se considera "a emenda". */
const MEIA_FAIXA_DA_EMENDA = 6;
/**
 * Colunas de referência: o MESMO chão, longe da emenda. A 100 m de distância de chão, 220 px valem
 * cerca de 5,8 graus de azimute e 320 px cerca de 8,4, então a faixa inteira está além dos 5 graus.
 */
const COLUNAS_DE_REFERENCIA = { de: 220, ate: 320 };

/**
 * Cria um viewshed cuja PRIMEIRA EMENDA aponta para o norte, que é o que põe a costura na coluna
 * central do canvas.
 *
 * Com dois pedaços a emenda é a própria direção de visada; com três elas ficam a meio sub-ângulo
 * de cada lado dela, e o rumo do setor é girado de meio sub-ângulo para trazer uma delas ao norte.
 *
 * O ALVO É CONSTRUÍDO NO REFERENCIAL LOCAL, e não por graus de latitude e longitude somados à mão.
 * A conversão ingênua (`distância * sen(rumo) / (110574 * cos(latitude))`) erra o raio do paralelo
 * em cerca de 0,7% nesta latitude, o que num rumo de 53 graus desloca o azimute em 0,19 grau: a
 * emenda nasce 5 px fora do centro e as réguas passam a medir chão em vez de costura. Medido aqui
 * em 2026-09-16.
 * @param {import('@playwright/test').Page} page
 * @param {number} angulo - Abertura horizontal total, em graus.
 * @returns {Promise<{ id: string, pedacos: number, subAngle: number, renderAngle: number, rumo: number, estagios: number }>}
 */
async function criarViewshedDeCostura(page, angulo) {
    return page.evaluate(async ({ id: tilesetId, ang, obs, piso, dist }) => {
        const C = window.Cesium;
        const loja = await import('/src/js/store/index.js');
        const ferramenta = await import('/src/js/3d_models_viewer_tool/tools/viewshed_tool_3d.js');
        const { subViewshedLayout } = await import(
            '/src/js/3d_models_viewer_tool/services/viewshed-geometry.js'
        );

        const layout = subViewshedLayout(ang);
        const emendas = layout.count === 2 ? [0] : [-layout.subAngle / 2, layout.subAngle / 2];
        const rumo = -emendas[0];

        const observador = C.Cartesian3.fromDegrees(obs.longitude, obs.latitude, piso);
        const enu = C.Transforms.eastNorthUpToFixedFrame(observador);
        const radianos = (C.Math.toRadians(rumo));
        const alvoCartesiano = C.Matrix4.multiplyByPoint(
            enu,
            new C.Cartesian3(dist * Math.sin(radianos), dist * Math.cos(radianos), 0),
            new C.Cartesian3(),
        );
        const carto = C.Cartographic.fromCartesian(alvoCartesiano);

        const viewshed = await loja.addViewshed(tilesetId, {
            position: { longitude: obs.longitude, latitude: obs.latitude, height: piso },
            targetPosition: {
                longitude: C.Math.toDegrees(carto.longitude),
                latitude: C.Math.toDegrees(carto.latitude),
                height: piso,
            },
            terrainBaseHeight: piso,
            direction: { heading: rumo, pitch: 0 },
            parameters: { horizontalAngle: ang, verticalAngle: 120, distance: dist },
            observerHeight: 1.5,
        });

        await ferramenta.renderViewshedsForTileset(window.map, tilesetId);
        await new Promise((resolve) => {
            let n = 30;
            const passa = () => (n-- <= 0 ? resolve() : requestAnimationFrame(passa));
            passa();
        });

        return {
            id: viewshed.id,
            pedacos: layout.count,
            subAngle: layout.subAngle,
            renderAngle: layout.renderAngle,
            rumo,
            estagios: window.map.scene.postProcessStages.length,
        };
    }, { id: TILESET_ID, ang: angulo, obs: OBSERVADOR, piso: PISO, dist: PARAMS.distance });
}

/**
 * As quatro réguas da costura, lidas do canvas numa passada só.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<object>} As contagens; ver o cabeçalho do arquivo para o que cada uma significa.
 */
async function medirCostura(page) {
    return page.evaluate(({ emenda, chao, sombra, meia, ref }) => {
        const canvas = window.map.scene.canvas;
        const w = canvas.width;
        const h = canvas.height;
        const espelho = document.createElement('canvas');
        espelho.width = w;
        espelho.height = h;
        const ctx = espelho.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(canvas, 0, 0);
        const d = ctx.getImageData(0, 0, w, h).data;

        const em = (x, y) => {
            const i = (y * w + x) * 4;
            return { r: d[i], g: d[i + 1], b: d[i + 2] };
        };
        /**
         * 'V' visível, 'X' oculto, 'A' fio de arame, '.' cru (nenhuma passada tingiu).
         *
         * O PISO DO BRANCO É 235 AQUI, E 190 EM `lerCanvas`, E A DIFERENÇA É UM DEFEITO PAGO. A face
         * de cima do muro desta cena, SEM TINTA, é (211, 205, 193), e a frontal é (177, 172, 162):
         * com o piso em 190 a primeira era classificada como FIO DE ARAME, que é o que a régua da
         * fresta trata como "anotação desenhada por cima" e usa para ZERAR a corrida. O resultado
         * era uma fenda de 16 px lida como 4 px, e depois como zero quando ela subia para a face de
         * cima. O fio de arame de verdade é branco quase puro (253, 253, 253) sobre chão cru, e
         * verde ou vermelho claro quando cai dentro do tingido, então 235 o separa sem alcançar
         * superfície nenhuma desta cena. `lerCanvas` fica com 190 porque o enquadramento dele não
         * tem superfície clara sem tinta, e porque o número que ele produz está declarado lá.
         * @param {{r: number, g: number, b: number}} p
         * @returns {string}
         */
        const classe = (p) => {
            if (p.g > 40 && p.g > p.r + 25 && p.g > p.b + 25) return 'V';
            if (p.r > 40 && p.r > p.g + 25 && p.r > p.b + 25) return 'X';
            if (p.r > 235 && p.g > 235 && p.b > 235) return 'A';
            return '.';
        };

        let verde = 0;
        let vermelho = 0;
        let arame = 0;
        for (let i = 0; i < d.length; i += 4) {
            const c = classe({ r: d[i], g: d[i + 1], b: d[i + 2] });
            if (c === 'V') verde++;
            else if (c === 'X') vermelho++;
            else if (c === 'A') arame++;
        }

        const centro = Math.round(w / 2);

        /**
         * A maior corrida de pixels CRUS entre dois TINGIDOS, varrendo cada linha da faixa em torno
         * da emenda. O fio de arame zera a corrida em vez de contar como fresta: ele é anotação
         * desenhada por cima, e as duas bordas do corte são desenhadas justamente ali.
         * @param {{y0: number, y1: number}} faixa
         * @returns {number}
         */
        let linhaDaMaiorFresta = -1;
        const maiorFresta = (faixa) => {
            let maior = 0;
            for (let y = faixa.y0; y <= faixa.y1; y++) {
                let corrida = 0;
                let vistoTingido = false;
                for (let x = centro - 40; x <= centro + 40; x++) {
                    const c = classe(em(x, y));
                    if (c === 'V' || c === 'X') {
                        if (vistoTingido && corrida > maior) { maior = corrida; linhaDaMaiorFresta = y; }
                        vistoTingido = true;
                        corrida = 0;
                    } else if (c === '.') {
                        corrida++;
                    } else {
                        corrida = 0;
                    }
                }
            }
            return maior;
        };

        /**
         * A mediana do canal VERMELHO entre os pixels verdes de uma coluna, nas linhas de chão.
         * É o canal OPOSTO à tinta, e é ele que cai pela metade quando a mistura acontece duas
         * vezes: sobre este chão, ~62 com uma passada e ~31 com duas.
         * @param {number} x0
         * @param {number} x1
         * @returns {{mediana: number, n: number}}
         */
        const medianaDoOposto = (x0, x1) => {
            const rs = [];
            for (let y = chao.y0; y <= chao.y1; y++) {
                for (let x = x0; x <= x1; x++) {
                    const p = em(x, y);
                    if (classe(p) === 'V') rs.push(p.r);
                }
            }
            rs.sort((a, b) => a - b);
            return { mediana: rs.length ? rs[Math.floor(rs.length / 2)] : -1, n: rs.length };
        };

        const naEmenda = medianaDoOposto(centro - meia, centro + meia);
        const referenciaEsquerda = medianaDoOposto(centro - ref.ate, centro - ref.de);
        const referenciaDireita = medianaDoOposto(centro + ref.de, centro + ref.ate);
        const referencia = Math.round((referenciaEsquerda.mediana + referenciaDireita.mediana) / 2);

        // COLUNAS COM POUCO VERDE FICAM DE FORA, e isso não é afrouxar a régua: uma coluna sem
        // verde nenhum é uma coluna que a FRESTA comeu, e é a régua da fresta que responde por
        // ela. Sem este corte, o controle negativo da fresta acusava "faixa saturada", que é o
        // diagnóstico errado para o defeito certo.
        const medianaPorColuna = [];
        for (let x = centro - meia; x <= centro + meia; x++) {
            const coluna = medianaDoOposto(x, x);
            if (coluna.n >= 30) medianaPorColuna.push(coluna.mediana);
        }

        // AS DUAS ANCORAS DA REGUA DA FRESTA: quanto está tingido nas BORDAS da janela varrida, e
        // não no meio dela.
        //
        // A régua da fresta conta chão cru ENTRE dois tingidos, então ela é vazia quando a janela
        // inteira é crua, e é isso que esta guarda existe para pegar. Medi-la no meio da janela
        // seria medi-la justamente onde a fresta mora: com a folga de 1,5 grau a cunha ocupa 62 dos
        // 81 pixels varridos, a fração cai para 0,23 e a guarda passa a gritar "não há tinta" sobre
        // uma imagem cheia de tinta. Nas bordas, ela só cai quando não há tinta em lugar nenhum.
        const tingidosEm = (x0, x1) => {
            let n = 0;
            for (let y = emenda.y0; y <= emenda.y1; y++) {
                for (let x = x0; x <= x1; x++) {
                    const c = classe(em(x, y));
                    if (c === 'V' || c === 'X') n++;
                }
            }
            return n;
        };
        const linhasDaEmenda = emenda.y1 - emenda.y0 + 1;
        const ancoraEsquerda = tingidosEm(centro - 40, centro - 35);
        const ancoraDireita = tingidosEm(centro + 35, centro + 40);

        // A sombra do muro, descendo as colunas da emenda: o maior buraco (pixels não vermelhos)
        // entre dois vermelhos.
        //
        // A CONTAGEM POR COLUNA ANDA JUNTO, e sem ela esta régua é VAZIA no caso que mais importa.
        // Uma coluna inteiramente crua (a fresta comeu a sombra toda) nunca vê um vermelho, então
        // nunca abre uma corrida, então reporta buraco ZERO: o defeito mais grave sairia verde.
        // Medido em 2026-09-16, com a folga de 0,1 grau: buraco 0 e coluna central com 0 vermelhos.
        let buracoNaSombra = 0;
        const vermelhosPorColunaNaSombra = [];
        for (const x of [centro - 2, centro, centro + 2]) {
            let corrida = 0;
            let visto = false;
            let vermelhos = 0;
            for (let y = sombra.y0; y <= sombra.y1; y++) {
                if (classe(em(x, y)) === 'X') {
                    vermelhos++;
                    if (visto && corrida > buracoNaSombra) buracoNaSombra = corrida;
                    visto = true;
                    corrida = 0;
                } else {
                    corrida++;
                }
            }
            vermelhosPorColunaNaSombra.push(vermelhos);
        }

        return {
            png: espelho.toDataURL('image/png'),
            largura: w,
            altura: h,
            verde,
            vermelho,
            arame,
            frestaNaEmenda: maiorFresta(emenda),
            linhaDaFresta: linhaDaMaiorFresta,
            medianaEmenda: naEmenda.mediana,
            verdesNaEmenda: naEmenda.n,
            medianaReferencia: referencia,
            medianaPorColuna,
            ancoraEsquerda,
            ancoraDireita,
            totalDaAncora: linhasDaEmenda * 6,
            buracoNaSombra,
            vermelhosPorColunaNaSombra,
            linhasDaSombra: sombra.y1 - sombra.y0 + 1,
        };
    }, {
        emenda: FAIXA_DA_EMENDA,
        chao: FAIXA_DE_CHAO,
        sombra: FAIXA_DE_SOMBRA,
        meia: MEIA_FAIXA_DA_EMENDA,
        ref: COLUNAS_DE_REFERENCIA,
    });
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
            // Firefox reports the same unavailable fixture tile host as a CORS console error.
            if (texto.includes('Cross-Origin Request Blocked:') &&
                /http:\/\/localhost\/tiles\/(?:dem\/|municipios[. ]|rodovias[. ])/.test(texto)) return;
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

    /**
     * Linhas visiveis que o preview desenha: a malha de 8 subdivisoes de `frustumOutlineAngles`
     * (9 meridianos, 9 paralelos e 4 arestas de apice) mais a linha de mira ate o ponteiro.
     */
    const LINHAS_DO_PREVIEW = 9 + 9 + 4 + 1;

    /**
     * Guarda, por IDENTIDADE, as primitivas que a cena tem antes do gesto e ativa a ferramenta.
     * Identidade e nao contagem, porque o segundo clique acrescenta o setor de verdade e a malha
     * dele, que e uma PolylineCollection com quase as mesmas linhas do preview.
     * @param {import('@playwright/test').Page} page
     */
    async function ativarComRetratoDaCena(page) {
        await page.evaluate(async ({ id }) => {
            const cena = window.map.scene;
            window.__primitivasAntesDoGesto = new Set(
                Array.from({ length: cena.primitives.length }, (_, i) => cena.primitives.get(i)),
            );
            const ferramenta = await import('/src/js/3d_models_viewer_tool/tools/viewshed_tool_3d.js');
            ferramenta.activateViewshedTool(window.map, id);
        }, { id: TILESET_ID });
    }

    /**
     * O que o gesto acrescentou a cena: linhas visiveis por colecao de polilinhas, rotulos visiveis
     * e marcas. So API publica do Cesium, e so os TRES tipos de colecao com que o preview desenha,
     * para que uma primitiva alheia chegando tarde (o tileset, digamos) nao mude a conta.
     * @param {import('@playwright/test').Page} page
     */
    function lerPreview(page) {
        return page.evaluate(() => {
            const C = window.Cesium;
            const cena = window.map.scene;
            const novas = [];
            for (let i = 0; i < cena.primitives.length; i++) {
                const p = cena.primitives.get(i);
                const tipoDoPreview = p instanceof C.PolylineCollection
                    || p instanceof C.LabelCollection
                    || p instanceof C.PointPrimitiveCollection;
                if (tipoDoPreview && !window.__primitivasAntesDoGesto.has(p)) novas.push(p);
            }
            const linhas = novas
                .filter((p) => p instanceof C.PolylineCollection)
                .map((c) => {
                    let n = 0;
                    for (let j = 0; j < c.length; j++) {
                        const l = c.get(j);
                        if (l.show && l.positions.length >= 2) n++;
                    }
                    return n;
                });
            const rotulos = novas
                .filter((p) => p instanceof C.LabelCollection)
                .flatMap((c) => Array.from({ length: c.length }, (_, j) => c.get(j)))
                .filter((l) => l.show)
                .map((l) => l.text);
            const marcas = novas
                .filter((p) => p instanceof C.PointPrimitiveCollection)
                .reduce((soma, c) => soma + c.length, 0);
            return { novas: novas.length, linhas, rotulos, marcas };
        });
    }

    test('entre os dois cliques o setor aparece em preview, segue o ponteiro e sai no segundo clique', async ({ page }) => {
        // O QUE ESTE CASO MEDE, E POR QUE ELE NASCEU. O plugin substituido em 2026-09-15 desenhava
        // o tronco enquanto o ponteiro andava entre os dois cliques, como EFEITO de um acessor de
        // escrita de `distance`; a reescrita manteve a atribuicao e perdeu o efeito, e nenhuma suite
        // viu, porque o caso de dois cliques acima mede a LOJA depois do gesto e os de pixel medem
        // o setor PRONTO. O dono deu pela falta em 2026-09-22. O controle negativo e direto: tirar a
        // chamada de `_drawPreview` do manipulador de movimento reprova a segunda espera abaixo.
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
        await ativarComRetratoDaCena(page);

        // Antes do primeiro clique nao ha preview nenhum: nao ha observador de onde desenhar.
        expect((await lerPreview(page)).novas, 'a ferramenta desenhou antes do primeiro clique').toBe(0);

        const canvas = page.locator('#map-3d canvas').first();
        await canvas.click({ position: { x: 612, y: 560 } });

        // O primeiro clique e respondido NA HORA, com a marca do observador e sem setor ainda.
        await expect
            .poll(() => lerPreview(page), { timeout: 5000, message: 'o primeiro clique nao marcou o observador' })
            .toMatchObject({ marcas: 1, rotulos: [] });
        expect((await lerPreview(page)).linhas.every((n) => n === 0), 'setor desenhado sem ponteiro').toBe(true);

        // O ponteiro anda: o setor aparece, com a mira e o alcance ao lado.
        await canvas.hover({ position: { x: 612, y: 420 } });
        await expect
            .poll(async () => {
                const lido = await lerPreview(page);
                return lido.linhas.includes(LINHAS_DO_PREVIEW) && lido.rotulos.length === 1;
            }, { timeout: 5000, message: 'o ponteiro andou e o preview do setor nao apareceu' })
            .toBe(true);
        const primeiro = await lerPreview(page);
        expect(primeiro.rotulos[0], 'o alcance do preview nao le como distancia').toMatch(/^\d+,\d (m|km)$/);

        // E SEGUE o ponteiro: mais longe, outro alcance.
        await canvas.hover({ position: { x: 612, y: 300 } });
        await expect
            .poll(async () => {
                // O rotulo tem de EXISTIR e ser outro: sem a primeira metade, um preview que
                // sumisse passaria por um preview que andou.
                const { rotulos } = await lerPreview(page);
                return rotulos.length === 1 && rotulos[0] !== primeiro.rotulos[0];
            }, { timeout: 5000, message: 'o preview ficou parado onde o ponteiro estava antes' })
            .toBe(true);
        const antesDoClique = await lerPreview(page);
        console.log(`preview: ${JSON.stringify(antesDoClique)}`);

        // As colecoes do preview, por identidade, para conferir depois que sairam da cena.
        await page.evaluate(() => {
            const C = window.Cesium;
            const cena = window.map.scene;
            window.__colecoesDoPreview = [];
            for (let i = 0; i < cena.primitives.length; i++) {
                const p = cena.primitives.get(i);
                const tipoDoPreview = p instanceof C.PolylineCollection
                    || p instanceof C.LabelCollection
                    || p instanceof C.PointPrimitiveCollection;
                if (tipoDoPreview && !window.__primitivasAntesDoGesto.has(p)) {
                    window.__colecoesDoPreview.push(p);
                }
            }
        });

        // Segundo clique no MESMO pixel em que o ponteiro parou.
        await canvas.click({ position: { x: 612, y: 300 } });

        const depois = await page.evaluate(async ({ id }) => {
            const loja = await import('/src/js/store/index.js');
            let criado = null;
            for (let tentativa = 0; tentativa < 60 && !criado; tentativa++) {
                const lista = await loja.getViewsheds(id);
                if (lista.length > 0) criado = lista[0];
                else await new Promise((r) => setTimeout(r, 100));
            }
            const cena = window.map.scene;
            const colecoes = window.__colecoesDoPreview;
            return {
                distancia: criado?.parameters?.distance ?? null,
                colecoes: colecoes.length,
                aindaNaCena: colecoes.filter((c) => cena.primitives.contains(c)).length,
                destruidas: colecoes.filter((c) => c.isDestroyed()).length,
            };
        }, { id: TILESET_ID });

        expect(depois.distancia, 'o segundo clique nao produziu viewshed').not.toBeNull();
        expect(depois.colecoes, 'o retrato do preview nao achou as colecoes').toBe(3);
        expect(depois.aindaNaCena, 'o preview ficou na cena depois do segundo clique').toBe(0);
        expect(depois.destruidas, 'o preview saiu da cena sem ser destruido').toBe(3);

        // O PREVIEW PROMETE O ALCANCE QUE A ANALISE RECEBE: o rotulo lido com o ponteiro parado
        // sobre o pixel do segundo clique e a distancia gravada, na formatacao do rotulo.
        const esperado = `${depois.distancia.toFixed(1)} m`.replace('.', ',');
        expect(antesDoClique.rotulos[0], 'o preview anunciou um alcance diferente do analisado').toBe(esperado);
    });

    test('desligar a ferramenta no meio do gesto leva o preview e o manipulador junto', async ({ page }) => {
        // Escape, o botao do chip, trocar de ferramenta e fechar o 3D chegam todos a
        // `deactivateViewshedTool` (o ultimo pela inscricao em VIEWER_3D_CLOSED), e e o `destroy` do
        // motor que tira o preview. Este caso chama a porta comum, porque os atalhos dependem da
        // barra de ferramentas, que este spec nao dirige.
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
        await ativarComRetratoDaCena(page);

        const canvas = page.locator('#map-3d canvas').first();
        await canvas.click({ position: { x: 612, y: 560 } });
        await canvas.hover({ position: { x: 612, y: 420 } });
        await expect
            .poll(async () => (await lerPreview(page)).linhas.includes(LINHAS_DO_PREVIEW), {
                timeout: 5000,
                message: 'o preview nao apareceu, e sem ele este caso nao mede nada',
            })
            .toBe(true);

        await page.evaluate(async () => {
            const ferramenta = await import('/src/js/3d_models_viewer_tool/tools/viewshed_tool_3d.js');
            ferramenta.deactivateViewshedTool();
        });
        expect((await lerPreview(page)).novas, 'o preview sobreviveu a ferramenta desligada').toBe(0);

        // E o manipulador saiu junto: o ponteiro volta a andar e nada volta a ser desenhado, nem
        // no quadro seguinte (o movimento e coalescido por quadro de animacao).
        await canvas.hover({ position: { x: 640, y: 380 } });
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        expect((await lerPreview(page)).novas, 'um movimento depois de desligar redesenhou o preview').toBe(0);
    });


    test('um setor de 180 graus desenha os DOIS sub-viewsheds, e a emenda nao deixa fresta', async ({ page }) => {
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
        //
        // A SEGUNDA ASSERCAO E A EMENDA, E ELA E FRACA DE PROPOSITO: este enquadramento vale cerca
        // de 0,42 m por pixel, entao ele so enxerga cunha cega a partir de uns 0,3 grau. Foi com
        // ele que a revisao de 2026-09-15 mediu "0 px" sobre a folga de 0,1 grau que entao vigorava
        // e concluiu que a emenda estava fechada; ela estava SUB-PIXEL, o que e outra coisa. Quem
        // mede a emenda de verdade sao os dois ultimos casos deste arquivo, que aproximam a camera
        // ate 0,046 m por pixel. Esta assercao fica porque ela pega a cunha GRANDE (a de 1,5 grau
        // do motor substituido media 9 px aqui) sem custar um caso proprio.
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
        // Medido em 2026-09-16, com a folga da emenda em zero: 299559 verdes (33,991%); eram
        // 298451 (33,865%) com a folga de 0,1 grau. O piso e baixo de proposito, porque o que se
        // cobra aqui e que os DOIS pedacos tenham desenhado; a forma exata e assunto do primeiro
        // caso, que trabalha com referencia de pixel.
        expect(proporcaoVerde, 'area visivel com o setor partido em dois').toBeGreaterThan(0.25);

        // A EMENDA, LIDA NA LINHA. O setor e simetrico em torno do norte e o norte cai na vertical
        // do observador na tela, entao a emenda mora numa faixa estreita de colunas. Procura-se
        // chao CRU (o cinza 129,129,135 desta cena, que nenhuma passada tingiu) entre pixels
        // tingidos: e isso, e so isso, que e a fresta.
        const emenda = await page.evaluate(({ linhas, x0, x1 }) => {
            const canvas = window.map.scene.canvas;
            const espelho = document.createElement('canvas');
            espelho.width = canvas.width;
            espelho.height = canvas.height;
            const ctx = espelho.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(canvas, 0, 0);
            let maiorCorrida = 0;
            for (const y of linhas) {
                const d = ctx.getImageData(x0, y, x1 - x0, 1).data;
                let corrida = 0;
                for (let i = 0; i < d.length; i += 4) {
                    const cru = Math.abs(d[i] - 129) < 6
                        && Math.abs(d[i + 1] - 129) < 6
                        && Math.abs(d[i + 2] - 135) < 6;
                    corrida = cru ? corrida + 1 : 0;
                    if (corrida > maiorCorrida) maiorCorrida = corrida;
                }
            }
            return { maiorCorrida };
        }, { linhas: [260, 300, 360, 420], x0: 570, x1: 655 });

        console.info(`[viewshed-pixel] 180 graus: maior corrida de chao cru na emenda = ${emenda.maiorCorrida} px`);
        // Com a folga de 1,5 grau a corrida media 6 a 9 pixels nestas linhas; com 0,1 grau e com a
        // folga de hoje (zero) ela e zero, e as duas nao se distinguem AQUI: e por isso que a
        // emenda ganhou os dois casos aproximados no fim deste arquivo. O teto de 2 deixa passar um
        // pixel de rasterizacao do proprio fio de arame sem deixar passar a cunha grande.
        expect(
            emenda.maiorCorrida,
            'fresta na emenda: chao dentro do setor que nenhum sub-viewshed analisou',
        ).toBeLessThanOrEqual(2);
    });

    test('a abertura pedida nao depende da forma da janela', async ({ page }) => {
        // ESTE CASO NAO OLHA PIXEL, E E POR ISSO QUE ELE EXISTE. Ate 2026-09-15 a camera que
        // renderiza o mapa de profundidade do observador recebia `aspectRatio` igual ao da JANELA.
        // `PerspectiveFrustum.fov` e o angulo HORIZONTAL quando a razao e maior que 1 e o VERTICAL
        // quando e menor, e a outra metade sai do divisor: numa janela em pe, um setor de 120 graus
        // era renderizado com 84 de abertura horizontal. A perda acontecia na recusa 2 do shader
        // (fora do tronco do mapa de sombras), que roda ANTES das duas de abertura, entao nem o
        // parametro guardado nem a malha desenhada a denunciavam, e a referencia de pixel deste
        // arquivo (paisagem) nao a via.
        //
        // Medido, pedindo 120 graus nos dois eixos: 1280x720 dava 120,00 e 91,07; 900x900 dava
        // 116,76 e 120,00; 720x1280 dava 83,88 e 120,00. Controle negativo: devolver o
        // `aspectRatio` da janela reprova aqui, no caso retrato, com cerca de 84.
        await page.setViewportSize({ width: 720, height: 1280 });
        await registrarTileset(page);
        await servirTileset(page);
        await bootar(page);

        const abriu = await abrirVisualizador3d(page);
        if (!abriu) {
            test.skip(true, 'o visualizador Cesium nao inicializou sem cabeca; limite de ambiente');
            return;
        }

        const medido = await page.evaluate(async ({ obs, piso, passo }) => {
            const C = window.Cesium;
            const { Viewshed3D } = await import('/src/js/3d_models_viewer_tool/services/viewshed-3d.js');
            const vs = new Viewshed3D(window.map, {
                cameraPosition: C.Cartesian3.fromDegrees(obs.longitude, obs.latitude, piso + 1.5),
                viewPosition: C.Cartesian3.fromDegrees(obs.longitude, obs.latitude + passo, piso),
                horizontalAngle: 120,
                verticalAngle: 120,
                distance: 186,
            });
            const f = vs._observerCamera.frustum;
            const a = f.aspectRatio;
            const grau = (rad) => (rad * 180) / Math.PI;
            // A conta e a mesma que o Cesium faz: com razao >= 1 o `fov` e o horizontal.
            const fovH = a >= 1 ? f.fov : 2 * Math.atan(Math.tan(f.fov / 2) * a);
            const fovV = a >= 1 ? 2 * Math.atan(Math.tan(f.fov / 2) / a) : f.fov;
            const canvas = window.map.scene.canvas;
            const resultado = {
                larguraDoCanvas: canvas.width,
                alturaDoCanvas: canvas.height,
                aspectRatio: a,
                fovHorizontal: grau(fovH),
                fovVertical: grau(fovV),
            };
            try { vs.destroy(); } catch { /* ignore */ }
            return resultado;
        }, { obs: OBSERVADOR, piso: PISO, passo: PASSO_NORTE });

        console.info(
            `[viewshed-pixel] janela em pe ${medido.larguraDoCanvas}x${medido.alturaDoCanvas}: ` +
                `H=${medido.fovHorizontal.toFixed(2)} V=${medido.fovVertical.toFixed(2)}`,
        );
        expect(
            medido.alturaDoCanvas,
            'a janela deste caso tem de ser mais alta que larga, senao ele nao mede nada',
        ).toBeGreaterThan(medido.larguraDoCanvas);
        expect(medido.fovHorizontal, 'abertura horizontal efetiva do tronco do observador')
            .toBeCloseTo(120, 1);
        expect(medido.fovVertical, 'abertura vertical efetiva do tronco do observador')
            .toBeCloseTo(120, 1);
    });

    // ==================== A COSTURA, DE PERTO ====================
    // O cabeçalho deste arquivo carrega o porquê das quatro réguas e o que cada uma veria se a
    // costura estivesse errada. Aqui ficam só os números.

    for (const caso of CASOS_DE_COSTURA) {
        test(`a emenda de um setor de ${caso.angulo} graus (${caso.pedacos} pedacos) nao abre fresta, nao satura e nao corta a sombra`, async ({ page }) => {
            const errosDaPagina = [];
            page.on('pageerror', (erro) => errosDaPagina.push(`pageerror: ${erro.message}`));

            await registrarTileset(page);
            await servirTileset(page);
            await bootar(page);

            const abriu = await abrirVisualizador3d(page);
            if (!abriu) {
                test.skip(true, 'o visualizador Cesium nao inicializou sem cabeca; limite de ambiente');
                return;
            }

            await montarCena(page, OBSERVADOR, { muroNaEmenda: true });
            const criado = await criarViewshedDeCostura(page, caso.angulo);
            await fixarCamera(page, OBSERVADOR, ENQUADRAMENTO_COSTURA);

            expect(
                criado.pedacos,
                `${caso.angulo} graus tem de virar ${caso.pedacos} sub-viewsheds; outro numero ` +
                    'significa que `subViewshedLayout` mudou de fronteira e este caso passou a ' +
                    'medir outro corte',
            ).toBe(caso.pedacos);
            expect(
                criado.estagios,
                'cada pedaco registra um estagio de pos-processamento: um estagio a menos ' +
                    'significa que um pedaco foi recusado em silencio (nome de estagio repetido)',
            ).toBe(caso.pedacos);
            expect(errosDaPagina, 'a pagina reportou erro antes da leitura de pixel').toEqual([]);

            const m = await medirCostura(page);
            gravarPng(path.join(DIR_SAIDA, `viewshed-3d-costura-${caso.angulo}-atual.png`), m.png);
            console.info(
                `[viewshed-costura] ${caso.angulo} graus: verde=${m.verde} vermelho=${m.vermelho} ` +
                    `arame=${m.arame} ancoras=${m.ancoraEsquerda}/${m.ancoraDireita} de ` +
                    `${m.totalDaAncora} fresta=${m.frestaNaEmenda} px (y=${m.linhaDaFresta}) ` +
                    `buracoNaSombra=${m.buracoNaSombra} ` +
                    `vermelhosPorColuna=[${m.vermelhosPorColunaNaSombra.join(',')}]/${m.linhasDaSombra} ` +
                    `medianaEmenda=${m.medianaEmenda} medianaReferencia=${m.medianaReferencia} ` +
                    `medianaPorColuna=[${m.medianaPorColuna.join(',')}]`,
            );

            // CADA REGUA VEM PRECEDIDA DA GUARDA QUE A IMPEDE DE SER VAZIA, e a ordem entre as
            // tres e escolhida: a fresta primeiro, porque e o defeito que as outras duas guardas
            // tambem detectam de lado, e ler "a sombra falta na coluna" quando a causa e a cunha
            // cega manda consertar a coisa errada. Uma regua que procura fresta numa janela sem
            // tinta nenhuma passa verde sem verificar nada, e foi assim que a medicao de
            // 2026-09-15 concluiu "0 px" sobre uma fresta que existia.
            expect(
                Math.min(m.ancoraEsquerda, m.ancoraDireita) / m.totalDaAncora,
                'as duas BORDAS da janela varrida tem de estar tingidas, senao a regua da fresta ' +
                    'procura chao cru onde nao havia tinta para comecar',
            ).toBeGreaterThan(0.8);

            // REGUA 1: A FRESTA. Chao CRU (nenhuma passada o tingiu) entre dois pixels tingidos, em
            // CADA LINHA da coluna da emenda, do arco de distancia ate a borda de baixo do quadro:
            // chao, muro e sombra do muro, sem vao entre as faixas. Medido em 2026-09-16 nesta
            // arvore, na mesma cena e no mesmo enquadramento:
            //
            //     folga 0 + eixo de azimute comum (hoje)                     0 px
            //     folga 0 + eixo de azimute por pedaco (ate hoje)            2 px, no muro
            //     folga 0,1 grau                                             4 px, no chao
            //     folga 1,5 grau                                            62 px, no chao
            //
            // A segunda linha e o defeito que esta faixa unica existe para pegar, e o controle
            // negativo dele e trocar `_azimuthAxis` por `_observerCamera.upWC` em
            // `frontend/src/js/3d_models_viewer_tool/services/viewshed-3d.js`. O teto de 1 deixa
            // passar um pixel de rasterizacao sem deixar passar nenhuma das tres.
            expect(
                m.frestaNaEmenda,
                'fresta na emenda: pedaco do setor que nenhum sub-viewshed analisou. A linha ' +
                    'reportada acima diz ONDE, e o muro fica entre as linhas 339 e 455',
            ).toBeLessThanOrEqual(1);

            // REGUA 2: A FAIXA SATURADA. Uma tinta so deixa o canal oposto em ~62 sobre este chao;
            // duas misturas sobre o mesmo pixel deixam ~31. A comparacao e contra o MESMO chao a
            // mais de 5 graus da emenda, e nao contra um numero absoluto, porque o valor depende da
            // cor do chao e da forca da mistura. Medido: 62 contra 62 com a folga de hoje, 31
            // contra 62 com os pedacos sobrepostos em 1,5 grau.
            expect(
                m.verdesNaEmenda,
                'a mediana da emenda precisa de verdes para ser mediana de alguma coisa',
            ).toBeGreaterThan(500);
            expect(
                Math.abs(m.medianaEmenda - m.medianaReferencia),
                'faixa saturada: a tinta da emenda esta mais forte que a do mesmo chao a 5 graus ' +
                    'dali, ou seja, os dois sub-viewsheds estao pintando o mesmo pixel',
            ).toBeLessThanOrEqual(10);
            expect(
                Math.min(...m.medianaPorColuna),
                'faixa saturada, coluna a coluna: nenhuma coluna da emenda pode ter tinta mais ' +
                    'forte que a de uma passada so',
            ).toBeGreaterThanOrEqual(m.medianaReferencia - 15);

            // REGUA 3: A SOMBRA CONTINUA. Descendo as colunas da emenda dentro da faixa da sombra
            // do muro, o vermelho nao pode se interromper. Com a folga de 0,1 grau esta faixa era
            // CRUA de ponta a ponta na coluna central, ou seja, a analise nao respondia nada numa
            // linha que atravessava o obstaculo e a sombra dele.
            expect(
                Math.min(...m.vermelhosPorColunaNaSombra),
                'CADA coluna da emenda tem de estar quase toda vermelha dentro da faixa da sombra: ' +
                    'uma coluna sem vermelho nenhum e a sombra do muro faltando ali por inteiro, e ' +
                    'e o caso em que a regua do buraco, abaixo, nao teria o que medir',
            ).toBeGreaterThan(100);
            expect(
                m.buracoNaSombra,
                'a sombra do muro se interrompe na costura: a coluna de vermelho tem um buraco',
            ).toBeLessThanOrEqual(1);

            // REGUA 4: pixel e classe contra a referencia versionada, a mesma dos primeiros casos.
            const arquivo = REFERENCIA_COSTURA[caso.angulo];
            if (REGERAR || !fs.existsSync(arquivo)) {
                gravarPng(arquivo, m.png);
                console.info(`[viewshed-costura] referencia (re)gerada em ${arquivo}`);
            }
            const referencia = 'data:image/png;base64,' + fs.readFileSync(arquivo).toString('base64');
            const diff = await compararImagens(page, m.png, referencia);
            expect(diff.mesmoTamanho, 'a referencia tem outro tamanho que o canvas desta rodada').toBe(true);
            console.info(
                `[viewshed-costura] ${caso.angulo} graus: diferentes=${diff.diferentes}/${diff.total} ` +
                    `(${(diff.razao * 100).toFixed(3)}%) classe=${(diff.razaoClasse * 100).toFixed(3)}%`,
            );
            expect(diff.razao, 'pixels diferentes da referencia da costura').toBeLessThanOrEqual(0.01);
            expect(diff.razaoClasse, 'classificacao diferente da referencia da costura')
                .toBeLessThanOrEqual(0.01);
        });
    }
});
