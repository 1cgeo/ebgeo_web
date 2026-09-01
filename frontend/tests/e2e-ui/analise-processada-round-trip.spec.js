// Path: e2e-ui/analise-processada-round-trip.spec.js

/**
 * @fileoverview A ÚLTIMA LACUNA DAS FIXTURES `.ebgeo`: feição de análise PROCESSADA
 * (`processed_los` e `processed_visibility`), semeada pelas ferramentas reais e levada ao disco
 * e de volta.
 *
 * ---------------------------------------------------------------------------
 * A PREMISSA ANTERIOR ERA FALSA, E ELA CUSTOU ESTE CASO POR MESES
 * ---------------------------------------------------------------------------
 * O `@fileoverview` de `tests/e2e-ui/lacunas-de-fixture-round-trip.spec.js` declarava esta
 * terceira lacuna como intestável nesta camada, "porque produzi-las exige o serviço de elevação
 * no ar respondendo a consulta de perfil". Isso não é verdade, e a refutação é de código, não de
 * opinião: `getTerrainElevation` (`terrain/terrain.control.js`) chama exatamente duas coisas,
 * `map.getTerrain()` e `map.queryTerrainElevation()`, as duas do MapLibre e nenhuma delas rede
 * nossa; e a guarda que faz `activate()` das duas ferramentas recusar é
 * `isTerrainAvailable(map)`, que é `map.getTerrain() !== null`. O que a análise exige, então, não
 * é serviço de elevação: é TERRENO LIGADO. Medido antes de escrever este arquivo, com os dois
 * métodos substituídos e o resto do produto intacto, as duas ferramentas rodam e escrevem.
 *
 * ---------------------------------------------------------------------------
 * O QUE É REAL AQUI, E É QUASE TUDO
 * ---------------------------------------------------------------------------
 * Reais: a barra de ferramentas (o grupo Análise, o gate de terreno que desabilita os dois
 * botões, os cliques de verdade no canvas), a matemática de visada de
 * `analysis_tools/los_tool/add_los_geometry.js`, a varredura de ângulo máximo do viewshed em
 * `analysis_tools/visibility_tool/add_visibility_geometry.js`, a persistência pelo store, o
 * modal de exportação, o zip mascarado, o download pelo disco e o import não aditivo num atlas
 * local novo.
 *
 * SINTÉTICA é UMA coisa só: a FONTE de elevação, por dois métodos do MapLibre substituídos no
 * objeto do mapa (`getTerrain` e `queryTerrainElevation`). Nada do nosso código é dublado, e
 * nenhuma feição é montada à mão: quem escreve as quatro feições deste caso são as duas
 * ferramentas do produto, a partir de cliques.
 *
 * ---------------------------------------------------------------------------
 * POR QUE O TERRENO SINTÉTICO É PARTE DO SUJEITO, E NÃO CONVENIÊNCIA
 * ---------------------------------------------------------------------------
 * O par `-visible` / `-obstructed` que dá DOIS `processed_los` só existe quando a geometria da
 * visada sai `MultiLineString`, e ela só sai `MultiLineString` quando `calculateLOS` encontrou um
 * ponto de obstrução (`createLOSFeature`). Sobre terreno plano não há obstrução, a geometria sai
 * `LineString` e `generateProcessedFeatures` devolve UMA feição, não duas. Ou seja: sem a colina
 * o número muda, e o número é o que este caso afirma. A colina não está aqui para o teste rodar,
 * está aqui para o teste ter o que medir.
 *
 * A ARITMÉTICA DO RAIO DA COLINA, que é o que impede este caso de virar moeda ao ar. A sonda que
 * refutou a premissa usava uma colina de 0,03 grau, o mesmo valor do raio do viewshed pedido pelos
 * cliques, e isso deixa a borda do setor EM CIMA da borda do platô. Duas coisas conspiram ali:
 * `calculateDistanceStep` devolve 30 m e `numPointsPerRay` é `Math.ceil(raio / 30)`, de modo que o
 * anel mais externo cai ALÉM do raio pedido; e o pixel do clique é arredondado para inteiro, o que
 * move o raio em até meio pixel (a ordem de 0,0003 grau no zoom 11). Com as duas bordas coincidindo,
 * um punhado de células do anel externo cai fora do platô e vira `-obstructed`, e a contagem de
 * `processed_visibility` alterna entre 1 e 2 conforme o arredondamento do clique. O raio daqui é
 * portanto MAIOR que o do viewshed com folga (`COLINA_RAIO_GRAUS`), e as duas pontas da visada
 * continuam fora dele com folga igual. Isso não afrouxa nada: as quatro contagens seguem absolutas.
 *
 * ---------------------------------------------------------------------------
 * O QUE UM VERDE AQUI NÃO PROVA
 * ---------------------------------------------------------------------------
 * - NADA sobre a CORREÇÃO NUMÉRICA do cálculo de visada ou do viewshed. A elevação vem de uma
 *   função de duas linhas escrita aqui, então o que se mede é que o algoritmo consome terreno,
 *   distingue visível de obstruído e escreve as duas saídas. Se a leitura do DEM real estiver
 *   errada, se a exageração for aplicada na hora errada, se a amostragem for grossa demais para
 *   um relevo de verdade, este caso continua verde. O sujeito é o CICLO da feição processada, não
 *   a topografia.
 * - NADA sobre atlas de SERVIDOR. O caso roda deslogado, sobre atlas local do começo ao fim.
 *   Feição processada tem op de sync própria e um caminho remoto que este caso não encosta.
 * - NADA sobre o DESENHO das camadas processadas no mapa. O que se lê é o store e o arquivo;
 *   `processed_los` e `processed_visibility` nascem com `label` e `icon` nulos no registro de
 *   tipos, ou seja, são desenhadas e nunca nomeadas, e nenhuma tela deste caso as nomeia.
 * - NADA sobre EDITAR ou MOVER a feição de análise depois de criada (os caminhos de
 *   `recalculateFromCoordinates` e `batchUpdate*`), nem sobre a exclusão em cascata da saída
 *   quando a entrada morre.
 * - NADA sobre o que a fixture mínima já não tem: comentário, imagem anexada, briefing, ícone,
 *   grupo, camada além da `default`. Isso é assunto das duas specs irmãs de round-trip.
 * - As PROPRIEDADES são comparadas na projeção JSON do estado vivo (a leitura devolve
 *   `JSON.parse(JSON.stringify(...))`), porque é essa a forma que o arquivo pode carregar. Um
 *   valor que só exista em memória como `undefined` não é distinguido de ausente aqui.
 */

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { readState } from './state.js';
import { loadEbgeoFixture } from '../helpers/ebgeo-fixture.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** A fixture MÍNIMA: 1 mapa `Principal`, 1 feição de ponto, 1 camada `default`, e nada mais. */
const FIXTURE_NOME = '02-minimo.ebgeo';

/** A mesma fixture por caminho absoluto, que é como `setInputFiles` a aceita. */
const FIXTURE = fileURLToPath(new URL(`../fixtures/ebgeo-2.2/${FIXTURE_NOME}`, import.meta.url));

/** O mapa único da fixture. */
const MAPA = 'Principal';

/** Quantos mapas a fixture declara. Entra no texto dos dois toasts. */
const MAPAS = 1;

/** Máscara que o exportador aplica ao zip (`exportImportService.xorData`). */
const XOR_KEY = 0xAA;

/** Prefixo mágico que o exportador põe na frente do zip mascarado. */
const MASK_HEADER = 'EBGXOR';

/**
 * Os quatro baldes que este caso mede: as duas ENTRADAS que o operador desenha e as duas SAÍDAS
 * que os algoritmos escrevem. Os nomes de armazenamento são verbatim, sem plural: `processed_los`
 * e não `processed_loss` (ver `store/feature-type.registry.js`).
 */
const BALDES = ['los', 'visibility', 'processed_los', 'processed_visibility'];

/**
 * O ESTADO ESPERADO DEPOIS DE SEMEAR, medido e depois derivado do código:
 * uma visada, um viewshed, o PAR visível/obstruído da visada, e só a metade visível do viewshed
 * (o setor inteiro cai sobre o platô, então `obstructedCoords` fica vazio e
 * `generateProcessedFeatures` não emite a segunda feição).
 */
const ESPERADO = Object.freeze({
    los: 1,
    visibility: 1,
    processed_los: 2,
    processed_visibility: 1,
});

/** O estado ANTES de semear: os quatro baldes existem na fixture e estão vazios. */
const VAZIO = Object.freeze({ los: 0, visibility: 0, processed_los: 0, processed_visibility: 0 });

/** Centro do relevo sintético e centro da câmera. */
const COLINA_LNG = -43.2;

/** Latitude única de todo o caso: a visada e o viewshed correm sobre o mesmo paralelo. */
const LAT = -22.9;

/**
 * Meia-largura do platô, em graus de longitude. MAIOR que o raio do viewshed de propósito: ver a
 * aritmética no `@fileoverview`. Com 0,05 o setor inteiro (raio da ordem de 0,03 grau, anel
 * externo incluído) cai sobre terreno de cota constante, e as duas pontas da visada, a 0,06 grau
 * do centro, ficam fora dele com a mesma folga.
 */
const COLINA_RAIO_GRAUS = 0.05;

/** Cota do platô, em metros. Alta o bastante para obstruir uma visada rasante sem ambiguidade. */
const COLINA_COTA = 1200;

/** As duas pontas da visada, ambas FORA do platô, com a colina inteira entre elas. */
const LOS_A = [-43.26, LAT];
const LOS_B = [-43.14, LAT];

/** Centro e borda do setor de visibilidade, ambos DENTRO do platô. */
const VIS_CENTRO = [COLINA_LNG, LAT];
const VIS_BORDA = [-43.17, LAT];

/**
 * Tolerância da comparação de coordenadas entre o estado VIVO e o ARQUIVO.
 *
 * `optimizeFeature` (`import_export/export-import.service.js`) arredonda toda coordenada a seis
 * casas ao sair, então metade de um passo de 1e-6 é o desvio máximo que o exportador pode
 * introduzir. A folga de 1e-12 cobre a representação binária de `Math.round(c * 1e6) / 1e6`, que
 * em valores da ordem de 43 tem ulp perto de 7e-15. Isto NÃO é uma comparação frouxa: é o limite
 * exato da transformação declarada, e uma coordenada trocada por outra estoura por ordens de
 * grandeza.
 */
const TOLERANCIA_ARREDONDAMENTO = 5e-7 + 1e-12;

/** Diretório temporário do download, criado no caso e apagado no `afterAll`. */
let dirTemporario = null;

/**
 * Decodifica um `.ebgeo` por CAMINHO ABSOLUTO.
 *
 * A decodificação está copiada aqui pela razão já registrada nas duas specs irmãs de round-trip:
 * `loadEbgeoFixture` só aceita um NOME de arquivo DENTRO de `tests/fixtures/ebgeo-2.2/`, e aquele
 * diretório é conferido por sha256, então salvar o download lá para reusar o helper significaria
 * escrever num diretório que ninguém pode ganhar vizinho. O formato são três linhas: ZIP mascarado
 * por XOR com chave `0xAA`, atrás de um cabeçalho `EBGXOR` de seis bytes.
 *
 * @param {string} caminho - Caminho absoluto do `.ebgeo`.
 * @returns {Promise<{ data: Object, imagensNoZip: string[] }>}
 */
async function decodificarEbgeo(caminho) {
    const raw = new Uint8Array(await readFile(caminho));

    const header = new TextDecoder().decode(raw.slice(0, MASK_HEADER.length));
    if (header !== MASK_HEADER) {
        throw new Error(`analise-processada: ${caminho} nao comeca com ${MASK_HEADER}`);
    }
    const zipBytes = Uint8Array.from(raw.slice(MASK_HEADER.length), (byte) => byte ^ XOR_KEY);

    const zip = await JSZip.loadAsync(zipBytes);
    const dataFile = zip.file('data.json');
    if (!dataFile) throw new Error(`analise-processada: ${caminho} nao tem data.json`);

    return {
        data: JSON.parse(await dataFile.async('string')),
        imagensNoZip: zip.file(/^images\/.+/)
            .map((entry) => entry.name.replace(/^images\//, '').replace(/\.[^.]+$/, ''))
            .sort(),
    };
}

/**
 * Achata qualquer aninhamento de coordenadas GeoJSON numa lista plana de números.
 * @param {*} valor - Número ou array (de qualquer profundidade).
 * @param {number[]} [saida] - Acumulador.
 * @returns {number[]}
 */
function achatarCoordenadas(valor, saida = []) {
    if (typeof valor === 'number') {
        saida.push(valor);
        return saida;
    }
    if (Array.isArray(valor)) {
        for (const item of valor) achatarCoordenadas(item, saida);
    }
    return saida;
}

/**
 * Compara dois conjuntos de coordenadas pelo número de valores e pela maior diferença absoluta.
 *
 * O achatamento é DELIBERADO e vem com o par de comprimentos: um `toEqual` sobre a geometria do
 * viewshed compararia dezenas de milhares de números e, ao falhar, imprimiria um diff que ninguém
 * lê. O comprimento pega perda de célula e o delta pega coordenada trocada, que são os dois modos
 * de falha reais.
 *
 * @param {*} a - Coordenadas de um lado.
 * @param {*} b - Coordenadas do outro.
 * @returns {{ quantosA: number, quantosB: number, delta: number }}
 */
function compararCoordenadas(a, b) {
    const listaA = achatarCoordenadas(a);
    const listaB = achatarCoordenadas(b);
    if (listaA.length !== listaB.length) {
        return { quantosA: listaA.length, quantosB: listaB.length, delta: Number.POSITIVE_INFINITY };
    }
    let delta = 0;
    for (let i = 0; i < listaA.length; i++) {
        delta = Math.max(delta, Math.abs(listaA[i] - listaB[i]));
    }
    return { quantosA: listaA.length, quantosB: listaB.length, delta };
}

/**
 * Os ids de feição de um balde, ordenados.
 * @param {Array} lista - Feições do balde.
 * @returns {string[]}
 */
function idsDe(lista) {
    return (lista ?? []).map((f) => f?.properties?.id).sort();
}

/**
 * Uma feição de um balde, achada pelo id. Falha ALTO em vez de devolver `undefined`, senão a
 * comparação seguinte compararia dois indefinidos e passaria verde.
 * @param {Array} lista - Feições do balde.
 * @param {string} id - Id procurado.
 * @returns {Object}
 */
function feicaoPorId(lista, id) {
    const achada = (lista ?? []).find((f) => f?.properties?.id === id);
    if (!achada) {
        throw new Error(`analise-processada: nenhuma feicao com id ${id} entre [${idsDe(lista).join(', ')}]`);
    }
    return achada;
}

/** Espera o mapa 2D estar de pé. */
async function esperarMapa(page) {
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 30000 });
    await page.waitForFunction(
        () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function',
        null,
        { timeout: 30000 },
    );
}

/**
 * Entrega um `.ebgeo` pela tela de atlas e espera o mapa terminar de importar.
 *
 * O ÂNCORA É O TOAST DE SUCESSO, e não a contagem de mapas: ele é a ÚLTIMA linha do fluxo de
 * import, então esperar por ele é o que impede as leituras seguintes de correrem contra escritas
 * ainda em voo.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} arquivo - Caminho absoluto do `.ebgeo`.
 */
async function importarPelaTela(page, arquivo) {
    await expect(page.locator('[data-testid="local-atlas-section"]')).toBeVisible({ timeout: 20000 });
    await page.locator('[data-testid="local-atlas-file-input"]').setInputFiles(arquivo);

    // A tela NAVEGA; quem importa é o boot do mapa.
    await page.waitForURL((url) => !url.pathname.endsWith('atlas.html'), { timeout: 30000 });
    await esperarMapa(page);
    // Pluralização do produto, reproduzida como está no código: com UM mapa ele escreve
    // "1 mapa carregados!" (`showLoadSuccess`).
    await expect(page.locator('.toast', { hasText: `${MAPAS} mapa carregados!` }))
        .toBeVisible({ timeout: 60000 });
}

/** Abre a aba Mapas UMA vez. O botão é um TOGGLE: clicá-lo de novo fecha a barra lateral. */
async function abrirAbaMapas(page) {
    await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    await expect(page.locator('.maps-tab .map-list-item[data-map-name]').first())
        .toBeVisible({ timeout: 15000 });
}

/** O botão de uma das duas ferramentas de análise. */
function botaoDeAnalise(page, toolId) {
    return page.locator(`.toolbar-group[data-group-id="analysis"] .toolbar-tool-btn[data-tool-id="${toolId}"]`);
}

/**
 * Abre a gaveta do grupo Análise, e é IDEMPOTENTE de propósito.
 *
 * O botão do grupo ALTERNA a gaveta, então um segundo clique com ela aberta a fecharia, e os
 * botões de ferramenta ficam dentro dela: sem a gaveta aberta eles existem no DOM e não recebem
 * clique. Ler o estado antes de clicar é o que permite chamar esta função das duas vezes sem
 * saber em que estado a anterior deixou a barra.
 *
 * @param {import('@playwright/test').Page} page
 */
async function abrirGrupoAnalise(page) {
    const popup = page.locator('.toolbar-group[data-group-id="analysis"] .toolbar-popup');
    if ((await popup.getAttribute('data-visible')) !== 'true') {
        await page.locator('.toolbar-group[data-group-id="analysis"] .toolbar-group-btn').click();
    }
    await expect(popup).toHaveAttribute('data-visible', 'true', { timeout: 10000 });
}

/**
 * Instala o relevo sintético NO OBJETO DO MAPA e avisa o produto.
 *
 * Os dois métodos substituídos são os ÚNICOS que `getTerrainElevation` consulta, e o `fire`
 * final é o evento que o MapLibre emitiria ao ligar terreno de verdade: é ele que faz
 * `_updateTerrainTools` (`toolbar/components/toolbar-group.js`) reabilitar os dois botões e
 * `_onTerrainChange` dos dois controles parar de derrubar a ferramenta.
 *
 * O PONTO FIXO IMPORTA: `getTerrainElevation` mede sempre a diferença contra `[0, 0]`, então a
 * função precisa devolver algo definido e plano lá, ou toda cota sairia deslocada. `[0, 0]` está
 * a 43,2 graus do platô, logo cai no ramo do zero.
 *
 * @param {import('@playwright/test').Page} page
 */
async function instalarTerrenoSintetico(page) {
    await page.evaluate(({ lng, raio, cota }) => {
        const map = globalThis.__ebgeoMap;
        map.getTerrain = () => ({ source: 'terreno-sintetico', exaggeration: 1 });
        map.queryTerrainElevation = (coords) => {
            const lon = Array.isArray(coords) ? coords[0] : coords?.lng;
            if (!Number.isFinite(lon)) return 0;
            return Math.abs(lon - lng) < raio ? cota : 0;
        };
        map.fire('terrain');
    }, { lng: COLINA_LNG, raio: COLINA_RAIO_GRAUS, cota: COLINA_COTA });
}

/**
 * Clica num lng/lat do mapa, projetando NO INSTANTE DO CLIQUE.
 *
 * Projetar antes da vez envelhece: terminar uma feição seleciona a nova e abre o painel de
 * atributos, que redimensiona o canvas e muda o que `project()` devolve. E a espera anterior ao
 * clique é pela CONDIÇÃO de que se precisa (o pixel pertence ao canvas), não pelo modelo de quem o
 * cobre: serve para a gaveta de ferramentas em transição, para o painel de atributos e para o
 * próximo elemento que alguém sobrepuser ao mapa.
 *
 * @param {import('@playwright/test').Page} page
 * @param {[number, number]} lngLat
 */
async function clicarNoMapa(page, lngLat) {
    await page.waitForFunction((ll) => {
        const map = globalThis.__ebgeoMap;
        if (!map) return false;
        const canvas = map.getCanvas();
        const rect = canvas.getBoundingClientRect();
        const pt = map.project(ll);
        const topo = document.elementFromPoint(
            Math.round(rect.left + pt.x),
            Math.round(rect.top + pt.y),
        );
        return !!topo && (topo === canvas || canvas.contains(topo));
    }, lngLat, { timeout: 15000 });

    const alvo = await page.evaluate((ll) => {
        const map = globalThis.__ebgeoMap;
        const rect = map.getCanvas().getBoundingClientRect();
        const p = map.project(ll);
        return { x: Math.round(rect.left + p.x), y: Math.round(rect.top + p.y) };
    }, lngLat);

    await page.mouse.click(alvo.x, alvo.y);
}

/**
 * Espera a ferramenta pedida ser reportada ativa PELO GERENTE, e não pelo `data-active` do botão.
 *
 * O atributo do botão vira no clique, enquanto `activate()` (que é quem recusa sem terreno e quem
 * arma o roteamento de clique) roda depois. Clicar no mapa nessa janela entrega o clique a
 * ninguém, e o desenho fica pendurado sem erro.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} toolId
 */
async function esperarFerramentaAtiva(page, toolId) {
    // `expect.poll` E NAO `page.waitForFunction`, e a diferenca foi MEDIDA. O predicado precisa de
    // `import()`, logo e assincrono, e `waitForFunction` com funcao `async` recebe de volta uma
    // PROMESSA, que e sempre truthy: a espera passa na primeira sondagem, sem olhar o valor. Aqui
    // isso entregava os cliques ao mapa ANTES de `activate()` armar o roteamento, e o desenho nao
    // acontecia; medido, a espera irma de balde retornou em 314 ms com o balde em ZERO e prazo de
    // 120 s. Verificador que quebra calado, exatamente da classe que a constituicao nomeia.
    // `expect.poll` aguarda a promessa antes de comparar.
    await expect
        .poll(async () => page.evaluate(async (id) => {
            const s = await import('/src/js/store/index.js');
            const ativo = s.getStateManager?.()?.getActiveTool?.();
            if (!ativo) return null;
            const norm = (v) => String(v).toLowerCase().replace(/[^a-z0-9]/g, '');
            return norm(ativo) === norm(id) ? id : String(ativo);
        }, toolId), { timeout: 20000, message: `a ferramenta ${toolId} nao ficou ativa` })
        .toBe(toolId);
}

/** Desocupa o mapa: painel de atributos fechado e barra lateral recolhida. */
async function desocuparOMapa(page) {
    await page.evaluate(async () => {
        const s = await import('/src/js/store/index.js');
        const sm = s.getStateManager?.();
        if (!sm) return;
        sm.closeFeaturePanel?.();
        sm.collapseSidebar?.();
    });
}

/**
 * Espera um balde do mapa corrente alcançar uma contagem.
 *
 * O viewshed é lento (varredura de sessenta raios sobre cem pontos cada, com pausas de progresso),
 * e o prazo aqui é generoso de propósito. A espera é por ESTADO, nunca por tempo fixo.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} balde - Nome de armazenamento do balde.
 * @param {number} quantos - Contagem mínima.
 * @param {number} prazo - Timeout em ms.
 */
async function esperarBalde(page, balde, quantos, prazo) {
    // `expect.poll`, pela mesma razao escrita em `esperarFerramentaAtiva`: com `waitForFunction` e
    // um predicado `async` esta espera retornava na primeira sondagem, qualquer que fosse a
    // contagem, e a spec so reprovava paginas adiante, longe da causa.
    await expect
        .poll(async () => page.evaluate(async ({ mapa, b }) => {
            const { getCurrentMapFeatures } = await import('/src/js/store/index.js');
            const f = await getCurrentMapFeatures(mapa);
            return f?.[b]?.length ?? 0;
        }, { mapa: MAPA, b: balde }), {
            timeout: prazo,
            intervals: [500, 1000],
            message: `o balde ${balde} nao alcancou ${quantos}`,
        })
        .toBeGreaterThanOrEqual(quantos);
}

/**
 * Lê do escopo ATIVO os quatro baldes de análise, mais a identidade do escopo.
 *
 * A LEITURA É A PROJEÇÃO JSON DO ESTADO VIVO, de propósito: é essa a forma que o `.ebgeo` pode
 * carregar, e comparar o objeto de memória contra o arquivo acusaria diferença em campo que a
 * serialização nunca teve como levar. Está declarado no `@fileoverview` como ponto cego.
 *
 * A IDENTIDADE DO ESCOPO VIAJA JUNTO porque sem ela "sobreviveu ao round-trip" seria
 * indistinguível de "eu reli o mesmo atlas em que semeei".
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ contagem: Object, porBalde: Object, atlasId: (string|null), slots: number }>}
 */
function lerAnalise(page) {
    return page.evaluate(async ({ mapa, baldes }) => {
        const { getCurrentMapFeatures } = await import('/src/js/store/index.js');
        const ns = await import('/src/js/store/atlas-namespace.js');
        const features = await getCurrentMapFeatures(mapa);

        const contagem = {};
        const porBalde = {};
        for (const balde of baldes) {
            const lista = Array.isArray(features?.[balde]) ? features[balde] : [];
            contagem[balde] = lista.length;
            porBalde[balde] = JSON.parse(JSON.stringify(lista));
        }

        return {
            contagem,
            porBalde,
            atlasId: ns.getActiveScope()?.atlasId ?? null,
            slots: (await ns.readLocalAtlasRegistry()).length,
        };
    }, { mapa: MAPA, baldes: BALDES });
}

/**
 * Os quatro baldes como o `data.json` os carrega.
 * @param {Object} data - O documento do arquivo.
 * @returns {{ contagem: Object, porBalde: Object }}
 */
function baldesDoArquivo(data) {
    const features = data.maps?.[MAPA]?.features ?? {};
    const contagem = {};
    const porBalde = {};
    for (const balde of BALDES) {
        const lista = Array.isArray(features[balde]) ? features[balde] : [];
        contagem[balde] = lista.length;
        porBalde[balde] = lista;
    }
    return { contagem, porBalde };
}

describeOrSkip('.ebgeo: feicao de analise processada atravessa o ciclo', () => {
    // SEM RETRY: um ciclo que só fecha na segunda tentativa é um ciclo que não fecha, e o
    // `retries: 1` do config transformaria isso em "flaky" com a rodada verde.
    test.describe.configure({ retries: 0 });

    test.afterAll(async () => {
        // `force` porque um caso que falhou antes de baixar não criou diretório nenhum.
        if (dirTemporario) await rm(dirTemporario, { recursive: true, force: true });
        dirTemporario = null;
    });

    test('semear visada e viewshed sobre terreno sintetico, exportar pelo botao, e reimportar', async ({ page }) => {
        test.setTimeout(600000);

        // ================================================================
        // 0. O CONTROLE NEGATIVO, NO LADO DA FIXTURE
        // ================================================================
        // Os quatro baldes EXISTEM na fixture e estão vazios. Se algum já trouxesse conteúdo,
        // "sobreviveu" não distinguiria o que este caso semeou do que ela já carregava.
        const original = await loadEbgeoFixture(FIXTURE_NOME);
        const { contagem: naFixture } = baldesDoArquivo(original.data);
        expect(naFixture, `${FIXTURE_NOME} nao pode trazer feicao de analise nenhuma`).toEqual(VAZIO);

        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);

        // ================================================================
        // 1. A FIXTURE VIRA UM ATLAS LOCAL
        // ================================================================
        await page.goto('/atlas.html');
        await importarPelaTela(page, FIXTURE);

        // ================================================================
        // 2. A PREMISSA, PARTE UM: ANTES DE SEMEAR NÃO HÁ NADA
        // ================================================================
        const antes = await lerAnalise(page);
        expect(antes.contagem, 'o atlas recem-importado nao tem feicao de analise').toEqual(VAZIO);
        expect(typeof antes.atlasId, 'o escopo de origem tem identidade').toBe('string');

        // ================================================================
        // 3. O GATE DE TERRENO, NOS DOIS SENTIDOS
        // ================================================================
        // Sem terreno os dois botões estão DESABILITADOS, e isso é o controle negativo do relevo
        // sintético: se eles já nascessem clicáveis, ligar o terreno não estaria provando nada.
        // O `disabled` do DOM é o sinal certo aqui porque é o mesmo predicado que
        // `_updateTerrainTools` aplica, e ele já cobre as DUAS condições do gate (existir
        // `config.map2d.terrainSource` e `map.getTerrain()` não ser nulo).
        await abrirGrupoAnalise(page);
        await expect(botaoDeAnalise(page, 'los'), 'sem terreno, Linha de Visada recusa').toBeDisabled();
        await expect(botaoDeAnalise(page, 'visibility'), 'sem terreno, Visibilidade recusa').toBeDisabled();

        await instalarTerrenoSintetico(page);
        await page.evaluate(({ centro }) => {
            globalThis.__ebgeoMap.jumpTo({ center: centro, zoom: 11 });
        }, { centro: VIS_CENTRO });

        await expect(botaoDeAnalise(page, 'los'), 'com terreno, Linha de Visada abre').toBeEnabled({ timeout: 10000 });
        await expect(botaoDeAnalise(page, 'visibility'), 'com terreno, Visibilidade abre').toBeEnabled({ timeout: 10000 });

        // ================================================================
        // 4. SEMEAR A VISADA (dois cliques, e a colina entre eles)
        // ================================================================
        await page.waitForFunction(() => {
            const map = globalThis.__ebgeoMap;
            return !!map && map.isStyleLoaded?.() === true && map.isMoving?.() === false;
        }, null, { timeout: 20000 });

        await abrirGrupoAnalise(page);
        await botaoDeAnalise(page, 'los').click();
        await esperarFerramentaAtiva(page, 'los');

        await clicarNoMapa(page, LOS_A);
        await clicarNoMapa(page, LOS_B);

        // O PAR, e não "pelo menos uma": duas saídas é o que a obstrução produz, e uma só seria o
        // sintoma de terreno plano, ou seja, do relevo sintético não ter chegado ao algoritmo.
        await esperarBalde(page, 'processed_los', ESPERADO.processed_los, 120000);

        // ================================================================
        // 5. SEMEAR O VIEWSHED
        // ================================================================
        // A ferramenta se desativa sozinha ao terminar a feição; o `Escape` aqui é o gesto que
        // fecha o que sobrou aberto, e desocupar o mapa em seguida tira o painel de atributos da
        // feição recém-criada de cima dos pixels do próximo clique.
        await page.keyboard.press('Escape');
        await desocuparOMapa(page);

        await abrirGrupoAnalise(page);
        await botaoDeAnalise(page, 'visibility').click();
        await esperarFerramentaAtiva(page, 'visibility');

        await clicarNoMapa(page, VIS_CENTRO);
        await clicarNoMapa(page, VIS_BORDA);

        // A varredura é longa e mostra um modal de progresso próprio. Espera-se o ESTADO (a saída
        // no store) e depois o sumiço do modal, que é o que libera a barra lateral para o clique
        // de exportação.
        await esperarBalde(page, 'processed_visibility', ESPERADO.processed_visibility, 300000);
        await expect(page.locator('.visibility-progress-modal--visible')).toHaveCount(0, { timeout: 60000 });
        await desocuparOMapa(page);

        // ================================================================
        // 6. A PREMISSA, PARTE DOIS: EXATAMENTE 1 / 1 / 2 / 1
        // ================================================================
        const origem = await lerAnalise(page);
        expect(origem.contagem, 'as duas entradas e as tres saidas que elas produzem')
            .toEqual(ESPERADO);

        const losId = origem.porBalde.los[0].properties.id;
        const visId = origem.porBalde.visibility[0].properties.id;
        expect(typeof losId, 'a visada tem id').toBe('string');
        expect(typeof visId, 'o viewshed tem id').toBe('string');

        // OS IDS DAS SAÍDAS SÃO DERIVADOS DOS DAS ENTRADAS, e essa é a única asserção de id que
        // pode ser absoluta sem escrever um UUID à mão: `generateProcessedFeatures` sufixa
        // `-visible` e `-obstructed` no id da feição de origem, nos dois algoritmos.
        const idsLosEsperados = [`${losId}-obstructed`, `${losId}-visible`].sort();
        expect(idsDe(origem.porBalde.processed_los), 'o par visivel/obstruido da visada')
            .toEqual(idsLosEsperados);
        expect(
            idsDe(origem.porBalde.processed_visibility),
            'so a metade VISIVEL do viewshed, porque o setor inteiro cai sobre o plato',
        ).toEqual([`${visId}-visible`]);

        // A NATUREZA DAS SAÍDAS, que a contagem sozinha não prende: a visada obstruída sai como
        // DUAS linhas simples (a `MultiLineString` da entrada partida em duas), e o viewshed sai
        // como um `MultiPolygon` de células.
        for (const id of idsLosEsperados) {
            const f = feicaoPorId(origem.porBalde.processed_los, id);
            expect(f.geometry.type, `${id} e uma linha simples`).toBe('LineString');
            expect(f.properties.source, `${id} guarda a origem que a gerou`).toBe('los');
        }
        const visSaida = feicaoPorId(origem.porBalde.processed_visibility, `${visId}-visible`);
        expect(visSaida.geometry.type, 'o viewshed processado e um MultiPolygon').toBe('MultiPolygon');
        expect(visSaida.properties.source, 'e guarda a origem que o gerou').toBe('visibility');

        // ================================================================
        // 7. EXPORTAR PELO BOTÃO DE VERDADE
        // ================================================================
        await abrirAbaMapas(page);
        // `#maps-action-save` é o id derivado de `maps-action-${action.id}`; a ação rotulada
        // "Exportar" tem `id: 'save'` e não tem `data-testid`.
        await page.locator('#maps-action-save').click();

        const modalDeExportacao = page.locator('.export-modal-container');
        await expect(modalDeExportacao).toBeVisible({ timeout: 20000 });
        await expect(modalDeExportacao.locator('.export-map-item')).toHaveCount(MAPAS);
        const confirmarExportacao = modalDeExportacao.locator('.export-modal-btn-confirm');
        await expect(confirmarExportacao).toBeEnabled();

        // O TOAST É TRANSITÓRIO, E A ESPERA DELE COMEÇA AQUI, junto com a do download e ANTES do
        // clique. Ele nasce logo depois do `a.click()` do exportador e morre por tempo, enquanto o
        // evento de download do Playwright chega depois disso; medido com MutationObserver na
        // spec irmã de lacunas, o toast já não estava no DOM quando `await baixado` resolvia.
        // `expect(...).toBeVisible()` começa a sondar no instante em que é chamado, então guardar
        // a promessa aqui cobre a janela inteira.
        const toastDeExportacao = expect(page.locator('.toast', { hasText: `${MAPAS} mapa exportado!` }))
            .toBeVisible({ timeout: 60000 });
        const baixado = page.waitForEvent('download', { timeout: 180000 });
        await confirmarExportacao.click();

        // O AVISO DE PODA DE CATÁLOGO É CONDICIONAL, e por isso não é asserido: a fixture mínima
        // não carrega 3D, 360 nem camada de catálogo, e as feições de análise não referenciam
        // recurso nenhum, então o único candidato é o basemap, cuja classificação depende do que o
        // `/api/config` desta instância declara. Asserir a presença seria afirmar o catálogo do
        // servidor de teste; nunca despachá-lo travaria no dia em que ele aparecesse.
        const avisoDePoda = page.locator('.confirm-modal-container');
        try {
            await avisoDePoda.waitFor({ state: 'visible', timeout: 8000 });
            await avisoDePoda.locator('.confirm-modal-btn-confirm').click();
        } catch {
            // Não apareceu: nada a despachar, o download já está a caminho.
        }

        const download = await baixado;
        await toastDeExportacao;

        dirTemporario = await mkdtemp(join(tmpdir(), 'ebgeo-analise-'));
        const nomeBaixado = download.suggestedFilename();
        const destino = join(dirTemporario, nomeBaixado);
        await download.saveAs(destino);

        // ================================================================
        // 8. OS BYTES QUE SAÍRAM (o exportador sozinho, sem importador no meio)
        // ================================================================
        const produzido = await decodificarEbgeo(destino);
        const noArquivo = baldesDoArquivo(produzido.data);

        expect(noArquivo.contagem, 'as quatro feicoes sairam, uma a uma').toEqual(ESPERADO);
        expect(idsDe(noArquivo.porBalde.processed_los), 'com os ids do par da visada')
            .toEqual(idsLosEsperados);
        expect(idsDe(noArquivo.porBalde.processed_visibility), 'e o id da saida do viewshed')
            .toEqual([`${visId}-visible`]);

        // O ZIP SAI SEM BLOB, e isto é o MECANISMO, não uma perda: `collectUsedImageIds` colhe o
        // id de toda feição, mas nenhuma feição de análise tem imagem gravada sob o seu id
        // (`imageResource: false` para os quatro tipos no registro), e a fixture não tem ícone.
        expect(produzido.imagensNoZip, 'analise nao carrega blob de imagem').toEqual([]);

        // PROPRIEDADES INTEIRAS, e não presença de chave: um exportador que perdesse `cellData`,
        // `profileData`, `color` ou `layerId` pelo caminho continuaria com a contagem certa.
        for (const balde of BALDES) {
            for (const viva of origem.porBalde[balde]) {
                const id = viva.properties.id;
                const doArquivo = feicaoPorId(noArquivo.porBalde[balde], id);
                expect(doArquivo.properties, `${balde}/${id}: as propriedades sairam inteiras`)
                    .toEqual(viva.properties);
                expect(doArquivo.geometry.type, `${balde}/${id}: o tipo de geometria saiu`)
                    .toBe(viva.geometry.type);

                // A GEOMETRIA MUDA NO CAMINHO, E ISSO É DECLARADO: `optimizeFeature` arredonda a
                // seis casas ao sair. O que não pode mudar é a QUANTIDADE de coordenadas, e o
                // desvio de cada uma tem teto conhecido.
                const comp = compararCoordenadas(viva.geometry.coordinates, doArquivo.geometry.coordinates);
                expect(comp.quantosB, `${balde}/${id}: nenhuma coordenada se perdeu na saida`)
                    .toBe(comp.quantosA);
                expect(comp.delta, `${balde}/${id}: o desvio cabe no arredondamento de 6 casas`)
                    .toBeLessThanOrEqual(TOLERANCIA_ARREDONDAMENTO);
            }
        }

        // ================================================================
        // 9. O ARQUIVO PRODUZIDO VOLTA PARA DENTRO DO PRODUTO
        // ================================================================
        await page.goto('/atlas.html');
        await importarPelaTela(page, destino);

        const reimportado = await lerAnalise(page);

        // O ESCOPO É OUTRO, E ESTA ASSERÇÃO É LOAD-BEARING. Se a reimportação caísse no mesmo
        // namespace, tudo abaixo estaria relendo o estado SEMEADO, e o caso inteiro passaria verde
        // sem que um único byte tivesse ido ao disco e voltado.
        expect(typeof reimportado.atlasId, 'o escopo reimportado tem identidade').toBe('string');
        expect(reimportado.atlasId, 'e ele NAO e o escopo em que se semeou').not.toBe(origem.atlasId);
        expect(reimportado.slots, 'reimportar criou um slot local, nem zero nem dois')
            .toBe(origem.slots + 1);

        expect(reimportado.contagem, 'as quatro feicoes voltaram, uma a uma').toEqual(ESPERADO);

        // OS IDS SÃO PRESERVADOS pelo import não aditivo (o ramo que substitui o projeto não passa
        // por `regenerateMapIds`, ao contrário do aditivo), e é isso que mantém a saída processada
        // amarrada à entrada que a gerou: sem o par de sufixos apontando para o mesmo id, editar a
        // visada do outro lado não acharia mais o que recalcular.
        expect(idsDe(reimportado.porBalde.los), 'o id da visada atravessou').toEqual([losId]);
        expect(idsDe(reimportado.porBalde.visibility), 'o id do viewshed atravessou').toEqual([visId]);
        expect(idsDe(reimportado.porBalde.processed_los), 'e o par continua sufixado por ele')
            .toEqual(idsLosEsperados);
        expect(idsDe(reimportado.porBalde.processed_visibility), 'e a saida do viewshed tambem')
            .toEqual([`${visId}-visible`]);

        // DO OUTRO LADO DO DISCO, CONTRA O ARQUIVO: aqui a comparação é EXATA, porque o
        // arredondamento já aconteceu na saída e o import não arredonda de novo.
        for (const balde of BALDES) {
            for (const doArquivo of noArquivo.porBalde[balde]) {
                const id = doArquivo.properties.id;
                const devolta = feicaoPorId(reimportado.porBalde[balde], id);
                expect(devolta.properties, `${balde}/${id}: as propriedades voltaram inteiras`)
                    .toEqual(doArquivo.properties);
                expect(devolta.geometry.type, `${balde}/${id}: o tipo de geometria voltou`)
                    .toBe(doArquivo.geometry.type);

                const comp = compararCoordenadas(doArquivo.geometry.coordinates, devolta.geometry.coordinates);
                expect(comp.quantosB, `${balde}/${id}: nenhuma coordenada se perdeu na volta`)
                    .toBe(comp.quantosA);
                expect(comp.delta, `${balde}/${id}: e nenhuma coordenada mudou de valor`).toBe(0);
            }
        }
    });
});
