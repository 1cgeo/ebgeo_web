// Path: e2e-ui/cursor-duravel-anda-com-a-cauda.spec.js

/**
 * @fileoverview O SEGUNDO RECARREGAMENTO PEDE MENOS REDE QUE O PRIMEIRO, e este arquivo mede isso
 * de ponta a ponta, contra o backend real.
 *
 * O MECANISMO ja' tem guarda (`tests/integration/abertura-remota-aplica-dois-retratos.repro.test.js`
 * prende a escrita do cursor). O que faltava era a CONSEQUENCIA: o cursor existe para encolher a
 * cauda que o `connect` pede, e ninguem media a cauda. Um `_advanceDurableCursor`
 * (`frontend/src/js/store/sync/sync-engine.js`) que parasse de escrever deixaria o mecanismo
 * vermelho em unidade, mas um que escrevesse num lugar que o `connect` seguinte nao le' ficaria
 * VERDE nos dois, com a rede intacta e ninguem sabendo. Aqui a asercao e' o pedido HTTP.
 *
 * O QUE FOI MEDIDO EM 2026-09-21, com N = 200 feicoes produzidas pelo PAR depois da abertura
 * (por uma copia instrumentada deste arquivo, temporaria e ja apagada, duas execucoes identicas):
 *
 *   | recarregamento | `since` pedido | operacoes na resposta | corpo    | cursor depois |
 *   |----------------|----------------|-----------------------|----------|---------------|
 *   | F5 numero 1    | 1              | 200                   | 117579 B | 201           |
 *   | F5 numero 2    | 201            | 0                     | 66 B     | 201           |
 *
 * Ou seja 117 513 bytes a menos no segundo, 1781 vezes menor, e a geracao ativa e' a MESMA nas
 * quatro leituras (retrato nenhum foi encenado: o encolhimento e' do cursor, nao de um wipe). As
 * 200 feicoes continuam no disco depois dos dois, que e' a metade que impede ler "cauda menor"
 * como perda.
 *
 * AQUI N E' MENOR DE PROPOSITO. O arquivo prende a PROPRIEDADE (a segunda cauda pede desde o
 * cursor novo e volta vazia), nao os numeros acima; 200 feicoes custam meio minuto a cada rodada
 * da suite por nada, porque a propriedade ja' aparece com 20.
 *
 * A CAUDA AO VIVO NAO MOVE O CURSOR, e e' isso que faz o primeiro F5 ainda ser caro: as operacoes
 * que chegaram pelo WebSocket estao no disco, mas so' a cauda do `connect` escreve o cursor. O
 * primeiro recarregamento e' que o leva ate' a versao do servidor.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test cursor-duravel-anda-com-a-cauda --retries=0 --reporter=line
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { seedSharedAtlas, openClient, currentMapName } from './helpers/collab-helpers.js';
import { expectAppBooted } from './helpers/boot-probe.js';

const state = readState();

/** Quantas feicoes o par produz depois da abertura. Ver o cabecalho: a propriedade ja aparece aqui. */
const N = 20;

// A corrida NAO e o sujeito deste arquivo, mas repetir um caso que mede REDE esconderia
// exatamente o desfecho que ele existe para acusar: um segundo recarregamento que puxe a cauda
// inteira passa na segunda tentativa, porque ai o cursor ja andou.
test.describe.configure({ retries: 0, timeout: 180000 });
test.skip(state.skip, 'Requires the real backend');

/** Le a geracao ativa e o cursor duravel do escopo montado. */
function lerGeracao(page) {
    return page.evaluate(async () => {
        const { readGeneration } = await import('/src/js/store/namespace-generation.js');
        const { getActiveScope } = await import('/src/js/store/atlas-namespace.js');
        return readGeneration(getActiveScope());
    });
}

/** Quantos pontos o mapa corrente tem no disco deste cliente. */
function contarPontos(page) {
    return page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        return ((await store.getCurrentMapFeatures())?.points || []).length;
    });
}

/**
 * Espera o atlas voltar de pe' depois de um recarregamento. Copiado de
 * `browser-collab-transferencia-origem-cheia.spec.js`: a badge online sozinha nao basta, porque o
 * mapa do atlas e' ativado depois dela.
 */
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

/**
 * Grava toda resposta de `GET /atlas/<id>/sync/<since>` desta pagina.
 *
 * O `since` sai do CAMINHO, que e' onde o cliente o escreve (`apiClient.pullSync`), e o corpo e'
 * lido de dentro do envelope (`{ success, data: { operations, currentVersion } }`): ler
 * `operations` do nivel de cima devolve `undefined` calado, e foi o que a primeira versao desta
 * medicao fez.
 */
function espionarPuxadas(page) {
    const puxadas = [];
    const pendentes = [];
    page.on('response', (resposta) => {
        const casa = /\/atlas\/[^/]+\/sync\/(\d+)$/.exec(new URL(resposta.url()).pathname);
        if (!casa || resposta.request().method() !== 'GET') return;
        pendentes.push((async () => {
            const registro = { since: Number(casa[1]), status: resposta.status(), ops: null, bytes: null };
            try {
                const corpo = await resposta.body();
                registro.bytes = corpo.length;
                const envelope = JSON.parse(corpo.toString('utf8'));
                const documento = envelope?.data ?? envelope;
                registro.ops = Array.isArray(documento?.operations) ? documento.operations.length : null;
                registro.retrato = Boolean(documento?.isSnapshot || documento?.snapshot);
                registro.currentVersion = documento?.currentVersion ?? null;
            } catch (erro) {
                registro.erro = String(erro).slice(0, 160);
            }
            puxadas.push(registro);
        })());
    });
    return {
        /** As puxadas que aconteceram desde `marca`, com os corpos ja lidos. */
        async desde(marca) {
            await Promise.allSettled(pendentes);
            return puxadas.slice(marca);
        },
        marca: () => puxadas.length,
    };
}

test('o segundo recarregamento pede a cauda desde o cursor novo, e ela vem vazia', async ({ browser }) => {
    const seed = await seedSharedAtlas(browser, state.baseUrl, { permission: 'write' });
    const A = await openClient(browser, state.baseUrl, seed.atlasId, seed.userA);
    try {
        const espiao = espionarPuxadas(A);
        const geracaoDaAbertura = await lerGeracao(A);

        // ---- O PAR produz N feicoes DEPOIS de A ter aberto, direto na API ----
        // Pela API e nao pela interface porque o sujeito aqui e' a rede do `connect`, e um
        // segundo navegador desenhando N pontos so' acrescentaria tempo e corrida.
        const seedPage = await browser.newPage();
        await seedPage.goto('/');
        const produzidas = await seedPage.evaluate(async ({ base, par, atlasId, mapId, n }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const api = new ApiClient({ baseUrl: `${base}/api/v1` });
            await api.login(par.username, par.password);
            const ops = [];
            for (let i = 0; i < n; i += 1) {
                const id = crypto.randomUUID();
                ops.push(createOperation('feature', 'create', id, mapId, {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [-43 - (i / 1000), -22] },
                    properties: { id, source: 'point', nome: `Ponto ${i}` },
                }));
            }
            await api.pushOperations(atlasId, ops);
            return ops.length;
        }, { base: state.baseUrl, par: seed.userB, atlasId: seed.atlasId, mapId: seed.mapId, n: N });
        await seedPage.close();
        expect(produzidas, 'o par produziu as feicoes').toBe(N);

        // ---- A as aplica AO VIVO, pelo WebSocket, e o cursor NAO anda com elas ----
        await expect
            .poll(() => contarPontos(A), {
                timeout: 90000,
                message: 'A nao aplicou ao vivo as feicoes do par',
            })
            .toBeGreaterThanOrEqual(N);
        const geracaoAntesDoF5 = await lerGeracao(A);
        expect(geracaoAntesDoF5.cursor, 'a cauda ao vivo nao move o cursor duravel')
            .toBe(geracaoDaAbertura.cursor);

        // ---- PRIMEIRO recarregamento: a cauda parte do cursor da ABERTURA e traz as N ----
        let marca = espiao.marca();
        await A.reload();
        await esperarAtlasDePe(A, seed.mapName, 'f5-1');
        const primeiro = await espiao.desde(marca);
        const geracaoDepoisDoPrimeiro = await lerGeracao(A);

        expect(primeiro.length, 'o primeiro recarregamento fez exatamente uma puxada').toBe(1);
        expect(primeiro[0].since, 'o primeiro F5 pede desde o cursor da abertura')
            .toBe(geracaoDaAbertura.cursor);
        expect(primeiro[0].retrato, 'o primeiro F5 recebeu uma CAUDA, nao um retrato').toBe(false);
        expect(primeiro[0].ops, 'a primeira cauda trouxe as feicoes do par').toBeGreaterThanOrEqual(N);
        // SOFT de proposito: o que este arquivo existe para medir e a REDE do segundo
        // recarregamento, abaixo. Parar aqui deixaria a asercao de rede sem execucao
        // justamente na rodada em que ela teria algo a dizer (foi o que o controle negativo
        // de 2026-09-21 mostrou: o vermelho saiu daqui e as tres linhas seguintes nunca
        // rodaram). O caso continua reprovando: `expect.soft` acumula, nao perdoa.
        expect.soft(geracaoDepoisDoPrimeiro.cursor, 'aplicada a cauda, o cursor andou ate a versao do servidor')
            .toBe(primeiro[0].currentVersion);
        expect.soft(geracaoDepoisDoPrimeiro.active, 'nenhum retrato foi encenado: a geracao e a mesma')
            .toBe(geracaoDaAbertura.active);

        // ---- SEGUNDO recarregamento: a cauda parte do cursor NOVO e volta vazia ----
        marca = espiao.marca();
        await A.reload();
        await esperarAtlasDePe(A, seed.mapName, 'f5-2');
        const segundo = await espiao.desde(marca);
        const geracaoDepoisDoSegundo = await lerGeracao(A);

        expect(segundo.length, 'o segundo recarregamento fez exatamente uma puxada').toBe(1);
        expect.soft(segundo[0].since, 'o segundo F5 pede desde o cursor que o primeiro escreveu')
            .toBe(geracaoDepoisDoPrimeiro.cursor);
        expect(segundo[0].since, 'o segundo F5 nao volta a pedir desde a abertura')
            .toBeGreaterThan(primeiro[0].since);
        expect(segundo[0].ops, 'a segunda cauda nao repuxa o que ja esta no disco').toBe(0);
        expect(segundo[0].bytes, 'a segunda cauda e menor que a primeira em corpo')
            .toBeLessThan(primeiro[0].bytes);
        expect(geracaoDepoisDoSegundo.active, 'continua sem retrato nenhum')
            .toBe(geracaoDaAbertura.active);

        // ---- E A CAUDA MENOR NAO E PERDA: as feicoes seguem no disco ----
        expect(await contarPontos(A), 'as feicoes do par sobreviveram aos dois recarregamentos')
            .toBeGreaterThanOrEqual(N);
    } finally {
        await A.context().close();
    }
});
