// Path: e2e-ui/painel-de-feicao-na-troca-viva.spec.js

/**
 * @fileoverview A GAVETA DE FEICAO ABERTA NAO ATRAVESSA UMA TROCA VIVA DE ATLAS. Este arquivo
 * PRENDE esse fato, e ele existe porque a suspeita contraria foi levantada, investigada e
 * REPROVADA — o que so se descobre medindo.
 *
 * ============================ A SUSPEITA, E COMO ELA CAIU ====================================
 *
 * A suspeita era: a pessoa com a gaveta de uma feicao aberta troca de atlas e continua vendo o
 * nome, a cor e as coordenadas de uma feicao que nao existe mais. Ela era plausivel pela leitura
 * das ASSINATURAS: `sidebar.control.js` nao ouve nenhum dos cinco avisos de limpeza
 * (`ATLAS_SWITCHED`, `ALL_DATA_CLEARED`, `SESSION_CHANGED`, `LAYERS_CHANGED`,
 * `ATLAS_SETTINGS_CHANGED`). Pela leitura, a gaveta nao tinha por que se curar.
 *
 * A OBSERVACAO DISSE O CONTRARIO, em sete passagens no navegador: servidor->local e
 * servidor->servidor, e depois com um, dois e nenhum aviso silenciado no barramento. A gaveta
 * fechou em TODAS, e a selecao ativa zerou em todas. Isto e exatamente o que a leitura de
 * assinaturas nao consegue ver: a cura chega por caminhos que nao sao assinatura nenhuma.
 *
 * QUEM CURA, ATE ONDE FOI MEDIDO. `open-atlas.service.js` chama
 * `getControl('BaseLayerControl').switchMap(false)` PELO NOME, nos dois ramos da troca, e
 * `switchMap` faz DUAS coisas que limpam esta gaveta de lambuja:
 *
 *   BRACO 1 — `this._selectionManager.deselectAllFeatures()`, que desce por
 *   `uiManager.saveChangesAndClosePanel()` ate `stateManager.closeFeaturePanel()`.
 *
 *   BRACO 2 — no fim de `switchMap`, `emit(BASE_LAYER_CHANGED)`, cujo ouvinte aqui
 *   (`_onBaseLayerChanged`) fecha qualquer painel aberto. Ele dispara MESMO QUANDO A CAMADA DE
 *   FUNDO NAO MUDOU, que e o caso de toda troca entre dois atlas com o mesmo mapa base.
 *
 * E EXISTE UM TERCEIRO CAMINHO, QUE ESTE ARQUIVO DESCOBRIU E NAO NOMEIA. Silenciados os DOIS
 * eventos de barramento (`featurePanel:closed` e `baseLayer:changed`), a gaveta continuou
 * fechando. Ou seja, alguma via direta — fora do barramento — tambem a fecha. Dizer qual seria
 * anunciar causa sem testar; o que esta medido e que a cura sobrevive ao corte dos dois avisos.
 *
 * ============================ POR QUE ISTO E UM PIN, E NAO UM CONSERTO =======================
 *
 * NAO HOUVE CONSERTO AQUI, de proposito. Assinar `ATLAS_SWITCHED` na barra lateral seria codigo
 * cujo efeito nenhuma leitura desta bancada consegue distinguir de zero, e um guarda que nao
 * pode reprovar nao guarda nada. `layers.tab.js` assinou nessa mesma situacao, e la a decisao
 * coube ao dono; aqui ela fica REGISTRADA e nao tomada, porque a gaveta depende de tres vias,
 * nao de uma.
 *
 * O QUE FICA REGISTRADO PARA O DONO: a cura nao esta pendurada em nada que fale de "trocar de
 * atlas". Ela depende de `switchMap`, um metodo sobre CAMADA DE FUNDO, ser chamado pelo nome de
 * dentro do servico de atlas. Tirar `deselectAllFeatures` de dentro de `switchMap` e uma limpeza
 * plausivel (desselecionar nao e trabalho de trocar de camada), e no dia em que as tres vias
 * cairem juntas e ESTE arquivo que reprova.
 *
 * ============================ AS TRES LEITURAS ===============================================
 *
 * Uma leitura so, com tudo ligado, provaria "fechou" sem dizer QUANTAS vias sustentam isso — e
 * uma tela limpa e o que se ve tanto com tres vias quanto com uma. Entao cada passagem corta um
 * conjunto diferente, e as tres rodam no MESMO navegador contra os MESMOS atlas:
 *
 * - OS DOIS ELOS CORTADOS: a leitura mais severa, e a que descobriu a terceira via. Ela vem
 *   PRIMEIRO para uma reprovacao nao ficar escondida atras das outras duas.
 * - SO O ELO DO PAINEL CORTADO: documenta, dentro do caso, por que os cortes sao dois e nao um.
 * - CADEIA INTEIRA: o produto, que e o que o usuario tem.
 *
 * CORTAR `baseLayer:changed` silencia tambem quatro ouvintes que nada tem com esta gaveta. Isso
 * e aceito de proposito: nenhum deles escreve nas duas superficies que este arquivo le, e a
 * troca continua devolvendo `{ok: true, changed: true}`, o que o proprio caso confere.
 *
 * ============================ A TABELA DE ATRIBUTOS VEM JUNTO =================================
 *
 * Ela e a segunda superficie que guarda feicao do atlas por conta propria, e ela e lida na mesma
 * passagem por um motivo de instrumento: abrir o painel de feicao DESMONTA a aba Camadas, e com
 * ela o botao `.table-toggle` que abre a tabela. Medido: uma primeira versao clicava na ordem
 * inversa, nao achava o botao e relatava "0 linhas" — um zero que nao media nada e se leria como
 * "limpo". Aqui a tabela abre ANTES da gaveta, e por isso as duas chegam vivas a troca.
 *
 * ============================ O QUE ESTE ARQUIVO NAO MEDE =====================================
 *
 * O painel de comentarios (ele assina `ALL_DATA_CLEARED`, e a onda anterior ja observou esse
 * evento chegando na troca) e a barra temporal. Nenhum dos dois entrou aqui com conteudo do
 * atlas na tela, entao este arquivo nao afirma nada sobre eles.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';
import {
    drawPointUI, selectFeatureUI, renameViaPanelUI, openLayersTab,
} from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/** O nome que so existe no atlas de partida. Achar isto do outro lado e a definicao de velho. */
const MARCA = 'FEICAO-SO-DO-A';

/** Espera a barra de enderecos e o mapa concordarem que o atlas pedido esta aberto. */
async function esperarAtlasPronto(page, atlasId, mapId) {
    await page.waitForFunction(({ id, mapa }) => {
        const p = new URLSearchParams(location.search);
        return p.get('atlas') === id && p.get('map') === mapa
            && Boolean(globalThis.__ebgeoMap?.loaded?.());
    }, { id: atlasId, mapa: mapId }, { timeout: 60000, polling: 'raf' });
}

/**
 * Espera o mapa corrente estar DESTRAVADO antes de qualquer gesto de edicao.
 *
 * MEDIDO, e nao precaucao generica. O painel de feicao so desenha o campo de nome quando
 * `isCurrentMapLockedSync()` e falso (`sidebar/components/feature-identification.js`), e logo
 * depois de abrir um atlas de servidor o cadeado ainda pode estar de pe por um instante. Uma
 * rodada reprovou exatamente ali, com "element(s) not found" no campo de nome: o painel estava
 * aberto e CORRETO, so que na versao read-only. Sem esta espera, o caso mede a corrida do
 * cadeado em vez de medir a troca de atlas.
 * @param {import('@playwright/test').Page} page
 */
async function esperarMapaDestravado(page) {
    await expect.poll(
        () => page.evaluate(async () => {
            const s = await import('/src/js/store/index.js');
            return s.isCurrentMapLockedSync?.() ?? false;
        }),
        { timeout: 60000, message: 'o mapa corrente continuou travado' }
    ).toBe(false);
}

/**
 * Tenta abrir a tabela de atributos pelo botao da aba Camadas. BEST-EFFORT, de proposito.
 *
 * ELA E UM EXTRA, E NAO O ASSUNTO. O assunto deste arquivo e a gaveta de feicao; a tabela entra
 * de carona porque ela e a outra superficie que guarda feicao do atlas. Se ela nao abrir, o caso
 * segue e o relatorio DIZ que ela nao entrou, em vez de reprovar por um instrumento que nao e o
 * que se quer medir. Medido: em tres rodadas contra um atlas de SERVIDOR o botao `.table-toggle`
 * nao chegou a existir na arvore, enquanto `attribute-table.spec.js` o encontra sempre num
 * workspace LOCAL. A diferenca entre os dois casos nao foi investigada aqui, e por isso a tabela
 * nao pode ser condicao de aprovacao deste arquivo.
 *
 * A ABERTURA DA ABA E `openLayersTab`, NUNCA UM CLIQUE DIRETO NO BOTAO DA ABA. Clicar na aba que
 * JA esta aberta a FECHA (`_handleTabClick` colapsa quando a aba clicada e a ativa), e foi isso
 * que uma rodada mediu: o passo anterior deixava "Camadas" aberta, o clique a fechava, e
 * `.table-toggle` sumia do DOM. O helper da casa so clica quando a arvore nao esta na tela.
 *
 * O RETRY existe porque a arvore se reconstroi inteira a cada `LAYERS_CHANGED`, e o `flush` da
 * feicao recem-desenhada dispara um desses: o clique encontra o botao, comeca a agir e leva um
 * "element was detached from the DOM". Re-localizar a cada tentativa sobrevive a isso.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<boolean>} Se a tabela ficou visivel.
 */
async function tentarAbrirTabelaDeAtributos(page) {
    try {
        await openLayersTab(page);
        await expect(async () => {
            const botao = page.locator('.table-toggle').first();
            await botao.scrollIntoViewIfNeeded({ timeout: 3000 });
            await botao.click({ timeout: 3000 });
            await expect(page.locator('.attribute-table-panel')).toBeVisible({ timeout: 3000 });
        }).toPass({ timeout: 30000 });
        return true;
    } catch {
        return false;
    }
}

/**
 * As duas superficies, no mesmo instante, pelo que o usuario ve.
 *
 * O PAINEL E LIDO POR `data-expanded`, e nao pelo texto: `hide()` esvazia o conteudo so 300 ms
 * depois da animacao, entao um painel ja fechado ainda tem texto por um instante. A gaveta estar
 * ABERTA e o fato; o texto dentro dela e a consequencia, e as duas coisas sao aferidas.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{gavetaAberta: number, nomeNaGaveta: string, linhasDaTabela: string}>}
 */
function lerTela(page) {
    return page.evaluate(() => ({
        gavetaAberta: document.querySelectorAll('.feature-panel[data-expanded="true"]').length,
        nomeNaGaveta: [...document.querySelectorAll('.feature-panel input')]
            .map((el) => el.value ?? '').join(' | '),
        linhasDaTabela: [...document.querySelectorAll(
            '.attribute-table-panel .attribute-table-cell-name'
        )].map((el) => el.textContent ?? '').join(' | '),
    }));
}

describeOrSkip('o painel de feicao aberto numa troca viva de atlas', () => {
    test('fecha, e continua fechando com um e com os dois elos cortados', async ({ browser }, testInfo) => {
        test.setTimeout(600000);
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; },
            `${state.baseUrl}/api/v1`);

        const dono = await createVerifiedUser({ prefix: 'gaveta', nome: 'Dono da gaveta' });
        await page.goto('/');

        // DOIS ATLAS DE SERVIDOR, com mapas de nomes DIFERENTES. O nome distinto e o que faz o
        // criterio de chegada parar no atlas certo: com o mesmo nome nos dois, `esperarAtlasPronto`
        // aprovaria a partida como se fosse o destino.
        const s = await page.evaluate(async ({ base, u }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const api = new ApiClient({ baseUrl: `${base}/api/v1` });
            await api.login(u.username, u.password);
            const a = await api.createAtlas({ name: 'Atlas A da gaveta' });
            const b = await api.createAtlas({ name: 'Atlas B da gaveta' });
            const mapA = crypto.randomUUID();
            const mapB = crypto.randomUUID();
            await api.pushOperations(a.id, [createOperation('map', 'create', mapA, null, { name: 'MAPA-A' })]);
            await api.pushOperations(b.id, [createOperation('map', 'create', mapB, null, { name: 'MAPA-B' })]);
            return { atlasA: a.id, mapA, atlasB: b.id, mapB };
        }, { base: state.baseUrl, u: dono });

        /**
         * Uma passagem: volta ao atlas A, deixa a gaveta e a tabela com a feicao na tela, troca
         * AO VIVO para o atlas B e le o que sobrou.
         *
         * A RECARGA NO INICIO nao e higiene generica: ela e o que RESTAURA os assinantes que a
         * passagem anterior possa ter desligado, e o que faz as duas metades partirem do mesmo
         * estado no MESMO navegador.
         * @param {{rotulo: string, cortar: string[]}} caso - `cortar` lista os eventos do
         *   barramento a silenciar antes da troca, que e como cada braco imperativo e desligado.
         */
        async function passagem({ rotulo, cortar = [] }) {
            await page.goto(`/?atlas=${s.atlasA}`);
            await esperarAtlasPronto(page, s.atlasA, s.mapA);

            await esperarMapaDestravado(page);
            const id = await drawPointUI(page, [-43.2, -22.9]);
            await expect(async () => {
                await selectFeatureUI(page, id);
                await renameViaPanelUI(page, MARCA);
            }).toPass({ timeout: 90000 });

            // A TABELA PRIMEIRO. A gaveta desmonta a aba Camadas junto com o botao que abre a
            // tabela, entao a ordem inversa nao mede a tabela, so o zero dela.
            await tentarAbrirTabelaDeAtributos(page);

            await selectFeatureUI(page, id);

            const antes = await lerTela(page);
            // CONTROLE DA PROPRIA PASSAGEM: sem a marca na tela ANTES, a leitura de depois nao
            // distingue "limpou" de "nunca chegou a ter".
            expect(antes.gavetaAberta, `${rotulo}: a gaveta nao chegou a abrir`).toBe(1);
            expect(antes.nomeNaGaveta, `${rotulo}: a gaveta nao mostrou a feicao do atlas A`)
                .toContain(MARCA);
            // A TABELA SO E COBRADA SE ENTROU. Ver `tentarAbrirTabelaDeAtributos`: ela e extra, e
            // exigi-la aqui faria o caso reprovar por um instrumento que nao e o assunto.
            const tabelaEntrou = antes.linhasDaTabela.includes(MARCA);

            let cortados = null;
            if (cortar.length > 0) {
                cortados = await page.evaluate(async (eventos) => {
                    const { getEventBus } = await import('/src/js/store/services.js');
                    const bus = getEventBus();
                    return eventos.map((evt) => {
                        const n = bus.listenerCount(evt);
                        bus.offAll(evt);
                        return `${evt}:${n}`;
                    }).join(' ');
                }, cortar);
                // CONTROLE DO PROPRIO A/B: sem assinante para cortar, as metades seriam a mesma
                // leitura e este arquivo nao mediria nada. `:0` em qualquer um denuncia isso.
                expect(cortados, 'havia assinantes para cortar nos dois elos')
                    .not.toMatch(/:0(\s|$)/);
            }

            const troca = await page.evaluate(
                (d) => globalThis.__ebgeoSwitchAtlas('remote', d.atlasB, d.mapB), s
            );
            expect(troca, `${rotulo}: a troca nao aconteceu`).toMatchObject({ ok: true, changed: true });

            // A cura, quando existe, e assincrona (o painel relê, a tabela se reconstroi). Dois
            // segundos sao ordens de grandeza mais do que ela precisa, e nao escondem a ausencia
            // dela: um painel que nao fecha nao fecha em duas horas.
            await page.waitForTimeout(2000);
            const depois = await lerTela(page);
            return { rotulo, antes, depois, cortados, tabelaEntrou };
        }

        // A ORDEM E A DA SEVERIDADE: a leitura que REPROVA vem primeiro, para uma reprovacao
        // nao ficar escondida atras de dez minutos das outras duas.
        const doisCortados = await passagem({
            rotulo: 'os DOIS elos cortados',
            cortar: ['featurePanel:closed', 'baseLayer:changed'],
        });
        const umCortado = await passagem({
            rotulo: 'so o elo do painel cortado', cortar: ['featurePanel:closed'],
        });
        const inteiro = await passagem({ rotulo: 'cadeia inteira (produto)' });

        const linha = (r) => `${r.rotulo.padEnd(28)}| gaveta=${r.depois.gavetaAberta} `
            + `| nome="${r.depois.nomeNaGaveta}" `
            + `| tabela=${r.tabelaEntrou ? `"${r.depois.linhasDaTabela}"` : '(nao entrou na tela)'}`;
        const relato = [
            `depois de trocar AO VIVO do atlas A para o atlas B, procurando "${MARCA}":`,
            '',
            linha(doisCortados),
            linha(umCortado),
            linha(inteiro),
        ].join('\n');
        console.info(`\n[o painel de feicao na troca viva]\n${relato}\n`);
        await testInfo.attach('gaveta-apos-troca.txt', { body: relato, contentType: 'text/plain' });

        for (const r of [doisCortados, umCortado, inteiro]) {
            expect(r.depois.gavetaAberta,
                `${r.rotulo}: a gaveta do atlas anterior continuou aberta`).toBe(0);
            expect(r.depois.nomeNaGaveta,
                `${r.rotulo}: a gaveta ficou com a feicao do atlas anterior`).not.toContain(MARCA);
            if (r.tabelaEntrou) {
                expect(r.depois.linhasDaTabela,
                    `${r.rotulo}: a tabela ficou com a feicao do atlas anterior`).not.toContain(MARCA);
            }
        }

        await ctx.close();
    });
});
