// Path: tests/e2e-ui/importar-mais-de-200-no-servidor.repro.spec.js

/**
 * B6.1 (owner decision, 2026-09-24): importar mais de 200 feicoes num atlas de SERVIDOR.
 *
 * O DEFEITO. `addFeatures` (o caminho do import de arquivo, de colar e da saida de processamento)
 * grava as N feicoes numa transacao so, e uma transacao era UM lote logico. O servidor aplica no
 * maximo `LOTE_MAX_OPS` (200) por lote, entao o flush recusava localmente o lote inteiro: as 450
 * feicoes ficavam so neste computador, cada uma virava pendencia, e o colega nunca as via.
 *
 * O QUE ESTE CASO MEDE, pelas tres pontas: o Postgres (a verdade do servidor), o IndexedDB do PAR
 * (a entrega) e o censo da fila do autor (nenhuma pendencia sobrando). Com a decisao B6.1 do dono (2026-09-24), as 450 partem
 * em lotes de 200, 200 e 50 (`createBatchOperations`).
 */

import { collabTest, expect } from './helpers/collab.fixtures.js';

const QUANTAS = 450;

collabTest.describe('Importar mais de 200 feicoes num atlas de servidor (B6.1)', () => {
    collabTest.describe.configure({ retries: 0 });

    collabTest(`${QUANTAS} pontos chegam inteiros ao Postgres e ao par, sem pendencia`, async ({ collab }) => {
        collabTest.setTimeout(300000);
        const A = collab.author;
        const B = collab.peers[0];

        const ids = await A.evaluate(async (n) => {
            const store = await import('/src/js/store/index.js');
            const pontos = Array.from({ length: n }, (_, i) => {
                const id = crypto.randomUUID();
                return {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [-43.2 + (i % 30) * 0.001, -22.9 + Math.floor(i / 30) * 0.001] },
                    properties: { id, source: 'point', nome: `Importado ${i}`, size: 6, color: '#ff5500', visivel: true },
                };
            });
            await store.addFeatures({ points: pontos });
            return pontos.map((p) => p.properties.id);
        }, QUANTAS);
        expect(ids).toHaveLength(QUANTAS);

        const noServidor = async () => Number((await collab.db.raw.one(
            'SELECT count(*)::int AS n FROM features WHERE map_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])',
            [collab.mapId, ids])).n);
        await expect.poll(noServidor, { timeout: 120000, message: 'as feicoes importadas chegaram ao Postgres' })
            .toBe(QUANTAS);

        await expect.poll(() => B.evaluate(async ({ mapId, lista }) => {
            const { getRepository } = await import('/src/js/store/repositories/index.js');
            const esperadas = new Set(lista);
            const mapa = await getRepository().getMap(mapId);
            return (mapa?.features?.points ?? []).filter((f) => esperadas.has(f.properties?.id)).length;
        }, { mapId: collab.mapId, lista: ids }), { timeout: 120000, message: 'o par recebeu as feicoes importadas' })
            .toBe(QUANTAS);

        // O recibo da ultima parte chega ao autor depois de o par ja ter recebido o broadcast.
        await expect.poll(() => A.evaluate(async () => {
            const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
            return operationQueue.countByState();
        }), { timeout: 60000, message: 'a fila do autor esvaziou sem pendencia' })
            .toEqual({ pendentes: 0, preparadas: 0, problemas: 0 });
    });
});

/**
 * A MESMA CLASSE PARA ATUALIZACOES E PARA O DESFAZER (a mesma decisao B6.1 do dono,
 * 2026-09-24): "mover para camada" grava N atualizacoes numa transacao so, e o
 * desfazer de um gesto em massa roda N transacoes dentro de UM gesto. Medido antes da extensao, com
 * 300 feicoes: as duas acoes viravam 300 pendencias, zero no Postgres, e o retrato de recuperacao
 * desfazia o gesto na tela.
 *
 * O estado de partida entra em colagens de 150, de proposito: cada uma cabe num lote, entao o
 * controle negativo (sem a divisao) reprova no gesto medido e nao na preparacao.
 */
async function semearPontos(A, n, prefixo) {
    return A.evaluate(async ({ quantos, rotulo }) => {
        const store = await import('/src/js/store/index.js');
        const ids = [];
        for (let inicio = 0; inicio < quantos; inicio += 150) {
            const pontos = Array.from({ length: Math.min(150, quantos - inicio) }, (_, k) => {
                const id = crypto.randomUUID();
                ids.push(id);
                const i = inicio + k;
                return {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [-43.3 + (i % 30) * 0.001, -22.7 - Math.floor(i / 30) * 0.001] },
                    properties: { id, source: 'point', nome: `${rotulo} ${i}`, size: 6, color: '#ff5500', visivel: true },
                };
            });
            await store.addFeatures({ points: pontos });
        }
        return ids;
    }, { quantos: n, rotulo: prefixo });
}

async function filaVazia(A) {
    await expect.poll(() => A.evaluate(async () => {
        const { operationQueue } = await import('/src/js/store/sync/operation-queue.js');
        return operationQueue.countByState();
    }), { timeout: 90000, message: 'a fila do autor esvaziou sem pendencia' })
        .toEqual({ pendentes: 0, preparadas: 0, problemas: 0 });
}

/** Quantos dos `ids` o par tem com `propriedade === valor`. */
async function noPar(B, mapId, ids, propriedade, valor) {
    return B.evaluate(async ({ m, lista, chave, esperado }) => {
        const { getRepository } = await import('/src/js/store/repositories/index.js');
        const esperadas = new Set(lista);
        const mapa = await getRepository().getMap(m);
        return (mapa?.features?.points ?? [])
            .filter((f) => esperadas.has(f.properties?.id) && f.properties[chave] === esperado).length;
    }, { m: mapId, lista: ids, chave: propriedade, esperado: valor });
}

collabTest.describe('Mover e desfazer em massa num atlas de servidor (B6.1)', () => {
    collabTest.describe.configure({ retries: 0 });

    collabTest('mover 250 pontos para outra camada chega inteiro ao Postgres e ao par', async ({ collab }) => {
        collabTest.setTimeout(300000);
        const A = collab.author;
        const B = collab.peers[0];
        const ids = await semearPontos(A, 250, 'Mover');
        await filaVazia(A);

        const destino = await A.evaluate(async (lista) => {
            const store = await import('/src/js/store/index.js');
            const camada = await store.createLayer('Destino em massa');
            const id = camada?.id ?? camada;
            await store.moveFeaturesToLayer(lista.map((fid) => ({ type: 'point', id: fid })), id);
            return id;
        }, ids);
        await filaVazia(A);

        expect(Number((await collab.db.raw.one(
            'SELECT count(*)::int AS n FROM features WHERE map_id = $1 AND deleted_at IS NULL AND properties->>\'layerId\' = $2',
            [collab.mapId, destino])).n)).toBe(250);
        await expect.poll(() => noPar(B, collab.mapId, ids, 'layerId', destino),
            { timeout: 60000, message: 'o par viu as 250 na camada nova' }).toBe(250);
    });

    collabTest('desfazer a recoloracao em massa de 300 pontos chega inteiro ao Postgres e ao par', async ({ collab }) => {
        collabTest.setTimeout(400000);
        const A = collab.author;
        const B = collab.peers[0];
        const ids = await semearPontos(A, 300, 'Estilo');
        await filaVazia(A);

        // Recolorir a selecao inteira: uma atualizacao por feicao, agrupadas para UM Ctrl+Z, que e o
        // que `updateSelectedFeatures` faz.
        await A.evaluate(async ({ lista, m }) => {
            const store = await import('/src/js/store/index.js');
            const { getRepository } = await import('/src/js/store/repositories/index.js');
            const esperadas = new Set(lista);
            const pontos = (await getRepository().getMap(m)).features.points.filter((f) => esperadas.has(f.properties.id));
            store.startBatchUndo();
            for (const f of pontos) await store.updateFeature('points', { ...f, properties: { ...f.properties, color: '#00aa00' } });
            store.commitBatchUndo();
        }, { lista: ids, m: collab.mapId });
        await filaVazia(A);
        const verdesNoServidor = async () => Number((await collab.db.raw.one(
            'SELECT count(*)::int AS n FROM features WHERE deleted_at IS NULL AND id = ANY($1::uuid[]) AND properties->>\'color\' = $2',
            [ids, '#00aa00'])).n);
        expect(await verdesNoServidor()).toBe(300);

        await A.evaluate(async () => {
            const store = await import('/src/js/store/index.js');
            await store.undoLastAction();
        });
        await filaVazia(A);
        expect(await verdesNoServidor(), 'o desfazer chegou ao servidor').toBe(0);
        await expect.poll(() => noPar(B, collab.mapId, ids, 'color', '#ff5500'),
            { timeout: 60000, message: 'o par voltou a cor original nas 300' }).toBe(300);
    });
});
