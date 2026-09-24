// Path: tests/e2e/atributos-por-chave.e2e.test.js

/**
 * @fileoverview OS ATRIBUTOS PERSONALIZADOS CONVERGEM POR CHAVE (decisão do dono em 2026-09-24).
 *
 * O DEFEITO. `properties.attributes` viajava como UMA unidade de disputa: o patch de feição
 * (`featureMutationContract`, `frontend/src/js/store/sync/feature-patch.js`) mandava o objeto
 * inteiro em `['properties','attributes']`, e a fronteira do servidor (`prepareFeatureMutation`,
 * `backend/src/modules/sync/feature-conflicts.js`) julgava a unidade inteira. Dois usuários partindo
 * da mesma revisão, um excluindo o atributo "x" e o outro mudando "y", disputavam a mesma unidade: o
 * segundo a chegar era RECUSADO como conflito, e a mudança dele ficava parada na fila; "Reaplicar"
 * levava o objeto inteiro de volta e ressuscitava "x".
 *
 * O QUE ESTE ARQUIVO PRENDE, contra o backend real e com as ops montadas pela MESMA fábrica do app
 * (`createOperation`, que calcula o patch pela diferença entre o que a pessoa viu e o que gravou):
 *
 * 1. exclusão de "x" contra mudança de "y": as duas aceitas, e o servidor guarda `{ y: novo }`;
 * 2. mudança de "x" contra mudança de "y": as duas aceitas, e o servidor guarda as duas;
 * 3. a MESMA chave pelos dois lados continua CONFLITO, como `nome`, `descricao` e qualquer outra
 *    propriedade: a regra da casa não vira LWW;
 * 4. o formato ANTIGO (o objeto inteiro em `['properties','attributes']`) continua aceito e aplicado
 *    como antes, porque há filas persistidas de clientes que vão atualizar com ops pendentes; e ele é
 *    recusado quando uma escrita por chave aconteceu depois da base dele, porque substituir o objeto
 *    apagaria essa escrita sem ninguém saber;
 * 5. a op por chave carrega SÓ as chaves mudadas, com a exclusão explícita;
 * 6. a feição que chega por IMPORTAÇÃO de atlas (o `.ebgeo` enviado ao servidor por
 *    `POST /atlas/import`, que não passa pelo sync e não deixa fronteira) converge por chave também.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    confirmedFeature,
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
    newClientId,
    E2E_SKIP,
} from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';
import { generateUUID } from '../../src/js/utilities/uuid.js';
import { buildServerImportPayload } from '../../src/js/import_export/local-atlas-to-server.js';

describe.skipIf(E2E_SKIP)('e2e: atributos personalizados convergem por chave', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let api;
    let atlasId;
    let mapId;
    const clienteA = newClientId();
    const clienteB = newClientId();

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Atributos por chave' });
        atlasId = (await createAtlas(api, { name: 'Atlas de atributos' })).id;
        mapId = await createMap(api, atlasId, { name: 'Mapa de atributos' });
    }, 20000);

    afterAll(async () => {
        try { await api.logout(); } catch { /* best-effort */ }
    });

    /** Cria um ponto com os atributos dados e devolve a feição confirmada pelo servidor. */
    async function pontoCom(atributos) {
        const id = generateUUID();
        const res = await api.pushOperations(atlasId, [createOperation('feature', 'create', id, mapId, {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
            properties: { id, source: 'point', nome: 'Posto', attributes: atributos },
        })]);
        expect(res.results[0].success, res.results[0].reason).toBe(true);
        return confirmedFeature(api, atlasId, mapId, id);
    }

    /** A op de UPDATE que a pessoa produziria: o que ela viu (`anterior`) e os atributos que gravou. */
    function edicao(anterior, atributos, clientId) {
        const depois = structuredClone(anterior);
        depois.properties.attributes = atributos;
        return { ...createOperation('feature', 'update', anterior.properties.id, mapId, depois, anterior), clientId };
    }

    async function atributosNoServidor(id) {
        return (await confirmedFeature(api, atlasId, mapId, id)).properties.attributes;
    }

    it('exclusão de "x" contra mudança de "y": as duas ficam', async () => {
        const base = await pontoCom({ x: 'um', y: 'um' });
        const opA = edicao(base, { y: 'um' }, clienteA);
        const opB = edicao(base, { x: 'um', y: 'dois' }, clienteB);

        const resA = await api.pushOperations(atlasId, [opA]);
        expect(resA.results[0].success, resA.results[0].reason).toBe(true);
        const resB = await api.pushOperations(atlasId, [opB]);
        expect(resB.results[0].success, `a segunda edição foi recusada: ${resB.results[0].reason}`).toBe(true);

        expect(await atributosNoServidor(base.properties.id)).toEqual({ y: 'dois' });
    });

    it('mudança de "x" contra mudança de "y": as duas ficam', async () => {
        const base = await pontoCom({ x: 'um', y: 'um' });
        const opA = edicao(base, { x: 'A', y: 'um' }, clienteA);
        const opB = edicao(base, { x: 'um', y: 'B' }, clienteB);

        expect((await api.pushOperations(atlasId, [opA])).results[0].success).toBe(true);
        const resB = await api.pushOperations(atlasId, [opB]);
        expect(resB.results[0].success, `a segunda edição foi recusada: ${resB.results[0].reason}`).toBe(true);

        expect(await atributosNoServidor(base.properties.id)).toEqual({ x: 'A', y: 'B' });
    });

    it('a op por chave leva só as chaves mudadas, e a exclusão é explícita', async () => {
        const base = await pontoCom({ x: 'um', y: 'um', z: 'um' });
        const op = edicao(base, { y: 'dois', z: 'um', w: 'novo' }, clienteA);
        const caminhos = op.patch.map((entrada) => `${entrada.op}:${entrada.path.join('.')}`).sort();
        expect(caminhos).toEqual([
            'remove:properties.attributes.x',
            'set:properties.attributes.w',
            'set:properties.attributes.y',
        ]);
        expect((await api.pushOperations(atlasId, [op])).results[0].success).toBe(true);
        expect(await atributosNoServidor(base.properties.id)).toEqual({ y: 'dois', z: 'um', w: 'novo' });
    });

    it('a MESMA chave pelos dois lados continua conflito, como qualquer outra propriedade', async () => {
        const base = await pontoCom({ x: 'um', y: 'um' });
        const opA = edicao(base, { x: 'um', y: 'A' }, clienteA);
        const opB = edicao(base, { x: 'um', y: 'B' }, clienteB);

        expect((await api.pushOperations(atlasId, [opA])).results[0].success).toBe(true);
        const resB = await api.pushOperations(atlasId, [opB]);
        expect(resB.results[0].success).toBe(false);
        expect(resB.results[0].status).toBe('conflict');
        expect(resB.results[0].conflict.fields).toEqual([['properties', 'attributes', 'y']]);
        expect(await atributosNoServidor(base.properties.id)).toEqual({ x: 'um', y: 'A' });
    });

    it('o formato ANTIGO (objeto inteiro) continua aceito e aplicado como antes', async () => {
        const base = await pontoCom({ x: 'um', y: 'um' });
        const antiga = edicao(base, { y: 'um', novo: 'sim' }, clienteA);
        antiga.patch = [{ op: 'set', path: ['properties', 'attributes'], value: { y: 'um', novo: 'sim' } }];
        const res = await api.pushOperations(atlasId, [antiga]);
        expect(res.results[0].success, res.results[0].reason).toBe(true);
        // A substituição inteira de hoje: "x" sai porque o objeto novo não o tem.
        expect(await atributosNoServidor(base.properties.id)).toEqual({ y: 'um', novo: 'sim' });
    });

    it('o formato ANTIGO é recusado quando uma escrita por chave aconteceu depois da base dele', async () => {
        const base = await pontoCom({ x: 'um', y: 'um' });
        // Um cliente atualizado muda "x" por chave.
        expect((await api.pushOperations(atlasId, [edicao(base, { x: 'A', y: 'um' }, clienteA)])).results[0].success)
            .toBe(true);
        // Uma op antiga, gravada na fila antes da atualização, parte da MESMA base com o objeto inteiro.
        const antiga = edicao(base, { x: 'um', y: 'velho' }, clienteB);
        antiga.patch = [{ op: 'set', path: ['properties', 'attributes'], value: { x: 'um', y: 'velho' } }];
        const res = await api.pushOperations(atlasId, [antiga]);
        expect(res.results[0].success).toBe(false);
        expect(res.results[0].status).toBe('conflict');
        // A escrita por chave sobreviveu, em vez de ser apagada pelo objeto inteiro.
        expect(await atributosNoServidor(base.properties.id)).toEqual({ x: 'A', y: 'um' });
    });

    it('um nome de atributo perigoso por chave é recusado, sem tocar no protótipo', async () => {
        const base = await pontoCom({ x: 'um' });
        const op = edicao(base, { x: 'um' }, clienteA);
        op.patch = [{ op: 'set', path: ['properties', 'attributes', '__proto__'], value: 'mal' }];
        const res = await api.pushOperations(atlasId, [op]);
        expect(res.results[0].success).toBe(false);
        expect(await atributosNoServidor(base.properties.id)).toEqual({ x: 'um' });
    });

    it('um atributo chamado "constructor" é uma chave como as outras, e a feição continua por chave', async () => {
        const base = await pontoCom({ constructor: 'c', y: 'um' });
        const opA = edicao(base, { constructor: 'c', y: 'dois' }, clienteA);
        expect(opA.patch).toEqual([{ op: 'set', path: ['properties', 'attributes', 'y'], value: 'dois' }]);
        const opB = edicao(base, { constructor: 'novo', y: 'um' }, clienteB);
        expect((await api.pushOperations(atlasId, [opA])).results[0].success).toBe(true);
        const resB = await api.pushOperations(atlasId, [opB]);
        expect(resB.results[0].success, resB.results[0].reason).toBe(true);
        expect(await atributosNoServidor(base.properties.id)).toEqual({ constructor: 'novo', y: 'dois' });
    });

    it('a feição importada de um .ebgeo pelo servidor também converge por chave', async () => {
        const pontoId = generateUUID();
        const exportData = {
            maps: {
                'Mapa importado': {
                    baseLayer: 'osm', zoom: 8, center_lat: -22.9, center_long: -43.2, bearing: 0, pitch: 0,
                    analysisLayers: {}, catalogLayers: [],
                    features: {
                        points: [{
                            type: 'Feature', id: 1,
                            properties: { id: pontoId, source: 'point', layerId: 'default', nome: 'P1',
                                attributes: { x: 'um', y: 'um' } },
                            geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                        }],
                    },
                },
            },
            layers: { 'Mapa importado': [{ id: 'default', name: 'Padrão', order: 0, visible: true, locked: false, opacity: 1 }] },
            mapOrder: ['Mapa importado'],
        };
        const { payload } = buildServerImportPayload(exportData, { name: 'Atlas do arquivo' });
        const importado = await api.importAtlas(payload);
        const mapa = payload.maps[0].id;
        const { snapshot } = await api.pullSync(importado.id, 0);
        const base = Object.values(snapshot.maps.find((m) => m.id === mapa).features).flat()
            .find((f) => f?.properties?.id === pontoId);
        expect(base.properties.attributes).toEqual({ x: 'um', y: 'um' });

        const editar = (atributos, clientId) => {
            const depois = structuredClone(base);
            depois.properties.attributes = atributos;
            return { ...createOperation('feature', 'update', pontoId, mapa, depois, base), clientId };
        };
        expect((await api.pushOperations(importado.id, [editar({ y: 'um' }, clienteA)])).results[0].success).toBe(true);
        const resB = await api.pushOperations(importado.id, [editar({ x: 'um', y: 'dois' }, clienteB)]);
        expect(resB.results[0].success, resB.results[0].reason).toBe(true);
        const depois = Object.values((await api.pullSync(importado.id, 0)).snapshot.maps.find((m) => m.id === mapa).features)
            .flat().find((f) => f?.properties?.id === pontoId);
        expect(depois.properties.attributes).toEqual({ y: 'dois' });
    });
});
