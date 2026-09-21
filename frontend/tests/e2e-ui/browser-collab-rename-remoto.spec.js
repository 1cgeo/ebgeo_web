// Path: e2e-ui/browser-collab-rename-remoto.spec.js

/**
 * @fileoverview O RENAME QUE CHEGA PELO SYNC NAO RE-CHAVEIA A MEMORIA DO PAR (ponto N1).
 *
 * O DEFEITO. O nome do mapa e' CHAVE em varias estruturas de memoria do cliente
 * (`memoryStore.currentMap`, `memoryStore.maps/groups/layers`, `lockedMaps`, `temporalConfigs`,
 * `temporalView`) e no indice nome<->id (`mapResolver`). Quem renomeia re-chaveia tudo por
 * `mapManager.renameMapInMemory` mais `mapResolver.renameMap`, chamados num sitio so': o caminho
 * do AUTOR, em `store/map.operations.js`. Quando o rename chega pelo sync, `mergeRemoteMapUpdate`
 * (`store/sync/remote-operation-handler.js`) grava o registro com o nome novo e transfere os
 * documentos laterais chaveados por nome NO DISCO, mas nenhuma das duas re-chaveagens de memoria
 * roda: o disco passa a dizer "Bravo" e a memoria continua dizendo "Alfa".
 *
 * O QUE ISSO CUSTA, MEDIDO AQUI EM 2026-09-21 (e e' por isso que os dois cenarios diferem):
 *   (a) o par esta COM o mapa aberto: a memoria inteira dele continua sob o nome VELHO, enquanto
 *       a lista de mapas (que le o disco) ja' mostra o nome NOVO. A aba Mapas fica sem NENHUM
 *       cartao marcado como atual, e o campo de nome do cabecalho continua com o nome velho,
 *       porque ele vem do ajuste `lastActiveMap`, que tambem e' um NOME e tambem nao andava.
 *   (b) o par esta em OUTRO mapa: a memoria do mapa renomeado fica orfa sob o nome velho e o
 *       indice `mapResolver` passa a responder pelos DOIS nomes, o que e' uma bomba de homonimo:
 *       o primeiro mapa que nascer com o nome velho sequestra a entrada.
 *
 * E A CONSEQUENCIA CARA NAO E' DE TELA, e foi este arquivo que a encontrou: no cenario (a), uma
 * feicao que o par desenhe DEPOIS do rename vai parar num MAPA FANTASMA. O mecanismo, medido
 * passo a passo: o alvo da escrita e' `memoryStore.currentMap`, que continua no nome velho;
 * `LocalRepository.getMap` so' tem a varredura lenta para resolver nome (a via rapida do indice
 * e' gateada por `mapResolver.isInitialized`, que e' FALSO num atlas de servidor recem-aberto,
 * porque `clear()` zera a marca e nada re-inicializa), e a varredura casa `mapData.name`, que
 * depois do rename nao atende mais pelo nome velho; entao `getMapDataCompat` devolve o documento
 * VAZIO de compatibilidade (nome `Novo Mapa`) e a gravacao o crava sob a CHAVE do nome velho. A
 * feicao some do mapa do atlas e a operacao morre na fila (`enqueued_not_flushed`), sem um erro
 * em lugar nenhum. E' perda de dado, nao cosmetica.
 *
 * COMO ESTE ARQUIVO MEDE. Duas browsers reais no mesmo atlas de servidor (fixture `collabTest`),
 * o gesto de renomear feito na UI de verdade (campo de nome do cartao do mapa atual, na aba
 * Mapas) e a chegada esperada pelo TRACE (`remote.applied` da op de mapa), nunca por sleep. O
 * retrato do par e' impresso no stdout ANTES das asserçoes, para que o vermelho de um item nao
 * esconda a medicao dos outros.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test browser-collab-rename-remoto --retries=0 --reporter=line
 */

import { collabTest, expect, currentMapName, drawLineUI } from './helpers/collab.fixtures.js';
import { waitForRemoteEntity } from './helpers/trace-helpers.js';

const SHARED_MAP = 'Mapa Tático';
const SECOND_MAP = 'Mapa Secundário';
const NOVO_NOME = 'Mapa Renomeado';

/**
 * Abre a aba Mapas e espera ela ficar PRONTA, que e' mais do que o campo existir.
 *
 * O cartao do mapa atual monta com o campo VAZIO e so' depois `_loadMaps` preenche o valor e
 * desenha a lista, as duas coisas de forma assincrona. Quem escrever no campo antes disso tem o
 * texto sobrescrito pela passada de carga, e o gesto vira um no-op silencioso (medido: o autor
 * ficava com o nome velho e o vermelho aparecia 15 s depois, no `poll` do nome).
 */
async function abrirAbaMapas(page) {
    // O BOTAO DA ABA E' UM ALTERNADOR, e clicar nele com a aba JA' ativa COLAPSA a barra lateral
    // (`SidebarControl._handleTabClick`). Clicar sem perguntar desmontava `.maps-tab` no meio da
    // medicao, e o retrato saia com `campoDeNome: null` e a lista VAZIA, que se le como "a tela
    // nao repintou" quando o que aconteceu foi o proprio driver ter fechado a gaveta.
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
 * Renomeia o mapa ATUAL pelo campo de nome do cartao de cabecalho, que e' o gesto real: o
 * handler esta no `blur`, e o `Enter` do campo apenas chama `blur()`.
 *
 * O GESTO E' REENVIADO ate' tomar, pela mesma razao de `trocarParaMapaUI`: toda op de sync que
 * chega dispara `_loadMaps`, que reescreve o valor do campo, e um `fill` que caia nessa janela e'
 * perdido sem erro. Re-escrever dentro do laco troca "o texto se perdeu" por "o texto e'
 * reenviado"; re-escrever o nome que ja' vale e' inocuo, porque o handler sai cedo quando o nome
 * pedido e' o corrente.
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
 * Troca o mapa ativo clicando no cartao dele, REENVIANDO o clique ate' tomar.
 *
 * A lista se re-renderiza a cada op de sync que chega, e um clique resolvido antes da
 * re-renderizacao vai para um no' DESTACADO, o que nao levanta erro e nao faz nada. Mesma licao
 * (e mesma forma) de `browser-collab-maps-layers.spec.js`.
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
 * O RETRATO DO PAR: tudo o que o rename deveria ter movido, lido de uma vez.
 *
 * Le memoria E disco, porque o defeito e' exatamente a divergencia entre os dois. As leituras de
 * memoria sao pelo barril do store (a MESMA instancia de modulo que o app usa, ja' que o servidor
 * desta camada roda sem HMR), e as de disco pelo repositorio ativo.
 */
function retratoDoPar(page, { mapId, velho, novo }) {
    return page.evaluate(async (q) => {
        const store = await import('/src/js/store/index.js');
        const { mapResolver } = await import('/src/js/store/services/map-resolver.service.js');
        const { getRepository, getSettingCompat, getAllMapKeysCompat } =
            await import('/src/js/store/repositories/index.js');
        const repo = getRepository();
        const registro = await repo.getMap(q.mapId);
        const mapasNoDisco = ((await getAllMapKeysCompat()) ?? []).length;
        const ms = store.memoryStore;
        const chaves = (obj) => Object.keys(obj ?? {});
        return {
            // --- disco ---
            nomeNoDisco: registro?.name ?? null,
            mapasNoDisco,
            lastActiveMap: (await getSettingCompat('lastActiveMap')) ?? null,
            temporalNoDiscoVelho: (await getSettingCompat(`temporal_${q.velho}`)) ?? null,
            temporalNoDiscoNovo: (await getSettingCompat(`temporal_${q.novo}`)) ?? null,
            // --- memoria ---
            currentMapSync: store.getCurrentMapNameSync(),
            currentMapIdSync: store.getCurrentMapIdSync(),
            chavesDeMaps: chaves(ms.maps),
            chavesDeLayers: chaves(ms.layers),
            chavesDeGroups: chaves(ms.groups),
            travados: [...(ms.lockedMaps ?? [])],
            chavesTemporalConfigs: [...(ms.temporalConfigs?.keys?.() ?? [])],
            chavesTemporalView: [...(ms.temporalView?.keys?.() ?? [])],
            // --- indice nome<->id ---
            resolveVelhoParaId: mapResolver.resolveToId(q.velho),
            resolveNovoParaId: mapResolver.resolveToId(q.novo),
            resolveIdParaNome: mapResolver.resolveToName(q.mapId),
            // --- o que o usuario ve ---
            campoDeNome: document.querySelector('.maps-tab #current-map-name-input')?.value ?? null,
            cartoesNaLista: [...document.querySelectorAll('.maps-tab .map-list-item')]
                .map((el) => ({ nome: el.dataset.mapName, selecionado: el.dataset.selected })),
            // --- conteudo do mapa corrente, pela memoria ---
            camadasDoCorrente: (store.getLayers() ?? []).length,
            gruposDoCorrente: Object.keys(store.getMapGroups() ?? {}).length,
        };
    }, { mapId, velho, novo });
}

/**
 * ONDE A FEICAO RECEM-DESENHADA FOI PARAR, varrendo TODO documento de mapa do disco.
 *
 * "Nao esta sob o mapId esperado" e' um vermelho que nao diagnostica: some, caiu em outro mapa e
 * nunca foi gravada sao tres desfechos diferentes e o `expectFullSync` nomeia os tres igual. A
 * varredura transforma a ausencia num endereco.
 */
function ondeCaiuAFeicao(page, featureId) {
    return page.evaluate(async (fid) => {
        const store = await import('/src/js/store/index.js');
        const { getRepository, getAllMapKeysCompat } = await import('/src/js/store/repositories/index.js');
        const repo = getRepository();
        const achados = [];
        for (const chave of (await getAllMapKeysCompat()) ?? []) {
            const doc = await repo.getMap(chave);
            for (const [balde, arr] of Object.entries(doc?.features ?? {})) {
                if (Array.isArray(arr) && arr.some((f) => f?.properties?.id === fid)) {
                    achados.push({ chave, nome: doc?.name ?? null, balde });
                }
            }
        }
        const { mapResolver } = await import('/src/js/store/services/map-resolver.service.js');
        const docs = [];
        for (const chave of (await getAllMapKeysCompat()) ?? []) {
            const doc = await repo.getMap(chave);
            docs.push({ chave, nome: doc?.name ?? null });
        }
        return {
            currentMapSync: store.getCurrentMapNameSync(),
            currentMapIdSync: store.getCurrentMapIdSync(),
            achados,
            documentosNoDisco: docs,
            // O PORTAO DA VIA RAPIDA de `LocalRepository.getMap`/`_resolveMapKey`. Com ele FALSO
            // (e' o estado de um atlas de servidor recem-aberto, porque `mapResolver.clear()`
            // zera a marca e nada re-inicializa), a unica busca por NOME e' a varredura lenta,
            // que casa `mapData.name`: depois do rename remoto nenhum documento atende pelo nome
            // velho, e quem perguntar por ele recebe `null`.
            resolvedorInicializado: mapResolver.isInitialized,
        };
    }, featureId);
}

/** Imprime o retrato inteiro antes de qualquer asserçao, para o vermelho nao esconder a medicao. */
function publicarRetrato(rotulo, retrato) {
    console.log(`\n===== RETRATO ${rotulo} =====\n${JSON.stringify(retrato, null, 2)}\n`);
}

/**
 * Espera o rename CHEGAR em B e devolve o retrato dele.
 *
 * DUAS ESPERAS DE NATUREZA DIFERENTE, e a segunda e' TOLERANTE de proposito. A primeira (trace
 * mais registro no disco) e' a chegada da operacao: sem ela nao ha o que medir, entao ela e'
 * dura. A segunda (a lista da aba Mapas repintar) e' um dos efeitos SOB MEDICAO: transformar a
 * ausencia dela num timeout aborta o caso antes do retrato, e o retrato e' o produto deste
 * arquivo. Ela vira, portanto, um campo do retrato (`listaRepintou`) em vez de um erro.
 */
async function esperarRenameEmB(B, { mapId, velho, novo }) {
    await waitForRemoteEntity(B, mapId, { operationType: 'update', timeout: 30000 });
    await expect
        .poll(async () => (await retratoDoPar(B, { mapId, velho, novo })).nomeNoDisco,
            { timeout: 20000, message: 'o registro do mapa em B nunca recebeu o nome novo' })
        .toBe(novo);
    let listaRepintou = false;
    try {
        await expect
            .poll(() => B.locator(`.maps-tab .map-list-item[data-map-name="${novo}"]`).count(), { timeout: 20000 })
            .toBeGreaterThan(0);
        listaRepintou = true;
    } catch {
        listaRepintou = false;
    }
    // A LISTA SE DESENHA EM PEDACOS, e um retrato tirado no meio mente. `_renderMapsList` esvazia
    // o container e depois ANDA os mapas um a um, com tres leituras de disco por cartao: uma
    // leitura do DOM durante esse laco ve so' os cartoes ja' anexados. Medido em 1 de 12
    // execucoes em serie: o retrato trouxe UM cartao onde o disco tinha DOIS, e a asserçao de
    // "qual cartao esta ativo" acusou o produto por um estado do instrumento. A espera e' pelo
    // FIM do desenho (tantos cartoes quantos mapas ha' no disco), que e' independente do que as
    // asserçoes perguntam.
    try {
        await expect.poll(async () => {
            const r = await retratoDoPar(B, { mapId, velho, novo });
            return r.cartoesNaLista.length === r.mapasNoDisco;
        }, { timeout: 15000 }).toBe(true);
    } catch {
        // Nao e' o sujeito da medicao: segue e o retrato dira' o que a lista tinha.
    }
    return { ...(await retratoDoPar(B, { mapId, velho, novo })), listaRepintou };
}

collabTest.describe('Rename remoto: o par re-chaveia a memoria por nome', () => {
    collabTest('(a) B esta COM o mapa aberto quando A renomeia', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        const B = collab.peers[0];
        const mapId = collab.mapId;

        expect(await currentMapName(A)).toBe(SHARED_MAP);
        expect(await currentMapName(B)).toBe(SHARED_MAP);
        await abrirAbaMapas(B);

        const antes = await retratoDoPar(B, { mapId, velho: SHARED_MAP, novo: NOVO_NOME });
        publicarRetrato('(a) B ANTES', antes);
        expect(antes.currentMapSync, 'pre-condicao: B esta no mapa compartilhado').toBe(SHARED_MAP);

        await collab.clearTraces();
        await renomearMapaAtualUI(A, NOVO_NOME);

        const depois = await esperarRenameEmB(B, { mapId, velho: SHARED_MAP, novo: NOVO_NOME });
        publicarRetrato('(a) B DEPOIS do rename remoto', depois);

        // AS MEDIÇOES SAO `soft` DE PROPOSITO: o produto deste caso e' o retrato inteiro, e um
        // `expect` duro no primeiro item aborta antes de medir os outros seis. O caso reprova do
        // mesmo jeito, nomeando TODAS as divergencias de uma vez.

        // --- 1. a memoria do par passou a responder pelo nome novo ---
        expect.soft(depois.currentMapSync, 'getCurrentMapNameSync() em B').toBe(NOVO_NOME);
        expect.soft(depois.chavesDeMaps, 'memoryStore.maps de B nao guarda mais o nome velho').not.toContain(SHARED_MAP);
        expect.soft(depois.chavesDeLayers, 'memoryStore.layers de B nao guarda mais o nome velho').not.toContain(SHARED_MAP);
        expect.soft(depois.chavesDeGroups, 'memoryStore.groups de B nao guarda mais o nome velho').not.toContain(SHARED_MAP);
        expect.soft(depois.chavesTemporalView, 'memoryStore.temporalView de B nao guarda mais o nome velho').not.toContain(SHARED_MAP);

        // --- 2. o indice nome<->id nao responde mais pelo nome velho (bomba de homonimo) ---
        expect.soft(depois.resolveIdParaNome, 'mapResolver: id -> nome').toBe(NOVO_NOME);
        expect.soft(depois.resolveNovoParaId, 'mapResolver: nome novo -> id').toBe(mapId);
        expect.soft(depois.resolveVelhoParaId, 'mapResolver NAO pode continuar resolvendo o nome VELHO para este mapa')
            .not.toBe(mapId);

        // --- 3. o ponteiro de mapa corrente no DISCO acompanha (e' um NOME) ---
        expect.soft(depois.lastActiveMap, 'o ajuste lastActiveMap de B').toBe(NOVO_NOME);

        // --- 4. a tela: o cartao do mapa renomeado e' o marcado como atual, e o campo de nome bate ---
        expect.soft(depois.listaRepintou, 'a lista de mapas de B mostrou o nome novo').toBe(true);
        const cartao = depois.cartoesNaLista.find((c) => c.nome === NOVO_NOME);
        expect.soft(cartao, 'o cartao do nome novo existe na lista de B').toBeTruthy();
        expect.soft(cartao?.selecionado, 'o cartao do mapa renomeado e o marcado como atual em B').toBe('true');
        expect.soft(depois.campoDeNome, 'o campo de nome do cartao de cabecalho em B').toBe(NOVO_NOME);

        // --- 5. camadas e grupos do mapa continuam listados ---
        expect.soft(depois.camadasDoCorrente, 'B continua enxergando as camadas do mapa').toBeGreaterThan(0);
        expect.soft(depois.gruposDoCorrente, 'grupos do mapa em B').toBe(antes.gruposDoCorrente);

        // --- 6. o elo inteiro: B desenha e a feicao chega a A ---
        const linhaId = await drawLineUI(B, [[-43.24, -22.94], [-43.19, -22.89], [-43.14, -22.84]]);
        expect(linhaId, 'B conseguiu desenhar uma linha depois do rename remoto').toBeTruthy();
        const onde = await ondeCaiuAFeicao(B, linhaId);
        publicarRetrato('(a) onde caiu a feicao desenhada por B', onde);
        // O MAPA FANTASMA E' A CONSEQUENCIA CARA, e ela nao e' de tela: com `memoryStore.currentMap`
        // no nome VELHO, `getMapDataCompat(nomeVelho)` nao acha documento nenhum, devolve o
        // documento VAZIO de compatibilidade (nome `Novo Mapa`) e a gravacao o crava sob a CHAVE do
        // nome velho. A feicao desenhada some do mapa do atlas e a op morre sem sair da fila.
        expect.soft(onde.achados.map((a) => a.chave),
            'a feicao desenhada por B esta no documento do mapa do atlas, e em nenhum outro').toEqual([mapId]);
        await collab.expectFullSyncFrom(B, { entityId: linhaId, type: 'lines', operationType: 'create' });
    });

    collabTest('(b) B esta em OUTRO mapa do atlas quando A renomeia', async ({ collab }) => {
        collabTest.setTimeout(240000);
        const A = collab.author;
        const B = collab.peers[0];
        const mapId = collab.mapId;

        // A cria o segundo mapa (criar ja' o torna ativo em A) e B vai para ele.
        await abrirAbaMapas(B);
        await criarMapaUI(A, SECOND_MAP);
        await expect
            .poll(() => B.locator(`.maps-tab .map-list-item[data-map-name="${SECOND_MAP}"]`).count(),
                { timeout: 30000, message: 'o segundo mapa nunca apareceu na lista de B' })
            .toBeGreaterThan(0);
        await trocarParaMapaUI(B, SECOND_MAP);
        await trocarParaMapaUI(A, SHARED_MAP);

        const antes = await retratoDoPar(B, { mapId, velho: SHARED_MAP, novo: NOVO_NOME });
        publicarRetrato('(b) B ANTES', antes);
        expect(antes.currentMapSync, 'pre-condicao: B esta no OUTRO mapa').toBe(SECOND_MAP);

        await collab.clearTraces();
        await renomearMapaAtualUI(A, NOVO_NOME);

        const depois = await esperarRenameEmB(B, { mapId, velho: SHARED_MAP, novo: NOVO_NOME });
        publicarRetrato('(b) B DEPOIS do rename remoto', depois);

        // --- 1. o mapa em que B esta NAO se mexe ---
        expect.soft(depois.currentMapSync, 'B continua no mapa em que estava').toBe(SECOND_MAP);
        expect.soft(depois.lastActiveMap, 'o ponteiro de mapa corrente de B nao se mexe').toBe(SECOND_MAP);

        // --- 2. nada fica orfao sob o nome velho ---
        expect.soft(depois.chavesDeMaps, 'memoryStore.maps de B nao guarda mais o nome velho').not.toContain(SHARED_MAP);
        expect.soft(depois.chavesDeLayers, 'memoryStore.layers de B nao guarda mais o nome velho').not.toContain(SHARED_MAP);
        expect.soft(depois.chavesDeGroups, 'memoryStore.groups de B nao guarda mais o nome velho').not.toContain(SHARED_MAP);
        expect.soft(depois.chavesTemporalView, 'memoryStore.temporalView de B nao guarda mais o nome velho').not.toContain(SHARED_MAP);

        // --- 3. o indice nao responde mais pelo nome velho ---
        expect.soft(depois.resolveIdParaNome, 'mapResolver: id -> nome').toBe(NOVO_NOME);
        expect.soft(depois.resolveVelhoParaId, 'mapResolver NAO pode continuar resolvendo o nome VELHO para este mapa')
            .not.toBe(mapId);

        // --- 4. a tela de B: a lista repinta e o cartao ativo continua sendo o do mapa dele ---
        expect.soft(depois.listaRepintou, 'a lista de mapas de B mostrou o nome novo').toBe(true);
        const ativos = depois.cartoesNaLista.filter((c) => c.selecionado === 'true').map((c) => c.nome);
        expect.soft(ativos, 'exatamente um cartao marcado como atual em B, o do mapa dele').toEqual([SECOND_MAP]);

        // --- 5. B volta ao mapa renomeado, desenha, e a feicao chega a A (o elo inteiro) ---
        await trocarParaMapaUI(B, NOVO_NOME);
        const linhaId = await drawLineUI(B, [[-43.26, -22.96], [-43.21, -22.91], [-43.16, -22.86]]);
        expect(linhaId, 'B conseguiu desenhar no mapa renomeado').toBeTruthy();
        const onde = await ondeCaiuAFeicao(B, linhaId);
        publicarRetrato('(b) onde caiu a feicao desenhada por B', onde);
        expect.soft(onde.achados.map((a) => a.chave),
            'a feicao desenhada por B esta no documento do mapa do atlas, e em nenhum outro').toEqual([mapId]);
        await collab.expectFullSyncFrom(B, { entityId: linhaId, type: 'lines', operationType: 'create' });
    });

    collabTest('(c) um F5 em B conserta o que o rename remoto deixou torto', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        const B = collab.peers[0];
        const mapId = collab.mapId;

        await abrirAbaMapas(B);
        await collab.clearTraces();
        await renomearMapaAtualUI(A, NOVO_NOME);
        await waitForRemoteEntity(B, mapId, { operationType: 'update', timeout: 30000 });
        await expect
            .poll(async () => (await retratoDoPar(B, { mapId, velho: SHARED_MAP, novo: NOVO_NOME })).nomeNoDisco,
                { timeout: 20000 })
            .toBe(NOVO_NOME);

        // F5 DE VERDADE: a barra de enderecos carrega `?atlas=<uuid>`, que e' a fonte da verdade do
        // boot (o boot NUNCA reabre o ultimo atlas remoto por conta propria).
        await B.reload();
        await expect(B.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 30000 });
        await B.waitForFunction(
            () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function' && globalThis.__ebgeoMap.loaded(),
            { timeout: 30000 },
        );
        await abrirAbaMapas(B);

        const depois = await retratoDoPar(B, { mapId, velho: SHARED_MAP, novo: NOVO_NOME });
        publicarRetrato('(c) B DEPOIS do F5', depois);

        expect(depois.currentMapSync, 'depois do F5 B esta no mapa renomeado').toBe(NOVO_NOME);
        expect(depois.resolveVelhoParaId, 'depois do F5 o indice nao conhece mais o nome velho').not.toBe(mapId);
        const cartao = depois.cartoesNaLista.find((c) => c.nome === NOVO_NOME);
        expect(cartao?.selecionado, 'depois do F5 o cartao do mapa renomeado e o atual').toBe('true');
    });
});
