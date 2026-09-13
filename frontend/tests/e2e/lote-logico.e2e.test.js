// Path: tests/e2e/lote-logico.e2e.test.js

/**
 * @fileoverview O LOTE LÓGICO ATRAVESSANDO OS DOIS PACOTES: o gesto que o CLIENTE carimba é o
 * gesto que o SERVIDOR aplica ou recusa inteiro.
 *
 * ================= A CAUSA (F9 do plano de lançamento, decisão D4) ============================
 *
 * `pushOperations` abria um SAVEPOINT POR OPERAÇÃO. Isso é certo para op avulsa (a violação de
 * dado de uma não pode envenenar a fila inteira), e virou defeito quando vários GESTOS passaram a
 * emitir várias ops de uma vez: criar grupo é um `group` create mais um `group_feature` create por
 * membro, e conversão, transferência de camada e colagem são iguais. O servidor não lia o
 * `batchId` (ele atravessava o `.unknown(true)` do schema e morria ali), então a aplicação PARCIAL
 * de um comando composto era o desfecho NORMAL: um membro recusado deixava o grupo criado, os
 * irmãos dentro dele, e a resposta era 200. O reenvio não consertava, porque a recusa é
 * determinística.
 *
 * O contrato novo tem duas metades, e cada uma foi fechada no seu pacote: o SERVIDOR agrupa por
 * `batchId` e aplica num savepoint só (B6a), e o CLIENTE nunca corta um push dentro de um lote
 * (B6b). Nenhuma das duas suítes herméticas mede a costura.
 *
 * ================= O QUE ESTE ARQUIVO MEDE, E POR QUE SÓ ELE PODE ============================
 *
 * Ele empurra pelo HTTP real, contra o backend real, envelopes montados pela FÁBRICA DE VERDADE
 * do cliente (`createBatchOperations` / `createOperation`), e não por um objeto escrito à mão.
 * A prova hermética do servidor (`backend/tests/integration/lote-logico-atomico.repro.test.js`)
 * monta os envelopes a mão e por isso não pode dizer que o cliente carimba o que o servidor lê;
 * as provas do cliente (`frontend/tests/integration/fila-recorte-por-lote.test.js` e irmãs)
 * dirigem a fila contra um servidor de mentira e por isso não podem dizer o que o de verdade faz
 * com o carimbo. A junta é aqui.
 *
 * NENHUM ACESSO DIRETO AO BANCO, de propósito, e não por comodidade: a tabela `operations` é
 * LEGÍVEL pela porta pública, no replay incremental (`pullSync` a partir de uma versão), e é essa
 * a leitura que este arquivo usa para dizer "nenhuma linha nova". Ler por SQL provaria a mesma
 * coisa por um caminho que o produto não tem.
 *
 * ================= O QUE CADA CASO PROVA =====================================================
 *
 *  1. AGRUPAR COM UM MEMBRO INVÁLIDO: o gesto inteiro cai. Três acks, um motivo só, o mesmo
 *     `batchId`, o mesmo `batchFailedOperationId` nomeando a culpada, e NADA no banco: nem o
 *     grupo, nem a associação que era válida, nem uma linha no log. É o defeito F9 em forma de
 *     asserção.
 *  2. LOTE VÁLIDO DE 30: aplica inteiro, em versões CONTÍGUAS (o gesto não é entrelaçado com
 *     nada), e o replay incremental devolve as 30 CARREGANDO o `batchId` — ou seja, a coluna de
 *     lote é persistida e ecoada, e um par que estava offline recebe o gesto como gesto.
 *  3. REENVIO: o lote RECUSADO é recusado de novo (o recibo da recusa é gravado na transação de
 *     FORA, então sobrevive ao rollback), e o lote APLICADO é idempotente (mesmos ids, MESMAS
 *     versões de servidor, nenhuma linha nova no replay). As duas metades juntas são o que
 *     impede a aplicação parcial ADIADA: sem a primeira, as irmãs entrariam na segunda tentativa.
 *  4. ACIMA DO TETO: um lote de 201 é recusado inteiro, com motivo em pt-BR, e o teto recusa
 *     ANTES de escrever: a versão do atlas não se move e o replay não ganha op nenhuma.
 *  5. A FRONTEIRA: sem `batchId` nada muda. Três ops individuais no MESMO push, uma recusada e as
 *     outras aplicadas. Sem este caso, os quatro acima não distinguem "o lote virou a unidade" de
 *     "o servidor ficou mais rígido com todo mundo".
 *  6. CONVERSÃO COMO LOTE: o create do id NOVO mais o delete da origem com base ERRADA. O gesto
 *     inteiro é recusado e a feição nova NÃO fica criada, que é a duplicação silenciosa que o
 *     savepoint por op produzia. É também o único caso em que a culpada devolve `conflict`, e ele
 *     mede a assimetria declarada do contrato: o `status` da culpada é `conflict` e o das irmãs é
 *     `rejected`, porque o envelope de conflito descreve UMA entidade e carimbá-lo nas irmãs
 *     mandaria o cliente resolver o conflito da entidade errada.
 *  7. A POSIÇÃO DA CULPADA NÃO MUDA O DESFECHO: o mesmo gesto de cinco membros, com a falha
 *     injetada no PRIMEIRO, no INTERMEDIÁRIO e no ÚLTIMO. As três posições são medições
 *     diferentes do MESMO contrato, e nenhuma delas é implicada pelas outras: no primeiro membro
 *     o savepoint não tinha escrito nada e o rollback é trivial; no intermediário e no último ele
 *     já escreveu irmãs, e o que se mede é o desfazimento delas. Os casos 1 e 6 cobriam apenas o
 *     ÚLTIMO, que é a posição mais fácil de acertar por acidente (um servidor que parasse no
 *     primeiro erro e não desfizesse nada passaria neles). Nenhum ack volta com `success: true`,
 *     que é a forma direta de dizer "nenhuma aplicação parcial acked como sucesso".
 *
 * ================= O QUE ELE NÃO PROVA, DECLARADO ============================================
 *
 * O servidor define o lote como "as ops com aquele `batchId` que chegaram NESTE push": a fábrica
 * carimba `batchId` e `batchIndex` e não um total, então um lote que chegue partido é indistinguível
 * de um lote completo. Quem impede o corte é o recorte de envio do cliente, e isso se mede na fila
 * (`frontend/tests/integration/fila-recorte-por-lote.test.js`), não aqui: este arquivo empurra o
 * array direto pelo `ApiClient`, sem passar pela fila.
 *
 * O QUE A FILA FAZ COM O RECIBO DA RECUSA (nenhum membro desenfileirado, problema durável em
 * todos) é a outra metade do mesmo contrato e mora em `lote-recusado-fila.e2e.test.js`, que dirige
 * a fila e o motor de verdade contra este mesmo servidor. Separado porque aquele arquivo toma os
 * singletons do cliente para si, e este não toma nenhum.
 *
 * O `featureIntent` NÃO aparece no caso 6, e a ausência é o contrato e não um esquecimento: `move`
 * e `restore` existem para REUSAR um id que o servidor já conhece (uma feição viva em outro mapa,
 * um tombstone). A conversão cunha um id NOVO, e para id novo `prepareFeatureMutation` exige
 * justamente que não haja intenção nenhuma declarada.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
    confirmedFeature,
    E2E_SKIP,
} from './helpers/harness.js';
import { createOperation, createBatchOperations } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

/** Quantas ops leva o lote válido do caso 2 (e, por consequência, o do caso 3). */
const TAMANHO_DO_LOTE_VALIDO = 30;

/** Quantas ops leva o lote do caso 4. Acima do teto declarado pelo servidor, conferido lá. */
const TAMANHO_ACIMA_DO_TETO = 201;

/** Quantos membros tem o gesto do caso 7. Cinco é o menor tamanho com um meio inequívoco. */
const MEMBROS_DO_GESTO = 5;

/**
 * As três posições da culpada dentro do gesto do caso 7, e por que são exatamente estas.
 *
 * O PRIMEIRO mede o rollback de um savepoint que ainda não escreveu nada; o INTERMEDIÁRIO e o
 * ÚLTIMO medem o desfazimento de irmãs que JÁ escreveram, e o último é o único que os casos 1 e 6
 * cobriam. A distinção não é cerimônia: um servidor que apenas PARASSE no primeiro erro, sem
 * desfazer, passaria no caso do primeiro membro e falharia nos outros dois.
 */
const POSICOES_DA_CULPADA = [
    { rotulo: 'PRIMEIRO', indice: 0 },
    { rotulo: 'INTERMEDIÁRIO', indice: 2 },
    { rotulo: 'ÚLTIMO', indice: MEMBROS_DO_GESTO - 1 },
];

describe.skipIf(E2E_SKIP)('e2e: o lote lógico aplica ou recusa inteiro', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let api;
    let atlasId;

    // O caso 3 reenvia OS MESMOS envelopes dos casos 1 e 2 — é essa a propriedade que ele mede,
    // e remontar envelopes novos mediria outra coisa (ids novos são um gesto novo). Guardados
    // aqui, e o caso 3 recusa-se a rodar sem eles em vez de estourar num `undefined`.
    let loteRecusado = null;
    let mapaDoLoteRecusado = null;
    let grupoDoLoteRecusado = null;
    let loteAplicado = null;
    let versaoAntesDoLoteAplicado = null;
    let replayDoLoteAplicado = null;

    /**
     * A versão corrente do atlas, lida pela porta pública.
     * @returns {Promise<number>}
     */
    async function versaoDoAtlas() {
        const res = await api.pullSync(atlasId, 0);
        expect(res.isSnapshot).toBe(true);
        return res.currentVersion;
    }

    /**
     * O REPLAY INCREMENTAL a partir de uma versão: é a leitura pública da tabela `operations`.
     * @param {number} desde - Versão exclusiva (o servidor devolve `server_version > desde`).
     * @returns {Promise<Object[]>}
     */
    async function replayDesde(desde) {
        expect(desde, 'versão zero devolve snapshot, não replay').toBeGreaterThan(0);
        const res = await api.pullSync(atlasId, desde);
        expect(res.isSnapshot, 'o replay precisa ser incremental, senão não há log para ler').toBe(false);
        return res.operations;
    }

    /**
     * Um mapa do snapshot, ou `undefined`.
     * @param {string} mapId
     * @returns {Promise<Object|undefined>}
     */
    async function mapaDoSnapshot(mapId) {
        const res = await api.pullSync(atlasId, 0);
        return res.snapshot.maps.find((m) => m.id === mapId);
    }

    /** Todos os ids de feição de um mapa do snapshot, de todos os baldes de tipo. */
    const idsDeFeicao = (mapa) => Object.values(mapa?.features ?? {})
        .flat()
        .map((f) => f?.properties?.id);

    /**
     * A geometria mínima que a ferramenta de ponto emite: o servidor deriva `feature_type` de
     * `properties.source`, e nada mais é obrigatório.
     * @param {string} featureId
     * @param {number} [i=0] - Desloca a coordenada, para que 30 feições não fiquem empilhadas.
     * @returns {Object}
     */
    function pontoMinimo(featureId, i = 0) {
        return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-43.2 + i * 0.001, -22.9 + i * 0.001] },
            properties: { source: 'point', id: featureId },
        };
    }

    /** Um create de ponto avulso (sem lote), para semear estado. */
    const criarPonto = (mapId, featureId, i = 0) =>
        createOperation('feature', 'create', featureId, mapId, pontoMinimo(featureId, i));

    /**
     * O GESTO "criar grupo com N membros", montado pela fábrica de lote do cliente: um `group`
     * create no índice 0 e um `group_feature` create por membro em seguida.
     *
     * O `entityId` da op de membresia é um UUID DESCARTÁVEL (a coluna `operations.entity_id` é
     * UUID, e um id por par é o que impede a compactação da fila de colapsar várias mudanças de
     * membresia numa só); o par que o servidor consome viaja em `data`.
     *
     * @param {string} mapId
     * @param {string} groupId
     * @param {string[]} featureIds - Ids dos membros, na ordem em que entram no lote.
     * @returns {Object[]}
     */
    function opsDeAgrupar(mapId, groupId, featureIds) {
        return createBatchOperations([
            {
                entityType: 'group',
                operationType: 'create',
                entityId: groupId,
                mapId,
                data: {
                    name: 'Grupo do gesto',
                    visible: true,
                    locked: false,
                    features: featureIds.map((id) => ({ type: 'point', id })),
                },
            },
            ...featureIds.map((featureId) => ({
                entityType: 'group_feature',
                operationType: 'create',
                entityId: generateUUID(),
                mapId,
                data: { group_id: groupId, feature_id: featureId, feature_type: 'point' },
            })),
        ]);
    }

    /**
     * PISO CONTRA COBERTURA VAZIA: afirma que o que vai viajar é mesmo UM lote.
     *
     * Sem isto, todo caso deste arquivo continuaria verde se `createBatchOperations` parasse de
     * carimbar `batchId` — só que estaria medindo N ops individuais e chamando isso de lote.
     * @param {Object[]} ops
     */
    function afirmarLoteBemFormado(ops) {
        const carimbos = new Set(ops.map((op) => op.batchId));
        expect(carimbos.size, 'um lote é UM batchId').toBe(1);
        expect([...carimbos][0], 'o batchId não pode ser vazio: vazio NÃO agrupa').toBeTruthy();
        expect(ops.map((op) => op.batchIndex)).toEqual(ops.map((_, i) => i));
    }

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Dono do Lote' });
        const atlas = await createAtlas(api, { name: 'Atlas do lote lógico' });
        atlasId = atlas.id;
        expect(atlasId).toBeTruthy();
    }, 40000);

    it('1) agrupar com o SEGUNDO membro inválido: nada aplica, e os três acks acusam o mesmo gesto', async () => {
        const mapId = await createMap(api, atlasId, { name: 'Mapa do agrupar' });
        const membroValido = generateUUID();
        await api.pushOperations(atlasId, [criarPonto(mapId, membroValido)]);

        const versaoAntes = await versaoDoAtlas();
        const groupId = generateUUID();
        const fantasma = generateUUID();   // feição que nunca existiu: o FK do INSERT de junção cai
        const ops = opsDeAgrupar(mapId, groupId, [membroValido, fantasma]);
        afirmarLoteBemFormado(ops);
        expect(ops).toHaveLength(3);

        const res = await api.pushOperations(atlasId, ops);
        const results = res.results;

        expect(results, 'um ack por op do lote').toHaveLength(3);
        expect(results.map((r) => r.success)).toEqual([false, false, false]);

        // UM MOTIVO SÓ. Duas ops com motivos diferentes seria a resposta de dois savepoints.
        const motivos = new Set(results.map((r) => r.reason));
        expect(motivos.size, `motivos vieram: ${[...motivos].join(' | ')}`).toBe(1);
        expect([...motivos][0]).toMatch(/referencia um item que não existe mais/);

        // O GESTO É NOMEADO PARA TODAS: o `batchId` diz QUAL lote caiu (sem ele o cliente não
        // distingue a recusa do gesto da recusa da op), e o `batchFailedOperationId` diz de quem
        // era o motivo (sem ele, N ops voltam com o mesmo texto e nada aponta a culpada).
        expect(new Set(results.map((r) => r.batchId))).toEqual(new Set([ops[0].batchId]));
        expect(new Set(results.map((r) => r.batchFailedOperationId))).toEqual(new Set([ops[2].id]));

        // Violação de integridade não é conflito: nenhuma das três traz envelope de conflito, e
        // por isso o `status` aqui é o MESMO para as três (o caso 6 mede a metade em que não é).
        expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected', 'rejected']);
        expect(results.some((r) => r.conflict)).toBe(false);

        // E O EFEITO, que é o defeito F9 propriamente dito: o grupo não existe, a associação que
        // era VÁLIDA sumiu junto com o gesto, e o log não ganhou uma linha.
        const mapa = await mapaDoSnapshot(mapId);
        expect((mapa.groups || []).some((g) => g.id === groupId), 'o grupo do gesto recusado não pode existir').toBe(false);
        expect(idsDeFeicao(mapa), 'a feição válida continua lá, ela não fazia parte do gesto')
            .toContain(membroValido);
        expect(await replayDesde(versaoAntes), 'nenhuma op do lote recusado entra no log').toEqual([]);
        expect(await versaoDoAtlas()).toBe(versaoAntes);

        loteRecusado = ops;
        mapaDoLoteRecusado = mapId;
        grupoDoLoteRecusado = groupId;
    });

    it(`2) lote válido de ${TAMANHO_DO_LOTE_VALIDO}: aplica inteiro, em versões contíguas, e o replay traz o batchId`, async () => {
        const mapId = await createMap(api, atlasId, { name: 'Mapa do lote de 30' });
        const versaoAntes = await versaoDoAtlas();

        const ids = Array.from({ length: TAMANHO_DO_LOTE_VALIDO }, () => generateUUID());
        const ops = createBatchOperations(ids.map((featureId, i) => ({
            entityType: 'feature',
            operationType: 'create',
            entityId: featureId,
            mapId,
            data: pontoMinimo(featureId, i),
        })));
        afirmarLoteBemFormado(ops);
        expect(ops).toHaveLength(TAMANHO_DO_LOTE_VALIDO);

        const res = await api.pushOperations(atlasId, ops);
        expect(res.results).toHaveLength(TAMANHO_DO_LOTE_VALIDO);
        expect(res.results.every((r) => r.success === true), 'o lote inteiro é aplicado').toBe(true);
        expect(new Set(res.results.map((r) => r.batchId))).toEqual(new Set([ops[0].batchId]));

        // VERSÕES CONTÍGUAS: o gesto ocupa uma faixa sem buracos, ou seja, não foi entrelaçado
        // com nenhuma outra escrita. É a forma observável de "um savepoint só".
        const versoes = res.results.map((r) => r.currentVersion);
        expect(new Set(versoes).size, 'cada op ocupa uma versão própria').toBe(TAMANHO_DO_LOTE_VALIDO);
        expect(Math.max(...versoes) - Math.min(...versoes),
            `a faixa precisa ser contígua, vieram ${Math.min(...versoes)}..${Math.max(...versoes)}`)
            .toBe(TAMANHO_DO_LOTE_VALIDO - 1);

        // AS 30 CHEGAM AO PAR COMO GESTO. É aqui que se mede a coluna `batch_id` de `operations`:
        // ela é persistida no INSERT e ecoada por `toFrontendOperation` no replay incremental.
        const replay = await replayDesde(versaoAntes);
        expect(replay).toHaveLength(TAMANHO_DO_LOTE_VALIDO);
        expect(new Set(replay.map((op) => op.batchId)), 'o replay ecoa o lote de origem')
            .toEqual(new Set([ops[0].batchId]));
        expect(new Set(replay.map((op) => op.id))).toEqual(new Set(ops.map((op) => op.id)));

        const mapa = await mapaDoSnapshot(mapId);
        expect(idsDeFeicao(mapa).sort()).toEqual([...ids].sort());

        loteAplicado = ops;
        versaoAntesDoLoteAplicado = versaoAntes;
        replayDoLoteAplicado = replay;
    });

    it('3) reenvio: o lote recusado é recusado de novo, e o lote aplicado é idempotente', async () => {
        expect(loteRecusado, 'este caso reenvia o lote do caso 1; ele precisa ter rodado').toBeTruthy();
        expect(loteAplicado, 'este caso reenvia o lote do caso 2; ele precisa ter rodado').toBeTruthy();

        // ── METADE A: o RECIBO da recusa sobrevive ao rollback do savepoint ──────────────────
        // O recibo é gravado na transação de FORA justamente para isto. Sem ele, a segunda
        // tentativa aplicaria as irmãs, que é a aplicação parcial apenas ADIADA.
        const versaoAntesDaRecusa = await versaoDoAtlas();
        const reenvioRecusado = await api.pushOperations(atlasId, loteRecusado);

        expect(reenvioRecusado.results).toHaveLength(loteRecusado.length);
        expect(reenvioRecusado.results.map((r) => r.success)).toEqual([false, false, false]);
        expect(reenvioRecusado.results.every((r) => r.idempotent === true),
            'o ack precisa dizer que a entrega é repetida, para o cliente não avisar duas vezes').toBe(true);
        expect(new Set(reenvioRecusado.results.map((r) => r.reason)).size,
            'a recusa repetida continua sendo um motivo só').toBe(1);
        expect(new Set(reenvioRecusado.results.map((r) => r.batchId)))
            .toEqual(new Set([loteRecusado[0].batchId]));

        // A culpada continua sendo NOMEADA para todas, e continua sendo UMA op deste lote.
        // (Hoje o reenvio nomeia a PRIMEIRA op com recibo de recusa, que é a do grupo, e não a
        // que originalmente ofendeu: o caminho do recibo não guarda a culpada original. Vale
        // afirmar a propriedade — uma só, e deste lote — e não o índice, que é detalhe de
        // implementação e mudaria numa melhoria.)
        const culpadas = new Set(reenvioRecusado.results.map((r) => r.batchFailedOperationId));
        expect(culpadas.size).toBe(1);
        expect(loteRecusado.map((op) => op.id)).toContain([...culpadas][0]);

        const mapa = await mapaDoSnapshot(mapaDoLoteRecusado);
        expect((mapa.groups || []).some((g) => g.id === grupoDoLoteRecusado),
            'aplicar as irmãs no reenvio seria a aplicação parcial adiada').toBe(false);
        expect(await replayDesde(versaoAntesDaRecusa)).toEqual([]);

        // ── METADE B: o lote APLICADO reenviado não escreve nada de novo ──────────────────────
        const reenvioAplicado = await api.pushOperations(atlasId, loteAplicado);
        expect(reenvioAplicado.results).toHaveLength(TAMANHO_DO_LOTE_VALIDO);
        expect(reenvioAplicado.results.every((r) => r.status === 'already_applied'),
            'o reenvio do gesto inteiro é entrega repetida').toBe(true);
        expect(reenvioAplicado.results.every((r) => r.idempotent === true)).toBe(true);
        expect(reenvioAplicado.results.map((r) => r.operationId))
            .toEqual(loteAplicado.map((op) => op.id));
        // OS MESMOS IDS E AS MESMAS VERSÕES: o ack devolve a versão que a op JÁ tinha, e não uma
        // nova, que é a forma de dizer que nenhuma linha foi escrita.
        expect(reenvioAplicado.results.map((r) => r.currentVersion))
            .toEqual(replayDoLoteAplicado
                .slice()
                .sort((a, b) => a.serverVersion - b.serverVersion)
                .map((op) => op.serverVersion));

        // NENHUMA LINHA NOVA EM `operations`, lido pela porta pública: o replay a partir da mesma
        // versão devolve exatamente o que devolvia antes do reenvio.
        const replayDepois = await replayDesde(versaoAntesDoLoteAplicado);
        expect(replayDepois).toHaveLength(TAMANHO_DO_LOTE_VALIDO);
        expect(replayDepois.map((op) => op.id).sort())
            .toEqual(replayDoLoteAplicado.map((op) => op.id).sort());
        expect(replayDepois.map((op) => op.serverVersion).sort((a, b) => a - b))
            .toEqual(replayDoLoteAplicado.map((op) => op.serverVersion).sort((a, b) => a - b));
    });

    it(`4) lote de ${TAMANHO_ACIMA_DO_TETO} ops é recusado inteiro, com motivo, sem tocar o banco`, async () => {
        const mapId = await createMap(api, atlasId, { name: 'Mapa do lote gigante' });
        const versaoAntes = await versaoDoAtlas();

        const ops = createBatchOperations(
            Array.from({ length: TAMANHO_ACIMA_DO_TETO }, (_, i) => {
                const featureId = generateUUID();
                return {
                    entityType: 'feature',
                    operationType: 'create',
                    entityId: featureId,
                    mapId,
                    data: pontoMinimo(featureId, i),
                };
            })
        );
        afirmarLoteBemFormado(ops);

        const res = await api.pushOperations(atlasId, ops);
        expect(res.results).toHaveLength(TAMANHO_ACIMA_DO_TETO);
        expect(res.results.filter((r) => r.success === true), 'nem uma op passa').toHaveLength(0);

        const motivos = new Set(res.results.map((r) => r.reason));
        expect(motivos.size).toBe(1);
        const motivo = [...motivos][0];
        expect(motivo).toMatch(/mais alterações do que o servidor aplica de uma vez/);

        // O TETO SE LÊ DO PRÓPRIO MOTIVO, em vez de ser recopiado aqui: uma segunda cópia de
        // `LOTE_MAX_OPS` neste arquivo ficaria errada no dia em que a medição mudasse o número, e
        // o caso passaria a medir um lote ABAIXO do teto sem que nada acusasse.
        const teto = Number(/máximo de (\d+)/.exec(motivo)?.[1]);
        expect(Number.isSafeInteger(teto), `o motivo precisa declarar o teto: "${motivo}"`).toBe(true);
        expect(TAMANHO_ACIMA_DO_TETO).toBeGreaterThan(teto);

        // ANTES DE ESCREVER QUALQUER COISA: a versão do atlas não se moveu e o log está vazio.
        expect(await versaoDoAtlas()).toBe(versaoAntes);
        expect(await replayDesde(versaoAntes)).toEqual([]);
        expect(idsDeFeicao(await mapaDoSnapshot(mapId))).toEqual([]);
    });

    it('5) sem batchId, o mesmo push segue individual: a ruim é recusada sozinha', async () => {
        // A FRONTEIRA. Sem este caso, os quatro acima não distinguem "o lote virou a unidade de
        // aplicação" de "o servidor passou a recusar o push inteiro por qualquer op ruim".
        const mapId = await createMap(api, atlasId, { name: 'Mapa das ops avulsas' });
        const versaoAntes = await versaoDoAtlas();

        const featureId = generateUUID();
        const groupId = generateUUID();
        const boa = criarPonto(mapId, featureId);
        const grupo = createOperation('group', 'create', groupId, mapId, {
            name: 'Grupo avulso', visible: true, locked: false, features: [],
        });
        const ruim = createOperation('group_feature', 'create', generateUUID(), mapId, {
            group_id: groupId, feature_id: generateUUID(), feature_type: 'point',
        });
        for (const op of [boa, grupo, ruim]) {
            expect(op.batchId, 'nenhuma destas pode carregar carimbo de lote').toBeUndefined();
        }

        const res = await api.pushOperations(atlasId, [boa, grupo, ruim]);
        expect(res.results.map((r) => r.success)).toEqual([true, true, false]);
        expect(res.results[2].reason).toMatch(/referencia um item que não existe mais/);
        expect(res.results.every((r) => r.batchId === undefined),
            'op individual não ganha batchId no ack').toBe(true);
        expect(res.results.every((r) => r.batchFailedOperationId === undefined)).toBe(true);

        // As duas boas persistiram AO LADO da recusa da terceira, que é o regime individual.
        const mapa = await mapaDoSnapshot(mapId);
        expect(idsDeFeicao(mapa)).toContain(featureId);
        expect((mapa.groups || []).some((g) => g.id === groupId)).toBe(true);

        const replay = await replayDesde(versaoAntes);
        expect(replay).toHaveLength(2);
        expect(replay.every((op) => op.batchId === undefined),
            'op individual não deixa lote no log').toBe(true);
    });

    it('6) conversão como lote: base errada no delete derruba o gesto e a feição nova não fica criada', async () => {
        const mapId = await createMap(api, atlasId, { name: 'Mapa da conversão' });
        const origemId = generateUUID();
        await api.pushOperations(atlasId, [criarPonto(mapId, origemId)]);

        // A BASE QUE O AUTOR OBSERVOU, lida do servidor antes de o par mexer.
        const baseObservada = await confirmedFeature(api, atlasId, mapId, origemId);
        const versaoObservada = baseObservada.properties.confirmedVersion;

        // O PAR EDITA A ORIGEM. A partir daqui a base acima está velha, e é isso que faz o delete
        // da conversão ser recusado — não um número inventado, mas a corrida de verdade.
        const edicaoDoPar = createOperation('feature', 'update', origemId, mapId,
            { ...baseObservada, properties: { ...baseObservada.properties, nome: 'Editado pelo par' } },
            baseObservada);
        const resEdicao = await api.pushOperations(atlasId, [edicaoDoPar]);
        expect(resEdicao.results[0].success, 'a edição do par precisa entrar').toBe(true);

        // PISO: sem esta asserção, o caso abaixo poderia estar recusando por outro motivo (uma
        // base que nunca ficou velha recusaria por "sem base confirmada", não por "alterado").
        const depoisDoPar = await confirmedFeature(api, atlasId, mapId, origemId);
        expect(depoisDoPar.properties.confirmedVersion).toBeGreaterThan(versaoObservada);

        const versaoAntes = await versaoDoAtlas();
        const destinoId = generateUUID();
        // A CONVERSÃO: create do id NOVO (sem `featureIntent`: id novo não reusa nada) e delete da
        // origem carregando a base VELHA. Um lote, dois membros, `batchIndex` 0 e 1.
        const ops = createBatchOperations([
            {
                entityType: 'feature',
                operationType: 'create',
                entityId: destinoId,
                mapId,
                data: pontoMinimo(destinoId, 5),
            },
            {
                entityType: 'feature',
                operationType: 'delete',
                entityId: origemId,
                mapId,
                data: null,
                previousData: baseObservada,
            },
        ]);
        afirmarLoteBemFormado(ops);
        expect(ops[0].featureIntent, 'id novo não declara intenção').toBeUndefined();
        expect(ops[1].baseVersion, 'o delete precisa declarar a base VELHA').toBe(versaoObservada);

        const res = await api.pushOperations(atlasId, ops);
        expect(res.results).toHaveLength(2);
        expect(res.results.map((r) => r.success)).toEqual([false, false]);
        expect(new Set(res.results.map((r) => r.reason)).size, 'um motivo só para o gesto').toBe(1);
        expect(res.results[0].reason).toMatch(/alterado após a versão que você pretende excluir/);
        expect(new Set(res.results.map((r) => r.batchId))).toEqual(new Set([ops[0].batchId]));
        expect(new Set(res.results.map((r) => r.batchFailedOperationId))).toEqual(new Set([ops[1].id]));

        // A ASSIMETRIA DECLARADA, e é o único ponto do arquivo em que ela aparece: o envelope de
        // `conflict` descreve UMA entidade (a revisão que o autor não viu), então ele fica só na
        // op que o produziu. Carimbá-lo na irmã mandaria o cliente resolver o conflito da entidade
        // errada. Por isso o `status` das duas DIVERGE, embora o motivo seja o mesmo.
        expect(res.results[1].status).toBe('conflict');
        expect(res.results[1].conflict).toBeTruthy();
        expect(res.results[1].conflict.entityVersion).toBe(depoisDoPar.properties.confirmedVersion);
        expect(res.results[0].status).toBe('rejected');
        expect(res.results[0].conflict).toBeUndefined();

        // A PERDA QUE ESTE CASO EXISTE PARA IMPEDIR: com savepoint por op, o create passava e o
        // delete caía, deixando as DUAS feições no mapa — duplicação silenciosa de dado.
        const mapa = await mapaDoSnapshot(mapId);
        const ids = idsDeFeicao(mapa);
        expect(ids, 'a feição nova não pode sobreviver ao gesto recusado').not.toContain(destinoId);
        expect(ids, 'e a origem continua onde estava').toContain(origemId);
        expect(await replayDesde(versaoAntes)).toEqual([]);
        expect(await versaoDoAtlas()).toBe(versaoAntes);
    });

    it.each(POSICOES_DA_CULPADA)(
        `7) falha no membro $rotulo de um gesto de ${MEMBROS_DO_GESTO}: nada aplica, e nenhum ack volta success`,
        async ({ rotulo, indice }) => {
            const mapId = await createMap(api, atlasId, { name: `Mapa da falha no ${rotulo}` });

            // O GRUPO NASCE FORA DO GESTO, e é isso que faz dos cinco membros ops IGUAIS entre si:
            // com o grupo dentro do lote (como no caso 1) a posição 0 seria uma op de outro tipo, e
            // a comparação entre as três posições mediria duas coisas ao mesmo tempo.
            const reais = Array.from({ length: MEMBROS_DO_GESTO - 1 }, () => generateUUID());
            await api.pushOperations(atlasId, reais.map((id, i) => criarPonto(mapId, id, i)));
            const groupId = generateUUID();
            await api.pushOperations(atlasId, [createOperation('group', 'create', groupId, mapId, {
                name: `Grupo do ${rotulo}`, visible: true, locked: false, features: [],
            })]);

            const versaoAntes = await versaoDoAtlas();
            const fantasma = generateUUID();   // nunca existiu: é a culpada
            const membros = [...reais];
            membros.splice(indice, 0, fantasma);
            expect(membros[indice], 'a culpada precisa cair na posição pedida').toBe(fantasma);

            const ops = createBatchOperations(membros.map((featureId) => ({
                entityType: 'group_feature',
                operationType: 'create',
                entityId: generateUUID(),
                mapId,
                data: { group_id: groupId, feature_id: featureId, feature_type: 'point' },
            })));
            afirmarLoteBemFormado(ops);
            expect(ops).toHaveLength(MEMBROS_DO_GESTO);

            const res = await api.pushOperations(atlasId, ops);
            expect(res.results).toHaveLength(MEMBROS_DO_GESTO);

            // NENHUMA APLICAÇÃO PARCIAL ACKED COMO SUCESSO. Escrito como filtro e não como
            // `every(false)` para que a mensagem de falha nomeie quantas passaram.
            expect(res.results.filter((r) => r.success === true), 'nem um membro pode voltar aplicado')
                .toHaveLength(0);
            expect(res.results.every((r) => r.rejected === true)).toBe(true);

            const motivos = new Set(res.results.map((r) => r.reason));
            expect(motivos.size, `motivos vieram: ${[...motivos].join(' | ')}`).toBe(1);
            expect([...motivos][0]).toMatch(/referencia um item que não existe mais/);
            expect(new Set(res.results.map((r) => r.batchId))).toEqual(new Set([ops[0].batchId]));
            expect(new Set(res.results.map((r) => r.batchFailedOperationId)),
                'a culpada é nomeada para todas, e é a da posição injetada')
                .toEqual(new Set([ops[indice].id]));

            // O EFEITO: o grupo continua VAZIO. Com savepoint por op, os membros ANTERIORES à
            // culpada ficariam ligados, e é justamente isso que muda com a posição.
            const grupo = (await mapaDoSnapshot(mapId)).groups.find((g) => g.id === groupId);
            expect(grupo, 'o grupo foi criado fora do gesto e continua lá').toBeTruthy();
            expect(grupo.features ?? [], 'nenhum membro do gesto recusado pode ter entrado').toEqual([]);
            expect(await replayDesde(versaoAntes)).toEqual([]);
            expect(await versaoDoAtlas()).toBe(versaoAntes);

            // CONTROLE, dentro do próprio caso: os QUATRO membros válidos, sozinhos, entram. Sem
            // ele, um servidor que recusasse toda op de membresia passaria nos três casos acima e
            // o "nada aplicou" não distinguiria atomicidade de quebra geral.
            const soValidos = createBatchOperations(reais.map((featureId) => ({
                entityType: 'group_feature',
                operationType: 'create',
                entityId: generateUUID(),
                mapId,
                data: { group_id: groupId, feature_id: featureId, feature_type: 'point' },
            })));
            const resValidos = await api.pushOperations(atlasId, soValidos);
            expect(resValidos.results.every((r) => r.success === true),
                'o mesmo gesto sem a culpada aplica inteiro').toBe(true);
            const grupoDepois = (await mapaDoSnapshot(mapId)).groups.find((g) => g.id === groupId);
            expect(grupoDepois.features.map((f) => f.id).sort()).toEqual([...reais].sort());
        });
});
