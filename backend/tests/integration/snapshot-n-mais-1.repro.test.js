// Regressão de PERFORMANCE: `getAtlasSnapshot` fazia SETE round-trips POR MAPA
// (features, cesium3d, streetview360, catalog_layers, layers, groups,
// group_features) mais UM por briefing (slides), todos dentro do mesmo `task()`,
// que retém uma conexão do pool (poolMax default 10) durante a série inteira.
//
// Não é caminho administrativo: `pullOperations` chama o snapshot sempre que
// `sinceVersion === 0` ou o cliente está atrás de `min_version`, ou seja, em TODO
// connect de todo usuário e em todo pull atrasado. Um atlas com 30 mapas fazia
// 200+ idas ao banco segurando uma das 10 conexões.
//
// O padrão certo já existia NO MESMO ARQUIVO: `GET_ATLAS_COMMENTS` busca uma vez
// para o atlas inteiro e agrupa por map_id, com o comentário dizendo que é "to
// avoid an extra per-map query for every (often empty) map". As outras coleções
// ficaram de fora. O relatório contou seis; são sete — `GET_MAP_LAYERS` também
// estava no laço.
//
// COMO ESTE TESTE PROVA. Não mede tempo, que em suíte é ruído. Ele CONTA as
// queries de verdade, pelo hook `query` do pg-promise, e afirma a propriedade que
// interessa: **o número não cresce com o número de mapas**. Um atlas com 1 mapa e
// outro com 6 precisam custar o MESMO número de round-trips.
//
// CONTROLE NEGATIVO: restaurar qualquer uma das buscas para dentro do laço faz a
// contagem do atlas de 6 mapas subir e o caso cai.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { setupTestEnv, teardownTestEnv } from '../helpers/setup.js';
import { createUser, createAtlas } from '../helpers/fixtures.js';
import { db } from '../../src/database/index.js';
import * as syncService from '../../src/modules/sync/sync.service.js';

/**
 * Conta as queries emitidas durante `fn`, pelo hook de evento do pg-promise.
 * As opções vivem em `db.$config.options` — `pgp.options` não existe nesta
 * versão, e a diferença custou uma execução vermelha para descobrir.
 */
async function contarQueries(fn) {
    const opts = db.$config.options;
    const original = opts.query;
    let n = 0;
    opts.query = () => { n += 1; };
    try {
        await fn();
    } finally {
        opts.query = original;
    }
    return n;
}

describe('getAtlasSnapshot não faz N+1 (repro de performance)', () => {
    let db, atlas1, atlas6;

    async function semearAtlas(userId, qtdMapas) {
        const atlas = await createAtlas(db, userId, { name: `Atlas ${qtdMapas}m ${randomUUID().slice(0, 6)}` });
        for (let i = 0; i < qtdMapas; i++) {
            const mapId = randomUUID();
            await db.query(
                `INSERT INTO maps (id, atlas_id, name, version) VALUES ($1, $2, $3, 1)`,
                [mapId, atlas.id, `Mapa ${i}`],
            );
            // Conteúdo em cada mapa: um snapshot de mapas vazios poderia esconder
            // o N+1 se alguma busca fosse pulada por atalho.
            const layerId = randomUUID();
            await db.query(
                `INSERT INTO layers (id, map_id, name, sort_order, version) VALUES ($1, $2, 'L', 0, 1)`,
                [layerId, mapId],
            );
            await db.query(
                `INSERT INTO features (id, map_id, feature_type, geometry, properties, layer_id, version)
                 VALUES ($1, $2, 'point', $3, $4, $5, 1)`,
                [randomUUID(), mapId, JSON.stringify({ type: 'Point', coordinates: [-43, -22] }), JSON.stringify({ nome: 'P' }), layerId],
            );
        }
        return atlas;
    }

    before(async () => {
        const env = await setupTestEnv();
        db = env.db;
        const dono = await createUser(db, { username: `n1_${randomUUID().slice(0, 8)}` });
        atlas1 = await semearAtlas(dono.id, 1);
        atlas6 = await semearAtlas(dono.id, 6);
    });

    after(async () => {
        await teardownTestEnv(db);
    });

    it('o custo em queries é CONSTANTE: 1 mapa e 6 mapas custam o mesmo', async () => {
        const com1 = await contarQueries(() => syncService.getAtlasSnapshot(atlas1.id));
        const com6 = await contarQueries(() => syncService.getAtlasSnapshot(atlas6.id));

        assert.equal(
            com6,
            com1,
            `o snapshot deveria custar o mesmo com 1 e com 6 mapas; ` +
            `deu ${com1} e ${com6} (delta ${com6 - com1} ≈ ${((com6 - com1) / 5).toFixed(1)} por mapa extra)`,
        );
    });

    it('e o conteúdo continua correto: os 6 mapas voltam com suas feições e camadas', async () => {
        const snap = await syncService.getAtlasSnapshot(atlas6.id);
        assert.equal(snap.maps.length, 6, 'todos os mapas voltam');
        for (const m of snap.maps) {
            assert.equal(m.layers.length, 1, `mapa ${m.name} perdeu a camada`);
            // `features` é um OBJETO por tipo (points/lines/polygons/...), não um
            // array — é o shape que o frontend espera no snapshot.
            assert.equal(m.features.points.length, 1, `mapa ${m.name} perdeu o ponto`);
            assert.ok(Array.isArray(m.groups));
            assert.ok(Array.isArray(m.comments));
        }
    });
});
