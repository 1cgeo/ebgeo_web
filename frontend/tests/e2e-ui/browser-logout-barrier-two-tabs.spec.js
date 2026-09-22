// Path: e2e-ui/browser-logout-barrier-two-tabs.spec.js

/**
 * @fileoverview A BARREIRA DE LOGOUT (`logoutBarrierLockName`) MEDIDA COM DUAS ABAS REAIS.
 *
 * O que já existia: `tests/integration/barreira-de-logout-entre-abas.test.js`, em node, com a
 * "irmã" sendo um lock tomado DIRETAMENTE no `navigator.locks` do mesmo processo, e a fiação do
 * envio asserida por leitura de fonte. `docs/wiki/coordenacao-entre-abas.md` declarava o buraco em
 * voz alta: "Nenhuma corrida de DUAS BROWSERS reais foi medida. O aceite de duas abas editando
 * durante o diálogo é do Playwright". Este arquivo é esse aceite.
 *
 * ---------------------------------------------------------------------------
 * QUEM É A IRMÃ, E POR QUE ELA NÃO TEM INTERFACE
 * ---------------------------------------------------------------------------
 * A barreira é NOMEADA POR ESCOPO REMOTO (`barrierNameFor`, `store/write-coordinator.js`) e o
 * diálogo toma o nome do escopo ATIVO da aba que sai (`confirmLogoutWithPendingWork`). Logo, só é
 * recusada a aba que tem o MESMO atlas de servidor MONTADO.
 *
 * A regra do dono do tab-lock diz que duas abas no mesmo atlas colidem, e a segunda a chegar é
 * BLOQUEADA. A leitura apressada daí é "então a irmã não existe". Ela existe, e a medição é o que
 * mostra: a aba bloqueada MONTA o namespace mesmo assim, porque quem escolhe o escopo do boot é
 * `activateBootAtlasScope` a partir do marcador de ORIGEM da instalação, e isso acontece ANTES de
 * o lock ter ouvido alguém. Sonda desta máquina, com a aba bloqueada de pé:
 *
 *     locks `ebgeo-atlas:#remote-<id>`: ["shared/<clienteA>", "shared/<clienteB>"]
 *     escopo da aba bloqueada:          {kind:"remote", dbSuffix:"remote-<id>"}
 *     runTransaction na aba bloqueada:  {ok:true, corpoRodou:true}
 *
 * Ou seja: DUAS abas escrevendo nos MESMOS dez bancos, que é exatamente o perigo que a barreira
 * existe para arbitrar. E é também o motivo de a escrita da irmã aqui ser dirigida por
 * `runTransaction` e não por um clique: o overlay de bloqueio é `position: fixed; inset: 0`, então
 * não há gesto possível naquela aba. Não é conveniência, é a ausência de uma superfície, e é a
 * mesma razão pela qual `helpers/collab-helpers.js` tem `attemptStoreWriteBlocked`.
 *
 * Também não se usa `addFeature` ali: a aba bloqueada está DESCONECTADA (`applySyncBrake`), e nesse
 * estado `persistOperationIntents` recusa a intenção com OUTRA frase ("a conexão com o atlas do
 * servidor ainda não está pronta"). Uma recusa é a da barreira e a outra não, e medir a errada seria
 * verde pelo motivo errado. `runTransaction` sem operação nenhuma exercita o gate da barreira e mais
 * nada, e `corpoRodou` separa "recusado no portão" de "falhou gravando".
 *
 * ---------------------------------------------------------------------------
 * O INSTRUMENTO QUE NÃO DEPENDE DO MÓDULO SOB TESTE
 * ---------------------------------------------------------------------------
 * `navigator.locks.query()` é do AGENTE DE USUÁRIO e é o mesmo para as duas abas do perfil, então
 * uma aba LÊ o lock que a outra tomou. É com ele que cada caso confirma, por caminho independente
 * do código sob teste, que as duas abas têm o mesmo atlas montado (dois `clientId` distintos em
 * `ebgeo-atlas:#remote-<id>`) e que o diálogo segura `ebgeo-atlas-logout:#remote-<id>` em
 * `exclusive` enquanto está aberto. Os dois nomes são ESCRITOS À MÃO aqui, como o teste de node já
 * faz: derivá-los da mesma função que o produto usa passaria verde com a derivação errada.
 *
 * ---------------------------------------------------------------------------
 * OS CASOS
 * ---------------------------------------------------------------------------
 * L1  o diálogo de saída de uma aba RECUSA a escrita da irmã, NOMEANDO o estado, e cancelar libera
 *     a MESMA escrita. Controle positivo antes (a escrita passa) e depois (volta a passar), sem os
 *     quais "recusou" não se distingue de "aquela aba nunca conseguiu escrever".
 * L2  a escrita EM VOO da irmã atrasa o censo: o exclusivo fica pendente, estoura os 3 s de
 *     `BARRIER_DRAIN_TIMEOUT_MS` e o diálogo passa a dizer que NÃO PÔDE CONTAR. O controle é a
 *     MESMA saída, nas mesmas abas, com a irmã parada: ali o diálogo traz o NÚMERO. A comparação é
 *     RELATIVA (a diferença dos dois tempos), porque um limiar absoluto mediria a máquina.
 * L3  A COBERTURA, e ela é o achado deste arquivo invertido em guarda. A irmã em OUTRO atlas de
 *     servidor está VIVA e tem interface, e desde 2026-09-19 também é recusada, porque o diálogo
 *     passou a tomar a barreira de todo namespace que o censo conta e o descarte marca. Ver o
 *     comentário do caso, que guarda o que ele media antes.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTE ARQUIVO NÃO COBRE
 * ---------------------------------------------------------------------------
 *  - A CONFIRMAÇÃO da saída. Os três casos CANCELAM o diálogo, de propósito: confirmar dispara o
 *    descarte, o aviso de desmontagem e o congelamento da irmã, que são outro assunto e já têm caso
 *    próprio (`browser-multi-tab-teardown-queue.spec.js`, B3). O que se mede aqui é a janela em que
 *    o diálogo está ABERTO.
 *  - O REGIME DEGRADADO (sem `navigator.locks`). Não é alcançável neste runner sem desligar a API
 *    por `addInitScript`, o que mediria um navegador que não é o do produto.
 *  - A ORDEM INTERNA ("a irmã parou ANTES de o exclusivo ser concedido"). O que se assere é o
 *    EFEITO, como em B3: a concessão é evidência de drenagem, e o sinal contrário (estourar o
 *    prazo) é o que L2 mede.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { loginUI, drawPointUI, currentMapName } from './helpers/collab-helpers.js';
import {
    createTabContext,
    closeTabContexts,
    openTab,
    tabDiagnostic,
    readIdbKeys,
    queueDbOf,
    remoteSuffix,
    QUEUE_STORE,
    BLOCK_OVERLAY_SELECTOR,
    BLOCKED_OVERLAY_TITLE,
} from './helpers/two-tabs.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

// A SKIPPED FILE IS NOT A PASSED FILE. Repetido dos dois arquivos irmãos de propósito: este arquivo
// tem de ser rodável sozinho, e uma guarda que mora em outro arquivo não guarda nada então.
test('a bateria da barreira de logout REQUER backend (sem ele, nada aqui roda)', () => {
    if (!state.skip) return;
    expect(
        process.env.EBGEO_E2E_NO_DB,
        'os casos da barreira de logout foram PULADOS por falta de backend. Suba PostgreSQL + '
        + 'PostGIS e rode de novo, ou declare a intenção com EBGEO_E2E_NO_DB=1 para aceitar a '
        + 'rodada sem eles. Um pulo silencioso é verde sem verificação.',
    ).toBeTruthy();
});

/**
 * A FRASE DA RECUSA, copiada e não importada.
 *
 * Mesma razão de `TEARDOWN_OVERLAY_TITLE` em `helpers/two-tabs.js`: um teste que lesse a sentença do
 * módulo sob teste concordaria por construção com uma sentença reescrita. Ela vem de
 * `LOGOUT_BARRIER_NOTICE` (`src/js/store/write-coordinator.js`); ao mexer lá, mexa aqui no MESMO
 * commit. Ela NOMEIA O ESTADO e não o papel, que é a convenção da casa para recusa reversível.
 */
const FRASE_DA_BARREIRA = 'Outra janela está saindo da conta. '
    + 'Aguarde a saída terminar para editar este atlas.';

/** A frase do diálogo quando o censo NÃO pôde ser feito (`pendingWorkSummary` com total não finito). */
const FRASE_CENSO_DESCONHECIDO =
    'Não foi possível verificar se há alterações ainda não enviadas ao servidor.';

/**
 * O pedaço da frase do diálogo quando o censo FOI feito (`pendingWorkSummary` com um total). Cobre
 * "chegou" e "chegaram", e NÃO aparece na frase do censo desconhecido, que é o que o distingue.
 */
const FRASE_CENSO_CONTADO = 'que ainda não cheg';

/**
 * Nome do Web Lock da BARREIRA de um atlas de servidor, escrito à mão.
 * Espelha `logoutBarrierLockName(remoteSuffix(id))` sem importá-lo (ver o cabeçalho).
 * @param {string} atlasId
 * @returns {string}
 */
const nomeDaBarreira = (atlasId) => `ebgeo-atlas-logout:#remote-${atlasId}`;

/**
 * Nome do Web Lock de MONTAGEM de um atlas de servidor, escrito à mão.
 * Espelha `atlasMountLockName(remoteSuffix(id))` sem importá-lo.
 * @param {string} atlasId
 * @returns {string}
 */
const nomeDaMontagem = (atlasId) => `ebgeo-atlas:#remote-${atlasId}`;

/**
 * O que o AGENTE DE USUÁRIO sabe sobre um nome de lock, lido de dentro de uma aba.
 *
 * É a testemunha independente deste arquivo: `navigator.locks` é do perfil, não do documento, então
 * uma aba enxerga o lock que a outra tomou. Lança onde a API não existe, em vez de responder
 * "nenhum lock": uma lista vazia deixaria toda asserção de ausência passar sem medir nada, que é a
 * cobertura vazia que a constituição nomeia (mesma regra de `idbDatabaseNames`).
 * @param {import('@playwright/test').Page} page
 * @param {string} nome
 * @returns {Promise<{held: string[], pending: string[], clientes: number, nomesEbgeo: string[]}>}
 */
async function locksDe(page, nome) {
    const leitura = await page.evaluate(async (n) => {
        if (!navigator.locks || typeof navigator.locks.query !== 'function') return null;
        const snap = await navigator.locks.query();
        const held = snap.held || [];
        const pending = snap.pending || [];
        return {
            held: held.filter((l) => l.name === n).map((l) => l.mode),
            pending: pending.filter((l) => l.name === n).map((l) => l.mode),
            clientes: new Set(held.filter((l) => l.name === n).map((l) => l.clientId)).size,
            nomesEbgeo: [...new Set([...held, ...pending].map((l) => l.name))]
                .filter((x) => x.startsWith('ebgeo-atlas')).sort(),
        };
    }, nome);
    if (leitura === null) {
        throw new Error(
            'navigator.locks.query() não existe neste navegador: a testemunha independente deste '
            + 'arquivo não pode medir, e uma resposta vazia passaria em silêncio.',
        );
    }
    return leitura;
}

/**
 * TODA barreira de logout de pé neste perfil, lida de dentro de uma aba.
 *
 * O irmão de `locksDe` para a pergunta plural, que é a da cobertura: não "o nome N está tomado",
 * e sim "quais nomes estão". Uma asserção sobre a LISTA acusa tanto o namespace que deixou de ser
 * coberto quanto um que passou a ser coberto sem ninguém decidir.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string[]>} `"<modo> <nome>"`, ordenado.
 */
async function barreirasTomadas(page) {
    const lista = await page.evaluate(async () => {
        if (!navigator.locks || typeof navigator.locks.query !== 'function') return null;
        const snap = await navigator.locks.query();
        return (snap.held || []).filter((l) => l.name.startsWith('ebgeo-atlas-logout:'))
            .map((l) => `${l.mode} ${l.name}`).sort();
    });
    if (lista === null) {
        throw new Error(
            'navigator.locks.query() não existe neste navegador: a testemunha independente deste '
            + 'arquivo não pode medir, e uma resposta vazia passaria em silêncio.',
        );
    }
    return lista;
}

/**
 * Registra um usuário e cria `nomes.length` atlas de servidor, cada um com o mapa que o servidor
 * semeia. Duplicado de `browser-multi-tab-teardown-queue.spec.js` pela mesma razão que ELE o duplica
 * do irmão: nenhum dos arquivos pode quebrar a montagem do outro enquanto os dois estão sendo
 * editados.
 * @param {import('@playwright/test').Browser} browser
 * @param {string} baseUrl
 * @param {string[]} nomes
 * @returns {Promise<{username:string,password:string,atlases:Array<{id:string,name:string,mapId:string,mapName:string}>}>}
 */
async function semearUsuarioComAtlas(browser, baseUrl, nomes) {
    const user = await createVerifiedUser({ prefix: 'barreira', nome: 'Barreira de Saída' });
    const page = await browser.newPage();
    await page.goto('/');
    const seed = await page.evaluate(async ({ base, names, u }) => {
        const { ApiClient } = await import('/src/js/store/sync/api-client.js');
        const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
        const api = new ApiClient({ baseUrl: `${base}/api/v1` });
        const { username, password } = u;
        await api.login(username, password);
        const atlases = [];
        for (const name of names) {
            const atlas = await api.createAtlas({ name });
            const mapId = atlas.map_order?.[0];
            if (!mapId) throw new Error('O servidor não criou o mapa inicial do atlas.');
            const mapName = `Mapa ${name}`;
            await api.pushOperations(atlas.id, [createOperation('map', 'update', mapId, null, { name: mapName })]);
            atlases.push({ id: atlas.id, name, mapId, mapName });
        }
        return { username, password, atlases };
    }, { base: baseUrl, names: nomes, u: user });
    await page.close();
    return seed;
}

/** Espera o mapa vivo do MapLibre de uma aba. */
function esperarMapa(page) {
    return page.waitForFunction(
        () => !!(globalThis.__ebgeoMap && globalThis.__ebgeoMap.loaded && globalThis.__ebgeoMap.loaded()),
        null,
        { timeout: 30000 },
    );
}

/**
 * Uma aba só está PRONTA quando o mapa DO ATLAS é o corrente, e não quando a badge diz online: a
 * ativação do mapa do atlas é assíncrona e acontece depois do connect. Mesma espera dos dois
 * arquivos irmãos, pela mesma razão medida.
 * @param {import('@playwright/test').Page} page
 * @param {{mapName: string}} atlas
 */
async function esperarAbaDoAtlas(page, atlas) {
    await expect(page.locator('[data-testid="sync-status-badge"]'))
        .toHaveAttribute('data-state', 'online', { timeout: 30000 });
    await esperarMapa(page);
    await expect
        .poll(() => currentMapName(page), { timeout: 30000, message: 'a aba ativou o mapa do atlas' })
        .toBe(atlas.mapName);
}

/**
 * Bloqueia o ENVIO de uma aba, para que a fila dela acumule em vez de drenar a cada 1,5 s.
 *
 * Só o `POST`: o pull é um GET no mesmo caminho, e bloquear os dois deixaria a aba sem nunca ficar
 * online. Copiado de B2 do arquivo irmão.
 * @param {import('@playwright/test').Page} page
 */
function bloquearEnvio(page) {
    return page.route('**/api/v1/atlas/*/sync**', (route) => (
        route.request().method() === 'POST' ? route.abort('failed') : route.continue()
    ));
}

/**
 * DUAS ABAS COM O MESMO ATLAS DE SERVIDOR MONTADO, que é o único par que a barreira arbitra.
 *
 * A `viva` abre o atlas e ganha a arbitragem; a `irma` chega depois, é BLOQUEADA pelo tab-lock e
 * mesmo assim monta o mesmo namespace, porque o escopo do boot vem do marcador de origem da
 * instalação (ver o cabeçalho). A pré-condição é conferida pela testemunha independente: dois
 * clientes distintos segurando o lock de montagem daquele atlas. Sem ela, um caso em que a irmã
 * simplesmente não tem o atlas montado passaria verde sem medir a barreira.
 * @param {import('@playwright/test').Browser} browser
 * @param {string} nomeDoAtlas
 * @returns {Promise<{seed: Object, X: Object, viva: import('@playwright/test').Page, irma: import('@playwright/test').Page}>}
 */
async function duasAbasNoMesmoAtlas(browser, nomeDoAtlas) {
    const seed = await semearUsuarioComAtlas(browser, state.baseUrl, [nomeDoAtlas]);
    const [X] = seed.atlases;

    const ctx = await createTabContext(browser, state.baseUrl);
    const viva = await openTab(ctx, '/');
    await loginUI(viva, seed.username, seed.password);
    await viva.locator(`[data-testid="project-picker-item"][data-atlas-id="${X.id}"]`).click();
    await esperarAbaDoAtlas(viva, X);

    const irma = await openTab(ctx, `/?atlas=${X.id}`);
    await expect(irma.locator(BLOCK_OVERLAY_SELECTOR), 'a segunda aba no MESMO atlas é bloqueada')
        .toBeVisible({ timeout: 30000 });
    await expect(irma.locator('.tab-lock-overlay__title')).toHaveText(BLOCKED_OVERLAY_TITLE);

    // A PRÉ-CONDIÇÃO SEM A QUAL TODO O RESTO É COBERTURA VAZIA, e ela é lida do agente de usuário,
    // não do módulo: duas montagens vivas do MESMO namespace.
    await expect
        .poll(async () => (await locksDe(irma, nomeDaMontagem(X.id))).clientes, {
            timeout: 20000,
            message: `as DUAS abas precisam ter ${X.id} montado para que a barreira tenha o que arbitrar`,
        })
        .toBeGreaterThanOrEqual(2);

    // E A IRMÃ PRECISA TER TERMINADO O PRÓPRIO BOOT, senão o caso mede a recusa ERRADA. MEDIDO:
    // logo depois de o overlay aparecer, a irmã ainda está aplicando o retrato, e `beginStoreWrite`
    // recusa por `STORE_RECOVERY_NOTICE` (a pausa POR ABA), que chega como a mesma forma externa da
    // recusa da barreira: `ok:false` com o corpo sem rodar. A diferença é a frase e o evento (a
    // pausa por aba lança SEM emitir `STORE_OPERATION_BLOCKED`), e é por isso que o controle
    // positivo é uma ESCRITA QUE PASSA, e não uma leitura de estado: ele só fecha quando a aba está
    // de fato livre para escrever.
    await expect
        .poll(async () => (await tentarEscrita(irma, 'aquecimento')).ok, {
            timeout: 30000,
            message: 'a aba irmã terminou a própria recuperação e consegue escrever (sem isso, a '
                + 'recusa medida abaixo seria a da pausa por aba, não a da barreira)',
        })
        .toBe(true);

    return { seed, X, viva, irma };
}

/**
 * UMA TENTATIVA DE ESCRITA PELO FUNIL ÚNICO DA STORE, sem operação nenhuma no diário.
 *
 * `runTransaction` pergunta à barreira ANTES de preparar coisa alguma, então o corpo só roda se a
 * escrita foi admitida: `corpoRodou` é o que separa "recusado no portão" de "falhou gravando", e sem
 * ele um erro de persistência seria lido como a recusa da barreira.
 *
 * O evento é escutado no barramento REAL da aba (`store/index.js`), e não numa instância própria: é
 * o mesmo caminho que `helpers/collab-helpers.js` usa para ouvir recusa de desenho.
 * @param {import('@playwright/test').Page} page
 * @param {string} rotulo
 * @returns {Promise<{ok: boolean, erro: string|null, corpoRodou: boolean, bloqueios: string[]}>}
 */
function tentarEscrita(page, rotulo) {
    return page.evaluate(async (label) => {
        const store = await import('/src/js/store/index.js');
        const { runTransaction } = await import('/src/js/store/store-transaction.js');
        const bus = store.getEventBus?.();
        const bloqueios = [];
        const ouvinte = (payload) => {
            bloqueios.push(`${payload?.operation ?? '?'}: ${payload?.reason ?? payload?.error ?? ''}`);
        };
        const desinscrever = bus?.on?.(store.StoreErrorEvents.STORE_OPERATION_BLOCKED, ouvinte);
        let corpoRodou = false;
        try {
            await runTransaction(async () => {
                corpoRodou = true;
                return async () => {};
            });
            return { ok: true, erro: null, corpoRodou, bloqueios, rotulo: label };
        } catch (e) {
            return { ok: false, erro: String(e?.message ?? e), corpoRodou, bloqueios, rotulo: label };
        } finally {
            if (typeof desinscrever === 'function') desinscrever();
            else bus?.off?.(store.StoreErrorEvents.STORE_OPERATION_BLOCKED, ouvinte);
        }
    }, rotulo);
}

/**
 * Começa uma escrita REAL e a deixa presa dentro da transação, isto é, com a meia-barreira `shared`
 * tomada. É o que uma irmã gravando uma feição grande faz por si.
 *
 * A espera é pelo CORPO ter entrado, que só acontece depois de a barreira ser admitida: esperar por
 * relógio seria esperar a máquina.
 * @param {import('@playwright/test').Page} page
 */
async function prenderEscrita(page) {
    await page.evaluate(() => {
        window.__ebgeoBarreiraEntrou = false;
        const presa = new Promise((resolve) => { window.__ebgeoBarreiraSolta = resolve; });
        window.__ebgeoEscritaLonga = (async () => {
            const { runTransaction } = await import('/src/js/store/store-transaction.js');
            return runTransaction(async () => {
                window.__ebgeoBarreiraEntrou = true;
                await presa;
                return async () => {};
            });
        })().then(() => 'ok', (e) => `erro: ${String(e?.message ?? e)}`);
    });
    await page.waitForFunction(() => window.__ebgeoBarreiraEntrou === true, null, { timeout: 20000 });
}

/**
 * Solta a escrita presa e devolve o desfecho dela.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string>} 'ok' ou a mensagem do erro.
 */
async function soltarEscrita(page) {
    await page.evaluate(() => { window.__ebgeoBarreiraSolta?.(); });
    return page.evaluate(() => window.__ebgeoEscritaLonga);
}

/**
 * Abre o diálogo de saída pela interface e MEDE quanto tempo ele levou para aparecer, sem responder
 * nada.
 *
 * O tempo é a metade que L2 usa: o diálogo só nasce depois de `holdLogoutBarrier` devolver, e essa
 * espera é cross-document. A medição vai do clique até a chegada do elemento ao DOM, e não até ele
 * ficar visível, porque a transição de opacidade é tempo de animação e não de arbitragem.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ms: number, mensagem: string}>}
 */
async function abrirDialogoDeSaida(page) {
    await page.locator('[data-testid="account-control"] .account-control__identity').click();
    const sair = page.locator('[data-testid="account-logout-btn"]');
    await expect(sair).toBeVisible({ timeout: 10000 });

    const inicio = Date.now();
    await sair.click();
    await page.waitForSelector('.confirm-modal-overlay .confirm-modal-message', {
        state: 'attached', timeout: 30000,
    });
    const ms = Date.now() - inicio;
    // `textContent` E NAO `innerText`, e a diferenca custou uma rodada: `innerText` e a
    // representacao RENDERIZADA, e o modal nasce com `data-visible="false"` e so fica visivel no
    // rAF seguinte, entao a leitura voltava STRING VAZIA e a assercao sobre a frase reprovava com
    // "Received: ''", apontando para o produto. O DOM ja tem o texto no instante em que o elemento
    // e anexado, que e o mesmo instante que o relogio acima mede.
    const mensagem = await page.locator('.confirm-modal-overlay .confirm-modal-message').textContent();
    return { ms, mensagem: mensagem ?? '' };
}

/** Responde "Continuar no EBGeo": a sessão fica de pé e a barreira é solta. */
async function cancelarDialogo(page) {
    await page.locator('.confirm-modal-overlay .confirm-modal-btn-cancel').click();
    await expect(page.locator('.confirm-modal-overlay')).toHaveCount(0, { timeout: 15000 });
    await expect(
        page.locator('[data-testid="account-login-btn"]'),
        'cancelar NÃO encerra a sessão (o botão "Entrar" continua escondido)',
    ).toBeHidden({ timeout: 10000 });
}

/**
 * Enche a fila de saída do atlas pelo GESTO REAL, com o envio bloqueado, para que o diálogo de saída
 * tenha pendência a contar. Sem pendência e com o censo drenado, `confirmLogoutWithPendingWork` não
 * pergunta nada e sai direto, e não haveria diálogo para medir.
 * @param {import('@playwright/test').Page} page
 * @param {string} atlasId
 * @param {[number, number]} lngLat
 */
async function deixarPendencia(page, atlasId, lngLat) {
    await bloquearEnvio(page);
    const ponto = await drawPointUI(page, lngLat);
    expect(ponto, 'a aba desenhou o ponto que vai ficar pendente').toBeTruthy();
    await page.keyboard.press('Escape');
    await expect
        .poll(async () => (await readIdbKeys(page, queueDbOf(remoteSuffix(atlasId)), QUEUE_STORE)).keys.length,
            { timeout: 20000, message: 'o desenho ficou pendente na fila do atlas' })
        .toBeGreaterThan(0);
    return ponto;
}

describeOrSkip('Duas abas, uma saindo da conta: a barreira de logout', () => {
    // UMA CORRIDA REAL ENTRE DUAS ABAS NUNCA PODE SER RELATADA COMO "flaky", que é um verde. Mesma
    // razão dos dois arquivos irmãos, e tem de ser repetida por describe: `retries` é configurado,
    // não herdado de outro arquivo.
    test.describe.configure({ retries: 0 });

    test.afterEach(closeTabContexts);

    test('L1 — o diálogo de saída RECUSA a escrita da aba irmã, e cancelar a libera', async ({ browser }, testInfo) => {
        test.setTimeout(240000);

        const { X, viva, irma } = await duasAbasNoMesmoAtlas(browser, 'Barreira L1');

        // --- CONTROLE POSITIVO, ANTES de qualquer disputa: a irmã escreve. Sem ele, "recusou" não
        //     se distingue de "aquela aba nunca conseguiu escrever nada", que é o desfecho mais
        //     provável de uma montagem quebrada. ---
        // `erro: null` entra na forma esperada para que uma reprovação IMPRIMA a frase recebida: sem
        // ele o diff mostra só `ok:false`, e as duas recusas possíveis aqui (a pausa por aba e a
        // barreira) têm a mesma forma externa e frases diferentes.
        const antes = await tentarEscrita(irma, 'antes do diálogo');
        expect(antes, 'a aba irmã escreve normalmente ANTES de o diálogo existir')
            .toMatchObject({ ok: true, corpoRodou: true, bloqueios: [], erro: null });

        // --- CONTROLE NEGATIVO DA TESTEMUNHA: ninguém segura a barreira ainda. Um leitor que
        //     respondesse "exclusive" para qualquer nome deixaria a asserção seguinte passar de
        //     graça. ---
        const barreiraOciosa = await locksDe(irma, nomeDaBarreira(X.id));
        expect(barreiraOciosa.held, 'a barreira não está tomada antes de alguém pedir a saída')
            .toEqual([]);

        await deixarPendencia(viva, X.id, [-43.2, -22.9]);

        // --- O ATO: a aba viva pede a saída, e PARA no diálogo. ---
        const dialogo = await abrirDialogoDeSaida(viva);
        await testInfo.attach('L1 a frase do diálogo', {
            body: `${dialogo.ms} ms\n${dialogo.mensagem}`, contentType: 'text/plain',
        });
        expect(
            dialogo.mensagem,
            'o censo FOI feito (a irmã estava parada, então o exclusivo foi concedido): o diálogo '
            + 'traz o número, e não a frase de "não foi possível verificar"',
        ).toContain(FRASE_CENSO_CONTADO);

        // --- 1. A TESTEMUNHA INDEPENDENTE, lida da OUTRA aba: o exclusivo está de pé. ---
        const durante = await locksDe(irma, nomeDaBarreira(X.id));
        await testInfo.attach('L1 locks vistos pela aba irmã com o diálogo aberto', {
            body: JSON.stringify(durante, null, 2), contentType: 'application/json',
        });
        expect(
            durante.held,
            'com o diálogo aberto, a aba irmã ENXERGA o exclusivo da barreira daquele atlas',
        ).toEqual(['exclusive']);

        // --- 2. E A ESCRITA DA IRMÃ É RECUSADA, NOMEANDO O ESTADO. ---
        const recusada = await tentarEscrita(irma, 'durante o diálogo');
        await testInfo.attach('L1 a tentativa de escrita da irmã', {
            body: JSON.stringify(recusada, null, 2), contentType: 'application/json',
        });
        expect(recusada.ok, 'a escrita da irmã é recusada enquanto o diálogo está aberto').toBe(false);
        expect(recusada.erro, 'a recusa carrega a frase que NOMEIA o estado').toContain(FRASE_DA_BARREIRA);
        expect(
            recusada.corpoRodou,
            'a recusa acontece NO PORTÃO: o corpo da transação nem chega a rodar, então isto não é '
            + 'uma falha de persistência com outro nome',
        ).toBe(false);
        expect(
            recusada.bloqueios.join(' | '),
            'a recusa esperada chega como STORE_OPERATION_BLOCKED no barramento, com a mesma frase',
        ).toContain(FRASE_DA_BARREIRA);

        // --- 3. CANCELAR SOLTA. A mesma escrita, na mesma aba, passa em seguida. ---
        await cancelarDialogo(viva);
        await expect
            .poll(async () => (await locksDe(irma, nomeDaBarreira(X.id))).held.length,
                { timeout: 15000, message: 'cancelar soltou a barreira' })
            .toBe(0);

        const depois = await tentarEscrita(irma, 'depois de cancelar');
        expect(depois, 'cancelar o diálogo libera a MESMA escrita que ele recusava')
            .toMatchObject({ ok: true, corpoRodou: true, bloqueios: [], erro: null });

        // A irmã continua sendo a irmã: se ela tivesse virado outra coisa (caído no seletor,
        // recarregado), "voltou a escrever" seria afirmação sobre outro sujeito.
        const diag = await tabDiagnostic(irma);
        await testInfo.attach('L1 a aba irmã no fim', {
            body: JSON.stringify(diag, null, 2), contentType: 'application/json',
        });
        expect(diag, 'a irmã seguiu na página do mapa, bloqueada e montada, o tempo todo')
            .toMatchObject({ page: 'mapa', blocked: true });
    });

    test('L2 — a escrita EM VOO da irmã atrasa o censo, e o diálogo diz que não pôde contar', async ({ browser }, testInfo) => {
        test.setTimeout(240000);

        const { X, viva, irma } = await duasAbasNoMesmoAtlas(browser, 'Barreira L2');
        await deixarPendencia(viva, X.id, [-43.21, -22.91]);

        // --- O CONTROLE VEM PRIMEIRO, NAS MESMAS ABAS: com a irmã parada, o exclusivo é concedido
        //     na hora e o diálogo traz o NÚMERO. É contra este tempo, e não contra um absoluto, que
        //     a espera do segundo caso é medida: um limiar em milissegundos mediria a máquina, e
        //     esta máquina já mostrou que o instrumento erra por aí. ---
        const semIrma = await abrirDialogoDeSaida(viva);
        await testInfo.attach('L2 diálogo com a irmã PARADA', {
            body: `${semIrma.ms} ms\n${semIrma.mensagem}`, contentType: 'text/plain',
        });
        expect(semIrma.mensagem, 'com a irmã parada, o censo acontece e o diálogo traz o número')
            .toContain(FRASE_CENSO_CONTADO);
        await cancelarDialogo(viva);

        // --- O ATO: a irmã começa uma escrita e NÃO a termina. ---
        await prenderEscrita(irma);
        const compartilhado = await locksDe(viva, nomeDaBarreira(X.id));
        await testInfo.attach('L2 locks vistos pela aba que vai sair, com a irmã escrevendo', {
            body: JSON.stringify(compartilhado, null, 2), contentType: 'application/json',
        });
        expect(
            compartilhado.held,
            'a irmã está com a meia-barreira `shared` tomada, e a aba que vai sair enxerga isso',
        ).toEqual(['shared']);

        const comIrma = await abrirDialogoDeSaida(viva);
        await testInfo.attach('L2 diálogo com a irmã ESCREVENDO', {
            body: `${comIrma.ms} ms\n${comIrma.mensagem}`, contentType: 'text/plain',
        });
        expect(
            comIrma.mensagem,
            'o exclusivo não foi concedido dentro do prazo, então a contagem fica DESCONHECIDA e o '
            + 'diálogo diz isso em vez de imprimir um número que ele não pôde medir',
        ).toContain(FRASE_CENSO_DESCONHECIDO);
        expect(
            comIrma.ms - semIrma.ms,
            `a saída ESPEROU pela irmã: ${comIrma.ms} ms com ela escrevendo contra ${semIrma.ms} ms `
            + 'com ela parada (o prazo de drenagem é de 3 s)',
        ).toBeGreaterThanOrEqual(2000);

        await cancelarDialogo(viva);

        // --- A ESCRITA DA IRMÃ NÃO FOI PERDIDA: ela estava EM VOO, não recusada. Sem isto, o atraso
        //     acima poderia ter saído de uma transação que morreu no meio. ---
        const desfecho = await soltarEscrita(irma);
        expect(desfecho, 'a escrita que estava em voo termina normalmente depois de solta').toBe('ok');
    });

    test('L3 — a irmã VIVA em outro atlas de servidor também é barrada (a cobertura do censo)', async ({ browser }, testInfo) => {
        // ESTE CASO NASCEU MEDINDO O CONTRÁRIO, e a inversão é a decisão de 2026-09-19.
        //
        // O que ele achou: a barreira era nomeada por ESCOPO e o diálogo tomava o nome do escopo
        // ATIVO da aba que sai, enquanto o CENSO do mesmo diálogo conta `listRemoteAtlases()`
        // INTEIRO e `requestRemoteAtlasDiscard()` marca todos. Cruzado com a regra do dono do
        // tab-lock, a guarda apontava para o lado errado: a irmã que a barreira recusava era sempre
        // a BLOQUEADA, atrás de um overlay de tela inteira e sem gesto possível (é o caso L1), e a
        // que ela deixava passar era esta, VIVA em outro atlas de servidor, com barra de
        // ferramentas. Medido aqui antes do conserto: com o diálogo aberto, ela desenhava um ponto
        // pela UI e a fila dela crescia depois do censo já impresso.
        //
        // O dono decidiu BARRAR TODOS OS NAMESPACES DO CENSO, então o caso virou guarda e hoje
        // exige a RECUSA. O controle negativo é devolver a cobertura ao escopo ativo (trocar
        // `barrierScopesFor(entries, remote)` por `[remote]` em `session/confirm-logout.js`), e
        // nesse estado ele reprova.
        //
        // O GESTO REAL DE UI FICA NAS DUAS BORDAS DA JANELA, e não dentro dela, por uma razão de
        // instrumento: `drawPointUI` espera 20 s pela feição e só então lança um diagnóstico longo,
        // então usá-lo para medir uma recusa custaria 20 s e produziria um vermelho com cara de
        // ferramenta quebrada. Dentro da janela mede-se o funil (`runTransaction`), que é por onde
        // aquele desenho passaria; fora dela, o desenho de verdade, que é o que prova que a recusa
        // foi da barreira e não da aba.
        test.setTimeout(240000);

        const seed = await semearUsuarioComAtlas(browser, state.baseUrl, ['Barreira L3 X', 'Barreira L3 Y']);
        const [X, Y] = seed.atlases;

        const ctx = await createTabContext(browser, state.baseUrl);
        const queSai = await openTab(ctx, '/');
        await loginUI(queSai, seed.username, seed.password);
        await queSai.locator(`[data-testid="project-picker-item"][data-atlas-id="${X.id}"]`).click();
        await esperarAbaDoAtlas(queSai, X);

        // Dois atlas de servidor DISTINTOS não colidem desde 2026-08-15: as duas abas ficam vivas.
        const irma = await openTab(ctx, `/?atlas=${Y.id}`);
        await esperarAbaDoAtlas(irma, Y);
        await expect(irma.locator(BLOCK_OVERLAY_SELECTOR), 'a irmã em OUTRO atlas não é bloqueada')
            .toBeHidden();

        await deixarPendencia(queSai, X.id, [-43.22, -22.92]);
        const filaY = queueDbOf(remoteSuffix(Y.id));
        // O DESENHO REAL DA IRMÃ, ANTES DA JANELA: ele é o controle positivo do caminho de UI (a
        // ferramenta está armada e a store aceita) e é o que deixa pendência em Y para o censo
        // contar. Sem ele, "a irmã foi recusada" não se distingue de "aquela aba não desenhava".
        await deixarPendencia(irma, Y.id, [-43.23, -22.93]);
        const filaAntes = (await readIdbKeys(irma, filaY, QUEUE_STORE)).keys.length;

        // --- CONTROLE NEGATIVO DA TESTEMUNHA: nenhuma barreira de pé antes de alguém pedir a saída. ---
        const antesDoDialogo = await barreirasTomadas(irma);
        expect(antesDoDialogo, 'nenhuma barreira está tomada antes do gesto de saída').toEqual([]);

        // --- O diálogo da aba que sai. ---
        const dialogo = await abrirDialogoDeSaida(queSai);
        await testInfo.attach('L3 a frase do diálogo', {
            body: `${dialogo.ms} ms\n${dialogo.mensagem}`, contentType: 'text/plain',
        });

        // --- 1. A TESTEMUNHA: o exclusivo existe para os DOIS atlas, porque os dois estão no
        //     censo que o diálogo acabou de contar e que o descarte marcaria. ---
        const barreiras = await barreirasTomadas(irma);
        await testInfo.attach('L3 barreiras tomadas com o diálogo aberto', {
            body: barreiras.join('\n'), contentType: 'text/plain',
        });
        expect(barreiras, 'a barreira do atlas ATIVO da aba que sai está de pé')
            .toContain(`exclusive ${nomeDaBarreira(X.id)}`);
        expect(
            barreiras,
            'e a do atlas da IRMÃ também: a cobertura é a lista do censo, não o escopo ativo',
        ).toContain(`exclusive ${nomeDaBarreira(Y.id)}`);

        // --- 2. E A ESCRITA DA IRMÃ VIVA É RECUSADA, NOMEANDO O ESTADO. É o funil por onde o
        //     desenho passaria; ver o comentário do caso sobre por que não é o desenho aqui. ---
        const recusada = await tentarEscrita(irma, 'durante o diálogo, em outro atlas');
        await testInfo.attach('L3 a tentativa de escrita da irmã viva', {
            body: JSON.stringify(recusada, null, 2), contentType: 'application/json',
        });
        expect(recusada.ok, 'a irmã viva em outro atlas de servidor é recusada').toBe(false);
        expect(recusada.erro, 'a recusa carrega a frase que NOMEIA o estado').toContain(FRASE_DA_BARREIRA);
        expect(recusada.corpoRodou, 'a recusa acontece no portão').toBe(false);
        expect(
            recusada.bloqueios.join(' | '),
            'a recusa chega como STORE_OPERATION_BLOCKED no barramento, com a mesma frase',
        ).toContain(FRASE_DA_BARREIRA);

        // --- 3. E A FILA DELA NÃO CRESCEU DEPOIS DO CENSO, que é a propriedade que a contagem do
        //     diálogo estava prometendo sem ter. ---
        const filaDurante = (await readIdbKeys(irma, filaY, QUEUE_STORE)).keys.length;
        expect(
            filaDurante,
            'nada entrou na fila da irmã entre o censo e a resposta do diálogo',
        ).toBe(filaAntes);

        // --- 4. CANCELAR SOLTA OS DOIS, e o caminho de UI da irmã volta a funcionar. Sem esta
        //     metade, uma soltura parcial deixaria o atlas da irmã recusando escrita para sempre,
        //     sem diálogo nenhum de pé para explicar. ---
        await cancelarDialogo(queSai);
        await expect
            .poll(async () => (await barreirasTomadas(irma)).length,
                { timeout: 15000, message: 'cancelar soltou as barreiras dos DOIS atlas' })
            .toBe(0);

        const depoisDoCancelamento = await drawPointUI(irma, [-43.24, -22.94]);
        await irma.keyboard.press('Escape');
        expect(depoisDoCancelamento, 'a irmã volta a desenhar pela UI depois do cancelamento')
            .toBeTruthy();
        await expect
            .poll(async () => (await readIdbKeys(irma, filaY, QUEUE_STORE)).keys.length,
                { timeout: 20000, message: 'o desenho de depois do cancelamento entrou na fila de Y' })
            .toBeGreaterThan(filaAntes);
        await testInfo.attach('L3 fila de Y ao longo da janela', {
            body: `antes=${filaAntes} durante=${filaDurante}\nfrase do diálogo: ${dialogo.mensagem}`,
            contentType: 'text/plain',
        });
    });
});
