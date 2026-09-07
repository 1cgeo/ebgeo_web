// Path: tests/unit/fila-legada-nunca-vai-para-atlas-de-servidor.test.js

/**
 * @fileoverview A guarda da fila herdada: operação SEM carimbo nunca é reendereçada para o
 * namespace de um atlas de SERVIDOR.
 *
 * O PIOR CASO PRIMEIRO, e ele é o cenário de um usuário real. A linha anterior do produto
 * (sem backend) enfileirava toda operação e não escrevia `scopeSuffix` em nenhuma, então a
 * instalação que atravessa para esta linha chega com a fila cheia de envelopes sem endereço.
 * O boot monta um escopo REMOTO sempre que o marcador de origem diz REMOTE e há sessão viva,
 * que é o estado de quem fez login, abriu um atlas de servidor e recarregou a página. Medido
 * em 2026-09-07 antes do conserto: as três operações saíam de `ebgeo` e chegavam inteiras em
 * `ebgeo__remote-<id>`, com o `data` intacto, e a fila de saída é o que o auto-flush drena.
 *
 * O QUE ESTE VERDE PROVARIA SE O CÓDIGO ESTIVESSE ERRADO: cada caso conta os DOIS bancos por
 * nome absoluto, contra IndexedDB de verdade, e o banco do atlas de servidor é conferido por
 * EXISTÊNCIA, não por conteúdo. Um roteamento que movesse e voltasse, ou que criasse o banco
 * vazio, reprova aqui; um caso que só contasse a origem ficaria verde nos dois desenhos.
 *
 * OS CONTROLES POSITIVOS EXERCITAM OS EIXOS QUE A REGRA AFIRMA MEDIR, porque eixo não
 * exercitado sai aprovado por omissão: a regra diz "sem carimbo" (então a op COM carimbo
 * remoto continua indo ao remoto dela) e diz "servidor" (então o slot LOCAL de sufixo próprio
 * continua reivindicando a fila sem endereço, que é a regra original do módulo).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    seedDatabase,
    readDatabase,
    databaseExists,
    resetIndexedDB
} from '../helpers/idb-helpers.js';

/** Id opaco de atlas de servidor, no formato que `remoteScope` aceita. */
const ATLAS_REMOTO = 'aaaaaaaa1111422283334444';

/** Nome do banco de fila anterior ao namespace, que hoje é o do slot local #1. */
const FILA_LEGADA = 'ebgeo';

/** Store dentro do banco de fila, igual em todos os escopos. */
const FILA = { storeName: 'operation_queue' };

/**
 * Três operações no formato EXATO da linha sem backend: sem `scopeSuffix` e sem `atlasId`,
 * com `data` inteiro. Escritas DIRETO no banco legado, que é a forma que elas têm no disco
 * de quem atualizou o app; enfileirar pela API usaria o endereço ativo e não reproduziria o
 * cenário.
 * @returns {Object} Entradas prontas para `seedDatabase`.
 */
function opsSemCarimbo() {
    return {
        op_1000_a: {
            id: 'a', entityType: 'feature', operationType: 'create', entityId: 'f1',
            mapId: 'Principal', data: { properties: { id: 'f1', descricao: 'trabalho local' } },
            previousData: null, timestamp: 1000, lamportTimestamp: 1, clientId: 'c1'
        },
        op_1001_b: {
            id: 'b', entityType: 'layer', operationType: 'update', entityId: 'l1',
            mapId: 'Principal', data: { name: 'Camada 1' },
            previousData: null, timestamp: 1001, lamportTimestamp: 2, clientId: 'c1'
        },
        op_1002_c: {
            id: 'c', entityType: 'map', operationType: 'create', entityId: 'm1',
            mapId: null, data: { name: '09 Lote' },
            previousData: null, timestamp: 1002, lamportTimestamp: 3, clientId: 'c1'
        }
    };
}

/** @returns {Promise<{ns: Object, migrar: Function}>} Os dois módulos, num grafo novo. */
async function carregar() {
    const ns = await import('@store/atlas-namespace.js');
    const { migratePendingOperationsToScopedQueues } =
        await import('@store/sync/operation-queue-migration.js');
    return { ns, migrar: migratePendingOperationsToScopedQueues };
}

/**
 * @param {string} dbName - Nome absoluto do banco.
 * @returns {Promise<string[]>} Ids das operações guardadas ali, ordenados.
 */
async function idsEm(dbName) {
    const conteudo = await readDatabase(dbName, FILA);
    return conteudo ? Object.values(conteudo).map(op => op.id).sort() : [];
}

beforeEach(async () => { await resetIndexedDB(); });
afterEach(async () => { await resetIndexedDB(); });

describe('a fila herdada, quando o boot monta um atlas de SERVIDOR', () => {
    it('as três operações sem carimbo FICAM em `ebgeo`, e o banco do atlas nem chega a existir', async () => {
        const { ns, migrar } = await carregar();
        await seedDatabase(FILA_LEGADA, opsSemCarimbo(), FILA);
        // Positiva antes da negativa: a origem TINHA as três.
        expect(await idsEm(FILA_LEGADA)).toEqual(['a', 'b', 'c']);

        const escopoRemoto = ns.remoteScope(ATLAS_REMOTO);
        const nomeRemoto = ns.resolveDbName(ns.StoreName.OPERATION_QUEUE, escopoRemoto);
        expect(nomeRemoto).toBe(`ebgeo__remote-${ATLAS_REMOTO}`);

        const relatorio = await migrar({ scope: escopoRemoto });

        expect(relatorio).toEqual({ moved: 0, kept: 3, failed: 0 });
        expect(await idsEm(FILA_LEGADA)).toEqual(['a', 'b', 'c']);
        expect(await databaseExists(nomeRemoto)).toBe(false);
    });

    it('o slot LOCAL adotado tem sufixo de servidor, e são os mesmos bancos: nada se move', async () => {
        // `adoptRemoteAtlasAsLocal` resgata trabalho não sincronizado movendo a reivindicação
        // e ZERO bytes, então o slot fica LOCAL no registro e `remote-<id>` no disco. Abrir
        // aquele atlas de novo monta exatamente esses bancos e drena o que estiver neles, e é
        // por isso que a guarda pergunta pelo SUFIXO, e não só pelo `kind` do escopo.
        const { ns, migrar } = await carregar();
        await seedDatabase(FILA_LEGADA, opsSemCarimbo(), FILA);

        const escopoAdotado = ns.localScope('slot-2', `remote-${ATLAS_REMOTO}`);
        expect(escopoAdotado.kind).toBe(ns.StoreScopeKind.LOCAL);

        const relatorio = await migrar({ scope: escopoAdotado });

        expect(relatorio).toEqual({ moved: 0, kept: 3, failed: 0 });
        expect(await idsEm(FILA_LEGADA)).toEqual(['a', 'b', 'c']);
        expect(await databaseExists(`ebgeo__remote-${ATLAS_REMOTO}`)).toBe(false);
    });

    it('CONTROLE: a op COM carimbo remoto continua indo para o atlas do carimbo dela', async () => {
        const { ns, migrar } = await carregar();
        const ops = opsSemCarimbo();
        ops.op_1000_a.scopeSuffix = `remote-${ATLAS_REMOTO}`;
        await seedDatabase(FILA_LEGADA, ops, FILA);

        const relatorio = await migrar({ scope: ns.remoteScope(ATLAS_REMOTO) });

        expect(relatorio).toEqual({ moved: 1, kept: 2, failed: 0 });
        const naFilaRemota = await readDatabase(`ebgeo__remote-${ATLAS_REMOTO}`, FILA);
        expect(Object.keys(naFilaRemota)).toEqual(['op_1000_a']);
        // Reendereçar não é reescrever: o envelope chega inteiro.
        expect(naFilaRemota.op_1000_a.data.properties.descricao).toBe('trabalho local');
        expect(await idsEm(FILA_LEGADA)).toEqual(['b', 'c']);
    });

    it('CONTROLE: montando um slot LOCAL de sufixo próprio, a regra original vale e as três se movem', async () => {
        const { ns, migrar } = await carregar();
        await seedDatabase(FILA_LEGADA, opsSemCarimbo(), FILA);

        const escopoLocal = ns.localScope('slot-2', 'slot2');
        const relatorio = await migrar({ scope: escopoLocal });

        expect(relatorio).toEqual({ moved: 3, kept: 0, failed: 0 });
        expect(await idsEm('ebgeo__slot2')).toEqual(['a', 'b', 'c']);
        expect(await idsEm(FILA_LEGADA)).toEqual([]);
    });

    it('CONTROLE: montando o próprio slot legado, nada se move (a instalação comum)', async () => {
        const { ns, migrar } = await carregar();
        await seedDatabase(FILA_LEGADA, opsSemCarimbo(), FILA);

        const relatorio = await migrar({
            scope: ns.localScope('slot-1', ns.LEGACY_DB_SUFFIX)
        });

        expect(relatorio).toEqual({ moved: 0, kept: 3, failed: 0 });
        expect(await idsEm(FILA_LEGADA)).toEqual(['a', 'b', 'c']);
    });
});
