// Path: e2e-ui/browser-collab-three-client-flow.spec.js

/**
 * THREE-CLIENT FLOW — three real browsers + real backend, on the full-chain harness. A
 * multi-phase session so roster/membership and convergence are exercised under changing
 * state, not just one broadcast:
 *
 *   1. all three create a feature        → each traverses the chain to the other two.
 *   2. C edits A's feature               → the edit traverses the chain to A and B.
 *   3. three-way conflict on ONE feature → ONE edit applies and the other two come back as
 *                                          `conflict` naming the disputed unit, and all three
 *                                          converge to the value POSTGRES holds (not merely
 *                                          to each other). Until 2026-09-13 all three applied
 *                                          and the last arrival overwrote the rest; see the
 *                                          inverted assertion inline and the header of
 *                                          `browser-collab-crdt-conflict.spec.js`. Os três
 *                                          gestos acontecem com a REDE DERRUBADA, porque é isso
 *                                          que garante a base única de que a contagem depende;
 *                                          o porquê está por extenso na fase.
 *   4. a late joiner (C reconnects)      → A's offline-window write reaches B (full chain),
 *                                          and C catches up via snapshot (convergence check).
 *   5. C deletes a feature               → the delete traverses the chain to A and B.
 *
 * Run headed:  npx playwright test browser-collab-three-client-flow --headed
 */

import {
    collabTest, expect, readFeatures, drawLineUI, vereditoDoCommitDeCor,
} from './helpers/collab.fixtures.js';
import { waitForEntitySpan, waitForAcked } from './helpers/trace-helpers.js';

const lineColor = async (page, id) => (await readFeatures(page, 'lines')).find((x) => x.id === id)?.props?.lineColor;

/**
 * Waits until EVERY client agrees with the value the server holds AT THAT MOMENT, and
 * returns it. Same helper (and same reasoning) as `browser-collab-crdt-conflict.spec.js`.
 *
 * Two things this states that "os clientes concordam entre si" does not:
 *   - Agreement between peers is not convergence. There is a real window where one op has
 *     propagated to all three while another is still in flight, so everyone legitimately
 *     shows a value the server is about to overwrite. A peers-only poll exits on that
 *     way-station and calls it proof.
 *   - The server is the authority (LWW by ARRIVAL order). If the backend stored a value no
 *     client ever shows, three agreeing clients are three clients that are all wrong.
 *
 * Server and clients are sampled TOGETHER on each attempt, because an op can still be
 * sitting in an outbound queue and flush later, legitimately moving the winner after a
 * one-shot read: fixing the winner up front makes the assertion demand a stale snapshot.
 * A permanent divergence never satisfies the poll and the message names both sides.
 */
async function convergedColor(db, pages, id, timeout = 30000) {
    let valor = null;
    await expect
        .poll(async () => {
            const row = await db.queryFeatureRow(id);
            const servidor = String(row?.properties?.lineColor ?? '').toLowerCase();
            if (!servidor) return null;
            const clientes = await Promise.all(
                pages.map(async (p) => String(await lineColor(p, id)).toLowerCase()),
            );
            valor = clientes.every((c) => c === servidor) ? servidor : null;
            return valor ?? `servidor=${servidor} clientes=${clientes.join(',')}`;
        }, { timeout, message: 'os três clientes concordam com o valor que o servidor tem AGORA' })
        .toMatch(/^#[0-9a-f]{6}$/);
    return valor;
}

/**
 * Anchors one client's edit ON THE SERVER, in two halves. `push.ack` is the only outbound
 * stage guaranteed for all three writers (`remote.applied` is not: the losers can be
 * legitimately discarded by the peer's convergence guard), and it also removes the
 * outbound-queue race (flush is on a 1.5s interval). The halves are separate because the
 * stages are keyed differently (`enqueue` carries `entityId`, `push.ack` carries only `opId`,
 * since the server acks by operation id) AND because the conflict phase needs to cobrar the
 * first half with the network down.
 */
async function expectEnqueued(page, quem, entityId, operationType = 'update') {
    const enq = await waitForEntitySpan(page, { entityId, operationType, stage: 'enqueue' }, 25000);
    // A MENSAGEM DISTINGUE DE QUEM E O DEFEITO, e essa distincao e o experimento, nao decoracao.
    // `vereditoDoCommitDeCor` (`helpers/collab-helpers.js`) le o que o driver observou no instante
    // do commit: se o painel estava sobre a feicao pedida nos dois instantes e a operacao mesmo
    // assim nao nasceu, o defeito e do PRODUTO (uma edicao de usuario evapora quando chega trafego
    // remoto no meio do gesto); se nao estava, o defeito e do HARNESS, que digitou no vazio porque
    // o painel nao publica o alvo no DOM. Sem isto, o vermelho e um `toBeTruthy() -> null` que nao
    // diz nada a quem o ler daqui a tres meses.
    //
    // A PERGUNTA QUE ELE FAZIA FOI RESPONDIDA EM 2026-09-15, E A RESPOSTA FOI PRODUTO: a previa do
    // painel vivia so' na fonte do MapLibre, o redesenho disparado por qualquer op remota
    // (`layers/remote-feature-render.js`) a apagava, e `saveFeatures` persistia a copia DA FONTE,
    // de modo que `updateFeature` saia cedo por `isFeatureEqual` sem registrar operacao nenhuma.
    // Conserto em `tool_manager/helpers/pending-edit.helpers.js`; repro deterministica em
    // `tests/e2e-ui/edicao-pendente-sobrevive-a-op-remota.repro.spec.js`. A mensagem fica, porque
    // e o que transforma o proximo vermelho desta linha em diagnostico.
    expect(enq, `a edição de ${quem} virou operação na fila\n  ${vereditoDoCommitDeCor(page)}`)
        .toBeTruthy();
    return enq;
}

/**
 * E O SERVIDOR A RECEBEU. Separado do passo acima porque a fase 3 enfileira com a rede
 * derrubada e só então a devolve: enfileirar é local (offline-first), reconhecer não é.
 */
async function expectAcked(page, enq, timeout = 25000) {
    await waitForAcked(page, enq.opId, timeout);
}

const COORDS_A = [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]];
const COORDS_B = [[-43.3, -23.0], [-43.25, -22.95], [-43.2, -22.9]];
const COORDS_C = [[-43.1, -22.7], [-43.05, -22.65], [-43.0, -22.6]];
const COORDS_LATE = [[-43.4, -23.1], [-43.35, -23.05], [-43.3, -23.0]];

// ── Inline UI drivers (hardened for the late-join client, whose live source can lag) ──

async function openLayersTab(page) {
    if ((await page.locator('.layer-container').count()) === 0) {
        await page.locator('.sidebar-nav-btn[data-tab="camadas"]').click();
    }
    await expect(page.locator('.layer-container').first()).toBeVisible({ timeout: 10000 });
}

async function dismissFeaturePanel(page) {
    if ((await page.locator('.feature-panel[data-expanded="true"]').count()) === 0) return;
    await page.keyboard.press('Escape');
    await expect(page.locator('.feature-panel[data-expanded="true"]')).toHaveCount(0, { timeout: 5000 });
    await page.waitForTimeout(350);
}

function lineInMapSource(page, featureId) {
    return page.evaluate(async (id) => {
        const src = globalThis.__ebgeoMap?.getSource('lines');
        if (!src || typeof src.getData !== 'function') return false;
        const data = await src.getData();
        return ((data && data.features) || []).some((f) => f.properties?.id === id);
    }, featureId);
}

function nudgeLayersRefresh(page) {
    return page.evaluate(async () => {
        const store = await import('/src/js/store/index.js');
        store.getEventBus().emit('layers:changed', { mapName: store.getCurrentMapNameSync() });
    });
}

async function selectFeatureUI(page, featureId) {
    await dismissFeaturePanel(page);
    await openLayersTab(page);
    await expect.poll(() => lineInMapSource(page, featureId), { timeout: 20000 }).toBe(true);
    const row = page.locator(`.feature-item[data-feature-id="${featureId}"] .feature-main`).first();
    await expect
        .poll(async () => {
            await nudgeLayersRefresh(page);
            for (const icon of await page.locator('.layer-expand-icon.collapsed').all()) {
                await icon.click().catch(() => {});
            }
            return row.count();
        }, { timeout: 30000 })
        .toBeGreaterThan(0);
    await expect(row).toBeVisible({ timeout: 10000 });
    await row.evaluate((el) => el.click());
    await expect(page.locator('.feature-panel[data-expanded="true"]')).toBeVisible({ timeout: 10000 });
}

async function recolorViaPanelUI(page, hex) {
    const panel = page.locator('.feature-panel[data-expanded="true"]');
    const native = panel.locator('.color-picker-native-hidden').first();
    await expect(native).toBeAttached({ timeout: 5000 });
    await native.evaluate((el, value) => {
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }, hex);
    await page.waitForFunction(
        async (h) => {
            const src = globalThis.__ebgeoMap?.getSource('lines');
            if (!src || typeof src.getData !== 'function') return false;
            const data = await src.getData();
            return ((data && data.features) || []).some((f) => String(f.properties?.lineColor).toLowerCase() === h.toLowerCase());
        },
        hex,
        { timeout: 5000 },
    );
    const saveBtn = panel.locator('.attr-modern-btn-save');
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
    await saveBtn.click();
}

async function selectAndRecolorUI(page, featureId, hex) {
    await selectFeatureUI(page, featureId);
    await recolorViaPanelUI(page, hex);
}

async function deleteFeatureUI(page, featureId) {
    await selectFeatureUI(page, featureId);
    await page.keyboard.press('Delete');
    const confirmBtn = page.locator('.confirm-modal-btn-confirm');
    await expect(confirmBtn).toBeVisible({ timeout: 5000 });
    await confirmBtn.click();
}

collabTest.describe('Three-client flow — multi-phase session with three collaborators', () => {
    collabTest.use({ collabOptions: { peers: 2, permission: 'write', mapName: 'Mapa Tático' } });

    collabTest('create-all → cross-edit → 3-way conflict → late-join catch-up → delete', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        const B = collab.peers[0];
        let C = collab.peers[1];

        // 1. CREATE-ALL — each client draws a line; each traverses the chain to the other two.
        const fa = await drawLineUI(A, COORDS_A);
        await collab.expectFullSync({ entityId: fa, type: 'lines', operationType: 'create' });
        const fb = await drawLineUI(B, COORDS_B);
        await collab.expectFullSyncFrom(B, { entityId: fb, type: 'lines', operationType: 'create' });
        const fc = await drawLineUI(C, COORDS_C);
        await collab.expectFullSyncFrom(C, { entityId: fc, type: 'lines', operationType: 'create' });

        // 2. CROSS-EDIT — C recolors A's feature; the edit traverses the chain to A and B.
        await collab.clearTraces();
        await selectAndRecolorUI(C, fa, '#22aa22');
        await collab.expectFullSyncFrom(C, { entityId: fa, type: 'lines', operationType: 'update' });

        // 3. THREE-WAY CONFLICT — all three recolor fb at once → converge to the value THE
        //    SERVER holds. The previous version polled until the three clients merely AGREED
        //    WITH EACH OTHER, never reading Postgres and never waiting for anyone's push.ack.
        //    That verde provava pouco: três clientes podem concordar num valor que o servidor
        //    nunca aceitou (op ainda na fila de saída, op rejeitada, ou os três exibindo o
        //    estado anterior enquanto as três updates ainda voam). É o mesmo defeito que
        //    `browser-collab-crdt-conflict.spec.js` documentou e corrigiu; aqui segue o mesmo
        //    padrão: primeiro cada edição chega ao servidor, depois o BANCO decide o vencedor
        //    e os clientes respondem a ele. Concordância entre pares vira consequência.
        //
        //    OS TRÊS EDITAM COM A REDE DERRUBADA, e essa é a parte que não se adivinha: sem isso
        //    a fase pede uma coisa que o gesto de UI não consegue entregar. "Três edições de UMA
        //    base" é o que faz a asserção de baixo (UMA aplica, duas voltam conflito) ser
        //    verdadeira, e a base de cada op é lida no instante do `updateFeature`, dentro do
        //    Salvar. Com a rede de pé, o gesto leva segundos (expansão de camadas, prévia, clique)
        //    e a update do vizinho pode assentar na store de quem ainda não salvou: aí a op dele
        //    DECLARA a base nova, o servidor a aceita como continuação legítima em vez de recusá-la
        //    como conflito, e a contagem vira dois. Medido como uma reprovação em quatro, em
        //    2026-09-13 e de novo em 2026-09-15.
        //
        //    O irmão `browser-collab-crdt-conflict.spec.js` resolveu o mesmo problema saindo da
        //    UI: ele lê as props uma vez e manda as três updates por `applyStoreOp`, com a base
        //    fixada à mão. O comentário dele diz por extenso que a UI sob concorrência tripla é
        //    limite de driver. Aqui a UI é justamente o que este arquivo existe para exercitar,
        //    então a base se fixa pelo outro lado: `setOffline` nos três contextos enquanto os
        //    três gestos acontecem. Nada pode chegar, logo os três leem a mesma base; e as três
        //    ops nascem no diário, que é local por desenho (offline-first). Devolvida a rede, as
        //    três sobem e o servidor decide. A fase deixou de medir uma corrida e passou a medir
        //    o contrato, que é o que ela sempre afirmou medir.
        //
        //    Selecionar em SÉRIE e só então recolorir em paralelo, como no irmão: o gesto único
        //    (select+recolor junto) leva segundos por causa da expansão de camadas. A
        //    concorrência que o teste precisa é no COMMIT da cor, que é um clique, e essa
        //    continua paralela.
        await collab.clearTraces();
        await Promise.all([A, B, C].map((p) => p.context().setOffline(true)));
        await A.waitForTimeout(1500);
        await selectFeatureUI(A, fb);
        await selectFeatureUI(B, fb);
        await selectFeatureUI(C, fb);
        // O `featureId` ARMA O EXPERIMENTO em cada um dos tres, e nao e opcional aqui: e nesta
        // fase que as tres updates concorrentes chegam durante o gesto dos vizinhos, entao e
        // aqui que a pergunta "harness ou produto" tem mais chance de ser respondida. Sem ele,
        // o veredito sai INDISPONIVEL e a falha volta a nao dizer de quem e o defeito.
        //
        // RESSALVA MEDIDA POR LEITURA, 2026-09-13: o `recolorViaPanelUI` que roda aqui e' o
        // driver LOCAL deste arquivo (endurecido para o cliente que reentra), que SOMBREIA o de
        // `helpers/collab-helpers.js` e ignora o terceiro argumento. Quem registra o alvo para
        // `vereditoDoCommitDeCor` e' o driver compartilhado, entao hoje o veredito daqui sai
        // INDISPONIVEL e a propria frase dele diz isso. Fica escrito em vez de silenciosamente
        // corrigido porque unificar os dois drivers e' mudanca de harness, nao de contrato.
        const disputa = [
            { page: A, quem: 'A', cor: '#ff0000' },
            { page: B, quem: 'B', cor: '#0000ff' },
            { page: C, quem: 'C', cor: '#00ff00' },
        ];
        await Promise.all(disputa.map(({ page, cor }) => recolorViaPanelUI(page, cor, { featureId: fb })));
        // COBRAR O ENFILEIRAMENTO ANTES DE DEVOLVER A REDE é o que afirma que as três ops
        // nasceram na janela de isolamento, e não depois dela. É também o passo que pega a
        // edição que evapora sem erro, que era o defeito de produto desta fase.
        const enviadas = [];
        for (const { page, quem, cor } of disputa) {
            const enq = await expectEnqueued(page, quem, fb, 'update');
            enviadas.push({ opId: enq.opId, quem, cor, page });
        }
        await Promise.all([A, B, C].map((p) => p.context().setOffline(false)));
        // 35 s, e não os 25 s do padrão, porque a volta passa pelo backoff exponencial da
        // reconexão do socket antes de a fila de saída partir. É o mesmo prazo que
        // `browser-collab-reconnect.spec.js` usa para a mesma travessia.
        for (const { page, opId } of enviadas) await expectAcked(page, { opId }, 35000);
        const winner = await convergedColor(collab.db, [A, B, C], fb);
        expect(winner, 'o servidor gravou uma das três cores em disputa').toMatch(/^#(ff0000|0000ff|00ff00)$/);

        // UMA APLICA, DUAS VOLTAM COMO CONFLITO — a mesma leitura, e o mesmo porquê, de
        // `browser-collab-crdt-conflict.spec.js`, onde a inversão desta asserção está escrita por
        // extenso. Em resumo: até 2026-09-13 esta linha pedia `>= 3` porque as três updates eram
        // todas aplicadas e a última sobrescrevia as duas anteriores em silêncio; desde `0fa61c5f`
        // (servidor, `entity-conflicts.js`) e `5f91f2e9` (cliente, `mutation-contract.js`) uma
        // update DECLARA a base observada e a unidade que muda, então três edições de UMA base são
        // uma escrita e duas recusas, e op recusada não escreve linha em `operations`. Medido na
        // rodada que virou este caso vermelho: uma update no log, quatro conflitos no SyncLedger.
        // A coluna é `op_type` (`backend/src/database/migrations/003_sync.sql:19`), não
        // `operation_type`.
        const opsFb = await collab.db.queryOperationsByEntity(fb);
        const updatesFb = opsFb.filter((o) => o.op_type === 'update');
        expect(updatesFb.length, 'UMA das três atualizações concorrentes foi aplicada, e só uma')
            .toBe(1);

        // O DESFECHO DE CADA UMA VEM DO RECIBO, e não da ausência no log: "não está em
        // `operations`" lê igual para uma recusa e para uma edição perdida a caminho, e esses dois
        // desfechos são opostos. É a distinção que esta fase existe para medir.
        const desfechos = [];
        for (const { opId, quem, cor } of enviadas) {
            const recibo = await collab.db.queryReceipt(opId);
            expect(recibo, `o servidor guardou o recibo da edição de ${quem}`).toBeTruthy();
            desfechos.push({ opId, quem, cor, result: recibo.result });
        }
        const aplicadas = desfechos.filter((d) => d.result.status === 'applied');
        const conflitos = desfechos.filter((d) => d.result.status === 'conflict');
        expect(aplicadas.map((d) => d.quem), 'exatamente um dos três teve a edição aplicada')
            .toHaveLength(1);
        expect(conflitos.map((d) => d.quem), 'os outros dois foram recusados, não sobrescritos')
            .toHaveLength(2);
        expect(aplicadas[0].opId, 'a op aplicada é a mesma que o log guardou').toBe(updatesFb[0].op_id);
        expect(winner, 'a cor convergida é a de quem teve a edição aplicada').toBe(aplicadas[0].cor);

        // E CADA RECUSA NOMEIA A UNIDADE EM DISPUTA, senão ela seria indistinguível de uma recusa
        // por política, e as duas pedem coisas diferentes de quem as recebe. A frase e a unidade
        // são escritas por extenso de propósito: derivar o valor esperado do código sob teste não
        // prova nada.
        for (const { quem, result } of conflitos) {
            expect(result.reason, `a recusa de ${quem} diz que os mesmos campos mudaram no servidor`)
                .toBe('Os mesmos campos foram alterados no servidor.');
            expect(
                (result.conflict?.fields ?? []).map((f) => JSON.stringify(f)),
                `a recusa de ${quem} nomeia a unidade em disputa`,
            ).toContain('["properties","lineColor"]');
        }

        // 4. LATE JOIN — C disconnects (full session close). A's offline-window write reaches B
        //    through the whole chain; C reconnects (fresh session) and catches up via snapshot.
        await C.context().close();
        const fLate = await drawLineUI(A, COORDS_LATE);
        await collab.expectFullSyncTo([B], { entityId: fLate, type: 'lines', operationType: 'create' });
        C = await collab.reopenPeer(1);
        await expect.poll(async () => (await readFeatures(C, 'lines')).some((x) => x.id === fLate), { timeout: 35000 }).toBe(true);
        await expect.poll(async () => (await readFeatures(C, 'lines')).some((x) => x.id === fa), { timeout: 35000 }).toBe(true);

        // 5. DELETE — C removes a feature; the delete traverses the chain to A and B.
        await deleteFeatureUI(C, fc);
        await collab.expectFullSyncDeleteFrom(C, { entityId: fc, type: 'lines', operationType: 'delete' });
    });
});
