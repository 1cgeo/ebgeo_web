// Path: e2e-ui/browser-collab-grupo-perde-membro.spec.js

/**
 * O GRUPO PERDE UM MEMBRO, com duas browsers reais e backend real.
 *
 * O dono agrupa feições e apaga uma delas pela UI; o PAR (Editor) converge com o grupo
 * REDUZIDO, e no caso em que o grupo cai a um membro, sem o grupo.
 *
 * ================= O DEFEITO QUE ESTE ARQUIVO FECHA ==========================
 *
 * `GroupManager.removeFeatureFromAllGroups` tirava a feição de `group.features`, mexia no
 * metadado de sync e soft-deletava o grupo que ficasse com um membro ou menos, e não logava
 * operação NENHUMA. Ela é chamada por toda exclusão de feição, pelo mover para outro mapa e
 * pela transferência de camada, então o par (e o servidor) guardavam o grupo com a referência
 * à feição que já tinha saído, sem erro em lugar nenhum.
 *
 * ================= POR QUE A OP É `group_feature`, E NÃO UM UPDATE DE GRUPO ==
 *
 * O servidor não tem coluna de membros em `groups`: `UPDATE_FIELDS.group`
 * (`backend/src/modules/sync/sync.service.js`) são name/visible/locked/style/parent_id, e o
 * INSERT de `groups` também não lê `data.features`. A membresia mora na tabela de junção
 * `group_features` e é dela que o snapshot remonta `group.features`.
 *
 * ISSO IMPORTA PARA ESTE ARQUIVO EM PARTICULAR, e é a razão de ele não bastar sozinho: o
 * inbound do cliente troca o DOCUMENTO DE GRUPO inteiro (`applyRemoteGroupOp`), então um
 * `group` update carregando a lista nova convergiria os dois pares ao vivo e este arquivo
 * ficaria VERDE com o servidor guardando a membresia velha, que voltaria no próximo snapshot
 * ou F5. Quem mede o servidor é `frontend/tests/e2e/grupo-perde-membro.e2e.test.js`, que tem
 * um caso dedicado a afirmar que um update de grupo NÃO move a membresia. Os dois arquivos
 * juntos é que fecham a pergunta; nenhum dos dois a fecha sozinho.
 *
 * ================= POR QUE A EXCLUSÃO NÃO É PELA UI ==========================
 *
 * A primeira versão deste arquivo apagava a feição com `deleteFeatureUI`, e falhou nas 3
 * repetições dos 2 casos, sempre no mesmo ponto. São DUAS razões, e a segunda é a que
 * fecha a questão.
 *
 * A rasa: uma feição AGRUPADA não é desenhada como `.feature-item` solto. Ela vira
 * `.group-feature-item` dentro do contêiner do grupo (`createGroupFeatureItem`,
 * `frontend/src/js/features_tab/group-item.component.js`), com `.group-feature-main` no
 * lugar de `.feature-main`, então o seletor de `selectFeatureUI` não a alcança. Trocar o
 * seletor pareceria o conserto, e seria pior que o defeito.
 *
 * A funda: clicar naquele filho seleciona o GRUPO INTEIRO. `handleGroupFeatureClick`
 * (mesmo arquivo) faz `deselectAllFeatures` e depois percorre `groupData.features`
 * chamando `toggleFeatureSelection` em CADA membro. A tecla Delete depois disso apagaria
 * TODOS os membros, e os dois casos medem justamente o grupo perdendo UM. Procurei uma
 * porta de UI que apague um membro só e não existe: o item dentro do grupo nasce
 * declaradamente "without individual controls", e o único outro sítio que pergunta por
 * grupo no caminho de seleção (`getGroupedFeatures`,
 * `frontend/src/js/map/map.manager.js`) serve ao MOVER, que RECUSA feição agrupada.
 *
 * Ou seja, apagar um membro de um grupo é exatamente o "things with no UI" para o qual o
 * `frontend/tests/e2e-ui/README.md` autoriza `page.evaluate`. O desenho dos pontos e o
 * agrupamento continuam pelos caminhos reais (ferramenta de ponto de verdade, e o mesmo
 * `createGroup` que "Criar Grupo" invoca, como em `browser-group-ops.spec.js`); só a
 * exclusão desce para a op de store, no molde de `deleteFeature` em
 * `browser-collab-full-chain.spec.js`, que já apaga assim.
 *
 * ================= DUAS LEITURAS, E A SEGUNDA É A QUE MORDE ==================
 *
 * Ler o grupo do par por `getMapGroups` NÃO basta, e a razão é a mesma que este arquivo
 * declara acima: o par recebe o DOCUMENTO do grupo, com a lista de membros dentro, e o
 * inbound o escreve inteiro. Então o par mostra os membros certos mesmo que a tabela de
 * junção do servidor esteja VAZIA, que é exatamente o estado que um defeito de ordem de
 * fila produz (a membresia chegando antes do grupo escreve zero linhas e volta acked).
 * Um spec que só olhasse a store do par ficaria verde sobre esse defeito.
 *
 * Por isso cada asserção é feita DUAS vezes: na store do par (a convergência ao vivo) e
 * no SNAPSHOT do servidor, por `pullSync`, que é a única leitura que passa pela tabela de
 * junção. O `pullSync` sai do próprio `apiClient` do par, com a sessão dele, no molde de
 * `browser-analysis-tools.spec.js`.
 *
 * ================= O QUE A LEITURA DO PAR TEM DE ESPECIAL ====================
 *
 * `getMapGroups()` devolve um objeto por id que INCLUI os soft-deletados, então ler o grupo
 * sem filtrar `sync.deleted` faria o caso do grupo dissolvido passar sempre (o grupo continua
 * lá, marcado). `readGroupAtivo` filtra, espelhando `getGroupById`, que não está no barril da
 * fachada. Isto é o mesmo cuidado que `browser-group-ops.spec.js` já toma.
 *
 * Rodar de cabeça:  npx playwright test browser-collab-grupo-perde-membro --headed
 */

import {
    collabTest, expect,
    drawPointUI, readFeatures,
} from './helpers/collab.fixtures.js';

/**
 * Deletes ONE feature through the app's real store op, which is the same entry point the
 * canvas Delete key reaches. See the header for why the UI gesture cannot be used here:
 * every UI path to a grouped feature selects the WHOLE group.
 *
 * `type` is the PLURAL STORAGE bucket (`points`), not the singular source type (`point`).
 * The two are nearly homographic and this file already paid for the confusion: the first
 * run passed `point` and all 6 repetitions died on
 * `currentMapData.features[type].findIndex` of undefined. `removeFeature` indexes the
 * bucket, and derives the singular itself (`mainFeature.properties.source`) for the group
 * cleanup. Same pair of vocabularies that `deleteLayerFeatures` got backwards in the
 * ledger; here it fails LOUD, there it failed open.
 * @param {import('@playwright/test').Page} page
 * @param {string} type - Feature STORAGE type (plural bucket, e.g. 'points')
 * @param {string} id - Feature id
 * @returns {Promise<void>}
 */
function deleteFeatureViaStore(page, type, id) {
    return page.evaluate(async (q) => {
        const store = await import('/src/js/store/index.js');
        await store.removeFeature(q.type, q.id);
    }, { type, id });
}

/**
 * Groups the given point ids through the REAL `createGroup` op (what "Criar Grupo" invokes).
 * It takes whole features, not id refs, so the page resolves them from its own store first.
 * @param {import('@playwright/test').Page} page
 * @param {Array<string>} ids
 * @returns {Promise<string>} The new group id
 */
function createGroupOfPoints(page, ids) {
    return page.evaluate(async (wanted) => {
        const store = await import('/src/js/store/index.js');
        const f = await store.getCurrentMapFeatures();
        const feats = (f.points || []).filter((x) => wanted.includes(x.properties?.id));
        if (feats.length !== wanted.length) {
            throw new Error(`esperava ${wanted.length} pontos no mapa, achei ${feats.length}`);
        }
        return store.createGroup(feats).id;
    }, ids);
}

/**
 * Reads ONE group from the live app store, or null when it is absent OR soft-deleted.
 * @param {import('@playwright/test').Page} page
 * @param {string} groupId
 * @returns {Promise<{id: string, memberIds: Array<string>}|null>}
 */
function readGroupAtivo(page, groupId) {
    return page.evaluate(async (gid) => {
        const store = await import('/src/js/store/index.js');
        const g = (store.getMapGroups() || {})[gid];
        if (!g || g.sync?.deleted) return null;
        return { id: g.id, memberIds: (g.features || []).map((f) => f.id).sort() };
    }, groupId);
}

/**
 * Reads ONE group from the SERVER SNAPSHOT, through the page's own `apiClient` session.
 * This is the only read that goes through the `group_features` join table, so it is the
 * one that can catch membership the server never actually stored. See the header.
 * @param {import('@playwright/test').Page} page
 * @param {string} atlasId
 * @param {string} mapId
 * @param {string} groupId
 * @returns {Promise<{id: string, memberIds: Array<string>}|null>}
 */
function readGroupFromSnapshot(page, atlasId, mapId, groupId) {
    return page.evaluate(async (q) => {
        const { apiClient } = await import('/src/js/store/sync/index.js');
        const res = await apiClient.pullSync(q.atlasId, 0);
        const map = (res?.snapshot?.maps || []).find((m) => m.id === q.mapId);
        const g = (map?.groups || []).find((x) => x.id === q.groupId);
        return g ? { id: g.id, memberIds: (g.features || []).map((f) => f.id).sort() } : null;
    }, { atlasId, mapId, groupId });
}

/** Waits until the SERVER SNAPSHOT shows the group with exactly these member ids. */
async function pollSnapshotMembers(page, collab, groupId, ids, timeout = 20000) {
    await expect
        .poll(async () => (await readGroupFromSnapshot(page, collab.atlasId, collab.mapId, groupId))
            ?.memberIds ?? null, { timeout })
        .toEqual([...ids].sort());
}

/** Waits until `page` sees the group with exactly these member ids. */
async function pollGroupMembers(page, groupId, ids, timeout = 20000) {
    await expect
        .poll(async () => (await readGroupAtivo(page, groupId))?.memberIds ?? null, { timeout })
        .toEqual([...ids].sort());
}

collabTest.describe('Grupo perde um membro — o par converge reduzido', () => {

    collabTest('o dono agrupa TRÊS feições e apaga uma; o par fica com o grupo de duas', async ({ collab }) => {
        const A = collab.author;   // dono
        const B = collab.peers[0]; // editor

        // ---- Três pontos pela UI real, e o par recebe os três -------------------
        const p1 = await drawPointUI(A, [-43.21, -22.91]);
        const p2 = await drawPointUI(A, [-43.22, -22.92]);
        const p3 = await drawPointUI(A, [-43.23, -22.93]);

        await collab.expectFullSync({ entityId: p1, type: 'points', operationType: 'create' });
        await expect
            .poll(async () => (await readFeatures(B, 'points')).map((f) => f.id).sort())
            .toEqual([p1, p2, p3].sort());

        // ---- Agrupar: o par recebe o grupo COM os três membros ------------------
        const groupId = await createGroupOfPoints(A, [p1, p2, p3]);
        expect(groupId, 'o grupo nasceu no dono').toBeTruthy();

        await pollGroupMembers(A, groupId, [p1, p2, p3]);
        await pollGroupMembers(B, groupId, [p1, p2, p3]);
        // E o servidor guardou de fato as três linhas de junção. Sem esta asserção, uma
        // membresia que saísse da fila ANTES da op do grupo (INSERT gateado por EXISTS,
        // zero linhas, ack de sucesso) passaria despercebida: as duas leituras acima
        // continuariam certas, porque elas leem o documento que o par recebeu.
        await pollSnapshotMembers(B, collab, groupId, [p1, p2, p3]);

        // ---- Apagar UMA feição: é o gesto que chama a função corrigida ---------------
        await deleteFeatureViaStore(A, 'points', p2);

        // A feição some dos dois lados...
        await expect
            .poll(async () => (await readFeatures(B, 'points')).some((f) => f.id === p2))
            .toBe(false);

        // ...e o grupo fica com DOIS membros nos dois lados. O positivo e o negativo do
        // mesmo par: só o comprimento passaria igual se o membro errado tivesse saído.
        await pollGroupMembers(A, groupId, [p1, p3]);
        await pollGroupMembers(B, groupId, [p1, p3]);
        // A metade durável: a linha de junção sumiu do servidor, e não só do documento
        // que os dois clientes têm em memória.
        await pollSnapshotMembers(B, collab, groupId, [p1, p3]);
        const noPar = await readGroupAtivo(B, groupId);
        expect(noPar.memberIds, 'o membro apagado saiu do grupo do par').not.toContain(p2);

        await collab.assertLedgerClean({ allowNoEffects: true });
    });

    collabTest('grupo de DUAS: apagar uma dissolve o grupo também no par', async ({ collab }) => {
        // O outro ramo de `removeFeatureFromAllGroups`: caindo a um membro ou menos, ela
        // soft-deleta o grupo. Esse soft-delete era local e agora viaja como `group` delete.
        const A = collab.author;
        const B = collab.peers[0];

        const q1 = await drawPointUI(A, [-43.31, -22.81]);
        const q2 = await drawPointUI(A, [-43.32, -22.82]);
        // Uma terceira feição SOLTA, fora do grupo: é ela que separa "o grupo se dissolveu"
        // de "o par perdeu o mapa inteiro".
        const solta = await drawPointUI(A, [-43.33, -22.83]);

        await collab.expectFullSync({ entityId: q1, type: 'points', operationType: 'create' });
        await expect
            .poll(async () => (await readFeatures(B, 'points')).map((f) => f.id).sort())
            .toEqual([q1, q2, solta].sort());

        const groupId = await createGroupOfPoints(A, [q1, q2]);
        await pollGroupMembers(B, groupId, [q1, q2]);
        await pollSnapshotMembers(B, collab, groupId, [q1, q2]);

        await deleteFeatureViaStore(A, 'points', q1);

        // O grupo deixa de existir para os dois (ativo = não soft-deletado).
        await expect.poll(async () => await readGroupAtivo(A, groupId), { timeout: 20000 }).toBeNull();
        await expect.poll(async () => await readGroupAtivo(B, groupId), { timeout: 20000 }).toBeNull();
        // E o servidor também o soft-deletou: grupo apagado não volta no snapshot.
        await expect
            .poll(async () => await readGroupFromSnapshot(B, collab.atlasId, collab.mapId, groupId),
                { timeout: 20000 })
            .toBeNull();

        // E o que não era do grupo continua lá, nos dois lados.
        expect((await readFeatures(B, 'points')).some((f) => f.id === solta)).toBe(true);
        expect((await readFeatures(B, 'points')).some((f) => f.id === q2)).toBe(true);
    });
});
