// Path: e2e-ui/import-aditivo-pela-tela.spec.js

/**
 * @fileoverview O botão "Importar" da aba Mapas, que é o import ADITIVO, exercido ponta a ponta
 * pela tela pela primeira vez. Ele SOMA um `.ebgeo` ao atlas que já está aberto em vez de
 * substituí-lo, e é o único caminho de import que precisa conviver com dado preexistente: todos os
 * outros começam de um escopo vazio, então nenhum deles fica vermelho quando o aditivo destruir o
 * que já estava lá.
 *
 * POR QUE `filechooser` E NÃO `setInputFiles`. `_handleImportAdditive`
 * (`frontend/src/js/sidebar/tabs/maps.tab.js`) cria o input de arquivo com
 * `document.createElement`, pendura o `onchange` e chama `click()` sem NUNCA inserir o elemento no
 * documento. Um `page.locator(...).setInputFiles(...)` procura o input no DOM e não acha coisa
 * nenhuma: não existe seletor capaz de alcançá-lo, e um caso escrito assim falha por "elemento não
 * encontrado", o que se lê como tela quebrada em vez de técnica errada. O evento `filechooser` do
 * Playwright é o único gancho aqui, porque ele intercepta a ABERTURA do seletor, esteja o input no
 * documento ou não. O botão é `#maps-action-import`, id montado em `maps.tab.js` a partir do id da
 * ação; ele NÃO tem `data-testid`, ao contrário dos irmãos "Enviar ao servidor", "Salvar como
 * local", "Compartilhar" e "Participantes".
 *
 * O ARRANJO, e por que são dois arquivos. `02-minimo.ebgeo` entra primeiro pelo caminho NÃO
 * aditivo de `atlas.html`, que é a forma barata de nascer um atlas local com conteúdo CONHECIDO
 * sem desenhar nada à mão; só então `01-completo.ebgeo` entra por cima, aditivamente. Os dois
 * arquivos declaram um mapa `Principal`, e essa colisão é o coração do caso: o preexistente tem de
 * sobreviver intacto, e o do arquivo tem de entrar como `Principal_1` (a regra é o laço de
 * `handleImport`, que soma um contador ao nome original até ele ser inédito).
 *
 * O TOAST EM QUE O CASO ANCORA, e por que ele não é o número asserido. `showLoadSuccess`
 * (`frontend/src/js/import_export/export-import.service.js`) é a ÚLTIMA linha do fluxo de import,
 * depois de mapas, grupos, camadas, 3D/360, temporal, comentários, briefings, ícones e camada
 * base, então é o único sinal que significa "acabou". A palavra dele muda por caminho,
 * `carregados` no não aditivo e `adicionados` no aditivo, e ele pluraliza errado: para UM mapa a
 * frase é "1 mapa carregados!". Daí as duas esperas serem, na ordem, "1 mapa carregados!" (o
 * arquivo base) e "11 mapas adicionados!" (os onze mapas DO ARQUIVO, que é o que
 * `importedMapsCount` conta). As asserções falam de DOZE mapas e 263 feições, que são somas:
 * esperar pela própria quantia que se vai asserir transformaria a asserção num timeout mudo no dia
 * em que ela falhasse.
 *
 * O QUE UM VERDE AQUI NÃO PROVA:
 *   - NÃO prova o ramo de FUSÃO de `importLayersAdditively`. Em produção todo mapa do arquivo
 *     ganha nome inédito e entra em `newlyCreatedMaps`, então a guarda daquele método sempre
 *     desvia e a fusão continua inalcançável pela tela; quem a exercita é
 *     `frontend/tests/unit/import-aditivo-funde-do-repositorio.test.js`, chamando-a direto. A
 *     asserção de ids de camada aqui mede o INVARIANTE que aquele ramo quebraria (nenhum id
 *     repetido dentro de um mapa, porque colisão de id não aparece na tela e sobrescreve), nunca o
 *     ramo em si.
 *   - NÃO prova nada sobre atlas de SERVIDOR: lá o import aditivo é recusado antes de o arquivo
 *     ser lido (`writingIntoServerAtlas`), e este caso roda deslogado, num atlas local.
 *   - NÃO prova o sufixo além do primeiro degrau: só o `_1` é exercido, nunca o `_2`, e nunca o
 *     teto de 100 mapas.
 *   - NÃO prova imagens, blobs nem ícones customizados; a contabilidade aqui é de mapa, feição,
 *     camada, grupo e briefing. Aquela metade é do caso não aditivo, em
 *     `atlas-local-ebgeo-e-teardown.spec.js`.
 *   - NÃO prova o que a pessoa vê depois de um F5: nada aqui recarrega a página.
 *
 * O fluxo inteiro é local e deslogado (não toca em `/api/v1` nem em login), mas o `describeOrSkip`
 * da casa fica: sem o `globalSetup` não há stack de pé para o Playwright dirigir, e um caso que
 * rodasse assim falharia na primeira navegação.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { fileURLToPath } from 'node:url';
import { loadEbgeoFixture, countFixture } from '../helpers/ebgeo-fixture.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** O atlas que JÁ EXISTE quando o import aditivo roda: 1 mapa `Principal`, 1 feição, 1 camada. */
const FIXTURE_BASE = fileURLToPath(new URL('../fixtures/ebgeo-2.2/02-minimo.ebgeo', import.meta.url));

/** O arquivo que é SOMADO por cima: 11 mapas, 262 feições, 17 camadas, 2 grupos, 2 briefings. */
const FIXTURE_ADITIVA = fileURLToPath(new URL('../fixtures/ebgeo-2.2/01-completo.ebgeo', import.meta.url));

/** O único nome de mapa que os dois arquivos têm em comum (premissa asserida no caso). */
const NOME_COLIDIDO = 'Principal';

/** O que a regra de `handleImport` promete para esse nome no primeiro degrau. */
const NOME_SUFIXADO = 'Principal_1';

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
 * Abre a aba Mapas UMA vez. O botão é um TOGGLE: clicá-lo de novo com a aba aberta fecha a barra
 * lateral, e o botão "Importar" iria junto.
 * @param {import('@playwright/test').Page} page - A página do mapa.
 */
async function abrirAbaMapas(page) {
    await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    await expect(page.locator('.maps-tab .map-list-item[data-map-name]').first())
        .toBeVisible({ timeout: 15000 });
}

/**
 * O QUE ESTÁ NO DISCO, lido pelo repositório real de dentro da página.
 *
 * Tudo é indexado por NOME de mapa, e não pela chave de armazenamento, porque nome é o que a regra
 * do sufixo produz e o que a pessoa lê. `registrosPorNome` é o controle que impede as outras
 * contagens de mentirem: com dois registros sob o mesmo nome, a lista de mapas de-duplica e mostra
 * um cartão só, e as somas por nome não distinguiriam esse caso de um mapa único.
 * @param {import('@playwright/test').Page} page - A página do mapa.
 * @returns {Promise<Object>} As contagens por nome, mais os ids de camada repetidos.
 */
function lerRepositorio(page) {
    return page.evaluate(async () => {
        const { getRepository } = await import('/src/js/store/repositories/index.js');
        const repo = getRepository();

        const contarFeicoes = (registro) => {
            let total = 0;
            for (const lista of Object.values(registro?.features ?? {})) {
                if (Array.isArray(lista)) total += lista.length;
            }
            return total;
        };

        const registrosPorNome = {};
        const feicoesPorNome = {};
        const camadasPorNome = {};
        const gruposPorNome = {};
        const idsDeCamadaRepetidos = [];

        for (const [chave, registro] of await repo.getAllMaps()) {
            const nome = registro?.name ?? chave;
            registrosPorNome[nome] = (registrosPorNome[nome] ?? 0) + 1;
            feicoesPorNome[nome] = (feicoesPorNome[nome] ?? 0) + contarFeicoes(registro);

            // Pela CHAVE de armazenamento, que é como camadas e grupos são keyados, para a leitura
            // não depender da resolução nome para id.
            const camadas = await repo.getLayers(chave);
            camadasPorNome[nome] = camadas.length;

            const vistos = new Set();
            for (const camada of camadas) {
                if (vistos.has(camada.id)) idsDeCamadaRepetidos.push({ mapa: nome, id: camada.id });
                vistos.add(camada.id);
            }

            gruposPorNome[nome] = Object.keys(await repo.getGroups(chave)).length;
        }

        const briefings = await repo.getAllBriefings();
        const listaDeBriefings = briefings instanceof Map ? [...briefings.values()] : (briefings ?? []);

        return {
            chaves: (await repo.getAllMapIds()).length,
            registrosPorNome,
            feicoesPorNome,
            camadasPorNome,
            gruposPorNome,
            idsDeCamadaRepetidos,
            briefings: listaDeBriefings.length,
            slides: listaDeBriefings.reduce((soma, b) => soma + (b?.slides?.length ?? 0), 0),
        };
    });
}

/**
 * Quantas camadas o arquivo declara por mapa.
 * @param {{data: Object}} fixture - Um `.ebgeo` já lido.
 * @returns {Object<string, number>}
 */
function camadasDeclaradas({ data }) {
    return Object.fromEntries(
        Object.entries(data.layers ?? {}).map(([nome, lista]) => [nome, lista.length]),
    );
}

/**
 * Quantos grupos o arquivo declara por mapa.
 * @param {{data: Object}} fixture - Um `.ebgeo` já lido.
 * @returns {Object<string, number>}
 */
function gruposDeclarados({ data }) {
    return Object.fromEntries(
        Object.entries(data.groups ?? {}).map(([nome, porId]) => [nome, Object.keys(porId ?? {}).length]),
    );
}

// A CORRIDA É METADE DO SUJEITO AQUI (o import aditivo escreve por cima de dado que já está no
// disco), e um retry transformaria uma interleaving perdedora num `flaky` verde.
test.describe.configure({ retries: 0 });

describeOrSkip('import aditivo pela tela', () => {
    test('o botão Importar SOMA o arquivo ao atlas aberto, sem destruir o que já estava lá', async ({ page }) => {
        test.setTimeout(600000);

        const completo = await loadEbgeoFixture('01-completo.ebgeo');
        const minimo = await loadEbgeoFixture('02-minimo.ebgeo');
        const doArquivo = countFixture(completo);
        const daBase = countFixture(minimo);

        // ------------------------------------------------------------------
        // AS PREMISSAS DAS FIXTURES, ASSERIDAS. Sem isto, trocar um dos dois arquivos deixaria o
        // caso afirmando a colisão de nome do arquivo anterior, e o `Principal_1` abaixo viraria
        // um literal sem dono.
        // ------------------------------------------------------------------
        expect(daBase.mapNames, 'o arquivo base tem UM mapa').toEqual([NOME_COLIDIDO]);
        expect(daBase.features, 'e UMA feição').toBe(1);
        expect(doArquivo.mapNames.filter((nome) => daBase.mapNames.includes(nome)),
            'exatamente um nome colide entre os dois arquivos, e é ele que ganha sufixo')
            .toEqual([NOME_COLIDIDO]);

        const camadasDoArquivo = camadasDeclaradas(completo);
        const camadasDaBase = camadasDeclaradas(minimo);
        // `getLayers` FABRICA uma camada `default` quando o mapa não tem nenhuma gravada, então um
        // mapa ausente da seção de camadas do arquivo leria 1 em vez de 0 e a asserção mediria a
        // fabricação. Todos os mapas dos dois arquivos declaram camadas, e isso fica dito.
        expect(Object.keys(camadasDoArquivo).slice().sort(),
            'todo mapa do arquivo declara camadas, então nenhuma contagem cai no default fabricado')
            .toEqual(doArquivo.mapNames.slice().sort());
        expect(Object.keys(camadasDaBase).slice().sort()).toEqual(daBase.mapNames.slice().sort());

        const gruposDoArquivo = gruposDeclarados(completo);

        // ------------------------------------------------------------------
        // FASE 1: o atlas que JÁ EXISTE. Caminho NÃO aditivo, por `atlas.html`, deslogado.
        // ------------------------------------------------------------------
        await page.goto('/atlas.html');
        await expect(page.locator('[data-testid="local-atlas-section"]')).toBeVisible({ timeout: 20000 });
        await page.locator('[data-testid="local-atlas-file-input"]').setInputFiles(FIXTURE_BASE);

        await page.waitForURL((url) => !url.pathname.endsWith('atlas.html'), { timeout: 30000 });
        await esperarMapa(page);

        // "1 mapa carregados!", com a pluralização errada de `showLoadSuccess` e com a palavra do
        // caminho NÃO aditivo. Esperar por qualquer outra frase aqui é esperar para sempre.
        await expect(page.locator('.toast', { hasText: '1 mapa carregados!' }))
            .toBeVisible({ timeout: 120000 });

        // O CONTROLE que dá sentido a tudo o que vem depois: sem ele, "o preexistente sobreviveu"
        // seria satisfeito por um atlas que nunca teve nada.
        const antes = await lerRepositorio(page);
        expect(antes.chaves, 'o atlas de partida tem UM mapa').toBe(daBase.maps);
        expect(antes.registrosPorNome).toEqual({ [NOME_COLIDIDO]: 1 });
        expect(antes.feicoesPorNome).toEqual(daBase.featuresByMap);
        expect(antes.camadasPorNome).toEqual(camadasDaBase);
        expect(antes.briefings, 'e nenhum briefing').toBe(0);

        // ------------------------------------------------------------------
        // FASE 2: o import ADITIVO, pelo botão da aba Mapas.
        // ------------------------------------------------------------------
        await abrirAbaMapas(page);
        const botaoImportar = page.locator('#maps-action-import');
        // Visível ANTES do clique: `visibleAtlasActions` esconde "Importar" para quem não pode
        // escrever, e um clique em botão escondido falharia por timeout sem dizer isto.
        await expect(botaoImportar).toBeVisible({ timeout: 15000 });

        const [seletor] = await Promise.all([
            page.waitForEvent('filechooser', { timeout: 30000 }),
            botaoImportar.click(),
        ]);
        await seletor.setFiles(FIXTURE_ADITIVA);

        // "adicionados", não "carregados", e ONZE, que são os mapas do arquivo e não o total.
        await expect(page.locator('.toast', { hasText: `${doArquivo.maps} mapas adicionados!` }))
            .toBeVisible({ timeout: 300000 });

        const depois = await lerRepositorio(page);

        // ------------------------------------------------------------------
        // 1. NENHUM MAPA PREEXISTENTE FOI DESTRUÍDO. É o coração do "aditivo": o `Principal` que
        //    já estava lá continua com a feição dele, sob o nome dele.
        // ------------------------------------------------------------------
        expect(depois.feicoesPorNome[NOME_COLIDIDO],
            'o mapa preexistente continua com as feições dele')
            .toBe(daBase.featuresByMap[NOME_COLIDIDO]);
        expect(depois.camadasPorNome[NOME_COLIDIDO],
            'e com as camadas dele')
            .toBe(camadasDaBase[NOME_COLIDIDO]);

        // ------------------------------------------------------------------
        // 2. A COLISÃO DE NOME VIRA SUFIXO, e o nome é asserido por extenso. Um "existe um nome
        //    novo" passaria com "Principal (2)", "Principal-copia" ou qualquer outra invenção.
        // ------------------------------------------------------------------
        expect(depois.feicoesPorNome[NOME_SUFIXADO],
            'o mapa homônimo do arquivo entrou como Principal_1, com as feições DELE')
            .toBe(doArquivo.featuresByMap[NOME_COLIDIDO]);

        // ------------------------------------------------------------------
        // 3. A CONTAGEM FINAL É A SOMA, nunca a substituição. Doze mapas e 263 feições.
        // ------------------------------------------------------------------
        const nomesEsperados = [
            ...daBase.mapNames,
            ...doArquivo.mapNames.map((nome) => (nome === NOME_COLIDIDO ? NOME_SUFIXADO : nome)),
        ];
        expect(depois.chaves, 'uma chave de armazenamento por mapa, base mais arquivo')
            .toBe(daBase.maps + doArquivo.maps);
        expect(depois.registrosPorNome,
            'cada nome carrega UM registro: dois sob o mesmo nome viram um cartão só na lista')
            .toEqual(Object.fromEntries(nomesEsperados.map((nome) => [nome, 1])));

        const feicoesEsperadas = { ...daBase.featuresByMap };
        for (const [nome, quantas] of Object.entries(doArquivo.featuresByMap)) {
            feicoesEsperadas[nome === NOME_COLIDIDO ? NOME_SUFIXADO : nome] = quantas;
        }
        // POR MAPA, e não só no total: um total certo com as feições no mapa errado é exatamente o
        // defeito que um import aditivo mistura, e a soma o esconderia.
        expect(depois.feicoesPorNome, 'as feições de cada mapa chegaram àquele mapa')
            .toEqual(feicoesEsperadas);
        const totalDeFeicoes = Object.values(depois.feicoesPorNome).reduce((soma, n) => soma + n, 0);
        expect(totalDeFeicoes, 'e o total é a SOMA, não a substituição')
            .toBe(daBase.features + doArquivo.features);

        // ------------------------------------------------------------------
        // 4. CAMADAS E GRUPOS DO ARQUIVO CHEGARAM, com a contagem que o arquivo declara. O mapa de
        //    sete camadas é o que separa "chegaram" de "chegou uma camada por mapa".
        // ------------------------------------------------------------------
        const camadasEsperadas = { ...camadasDaBase };
        for (const [nome, quantas] of Object.entries(camadasDoArquivo)) {
            camadasEsperadas[nome === NOME_COLIDIDO ? NOME_SUFIXADO : nome] = quantas;
        }
        expect(depois.camadasPorNome, 'as camadas de cada mapa do arquivo chegaram àquele mapa')
            .toEqual(camadasEsperadas);
        expect(depois.camadasPorNome['07 Camadas'], 'o mapa de sete camadas continua com sete')
            .toBe(camadasDoArquivo['07 Camadas']);

        const gruposEsperados = Object.fromEntries(nomesEsperados.map((nome) => [nome, 0]));
        for (const [nome, quantos] of Object.entries(gruposDoArquivo)) {
            gruposEsperados[nome === NOME_COLIDIDO ? NOME_SUFIXADO : nome] = quantos;
        }
        expect(depois.gruposPorNome, 'os grupos chegaram, e só ao mapa que os declara')
            .toEqual(gruposEsperados);
        expect(depois.gruposPorNome['08 Grupos'], 'o mapa de grupos continua com dois')
            .toBe(gruposDoArquivo['08 Grupos']);

        // Os briefings do arquivo entram sem sobrescrever nada, e o atlas de partida não tinha
        // nenhum: os dois números são os do arquivo.
        expect(depois.briefings, 'os briefings do arquivo chegaram').toBe(doArquivo.briefings);
        expect(depois.slides, 'com todos os slides').toBe(doArquivo.slides);

        // ------------------------------------------------------------------
        // 5. NENHUM ID DE CAMADA REPETIDO DENTRO DE UM MESMO MAPA. Colisão de NOME se vê na tela;
        //    colisão de ID não aparece em lugar nenhum e SOBRESCREVE a camada que já estava lá.
        //    A lista carrega o par (mapa, id) para a falha nomear onde.
        // ------------------------------------------------------------------
        expect(depois.idsDeCamadaRepetidos,
            'nenhum mapa tem duas camadas com o mesmo id')
            .toEqual([]);

        // ------------------------------------------------------------------
        // E O QUE A PESSOA VÊ.
        //
        // A CONTAGEM E RETENTADA, e a primeira versao desta linha nao era: ela esperava o CARTAO
        // do mapa sufixado ficar visivel e entao lia `.count()` UMA vez. Esperar um cartao nao
        // implica a lista ter terminado de desenhar, entao a leitura caia no meio do render.
        // Medido em serie: 2 reprovacoes em 7 rodadas, ~29%, sempre nesta linha e nunca numa
        // assercao de dado. Um verde unico aqui nao teria significado nada.
        //
        // O receio que produziu a forma antiga era virar "timeout mudo", e ele nao se aplica a
        // `toHaveCount`: quando ela estoura, a mensagem traz o esperado E o recebido, entao o dia
        // em que o import voltar a substituir se le como "Expected: 12, Received: 11" e nao como
        // uma espera silenciosa. Retentar remove a corrida sem afrouxar o absoluto.
        // ------------------------------------------------------------------
        await expect(page.locator(`.maps-tab .map-list-item[data-map-name="${NOME_SUFIXADO}"]`))
            .toBeVisible({ timeout: 60000 });
        await expect(page.locator('.maps-tab .map-list-item[data-map-name]'),
            'a lista de mapas mostra os doze')
            .toHaveCount(daBase.maps + doArquivo.maps, { timeout: 30000 });
        await expect(page.locator(`.maps-tab .map-list-item[data-map-name="${NOME_COLIDIDO}"]`),
            'e o preexistente continua na lista, com o nome dele')
            .toBeVisible();
    });
});
