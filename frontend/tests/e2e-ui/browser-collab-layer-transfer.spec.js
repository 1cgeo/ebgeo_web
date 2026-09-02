// Path: e2e-ui/browser-collab-layer-transfer.spec.js

/**
 * TRANSFERIR UMA CAMADA INTEIRA PARA OUTRO MAPA, com duas browsers reais e backend real.
 *
 * O que este arquivo mede: o DONO copia e depois move uma camada do mapa corrente para um
 * segundo mapa do mesmo atlas, e o PAR (Editor) converge no DESTINO. A operacao e' dirigida
 * pela store (`applyStoreOp`), como em `browser-collab-lock.spec.js`, porque o assunto aqui
 * e' a propagacao, nao a fiacao do menu; a fiacao do menu e' medida em
 * `browser-layer-transfer-permissions.spec.js`.
 *
 * ================= POR QUE NAO SE OLHA O MAPA CORRENTE ========================
 *
 * `readFeatures` e `pollPeerFeature` leem o mapa CORRENTE. O destino da transferencia nao e'
 * o mapa corrente de ninguem, entao as asercoes de chegada usam ajudantes locais que leem um
 * mapa POR NOME (`getMapDataStore` / `getLayersRepo`). O ajudante de chegada no mapa corrente
 * continua sendo usado no aquecimento, que e' onde ele responde a pergunta certa.
 *
 * ================= A AUSENCIA NA ORIGEM CHEGA PELA CASCATA DA CAMADA =========
 *
 * Nenhuma op de DELETE de feicao viaja num move, e emitir uma seria pior: mover mantem o id, e
 * quem move a linha no servidor e' o proprio `feature create` carimbado com o mapa de DESTINO
 * (upsert por entityId), entao com LWW por ordem de chegada um delete daquele mesmo id
 * chegando atras apagaria a linha que acabou de se mudar. O que esvazia a origem no par e' a
 * CASCATA do delete da camada, que o servidor sempre fez e que
 * `frontend/src/js/store/sync/remote-operation-handler.js` passou a espelhar em 2026-09-02
 * (`cascadeRemoteLayerDelete`). Por isso este arquivo afirma as DUAS metades: a chegada no
 * destino e a ausencia na origem, a segunda pelo ajudante que le' um mapa POR NOME, porque
 * depois do move o mapa de origem pode nao ser o corrente de ninguem.
 *
 * O SEGUNDO CASO deste arquivo e' a mesma cascata sem transferencia nenhuma: exclusao de
 * camada comum, no mapa corrente dos dois, medida com `pollPeerFeatureGone`. Ele existe porque
 * o defeito NUNCA foi do move: era de toda exclusao de camada, e um arquivo que so' medisse a
 * transferencia deixaria o caso mais comum sem guarda.
 *
 * `allowNoEffects: true` no ledger: a delecao da camada de origem chega ao servidor depois de
 * as feicoes ja' terem trocado de camada, entao ela e' legitimamente uma op de zero linhas
 * afetadas.
 *
 * Rodar de cabeca:  npx playwright test browser-collab-layer-transfer --headed
 */

import {
    collabTest, expect,
    drawLineUI, drawPointUI, readFeatures,
} from './helpers/collab.fixtures.js';
import { pollPeerFeature, pollPeerFeatureGone } from './helpers/collab-helpers.js';

/** Drives a store op on `page` through the app's REAL store facade. */
function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

/** Reads ONE NAMED map's features (per storage type) from the app store. */
function readMapFeatures(page, mapName, type) {
    return page.evaluate(async ({ m, t }) => {
        const store = await import('/src/js/store/index.js');
        const data = await store.getMapDataStore(m);
        return (data?.features?.[t] || []).map((f) => ({
            id: f.properties?.id,
            nome: f.properties?.nome,
            layerId: f.properties?.layerId,
        }));
    }, { m: mapName, t: type });
}

/** Reads ONE NAMED map's layers from the REPOSITORY (memory is hydrated one map at a time). */
function readMapLayers(page, mapName) {
    return page.evaluate(async (m) => {
        const store = await import('/src/js/store/index.js');
        const layers = (await store.getLayersRepo(m)) || [];
        return layers.map((l) => ({ id: l.id, name: l.name }));
    }, mapName);
}

/** Waits until `page` has feature `id` inside the NAMED map. */
async function pollFeatureInMap(page, mapName, type, id, timeout = 20000) {
    await expect
        .poll(async () => (await readMapFeatures(page, mapName, type)).some((f) => f.id === id),
            { timeout })
        .toBe(true);
}

/** Waits until `page` has a layer named `name` inside the NAMED map, and returns its id. */
async function pollLayerInMap(page, mapName, name, timeout = 20000) {
    await expect
        .poll(async () => (await readMapLayers(page, mapName)).some((l) => l.name === name),
            { timeout })
        .toBe(true);
    return (await readMapLayers(page, mapName)).find((l) => l.name === name).id;
}

const lineCoords = () => [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]];

const MAPA_DESTINO = 'Mapa Destino';
const NOME_DA_CAMADA = 'Camada Viajante';

collabTest.describe('Transferir camada entre mapas — o par converge no destino', () => {

    collabTest('o dono COPIA e depois MOVE uma camada; o par vê as duas no destino', async ({ collab }) => {
        const A = collab.author;   // dono
        const B = collab.peers[0]; // editor

        // ---- Aquecimento: o par está mesmo ligado, e no mapa corrente ------------
        const primeira = await drawLineUI(A, lineCoords());
        await collab.expectFullSync({ entityId: primeira, type: 'lines', operationType: 'create' });

        // ---- Preparo: um segundo mapa e uma camada com a linha dentro ------------
        await applyStoreOp(A, 'addMap', [MAPA_DESTINO]);
        await pollLayerInMap(B, MAPA_DESTINO, 'Padrão').catch(() => {
            // O mapa novo chega ao par como op de mapa; a camada padrão dele pode nascer
            // do lado do servidor. A asserção que importa vem depois, sobre a camada
            // TRANSFERIDA, então esta espera é só para dar tempo ao mapa de existir.
        });

        const camada = await applyStoreOp(A, 'createLayer', [NOME_DA_CAMADA]);
        const camadaId = camada?.id ?? camada;
        expect(camadaId, 'a camada de origem nasceu').toBeTruthy();

        await applyStoreOp(A, 'moveFeaturesToLayer', [[{ type: 'line', id: primeira }], camadaId]);
        await expect
            .poll(async () => (await readFeatures(A, 'lines')).find((f) => f.id === primeira)?.props?.layerId)
            .toBe(camadaId);

        // ---- COPIAR: a origem fica intacta e o destino ganha uma cópia -----------
        const copia = await applyStoreOp(A, 'transferLayerToMap', [
            camadaId, MAPA_DESTINO, { mode: 'copy' },
        ]);
        expect(copia?.success, JSON.stringify(copia)).toBe(true);
        expect(copia.movedCount).toBe(1);

        // A origem continua com a linha: copiar não tira nada de lugar nenhum.
        expect((await readFeatures(A, 'lines')).some((f) => f.id === primeira)).toBe(true);
        await pollPeerFeature(B, 'lines', primeira);

        // A cópia tem id NOVO, e é por ele que se pergunta ao par.
        const copiadaId = (await readMapFeatures(A, MAPA_DESTINO, 'lines'))
            .find((f) => f.layerId === copia.targetLayerId)?.id;
        expect(copiadaId, 'a cópia existe no destino, com id próprio').toBeTruthy();
        expect(copiadaId).not.toBe(primeira);

        await pollLayerInMap(B, MAPA_DESTINO, NOME_DA_CAMADA);
        await pollFeatureInMap(B, MAPA_DESTINO, 'lines', copiadaId);

        // ---- MOVER: a mesma camada sai da origem e chega ao destino --------------
        const mover = await applyStoreOp(A, 'transferLayerToMap', [
            camadaId, MAPA_DESTINO, { mode: 'move' },
        ]);
        expect(mover?.success, JSON.stringify(mover)).toBe(true);
        expect(mover.movedCount).toBe(1);
        expect(mover.sourceLayerRemoved).toBe(true);
        // O nome colidiu com a cópia, então o destino recebeu o sufixo. Absoluto de
        // propósito: é a regra de nome que a colisão exercita.
        expect(mover.targetLayerName).toBe(`${NOME_DA_CAMADA} #2`);

        // O DONO perdeu a linha do mapa corrente (mover mantém o id).
        await expect
            .poll(async () => (await readFeatures(A, 'lines')).some((f) => f.id === primeira))
            .toBe(false);
        // E ela está no destino, com o MESMO id: mover é o mesmo objeto numa casa nova.
        await pollFeatureInMap(A, MAPA_DESTINO, 'lines', primeira);

        // O PAR converge no destino: a feição pelo id de sempre, e a camada nova.
        await pollFeatureInMap(B, MAPA_DESTINO, 'lines', primeira);
        await pollLayerInMap(B, MAPA_DESTINO, `${NOME_DA_CAMADA} #2`);

        // E a camada de ORIGEM sumiu do par, junto com a feição que estava nela: é a cascata
        // do delete de camada que esvazia a origem, e o par a espelha desde 2026-09-02.
        await expect
            .poll(async () => (await readMapLayers(B, collab.mapName)).some((l) => l.id === camadaId))
            .toBe(false);
        await expect
            .poll(async () => (await readMapFeatures(B, collab.mapName, 'lines')).some((f) => f.id === primeira))
            .toBe(false);

        await collab.assertLedgerClean({ allowNoEffects: true });
    });

    collabTest('excluir uma camada comum: o par perde as feições dela', async ({ collab }) => {
        // ORÇAMENTO PRÓPRIO, medido em 2026-09-02: em três rodadas este caso passou duas e
        // estourou os 60 s padrão na terceira ("Target page closed" dentro de um poll, não a
        // cascata). São três desenhos pela UI mais quatro sincronizações, e o caso vizinho, que
        // faz menos, passou 3 de 3. O teto sobe para o caso, não para o arquivo.
        collabTest.setTimeout(120000);

        // Sem transferência nenhuma. O defeito que a cascata fechou não era do move: era de
        // TODA exclusão de camada, porque `deleteLayerFeatures` não loga op por feição e o
        // único envelope que viaja é o `layer delete`.
        const A = collab.author;
        const B = collab.peers[0];

        const camada = await applyStoreOp(A, 'createLayer', ['Camada Descartável', collab.mapName]);
        const camadaId = camada?.id ?? camada;
        expect(camadaId).toBeTruthy();

        const p1 = await drawPointUI(A, [-43.11, -22.11]);
        const p2 = await drawPointUI(A, [-43.12, -22.12]);
        await applyStoreOp(A, 'moveFeaturesToLayer', [
            [{ type: 'point', id: p1 }, { type: 'point', id: p2 }], camadaId, collab.mapName,
        ]);

        // Uma terceira feição FORA da camada: é ela que separa "a cascata mirou" de "a
        // cascata levou o mapa inteiro".
        const sobrevivente = await drawPointUI(A, [-43.13, -22.13]);

        await collab.expectFullSync({ entityId: p1, type: 'points', operationType: 'create' });
        await pollPeerFeature(B, 'points', p2);
        await pollPeerFeature(B, 'points', sobrevivente);

        await applyStoreOp(A, 'deleteLayer', [camadaId, collab.mapName]);

        await pollPeerFeatureGone(B, 'points', p1);
        await pollPeerFeatureGone(B, 'points', p2);
        expect((await readFeatures(B, 'points')).some((f) => f.id === sobrevivente)).toBe(true);
    });
});
