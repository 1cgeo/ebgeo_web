// Path: e2e-ui/browser-collab-mapa-fantasma.spec.js

/**
 * @fileoverview O MAPA FANTASMA: a marca do resolvedor que nunca volta (D1) e os dois gatilhos
 * que ela transforma em perda de dado (G1 e G2).
 *
 * D1, A MARCA QUE NUNCA VOLTA. `mapResolver.clear()` zera os dois indices E poe
 * `_initialized = false`; so' `initialize()` devolve a marca. A ATIVAÇAO DE UM RETRATO
 * (`applyRemoteSnapshot`, `store/sync/remote-operation-handler.js`) limpava e re-registrava par a
 * par, sem repor a marca: o indice ficava CHEIO e a marca FALSA pelo resto da sessao, a cada
 * retrato. Tres leitores consultam a marca e mudam de comportamento com ela: `getMap` e
 * `_resolveMapKey` (`store/repositories/local.repository.js`) desligam a via rapida nome->id e
 * caem na varredura que casa `mapData.name`, e `_resolveSettingsKey`
 * (`store/repositories/index.js`) passa a gravar a contagem de cores sob o NOME em vez do id.
 * Como TODA abertura de atlas de servidor aplica um retrato, a marca estava falsa em toda sessao
 * remota: o caso (D1) mede isso sem gatilho nenhum.
 *
 * A DIVERGENCIA QUE VIRA FANTASMA. Quando `memoryStore.currentMap` nomeia um mapa cujo registro
 * no disco atende por OUTRO nome (ou nao existe mais), a leitura devolve um documento VAZIO de
 * compatibilidade e a gravacao seguinte crava um registro novo com a CHAVE igual ao nome: o mapa
 * fantasma. A feicao some do mapa do atlas e a op morre na fila, sem erro em lugar nenhum. O
 * gatilho do rename AO VIVO foi fechado em 2026-09-21 (`MAP_RENAMED_REMOTELY` mais
 * `applyRemoteMapRename`); os dois que este arquivo mede continuavam de pe:
 *
 *   (G1) um RETRATO no meio da sessao em que o mapa aberto foi renomeado enquanto a aba estava
 *        desconectada. O disco troca de nome, `currentMap` nao.
 *   (G2) o mapa aberto e' EXCLUIDO por um colega e a pessoa desenha em seguida.
 *
 * O (G2) TEM DOIS CASOS, E A DIFERENÇA ENTRE ELES E' O ACHADO. O desvio que tira a pessoa de um
 * mapa excluido morava so' na ABA MAPAS (o ramo de exclusao de `_onRemoteOperation`, REMOVIDO no mesmo dia por ter ficado redundante), e as
 * abas da barra lateral sao construidas SOB DEMANDA (`SidebarControl._getTabContent`): com a aba
 * aberta o produto ja' acertava, e sem ela (o estado normal de quem so' desenha) a aba ficava no
 * mapa morto, sem aviso, e cada feiçao desenhada era recusada. Medido nos dois, em 2026-09-21.
 *
 * COMO O (G1) E' PRODUZIDO SEM PODER NADA POR DENTRO. O retrato do meio da sessao e' real e tem
 * caminho declarado: o servidor responde `isSnapshot` a um `sync_request` cujo `sinceVersion` e'
 * menor que o `min_version` do atlas (`pullOperations`, `backend/src/modules/sync/sync.service.js`),
 * isto e', a aba ficou fora tempo suficiente para o servidor ter PODADO as operacoes que ela
 * perdeu. Este arquivo produz exatamente isso: B cai da rede, A renomeia o mapa, um
 * ADMINISTRADOR chama `POST /atlas/:id/sync/admin/cleanup`, e B volta. A cauda que carregaria o
 * rename nao existe mais, entao o rename chega SO' pelo retrato. Nada e' escrito dentro da
 * pagina, e nenhum campo interno e' forcado.
 *
 * E A QUEDA DE REDE PRECISA SER LONGA, senao o caso mede outra coisa. A primeira versao deste
 * arquivo usou a janela de 1,5 s do spec de reconexao e o socket do WebSocket para o loopback
 * SOBREVIVEU a ela: o frame do rename foi entregue quando a rede voltou, o caminho AO VIVO (ja'
 * consertado) re-chaveou tudo, e o retrato chegou depois, sem nada para reconciliar. O caso
 * passava por engano. Hoje a queda e' reconhecida pela TRANSIÇAO de conexao e a pre-condiçao do
 * caso afirma que a geraçao ativa MUDOU, que e' a prova independente de que um retrato aconteceu.
 *
 * O retrato do par e' impresso no stdout ANTES das asserçoes, para que o vermelho de um item nao
 * esconda a medicao dos outros (mesma forma de `browser-collab-rename-remoto.spec.js`, de onde
 * vem a fixture, os ajudantes de retrato e as duas armadilhas de driver do cabecalho dele: a aba
 * Mapas e' um ALTERNADOR, e o campo de nome e' reescrito por toda passada de carga).
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test browser-collab-mapa-fantasma --retries=0 --reporter=line
 */

import { collabTest, expect, currentMapName, drawLineUI, readFeatures } from './helpers/collab.fixtures.js';
import { waitForRemoteEntity } from './helpers/trace-helpers.js';
import { createVerifiedUser } from './helpers/accounts.js';

const SHARED_MAP = 'Mapa Tático';
const SECOND_MAP = 'Mapa Secundário';
const NOVO_NOME = 'Mapa Renomeado';

/**
 * Abre a aba Mapas e espera ela ficar PRONTA, que e' mais do que o campo existir.
 *
 * O BOTAO DA ABA E' UM ALTERNADOR: clicar nele com a aba JA' ativa COLAPSA a barra lateral, e o
 * retrato sai com `campoDeNome: null` e a lista VAZIA, que se le como "a tela nao repintou".
 */
async function abrirAbaMapas(page) {
    const input = page.locator('.maps-tab #current-map-name-input');
    if (!(await input.isVisible().catch(() => false))) {
        await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    }
    await expect(input).toBeVisible({ timeout: 15000 });
    await expect(input).not.toHaveValue('', { timeout: 15000 });
    await expect
        .poll(() => page.locator('.maps-tab .map-list-item').count(),
            { timeout: 15000, message: 'a lista de mapas nunca desenhou um cartao' })
        .toBeGreaterThan(0);
}

/**
 * Renomeia o mapa ATUAL pelo campo de nome do cartao de cabecalho (o handler esta no `blur`).
 *
 * O GESTO E' REENVIADO ate' tomar: toda op de sync que chega dispara `_loadMaps`, que reescreve o
 * valor do campo, e um `fill` que caia nessa janela e' perdido sem erro.
 */
async function renomearMapaAtualUI(page, novoNome) {
    await abrirAbaMapas(page);
    await expect.poll(async () => {
        if (await currentMapName(page) === novoNome) return novoNome;
        const input = page.locator('.maps-tab #current-map-name-input');
        await input.fill(novoNome).catch(() => { /* re-render no meio: a proxima volta reenvia */ });
        await input.press('Enter').catch(() => {});
        return currentMapName(page);
    }, { timeout: 30000, message: 'o autor nao adotou o nome novo' }).toBe(novoNome);
}

/** Cria um mapa pela UI real da aba Mapas (criar torna o mapa novo o ativo). */
async function criarMapaUI(page, nome) {
    await abrirAbaMapas(page);
    await page.locator('[data-testid="maps-new-map"]').click();
    const input = page.locator('.prompt-modal-input');
    await expect(input).toBeVisible({ timeout: 5000 });
    await input.fill(nome);
    await page.locator('.prompt-modal-btn-confirm').click();
    await expect(input).toBeHidden({ timeout: 5000 });
    await expect(page.locator(`.maps-tab .map-list-item[data-map-name="${nome}"]`)).toBeVisible({ timeout: 10000 });
}

/**
 * Exclui um mapa pelo menu do cartao dele (o gesto real: menu -> Deletar -> confirmar).
 *
 * O menu por mapa e' remontado a cada `_loadMaps`, entao o clique no cartao e no item sao
 * REENVIADOS pela mesma razao do rename: um clique resolvido contra um no' ja' destacado nao
 * levanta erro e nao faz nada.
 */
async function excluirMapaUI(page, nome) {
    await abrirAbaMapas(page);
    const linha = page.locator(`.maps-tab .map-list-item[data-map-name="${nome}"]`);
    await expect(linha).toBeVisible({ timeout: 15000 });
    // UM clique so' no botao do menu: ele e' um ALTERNADOR e `_showContextMenu` e' assincrona
    // (le' a trava e a lista antes de montar). A primeira versao deste ajudante re-clicava a cada
    // volta de um `poll`, e o que ela fazia era abrir e FECHAR o menu para sempre.
    await linha.locator('.map-list-action-btn.menu-btn').click();
    const item = page.locator('.map-context-menu-item').filter({ hasText: 'Deletar' });
    await expect(item, 'o comando Deletar nao apareceu no menu do mapa').toBeVisible({ timeout: 10000 });
    // O handler REMOVE o proprio menu, entao `click()` tentaria de novo ao ver o alvo sumir no
    // meio do gesto (a armadilha esta em `.claude/rules/testing.md`).
    await item.first().evaluate((el) => el.click());
    const overlay = page.locator('.confirm-modal-overlay');
    await expect(overlay, 'o dialogo de confirmacao de exclusao nunca abriu').toBeVisible({ timeout: 10000 });
    await page.locator('.confirm-modal-btn-confirm').click();
    await expect(overlay).toHaveCount(0, { timeout: 10000 });
}

/**
 * Derruba a conexao do jeito que a rede a derruba, e ESPERA o app NOTAR antes de devolve-la.
 *
 * A JANELA E' LONGA DE PROPOSITO, e a medicao esta em
 * `frontend/tests/e2e-ui/browser-collab-imagem-retomada.spec.js`: o socket do WebSocket para o
 * loopback SOBREVIVE a' emulaçao de offline, e o que acusa a queda e' um PONG que nao volta, com
 * batimento de 25 s e dois ticks ate' fechar. A primeira versao DESTE arquivo usou a janela de
 * 1,5 s do spec de reconexao e mediu outra coisa: a conexao nunca caiu, o frame do rename foi
 * entregue quando a rede voltou, e o que se mediu foi o caminho AO VIVO (ja' consertado), nao o
 * retrato. O reconhecimento e' pela TRANSIÇAO, e nao pelo estado final, porque "esta online" e'
 * verdade tambem para uma conexao que nunca caiu.
 */
async function quedaEVoltaDaConexao(page, janelaMs = 55000) {
    await page.evaluate(async () => {
        const { connectionState } = await import('/src/js/store/sync/connection-state.js');
        globalThis.__ebgeoTransicoes = [];
        if (globalThis.__ebgeoOuveConexao) return;
        globalThis.__ebgeoOuveConexao = true;
        connectionState.onStateChanged((e) => {
            globalThis.__ebgeoTransicoes?.push(`${e.previousState}->${e.currentState}`);
        });
    });
    await page.context().setOffline(true);
    await page.waitForTimeout(janelaMs);
    await page.context().setOffline(false);
    await expect
        .poll(() => page.evaluate(() => globalThis.__ebgeoTransicoes ?? []), {
            timeout: 120000,
            message: 'a conexao nao voltou a ONLINE por uma TRANSIÇAO (sem queda nao ha retrato)',
        })
        .toContain('reconnecting->online');
}

/**
 * Troca o mapa ativo clicando no cartao dele, REENVIANDO o clique ate' tomar.
 */
async function trocarParaMapaUI(page, nome) {
    await abrirAbaMapas(page);
    const cartao = page.locator(`.maps-tab .map-list-item[data-map-name="${nome}"]`);
    await expect(cartao).toBeVisible({ timeout: 15000 });
    await expect.poll(async () => {
        if (await currentMapName(page) === nome) return nome;
        const alvo = page.locator(`.maps-tab .map-list-item[data-map-name="${nome}"]`);
        if (await alvo.count() > 0) {
            await alvo.first().evaluate((el) => el.click()).catch(() => { /* re-render no meio */ });
        }
        return currentMapName(page);
    }, { timeout: 20000, message: `o mapa ativo nao virou "${nome}"` }).toBe(nome);
}

/**
 * Comeca a ANOTAR todo toast que nascer, porque o toast MORRE sozinho.
 *
 * O aviso de "o mapa que voce estava vendo foi removido" se apaga em poucos segundos, e o retrato
 * so' e' tirado depois de o estado assentar: ler o DOM no fim mede o que sobrou, nao o que foi
 * dito. O observador transforma um evento efemero num fato acumulado, que e' o que a asserçao
 * precisa.
 */
function gravarAvisos(page) {
    return page.evaluate(() => {
        globalThis.__ebgeoAvisos = [];
        if (globalThis.__ebgeoObservaAvisos) return;
        globalThis.__ebgeoObservaAvisos = true;
        const anota = (no) => {
            if (!(no instanceof HTMLElement)) return;
            const alvo = no.matches?.('.toast') ? no : no.querySelector?.('.toast');
            const texto = alvo?.textContent?.trim();
            if (texto) globalThis.__ebgeoAvisos.push(texto);
        };
        new MutationObserver((mutacoes) => {
            for (const m of mutacoes) for (const no of m.addedNodes) anota(no);
        }).observe(document.body, { childList: true, subtree: true });
    });
}

/**
 * O RETRATO DO CLIENTE: memoria, disco, indice, fila e tela, lidos de uma vez.
 *
 * As leituras de memoria sao pelo barril do store (a MESMA instancia de modulo que o app usa, ja'
 * que o servidor desta camada roda sem HMR), e as de disco pelo repositorio ativo. A MARCA do
 * resolvedor e' lida do proprio servico, e vem acompanhada do EFEITO dela (`chavesDeColorUsage`),
 * porque a marca sozinha e' um booleano que nao prova consequencia nenhuma: com ela falsa,
 * `_resolveSettingsKey` grava `color_usage_<NOME>`; com ela verdadeira, `color_usage_<UUID>`.
 */
function retratoDoCliente(page, { mapId, velho, novo }) {
    return page.evaluate(async (q) => {
        const store = await import('/src/js/store/index.js');
        const { mapResolver } = await import('/src/js/store/services/map-resolver.service.js');
        const { getRepository, getSettingCompat, getAllMapKeysCompat } =
            await import('/src/js/store/repositories/index.js');
        const { getStore, StoreName } = await import('/src/js/store/atlas-namespace.js');
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        const repo = getRepository();
        const registro = q.mapId ? await repo.getMap(q.mapId) : null;
        const chavesDeMapa = (await getAllMapKeysCompat()) ?? [];
        const documentos = [];
        for (const chave of chavesDeMapa) {
            const doc = await repo.getMap(chave);
            documentos.push({ chave, nome: doc?.name ?? null });
        }
        const chavesDeAjuste = await getStore(StoreName.SETTINGS).keys();
        // A EVIDENCIA DE QUE UM RETRATO ACONTECEU. Cada retrato encena uma GERAÇAO nova de bancos
        // e so' no fim grava `{active, cursor}`: o ponteiro mudar e' a prova independente de que a
        // ativaçao rodou, e sem ela "o disco tem o nome novo" nao distingue retrato de op ao vivo.
        let geracao = null;
        try {
            const { readGeneration } = await import('/src/js/store/namespace-generation.js');
            const { getActiveScope } = await import('/src/js/store/atlas-namespace.js');
            geracao = readGeneration(getActiveScope());
        } catch {
            geracao = null;
        }
        const ms = store.memoryStore;
        const chaves = (obj) => Object.keys(obj ?? {});
        let fila = null;
        try {
            fila = await operationQueue.countByState();
        } catch {
            fila = null;
        }
        return {
            // --- a marca e o efeito dela ---
            resolvedorInicializado: mapResolver.isInitialized,
            resolvedorTamanho: mapResolver.size,
            chavesDeColorUsage: chavesDeAjuste.filter((k) => k.startsWith('color_usage_')),
            geracao,
            // --- disco ---
            nomeNoDisco: registro?.name ?? null,
            documentosNoDisco: documentos,
            // UM DOCUMENTO CUJA CHAVE NAO E' UUID, num atlas de SERVIDOR, e' o fantasma em pessoa.
            fantasmas: documentos.filter((d) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(d.chave)),
            lastActiveMap: (await getSettingCompat('lastActiveMap')) ?? null,
            // --- memoria ---
            currentMapSync: store.getCurrentMapNameSync(),
            currentMapIdSync: store.getCurrentMapIdSync(),
            chavesDeMaps: chaves(ms.maps),
            chavesDeLayers: chaves(ms.layers),
            chavesDeGroups: chaves(ms.groups),
            chavesTemporalView: [...(ms.temporalView?.keys?.() ?? [])],
            // --- indice nome<->id ---
            resolveVelhoParaId: q.velho ? mapResolver.resolveToId(q.velho) : null,
            resolveNovoParaId: q.novo ? mapResolver.resolveToId(q.novo) : null,
            resolveIdParaNome: q.mapId ? mapResolver.resolveToName(q.mapId) : null,
            // --- fila de saida ---
            fila,
            // --- o que o usuario ve ---
            campoDeNome: document.querySelector('.maps-tab #current-map-name-input')?.value ?? null,
            cartoesNaLista: [...document.querySelectorAll('.maps-tab .map-list-item')]
                .map((el) => ({ nome: el.dataset.mapName, selecionado: el.dataset.selected })),
            // AS DUAS FONTES FICAM SEPARADAS, e isso foi aprendido errando: a primeira versao
            // CONCATENAVA o registro do observador com a varredura do DOM, e um unico aviso ainda
            // vivo aparecia DUAS vezes na lista. O retrato entao mostrava quatro linhas para dois
            // avisos, e a leitura natural disso ("o apply do delete remoto roda em dobro") e'
            // falsa. Instrumento que soma duas medidas da mesma coisa nao mede o dobro, mente.
            avisosGravados: [...(globalThis.__ebgeoAvisos ?? [])],
            avisosNaTela: [...document.querySelectorAll('.toast')]
                .map((el) => el.textContent?.trim()).filter(Boolean),
        };
    }, { mapId, velho: velho ?? null, novo: novo ?? null });
}

/**
 * ONDE A FEICAO RECEM-DESENHADA FOI PARAR, varrendo TODO documento de mapa do disco.
 *
 * "Nao esta sob o mapId esperado" e' um vermelho que nao diagnostica: some, caiu em outro mapa e
 * nunca foi gravada sao tres desfechos diferentes. A varredura transforma a ausencia num endereco.
 */
function ondeCaiuAFeicao(page, featureId) {
    return page.evaluate(async (fid) => {
        const store = await import('/src/js/store/index.js');
        const { getRepository, getAllMapKeysCompat } = await import('/src/js/store/repositories/index.js');
        const repo = getRepository();
        const achados = [];
        const docs = [];
        for (const chave of (await getAllMapKeysCompat()) ?? []) {
            const doc = await repo.getMap(chave);
            docs.push({ chave, nome: doc?.name ?? null });
            for (const [balde, arr] of Object.entries(doc?.features ?? {})) {
                if (Array.isArray(arr) && arr.some((f) => f?.properties?.id === fid)) {
                    achados.push({ chave, nome: doc?.name ?? null, balde });
                }
            }
        }
        return {
            currentMapSync: store.getCurrentMapNameSync(),
            currentMapIdSync: store.getCurrentMapIdSync(),
            achados,
            documentosNoDisco: docs,
        };
    }, featureId);
}

/**
 * Desenha uma linha e devolve o id, ou NULO quando o desenho nao produziu feiçao nenhuma.
 *
 * O `drawLineUI` LANÇA quando a ferramenta nao cria nada, e "nao criou nada" e' justamente um dos
 * desfechos sob medicao: com o mapa corrente apontando para um documento que nao existe, a
 * escrita vai para o mapa FANTASMA e a leitura do mapa corrente nao ve feiçao nenhuma. Deixar o
 * lance subir aborta o caso ANTES de o disco ser fotografado, que e' onde o fantasma aparece.
 */
async function desenharOuNulo(page, coords) {
    try {
        return await drawLineUI(page, coords);
    } catch (erro) {
        console.log(`\n===== O DESENHO NAO PRODUZIU FEIÇAO =====\n${erro?.message}\n`);
        return null;
    }
}

/** Imprime o retrato inteiro antes de qualquer asserçao, para o vermelho nao esconder a medicao. */
function publicarRetrato(rotulo, retrato) {
    console.log(`\n===== RETRATO ${rotulo} =====\n${JSON.stringify(retrato, null, 2)}\n`);
}

/** Um GET/POST na API pelo lado Node, com o token de quem tem direito de fazer o pedido. */
async function api(baseUrl, caminho, { token, metodo = 'GET', corpo } = {}) {
    const resposta = await fetch(`${baseUrl}/api/v1${caminho}`, {
        method: metodo,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(corpo ? { body: JSON.stringify(corpo) } : {}),
    });
    const texto = await resposta.text();
    if (!resposta.ok) throw new Error(`${metodo} ${caminho} respondeu ${resposta.status}: ${texto}`);
    return texto ? JSON.parse(texto).data : null;
}

collabTest.describe('Mapa fantasma: a marca do resolvedor e os dois gatilhos que sobraram', () => {
    collabTest('(D1) a marca do resolvedor logo depois de ABRIR um atlas de servidor', async ({ collab }) => {
        collabTest.setTimeout(120000);
        const A = collab.author;
        const B = collab.peers[0];
        const mapId = collab.mapId;

        await abrirAbaMapas(B);
        const antesDoDesenho = await retratoDoCliente(B, { mapId, velho: SHARED_MAP });
        publicarRetrato('(D1) B logo depois de abrir o atlas', antesDoDesenho);

        // O DESENHO E' O QUE COBRA A MARCA: a contagem de cores do mapa e' gravada por
        // `setColorUsageCompat`, cuja chave sai de `_resolveSettingsKey`.
        const linhaId = await drawLineUI(B, [[-43.25, -22.95], [-43.20, -22.90], [-43.15, -22.85]]);
        expect(linhaId, 'B conseguiu desenhar').toBeTruthy();
        const depoisDoDesenho = await retratoDoCliente(B, { mapId, velho: SHARED_MAP });
        publicarRetrato('(D1) B depois de desenhar', depoisDoDesenho);

        const retratoA = await retratoDoCliente(A, { mapId, velho: SHARED_MAP });
        publicarRetrato('(D1) A (o dono, que abriu o mesmo atlas)', retratoA);

        // A MARCA E' O SUJEITO: o indice esta CHEIO (o retrato registrou todo mapa), e mesmo assim
        // a marca dizia falso, o que desliga a via rapida de `getMap`/`_resolveMapKey` e manda a
        // contagem de cores para uma chave por NOME.
        expect.soft(depoisDoDesenho.resolvedorTamanho, 'o indice do resolvedor tem os mapas do atlas').toBeGreaterThan(0);
        expect.soft(depoisDoDesenho.resolvedorInicializado, 'mapResolver.isInitialized em B depois do retrato de abertura').toBe(true);
        expect.soft(retratoA.resolvedorInicializado, 'mapResolver.isInitialized em A depois do retrato de abertura').toBe(true);
        // O EFEITO, que e' o que a marca custa de verdade: a contagem de cores fica sob o ID.
        //
        // A ASSERÇAO E' POSITIVA, E ISSO FOI MEDIDO. A chave por NOME existe TAMBEM depois do
        // conserto, e nao e' esta escrita: o ajuste de atlas `colorUsage` e' sincronizado com o
        // NOME do mapa como chave, e `applyRemoteAppStateSettings` o reidrata como
        // `color_usage_<nome>` a cada retrato. Exigir a ausencia dela mediria aquele outro
        // mecanismo. O que a marca decide e' se `_resolveSettingsKey` resolve para o id, e a
        // evidencia disso e' a chave por id EXISTIR: antes do conserto ela nao existia, e as duas
        // unicas chaves eram as de nome.
        expect.soft(depoisDoDesenho.chavesDeColorUsage,
            'a contagem de cores do mapa aberto e gravada sob o ID dele')
            .toContain(`color_usage_${mapId}`);
        expect.soft(depoisDoDesenho.fantasmas, 'nenhum documento de mapa com chave que nao e UUID').toEqual([]);
        await collab.expectFullSyncFrom(B, { entityId: linhaId, type: 'lines', operationType: 'create' });
    });

    collabTest('(G1) um RETRATO no meio da sessao, com o mapa renomeado enquanto B estava fora', async ({ collab }) => {
        collabTest.setTimeout(360000);
        const A = collab.author;
        const B = collab.peers[0];
        const mapId = collab.mapId;
        const { baseUrl, atlasId } = collab;

        // O administrador existe para PODAR a cauda. Ele nao entra em navegador nenhum.
        const admin = await createVerifiedUser({ prefix: 'fantasma_adm', role: 'admin' });

        await abrirAbaMapas(B);
        const antes = await retratoDoCliente(B, { mapId, velho: SHARED_MAP, novo: NOVO_NOME });
        publicarRetrato('(G1) B ANTES', antes);
        expect(antes.currentMapSync, 'pre-condicao: B esta no mapa compartilhado').toBe(SHARED_MAP);

        // B CAI DA REDE DE VERDADE (a janela longa e' o que faz o socket cair, ver
        // `quedaEVoltaDaConexao`). A renomeia DENTRO da janela, e a poda acontece antes de a rede
        // voltar, entao a cauda que carregaria o rename ja' nao existe quando B pede.
        const versaoAntesDoRename = (await api(baseUrl, `/atlas/${atlasId}/sync/admin/stats`,
            { token: admin.accessToken })).currentVersion;
        const voltaDaConexao = quedaEVoltaDaConexao(B);
        await B.waitForTimeout(2000);
        await renomearMapaAtualUI(A, NOVO_NOME);

        // A PODA SO' VALE DEPOIS QUE A OP DE RENAME CHEGOU: podar antes deixaria o rename DENTRO
        // da cauda que B ainda pode pedir, e o retrato nunca aconteceria. A evidencia de chegada e'
        // a versao do atlas subir acima da que ele tinha antes do gesto.
        await expect.poll(async () => (await api(baseUrl, `/atlas/${atlasId}/sync/admin/stats`,
            { token: admin.accessToken })).currentVersion,
        { timeout: 45000, message: 'a op de rename nunca chegou ao servidor' }).toBeGreaterThan(versaoAntesDoRename);
        const estatisticas = await api(baseUrl, `/atlas/${atlasId}/sync/admin/stats`, { token: admin.accessToken });
        const poda = await api(baseUrl, `/atlas/${atlasId}/sync/admin/cleanup`, {
            token: admin.accessToken, metodo: 'POST', corpo: { keepFromVersion: estatisticas.currentVersion },
        });
        console.log(`\n===== PODA ===== ${JSON.stringify({ estatisticas, poda })}\n`);

        // E B VOLTA. Sem cauda, o servidor responde o RETRATO inteiro.
        await voltaDaConexao;
        await expect(B.locator('[data-testid="sync-status-badge"]'))
            .toHaveAttribute('data-state', 'online', { timeout: 60000 });
        await expect
            .poll(async () => (await retratoDoCliente(B, { mapId, velho: SHARED_MAP, novo: NOVO_NOME })).nomeNoDisco,
                { timeout: 60000, message: 'o registro do mapa em B nunca recebeu o nome novo' })
            .toBe(NOVO_NOME);
        // A lista se desenha em pedacos: espera pelo FIM do desenho, que e' independente do que as
        // asserçoes perguntam.
        await expect.poll(async () => {
            const r = await retratoDoCliente(B, { mapId, velho: SHARED_MAP, novo: NOVO_NOME });
            return r.cartoesNaLista.length === r.documentosNoDisco.length;
        }, { timeout: 20000 }).toBe(true).catch(() => { /* o retrato dira' o que a lista tinha */ });
        // A aba Mapas e' um dos itens SOB medicao, entao a reabertura e' tolerante: transformar a
        // ausencia dela num timeout abortaria o caso antes do retrato, que e' o produto daqui.
        await abrirAbaMapas(B).catch(() => {});

        const depois = await retratoDoCliente(B, { mapId, velho: SHARED_MAP, novo: NOVO_NOME });
        publicarRetrato('(G1) B DEPOIS do retrato', depois);

        // --- 0. a PRE-CONDIÇAO do caso: um retrato de fato aconteceu ---
        // Sem isto o caso mede o caminho AO VIVO com outro nome. A geraçao ativa so' muda quando
        // `applyRemoteSnapshot` encena e publica uma geraçao nova de bancos.
        expect(depois.geracao?.active, 'o retrato do meio da sessao ACONTECEU (a geraçao ativa mudou)')
            .not.toBe(antes.geracao?.active ?? null);

        // --- 1. a marca voltou com o retrato ---
        expect.soft(depois.resolvedorInicializado, 'mapResolver.isInitialized depois do retrato').toBe(true);

        // --- 2. a memoria seguiu o disco ---
        expect.soft(depois.currentMapSync, 'getCurrentMapNameSync() em B').toBe(NOVO_NOME);
        expect.soft(depois.chavesDeMaps, 'memoryStore.maps de B nao guarda mais o nome velho').not.toContain(SHARED_MAP);
        expect.soft(depois.chavesDeLayers, 'memoryStore.layers de B nao guarda mais o nome velho').not.toContain(SHARED_MAP);
        expect.soft(depois.lastActiveMap, 'o ajuste lastActiveMap de B').toBe(NOVO_NOME);
        expect.soft(depois.resolveVelhoParaId, 'o indice NAO pode continuar resolvendo o nome VELHO para este mapa')
            .not.toBe(mapId);

        // --- 3. a tela ---
        const cartao = depois.cartoesNaLista.find((c) => c.nome === NOVO_NOME);
        expect.soft(cartao, 'o cartao do nome novo existe na lista de B').toBeTruthy();
        expect.soft(cartao?.selecionado, 'o cartao do mapa renomeado e o marcado como atual em B').toBe('true');

        // --- 4. o elo inteiro: B desenha e a feicao chega a A, sem fantasma ---
        const linhaId = await desenharOuNulo(B, [[-43.24, -22.94], [-43.19, -22.89], [-43.14, -22.84]]);
        const onde = await ondeCaiuAFeicao(B, linhaId ?? '(nada foi desenhado)');
        publicarRetrato('(G1) onde caiu a feicao desenhada por B', onde);
        expect(linhaId, 'B conseguiu desenhar depois do retrato').toBeTruthy();
        expect.soft(onde.achados.map((a) => a.chave),
            'a feicao desenhada por B esta no documento do mapa do atlas, e em nenhum outro').toEqual([mapId]);
        await collab.expectFullSyncFrom(B, { entityId: linhaId, type: 'lines', operationType: 'create', timeout: 45000 });
    });

    collabTest('(G2) A exclui o mapa que B tem ABERTO', async ({ collab }) => {
        collabTest.setTimeout(240000);
        const A = collab.author;
        const B = collab.peers[0];
        const mapId = collab.mapId;

        // Excluir o ULTIMO mapa e' recusado pelo proprio menu, entao o atlas precisa de dois.
        await abrirAbaMapas(B);
        await criarMapaUI(A, SECOND_MAP);
        await expect
            .poll(() => B.locator(`.maps-tab .map-list-item[data-map-name="${SECOND_MAP}"]`).count(),
                { timeout: 30000, message: 'o segundo mapa nunca apareceu na lista de B' })
            .toBeGreaterThan(0);
        // B fica no mapa compartilhado; A vai para o segundo para poder excluir o primeiro.
        await trocarParaMapaUI(B, SHARED_MAP);

        const antes = await retratoDoCliente(B, { mapId, velho: SHARED_MAP });
        publicarRetrato('(G2) B ANTES', antes);
        expect(antes.currentMapSync, 'pre-condicao: B esta no mapa que sera excluido').toBe(SHARED_MAP);

        await collab.clearTraces();
        await gravarAvisos(B);
        await excluirMapaUI(A, SHARED_MAP);
        await waitForRemoteEntity(B, mapId, { operationType: 'delete', timeout: 45000 });
        await expect
            .poll(async () => (await retratoDoCliente(B, { mapId, velho: SHARED_MAP })).nomeNoDisco,
                { timeout: 30000, message: 'o registro do mapa excluido nunca sumiu do disco de B' })
            .toBe(null);
        await abrirAbaMapas(B).catch(() => {});

        const depois = await retratoDoCliente(B, { mapId, velho: SHARED_MAP });
        publicarRetrato('(G2) B DEPOIS da exclusao remota', depois);

        // --- 1. a aba NAO pode ficar no mapa que nao existe mais ---
        expect.soft(depois.currentMapSync, 'B saiu do mapa excluido').not.toBe(SHARED_MAP);
        expect.soft(depois.currentMapSync, 'B esta em algum mapa').toBeTruthy();
        expect.soft(depois.lastActiveMap, 'o ponteiro de mapa corrente no disco saiu do mapa excluido').not.toBe(SHARED_MAP);

        // --- 2. a pessoa foi AVISADA (o clique nao explica: ninguem clicou) ---
        expect.soft(depois.avisosGravados.join(' | '), 'B foi avisado de que o mapa foi removido').toMatch(/remov|exclu/i);

        // --- 3. o elo inteiro: B desenha e a feicao chega a A, sem fantasma ---
        //
        // O `expectFullSync` NAO SERVE AQUI, e a razao e' do instrumento: ele le' o IndexedDB do
        // par com o `mapId` da fixture (`readIdbEntity(..., mapId: ctx.mapId)`), que e' justamente
        // o mapa que acabou de ser excluido. A convergencia se mede, entao, pelo mapa em que B
        // efetivamente parou: A vai para o mesmo mapa e le' as feicoes dele.
        const destino = depois.currentMapSync;
        await trocarParaMapaUI(A, destino);
        const linhaId = await desenharOuNulo(B, [[-43.23, -22.93], [-43.18, -22.88], [-43.13, -22.83]]);
        const onde = await ondeCaiuAFeicao(B, linhaId ?? '(nada foi desenhado)');
        publicarRetrato('(G2) onde caiu a feicao desenhada por B', onde);
        expect(linhaId, 'B conseguiu desenhar depois da exclusao remota').toBeTruthy();
        expect.soft(onde.achados.length, 'a feicao desenhada por B foi gravada em exatamente um documento').toBe(1);
        expect.soft(onde.achados[0]?.chave, 'e esse documento NAO e o do mapa excluido').not.toBe(mapId);
        const posterior = await retratoDoCliente(B, { mapId: onde.achados[0]?.chave ?? null, velho: SHARED_MAP });
        publicarRetrato('(G2) B depois de desenhar', posterior);
        expect.soft(posterior.fantasmas, 'nenhum documento de mapa com chave que nao e UUID').toEqual([]);
        await expect
            .poll(async () => (await readFeatures(A, 'lines')).some((f) => f.id === linhaId),
                { timeout: 45000, message: 'a feicao que B desenhou depois da exclusao nunca chegou a A' })
            .toBe(true);
    });

    collabTest('(G2b) o mesmo, com B que NUNCA abriu a aba Mapas', async ({ collab }) => {
        collabTest.setTimeout(240000);
        const A = collab.author;
        const B = collab.peers[0];
        const mapId = collab.mapId;

        // A DIFERENÇA E' TODA A MEDICAO. O desvio que tirava a pessoa de um mapa excluido MORAVA
        // em `sidebar/tabs/maps.tab.js` (o ramo de exclusao de `_onRemoteOperation`, removido em 2026-09-21), e as
        // abas da barra lateral sao construidas SOB DEMANDA (`SidebarControl._getTabContent`): quem
        // nunca abriu "Mapas" nao tem aquele assinante. O caso (G2) acima mede o cliente que a
        // tem aberta; este mede o que nao tem, que e' o estado normal de quem so' desenha.
        // NADA de `abrirAbaMapas(B)` em lugar nenhum deste caso, de proposito.
        await criarMapaUI(A, SECOND_MAP);
        await expect
            .poll(() => B.evaluate(async () => {
                const { getAllMapKeysCompat } = await import('/src/js/store/repositories/index.js');
                return ((await getAllMapKeysCompat()) ?? []).length;
            }), { timeout: 30000, message: 'o segundo mapa nunca chegou ao disco de B' })
            .toBeGreaterThan(1);

        const antes = await retratoDoCliente(B, { mapId, velho: SHARED_MAP });
        publicarRetrato('(G2b) B ANTES', antes);
        expect(antes.currentMapSync, 'pre-condicao: B esta no mapa que sera excluido').toBe(SHARED_MAP);
        expect(antes.campoDeNome, 'pre-condicao: B NAO tem a aba Mapas montada').toBe(null);

        await collab.clearTraces();
        await gravarAvisos(B);
        await excluirMapaUI(A, SHARED_MAP);
        await waitForRemoteEntity(B, mapId, { operationType: 'delete', timeout: 45000 });
        await expect
            .poll(async () => (await retratoDoCliente(B, { mapId, velho: SHARED_MAP })).nomeNoDisco,
                { timeout: 30000, message: 'o registro do mapa excluido nunca sumiu do disco de B' })
            .toBe(null);
        // Uma janela para o desvio acontecer: sem ela, "ainda esta no mapa excluido" e' verdade
        // tambem para uma troca que ia acontecer no instante seguinte.
        await B.waitForTimeout(3000);

        const depois = await retratoDoCliente(B, { mapId, velho: SHARED_MAP });
        publicarRetrato('(G2b) B DEPOIS da exclusao remota', depois);

        expect.soft(depois.currentMapSync, 'B saiu do mapa excluido mesmo sem a aba Mapas').not.toBe(SHARED_MAP);
        expect.soft(depois.avisosGravados.join(' | '), 'B foi avisado de que o mapa foi removido').toMatch(/remov|exclu/i);

        const linhaId = await desenharOuNulo(B, [[-43.22, -22.92], [-43.17, -22.87], [-43.12, -22.82]]);
        const onde = await ondeCaiuAFeicao(B, linhaId ?? '(nada foi desenhado)');
        publicarRetrato('(G2b) onde caiu a feicao desenhada por B', onde);
        const posterior = await retratoDoCliente(B, { mapId: onde.achados[0]?.chave ?? null, velho: SHARED_MAP });
        publicarRetrato('(G2b) B depois de desenhar', posterior);
        // O FANTASMA E' A PERDA DE DADO, e e' ele o sujeito deste caso: um documento de mapa cuja
        // chave nao e' UUID, num atlas de servidor, so' pode ter nascido de uma escrita cujo alvo
        // nao existia.
        expect.soft(posterior.fantasmas, 'nenhum documento de mapa com chave que nao e UUID').toEqual([]);
        expect(linhaId, 'B conseguiu desenhar depois da exclusao remota').toBeTruthy();
        expect.soft(onde.achados[0]?.chave, 'a feicao NAO foi parar no documento do mapa excluido').not.toBe(mapId);
    });
});
