// Path: e2e-ui/envio-do-acervo-herdado.spec.js

/**
 * @fileoverview ENVIAR AO SERVIDOR O ACERVO HERDADO, no navegador, que é o gesto da virada.
 *
 * O ACHADO (B3-11), medido em 2026-09-07 sobre uma instalação real atravessada da linha anterior:
 * do slot de sufixo VAZIO subiam **2 mapas de 14 e 33 feições de 805**, com toast VERDE de
 * sucesso. A causa não estava no envio: a linha anterior grava todo mapa novo com a CHAVE certa e
 * `data.name = 'Novo Mapa'`, e este leitor foi o primeiro consumidor a preferir o campo à chave,
 * de modo que treze mapas colidiam numa entrada só e vencia o último iterado. Junto vinham B3-12
 * (a aba Mapas do atlas novo desenhava catorze cartões para dois mapas, escondendo a perda atrás
 * do número certo) e B3-13 (o ramo de sucesso navega, e a frase com os números morre com a página
 * que a desenhou).
 *
 * O ESTADO É FABRICADO, E ISSO ESTÁ DECLARADO. Semear pela `main` 2.4 de verdade exigiria um
 * worktree da outra linha servido na mesma origem; o que este arquivo faz é escrever no IndexedDB
 * da página, pela API crua, exatamente o disco que aquela medição encontrou: catorze registros em
 * `ebgeo_maps` (o banco SEM SUFIXO, que é o endereço do acervo herdado), com a chave sendo o nome
 * certo e `data.name = 'Novo Mapa'` em treze deles. A travessia em si não é o sujeito daqui: ela
 * foi medida em separado, com 0 registros perdidos, e o que este arquivo mede é o ENVIO a partir
 * do disco que ela deixa.
 *
 * O QUE ESTE ARQUIVO NÃO ALCANÇA, dito para não ser lido como cobertura completa: a semeadura pela
 * `main` real, o catálogo 3D/360 do servidor cadastrado (o backend do arnês nasce vazio, então a
 * poda de recurso não é exercitada aqui), e o lote de imagens partido no meio.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/**
 * Os catorze mapas do acervo medido, com a contagem de feições de cada um. A soma é 805, e os dois
 * que sobreviviam ao defeito ("Principal", 23, e "14 Bordas", 10, que é o último por ordem de
 * chave) somam 33 — o par de números do relatório.
 */
const ACERVO = [
    ['Principal', 23], ['02 Estilos', 86], ['03 Camadas', 40], ['04 Imagens', 55],
    ['05 Simbologia', 90], ['06 Medidas', 70], ['07 Temporal', 61], ['08 Briefing', 44],
    ['09 Modelos 3D', 58], ['10 Fotos 360', 77], ['11 Grupos', 66], ['12 Lote', 52],
    ['13 Notas', 73], ['14 Bordas', 10],
];
const TOTAL_DE_FEICOES = ACERVO.reduce((soma, [, n]) => soma + n, 0);

/** A chave do espelho de toasts em `localStorage`. Ver {@link espelharToasts}. */
const ESPELHO = '__h1_toasts__';

/**
 * ESPELHA TODO TOAST EM `localStorage`, porque o ramo de sucesso NAVEGA.
 *
 * O toast morre com o documento que o desenhou: amostrando a lista a cada 20 ms, 400 vezes, a
 * frase do envio bem-sucedido nunca foi lida no DOM. `localStorage` sobrevive à navegação, então o
 * observador copia o texto de cada toast para lá e a asserção o lê depois. É INSTRUMENTO, não
 * produto: nada aqui muda o que o app faz.
 */
async function espelharToasts(page) {
    await page.addInitScript((chave) => {
        const guardar = (texto) => {
            try {
                const atual = JSON.parse(localStorage.getItem(chave) || '[]');
                atual.push(texto);
                localStorage.setItem(chave, JSON.stringify(atual));
            } catch { /* armazenamento desligado: o caso simplesmente não terá evidência */ }
        };
        const observar = () => {
            new MutationObserver((mutacoes) => {
                for (const m of mutacoes) {
                    for (const no of m.addedNodes) {
                        if (no.nodeType !== 1) continue;
                        const alvo = no.classList?.contains('toast')
                            ? no
                            : no.querySelector?.('.toast');
                        if (alvo) guardar(`${alvo.className}\n${alvo.textContent}`);
                    }
                }
            }).observe(document.body, { childList: true, subtree: true });
        };
        if (document.body) observar();
        else document.addEventListener('DOMContentLoaded', observar, { once: true });
    }, ESPELHO);
}

/**
 * O que o espelho colheu, do mais recente para o mais antigo.
 *
 * A LEITURA ACONTECE ENQUANTO A PAGINA NAVEGA, e por isso ela tolera o contexto morrendo. O ramo de
 * sucesso do envio NAVEGA (e e justamente por isso que este arquivo espelha o toast em
 * `localStorage`): uma amostra do `poll` que caia no meio da navegacao morre com "Execution context
 * was destroyed" e, sem este `catch`, derruba o caso inteiro em vez de simplesmente valer zero e
 * ser reamostrada. Devolver lista vazia nao afrouxa nada: a assercao e sobre o que o espelho TEM,
 * e uma amostra vazia so adia a resposta.
 */
function lerToasts(page) {
    return page.evaluate((chave) => {
        try { return JSON.parse(localStorage.getItem(chave) || '[]'); } catch { return []; }
    }, ESPELHO).catch(() => []);
}

/**
 * ESCREVE O DISCO DA POPULAÇÃO, pela API crua do IndexedDB e no formato do localforage (banco
 * `<nome>`, object store `keyvaluepairs`, valor gravado sob a chave).
 *
 * OS BANCOS SÃO OS SEM SUFIXO, que é o que faz deste o acervo HERDADO: `resolveDbName` devolve
 * `ebgeo_maps` (e não `ebgeo_maps__<sufixo>`) quando o sufixo é a string vazia.
 */
async function semearAcervoHerdado(page, acervo) {
    return page.evaluate(async ({ mapas }) => {
        const STORE = 'keyvaluepairs';

        const abrir = (nome, versao) => new Promise((res, rej) => {
            const req = versao ? indexedDB.open(nome, versao) : indexedDB.open(nome);
            req.onupgradeneeded = () => {
                if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
            };
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
            req.onblocked = () => rej(new Error(`bloqueado ao abrir ${nome}`));
        });

        async function gravar(banco, pares) {
            // SEM VERSÃO NA PRIMEIRA ABERTURA, e não é detalhe: o localforage SOBE a versão do
            // banco quando precisa criar um object store que falta, então um `open(nome, 1)` sobre
            // um banco que o app já levou à versão 2 estoura com `VersionError` (medido aqui em
            // 2026-09-07). Abrir sem versão pega a que existe, e cria o banco em 1 quando ele não
            // existe; a subida só acontece no caso raro de o store não estar lá.
            let db = await abrir(banco);
            if (!db.objectStoreNames.contains(STORE)) {
                const proxima = db.version + 1;
                db.close();
                db = await abrir(banco, proxima);
            }
            await new Promise((res, rej) => {
                const tx = db.transaction(STORE, 'readwrite');
                const os = tx.objectStore(STORE);
                for (const [chave, valor] of pares) os.put(valor, chave);
                tx.oncomplete = res;
                tx.onerror = () => rej(tx.error);
            });
            db.close();
        }

        const registros = mapas.map(([nome, quantas]) => [nome, {
            // A CHAVE É O NOME CERTO, e o CAMPO é o literal envenenado em treze dos catorze. É
            // exatamente o disco que a instalação real trazia.
            name: nome === 'Principal' ? 'Principal' : 'Novo Mapa',
            baseLayer: 'carta-topografica',
            zoom: 8, center_lat: -22.9, center_long: -43.2, bearing: 0, pitch: 0,
            analysisLayers: {},
            features: {
                points: Array.from({ length: quantas }, (_, i) => ({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [-43.2 + i * 0.001, -22.9 + i * 0.001] },
                    properties: {
                        id: `${nome}-${i}`.replace(/\s/g, '_'),
                        source: 'point',
                        layerId: 'default',
                        name: `${nome} ${i}`,
                    },
                })),
            },
        }]);

        await gravar('ebgeo_maps', registros);
        await gravar('ebgeo_app_settings', [
            // O CARIMBO É O CORRENTE de propósito: o sujeito deste arquivo é o ENVIO, e não a
            // travessia, que já foi medida à parte. Semear um carimbo velho poria a cadeia de
            // migração dentro da medida sem que ela seja o que se quer medir.
            ['schemaVersion', '3.0'],
            ['mapOrder', mapas.map(([nome]) => nome)],
            ['lastActiveMap', 'Principal'],
        ]);
        await gravar('ebgeo_atlas', [['current_atlas', {
            id: 'acervo-herdado', name: 'Meu Atlas', schemaVersion: '3.0',
            mapOrder: mapas.map(([nome]) => nome), lastActiveMapId: 'Principal',
        }]]);
        return registros.length;
    }, { mapas: acervo });
}

/** O que está no disco do slot herdado, pela API crua: a premissa de toda asserção seguinte. */
function lerDisco(page) {
    return page.evaluate(async () => {
        const db = await new Promise((res, rej) => {
            const req = indexedDB.open('ebgeo_maps');
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        });
        const valores = await new Promise((res, rej) => {
            const req = db.transaction('keyvaluepairs', 'readonly')
                .objectStore('keyvaluepairs').getAll();
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        });
        db.close();
        let features = 0;
        for (const mapa of valores) {
            for (const balde of Object.values(mapa?.features || {})) {
                if (Array.isArray(balde)) features += balde.length;
            }
        }
        return { maps: valores.length, features };
    });
}

/**
 * O slot que carrega o acervo herdado, lido do registro: é ele que o cartão desenha.
 *
 * O ENDERECO DELE NAO E MAIS SO A STRING VAZIA, e esta funcao procurava exatamente isso ate
 * 2026-09-13. O portao de migracao ADOTA a instalacao pre-namespace num slot de sufixo
 * `upgrade-<uuid>` (e o `ebgeo__upgrade-...` aparece no disco de toda rodada que atravessa a
 * travessia), entao perguntar so por `dbSuffix === ''` devolvia `null` e o caso morria antes de
 * chegar ao envio. Aceitar as DUAS formas e o que mantem o instrumento valendo nos dois regimes.
 *
 * A LISTA INTEIRA VOLTA JUNTO de proposito: quando nenhum slot casa, a mensagem da assercao
 * precisa dizer QUAIS existem, senao o proximo leitor repete esta mesma investigacao.
 * @returns {Promise<{herdado: {name: string, dbSuffix: string}|null, todos: Array<object>}>}
 */
function slotHerdado(page) {
    return page.evaluate(async () => {
        const ns = await import('/src/js/store/atlas-namespace.js');
        const slots = await ns.readLocalAtlasRegistry();
        const resumo = slots.map((s) => ({
            name: s.name, dbSuffix: s.dbSuffix, adoptedLegacy: s.adoptedLegacy === true,
        }));
        // O CARIMBO VEM PRIMEIRO, e o sufixo vazio e o regime de ANTES da travessia.
        const herdado = resumo.find((s) => s.adoptedLegacy || s.dbSuffix === '');
        return { herdado: herdado ?? null, todos: resumo };
    });
}

/**
 * O cartão de UM atlas local pelo nome EXATO. `hasText` casa por substring, e "Meu Atlas" alcança
 * "Meu Atlas (cópia)"; quem tem o nome exato é o `.local-atlas__name` de dentro.
 */
function cartaoPeloNomeExato(page, nome) {
    return page.locator('[data-testid="local-atlas-item"]')
        .filter({ has: page.getByText(nome, { exact: true }) });
}

/** Entra pela tela de "Seus atlas", que é a porta de quem chega da versão anterior. */
async function entrarPelaTela(page, creds) {
    await page.locator('[data-testid="projects-login"]').click();
    await page.locator('[data-testid="login-username"]').fill(creds.username);
    await page.locator('[data-testid="login-password"]').fill(creds.password);
    await page.locator('[data-testid="login-submit"]').click();
    // O login RECARREGA a página; o item de "Enviar ao servidor" só existe com sessão.
    await expect(page.locator('[data-testid="local-atlas-item"]').first())
        .toBeVisible({ timeout: 30000 });
}

/** Abre o menu do cartão e dispara "Enviar ao servidor", com o nome pedido. */
async function enviarPeloCartao(page, nomeDoCartao, nomeNoServidor) {
    const cartao = cartaoPeloNomeExato(page, nomeDoCartao);
    await expect(cartao).toBeVisible({ timeout: 20000 });
    await cartao.locator('xpath=following-sibling::*[@data-testid="local-atlas-menu"]').click();
    const item = page.locator('[data-testid="local-atlas-send-to-server"]');
    await expect(item, 'o item "Enviar ao servidor" só aparece com sessão').toBeVisible();
    await item.click();
    await page.locator('[data-testid="local-atlas-name-input"]').fill(nomeNoServidor);
    await page.locator('[data-testid="local-atlas-name-confirm"]').click();
}

/**
 * Prepara uma aba com o acervo herdado no disco e a sessão aberta.
 * @returns {Promise<{ctx: *, page: *, creds: *, nomeDoCartao: string}>}
 */
async function prepararAcervo(browser, prefixo) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
    await espelharToasts(page);

    // A SEMEADURA ACONTECE ANTES DE O APP BOOTAR UMA UNICA VEZ, e o jeito de conseguir isso e
    // ABORTAR O ENTRY na primeira visita: `atlas.html` carrega um unico modulo
    // (`src/js/projects/projects-page.js`), entao sem ele a casca HTML sobe, o IndexedDB da
    // ORIGEM esta acessivel e nenhuma linha do produto roda.
    //
    // A PRIMEIRA TENTATIVA FOI SEMEAR NUMA PAGINA ESTATICA (`public/docs/doc.html`) e ela
    // falhou de um jeito que vale registrar: aquela pagina carrega o docsify, que reescreve a
    // URL assim que sobe, e o `page.evaluate` da semeadura morria com "Execution context was
    // destroyed". Pagina sem script NENHUM e a propria casca, com o entry barrado.
    //
    // POR QUE NAO SEMEAR DEPOIS DO PRIMEIRO BOOT, que e o que este arquivo fazia ate 2026-09-13:
    // o portao de migracao (`runLegacyUpgradeGate`) roda nas QUATRO paginas desde 2026-09-13, e o
    // primeiro boot com o disco legado VAZIO registra a travessia sobre um disco vazio. Escrever
    // os catorze mapas depois disso e, para o produto, a versao ANTIGA tendo gravado alteracoes
    // apos a travessia — e a resposta certa dele e a tela "Recuperar seus dados", que tomava
    // `atlas.html` e fazia `[data-testid="local-atlas-item"]` nunca aparecer. O produto estava
    // certo e a FIXTURE e que representava outro cenario: quem chega da versao anterior tem o
    // disco herdado ANTES do primeiro boot, nunca depois dele.
    const ENTRY = '**/projects-page.js';
    await page.route(ENTRY, (route) => route.abort());
    await page.goto('/atlas.html');
    const semeados = await semearAcervoHerdado(page, ACERVO);
    expect(semeados, 'a semeadura escreveu os catorze registros').toBe(14);
    await page.unroute(ENTRY);

    // PRIMEIRO E UNICO BOOT DO APP: o registro adota os bancos sem sufixo e o cartão do acervo
    // aparece, que e exatamente o que a pessoa ve ao abrir a versao nova pela primeira vez.
    await page.goto('/atlas.html');
    await expect(page.locator('[data-testid="local-atlas-section"]')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-testid="local-atlas-item"]').first())
        .toBeVisible({ timeout: 30000 });

    // PREMISSA ASSERIDA: o disco tem mesmo 14 e 805. Sem ela, "chegaram 14 ao servidor" seria
    // verdade contra uma semeadura que não escreveu nada e um app que inventou os mapas.
    expect(await lerDisco(page)).toEqual({ maps: 14, features: TOTAL_DE_FEICOES });

    const { herdado, todos } = await slotHerdado(page);
    expect(
        herdado,
        `o registro tem o slot do acervo herdado (sufixo vazio ou upgrade-*); ele tem ${JSON.stringify(todos)}`,
    ).toBeTruthy();
    const nomeDoCartao = herdado.name;

    const creds = await createVerifiedUser({ prefix: prefixo, nome: 'Onda 4 H1' });
    await entrarPelaTela(page, creds);
    return { ctx, page, creds, nomeDoCartao };
}

/** O que o SERVIDOR tem, por HTTP e não pela tela. */
function lerServidor(page, creds, atlasId) {
    return page.evaluate(async ({ baseUrl, c, aid }) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
        await api.login(c.username, c.password);
        const pulled = await api.pullSync(aid, 0);
        const maps = pulled.snapshot?.maps || [];
        let features = 0;
        for (const m of maps) {
            for (const balde of Object.values(m.features || {})) {
                if (Array.isArray(balde)) features += balde.length;
            }
        }
        return { maps: maps.length, nomes: maps.map((m) => m.name).sort(), features };
    }, { baseUrl: state.baseUrl, c: creds, aid: atlasId });
}

describeOrSkip('enviar ao servidor o acervo herdado', () => {
    test('os catorze mapas e as 805 feições chegam, e a frase traz os números', async ({ browser }, testInfo) => {
        test.setTimeout(300000);
        const { ctx, page, creds, nomeDoCartao } = await prepararAcervo(browser, 'h1a');

        await enviarPeloCartao(page, nomeDoCartao, 'Acervo Herdado H1');

        // A FRASE VEM ANTES DA NAVEGAÇÃO NA ORDEM DAS ASSERÇÕES, e a ordem é escolhida pela
        // evidência que ela imprime: contra o leitor de antes esta linha reprova mostrando a frase
        // com "2 mapas, 33 feições", que é o achado inteiro, enquanto um `waitForURL` sozinho
        // reprovaria com um timeout de navegação que não diz nada sobre o que se perdeu.
        //
        // A FRASE É GUARDADA PELO PRÓPRIO `poll`, e não relida depois dele. A releitura que morava
        // aqui era uma SEGUNDA amostra, desprotegida, no meio exato da navegação que o ramo de
        // sucesso dispara: `lerToasts` engole o "Execution context was destroyed" e devolve lista
        // vazia (o que é certo para uma amostra do poll, que simplesmente vale zero e é
        // reamostrada), então a linha seguinte lia `''` e reprovava dizendo "a frase do envio foi
        // dita ... Received string: ''", isto é, acusando o produto de não ter dito a frase que o
        // poll ACABARA de ver. Medido em 19/09/2026: verde 3 de 3 numa série e vermelho na rodada
        // seguinte do mesmo commit, 1 em 4. Guardar o que a amostra vencedora leu remove a segunda
        // leitura e com ela a corrida.
        let frase = '';
        await expect.poll(
            async () => {
                const achada = (await lerToasts(page)).find((t) => t.includes('foi enviado ao servidor')) ?? '';
                if (achada) frase = achada;
                return achada;
            },
            { timeout: 120000 },
        ).toContain('foi enviado ao servidor');
        await testInfo.attach('a frase do envio', { body: frase, contentType: 'text/plain' });
        expect(frase, 'a frase do envio foi dita').toContain('Acervo Herdado H1');
        expect(frase).toContain('14 mapas');
        expect(frase).toContain(`${TOTAL_DE_FEICOES} feições`);
        // SUCESSO, e não aviso: qualquer um dos quatro avisos (mapa a menos, feição a menos, poda
        // do servidor, imagem que não subiu) trocaria o tom e prenderia a página na lista.
        expect(frase).toContain('toast--success');

        // O DESFECHO DO SUCESSO É NAVEGAR para o atlas novo.
        await page.waitForURL(/[?&]atlas=/, { timeout: 120000 });
        const atlasId = new URL(page.url()).searchParams.get('atlas');
        expect(atlasId, 'a URL passou a nomear o atlas recém-criado').toBeTruthy();

        // 1. O SERVIDOR, por HTTP. É a medida independente da tela.
        const servidor = await lerServidor(page, creds, atlasId);
        expect(servidor.maps).toBe(14);
        expect(servidor.features).toBe(TOTAL_DE_FEICOES);
        expect(servidor.nomes).toEqual(ACERVO.map(([nome]) => nome).sort());
        expect(servidor.nomes, 'o nome envenenado não chegou ao servidor').not.toContain('Novo Mapa');

        // 2. A TELA DO ATLAS NOVO (B3-12): catorze cartões para catorze mapas, com os nomes certos.
        await page.waitForFunction(
            () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function',
            null, { timeout: 120000 },
        );
        await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
        await expect(page.locator('.maps-tab .map-list-item[data-map-name]').first())
            .toBeVisible({ timeout: 30000 });
        // A LISTA SE ENCHE AOS POUCOS, e ler uma vez só é uma corrida: medido em 2026-09-07, a
        // primeira leitura pegou 6 cartões numa execução e 4 na seguinte, com os catorze chegando
        // logo depois. O `poll` mede o estado em que a lista repousa.
        const lerCartoes = () => page.locator('.maps-tab .map-list-item[data-map-name]')
            .evaluateAll((els) => els.map((el) => el.dataset.mapName));
        await expect.poll(() => lerCartoes().then((l) => l.length), { timeout: 60000 }).toBe(14);
        const cartoes = await lerCartoes();
        expect(cartoes).toHaveLength(14);
        expect(cartoes.filter((n) => n === 'Novo Mapa')).toHaveLength(0);
        for (const [nome] of ACERVO) expect(cartoes).toContain(nome);

        await page.screenshot({ path: testInfo.outputPath('h1-acervo-no-servidor.png'), fullPage: false });
        await testInfo.attach('a aba Mapas do atlas de servidor', {
            path: testInfo.outputPath('h1-acervo-no-servidor.png'), contentType: 'image/png',
        });
        await ctx.close();
    });

    test('o servidor gravando UM MAPA A MENOS vira aviso, e a página NÃO navega', async ({ browser }, testInfo) => {
        test.setTimeout(300000);
        const { ctx, page, nomeDoCartao } = await prepararAcervo(browser, 'h1b');

        // A DIVERGÊNCIA É FORJADA NA BORDA DO NAVEGADOR: o `summary` que o servidor devolve passa a
        // dizer 13 mapas sobre os 14 que subiram. As duas contagens são medidas do MESMO número por
        // caminhos independentes, e duas medidas que discordam indicam defeito, nunca uma escolha
        // entre elas. Sem esta rota o backend do arnês nunca discorda de si mesmo, e o ramo ficaria
        // sem exercício no navegador.
        //
        // SÃO DOIS ENDEREÇOS, E O SEGUNDO É O QUE ESTE GESTO USA HOJE. Até 2026-09-19 havia só
        // `POST /atlas/import`, e a partir da importação atômica `apiClient.importAtlas` delega ao
        // `atomicServerImport` (`frontend/src/js/import_export/atomic-server-import.js`) sempre que
        // o envio leva imagens, que é sempre neste caminho: ele prepara em `POST /atlas/imports` e
        // publica em `POST /atlas/imports/<id>/commit`, e é o commit que devolve o atlas com
        // `summary`. A rota antiga deixou de casar, o `summary` chegava intacto, o envio caía no
        // ramo de SUCESSO e navegava. Medido em 2026-09-19: vermelho 3 de 3, sempre em
        // `.toast--warning` não encontrado, ou seja, apontando para o produto quando o defasado era
        // o instrumento. A rota legada fica porque o ramo sem imagens ainda a usa.
        //
        // E O CONTADOR É O QUE IMPEDE A PRÓXIMA TROCA DE ENDEREÇO DE ACUSAR A PESSOA ERRADA: sem
        // ele, "a forja não rodou" e "o produto não avisa" produzem a MESMA falha, na mesma linha.
        let forjas = 0;
        const forjarDivergencia = async (route) => {
            const resposta = await route.fetch();
            const corpo = await resposta.json();
            if (corpo?.data?.summary) {
                corpo.data.summary.mapsImported = 13;
                forjas += 1;
            }
            await route.fulfill({ response: resposta, body: JSON.stringify(corpo) });
        };
        await page.route('**/atlas/import', forjarDivergencia);
        await page.route(/\/atlas\/imports\/[^/]+\/commit(\?|$)/, forjarDivergencia);

        await enviarPeloCartao(page, nomeDoCartao, 'Acervo Divergente H1');

        // A PREMISSA ANTES DA MEDIÇÃO: a resposta do envio passou por um endereço interceptado e
        // trazia `summary`. Zero aqui é instrumento defasado, nunca produto mudo.
        await expect
            .poll(() => forjas, {
                timeout: 120000,
                message: 'a divergência foi mesmo forjada na resposta do envio; zero significa que '
                    + 'o endereço do import mudou de novo e este caso mediria o nada',
            })
            .toBe(1);

        // O AVISO FICA NA TELA, e é a única coisa que denuncia a divergência.
        const toast = page.locator('.toast--warning');
        await expect(toast).toBeVisible({ timeout: 120000 });
        const texto = await toast.textContent();
        await testInfo.attach('a frase do aviso', { body: texto, contentType: 'text/plain' });
        expect(texto).toMatch(/gravou só 13 mapas dos 14/);
        expect(texto).toContain('14 mapas');

        await page.screenshot({ path: testInfo.outputPath('h1-aviso-sem-navegacao.png') });
        await testInfo.attach('o aviso na lista de atlas', {
            path: testInfo.outputPath('h1-aviso-sem-navegacao.png'), contentType: 'image/png',
        });

        // E A PÁGINA NÃO NAVEGOU: navegar mataria a frase junto com o documento que a desenhou.
        expect(new URL(page.url()).pathname).toMatch(/atlas\.html$/);
        expect(page.url()).not.toMatch(/[?&]atlas=/);
        await ctx.close();
    });

    test('o diálogo que apaga o slot herdado diz que ele é o acervo da versão anterior', async ({ browser }, testInfo) => {
        test.setTimeout(300000);
        const { ctx, page, nomeDoCartao } = await prepararAcervo(browser, 'h1c');

        // EXCLUIR PRECISA DE UM SEGUNDO ATLAS: a API recusa apagar o último, e a recusa chega
        // ANTES do diálogo destrutivo. O segundo nasce pelo botão de verdade, que cria e ABRE, daí
        // a volta para a lista.
        await page.locator('[data-testid="local-atlas-create"]').click();
        await page.locator('[data-testid="local-atlas-name-input"]').fill('Descartável');
        await page.locator('[data-testid="local-atlas-name-confirm"]').click();
        await page.waitForURL((url) => !url.pathname.endsWith('atlas.html'), { timeout: 120000 });
        await page.goto('/atlas.html');
        await expect(page.locator('[data-testid="local-atlas-item"]')).toHaveCount(2, { timeout: 30000 });

        const cartao = cartaoPeloNomeExato(page, nomeDoCartao);
        await cartao.locator('xpath=following-sibling::*[@data-testid="local-atlas-menu"]').click();
        await page.locator('[data-testid="local-atlas-delete"]').click();

        const dialogo = page.locator('.confirm-modal-overlay');
        await expect(dialogo).toBeVisible({ timeout: 20000 });
        const corpo = await dialogo.locator('.confirm-modal-message').textContent();
        await testInfo.attach('o corpo do diálogo', { body: corpo, contentType: 'text/plain' });

        // A IDENTIDADE, que é o que separa este cartão de um atlas em branco de mesmo nome.
        expect(corpo).toMatch(/vers[ãa]o anterior do EBGeo/);
        expect(corpo).toMatch(/único atlas que existia/);
        expect(corpo).toMatch(/\.ebgeo/);
        // E A CONTAGEM, que já existia e continua.
        expect(corpo).toContain('14 mapas');
        expect(corpo).toContain(`${TOTAL_DE_FEICOES} feições`);

        await page.screenshot({ path: testInfo.outputPath('h1-dialogo-slot-herdado.png') });
        await testInfo.attach('o diálogo de exclusão do slot herdado', {
            path: testInfo.outputPath('h1-dialogo-slot-herdado.png'), contentType: 'image/png',
        });

        // CANCELAR, e o acervo continua onde estava: este caso mede a FRASE, não a exclusão.
        await dialogo.locator('.confirm-modal-btn-cancel').click();
        await expect(page.locator('[data-testid="local-atlas-item"]')).toHaveCount(2);
        expect(await lerDisco(page)).toEqual({ maps: 14, features: TOTAL_DE_FEICOES });

        // CONTROLE: o cartão do atlas DESCARTÁVEL não recebe a frase do acervo.
        const outro = cartaoPeloNomeExato(page, 'Descartável');
        await outro.locator('xpath=following-sibling::*[@data-testid="local-atlas-menu"]').click();
        await page.locator('[data-testid="local-atlas-delete"]').click();
        await expect(dialogo).toBeVisible({ timeout: 20000 });
        expect(await dialogo.locator('.confirm-modal-message').textContent())
            .not.toMatch(/vers[ãa]o anterior do EBGeo/);
        await dialogo.locator('.confirm-modal-btn-cancel').click();

        await ctx.close();
    });
});
