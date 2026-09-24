// Path: tests/e2e/lote-estado-do-servidor.e2e.test.js

/**
 * @fileoverview OS CENÁRIOS DE ACEITE DO LOTE LÓGICO QUE DEPENDEM DO ESTADO DO SERVIDOR (B6.4).
 *
 * ================= POR QUE ELES NÃO TÊM PROVA DO LADO DO CLIENTE ==============================
 *
 * Mapa bloqueado, camada bloqueada, destino excluído, permissão alterada entre a intenção e o
 * push, e edição concorrente antes do desfazer: em nenhum deles quem decide é o cliente. Ele
 * monta o gesto, empurra e OBSERVA o recibo; o veredito é do gate do servidor, e um duplo de teste
 * que devolvesse o recibo escolhido mediria a decisão de quem escreveu o teste. Por isso os cinco
 * moram aqui, com o estado montado no servidor de verdade por um SEGUNDO usuário (o dono), e o
 * gesto saindo pela fila e pelo motor do produto.
 *
 * Cada caso responde às duas perguntas do aceite: qual recibo chega, e o que a FILA faz com ele.
 * As duas se leem no mesmo lugar, porque o recibo guardado por `recordIssue` É o ack do servidor:
 * `getIssues()` devolve o par (envelope, recibo), e `getProblems()` acrescenta o que ficou parado
 * ATRÁS do recusado, que é a segunda metade do aceite (bloqueia as seguintes da mesma entidade).
 *
 * ================= O QUE FOI MEDIDO, E CONTRARIA A LEITURA NATURAL ============================
 *
 *  - **Só o bloqueio de MAPA é gate.** `layers.locked` é coluna que o servidor persiste e nunca
 *    consulta (`lockedMapDenialReason` olha `maps.locked` e mais nada), então o gesto sobre uma
 *    camada travada é APLICADO. O caso 2 afirma isso como CARACTERIZAÇÃO, não como aprovação: a
 *    trava de camada é convenção do cliente, e quem escrever um gate contando com o servidor está
 *    escrevendo contra uma promessa que não existe.
 *  - **"Destino excluído" tem DUAS portas, e as duas recusam, com frases diferentes.** Tocar a
 *    ENTIDADE que o par excluiu volta pela guarda de tombstone ("O item foi excluido no
 *    servidor."); criar dentro do MAPA que o par excluiu volta pelo comando de feição ("O mapa de
 *    destino foi excluido ou nao esta disponivel."). Nos dois o gesto inteiro cai, e nos dois o
 *    envelope de `conflict` fica só na culpada. A primeira versão deste arquivo apostou que a
 *    segunda porta não existia (o INSERT é gateado por um EXISTS sobre `maps` que não olha
 *    `deleted_at`, e daí a aposta) e a medição a desmentiu: o gate está antes do INSERT.
 *  - **Permissão alterada não vira problema durável, e isso é o desenho certo.** O rebaixamento
 *    responde 403, que NÃO está entre as recusas permanentes do flush (400, 413 e 422), então o
 *    flush LANÇA, nada é guardado e nada sai da fila: o trabalho espera a permissão voltar, e
 *    volta a sair sozinho quando ela volta. Guardar um problema ali seria pedir decisão humana
 *    sobre um estado que outra pessoa desfaz. E o 403 vem da ROTA
 *    (`requireAtlasPermission('comment')`, em `backend/src/modules/sync/sync.routes.js`), não do
 *    `assertOperationAllowed` do serviço: são dois gates em série com o mesmo status, medido
 *    desligando um de cada vez, e só desligando os DOIS o caso 4 fica vermelho.
 *
 * ================= ARMADILHAS DESTE ARQUIVO ==================================================
 *
 * Ele toma para si os singletons do cliente, como `lote-recusado-fila.e2e.test.js`, e o usuário do
 * motor é o CONVIDADO (`write`), não o dono: montar estado de servidor (travar mapa, excluir
 * grupo, rebaixar permissão) é do dono, e travar mapa exige `owner` estrito. Os envelopes nascem
 * depois de `activateRemoteAtlas`, senão o `scopeSuffix` não casa e o `peek` não os vê.
 *
 * A ORDEM DOS CASOS É CONTRATO: o caso 4 rebaixa a permissão do usuário do motor e a restaura no
 * fim; um caso novo que dependa de escrita precisa vir antes dele ou depois da restauração.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
    getBaseUrl,
    E2E_SKIP,
} from './helpers/harness.js';
import { pendingVerificationToken } from './helpers/db.js';
import { activateRemoteAtlas } from '../../src/js/store/remote-atlas.api.js';
import { syncEngine } from '../../src/js/store/sync/sync-engine.js';
import { apiClient } from '../../src/js/store/sync/api-client.js';
import { operationQueue } from '../../src/js/store/sync/operation-queue.js';
import { IssueClass } from '../../src/js/store/sync/issue-classes.js';
import { createOperation, createBatchOperations } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

describe.skipIf(E2E_SKIP)('e2e: o lote diante do estado do servidor', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} O DONO do atlas. */
    let dono;
    let atlasId;
    let mapId;
    /** @type {string} O usuário do motor de sync, convidado com `write`. */
    let convidadoId;

    const pontoMinimo = (featureId, i = 0) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-43.2 + i * 0.001, -22.9 + i * 0.001] },
        properties: { source: 'point', id: featureId },
    });

    /** Um par de feições criadas como UM gesto, o lote que cada caso empurra. */
    function gestoDeDuasFeicoes(alvoMapId, i = 0) {
        const ids = [generateUUID(), generateUUID()];
        const ops = createBatchOperations(ids.map((featureId, k) => ({
            entityType: 'feature',
            operationType: 'create',
            entityId: featureId,
            mapId: alvoMapId,
            data: pontoMinimo(featureId, i + k),
        })));
        expect(new Set(ops.map((op) => op.batchId)).size, 'um gesto é UM batchId').toBe(1);
        return { ids, ops };
    }

    /** Ids de feição presentes num mapa, lidos pela porta pública. Mapa ausente devolve null. */
    async function feicoesNoServidor(alvoMapId) {
        const { snapshot } = await apiClient.pullSync(atlasId, 0);
        const mapa = snapshot.maps.find((m) => m.id === alvoMapId);
        if (!mapa) return null;
        return Object.values(mapa.features ?? {}).flat().map((f) => f.properties.id).sort();
    }

    /** Troca (ou cria) o nível do convidado neste atlas. */
    async function permitir(nivel) {
        await dono._request('PUT', `/atlas/${atlasId}/sharing/users/${convidadoId}`,
            { body: { permission: nivel } });
    }

    beforeAll(async () => {
        dono = makeApi();
        await registerAndLogin(dono, { nome: 'Dono do Estado' });
        const atlas = await createAtlas(dono, { name: 'Atlas do estado do servidor' });
        atlasId = atlas.id;
        mapId = await createMap(dono, atlasId, { name: 'Mapa do estado' });

        // O usuário do MOTOR, que é o convidado: o dono monta o estado, ele sofre o gate.
        syncEngine.configure({ baseUrl: `${getBaseUrl()}/api/v1` });
        const username = `e2e_${generateUUID().replace(/-/g, '').slice(0, 16)}`;
        const password = 'Sup3r-Secret-Pw!';
        await syncEngine.register({
            username, password, nome: 'Convidado do Estado', email: `${username}@example.mil`,
        });
        await apiClient.verifyEmail(await pendingVerificationToken(username));
        const usuario = await syncEngine.login({ username, password });
        convidadoId = usuario.id;
        await dono._request('POST', `/atlas/${atlasId}/sharing/users`,
            { body: { userId: convidadoId, permission: 'write' } });

        await activateRemoteAtlas(atlasId);
        expect(await syncEngine.connect(atlasId, { initialPull: false })).toBeTruthy();
    }, 60000);

    afterAll(async () => {
        syncEngine.disconnect();
        await operationQueue.clear();
    });

    it('1) MAPA BLOQUEADO no servidor: o gesto inteiro é recusado e trava o que vem atrás dele', async () => {
        // MAPA PRÓPRIO, e não o da suíte: a trava é estado de servidor que sobrevive ao caso, e
        // um `it` que falhasse antes de destravar levaria junto todos os seguintes (aconteceu na
        // primeira versão: quatro casos vermelhos por um motivo que não era o deles).
        await operationQueue.clear();
        const mapaTravado = await createMap(dono, atlasId, { name: 'Mapa travado' });
        await dono.pushOperations(atlasId, [
            createOperation('map', 'update', mapaTravado, null, { locked: true }),
        ]);

        const { ids, ops } = gestoDeDuasFeicoes(mapaTravado, 10);
        await operationQueue.enqueueAll(ops);

        const resultado = await syncEngine.flush();
        expect(resultado.pushed, 'nada é aceito com o mapa travado').toBe(0);

        const problemas = await operationQueue.getIssues();
        expect(problemas).toHaveLength(ops.length);
        for (const { result } of problemas) {
            expect(result.reason).toMatch(/mapa está bloqueado/);
            expect(result.batchId).toBe(ops[0].batchId);
        }
        expect(problemas.map((p) => p.classe)).toEqual(ops.map(() => IssueClass.RECUSA));

        const noServidor = await feicoesNoServidor(mapaTravado);
        for (const id of ids) expect(noServidor).not.toContain(id);

        // A SEGUINTE DA MESMA ENTIDADE FICA PARADA ATRÁS DA RECUSADA, e "mesma entidade" é
        // literal: o bloqueio da fila é por `entityId` (mais o mapId quando é o MAPA que está
        // bloqueado, e mais a dependência declarada). Uma op de OUTRA feição do mesmo mapa NÃO é
        // bloqueada, e esperar que fosse é o erro que a primeira versão deste caso cometeu.
        //
        // Ela é enfileirada DEPOIS do flush de propósito: no mesmo push ela viajaria junto e
        // ganharia recusa própria do servidor (o orçamento do `peek` cabe o gesto e mais ela), e o
        // que se quer medir aqui é o bloqueio que a fila aplica SEM perguntar a ninguém.
        const depois = createOperation('feature', 'update', ids[0], mapaTravado,
            { ...pontoMinimo(ids[0], 10), properties: { source: 'point', id: ids[0], nome: 'Depois' } });
        await operationQueue.enqueueAll([depois]);

        const parados = await operationQueue.getProblems();
        const dependencia = parados.find((p) => p.operation.id === depois.id);
        expect(dependencia, 'a op seguinte do mesmo mapa precisa aparecer como parada').toBeTruthy();
        expect(dependencia.classe).toBe(IssueClass.DEPENDENCIA);
        expect(dependencia.result, 'ela não é recusada: não tem recibo nenhum').toBeNull();
        expect((await operationQueue.countByState()).pendentes,
            'e o censo concorda com o carregador: não há o que enviar').toBe(0);

        // DESTRAVAR NÃO DESFAZ O PROBLEMA GUARDADO: ele é durável e espera decisão. A op que
        // estava só bloqueada continua bloqueada junto, porque quem a segura ainda está na frente.
        await dono.pushOperations(atlasId, [
            createOperation('map', 'update', mapaTravado, null, { locked: false }),
        ]);
        expect(await operationQueue.getIssues()).toHaveLength(ops.length);
        expect((await syncEngine.flush()).pushed).toBe(0);
    });

    it('2) CARACTERIZAÇÃO: camada bloqueada NÃO é gate de servidor, e o gesto entra', async () => {
        // NÃO É APROVAÇÃO. `layers.locked` é convenção do cliente: o servidor persiste a coluna e
        // nunca a consulta, e o único gate de trava é `maps.locked`. O caso existe para que a
        // diferença fique medida, porque as duas se parecem na tela e só uma tem dono.
        await operationQueue.clear();
        const { snapshot } = await apiClient.pullSync(atlasId, 0);
        const camada = snapshot.maps.find((m) => m.id === mapId).layers[0];
        expect(camada, 'o mapa nasce com a camada padrão').toBeTruthy();

        await dono.pushOperations(atlasId, [
            createOperation('layer', 'update', camada.id, mapId, { ...camada, locked: true }),
        ]);

        // PISO CONTRA COBERTURA VAZIA: sem confirmar que a trava FOI GRAVADA, este caso passaria
        // verde com a trava nunca aplicada, medindo uma escrita comum e chamando isso de
        // "camada travada não bloqueia".
        const depoisDaTrava = await apiClient.pullSync(atlasId, 0);
        expect(depoisDaTrava.snapshot.maps.find((m) => m.id === mapId)
            .layers.find((l) => l.id === camada.id).locked,
        'o servidor PERSISTE a coluna, e é isso que torna a ausência de gate mensurável').toBe(true);

        const featureId = generateUUID();
        const op = createOperation('feature', 'create', featureId, mapId, {
            ...pontoMinimo(featureId, 20),
            layer_id: camada.id,
        });
        await operationQueue.enqueueAll([op]);

        expect((await syncEngine.flush()).pushed, 'o servidor não consulta a trava de camada').toBe(1);
        expect(await operationQueue.getIssues()).toEqual([]);
        expect(await feicoesNoServidor(mapId)).toContain(featureId);

        await dono.pushOperations(atlasId, [
            createOperation('layer', 'update', camada.id, mapId, { ...camada, locked: false }),
        ]);
    });

    it('3) DESTINO EXCLUÍDO: o gesto que toca a entidade excluída volta como conflito', async () => {
        await operationQueue.clear();

        // O DONO monta o estado: um grupo com um membro, e depois o exclui.
        const alvoId = generateUUID();
        const groupId = generateUUID();
        await dono.pushOperations(atlasId, [
            createOperation('feature', 'create', alvoId, mapId, pontoMinimo(alvoId, 30)),
        ]);
        await dono.pushOperations(atlasId, [
            createOperation('group', 'create', groupId, mapId, {
                name: 'Grupo que vai sumir', visible: true, locked: false, features: [],
            }),
        ]);
        await dono.pushOperations(atlasId, [
            createOperation('group', 'delete', groupId, mapId, null),
        ]);

        // O CONVIDADO não viu a exclusão e manda o gesto "renomear o grupo e ligar uma feição".
        const ops = createBatchOperations([
            {
                entityType: 'group',
                operationType: 'update',
                entityId: groupId,
                mapId,
                data: { name: 'Renomeado pelo convidado', visible: true, locked: false },
            },
            {
                entityType: 'group_feature',
                operationType: 'create',
                entityId: generateUUID(),
                mapId,
                data: { group_id: groupId, feature_id: alvoId, feature_type: 'point' },
            },
        ]);
        await operationQueue.enqueueAll(ops);

        expect((await syncEngine.flush()).pushed).toBe(0);
        const problemas = await operationQueue.getIssues();
        expect(problemas).toHaveLength(2);
        for (const { result } of problemas) {
            expect(result.reason).toMatch(/foi excluido no servidor/);
            expect(result.batchFailedOperationId, 'a culpada é a op que tocou o excluído')
                .toBe(ops[0].id);
        }
        // O ENVELOPE DE CONFLITO FICA SÓ NA CULPADA, e é por isso que as classes DIVERGEM dentro
        // do mesmo gesto: mandar o irmão resolver o conflito seria resolvê-lo na entidade errada.
        const culpada = problemas.find((p) => p.operation.id === ops[0].id);
        const irma = problemas.find((p) => p.operation.id === ops[1].id);
        expect(culpada.classe).toBe(IssueClass.CONFLITO);
        expect(culpada.result.conflict).toBeTruthy();
        expect(culpada.result.conflict.deleted).toBe(true);
        expect(irma.classe).toBe(IssueClass.RECUSA);
        expect(irma.result.conflict).toBeUndefined();

        // E o grupo continua excluído: nada do gesto o ressuscitou.
        const { snapshot } = await apiClient.pullSync(atlasId, 0);
        expect((snapshot.maps.find((m) => m.id === mapId).groups ?? [])
            .some((g) => g.id === groupId)).toBe(false);
    });

    it('3b) DESTINO EXCLUÍDO pela outra porta: criar dentro do MAPA excluído derruba o gesto', async () => {
        // A SEGUNDA PORTA, com FRASE PRÓPRIA. A guarda de tombstone do caso acima lê a linha da
        // ENTIDADE da op, então ela não teria nada a dizer sobre uma criação cujo PAI sumiu; quem
        // responde aqui é o comando de feição, antes do INSERT. Medido em 2026-09-13, depois de
        // uma aposta errada em sentido contrário: o EXISTS do INSERT realmente não olha
        // `deleted_at`, e mesmo assim nada entra, porque a recusa acontece antes dele.
        await operationQueue.clear();
        const mapaCondenado = await createMap(dono, atlasId, { name: 'Mapa que vai sumir' });
        await dono.pushOperations(atlasId, [
            createOperation('map', 'delete', mapaCondenado, null, null),
        ]);
        expect(await feicoesNoServidor(mapaCondenado), 'o mapa sai do snapshot').toBeNull();

        const { ops } = gestoDeDuasFeicoes(mapaCondenado, 40);
        await operationQueue.enqueueAll(ops);

        expect((await syncEngine.flush()).pushed).toBe(0);
        const problemas = await operationQueue.getIssues();
        expect(problemas).toHaveLength(ops.length);
        for (const { result } of problemas) {
            expect(result.reason).toMatch(/mapa de destino foi excluido/);
            expect(result.batchFailedOperationId).toBe(ops[0].id);
        }
        // A MESMA ASSIMETRIA DO CASO 3: o conflito descreve a op que o produziu, e é a PRIMEIRA
        // que o servidor alcançou dentro do savepoint, não uma escolha do cliente.
        expect(problemas.find((p) => p.operation.id === ops[0].id).classe).toBe(IssueClass.CONFLITO);
        expect(problemas.find((p) => p.operation.id === ops[1].id).classe).toBe(IssueClass.RECUSA);
        expect((await operationQueue.getAll()).length, 'e nada saiu da fila').toBe(ops.length);
    });

    it('4) PERMISSÃO ALTERADA entre a intenção e o push: o flush lança e a fila guarda tudo', async () => {
        await operationQueue.clear();
        const { ops } = gestoDeDuasFeicoes(mapId, 50);
        await operationQueue.enqueueAll(ops);

        // O REBAIXAMENTO ACONTECE DEPOIS DE A INTENÇÃO ESTAR NO DISCO, que é o cenário do aceite.
        await permitir('read');

        await expect(syncEngine.flush()).rejects.toMatchObject({ status: 403 });

        // NADA SAI E NADA VIRA PROBLEMA DURÁVEL: 403 não está entre as recusas permanentes (400 e
        // 422), então o gesto continua enviável e espera. Guardar problema aqui pediria decisão
        // humana sobre um estado que outra pessoa desfaz.
        expect((await operationQueue.getAll()).map((op) => op.id).sort())
            .toEqual(ops.map((op) => op.id).sort());
        expect(await operationQueue.getIssues()).toEqual([]);
        expect((await operationQueue.countByState()).pendentes).toBe(ops.length);

        // E QUANDO A PERMISSÃO VOLTA, o mesmo gesto sai sozinho, inteiro. É esta metade que prova
        // que a espera era espera, e não perda.
        await permitir('write');
        expect((await syncEngine.flush()).pushed).toBe(ops.length);
        expect(await operationQueue.getAll()).toEqual([]);
    });

    it('5) EDIÇÃO CONCORRENTE antes do desfazer: o gesto de desfazer cai inteiro', async () => {
        await operationQueue.clear();

        // Duas feições do convidado, e a base que ele OBSERVOU antes de o par mexer.
        const alvo = generateUUID();
        const vizinha = generateUUID();
        await apiClient.pushOperations(atlasId, [
            createOperation('feature', 'create', alvo, mapId, pontoMinimo(alvo, 60)),
            createOperation('feature', 'create', vizinha, mapId, pontoMinimo(vizinha, 61)),
        ]);
        const { snapshot } = await apiClient.pullSync(atlasId, 0);
        const lidas = Object.values(snapshot.maps.find((m) => m.id === mapId).features)
            .flat();
        const baseAlvo = lidas.find((f) => f.properties.id === alvo);
        const baseVizinha = lidas.find((f) => f.properties.id === vizinha);
        const versaoObservada = baseAlvo.properties.confirmedVersion;
        expect(versaoObservada, 'sem base confirmada o caso mediria outra recusa').toBeGreaterThan(0);

        // O PAR EDITA A MESMA FEIÇÃO. A partir daqui a base acima está velha.
        await dono.pushOperations(atlasId, [
            createOperation('feature', 'update', alvo, mapId,
                { ...baseAlvo, properties: { ...baseAlvo.properties, nome: 'Editado pelo par' } },
                baseAlvo),
        ]);

        // O DESFAZER do convidado: um gesto de duas ops, uma por feição, com a base que ele viu.
        const desfazer = createBatchOperations([
            {
                entityType: 'feature',
                operationType: 'update',
                entityId: alvo,
                mapId,
                data: { ...baseAlvo, properties: { ...baseAlvo.properties, nome: 'Desfeito' } },
                previousData: baseAlvo,
            },
            {
                entityType: 'feature',
                operationType: 'update',
                entityId: vizinha,
                mapId,
                data: { ...baseVizinha, properties: { ...baseVizinha.properties, nome: 'Desfeito' } },
                previousData: baseVizinha,
            },
        ]);
        expect(desfazer[0].baseVersion, 'o desfazer precisa declarar a base VELHA')
            .toBe(versaoObservada);
        await operationQueue.enqueueAll(desfazer);

        expect((await syncEngine.flush()).pushed, 'o gesto de desfazer cai inteiro').toBe(0);

        const problemas = await operationQueue.getIssues();
        expect(problemas).toHaveLength(2);
        const culpada = problemas.find((p) => p.operation.id === desfazer[0].id);
        const irma = problemas.find((p) => p.operation.id === desfazer[1].id);
        expect(culpada.classe).toBe(IssueClass.CONFLITO);
        expect(culpada.result.conflict.entityVersion).toBeGreaterThan(versaoObservada);
        expect(irma.classe).toBe(IssueClass.RECUSA);
        expect(irma.result.batchFailedOperationId).toBe(desfazer[0].id);

        // A METADE QUE O USUÁRIO SENTIRIA: a VIZINHA, que não tinha conflito nenhum, não foi
        // desfeita. Metade de um desfazer é o pior desfecho possível, e é o que o lote impede.
        const depois = await apiClient.pullSync(atlasId, 0);
        const vizinhaDepois = Object.values(depois.snapshot.maps.find((m) => m.id === mapId).features)
            .flat().find((f) => f.properties.id === vizinha);
        expect(vizinhaDepois.properties.nome).not.toBe('Desfeito');
        expect((await operationQueue.getAll()).length, 'e nada saiu da fila').toBe(2);
    });
});
