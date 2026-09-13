// Path: tests/e2e/limpar-posicao-preserva-mapa.e2e.test.js

/**
 * @fileoverview E2E de contrato: limpar a posição salva de um mapa NÃO pode excluir o mapa.
 *
 * ACHADO F1, medido em 2026-09-13. `clearMapPosition` emitia `mapPosition` DELETE, e no
 * servidor isso é um ato sobre o MAPA: a op de configuração de mapa carimba o id do MAPA como
 * `entityId` (`createMapSettingLogger`), `mapPosition` normaliza para o alvo `map`, e o caminho
 * de exclusão nunca leu o subtipo, caindo em `buildSoftDeleteQuery` para `maps`. O Dono recebia
 * `applied` e o mapa sumia do snapshot; o Editor recebia a recusa de "excluir um mapa", que
 * congelava a fila dele.
 *
 * ESTE ARQUIVO MEDE A FRONTEIRA, que é o que nenhum dos dois lados sozinho prova: o envelope
 * que o cliente REALMENTE emite hoje (montado pela fábrica de ops de verdade, não escrito à
 * mão) atravessa o HTTP até o backend real e volta no snapshot com o mapa vivo e as colunas de
 * posição vazias; e o envelope ANTIGO, o DELETE de subtipo, volta recusado por operação, com o
 * mapa intacto.
 *
 * Os dois casos são necessários: o primeiro prova que a forma nova FUNCIONA (senão o conserto
 * teria trocado uma perda por uma limpeza que não limpa), o segundo prova que a forma velha,
 * que ainda pode chegar de um cliente com build anterior, é RECUSADA e não aplicada.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
    E2E_SKIP,
} from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { clearedPositionPayload } from '../../src/js/store/map-position-clear.js';

/**
 * Pulls a fresh snapshot and returns the map row for `mapId`, asserting it is still there.
 * @param {import('../../src/js/store/sync/api-client.js').ApiClient} api
 * @param {string} atlasId
 * @param {string} mapId
 * @returns {Promise<Object>} The snapshot map row (DB-shaped: center_lat, zoom, ...).
 */
async function pullMapVivo(api, atlasId, mapId) {
    const res = await api.pullSync(atlasId, 0);
    expect(res.isSnapshot).toBe(true);
    const map = res.snapshot.maps.find((m) => m.id === mapId);
    expect(map, `o mapa ${mapId} precisa continuar no snapshot`).toBeTruthy();
    return map;
}

describe.skipIf(E2E_SKIP)('e2e: limpar posição preserva o mapa no servidor', () => {
    let api;
    let atlasId;

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Dono da Posição' });
        const atlas = await createAtlas(api, { name: 'Atlas de posição' });
        atlasId = atlas.id;
        expect(atlasId).toBeTruthy();
    }, 30000);

    it('salvar e depois limpar deixa o mapa vivo com as colunas de posição vazias', async () => {
        const mapId = await createMap(api, atlasId, { name: 'Mapa com posição' });

        const salvar = createOperation('mapPosition', 'update', mapId, mapId, {
            center_lat: -22.9068, center_long: -43.1729, zoom: 12, bearing: 30, pitch: 45,
        });
        const resSalvar = await api.pushOperations(atlasId, [salvar]);
        expect(resSalvar.results[0].rejected).toBeUndefined();

        // Piso: sem esta asserção o caso seguinte poderia estar limpando o que já era vazio.
        const comPosicao = await pullMapVivo(api, atlasId, mapId);
        expect(Number(comPosicao.center_lat)).toBeCloseTo(-22.9068, 4);
        expect(Number(comPosicao.zoom)).toBe(12);
        expect(Number(comPosicao.bearing)).toBe(30);

        // A LIMPEZA, no envelope exato que `clearMapPosition` emite: UPDATE com os cinco
        // campos nulos, vindos do mesmo folha que o cliente usa.
        const limpar = createOperation('mapPosition', 'update', mapId, mapId, clearedPositionPayload());
        const resLimpar = await api.pushOperations(atlasId, [limpar]);
        expect(resLimpar.results[0].rejected).toBeUndefined();
        expect(resLimpar.results[0].success).toBe(true);

        const limpo = await pullMapVivo(api, atlasId, mapId);
        expect(limpo.center_lat).toBeNull();
        expect(limpo.center_long).toBeNull();
        expect(limpo.zoom).toBeNull();
        // `bearing` e `pitch` são NOT NULL DEFAULT 0 no schema: o estado limpo delas é o zero,
        // traduzido por `normalizeMapChanges`. Um null ali violaria 23502 e a op inteira
        // voltaria recusada por integridade, com o servidor parado na posição antiga.
        expect(Number(limpo.bearing)).toBe(0);
        expect(Number(limpo.pitch)).toBe(0);
    });

    it('o DELETE antigo de mapPosition é recusado por operação e o mapa continua vivo', async () => {
        const mapId = await createMap(api, atlasId, { name: 'Mapa que não pode sumir' });

        // O envelope que o cliente emitia até 2026-09-13, e que um cliente com build anterior
        // ainda pode empurrar: `entityId` é o id do MAPA e `data` é nulo.
        const deleteAntigo = createOperation('mapPosition', 'delete', mapId, mapId, null, {
            id: mapId, center_lat: -22.9, center_long: -43.2, zoom: 10,
        });
        const res = await api.pushOperations(atlasId, [deleteAntigo]);

        expect(res.results).toHaveLength(1);
        expect(res.results[0].rejected).toBe(true);
        expect(res.results[0].reason).toMatch(/posição salva/);
        expect(res.results[0].reason).toMatch(/atualização, não uma exclusão/);

        // A PERDA QUE ESTE CASO EXISTE PARA IMPEDIR: o mapa continua no snapshot.
        const vivo = await pullMapVivo(api, atlasId, mapId);
        expect(vivo.id).toBe(mapId);
    });

    it('a recusa não envenena o lote: a op vizinha ainda se aplica', async () => {
        // Mesma propriedade que a recusa de exclusão de mapa já tinha, e a razão de a recusa
        // nova ser por OPERAÇÃO e não 403 de lote: um não-2xx não é desenfileirado pelo
        // cliente e volta a cada 1,5 s para sempre.
        const mapId = await createMap(api, atlasId, { name: 'Mapa do lote misto' });

        const deleteAntigo = createOperation('mapPosition', 'delete', mapId, mapId, null);
        const renomear = createOperation('map', 'update', mapId, null, { name: 'Renomeado no lote' });

        const res = await api.pushOperations(atlasId, [deleteAntigo, renomear]);
        expect(res.results).toHaveLength(2);
        expect(res.results[0].rejected).toBe(true);
        expect(res.results[1].rejected).toBeUndefined();
        expect(res.results[1].success).toBe(true);

        const vivo = await pullMapVivo(api, atlasId, mapId);
        expect(vivo.name).toBe('Renomeado no lote');
    });
});
