// Path: e2e-ui/browser-collab-transferencia-origem-cheia.spec.js

/**
 * @fileoverview O F5 RECONCILIA O CLIENTE COM O SERVIDOR DEPOIS DE UM MOVER CUJA ORIGEM NAO FOI
 * ESVAZIADA? Este arquivo mede, e o que ele afirma e' um RETRATO DO COMPORTAMENTO DE HOJE, nao um
 * desejo.
 *
 * DE ONDE VEM A PERGUNTA. `transferLayerToMap` (`frontend/src/js/store/layer-transfer.operations.js`,
 * bloco "THE SOURCE SIDE HAS THREE OUTCOMES") grava as feicoes no DESTINO com os MESMOS ids e so'
 * depois esvazia a ORIGEM. No servidor a feicao que chega com id ja' existente e' um upsert que
 * troca o `map_id`, isto e', MOVE a linha. Quando o esvaziamento da origem e' recusado no meio do
 * gesto (um par travou o mapa, o papel caiu), este cliente fica com as MESMAS feicoes nos DOIS
 * mapas e o servidor as tem so' no destino. A tela passou a dizer, nesse caso (`transferOutcomeNotice`,
 * `frontend/src/js/features_tab/layer-transfer-phrases.js`): "Recarregue a pagina para que elas
 * saiam do mapa de origem". (A primeira versao da frase prometia "voltar ao estado do servidor", e
 * foi ESTA medicao que a estreitou: o recarregamento tira da origem as feicoes que o mover levou,
 * e nao traz o estado do servidor, como o FANTASMA abaixo mostra.)
 *
 * O QUE FOI MEDIDO, EM 2026-09-21: SIM, O F5 RECONCILIA, E NAO E' POR RETRATO. A suspeita que
 * originou este arquivo era a oposta, e ela ERRAVA: o `connect` de fato pede so' a CAUDA
 * (`_pullInitialState`/`_durablePullCursor`, `frontend/src/js/store/sync/sync-engine.js`) e a
 * abertura normal de fato NAO esvazia o IndexedDB desde 2026-09-19 — a geracao ativa medida antes e
 * depois do F5 e' a MESMA, o que prova que retrato nenhum aconteceu. O que limpa a origem e' outra
 * coisa: o cursor duravel so' e' escrito pela ativacao de um retrato, entao ele fica parado no ponto
 * da ABERTURA e a cauda pedida no F5 ainda carrega as operacoes do proprio mover; a linha COMMITADA
 * do servidor carimba `previousMapId` no `feature create`, e ao reaplica-lo `applyRemoteFeatureOp`
 * (`frontend/src/js/store/sync/remote-operation-handler.js`) tira a feicao do mapa ANTERIOR antes de
 * grava-la no destino.
 *
 * E O LIMITE DA GARANTIA, que uma medicao so' das feicoes movidas esconderia: recarregar nao traz
 * "o estado do servidor", REAPLICA as operacoes que descrevem a mudanca. Por isso este arquivo
 * injeta tambem um FANTASMA, uma feicao de id inedito que so' existe neste disco e que nenhuma
 * operacao menciona: ele SOBREVIVE ao F5 e a' reabertura pela lista de atlas, e so' some no retrato
 * inteiro (M3). A frase da tela e' verdadeira para o caso que ela descreve, e seria falsa se fosse
 * lida como promessa geral.
 *
 * COMO A DIVERGENCIA E' PRODUZIDA, E POR QUE NAO SE TENTA GANHAR A CORRIDA. Travar o mapa de origem
 * no instante exato entre a escrita do destino e o esvaziamento e' uma corrida, e estatistica de
 * browser nao converge. O estado e' RECONSTRUIDO a mao no disco de A depois de um mover que
 * terminou inteiro: as mesmas feicoes voltam ao documento do mapa de origem pelo REPOSITORIO
 * (`getMapDataCompat`/`updateMapDataCompat`), sem passar por operacao de store nenhuma, entao nada
 * e' enfileirado e o servidor continua com elas so' no destino, que e' exatamente o estado do caso
 * recusado.
 *
 * DUAS INFIDELIDADES DECLARADAS DA RECONSTRUCAO, e nenhuma delas muda o desfecho medido:
 *  - as feicoes voltam sob a camada PADRAO da origem, e nao sob a camada transferida (cujo registro
 *    o mover ja' apagou). No caso real elas ficariam sob a camada original, que continua la'. A
 *    escolha isola a medicao de `cascadeRemoteLayerDelete`, que apagaria por acidente quem
 *    carregasse o `layerId` da camada excluida; quem limpa aqui e' o `previousMapId`, que nao olha
 *    camada nenhuma, entao o caso real converge pelo mesmo caminho;
 *  - no caso real nao existe op de `layer delete` nenhuma, porque a exclusao da camada de origem
 *    nunca acontece quando o esvaziamento e' recusado. As ops que fazem o trabalho (os
 *    `feature create` do destino, com `featureIntent: 'move'` e `sourceMapId`) existem nos dois.
 *
 * A QUARTA MEDICAO E' O CONTROLE. Sair da conta DESTROI o namespace remoto, entao reabrir o atlas
 * forca um retrato inteiro. O fantasma sumir ali, e so' ali, e' o que prova que as leituras
 * anteriores mediam o produto e nao a propria injecao.
 *
 * AS QUATRO MEDICOES SAO SEMPRE FEITAS, nunca condicionadas ao desfecho da anterior: asercao dentro
 * de `if` e' cobertura vazia com cara de verde.
 *
 * ESTE ARQUIVO E' UM RETRATO, E FICA VERMELHO QUANDO O COMPORTAMENTO MUDAR, que e' o ponto dele: se
 * um dia a abertura voltar a tirar retrato, M1 e M2 acusam a geracao nova; se o cursor duravel
 * passar a avancar com a cauda, a origem deixa de ser limpa e M1 acusa isso.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test browser-collab-transferencia-origem-cheia --retries=0 --reporter=line
 */

import { randomUUID } from 'node:crypto';
import {
    collabTest, expect, drawPointUI, readFeatures, currentMapName, openLayersTab,
} from './helpers/collab.fixtures.js';
import { loginUI, openAtlasUI } from './helpers/collab-helpers.js';
import { expectAppBooted } from './helpers/boot-probe.js';

const MAPA_DESTINO = 'Mapa Destino';
const NOME_DA_CAMADA = 'Camada Viajante';
const TIPO = 'points';

/** Drives a store op on `page` through the app's REAL store facade. */
function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

/** O id (chave UUID) de um mapa do atlas, pelo nome, lido do resolvedor do app. */
function idDoMapa(page, nome) {
    return page.evaluate(async (n) => {
        const { mapResolver } = await import('/src/js/store/services/map-resolver.service.js');
        return mapResolver.resolveToId(n) ?? null;
    }, nome);
}

/**
 * Abre a aba Mapas e espera ela ficar PRONTA.
 *
 * O BOTAO DA ABA E' UM ALTERNADOR: clicar com a aba ja' ativa COLAPSA a barra lateral. (Copiado de
 * `browser-collab-mapa-fantasma.spec.js`, onde as duas armadilhas foram medidas.)
 */
async function abrirAbaMapas(page) {
    const input = page.locator('.maps-tab #current-map-name-input');
    if (!(await input.isVisible().catch(() => false))) {
        await page.locator('.sidebar-nav-btn[data-tab="mapas"]').click();
    }
    await expect(input).toBeVisible({ timeout: 15000 });
    await expect(input).not.toHaveValue('', { timeout: 15000 });
}

/** Troca o mapa ativo clicando no cartao dele, REENVIANDO o clique ate' tomar. */
async function trocarParaMapaUI(page, nome) {
    await abrirAbaMapas(page);
    const cartao = page.locator(`.maps-tab .map-list-item[data-map-name="${nome}"]`);
    await expect(cartao).toBeVisible({ timeout: 20000 });
    await expect.poll(async () => {
        if (await currentMapName(page) === nome) return nome;
        const alvo = page.locator(`.maps-tab .map-list-item[data-map-name="${nome}"]`);
        if (await alvo.count() > 0) {
            await alvo.first().evaluate((el) => el.click()).catch(() => { /* re-render no meio */ });
        }
        return currentMapName(page);
    }, { timeout: 30000, message: `o mapa ativo nao virou "${nome}"` }).toBe(nome);
}

/**
 * QUANTAS DAQUELAS FEICOES A ARVORE DE CAMADAS DESENHA, que e' a pergunta da TELA.
 *
 * Leitura de DOM de proposito: o disco e a memoria ja' sao medidos pelo retrato, e um instrumento
 * que so' lesse o store nao distinguiria "o dado esta' la'" de "a pessoa ve' o dado".
 */
async function contarNaArvore(page, ids) {
    await openLayersTab(page);
    for (const icone of await page.locator('.layer-expand-icon.collapsed').all()) {
        await icone.click().catch(() => { /* re-render no meio da expansao */ });
    }
    let total = 0;
    for (const id of ids) {
        total += await page.locator(`.feature-item[data-feature-id="${id}"]`).count();
    }
    return total;
}

/** O RETRATO DO CLIENTE: disco dos dois mapas, caminho independente pelo barril, geracao e fila. */
function retratoDoCliente(page, { mapa1, mapa2, ids, fantasma }) {
    return page.evaluate(async (q) => {
        const store = await import('/src/js/store/index.js');
        const { getRepository, getMapDataCompat, getAllMapKeysCompat } =
            await import('/src/js/store/repositories/index.js');
        const repo = getRepository();
        const idsDe = (doc) => (doc?.features?.[q.tipo] || []).map((f) => f.properties?.id);
        const doc1 = await repo.getMap(q.m1);
        const doc2 = await repo.getMap(q.m2);
        // O SEGUNDO CAMINHO, de proposito: `getMapDataCompat` e' o mesmo funil que a escrita usou,
        // entao ele sozinho nao separa "gravou" de "devolveu o que estava em maos".
        const viaStore = await store.getMapDataStore(q.m1);
        let geracao = null;
        try {
            const { readGeneration } = await import('/src/js/store/namespace-generation.js');
            const { getActiveScope } = await import('/src/js/store/atlas-namespace.js');
            geracao = readGeneration(getActiveScope());
        } catch (erro) {
            geracao = { erro: String(erro?.message ?? erro) };
        }
        let fila = null;
        try {
            const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
            fila = await operationQueue.countByState();
        } catch {
            fila = null;
        }
        return {
            mapaCorrente: store.getCurrentMapNameSync(),
            mapaCorrenteId: store.getCurrentMapIdSync(),
            chavesDeMapa: (await getAllMapKeysCompat()) ?? [],
            origemNoDisco: idsDe(doc1).filter((id) => q.ids.includes(id)),
            origemTotalDoTipo: idsDe(doc1).length,
            origemPeloBarril: (viaStore?.features?.[q.tipo] || [])
                .map((f) => f.properties?.id).filter((id) => q.ids.includes(id)),
            origemViaCompat: ((await getMapDataCompat(q.m1))?.features?.[q.tipo] || [])
                .map((f) => f.properties?.id).filter((id) => q.ids.includes(id)),
            destinoNoDisco: idsDe(doc2).filter((id) => q.ids.includes(id)),
            destinoTotalDoTipo: idsDe(doc2).length,
            // O CONTROLE QUE DELIMITA O MECANISMO: uma feicao que so' existe neste disco, que
            // NENHUMA operacao menciona e que o servidor nunca viu.
            fantasmaNaOrigem: idsDe(doc1).includes(q.fantasma),
            fantasmaNoDestino: idsDe(doc2).includes(q.fantasma),
            geracao,
            fila,
        };
    }, { m1: mapa1, m2: mapa2, ids, fantasma, tipo: TIPO });
}

/**
 * A TRAJETORIA DO DOCUMENTO DE ORIGEM NO DISCO, amostrada DENTRO da pagina.
 *
 * Uma leitura unica nao distingue "o estado e' este" de "o estado ainda esta' assentando", e a
 * primeira versao deste arquivo injetou a divergencia enquanto a cauda do proprio gesto ainda
 * escrevia: as duas feicoes viraram uma e depois nenhuma, DENTRO de um unico retrato. A serie
 * transforma isso num fato legivel em vez de num vermelho ambiguo.
 */
function serieDoDisco(page, { mapa1, amostras, intervalo }) {
    return page.evaluate(async (q) => {
        const { getRepository } = await import('/src/js/store/repositories/index.js');
        const repo = getRepository();
        let operationQueue = null;
        try {
            ({ operationQueue } = await import('/src/js/store/sync/operation-queue.js'));
        } catch {
            operationQueue = null;
        }
        const serie = [];
        for (let i = 0; i < q.n; i++) {
            const doc = await repo.getMap(q.m1);
            let fila = null;
            try {
                fila = await operationQueue?.countByState() ?? null;
            } catch {
                fila = null;
            }
            serie.push({
                ms: i * q.dt,
                pontos: (doc?.features?.[q.tipo] || []).map((f) => f.properties?.id),
                fila,
            });
            await new Promise((resolve) => setTimeout(resolve, q.dt));
        }
        return serie;
    }, { m1: mapa1, n: amostras, dt: intervalo, tipo: TIPO });
}

/** Resume uma serie em contagens, que e' o que se le' de relance. */
const contagens = (serie) => serie.map((a) => a.pontos.length);

/**
 * RECONSTROI A DIVERGENCIA NO DISCO DE A: as feicoes que o servidor ja' moveu voltam ao documento
 * do mapa de ORIGEM, pelo repositorio, sem operacao de store nenhuma.
 */
function reconstruirDivergencia(page, { mapa1, mapa2, ids, fantasma }) {
    return page.evaluate(async (q) => {
        const { getMapDataCompat, updateMapDataCompat, getLayersCompat, getAllMapKeysCompat } =
            await import('/src/js/store/repositories/index.js');
        const chaves = (await getAllMapKeysCompat()) ?? [];
        // O MAPA DE ORIGEM TEM DE EXISTIR NO DISCO: `getMapDataCompat` FABRICA um documento vazio
        // para uma chave que nao existe, e gravar isso criaria um mapa fantasma em vez de medir.
        if (!chaves.includes(q.m1)) return { erro: 'o mapa de origem nao esta no disco', chaves };
        const destino = await getMapDataCompat(q.m2);
        const viajantes = (destino?.features?.[q.tipo] || [])
            .filter((f) => q.ids.includes(f.properties?.id))
            .map((f) => JSON.parse(JSON.stringify(f)));
        const camadas = (await getLayersCompat(q.m1)) || [];
        const camadaPadrao = camadas[0]?.id ?? null;
        if (!camadaPadrao) return { erro: 'o mapa de origem nao tem camada nenhuma', camadas };
        const origem = await getMapDataCompat(q.m1);
        origem.features = origem.features || {};
        origem.features[q.tipo] = origem.features[q.tipo] || [];
        for (const f of viajantes) {
            f.properties = { ...f.properties, layerId: camadaPadrao };
            origem.features[q.tipo].push(f);
        }
        // O FANTASMA: uma feicao de id INEDITO, so' neste disco, que o servidor nunca viu e que
        // nenhuma operacao da cauda menciona. Ele e' o que separa "o recarregamento traz o estado
        // do servidor" de "o recarregamento reaplica as operacoes que descrevem a mudanca".
        if (viajantes.length > 0) {
            const copia = JSON.parse(JSON.stringify(viajantes[0]));
            copia.id = Date.now();
            copia.properties = { ...copia.properties, id: q.fantasma, nome: 'Fantasma local' };
            origem.features[q.tipo].push(copia);
        }
        await updateMapDataCompat(q.m1, origem);
        return {
            injetadas: viajantes.map((f) => f.properties?.id),
            fantasma: q.fantasma,
            camadaPadrao,
            camadas: camadas.map((c) => ({ id: c.id, name: c.name })),
        };
    }, { m1: mapa1, m2: mapa2, ids, fantasma, tipo: TIPO });
}

/** A VERDADE DO SERVIDOR, lida por SQL: em qual mapa cada feicao esta', e se foi apagada. */
async function verdadeDoServidor(db, ids) {
    if (!db) return '(sem conexao SQL nesta rodada)';
    const linhas = await db.raw.any(
        'SELECT id, map_id, layer_id, deleted_at FROM features WHERE id = ANY($1::uuid[])', [ids]);
    return linhas.map((l) => ({ id: l.id, mapId: l.map_id, apagada: l.deleted_at !== null }));
}

/** Vai para a pagina de atlas pelo gesto real ("Meus Atlas", no menu da conta). */
async function irParaMeusAtlas(page) {
    await page.locator('[data-testid="account-control"] .account-control__identity').click();
    const botao = page.locator('[data-testid="account-projects-btn"]');
    await expect(botao).toBeVisible({ timeout: 10000 });
    await botao.click();
    await page.waitForURL('**/atlas.html', { timeout: 30000 });
    await expect(page.locator('[data-testid="project-picker-modal"]')).toBeVisible({ timeout: 20000 });
}

/** Sai da conta pelo menu, confirmando o dialogo de pendencias se ele aparecer. */
async function sairDaConta(page) {
    await page.locator('[data-testid="account-control"] .account-control__identity').click();
    await page.locator('[data-testid="account-logout-btn"]').click();
    const confirmar = page.getByRole('button', { name: 'Sair e descartar pendências', exact: true });
    const entrar = page.locator('[data-testid="account-login-btn"]');
    await expect(entrar.or(confirmar).filter({ visible: true })).toBeVisible({ timeout: 30000 });
    const perguntou = await confirmar.isVisible().catch(() => false);
    if (perguntou) await confirmar.click();
    await expect(entrar).toBeVisible({ timeout: 30000 });
    return perguntou;
}

/** Espera o mapa do atlas voltar a estar de pe' depois de uma recarga/reabertura. */
async function esperarAtlasDePe(page, mapaEsperado, rotulo) {
    await expectAppBooted(page, { rotulo });
    await expect(page.locator('[data-testid="sync-status-badge"]'))
        .toHaveAttribute('data-state', 'online', { timeout: 40000 });
    await page.waitForFunction(
        () => globalThis.__ebgeoMap && typeof globalThis.__ebgeoMap.getZoom === 'function'
            && globalThis.__ebgeoMap.loaded(),
        { timeout: 40000 },
    );
    await expect
        .poll(() => currentMapName(page), {
            timeout: 40000,
            message: `${rotulo}: o mapa "${mapaEsperado}" nao voltou a ser o corrente`,
        })
        .toBe(mapaEsperado);
}

/** Imprime cada medicao antes de qualquer asercao, para o vermelho nao esconder o retrato. */
function publicar(rotulo, valor) {
    console.log(`\n===== ${rotulo} =====\n${JSON.stringify(valor, null, 2)}\n`);
}

collabTest.describe('Mover camada com a ORIGEM CHEIA: o recarregamento reconcilia?', () => {
    // A corrida NAO e' o sujeito aqui (a divergencia e' reconstruida a mao), mas o retry
    // transformaria uma medicao perdida num verde, que e' o que a constituicao chama de medicao
    // unica de algo probabilistico.
    collabTest.describe.configure({ retries: 0 });

    collabTest('o F5, "Meus Atlas" e a saida da conta, medidos um a um', async ({ collab }) => {
        collabTest.setTimeout(600000);
        const A = collab.author;
        const mapa1Nome = collab.mapName;
        const mapa1Id = collab.mapId;

        // ---- 1. o gesto normal: uma camada com duas feicoes vai do mapa 1 para o mapa 2 ----
        const p1 = await drawPointUI(A, [-43.21, -22.91]);
        const p2 = await drawPointUI(A, [-43.19, -22.89]);
        const ids = [p1, p2];
        expect(ids.every(Boolean), 'os dois pontos nasceram').toBe(true);
        expect(await currentMapName(A), 'A esta no mapa compartilhado').toBe(mapa1Nome);

        await applyStoreOp(A, 'addMap', [MAPA_DESTINO]);
        await expect
            .poll(() => idDoMapa(A, MAPA_DESTINO), {
                timeout: 30000, message: 'o mapa de destino nunca ganhou id de atlas',
            })
            .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        const mapa2Id = await idDoMapa(A, MAPA_DESTINO);

        const camada = await applyStoreOp(A, 'createLayer', [NOME_DA_CAMADA]);
        const camadaId = camada?.id ?? camada;
        expect(camadaId, 'a camada de origem nasceu').toBeTruthy();
        await applyStoreOp(A, 'moveFeaturesToLayer', [
            ids.map((id) => ({ type: 'point', id })), camadaId,
        ]);
        await expect
            .poll(async () => (await readFeatures(A, TIPO))
                .filter((f) => f.props?.layerId === camadaId).length)
            .toBe(2);

        const mover = await applyStoreOp(A, 'transferLayerToMap', [
            camadaId, MAPA_DESTINO, { mode: 'move' },
        ]);
        publicar('O MOVER', mover);
        expect(mover?.success, JSON.stringify(mover)).toBe(true);
        expect(mover.movedCount).toBe(2);
        expect(mover.sourceEmptied, 'o mover terminou INTEIRO (a divergencia e reconstruida depois)').toBe(true);

        // ---- 2. o servidor precisa ter as duas no DESTINO antes de qualquer reconstrucao ----
        await expect
            .poll(async () => {
                const linhas = await verdadeDoServidor(collab.db, ids);
                return Array.isArray(linhas)
                    && linhas.length === 2
                    && linhas.every((l) => l.mapId === mapa2Id && !l.apagada);
            }, { timeout: 60000, message: 'o servidor nunca moveu as duas feicoes para o mapa de destino' })
            .toBe(true);
        const servidorAntes = await verdadeDoServidor(collab.db, ids);
        publicar('O SERVIDOR, depois do mover', servidorAntes);

        // ---- 2b. ESPERAR A CAUDA DO PROPRIO GESTO ASSENTAR ----
        // A linha no Postgres aparece ANTES de o cliente terminar de processar os recibos do lote,
        // e escrever o disco dentro dessa janela e' um lost update contra o proprio produto: a
        // primeira versao deste arquivo injetou ali e viu as duas feicoes virarem uma e depois
        // nenhuma. O criterio e' ESTADO (o documento parou de mudar e a fila esvaziou), nunca prazo.
        const serieAntes = await serieDoDisco(A, { mapa1: mapa1Id, amostras: 24, intervalo: 250 });
        publicar('A CAUDA DO GESTO assentando (contagem de pontos na origem)', {
            contagens: contagens(serieAntes),
            filaFinal: serieAntes[serieAntes.length - 1]?.fila ?? null,
        });
        expect(contagens(serieAntes).slice(-8), 'a origem parou de mudar antes da reconstrucao')
            .toEqual([0, 0, 0, 0, 0, 0, 0, 0]);

        // ---- 3. a divergencia, reconstruida a mao no disco de A ----
        const fantasma = randomUUID();
        const reconstrucao = await reconstruirDivergencia(A, {
            mapa1: mapa1Id, mapa2: mapa2Id, ids, fantasma,
        });
        publicar('A RECONSTRUCAO', reconstrucao);
        expect(reconstrucao.erro, JSON.stringify(reconstrucao)).toBeUndefined();
        expect(reconstrucao.injetadas.sort(), 'as duas feicoes voltaram ao documento da origem')
            .toEqual([...ids].sort());

        // A INJECAO TEM DE FICAR DE PE', e isso se mede em SERIE: um unico verde logo apos a
        // escrita nao distingue "gravou" de "gravou e algo vai sobrescrever daqui a 300 ms".
        // Tres pontos: as duas que o servidor ja' moveu, mais o fantasma.
        const serieDepois = await serieDoDisco(A, { mapa1: mapa1Id, amostras: 24, intervalo: 250 });
        publicar('A INJECAO, medida em serie', {
            contagens: contagens(serieDepois),
            filaFinal: serieDepois[serieDepois.length - 1]?.fila ?? null,
        });
        expect(contagens(serieDepois).slice(-8), 'a divergencia injetada ficou de pe no disco')
            .toEqual([3, 3, 3, 3, 3, 3, 3, 3]);

        const retrato = (rotulo) => retratoDoCliente(A, { mapa1: mapa1Id, mapa2: mapa2Id, ids, fantasma })
            .then((r) => { publicar(rotulo, r); return r; });

        const m0 = await retrato('M0 — logo depois da reconstrucao (disco)');
        expect(m0.origemNoDisco.sort(), 'M0: a origem tem as duas de volta no disco').toEqual([...ids].sort());
        expect(m0.origemPeloBarril.sort(), 'M0: e o barril do store le a mesma coisa').toEqual([...ids].sort());
        expect(m0.destinoNoDisco.sort(), 'M0: o destino continua com as duas').toEqual([...ids].sort());
        expect(m0.fantasmaNaOrigem, 'M0: o fantasma local tambem esta na origem').toBe(true);

        // E NA TELA. A arvore so' repinta quando o mapa e' reativado, entao a ida e volta pelo
        // cartao do mapa e' o que transforma a escrita de disco em pixel.
        await trocarParaMapaUI(A, MAPA_DESTINO);
        await trocarParaMapaUI(A, mapa1Nome);
        const telaM0 = await contarNaArvore(A, [...ids, fantasma]);
        publicar('M0 — a TELA (feicoes desenhadas na arvore da origem, fantasma incluso)', telaM0);
        expect(telaM0, 'M0: a pessoa VE as tres feicoes no mapa de origem').toBe(3);

        const m0b = await retrato('M0b — depois da ida e volta entre os mapas');
        expect(m0b.origemNoDisco.sort(), 'M0b: a troca de mapa nao desfez a reconstrucao').toEqual([...ids].sort());

        // ---- 4. M1: O F5 ----
        const geracaoAntesDoF5 = m0b.geracao?.active ?? null;
        await A.reload();
        await esperarAtlasDePe(A, mapa1Nome, 'f5');
        const m1 = await retrato('M1 — DEPOIS DO F5 (disco)');
        const telaM1 = await contarNaArvore(A, ids);
        const telaFantasmaM1 = await contarNaArvore(A, [fantasma]);
        const servidorM1 = await verdadeDoServidor(collab.db, ids);
        publicar('M1 — DEPOIS DO F5 (tela)', { movidas: telaM1, fantasma: telaFantasmaM1 });
        publicar('M1 — DEPOIS DO F5 (servidor)', servidorM1);
        publicar('M1 — geracao', { antes: geracaoAntesDoF5, depois: m1.geracao?.active ?? null });

        // ---- 5. M2: sair do atlas e reabrir por "Meus Atlas" ----
        await irParaMeusAtlas(A);
        await openAtlasUI(A, collab.atlasId);
        await esperarAtlasDePe(A, mapa1Nome, 'meus-atlas');
        const m2 = await retrato('M2 — DEPOIS DE REABRIR POR "MEUS ATLAS" (disco)');
        const telaFantasmaM2 = await contarNaArvore(A, [fantasma]);
        publicar('M2 — DEPOIS DE REABRIR POR "MEUS ATLAS" (tela do fantasma)', telaFantasmaM2);
        publicar('M2 — geracao', { antes: m1.geracao?.active ?? null, depois: m2.geracao?.active ?? null });

        // ---- 6. M3: o RETRATO INTEIRO — sair da conta e entrar de novo ----
        const perguntouPendencias = await sairDaConta(A);
        publicar('M3 — a saida perguntou por pendencias?', perguntouPendencias);
        await loginUI(A, collab.userA.username, collab.userA.password);
        await openAtlasUI(A, collab.atlasId);
        await esperarAtlasDePe(A, mapa1Nome, 'pos-logout');
        const m3 = await retrato('M3 — DEPOIS DE SAIR E ENTRAR DE NOVO (disco)');
        const telaFantasmaM3 = await contarNaArvore(A, [fantasma]);
        const servidorM3 = await verdadeDoServidor(collab.db, ids);
        publicar('M3 — DEPOIS DE SAIR E ENTRAR DE NOVO (tela do fantasma)', telaFantasmaM3);
        publicar('M3 — DEPOIS DE SAIR E ENTRAR DE NOVO (servidor)', servidorM3);
        publicar('M3 — geracao', { antes: m2.geracao?.active ?? null, depois: m3.geracao?.active ?? null });

        // ================== O QUE FOI MEDIDO (retrato de 2026-09-21) ==================
        //
        // O SERVIDOR NAO SE MEXE em nenhuma das medicoes: as duas feicoes seguem so' no mapa de
        // destino, vivas, e o fantasma nunca existiu la'.
        expect(servidorM3, 'o servidor manteve as duas feicoes so no destino o tempo todo')
            .toEqual(servidorAntes);

        // M1 — O F5 RECONCILIA, E NAO E' POR RETRATO. A geracao ativa NAO muda, isto e', o
        // `connect` pediu so' a CAUDA (`_durablePullCursor`, `frontend/src/js/store/sync/sync-engine.js`):
        // o cursor duravel so' e' escrito pela ativacao de um retrato, entao ele continua no ponto
        // da ABERTURA e a cauda ainda carrega as operacoes do proprio mover. Quem limpa a origem e'
        // o `previousMapId` que a linha COMMITADA do servidor carimba no `feature create`: ao
        // reaplica-lo, `applyRemoteFeatureOp` (`frontend/src/js/store/sync/remote-operation-handler.js`)
        // tira a feicao do mapa ANTERIOR antes de grava-la no destino. A frase da tela
        // ("Recarregue a pagina para que elas saiam do mapa de origem", `transferOutcomeNotice`,
        // `frontend/src/js/features_tab/layer-transfer-phrases.js`) e' portanto VERDADE para a
        // feicao que o mover levou.
        expect(m1.origemNoDisco, 'M1: o F5 TIROU da origem as feicoes que o servidor ja movera').toEqual([]);
        expect(telaM1, 'M1: e a pessoa deixa de ve-las no mapa de origem').toBe(0);
        expect(m1.destinoNoDisco.sort(), 'M1: elas continuam no destino').toEqual([...ids].sort());
        expect(m1.geracao?.active ?? null, 'M1: e isso aconteceu SEM retrato novo (a geracao nao mudou)')
            .toBe(geracaoAntesDoF5);

        // O LIMITE DA GARANTIA, e ele e' o achado que uma medicao so' das duas feicoes esconderia:
        // o recarregamento NAO traz "o estado do servidor", ele REAPLICA as operacoes que descrevem
        // a mudanca. O fantasma, que nenhuma operacao menciona, SOBREVIVE ao F5. Uma divergencia
        // local que nao tenha op correspondente na cauda continua na tela depois de recarregar.
        expect(m1.fantasmaNaOrigem, 'M1: o fantasma local SOBREVIVE ao F5 (a cauda nao fala dele)').toBe(true);
        expect(telaFantasmaM1, 'M1: e ele continua desenhado').toBe(1);

        // M2 — REABRIR POR "MEUS ATLAS" DA' O MESMO RESULTADO, pelo mesmo caminho: o gesto leva ao
        // mesmo `?atlas=<id>`, com a mesma geracao e o mesmo cursor. E' um F5 com mais cliques.
        expect(m2.origemNoDisco, 'M2: reabrir pela lista de atlas reconcilia igual').toEqual([]);
        expect(m2.fantasmaNaOrigem, 'M2: e o fantasma tambem sobrevive a ele').toBe(true);
        expect(telaFantasmaM2, 'M2: desenhado').toBe(1);
        expect(m2.geracao?.active ?? null, 'M2: tambem sem retrato novo').toBe(geracaoAntesDoF5);

        // M3 — SO' O RETRATO INTEIRO APAGA O FANTASMA. Sair da conta destroi o namespace remoto,
        // entao a reabertura pede um snapshot e o disco passa a ser o que o servidor tem. E' este o
        // unico gesto medido que entrega literalmente "o estado do servidor".
        expect(m3.geracao?.active ?? null, 'M3: houve retrato novo (a geracao ativa mudou)')
            .not.toBe(geracaoAntesDoF5);
        expect(m3.fantasmaNaOrigem, 'M3: o fantasma local finalmente some').toBe(false);
        expect(telaFantasmaM3, 'M3: e sai da tela').toBe(0);
        expect(m3.origemNoDisco, 'M3: a origem segue sem as feicoes movidas').toEqual([]);
        expect(m3.destinoNoDisco.sort(), 'M3: o destino continua com as duas, que e o estado do servidor')
            .toEqual([...ids].sort());
    });
});
