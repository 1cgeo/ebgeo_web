// Path: tests/e2e/temporal-mapconfig.e2e.test.js

/**
 * @fileoverview E2E: a op `mapTemporal` persiste em `maps.temporal_config`, aparece no snapshot do
 * atlas e chega a um par de WS real. Todo o trafego passa pelo ApiClient / WsClient publicos mais
 * `createOperation`; nenhum acesso direto ao banco.
 *
 * ESTE ARQUIVO CONGELAVA COMO CONTRATO VALORES QUE NENHUM CLIENTE PRODUZ (S7 da auditoria do
 * sistema temporal, 2026-09-21): datas em TEXTO (`'2026-01-01'`), `modo: 'cumulativo'` e
 * `origem: 'manual'`. Ele era o unico guarda e2e da coluna, entao o que ele protegia era a ausencia
 * de checagem: o servidor gravava qualquer coisa, e o teste afirmava que ele devia. Consertar S6
 * o reprovaria, que e a forma mais pura de teste que nao prende.
 *
 * O CONTRATO REAL mora em `src/js/temporal/temporal.constants.js` e e o que este arquivo usa agora:
 * `ativo` booleano, `unidade` em {MINUTO, HORA, DIA, SEMANA}, `modo` em {absoluto, relativo},
 * `inicio`/`fim`/`origem` em epoch ms ou nulo. O espelho do servidor e
 * `backend/src/modules/sync/temporal-config.js`, comparado em processo por
 * `tests/unit/configuracao-temporal-espelha-cliente.test.js`.
 *
 * A SEGUNDA METADE, e e ela que a reescrita existe para prender: o campo invalido e SANEADO e a op
 * continua ACEITA. Uma recusa congelaria a fila de saida daquele cliente inteira.
 */

import { describe, it, expect, beforeAll } from 'vitest';
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
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { DEFAULT_TEMPORAL_CONFIG, TEMPORAL_MODES } from '../../src/js/temporal/temporal.constants.js';

/** Um instante real, em epoch ms, e uma janela de uma hora a partir dele. */
const INICIO = 1700000000000;
const FIM = INICIO + 3600000;

describe.skipIf(E2E_SKIP)('e2e: temporal map config', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let api;
    let atlasId;
    let mapId;

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Temporal Tester' });
        const atlas = await createAtlas(api, { name: 'Temporal Atlas' });
        atlasId = atlas.id;
        mapId = await createMap(api, atlasId, { name: 'Mapa Temporal' });
    });

    /** Pulls a fresh snapshot and returns the target map row. */
    async function pullMap() {
        const r = await api.pullSync(atlasId, 0);
        expect(r.isSnapshot).toBe(true);
        const map = r.snapshot.maps.find((m) => m.id === mapId);
        expect(map, 'created map present in snapshot').toBeTruthy();
        return map;
    }

    /** Empurra UMA op `mapTemporal` e devolve a resposta do push. */
    async function pushTemporal(payload) {
        const op = createOperation('mapTemporal', 'update', mapId, mapId, payload);
        return api.pushOperations(atlasId, [op]);
    }

    it('starts with no meaningful temporal config', async () => {
        const map = await pullMap();
        // A freshly created map has either null or an empty temporal_config object.
        const cfg = map.temporal_config;
        expect(cfg == null || Object.keys(cfg).length === 0).toBe(true);
    });

    it('persiste a configuracao que o cliente de fato escreve, campo a campo', async () => {
        // Este e o documento que `writeMapTemporalConfig` monta: os seis campos, sempre presentes,
        // com `unidade` vinda de TEMPORAL_UNIT_KEYS e `modo` de TEMPORAL_MODES.
        const payload = {
            ativo: true,
            unidade: 'DIA',
            inicio: INICIO,
            fim: FIM,
            modo: TEMPORAL_MODES.RELATIVO,
            origem: INICIO,
        };
        const res = await pushTemporal(payload);
        expect(res.serverVersion).toBeGreaterThan(0);

        const cfg = (await pullMap()).temporal_config;
        expect(cfg).toEqual(payload);
    });

    it('a op com valor invalido e ACEITA, e o valor e saneado campo a campo', async () => {
        // Os quatro valores abaixo sao exatamente os que este arquivo congelava como contrato:
        // unidade em caixa baixa, datas em texto, um modo que nao existe e uma origem textual.
        const res = await pushTemporal({
            ativo: 'sim',
            unidade: 'dia',
            inicio: '2026-01-01',
            fim: '2026-12-31',
            modo: 'cumulativo',
            origem: 'manual',
        });
        // A INVARIANTE QUE NAO PODE SUMIR NUMA REESCRITA: descarta, nunca recusa. Um 4xx aqui
        // pararia a fila de saida inteira do cliente.
        expect(res.results.every((r) => r.success === true)).toBe(true);

        const cfg = (await pullMap()).temporal_config;
        expect(cfg).toEqual({
            ativo: false,
            unidade: DEFAULT_TEMPORAL_CONFIG.unidade,
            inicio: null,
            fim: null,
            modo: DEFAULT_TEMPORAL_CONFIG.modo,
            origem: null,
        });
    });

    it('janela invertida descarta o FIM e guarda o inicio', async () => {
        // Uma das duas pontas tem de cair. `fim: null` e o limite automatico derivado das feicoes,
        // a leitura mais larga, que nunca esconde feicao; o par invertido produziria janela VAZIA.
        await pushTemporal({ ativo: true, unidade: 'HORA', inicio: FIM, fim: INICIO, modo: 'absoluto', origem: null });

        const cfg = (await pullMap()).temporal_config;
        expect(cfg.inicio).toBe(FIM);
        expect(cfg.fim).toBe(null);
    });

    it('ignores keys outside the temporal whitelist (negative)', async () => {
        await pushTemporal({
            ativo: false,
            // Not part of {ativo,unidade,inicio,fim,modo,origem}: must NOT be stored.
            bogus: 'should-not-persist',
            name: 'malicious-rename',
        });

        const map = await pullMap();
        const cfg = map.temporal_config;
        // The whitelisted field updated...
        expect(cfg.ativo).toBe(false);
        // ...while non-whitelisted keys never leaked into temporal_config. The server
        // assembles temporal_config only from {ativo,unidade,inicio,fim,modo,origem}.
        expect(cfg).not.toHaveProperty('bogus');
        expect(cfg).not.toHaveProperty('name');

        // A sub-typed map update is now narrowed to its own column(s) server-side, so
        // a `name` smuggled alongside the temporal payload is DROPPED — it cannot
        // overwrite the map name (regression: see backend sync-map-subentity-isolation).
        expect(map.name).toBe('Mapa Temporal');
    });

    it('broadcasts the mapTemporal op to a connected WS peer, ALREADY saneado', async () => {
        const peerClientId = newClientId();
        const ws = makeWs(api, { clientId: peerClientId });
        const received = [];
        ws.on('operation', (incoming) => received.push(incoming));

        try {
            await ws.connect(atlasId, { lastVersion: 0 });

            // O par aplica `data` direto no proprio lado (`applyRemoteMapSettingOp`) e nao valida
            // nada, entao o que viaja no fio precisa ja estar limpo: sanear so a coluna deixaria
            // o colega com a unidade inventada ate o proximo F5.
            const payload = { ativo: true, unidade: 'banana', origem: 'ws-test' };
            // Push from a DIFFERENT clientId so the peer does not filter it out.
            const op = createOperation('mapTemporal', 'update', mapId, mapId, payload);
            op.clientId = newClientId();
            await api.pushOperations(atlasId, [op]);

            const broadcast = await waitFor(
                () => received.find((o) => o.entityType === 'mapTemporal') || false,
                { timeout: 4000 },
            );
            expect(broadcast.entityId).toBe(mapId);
            expect(broadcast.data).toMatchObject({
                ativo: true,
                unidade: DEFAULT_TEMPORAL_CONFIG.unidade,
                origem: null,
            });
        } finally {
            ws.disconnect();
        }
    });
});
