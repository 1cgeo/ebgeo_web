// Path: e2e-ui/ebgeo-round-trip-arquivo.spec.js

/**
 * @fileoverview O CICLO INTEIRO DE UM `.ebgeo`, com o arquivo passando pelo DISCO: importar
 * `01-completo.ebgeo` pela tela, exportar pelo BOTAO de verdade, salvar o download, decodificar
 * os bytes que sairam, e reimportar aquele arquivo num atlas local novo.
 *
 * O QUE JA ERA MEDIDO E O QUE NAO ERA. O documento que o exportador monta EM MEMORIA ja tem
 * guarda (`tests/integration/export-le-do-repositorio.test.js` roda os predicados reais da tabela
 * de secoes opcionais), e a IMPORTACAO pela tela ja tem guarda
 * (`tests/e2e-ui/atlas-local-ebgeo-e-teardown.spec.js`). O que nunca teve foi o ciclo: o modal de
 * exportacao, o zip mascarado, o `a.click()`, o arquivo no disco e a volta. Cada peca verde e um
 * ciclo que ninguem tinha rodado ponta a ponta.
 *
 * ---------------------------------------------------------------------------
 * DUAS ASSERCOES, DUAS NATUREZAS, E A PRIMEIRA E A FORTE
 * ---------------------------------------------------------------------------
 * 1. OS BYTES PRODUZIDOS. O arquivo baixado e decodificado aqui no no e comparado com a fixture
 *    de origem: mapas, feicoes por mapa, camadas por mapa, grupos por mapa, briefings, slides,
 *    icones e as imagens dentro do zip. Isto mede o EXPORTADOR sozinho, sem nenhum importador
 *    entre ele e a asserção.
 *
 * 2. O ESTADO REIMPORTADO. O mesmo arquivo entra por `[data-testid="local-atlas-file-input"]`,
 *    vira um atlas local novo, e o repositorio e lido de dentro da pagina. Isto mede o par
 *    (exportador, importador) contra a fixture.
 *
 * A SEGUNDA SOZINHA SERIA QUASE CEGA, e o exemplo nao e hipotetico, e o mecanismo esta no
 * codigo: `LocalRepository.getLayers` devolve `[getDefaultLayer()]` quando o mapa nao tem
 * conjunto de camadas gravado. Um exportador que PERDESSE a secao de camadas de um mapa seria
 * compensado na volta por essa camada sintetica, e dez dos onze mapas da fixture tem exatamente
 * UMA camada: a leitura de estado devolveria o numero certo para dez deles. Foi um defeito dessa
 * familia que se pagou em 2026-09-01 (a secao de camadas lida da MEMORIA entregava uma `default`
 * inventada, e a de grupos saia vazia), e por isso `07 Camadas` (sete camadas) e `08 Grupos`
 * (dois grupos) sao os canarios das duas asserções, com controle absoluto sobre o lado da
 * fixture para que a comparacao nao possa ser dois zeros concordando.
 *
 * ---------------------------------------------------------------------------
 * O QUE UM VERDE AQUI NAO PROVA
 * ---------------------------------------------------------------------------
 * - NADA sobre atlas de SERVIDOR. O caso inteiro roda deslogado, sobre atlas local; o `.ebgeo`
 *   de um atlas remoto passa pela mesma funcao, mas por outro estado de sessao (e com a soma de
 *   recursos privados, que aqui nem chega a ser exigida).
 * - NADA sobre comentario espacial, feicao processada, imagem ANEXADA a feicao, camada de
 *   catalogo, gridStyle: a fixture nao carrega nenhum deles (`data.comments` e `data.gridStyle`
 *   sequer existem nela, e `catalogLayers` e vazio em todo mapa). Um verde diz que o que ESTA na
 *   fixture atravessa, e nada sobre o que nao esta.
 * - NADA sobre `colorUsage`, `mapNotes` e `temporal`, que a fixture TEM e este caso nao compara.
 *   Ficam declarados como ponto cego, nao como ausencia.
 * - NADA sobre 3D e 360. A poda de saida (`private-reference-pruner.js`) e keep-list: para um
 *   visitante anonimo toda referencia de tileset e de foto 360 resolve para `unknown` e SAI do
 *   arquivo, por decisao registrada. E por isso que o aviso de perda e esperado por extenso aqui
 *   em vez de ser contornado: ele e o comportamento, nao um obstaculo.
 * - NADA sobre os campos que o exportador INVENTA a cada exportacao em vez de ler do registro
 *   (`baseLayer`, `zoom`, `center_lat`, `center_long`, `bearing`, `pitch`, mais
 *   `hillshadeEnabled` e `analysisLayers` hardcoded). Compara-los seria comparar o estado vivo do
 *   mapa aberto com o de quem gerou a fixture. O `@fileoverview` de
 *   `tests/helpers/ebgeo-fixture.js` guarda a lista completa do que o exportador inventa, omite
 *   ou muda de lugar.
 * - A versao de schema MUDA no ciclo, de proposito: a fixture e `2.2` e o que sai e
 *   `ATLAS_SCHEMA_VERSION`. Isso e asserido como igualdade com a constante do codigo, nunca com a
 *   da fixture.
 */

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { readState } from './state.js';
import { loadEbgeoFixture, countFixture } from '../helpers/ebgeo-fixture.js';
import { ATLAS_SCHEMA_VERSION } from '../../src/js/store/atlas/atlas.entity.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** O nome do arquivo dentro de `tests/fixtures/ebgeo-2.2/`, que e como o helper o aceita. */
const FIXTURE_NOME = '01-completo.ebgeo';

/** O mesmo arquivo por caminho absoluto, que e como `setInputFiles` o aceita. */
const FIXTURE = fileURLToPath(new URL(`../fixtures/ebgeo-2.2/${FIXTURE_NOME}`, import.meta.url));

/** Mascara que o exportador aplica ao zip (`exportImportService.xorData`). */
const XOR_KEY = 0xAA;

/** Prefixo magico que o exportador poe na frente do zip mascarado. */
const MASK_HEADER = 'EBGXOR';

/** Diretorio temporario do download, criado no caso e apagado no `afterAll`. */
let dirTemporario = null;

/**
 * Decodifica um `.ebgeo` por CAMINHO ABSOLUTO.
 *
 * POR QUE A DECODIFICACAO ESTA COPIADA AQUI, e nao reusada de `loadEbgeoFixture`: aquele helper
 * so aceita um NOME de arquivo DENTRO de `tests/fixtures/ebgeo-2.2/`, e aquele diretorio e
 * conferido por sha256 (as duas fixtures sao copia byte a byte de `_ebgeo_dados_teste/`). Salvar
 * o download la para poder reusar o helper significaria escrever dentro de um diretorio que
 * ninguem pode ganhar vizinho, ainda que temporariamente, e um caso interrompido no meio deixaria
 * o vizinho para tras. O formato copiado sao TRES linhas e esta declarado no proprio helper: o
 * `.ebgeo` e um ZIP mascarado por XOR com chave `0xAA`, atras de um cabecalho `EBGXOR` de seis
 * bytes.
 *
 * A CONTAGEM, essa, NAO e copiada: o resultado sai na forma `{ data, images }` justamente para
 * ser contado por `countFixture`, o MESMO codigo que conta a fixture de origem. Duas contagens
 * diferentes dos dois lados de uma comparacao e como se certifica uma divergencia.
 *
 * @param {string} caminho - Caminho absoluto do `.ebgeo`.
 * @returns {Promise<{ data: Object, images: Map<string, Uint8Array> }>}
 */
async function decodificarEbgeo(caminho) {
    const raw = new Uint8Array(await readFile(caminho));

    const header = new TextDecoder().decode(raw.slice(0, MASK_HEADER.length));
    if (header !== MASK_HEADER) {
        throw new Error(`round-trip: ${caminho} nao comeca com ${MASK_HEADER}`);
    }
    const zipBytes = Uint8Array.from(raw.slice(MASK_HEADER.length), (byte) => byte ^ XOR_KEY);

    const zip = await JSZip.loadAsync(zipBytes);
    const dataFile = zip.file('data.json');
    if (!dataFile) throw new Error(`round-trip: ${caminho} nao tem data.json`);
    const data = JSON.parse(await dataFile.async('string'));

    const images = new Map();
    for (const entry of zip.file(/^images\/.+/)) {
        const id = entry.name.replace(/^images\//, '').replace(/\.[^.]+$/, '');
        images.set(id, await entry.async('uint8array'));
    }

    return { data, images };
}

/**
 * Quantas camadas o documento declara para cada mapa, chaveado pelos MAPAS (nao pela secao de
 * camadas): um documento que perdesse a secao inteira de um mapa devolve 0 aqui, em vez de perder
 * a chave e fazer o `toEqual` comparar conjuntos diferentes sem nomear o mapa.
 * @param {Object} data - O `data.json` do arquivo.
 * @returns {Object<string, number>}
 */
function camadasPorMapa(data) {
    const saida = {};
    for (const nome of Object.keys(data.maps ?? {})) {
        const lista = data.layers?.[nome];
        saida[nome] = Array.isArray(lista) ? lista.length : 0;
    }
    return saida;
}

/**
 * Quantos grupos o documento declara para cada mapa. Mesma regra de chaveamento de
 * `camadasPorMapa`, e pela mesma razao: a secao de grupos ja sumiu inteira de todo `.ebgeo` uma
 * vez, em silencio.
 * @param {Object} data - O `data.json` do arquivo.
 * @returns {Object<string, number>}
 */
function gruposPorMapa(data) {
    const saida = {};
    for (const nome of Object.keys(data.maps ?? {})) {
        saida[nome] = Object.keys(data.groups?.[nome] ?? {}).length;
    }
    return saida;
}

/** Espera o mapa 2D estar de pe. */
async function esperarMapa(page) {
    await expect(page.locator('#nav-btn-zoom-in')).toBeAttached({ timeout: 30000 });
    await page.waitForFunction(
        () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function',
        null,
        { timeout: 30000 },
    );
}

/**
 * Entrega o arquivo pela tela de atlas e espera o mapa terminar de importar.
 *
 * O ANCORA E O TOAST DE SUCESSO, e nao a contagem de mapas: ele e a ULTIMA linha do fluxo de
 * import (mapas, grupos, camadas, 3D/360, temporal, briefings, ordem, imagens e icones ja foram
 * escritos quando ele aparece), enquanto contar chaves de mapa mede so a primeira etapa e deixa
 * as asserções de briefing, icone e blob correndo contra escritas ainda em voo.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} arquivo - Caminho absoluto do `.ebgeo`.
 * @param {number} mapasEsperados - Quantos mapas o arquivo declara (entra no texto do toast).
 */
async function importarPelaTela(page, arquivo, mapasEsperados) {
    await page.goto('/atlas.html');
    await expect(page.locator('[data-testid="local-atlas-section"]')).toBeVisible({ timeout: 20000 });
    await page.locator('[data-testid="local-atlas-file-input"]').setInputFiles(arquivo);

    // A tela NAVEGA; quem importa e o boot do mapa.
    await page.waitForURL((url) => !url.pathname.endsWith('atlas.html'), { timeout: 30000 });
    await esperarMapa(page);
    // Pluralizacao do produto: com UM mapa ele escreve "1 mapa carregados!". A fixture tem onze,
    // entao o plural e o certo aqui, e o numero vem do ARQUIVO.
    await expect(page.locator('.toast', { hasText: `${mapasEsperados} mapas carregados!` }))
        .toBeVisible({ timeout: 60000 });
}

/**
 * Abre a aba Mapas UMA vez. O botao e um TOGGLE: clica-lo de novo com a aba aberta fecha a barra
 * lateral.
 */
async function abrirAbaMapas(page) {
    await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    await expect(page.locator('.maps-tab .map-list-item[data-map-name]').first())
        .toBeVisible({ timeout: 15000 });
}

describeOrSkip('.ebgeo: o ciclo completo pelo disco', () => {
    // SEM RETRY, e a razao e a do arquivo inteiro: um ciclo que so fecha na segunda tentativa e um
    // ciclo que nao fecha. O retry do config transformaria isso em "flaky" e a rodada em verde.
    test.describe.configure({ retries: 0 });

    test.afterAll(async () => {
        // O download e megabytes num diretorio temporario proprio: um caso que nao limpa deixa um
        // por rodada. `force` porque um caso que falhou antes de baixar nao criou nada.
        if (dirTemporario) await rm(dirTemporario, { recursive: true, force: true });
        dirTemporario = null;
    });

    test('importar, exportar pelo botao, e reimportar o arquivo produzido', async ({ page }) => {
        test.setTimeout(600000);

        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);

        // O ESPERADO VEM DO ARQUIVO, NUNCA DE NUMERO ESCRITO A MAO: trocar a fixture nao pode
        // deixar este caso afirmando o conteudo da anterior.
        const original = await loadEbgeoFixture(FIXTURE_NOME);
        const esperado = countFixture(original);
        const camadasDaFixture = camadasPorMapa(original.data);
        const gruposDaFixture = gruposPorMapa(original.data);
        const idsDeImagem = [...original.images.keys()].sort();

        // OS CANARIOS, ASSERIDOS NO LADO DA REFERENCIA. Sem isto, "os dois lados concordam" ficaria
        // satisfeito por duas copias igualmente achatadas, que e exatamente a forma do defeito de
        // 2026-09-01 (camada falha ABERTO, com um numero plausivel; grupo falha FECHADO).
        expect(camadasDaFixture['07 Camadas'], 'a fixture ainda e o canario de camadas').toBe(7);
        expect(gruposDaFixture['08 Grupos'], 'a fixture ainda e o canario de grupos').toBe(2);
        expect(esperado.layers, 'camadas somadas do arquivo de origem').toBe(17);
        expect(esperado.groups, 'grupos somados do arquivo de origem').toBe(2);

        // ================================================================
        // 1. O ARQUIVO DE ORIGEM VIRA UM ATLAS LOCAL
        // ================================================================
        await importarPelaTela(page, FIXTURE, esperado.maps);

        // ================================================================
        // 2. EXPORTAR PELO BOTAO DE VERDADE
        // ================================================================
        await abrirAbaMapas(page);
        // `#maps-action-save` e o id derivado de `maps-action-${action.id}`, e a acao rotulada
        // "Exportar" tem `id: 'save'`. Ela nao tem `data-testid` (as irmas `save-server`,
        // `save-local`, `share` e `participants` tem).
        await page.locator('#maps-action-save').click();

        const modalDeExportacao = page.locator('.export-modal-container');
        await expect(modalDeExportacao).toBeVisible({ timeout: 20000 });
        // ABSOLUTO: o modal lista os onze mapas do arquivo, e nao "pelo menos um". `show()` ja
        // marca todos, entao o botao ja nasce habilitado.
        await expect(modalDeExportacao.locator('.export-map-item')).toHaveCount(esperado.maps);
        const confirmarExportacao = modalDeExportacao.locator('.export-modal-btn-confirm');
        await expect(confirmarExportacao).toBeEnabled();

        // O LISTENER ANTES DO CLIQUE, e nao um `Promise.all` com os dois: entre o clique e o
        // download ha OUTRO dialogo a despachar (o aviso de poda logo abaixo), e um `Promise.all`
        // travaria esperando um download que ainda depende de um clique que ninguem deu.
        const baixado = page.waitForEvent('download', { timeout: 120000 });
        await confirmarExportacao.click();

        // O AVISO DE PODA E ESPERADO, NAO CONTORNADO. A poda de saida e keep-list e o resolver
        // responde `unknown` para TODA referencia 360 por decisao registrada (nao existe mapa
        // local foto -> projeto), entao o mapa "10 3D e 360" da fixture, que carrega orientacoes e
        // marcadores 360, garante perda em toda exportacao deste arquivo. Um caso que clicasse
        // "se aparecer" nao distinguiria a poda funcionando da poda tendo sumido.
        const avisoDePoda = page.locator('.confirm-modal-container');
        await expect(avisoDePoda).toBeVisible({ timeout: 60000 });
        await expect(avisoDePoda.locator('.confirm-modal-title'))
            .toHaveText('Este arquivo sai sem parte do catálogo');
        await avisoDePoda.locator('.confirm-modal-btn-confirm').click();

        const download = await baixado;
        dirTemporario = await mkdtemp(join(tmpdir(), 'ebgeo-round-trip-'));
        const nomeBaixado = download.suggestedFilename();
        const destino = join(dirTemporario, nomeBaixado);
        await download.saveAs(destino);

        // O toast de sucesso do EXPORTADOR, que so aparece depois do `a.click()`: sem ele, um
        // arquivo salvo e um `showError('Erro ao exportar arquivo .ebgeo')` engolido seriam o
        // mesmo verde.
        await expect(page.locator('.toast', { hasText: `${esperado.maps} mapas exportados!` }))
            .toBeVisible({ timeout: 60000 });
        expect(nomeBaixado, 'o download sai com a extensao do formato').toMatch(/^atlas-.+\.ebgeo$/);

        // ================================================================
        // 3. OS BYTES QUE SAIRAM (o exportador sozinho, sem importador no meio)
        // ================================================================
        const produzido = await decodificarEbgeo(destino);
        const obtido = countFixture(produzido);

        // A VERSAO SOBE NO CICLO: a fixture e 2.2 e o exportador carimba a constante do codigo.
        // Comparar com a da fixture seria pedir que o produto nunca migrasse de schema.
        expect(obtido.schemaVersion, 'o arquivo sai na versao de schema do codigo')
            .toBe(ATLAS_SCHEMA_VERSION);

        expect(obtido.maps, 'os onze mapas sairam').toBe(esperado.maps);
        expect(obtido.mapNames.slice().sort(), 'com os mesmos nomes')
            .toEqual(esperado.mapNames.slice().sort());
        // POR MAPA, e nao so no total: um total certo com feicoes no mapa errado e o defeito que
        // uma soma esconde.
        expect(obtido.featuresByMap, 'as feicoes de cada mapa sairam naquele mapa')
            .toEqual(esperado.featuresByMap);
        expect(obtido.features, 'nenhuma feicao a mais nem a menos').toBe(esperado.features);

        // OS DOIS CANARIOS, no lado que so o exportador produziu.
        expect(camadasPorMapa(produzido.data), 'as camadas de cada mapa sairam, sem achatamento')
            .toEqual(camadasDaFixture);
        expect(obtido.layers, 'camadas somadas').toBe(esperado.layers);
        expect(gruposPorMapa(produzido.data), 'os grupos de cada mapa sairam')
            .toEqual(gruposDaFixture);
        expect(obtido.groups, 'grupos somados').toBe(esperado.groups);

        expect(obtido.briefings, 'os briefings sairam').toBe(esperado.briefings);
        expect(obtido.slides, 'com todos os slides').toBe(esperado.slides);
        expect(obtido.customIcons, 'os icones personalizados sairam').toBe(esperado.customIcons);
        // OS BYTES DENTRO DO ZIP, e por id: um `data.json` que referencia cinco imagens e um zip
        // com quatro rende icone quebrado do outro lado, e contagem de feicao nenhuma acusa isso.
        //
        // A RELACAO E DE SUPERCONJUNTO, NAO DE IGUALDADE, e a diferenca foi MEDIDA em 2026-09-01:
        // o arquivo produzido saiu com SEIS blobs contra os cinco da fixture, e o extra
        // (`d6088ac9...`) e a feicao de DECLINACAO MAGNETICA de `Principal`. Ela carrega blob por
        // contrato, `imageResource: true` em `store/feature-type.registry.js`, porque o simbolo
        // dela e um PNG gerado, como o do simbolo militar. A fixture foi gerada pelo app do branch
        // `main` e nao trouxe aquele blob; este branch traz. Ou seja, o produzido esta mais
        // COMPLETO que o original, e uma igualdade aqui reprovaria o produto por causa do insumo.
        //
        // O que continua absoluto, e e o que importa: nenhum blob do original pode FALTAR, e todo
        // blob a mais tem de pertencer a uma feicao que legitimamente carrega imagem. Sem a
        // segunda metade isto viraria "produziu pelo menos cinco", que passaria verde com lixo no
        // zip.
        const idsProduzidos = [...produzido.images.keys()].sort();
        expect(idsProduzidos, 'nenhum blob do original ficou de fora')
            .toEqual(expect.arrayContaining(idsDeImagem));

        const tiposComImagem = new Set(['image', 'military_symbol', 'magnetic_declination']);
        const tipoPorId = {};
        for (const mapa of Object.values(produzido.data.maps ?? {})) {
            for (const lista of Object.values(mapa.features ?? {})) {
                if (!Array.isArray(lista)) continue;
                for (const f of lista) tipoPorId[f.properties?.id] = f.properties?.source;
            }
        }
        const icones = new Set((produzido.data.customIcons ?? []).map((i) => i.id));
        const extras = idsProduzidos.filter((id) => !idsDeImagem.includes(id));
        const extrasIlegitimos = extras.filter((id) => !icones.has(id) && !tiposComImagem.has(tipoPorId[id]));
        expect(extrasIlegitimos, 'todo blob a mais pertence a uma feicao que carrega imagem')
            .toEqual([]);

        // A ORDEM DOS MAPAS e o mapa corrente atravessam o ciclo. A ordem e comparada como
        // SEQUENCIA porque o import nao-aditivo grava `setMapOrder(data.mapOrder)` inteiro.
        expect(produzido.data.mapOrder, 'a ordem dos mapas atravessou').toEqual(original.data.mapOrder);
        expect(produzido.data.currentMap, 'o mapa corrente atravessou').toBe(original.data.currentMap);

        // ================================================================
        // 4. O ARQUIVO PRODUZIDO VOLTA PARA DENTRO DO PRODUTO
        // ================================================================
        await page.goto('/atlas.html');
        await expect(page.locator('[data-testid="local-atlas-section"]')).toBeVisible({ timeout: 20000 });
        const slotsAntes = await page.locator('[data-testid="local-atlas-item"]').count();

        await importarPelaTela(page, destino, esperado.maps);

        // O slot e NOVO: o atlas que veio da fixture nao foi substituido pelo que veio do arquivo
        // produzido, e os dois convivem.
        const slotsDepois = await page.evaluate(async () => {
            const ns = await import('/src/js/store/atlas-namespace.js');
            return (await ns.readLocalAtlasRegistry()).length;
        });
        expect(slotsDepois, 'reimportar criou um slot, nem zero nem dois').toBe(slotsAntes + 1);
        // A ABA MAPAS DE NOVO: o cabecalho do atlas so existe dentro dela, e a reimportacao
        // navegou para um documento novo, entao a aba aberta antes da exportacao nao sobreviveu.
        // Sem isto o `.atlas-header__name` simplesmente nao existe, e a espera morre por
        // "element(s) not found", que se le como defeito do produto e e defeito da spec.
        await abrirAbaMapas(page);
        // O atlas nasce com o nome do ARQUIVO, e o arquivo e o que o exportador nomeou.
        await expect(page.locator('.atlas-header__name'))
            .toHaveValue(nomeBaixado.replace(/\.ebgeo$/, ''));
        await expect(page.locator('[data-testid="atlas-origin-chip"]')).toHaveText('Local');

        const reimportado = await page.evaluate(async ({ nomes, ids }) => {
            const { getRepository } = await import('/src/js/store/repositories/index.js');
            const { getCustomIcons } = await import('/src/js/store/customIcons.operations.js');
            const repo = getRepository();

            const contar = (mapa) => {
                let n = 0;
                for (const lista of Object.values(mapa?.features ?? {})) {
                    if (Array.isArray(lista)) n += lista.length;
                }
                return n;
            };

            // A leitura POR NOME e a que a lista de mapas faz ao abrir um cartao.
            const feicoesPorNome = {};
            const camadasPorNome = {};
            const gruposPorNome = {};
            for (const nome of nomes) {
                feicoesPorNome[nome] = contar(await repo.getMap(nome));
                camadasPorNome[nome] = (await repo.getLayers(nome)).length;
                gruposPorNome[nome] = Object.keys((await repo.getGroups(nome)) ?? {}).length;
            }

            const briefings = await repo.getAllBriefings();
            const listaDeBriefings = briefings instanceof Map ? [...briefings.values()] : (briefings ?? []);

            const blobs = [];
            for (const id of ids) blobs.push(await repo.hasImage(id));

            return {
                feicoesPorNome,
                camadasPorNome,
                gruposPorNome,
                chavesDeMapa: (await repo.getAllMapIds()).length,
                briefings: listaDeBriefings.length,
                slides: listaDeBriefings.reduce((soma, b) => soma + (b?.slides?.length ?? 0), 0),
                icones: (await getCustomIcons()).length,
                blobsPresentes: blobs.filter(Boolean).length,
            };
        }, { nomes: esperado.mapNames, ids: idsDeImagem });

        // UMA chave de armazenamento por mapa: duas chaves para um nome deixam a segunda fora do
        // alcance da pessoa, porque a lista de mapas de-duplica por nome.
        expect(reimportado.chavesDeMapa, 'uma chave de armazenamento por mapa').toBe(esperado.maps);

        expect(reimportado.feicoesPorNome, 'abrir cada mapa pelo nome entrega as feicoes daquele mapa')
            .toEqual(esperado.featuresByMap);
        // O CANARIO DE CAMADAS DO LADO FRACO: `getLayers` sintetiza uma camada padrao quando o
        // conjunto nao existe, entao dez destes onze numeros seriam satisfeitos por um mapa sem
        // camada nenhuma. So `07 Camadas` contradiz, e e por isso que a asserção de bytes acima
        // e a que manda.
        expect(reimportado.camadasPorNome, 'as camadas de cada mapa voltaram')
            .toEqual(camadasDaFixture);
        expect(reimportado.gruposPorNome, 'os grupos de cada mapa voltaram')
            .toEqual(gruposDaFixture);
        expect(reimportado.briefings, 'os briefings voltaram').toBe(esperado.briefings);
        expect(reimportado.slides, 'com todos os slides').toBe(esperado.slides);
        expect(reimportado.icones, 'os icones personalizados voltaram').toBe(esperado.customIcons);
        expect(reimportado.blobsPresentes, 'os blobs do zip chegaram ao repositorio')
            .toBe(esperado.images);
    });
});
