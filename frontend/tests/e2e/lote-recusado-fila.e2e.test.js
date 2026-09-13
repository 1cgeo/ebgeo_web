// Path: tests/e2e/lote-recusado-fila.e2e.test.js

/**
 * @fileoverview O QUE A FILA DO CLIENTE FAZ COM O RECIBO DE UM LOTE RECUSADO PELO SERVIDOR REAL.
 *
 * ================= A METADE QUE FALTAVA ======================================================
 *
 * `lote-logico.e2e.test.js` empurra o array direto pelo `ApiClient` e mede o SERVIDOR: o gesto
 * aplica ou recusa inteiro. Ele não passa pela fila, então não diz nada sobre o desfecho que o
 * usuário sente, que é o outro lado da mesma moeda: se um único membro sair da fila por ter sido
 * acked, o gesto volta pela metade na rodada seguinte, e a aplicação parcial que o savepoint
 * impediu no servidor acontece adiada, pelo cliente.
 *
 * As provas de fila que já existiam dirigem um servidor de MENTIRA
 * (`tests/integration/fila-recorte-por-lote.test.js` e irmãs): elas escolhem o recibo que querem
 * medir. Aqui o recibo é o que o servidor de verdade devolve, e a fila, o motor e a fábrica de
 * envelopes são os do produto.
 *
 * ================= O QUE CADA CASO PROVA =====================================================
 *
 *  1. LOTE RECUSADO: nada é desenfileirado (os mesmos ids continuam no disco), TODO membro ganha
 *     problema durável com o `batchId` do gesto e o `batchFailedOperationId` da culpada, o censo
 *     passa a contar zero envio pendente, e o servidor continua sem o gesto. É a asserção literal
 *     do aceite do bloco B6.
 *
 *     `count()` NÃO é o tamanho da fila, e confundir os dois é o erro que este arquivo cometeu na
 *     primeira versão: ele responde o que o flush pode enviar AGORA, então depois da recusa vale
 *     ZERO com os cinco envelopes intactos no disco. Quem responde "o que está guardado" é
 *     `getAll()`, e a soma dos três baldes de `countByState()` é o total.
 *  2. CONTROLE: o MESMO gesto, sem a culpada, é enviado e desenfileirado inteiro, sem problema
 *     nenhum. Sem ele, "nada saiu da fila" seria indistinguível de uma fila que nunca desenfileira,
 *     e o caso 1 passaria verde com o flush quebrado.
 *  3. A SEGUNDA RODADA NÃO REENVIA o gesto recusado: o carregador pula quem carrega problema, de
 *     modo que o flush seguinte não volta ao servidor e não gira em vazio. É o que separa
 *     "guardado para revisão" de "preso num laço de 1,5 s".
 *
 * ================= ARMADILHAS DESTE ARQUIVO ==================================================
 *
 * Ele TOMA PARA SI os singletons do cliente (`syncEngine`, `operationQueue`, `apiClient`) e monta
 * um escopo remoto de verdade (`activateRemoteAtlas`), como `offline-then-flush.e2e.test.js`. Por
 * isso os envelopes são criados DEPOIS da montagem: a fábrica carimba neles o `scopeSuffix` do
 * escopo ativo, e o carregador da fila filtra por ele — envelope nascido antes seria invisível
 * para o `peek` e o arquivo mediria uma fila vazia.
 *
 * E o flush que registra problema termina chamando `resync()`, que aplica um snapshot de verdade
 * no store local. Não é efeito colateral do teste: é o que o produto faz, e é por isso que o
 * `connect` aqui pede `initialPull: false` mas o estado local acaba populado assim mesmo.
 *
 * ================= O QUE ELE NÃO PROVA, DECLARADO ============================================
 *
 * A guarda de `acknowledgedOperationIds` que segura um irmão ACKED COMO APLICADO dentro de um lote
 * recusado não é alcançável daqui: o servidor de verdade responde todos os membros com o mesmo
 * status, então produzir esse recibo exigiria um servidor que quebrasse o contrato. Ela é medida
 * com recibo montado à mão em `tests/unit/sync-ack-por-operacao.test.js`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getBaseUrl, E2E_SKIP } from './helpers/harness.js';
import { pendingVerificationToken } from './helpers/db.js';
import { activateRemoteAtlas } from '../../src/js/store/remote-atlas.api.js';
import { syncEngine } from '../../src/js/store/sync/sync-engine.js';
import { apiClient } from '../../src/js/store/sync/api-client.js';
import { operationQueue } from '../../src/js/store/sync/operation-queue.js';
import { createOperation, createBatchOperations } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

/** Membros do gesto medido aqui: quatro válidos mais a culpada, com a culpada no meio. */
const MEMBROS_VALIDOS = 4;
const INDICE_DA_CULPADA = 2;

describe.skipIf(E2E_SKIP)('e2e: a fila diante de um lote recusado pelo servidor', () => {
    let atlasId;
    let mapId;
    let groupId;
    /** @type {string[]} Ids das feições reais, membros legítimos do gesto. */
    let reais;

    /** O ponto mínimo que o servidor aceita: ele deriva o tipo de `properties.source`. */
    const pontoMinimo = (featureId, i) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-43.2 + i * 0.001, -22.9 + i * 0.001] },
        properties: { source: 'point', id: featureId },
    });

    /** Uma op de membresia, a peça do gesto "agrupar N feições". */
    const membro = (featureId) => ({
        entityType: 'group_feature',
        operationType: 'create',
        entityId: generateUUID(),
        mapId,
        data: { group_id: groupId, feature_id: featureId, feature_type: 'point' },
    });

    /** Os membros do grupo, lidos do servidor pela porta pública. */
    async function membrosNoServidor() {
        const { snapshot } = await apiClient.pullSync(atlasId, 0);
        const grupo = snapshot.maps.find((m) => m.id === mapId)?.groups?.find((g) => g.id === groupId);
        expect(grupo, 'o grupo é criado no setup e não pode sumir').toBeTruthy();
        return (grupo.features ?? []).map((f) => f.id).sort();
    }

    beforeAll(async () => {
        syncEngine.configure({ baseUrl: `${getBaseUrl()}/api/v1` });

        const username = `e2e_${generateUUID().replace(/-/g, '').slice(0, 16)}`;
        const password = 'Sup3r-Secret-Pw!';
        await syncEngine.register({
            username, password, nome: 'Dono do Lote Recusado', email: `${username}@example.mil`,
        });
        await apiClient.verifyEmail(await pendingVerificationToken(username));
        expect(await syncEngine.login({ username, password })).toBeTruthy();

        const atlas = await apiClient.createAtlas({ name: 'Atlas do lote recusado' });
        atlasId = atlas.id;
        mapId = generateUUID();
        groupId = generateUUID();
        reais = Array.from({ length: MEMBROS_VALIDOS }, () => generateUUID());

        // O ESTADO DE PARTIDA VIAJA FORA DA FILA, de propósito: mapa, feições e grupo existem no
        // servidor ANTES do gesto, para que a única coisa medida abaixo seja o gesto.
        await apiClient.pushOperations(atlasId, [
            createOperation('map', 'create', mapId, null, { name: 'Mapa do gesto' }),
        ]);
        await apiClient.pushOperations(atlasId,
            reais.map((id, i) => createOperation('feature', 'create', id, mapId, pontoMinimo(id, i))));
        await apiClient.pushOperations(atlasId, [
            createOperation('group', 'create', groupId, mapId, {
                name: 'Grupo do gesto', visible: true, locked: false, features: [],
            }),
        ]);

        await activateRemoteAtlas(atlasId);
        expect(await syncEngine.connect(atlasId, { initialPull: false })).toBeTruthy();
    }, 60000);

    afterAll(async () => {
        syncEngine.disconnect();
        await operationQueue.clear();
    });

    it('1) o lote recusado NÃO perde membro nenhum da fila, e todos ganham problema durável', async () => {
        await operationQueue.clear();
        expect(await operationQueue.getAll()).toEqual([]);

        const fantasma = generateUUID();   // feição que nunca existiu: a culpada
        const alvos = [...reais];
        alvos.splice(INDICE_DA_CULPADA, 0, fantasma);
        const ops = createBatchOperations(alvos.map(membro));

        // PISO CONTRA COBERTURA VAZIA: sem isto, tudo abaixo continuaria verde medindo N ops
        // individuais e chamando o resultado de lote.
        expect(new Set(ops.map((op) => op.batchId)).size).toBe(1);
        expect(ops[0].batchId).toBeTruthy();
        const batchId = ops[0].batchId;
        const culpada = ops[INDICE_DA_CULPADA].id;

        await operationQueue.enqueueAll(ops);
        // `count()` NÃO É O TAMANHO DA FILA, e ler assim é o defeito que a assinatura dele existe
        // para impedir: ele responde o que o flush pode enviar AGORA. Quem responde "o que está no
        // disco" é `getAll()`, e é a distinção que dá sentido às duas leituras depois do flush.
        expect(await operationQueue.count(),
            'antes do flush o gesto inteiro é trabalho enviável').toBe(ops.length);
        expect(await operationQueue.getAll()).toHaveLength(ops.length);

        const resultado = await syncEngine.flush();

        // NADA SAIU DA FILA. `pushed` conta o que foi desenfileirado, e o disco confirma.
        expect(resultado.pushed, 'nenhum membro de lote recusado é desenfileirado').toBe(0);
        expect((await operationQueue.getAll()).map((op) => op.id).sort(),
            'os cinco envelopes continuam no disco, com os mesmos ids')
            .toEqual(ops.map((op) => op.id).sort());

        // E TODOS VIRARAM PROBLEMA DURÁVEL, nomeando o gesto e a culpada. É isso que impede a
        // irmã de voltar enviável e o gesto de sair pela metade na rodada seguinte.
        const problemas = await operationQueue.getIssues();
        expect(problemas).toHaveLength(ops.length);
        expect(problemas.map((p) => p.operation.id).sort()).toEqual(ops.map((op) => op.id).sort());
        for (const { operation, result } of problemas) {
            expect(result.batchId, `${operation.id} precisa nomear o gesto`).toBe(batchId);
            expect(result.batchFailedOperationId, 'e a culpada, para todas').toBe(culpada);
            expect(result.reason).toMatch(/referencia um item que não existe mais/);
        }

        const censo = await operationQueue.countByState();
        expect(censo.pendentes, 'não sobra trabalho enviável: o flush não tem o que fazer').toBe(0);
        expect(censo.problemas).toBe(ops.length);

        // O SERVIDOR CONTINUA SEM O GESTO: nem os membros válidos que precediam a culpada.
        expect(await membrosNoServidor()).toEqual([]);
    });

    it('2) a rodada seguinte não reenvia o gesto guardado', async () => {
        // Sem este caso, um cliente que reenviasse a cada 1,5 s para sempre passaria no caso 1: o
        // disco continuaria igual, e o laço em vazio é invisível de lá.
        const antes = (await operationQueue.getAll()).length;
        expect(antes, 'este caso depende do estado deixado pelo caso 1').toBeGreaterThan(0);
        const resultado = await syncEngine.flush();
        expect(resultado.pushed).toBe(0);
        expect(await operationQueue.getAll()).toHaveLength(antes);
        expect((await operationQueue.countByState()).pendentes).toBe(0);
        expect(await membrosNoServidor()).toEqual([]);
    });

    it('3) CONTROLE: o mesmo gesto SEM a culpada sai inteiro e a fila esvazia', async () => {
        await operationQueue.clear();
        expect(await operationQueue.getAll()).toEqual([]);

        const ops = createBatchOperations(reais.map(membro));
        expect(new Set(ops.map((op) => op.batchId)).size).toBe(1);
        await operationQueue.enqueueAll(ops);

        const resultado = await syncEngine.flush();
        expect(resultado.pushed, 'o gesto válido é desenfileirado inteiro').toBe(ops.length);
        expect(await operationQueue.getAll(), 'e o disco esvazia junto').toEqual([]);
        expect(await operationQueue.getIssues()).toEqual([]);

        // E O EFEITO CHEGOU: os quatro membros estão ligados no servidor.
        expect(await membrosNoServidor()).toEqual([...reais].sort());
    });
});
