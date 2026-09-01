// Path: e2e-ui/lacunas-de-fixture-round-trip.spec.js

/**
 * @fileoverview AS LACUNAS DAS FIXTURES `.ebgeo`, medidas com conteudo SEMEADO PELO APP em vez
 * de conteudo lido do arquivo de referencia.
 *
 * ---------------------------------------------------------------------------
 * O PONTO CEGO QUE ESTE CASO EXISTE PARA FECHAR
 * ---------------------------------------------------------------------------
 * As fixtures de `tests/fixtures/ebgeo-2.2/` foram geradas dirigindo o app do branch `main` e
 * sao copia byte a byte de `_ebgeo_dados_teste/` (sha256 conferido). Tres coisas nao existem
 * dentro delas, e portanto nenhuma medicao feita a partir delas diz nada sobre as tres:
 *
 *   1. COMENTARIO ESPACIAL. A entidade nasceu no branch `integracao_backend` e nao existe em
 *      `main`, entao `data.comments` sequer e uma chave do `data.json` das duas fixtures.
 *   2. IMAGEM ANEXADA A FEICAO (`properties.images`). E outra coisa que a feicao do TIPO imagem:
 *      a anexada e um array DENTRO das propriedades de qualquer feicao, escrito por
 *      `userDataManager.addImage`.
 *   3. FEICAO DE ANALISE PROCESSADA (`processed_los`, `processed_visibility`).
 *
 * Este caso cobre a PRIMEIRA e a SEGUNDA, semeando as duas pela aplicacao real antes de exportar.
 *
 * A TERCEIRA NAO ESTA AQUI, mas NAO e por impossibilidade, e a versao anterior desta linha
 * afirmava que era. Ela dizia que produzir `processed_los` e `processed_visibility` "exige o
 * servico de elevacao no ar respondendo a consulta de perfil". ISSO E FALSO, e foi refutado por
 * medicao em 2026-09-01, depois de o dono apontar: nao ha servico nenhum no caminho.
 * `getTerrainElevation` (`terrain/terrain.control.js`) so chama `map.getTerrain()` e
 * `map.queryTerrainElevation()`, ambos do MapLibre, e a unica guarda e
 * `isTerrainAvailable(map) => map.getTerrain() !== null`, que faz `activate()` das duas
 * ferramentas recusar. Ou seja, a dependencia e TERRENO LIGADO, e terreno se liga.
 *
 * A cobertura das duas vive em `tests/e2e-ui/analise-processada-round-trip.spec.js`, que instala
 * um terreno sintetico com uma colina, dirige as ferramentas REAIS e mede o round-trip. O que
 * aquele arquivo NAO faz, e o que continua valendo desta linha, e montar a saida a mao: um
 * literal com a forma de uma feicao processada mediria a serializacao de um literal que a propria
 * spec escreveu, e chamaria isso de cobertura de analise.
 *
 * ---------------------------------------------------------------------------
 * POR QUE O CASO PRECISA DE LOGIN, e isto NAO e detalhe de harness
 * ---------------------------------------------------------------------------
 * `guardComment` (`store/comment.operations.js`) recusa TODA escrita de comentario com
 * `not-authenticated` quando nao ha sessao, porque um comentario precisa de AUTOR e o anonimo nao
 * tem nenhum. Anonimo so LE comentario. O gate de PAPEL, esse, nao entra: `checkPermission`
 * devolve permissao total enquanto a store for local (`isRemoteStoreSync()` falso), entao a
 * sessao viva basta e o atlas segue sendo LOCAL do inicio ao fim, sem servidor nenhum no caminho
 * do dado. E exatamente o caso que o cabecalho daquele arquivo descreve: usuario LOGADO
 * comentando no mapa local, com a op de sync caindo no descarte de contexto nao-UUID antes do
 * flush, sem vazar para um servidor que nao tem esse mapa.
 *
 * Semear por `setMapComments` (a restauracao em lote, que nao tem guarda) evitaria o login e
 * mediria menos: seria escrever o documento de comentarios com a MESMA funcao que a perna de
 * importacao usa para restaura-lo, deixando `addComment` e `addReply` fora do exercicio.
 *
 * ---------------------------------------------------------------------------
 * O QUE A MEDICAO DESCOBRIU SOBRE O TRANSPORTE DA IMAGEM ANEXADA
 * ---------------------------------------------------------------------------
 * Ela NAO viaja como blob no zip, e a busca por "o blob entrou em `images/`" procuraria no lugar
 * errado. `collectUsedImageIds` (`import_export/export-import.service.js`) colhe
 * `feature.properties.id`, ou seja, o id da PROPRIA FEICAO (que e a chave sob a qual o blob de uma
 * feicao de imagem ou de um simbolo militar gerado e gravado), mais os ids dos icones
 * personalizados. Ele nunca olha `properties.images`. O que faz a imagem anexada atravessar e
 * outra coisa: `addImage` grava o `data:` base64 INLINE dentro do proprio array de propriedades,
 * entao ela viaja dentro do `data.json` e o `images/` do zip continua vazio. As duas coisas sao
 * asseridas aqui: o payload inline atravessa, e o zip sai sem entrada de imagem nenhuma.
 *
 * ---------------------------------------------------------------------------
 * O QUE UM VERDE AQUI NAO PROVA
 * ---------------------------------------------------------------------------
 * - NADA sobre feicao processada, pelo motivo declarado acima.
 * - NADA sobre comentario em atlas de SERVIDOR: o ciclo inteiro roda sobre atlas LOCAL. O
 *   comentario tem op de sync propria e um caminho remoto (`remote-operation-handler`) que este
 *   caso nao encosta; aqui a op nasce e morre na fila local.
 * - NADA sobre RESOLVER, EDITAR ou APAGAR comentario: so criacao de raiz e de resposta
 *   atravessam. Um exportador que perdesse `status` continuaria verde se o `status` semeado ja
 *   fosse o unico que este caso escreve, e por isso o `open` e comparado por igualdade de objeto
 *   inteiro, e nao por presenca de chave.
 * - NADA sobre COMPRESSAO de imagem: o PNG semeado tem 4 por 4 pixels e fica muito abaixo do
 *   limiar de `processImageFile`, entao o ramo que recodifica para JPEG nao roda. O que
 *   atravessa aqui e o payload que o ramo curto produziu.
 * - NADA sobre a metade do arquivo que a fixture ja cobre (mapas, camadas, grupos, briefings,
 *   icones, blobs de imagem no zip): isso e assunto de
 *   `tests/e2e-ui/ebgeo-round-trip-arquivo.spec.js`, sobre `01-completo.ebgeo`. Este caso usa a
 *   fixture MINIMA de proposito, para que tudo que aparecer nas secoes medidas tenha vindo do
 *   que ele mesmo semeou.
 * - NADA sobre a pluralizacao da tela alem do que ele espera literalmente: o produto escreve
 *   "1 mapa carregados!" na importacao (plural errado) e "1 mapa exportado!" na exportacao
 *   (singular certo). As duas formas estao asseridas como estao no codigo, nao como deveriam ser.
 */

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { loginUI } from './helpers/collab-helpers.js';
import { installBootProbe, expectAppBooted } from './helpers/boot-probe.js';
import { loadEbgeoFixture } from '../helpers/ebgeo-fixture.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** A fixture MINIMA: 1 mapa `Principal`, 1 feicao de ponto, 1 camada, e nada mais. */
const FIXTURE_NOME = '02-minimo.ebgeo';

/** A mesma fixture por caminho absoluto, que e como `setInputFiles` a aceita. */
const FIXTURE = fileURLToPath(new URL(`../fixtures/ebgeo-2.2/${FIXTURE_NOME}`, import.meta.url));

/** O mapa unico da fixture. */
const MAPA = 'Principal';

/**
 * O id da unica feicao da fixture, e o tipo dela na forma SINGULAR (`source`), que e a forma que
 * `userDataManager` espera: ele chama `getStorageTypeFromSource`, que traduz `point` para `points`.
 * Os dois valores sao conferidos contra a fixture LIDA antes de qualquer uso, para que trocar a
 * fixture nao deixe este caso semeando numa feicao que nao existe mais.
 */
const FEATURE_ID = '62d54036-aba1-4810-917c-1924e7b1293c';
const FEATURE_SOURCE = 'point';

/** Quantos mapas a fixture declara. Entra no texto do toast de importacao. */
const MAPAS = 1;

/** Mascara que o exportador aplica ao zip (`exportImportService.xorData`). */
const XOR_KEY = 0xAA;

/** Prefixo magico que o exportador poe na frente do zip mascarado. */
const MASK_HEADER = 'EBGXOR';

/** O nome do arquivo de imagem que este caso anexa. Comparado por igualdade nos tres lados. */
const NOME_DA_IMAGEM = 'selo-de-teste.png';

/** Diretorio temporario do download, criado no caso e apagado no `afterAll`. */
let dirTemporario = null;

/**
 * Decodifica um `.ebgeo` por CAMINHO ABSOLUTO.
 *
 * A decodificacao esta copiada aqui pela mesma razao registrada em
 * `ebgeo-round-trip-arquivo.spec.js`: `loadEbgeoFixture` so aceita um NOME de arquivo DENTRO de
 * `tests/fixtures/ebgeo-2.2/`, e aquele diretorio e conferido por sha256, entao salvar o download
 * la para reusar o helper significaria escrever num diretorio que ninguem pode ganhar vizinho. O
 * formato sao tres linhas: ZIP mascarado por XOR com chave `0xAA`, atras de um cabecalho `EBGXOR`
 * de seis bytes.
 *
 * @param {string} caminho - Caminho absoluto do `.ebgeo`.
 * @returns {Promise<{ data: Object, imagensNoZip: string[] }>}
 */
async function decodificarEbgeo(caminho) {
    const raw = new Uint8Array(await readFile(caminho));

    const header = new TextDecoder().decode(raw.slice(0, MASK_HEADER.length));
    if (header !== MASK_HEADER) {
        throw new Error(`lacunas: ${caminho} nao comeca com ${MASK_HEADER}`);
    }
    const zipBytes = Uint8Array.from(raw.slice(MASK_HEADER.length), (byte) => byte ^ XOR_KEY);

    const zip = await JSZip.loadAsync(zipBytes);
    const dataFile = zip.file('data.json');
    if (!dataFile) throw new Error(`lacunas: ${caminho} nao tem data.json`);

    return {
        data: JSON.parse(await dataFile.async('string')),
        imagensNoZip: zip.file(/^images\/.+/)
            .map((entry) => entry.name.replace(/^images\//, '').replace(/\.[^.]+$/, ''))
            .sort(),
    };
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
 * Entrega um `.ebgeo` pela tela de atlas e espera o mapa terminar de importar.
 *
 * O ANCORA E O TOAST DE SUCESSO, e nao a contagem de mapas: ele e a ULTIMA linha do fluxo de
 * import, entao esperar por ele e o que impede as leituras seguintes de correrem contra escritas
 * ainda em voo (comentarios e propriedades de feicao chegam bem depois dos mapas).
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} arquivo - Caminho absoluto do `.ebgeo`.
 */
async function importarPelaTela(page, arquivo) {
    await expect(page.locator('[data-testid="local-atlas-section"]')).toBeVisible({ timeout: 20000 });
    await page.locator('[data-testid="local-atlas-file-input"]').setInputFiles(arquivo);

    // A tela NAVEGA (`goToLocalMap`); quem importa e o boot do mapa, que consome a importacao
    // pendente. O parametro de intencao local e de sessao, entao o roteador do boot nao devolve o
    // usuario logado para `atlas.html`.
    await page.waitForURL((url) => !url.pathname.endsWith('atlas.html'), { timeout: 30000 });
    await esperarMapa(page);
    // Pluralizacao do produto, reproduzida como esta no codigo: com UM mapa ele escreve
    // "1 mapa carregados!" (`showLoadSuccess`).
    await expect(page.locator('.toast', { hasText: `${MAPAS} mapa carregados!` }))
        .toBeVisible({ timeout: 60000 });
}

/** Abre a aba Mapas UMA vez. O botao e um TOGGLE: clica-lo de novo fecha a barra lateral. */
async function abrirAbaMapas(page) {
    await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    await expect(page.locator('.maps-tab .map-list-item[data-map-name]').first())
        .toBeVisible({ timeout: 15000 });
}

/**
 * Le do escopo ATIVO as duas secoes que este caso mede, mais a identidade do escopo.
 *
 * A IDENTIDADE VIAJA JUNTO de proposito: sem ela, "sobreviveu ao round-trip" seria indistinguivel
 * de "eu reli o mesmo atlas em que semeei". Ver a asserção de escopo no caso.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ comentarios: Object, anexadas: Array, atlasId: (string|null), slots: number }>}
 */
function lerEstado(page) {
    return page.evaluate(async ({ mapa, featureId, featureSource }) => {
        const { getComments } = await import('/src/js/store/comment.operations.js');
        const ud = (await import('/src/js/user_data/user_data_manager.js')).default;
        const ns = await import('/src/js/store/atlas-namespace.js');
        return {
            comentarios: await getComments(mapa),
            anexadas: await ud.getImages(featureId, featureSource),
            atlasId: ns.getActiveScope()?.atlasId ?? null,
            slots: (await ns.readLocalAtlasRegistry()).length,
        };
    }, { mapa: MAPA, featureId: FEATURE_ID, featureSource: FEATURE_SOURCE });
}

describeOrSkip('.ebgeo: comentario espacial e imagem anexada atravessam o ciclo', () => {
    // SEM RETRY: um ciclo que so fecha na segunda tentativa e um ciclo que nao fecha, e o
    // `retries: 1` do config transformaria isso em "flaky" com a rodada verde.
    test.describe.configure({ retries: 0 });

    test.afterAll(async () => {
        // `force` porque um caso que falhou antes de baixar nao criou diretorio nenhum.
        if (dirTemporario) await rm(dirTemporario, { recursive: true, force: true });
        dirTemporario = null;
    });

    test('semear comentario e imagem anexada, exportar pelo botao, e reimportar', async ({ page }) => {
        test.setTimeout(600000);

        // ================================================================
        // 0. O CONTROLE NEGATIVO, NO LADO DA FIXTURE
        // ================================================================
        // Se a fixture ja trouxesse comentario ou imagem anexada, "sobreviveu" nao distinguiria o
        // que este caso semeou do que ela ja carregava. As duas ausencias sao a razao de o caso
        // existir, entao elas sao asseridas, nao presumidas.
        const original = await loadEbgeoFixture(FIXTURE_NOME);
        expect(original.data.comments, `${FIXTURE_NOME} nao pode ter secao de comentarios`)
            .toBeUndefined();

        const pontosDaFixture = original.data.maps?.[MAPA]?.features?.points ?? [];
        expect(pontosDaFixture, 'a fixture minima tem exatamente uma feicao de ponto').toHaveLength(1);
        expect(pontosDaFixture[0].properties.id, 'o id da feicao semeada e o da fixture')
            .toBe(FEATURE_ID);
        expect(pontosDaFixture[0].properties.source, 'o tipo singular da feicao e o esperado')
            .toBe(FEATURE_SOURCE);
        expect(pontosDaFixture[0].properties.images, 'a fixture nao pode trazer imagem anexada')
            .toBeUndefined();

        // ================================================================
        // 1. SESSAO VIVA (ver o `@fileoverview`: sem autor nao ha comentario)
        // ================================================================
        const conta = await createVerifiedUser({ prefix: 'lacunas', nome: 'Lacunas' });

        installBootProbe(page);
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
        await page.goto('/');
        await expectAppBooted(page, { rotulo: 'lacunas:boot' });
        // `loginUI` termina em `atlas.html`, que e exatamente a tela de onde o arquivo entra.
        await loginUI(page, conta.username, conta.password);

        // ================================================================
        // 2. A FIXTURE VIRA UM ATLAS LOCAL
        // ================================================================
        await importarPelaTela(page, FIXTURE);

        // ================================================================
        // 3. SEMEAR: um comentario raiz, uma resposta, e uma imagem anexada
        // ================================================================
        // As tres escritas passam pelas funcoes REAIS do produto, e cada uma falha ALTO ao
        // devolver vazio. Um `addComment` que devolvesse `undefined` (guarda de sessao recusando)
        // deixaria o resto do caso comparando dois estados igualmente vazios, que e a forma
        // classica do verde vacuo: aqui ele vira uma frase que nomeia a causa.
        const semeado = await page.evaluate(async ({ mapa, featureId, featureSource, nomeDaImagem }) => {
            const { addComment, addReply } = await import('/src/js/store/comment.operations.js');

            const raiz = await addComment({
                lng: -43.2,
                lat: -22.9,
                text: 'Conferir este ponto no terreno antes do ensaio.',
                authorId: 'lacunas-autor',
                authorInitials: 'LA',
                authorColor: '#1E88E5',
            }, mapa);
            if (!raiz) {
                throw new Error('addComment devolveu undefined: guardComment recusou a escrita '
                    + '(sem sessao viva nao ha autor, e sem autor nao ha comentario).');
            }

            const resposta = await addReply(raiz.id, {
                text: 'Conferido. Cota bate com a carta.',
                authorId: 'lacunas-autor',
                authorInitials: 'LA',
            }, mapa);
            if (!resposta) {
                throw new Error('addReply devolveu undefined: ou a guarda recusou, ou a raiz nao '
                    + 'estava no documento de comentarios no momento da leitura do pai.');
            }

            // O PNG e gerado NA PAGINA por canvas, como fez o gerador das fixtures. 4 por 4
            // pixels fica muito abaixo do limiar de compressao, entao `processImageFile` guarda
            // o data URL do proprio PNG e so a miniatura vira JPEG.
            const canvas = document.createElement('canvas');
            canvas.width = 4;
            canvas.height = 4;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#C62828';
            ctx.fillRect(0, 0, 4, 4);
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
            if (!blob) throw new Error('canvas.toBlob devolveu null: sem PNG nao ha o que anexar.');

            const ud = (await import('/src/js/user_data/user_data_manager.js')).default;
            const imagem = await ud.addImage(
                featureId,
                featureSource,
                new File([blob], nomeDaImagem, { type: 'image/png' }),
            );
            if (!imagem) {
                throw new Error('addImage devolveu null: o arquivo foi recusado pela validacao, '
                    + 'ou a feicao alvo nao foi encontrada no mapa corrente.');
            }

            return { raizId: raiz.id, respostaId: resposta.id, imagemId: imagem.id };
        }, { mapa: MAPA, featureId: FEATURE_ID, featureSource: FEATURE_SOURCE, nomeDaImagem: NOME_DA_IMAGEM });

        // ================================================================
        // 4. A PREMISSA: as duas coisas EXISTEM no estado de origem
        // ================================================================
        // Sem este bloco, todas as asserções seguintes poderiam ser satisfeitas por "nada foi
        // semeado, nada atravessou, os dois lados concordam".
        const origem = await lerEstado(page);

        expect(Object.keys(origem.comentarios).sort(), 'a origem tem a raiz e a resposta, e so')
            .toEqual([semeado.raizId, semeado.respostaId].sort());
        const raizDeOrigem = origem.comentarios[semeado.raizId];
        const respostaDeOrigem = origem.comentarios[semeado.respostaId];
        expect(raizDeOrigem.parentId, 'a raiz e raiz').toBeNull();
        expect(raizDeOrigem.status, 'a raiz nasce aberta').toBe('open');
        expect(raizDeOrigem.text, 'o texto da raiz e o que foi escrito')
            .toBe('Conferir este ponto no terreno antes do ensaio.');
        expect(respostaDeOrigem.parentId, 'a resposta aponta para a raiz').toBe(semeado.raizId);
        expect(respostaDeOrigem.text, 'o texto da resposta e o que foi escrito')
            .toBe('Conferido. Cota bate com a carta.');

        expect(origem.anexadas, 'a origem tem UMA imagem anexada').toHaveLength(1);
        const imagemDeOrigem = origem.anexadas[0];
        expect(imagemDeOrigem.id, 'e ela e a que foi anexada').toBe(semeado.imagemId);
        expect(imagemDeOrigem.name, 'com o nome do arquivo').toBe(NOME_DA_IMAGEM);
        expect(imagemDeOrigem.type, 'e o tipo MIME declarado').toBe('image/png');
        // O PAYLOAD e o que atravessa (ver o `@fileoverview`): o `data:` mora INLINE na feicao, e
        // nao como blob no zip. Se ele viesse vazio, tudo abaixo compararia duas strings vazias.
        expect(typeof imagemDeOrigem.data, 'o payload inline e uma string').toBe('string');
        expect(imagemDeOrigem.data.startsWith('data:image/'), 'e e um data URL de imagem').toBe(true);
        expect(imagemDeOrigem.data.length, 'e ele nao esta vazio').toBeGreaterThan(64);

        expect(typeof origem.atlasId, 'o escopo de origem tem identidade').toBe('string');

        // ================================================================
        // 5. EXPORTAR PELO BOTAO DE VERDADE
        // ================================================================
        await abrirAbaMapas(page);
        // UM EFEITO COLATERAL DA SESSAO VIVA, dito aqui porque ele so se manifesta como um
        // download que nunca chega: com sessao, `construirResolverDeSaida` EXIGE que a soma de
        // recursos privados tenha acontecido, e sem ela `handleExport` mostra um erro e retorna
        // sem exportar (`ResourceSumMissingError`). A soma acontece no login e tem nova tentativa
        // dentro do proprio resolver, entao num backend saudavel isto e invisivel; se este caso
        // estourar esperando o download, a soma e o primeiro lugar a olhar, nao o botao.
        // `#maps-action-save` e o id derivado de `maps-action-${action.id}`; a acao rotulada
        // "Exportar" tem `id: 'save'` e esta em TODAS as linhas de `ACTIONS_BY_STATE`, inclusive
        // na de usuario logado sobre store local, que e o estado deste caso.
        await page.locator('#maps-action-save').click();

        const modalDeExportacao = page.locator('.export-modal-container');
        await expect(modalDeExportacao).toBeVisible({ timeout: 20000 });
        await expect(modalDeExportacao.locator('.export-map-item')).toHaveCount(MAPAS);
        const confirmarExportacao = modalDeExportacao.locator('.export-modal-btn-confirm');
        await expect(confirmarExportacao).toBeEnabled();

        // O LISTENER ANTES DO CLIQUE, e nao um `Promise.all`: pode haver outro dialogo a
        // despachar entre o clique e o download, e o `Promise.all` travaria esperando um download
        // que ainda depende de um clique que ninguem deu.
        // O TOAST E TRANSITORIO, E A ESPERA DELE COMECA AQUI, junto com a do download e ANTES do
        // clique. Ele nasce logo depois do `a.click()` do exportador e morre por tempo; o evento
        // de download do Playwright chega DEPOIS disso. Medido com um MutationObserver instalado
        // antes do clique: o toast foi criado com o texto exato e ja nao estava no DOM quando
        // `await baixado` resolveu, o que fazia a assercao parecer "o exportador nao avisou"
        // quando o exportador tinha avisado. `expect(...).toBeVisible()` comeca a sondar no
        // instante em que e chamado, entao guardar a promessa aqui e espera-la depois cobre a
        // janela inteira. A spec irma de round-trip nao sofre disso porque exporta onze mapas, e
        // o toast dela nasce tarde o bastante.
        const toastDeExportacao = expect(page.locator('.toast', { hasText: `${MAPAS} mapa exportado!` }))
            .toBeVisible({ timeout: 60000 });
        const baixado = page.waitForEvent('download', { timeout: 120000 });
        await confirmarExportacao.click();

        // O AVISO DE PODA DE CATALOGO E CONDICIONAL, e por isso ele NAO e asserido aqui. Ele
        // aparece quando a poda de saida tem algo a relatar, o que para `01-completo.ebgeo` e
        // garantido (ela carrega referencia 360, e toda referencia 360 resolve para `unknown` fora
        // do servidor). A fixture MINIMA nao carrega 3D, 360 nem camada de catalogo, entao o unico
        // candidato dela e o basemap `carta-topografica`, cuja classificacao depende do que o
        // `/api/config` desta instancia declara. Um caso que ASSERTASSE a presenca do dialogo
        // estaria afirmando o conteudo do catalogo do servidor de teste, que nao e o assunto
        // daqui; um que nunca o despachasse travaria sem download no dia em que ele aparecesse.
        const avisoDePoda = page.locator('.confirm-modal-container');
        try {
            await avisoDePoda.waitFor({ state: 'visible', timeout: 8000 });
            await avisoDePoda.locator('.confirm-modal-btn-confirm').click();
        } catch {
            // Nao apareceu: nada a despachar, o download ja esta a caminho.
        }

        const download = await baixado;

        // O TOAST VEM ANTES DO DISCO, e a ordem foi paga. Ele e o do EXPORTADOR (sem ele, um
        // arquivo salvo e um `showError` engolido seriam o mesmo verde), mas e TRANSITORIO, e
        // esta assercao morava depois do `mkdtemp` mais o `saveAs`. Com UM mapa a exportacao e
        // rapida, entao o toast nascia cedo e as duas operacoes de arquivo consumiam a vida dele:
        // medido, o download tinha funcionado e o `.toast` ja nao existia mais na pagina. A spec
        // irma de round-trip nao sofria disso porque exporta ONZE mapas, o que atrasa tudo o
        // suficiente. Ler o efeito transitorio primeiro e guardar o disco depois remove a corrida
        // sem abrir mao da assercao.
        await toastDeExportacao;

        dirTemporario = await mkdtemp(join(tmpdir(), 'ebgeo-lacunas-'));
        const nomeBaixado = download.suggestedFilename();
        const destino = join(dirTemporario, nomeBaixado);
        await download.saveAs(destino);

        // ================================================================
        // 6. OS BYTES QUE SAIRAM (o exportador sozinho, sem importador no meio)
        // ================================================================
        const produzido = await decodificarEbgeo(destino);

        // A SECAO DE COMENTARIOS NASCEU DO SEMEIO: a fixture nao a tinha (asserido no bloco 0), e
        // o predicado da tabela de secoes opcionais (`comments`, `Object.keys(v).length > 0`) so a
        // escreve quando ha conteudo.
        const comentariosNoArquivo = produzido.data.comments?.[MAPA];
        expect(comentariosNoArquivo, 'o arquivo carrega a secao de comentarios do mapa').toBeDefined();
        expect(Object.keys(comentariosNoArquivo).sort(), 'com a raiz e a resposta, e so')
            .toEqual([semeado.raizId, semeado.respostaId].sort());
        // OBJETO INTEIRO, e nao presenca de chave: comparar so os ids deixaria passar um
        // exportador que perdesse `status`, `authorColor` ou `parentId` pelo caminho.
        expect(comentariosNoArquivo[semeado.raizId], 'a raiz saiu inteira').toEqual(raizDeOrigem);
        expect(comentariosNoArquivo[semeado.respostaId], 'a resposta saiu inteira')
            .toEqual(respostaDeOrigem);
        // A RELACAO PAI/FILHO E O QUE UMA SECAO CHAVEADA POR ID PODE PERDER SEM PERDER CONTAGEM.
        expect(comentariosNoArquivo[semeado.respostaId].parentId, 'e ainda aponta para a raiz')
            .toBe(semeado.raizId);

        const pontosNoArquivo = produzido.data.maps?.[MAPA]?.features?.points ?? [];
        expect(pontosNoArquivo, 'o arquivo carrega a unica feicao de ponto').toHaveLength(1);
        expect(pontosNoArquivo[0].properties.id, 'e ela e a mesma feicao').toBe(FEATURE_ID);
        expect(pontosNoArquivo[0].properties.images, 'com a imagem anexada inteira, inline')
            .toEqual(origem.anexadas);

        // O ZIP SAI SEM `images/`, e isto e o MECANISMO, nao uma perda: `collectUsedImageIds` colhe
        // `properties.id` (o id da FEICAO) e os icones personalizados, nunca `properties.images`.
        // Nao ha blob gravado sob o id do ponto, e a fixture nao tem icone, entao o conjunto e
        // vazio. Asserir zero e o que impede a linha acima de ser lida como "o blob viajou".
        expect(produzido.imagensNoZip, 'o zip nao carrega blob de imagem nenhum').toEqual([]);

        // ================================================================
        // 7. O ARQUIVO PRODUZIDO VOLTA PARA DENTRO DO PRODUTO
        // ================================================================
        await page.goto('/atlas.html');
        await importarPelaTela(page, destino);

        const reimportado = await lerEstado(page);

        // O ESCOPO E OUTRO, E ESTA ASSERÇÃO E LOAD-BEARING. Se a reimportacao caisse no mesmo
        // namespace, tudo abaixo estaria relendo o estado SEMEADO, e o caso inteiro passaria verde
        // sem que um unico byte tivesse ido ao disco e voltado.
        expect(typeof reimportado.atlasId, 'o escopo reimportado tem identidade').toBe('string');
        expect(reimportado.atlasId, 'e ele NAO e o escopo em que se semeou')
            .not.toBe(origem.atlasId);
        expect(reimportado.slots, 'reimportar criou um slot local, nem zero nem dois')
            .toBe(origem.slots + 1);

        // COMENTARIOS, do outro lado do disco.
        expect(Object.keys(reimportado.comentarios).sort(), 'a raiz e a resposta voltaram, e so')
            .toEqual([semeado.raizId, semeado.respostaId].sort());
        expect(reimportado.comentarios[semeado.raizId], 'a raiz voltou inteira').toEqual(raizDeOrigem);
        expect(reimportado.comentarios[semeado.respostaId], 'a resposta voltou inteira')
            .toEqual(respostaDeOrigem);
        expect(reimportado.comentarios[semeado.respostaId].parentId, 'e ainda aponta para a raiz')
            .toBe(semeado.raizId);
        // Contagem por NATUREZA, e nao so por total: uma restauracao que promovesse a resposta a
        // raiz manteria o total em dois e quebraria a thread.
        const valoresReimportados = Object.values(reimportado.comentarios);
        expect(valoresReimportados.filter((c) => c.parentId === null), 'uma raiz').toHaveLength(1);
        expect(
            valoresReimportados.filter((c) => c.parentId === semeado.raizId),
            'uma resposta, pendurada nela',
        ).toHaveLength(1);

        // IMAGEM ANEXADA, do outro lado do disco. Lida pela MESMA API que a UI usa
        // (`userDataManager.getImages`), e nao direto do documento de mapa, porque e essa leitura
        // que a aba de imagens da feicao faz.
        expect(reimportado.anexadas, 'a imagem anexada voltou, e e uma so').toHaveLength(1);
        expect(reimportado.anexadas[0], 'byte a byte, incluindo o payload inline e a miniatura')
            .toEqual(imagemDeOrigem);
    });
});
