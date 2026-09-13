// Path: tests/e2e/marcador-estrutural.e2e.test.js

/**
 * @fileoverview O PAR QUE ESTAVA OFFLINE RECEBE O ATO PELO NOME DELE (bloco B6, decisão D6).
 *
 * ================= O CONTRATO QUE ESTE ARQUIVO MEDE ==========================================
 *
 * Merge, duplicação de mapa, clone e importação de atlas são as quatro escritas de entidade
 * INTEIRA que não passam pelo protocolo incremental. Cada uma grava um MARCADOR em `operations`
 * na mesma transação do ato (`recordStructuralMarker`), e é por esse marcador que a versão do
 * atlas anda e que o par ausente descobre que precisa de um snapshot.
 *
 * Até 2026-09-13 as quatro viajavam no fio como `map_merge`: o cliente conhecia UMA palavra, e um
 * tipo desconhecido é ignorado em silêncio pelo roteador de entrada (avisa uma vez, avança o
 * cursor, segue), o que reintroduziria metade do defeito. A decisão D6 derrubou a restrição (a
 * linha `integracao_backend` nunca foi implantada; a primeira implantação é instalação nova, logo
 * não há cliente anterior em campo), e cada ato passou a viajar pelo nome dele.
 *
 * ================= POR QUE SÓ ESTA CAMADA PODE DIZER ISSO ====================================
 *
 * A prova hermética do servidor (`backend/tests/integration/excecoes-rest-marcador.repro.test.js`)
 * lê a COLUNA, e o espelho de vocabulário (`tests/unit/marcador-estrutural-espelha-backend.test.js`)
 * compara duas listas em memória. Nenhum dos dois atravessa o fio. Aqui o ato é feito pela rota
 * REST real, o marcador volta pela porta pública de leitura do log, e o nome que chega é
 * confrontado com o CONJUNTO QUE O CLIENTE DE VERDADE consulta (`STRUCTURAL_RESYNC_OPS`, importado
 * do módulo folha que o `sync-engine.js` usa) — não com uma cópia escrita aqui, que envelheceria
 * junto com o defeito que ela deveria pegar.
 *
 * ================= AS DUAS PORTAS DE LEITURA, E POR QUE SÃO DUAS =============================
 *
 * Duplicação e merge acontecem DENTRO de um atlas que já tem histórico: o par pede o replay a
 * partir da versão que tinha e recebe o marcador por HTTP, que é literalmente o caminho do par
 * que estava offline.
 *
 * Clone e importação CRIAM o atlas, e o marcador deles é a primeira linha do log. Um pull HTTP
 * pede da versão 0 e a versão 0 pela porta HTTP significa "não tenho nada, me mande o snapshot":
 * o marcador é real e simplesmente não aparece nessa leitura. Quem sabe dizer a outra metade
 * ("estou em dia na versão 0, me mande a cauda") é o `sync_request` do socket, com
 * `haveSnapshot: true`, e é por isso que estes dois casos abrem WebSocket. Sem essa distinção o
 * arquivo mediria o snapshot e chamaria isso de replay.
 *
 * ================= O QUE ELE NÃO PROVA, DECLARADO ============================================
 *
 * Que o cliente TOMA o snapshot ao ver um dos quatro nomes é do outro lado da fronteira e está em
 * `tests/integration/sync-engine.test.js` (os quatro nomes, mais o controle negativo). Aqui prova-
 * se que o nome que o servidor publica é um dos que aquele conjunto reconhece.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
    makeWs,
    newClientId,
    waitFor,
    E2E_SKIP,
} from './helpers/harness.js';
import { STRUCTURAL_RESYNC_OPS } from '../../src/js/store/sync/structural-markers.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';

describe.skipIf(E2E_SKIP)('e2e: o marcador estrutural viaja com o nome do ato', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let api;
    let atlasId;
    /** @type {import('../../src/js/store/sync/ws-client.js').WsClient[]} */
    const sockets = [];

    /** Um ponto mínimo: o servidor deriva o tipo de `properties.source`. */
    const pontoMinimo = (featureId, i = 0) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-43.2 + i * 0.001, -22.9 + i * 0.001] },
        properties: { source: 'point', id: featureId },
    });

    /** Semeia uma feição no mapa e devolve a versão do atlas depois dela. */
    async function semearFeicao(mapId, i = 0) {
        const featureId = generateUUID();
        const res = await api.pushOperations(atlasId, [
            createOperation('feature', 'create', featureId, mapId, pontoMinimo(featureId, i)),
        ]);
        expect(res.results[0].success, 'a semente precisa entrar, senão não há histórico').toBe(true);
        return { featureId, versao: (await api.pullSync(atlasId, 0)).currentVersion };
    }

    /**
     * O REPLAY INCREMENTAL por HTTP: é o que o par offline pede ao voltar.
     * @param {string} alvo - Atlas a ler.
     * @param {number} desde - Versão exclusiva.
     */
    async function replayDesde(alvo, desde) {
        expect(desde, 'a versão 0 por HTTP devolve snapshot, não replay').toBeGreaterThan(0);
        const res = await api.pullSync(alvo, desde);
        expect(res.isSnapshot, 'o par precisa do ramo incremental para ver o marcador').toBe(false);
        return res.operations;
    }

    /**
     * O REPLAY pelo SOCKET a partir da versão 0 declarando estado completo. É a única leitura que
     * alcança a primeira linha do log de um atlas recém-criado.
     * @param {string} alvo - Atlas a ler.
     * @returns {Promise<Object[]>}
     */
    async function replayDoSocketDesdeZero(alvo) {
        const ws = makeWs(api, { clientId: newClientId() });
        sockets.push(ws);
        /** @type {Object[]} */
        const respostas = [];
        ws.on('syncResponse', (msg) => respostas.push(msg));
        const connected = await ws.connect(alvo, { lastVersion: 0, haveSnapshot: true });
        expect(connected.type).toBe('connected');

        ws.requestSync(0, { haveSnapshot: true });
        const resposta = await waitFor(() => respostas.find((m) => m && m.isSnapshot === false),
            { timeout: 6000 });
        expect(resposta.isSnapshot,
            'com estado completo declarado, a versão 0 é uma versão comum e a resposta é a cauda')
            .toBe(false);
        return resposta.ops ?? [];
    }

    /**
     * O PISO DE TODO CASO: o marcador é o que o cliente reconhece pelo nome que chegou.
     *
     * O PAYLOAD NÃO ENTRA AQUI, e a razão é uma assimetria real: os três marcadores escritos por
     * `recordStructuralMarker` carregam `data.kind`, e o do MERGE não, porque ele é o único que
     * ainda faz o próprio INSERT (`maps.service.js`, com a sentinela `server-merge` que os testes
     * daquele módulo prendem). Assumir `kind` no piso comum faria o caso do merge falhar por uma
     * propriedade que ninguém prometeu; cada caso afirma o payload que o SEU ato escreve.
     * @param {Object} marcador - A op lida do replay.
     * @param {string} nome - O nome esperado.
     */
    function afirmarMarcador(marcador, nome) {
        expect(marcador, `nenhum marcador ${nome} no replay`).toBeTruthy();
        expect(marcador.entityType, 'o tipo publicado é o nome do ato').toBe(nome);
        expect(STRUCTURAL_RESYNC_OPS.has(marcador.entityType),
            `o cliente precisa reconhecer "${marcador.entityType}" como "tire um snapshot"`).toBe(true);
    }

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Dono do Marcador' });
        const atlas = await createAtlas(api, { name: 'Atlas dos marcadores' });
        atlasId = atlas.id;
        expect(atlasId).toBeTruthy();
    }, 40000);

    afterAll(() => {
        for (const ws of sockets) ws.disconnect();
    });

    it('duplicar um mapa: o par recebe `map_duplicate`, e não a palavra do merge', async () => {
        const mapId = await createMap(api, atlasId, { name: 'Mapa a duplicar' });
        const { versao } = await semearFeicao(mapId);

        const novoMapa = await api._request('POST', `/atlas/${atlasId}/maps/${mapId}/duplicate`);
        expect(novoMapa.id).toBeTruthy();

        const ops = await replayDesde(atlasId, versao);
        expect(ops, 'o ato inteiro é UMA linha no log: o marcador').toHaveLength(1);
        afirmarMarcador(ops[0], 'map_duplicate');

        // O QUE A TROCA DE NOME NÃO PODE TER CUSTADO: o payload que nomeia as camadas criadas
        // fora do log, que é a metade muda do buraco original.
        expect(ops[0].data.kind).toBe('map_duplicate');
        expect(ops[0].data.mapId).toBe(novoMapa.id);
        expect(ops[0].data.sourceMapId).toBe(mapId);
        expect(Array.isArray(ops[0].data.layers) && ops[0].data.layers.length >= 1,
            'as camadas que `ensureMapLayers` cria fora do log continuam nomeadas').toBe(true);
    });

    it('mesclar mapas: o par recebe `map_merge`, que continua sendo o nome DESTE ato', async () => {
        // O CONTROLE DA TROCA. Sem ele, publicar sempre o nome honesto e publicar sempre
        // `map_merge` seriam indistinguíveis para o caso acima se o merge tivesse sumido.
        const destino = await createMap(api, atlasId, { name: 'Destino do merge' });
        const origem = await createMap(api, atlasId, { name: 'Origem do merge' });
        await semearFeicao(destino, 1);
        const { versao } = await semearFeicao(origem, 2);

        await api._request('POST', `/atlas/${atlasId}/maps/${destino}/merge`,
            { body: { sourceMapIds: [origem] } });

        const ops = await replayDesde(atlasId, versao);
        expect(ops).toHaveLength(1);
        afirmarMarcador(ops[0], 'map_merge');
        expect(ops[0].data.destMapId).toBe(destino);
    });

    it('clonar um atlas: o atlas novo nasce com `atlas_clone` na primeira linha do log', async () => {
        const mapId = await createMap(api, atlasId, { name: 'Mapa a clonar' });
        await semearFeicao(mapId, 3);

        const clone = await api.cloneAtlas(atlasId, { name: 'Clone do atlas dos marcadores' });
        expect(clone.id).toBeTruthy();

        // O ATLAS NÃO NASCE NA VERSÃO ZERO: é para isso que o marcador do clone existe, já que
        // não há par nenhum dentro dele no instante em que ele nasce.
        const nascimento = await api.pullSync(clone.id, 0);
        expect(nascimento.isSnapshot).toBe(true);
        expect(nascimento.currentVersion).toBeGreaterThan(0);

        const ops = await replayDoSocketDesdeZero(clone.id);
        const marcador = ops.find((op) => op.entityType === 'atlas_clone');
        afirmarMarcador(marcador, 'atlas_clone');
        expect(marcador.data.kind).toBe('atlas_clone');
        expect(marcador.data.sourceAtlasId).toBe(atlasId);
        expect(marcador.data.maps, 'contagens, nunca ids nem nomes').toBeGreaterThan(0);
    });

    it('importar um atlas: o atlas do arquivo nasce com `atlas_import`', async () => {
        const importado = await api.importAtlas({
            atlas: { name: 'Atlas importado do arquivo' },
            maps: [{ id: generateUUID(), name: 'Mapa do arquivo', features: [], layers: [], groups: [] }],
        });
        expect(importado.id).toBeTruthy();

        const ops = await replayDoSocketDesdeZero(importado.id);
        const marcador = ops.find((op) => op.entityType === 'atlas_import');
        afirmarMarcador(marcador, 'atlas_import');
        expect(marcador.data.kind).toBe('atlas_import');
        expect(marcador.data.maps).toBe(1);
    });

    it('CONTROLE NEGATIVO: uma op comum não vira marcador, e o par não resincroniza por ela', async () => {
        // Sem este caso, um servidor que carimbasse `map_duplicate` em TUDO passaria nos quatro
        // acima, e o cliente tomaria um snapshot a cada feição criada por um colega.
        const mapId = await createMap(api, atlasId, { name: 'Mapa da op comum' });
        const { versao } = await semearFeicao(mapId, 4);
        const { featureId } = await semearFeicao(mapId, 5);

        const ops = await replayDesde(atlasId, versao);
        expect(ops).toHaveLength(1);
        expect(ops[0].entityType).toBe('feature');
        expect(ops[0].entityId).toBe(featureId);
        expect(STRUCTURAL_RESYNC_OPS.has(ops[0].entityType)).toBe(false);
    });
});
