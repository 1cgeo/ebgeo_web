// Path: tests/e2e/vista-salva-do-mapa.e2e.test.js

/**
 * @fileoverview E2E DE CONTRATO: a VISTA SALVA do mapa (câmera, mapa base e interruptor temporal)
 * chega ao servidor como UM lote de três operações do MESMO mapa, observando a MESMA revisão.
 *
 * POR QUE ESTE ARQUIVO EXISTE (decisão do dono, 2026-09-20). O mapa base e o interruptor temporal
 * viraram estado de vista da pessoa, e o que sobrou para compartilhar é o gesto "salvar posição",
 * que passou a gravar as três coisas sob um `batchId` só (`saveMapView`,
 * `src/js/store/map-view.operations.js`). A forma é nova para o servidor em UM ponto que nenhuma
 * suíte media: três ops SUB-TIPADAS do mesmo mapa, no mesmo lote, todas declarando como base a
 * revisão que o cliente leu ANTES do gesto. A primeira a ser aplicada sobe `maps.version`, e se a
 * disputa fosse por versão de LINHA as outras duas seriam recusadas por base velha, levando o
 * lote inteiro (o lote é atômico). Ela é por UNIDADE (`posicao`, `mapaBase`, `temporal`), então as
 * três cabem. É essa propriedade que o caso 1 mede, no servidor de verdade.
 *
 * O caso 2 prende a metade que torna o lote útil: ele é ATÔMICO. Uma base que o autor não enxerga
 * recusa a op de mapa base, e a câmera e o interruptor do MESMO gesto não podem entrar sozinhos,
 * senão a vista salva chega pela metade (a câmera de um gesto com a base de outro).
 *
 * As ops saem da FÁBRICA do cliente (`createBatchOperations`), nunca de um objeto escrito à mão,
 * pela razão que `lote-logico.e2e.test.js` dá por extenso: um envelope escrito aqui pararia de
 * medir o contrato no dia em que a fábrica mudasse.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
    E2E_SKIP,
} from './helpers/harness.js';
import { createBatchOperations } from '../../src/js/store/sync/operation-factory.js';

// Dois dos cinco mapas base semeados, diferentes entre si e do default (`carta-topografica`).
const BASE_SALVA = 'carta-ortoimagem';
const BASE_INEXISTENTE = 'base-que-ninguem-cadastrou';

describe.skipIf(E2E_SKIP)('e2e: a vista salva do mapa é um lote de três ops do mesmo mapa', () => {
    let api;
    let atlasId;
    let mapId;

    async function linhaDoMapa() {
        const res = await api.pullSync(atlasId, 0);
        expect(res.isSnapshot).toBe(true);
        const mapa = res.snapshot.maps.find((m) => m.id === mapId);
        expect(mapa, 'o mapa está no snapshot').toBeTruthy();
        return mapa;
    }

    /** O lote que `saveMapView` produz: três folhas, uma base observada só. */
    function loteDaVista({ baseLayer, ativo, revisao }) {
        const observado = { confirmedVersion: revisao };
        return createBatchOperations([
            {
                entityType: 'mapPosition', operationType: 'update', entityId: mapId, mapId,
                data: { center_lat: -15.78, center_long: -47.93, zoom: 9, bearing: 30, pitch: 45 },
                previousData: { ...observado },
            },
            {
                entityType: 'baseLayer', operationType: 'update', entityId: mapId, mapId,
                data: { baseLayer },
                previousData: { baseLayer: 'carta-topografica', ...observado },
            },
            {
                entityType: 'mapTemporal', operationType: 'update', entityId: mapId, mapId,
                data: { ativo, unidade: 'DIA', inicio: null, fim: null, modo: 'absoluto', origem: null },
                previousData: { ativo: !ativo, ...observado },
            },
        ]);
    }

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Vista Salva Owner' });
        const atlas = await createAtlas(api, { name: 'Atlas da Vista Salva' });
        atlasId = atlas.id;
        mapId = await createMap(api, atlasId, { name: 'Mapa da Vista' });
    }, 30000);

    afterAll(async () => {
        try {
            await api.logout();
        } catch {
            /* best-effort cleanup */
        }
    });

    it('1) as três ops observam a MESMA revisão e entram juntas: a disputa é por unidade', async () => {
        const antes = await linhaDoMapa();
        const revisao = Number(antes.version);
        expect(Number.isSafeInteger(revisao), 'o servidor devolve a revisão do mapa').toBe(true);

        const ops = loteDaVista({ baseLayer: BASE_SALVA, ativo: true, revisao });
        // PISO DO PRÓPRIO TESTE: sem isto o caso mediria três ops individuais e chamaria de lote.
        expect(new Set(ops.map((op) => op.batchId)).size).toBe(1);
        expect(ops.map((op) => op.batchIndex)).toEqual([0, 1, 2]);
        expect(ops.map((op) => op.baseVersion), 'as três declaram a MESMA base').toEqual([revisao, revisao, revisao]);

        const res = await api.pushOperations(atlasId, ops);
        const recusadas = (res.results ?? []).filter((r) => r.rejected || r.success === false || r.conflict);
        expect(recusadas, 'nenhuma das três pode disputar com as irmãs do mesmo gesto').toEqual([]);

        const depois = await linhaDoMapa();
        expect(Number(depois.center_lat)).toBeCloseTo(-15.78, 4);
        expect(Number(depois.zoom)).toBe(9);
        expect(depois.base_layer).toBe(BASE_SALVA);
        expect(depois.temporal_config).toMatchObject({ ativo: true, unidade: 'DIA' });
    });

    it('2) o lote é ATÔMICO: base que o autor não enxerga derruba a câmera e o interruptor juntos', async () => {
        const antes = await linhaDoMapa();
        const revisao = Number(antes.version);

        const ops = loteDaVista({ baseLayer: BASE_INEXISTENTE, ativo: false, revisao });
        ops[0].data = { center_lat: 10, center_long: 20, zoom: 3, bearing: 0, pitch: 0 };

        const res = await api.pushOperations(atlasId, ops);
        const resultados = res.results ?? [];
        expect(resultados).toHaveLength(3);
        // O status volta igual para as três, e a culpada é nomeada para todas.
        expect(resultados.every((r) => r.rejected === true || r.success === false)).toBe(true);
        expect(new Set(resultados.map((r) => r.batchFailedOperationId))).toEqual(new Set([ops[1].id]));

        // E NADA entrou: a vista do caso 1 continua inteira. Meia vista seria a câmera deste gesto
        // com a base do anterior, que é exatamente o que o lote existe para impedir.
        const depois = await linhaDoMapa();
        expect(Number(depois.center_lat)).toBeCloseTo(-15.78, 4);
        expect(Number(depois.zoom)).toBe(9);
        expect(depois.base_layer).toBe(BASE_SALVA);
        expect(depois.temporal_config).toMatchObject({ ativo: true });
    });
});
