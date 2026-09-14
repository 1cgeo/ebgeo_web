// Path: tests/e2e/edicao-encadeada-por-entidade.e2e.test.js

/**
 * @fileoverview DUAS EDIÇÕES DA MESMA CAMADA ANTES DO PRIMEIRO RECIBO, contra o servidor real.
 *
 * O QUE ELE MEDE, e por que só o servidor de verdade pode medir. Desde que
 * `store/sync/mutation-contract.js` passou a declarar base para TODA entidade com unidade de
 * disputa, a segunda edição de uma camada feita antes de o recibo da primeira voltar declara a
 * MESMA base que a primeira declarou: o documento local ainda carrega o `confirmedVersion` que o
 * servidor confirmou lá atrás, porque quem o atualiza é o recibo. O servidor então aplica a
 * primeira, move a fronteira daquela unidade, e RECUSA a segunda nomeando a unidade que a própria
 * primeira acabou de mover. O autor perde a própria edição contra si mesmo, sem colaborador
 * nenhum na história.
 *
 * O REMÉDIO JÁ EXISTIA NO SERVIDOR e é `baseOperationId`: `resolveObservedBase`
 * (`backend/src/modules/sync/entity-conflicts.js`) lê o recibo do antecessor e adota a revisão que
 * ELE commitou como base da dependente. O cabeçalho daquela função diz por extenso que "uma edição
 * dependente enviada antes do ack do antecessor é comportamento de CLIENTE, não de feição, então
 * toda entidade precisa da mesma resolução". O cliente, porém, só encadeava feição
 * (`persistOperationIntents`, `store/sync/operation-dispatcher.js`, que saía do laço em
 * `entityType !== FEATURE`). Este arquivo fixa as duas metades: o vermelho da recusa quando não há
 * encadeamento, e o verde da convergência quando há.
 *
 * PISO CONTRA COBERTURA VAZIA. Cada caso afirma ANTES o que faz dele o caso que é: que as duas ops
 * declaram a mesma base (senão ele mediria o regime antigo, sem base, onde nada briga), e que a
 * segunda carrega (ou não carrega) o `baseOperationId`. Sem essas asserções os dois casos
 * passariam verdes medindo a mesma coisa.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
    confirmedDefaultLayerId,
    E2E_SKIP,
} from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';

describe.skipIf(E2E_SKIP)('e2e: duas edições da mesma entidade antes do primeiro recibo', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let api;
    let atlas;

    /** A camada como o snapshot a devolve, com a revisão que o servidor guarda. */
    async function camadaDoServidor(mapId, layerId) {
        const { snapshot } = await api.pullSync(atlas.id, 0);
        const camada = snapshot.maps.find((m) => m.id === mapId)?.layers?.find((l) => l.id === layerId);
        if (!camada) throw new Error('O servidor não devolveu a camada.');
        return camada;
    }

    /**
     * O documento local de uma camada, na forma que `_updateLayerProperty`
     * (`frontend/src/js/layers/layer.manager.js`) escreve: documento INTEIRO, `version` local
     * incrementada, `confirmedVersion` herdado do que o servidor confirmou por último.
     */
    function documentoLocal(camada, mudancas, { version, confirmedVersion }) {
        return {
            id: camada.id,
            name: camada.name,
            visible: camada.visible,
            locked: camada.locked,
            opacity: camada.opacity,
            order: camada.order,
            ...mudancas,
            updatedAt: Date.now(),
            version,
            confirmedVersion,
        };
    }

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Encadeamento Owner' });
        atlas = await createAtlas(api, { name: 'Atlas de Encadeamento' });
    }, 20000);

    afterAll(async () => {
        try {
            await api.logout();
        } catch {
            /* best-effort cleanup */
        }
    });

    it('SEM encadeamento, a segunda edição perde para a primeira do MESMO autor', async () => {
        const mapId = await createMap(api, atlas.id, { name: 'Mapa Sem Encadeamento' });
        const layerId = await confirmedDefaultLayerId(api, atlas.id, mapId);
        const camada = await camadaDoServidor(mapId, layerId);
        const base = Number(camada.version);
        expect(Number.isSafeInteger(base)).toBe(true);

        // As duas nascem OFFLINE, uma depois da outra, então a segunda lê da memória o documento
        // que a primeira escreveu: `version` local anda, `confirmedVersion` NÃO, porque o recibo
        // da primeira nunca chegou.
        //
        // AS DUAS TOCAM A MESMA UNIDADE (a opacidade), de propósito. Desde 2026-09-13 o servidor
        // deriva as unidades em disputa do `patch`, e não do payload inteiro, então renomear e
        // depois mudar a opacidade são duas unidades DISTINTAS que convergem sem encadeamento
        // nenhum (é o aceite da B5.4). O caso da edição dependente é o de duas edições da MESMA
        // unidade sobre a mesma base: a primeira move a fronteira, a segunda chega atrasada.
        const meiaLuz = documentoLocal(camada, { opacity: 0.3 },
            { version: 2, confirmedVersion: base });
        const opacidade = documentoLocal(meiaLuz, { opacity: 0.55 },
            { version: 3, confirmedVersion: base });

        const op1 = createOperation('layer', 'update', layerId, mapId, meiaLuz,
            { ...camada, confirmedVersion: base });
        const op2 = createOperation('layer', 'update', layerId, mapId, opacidade, meiaLuz);

        // O PISO: as duas declaram a MESMA base, que é o que faz deste o caso da edição dependente.
        expect(op1.baseVersion).toBe(base);
        expect(op2.baseVersion).toBe(base);
        expect(op2.baseOperationId).toBeUndefined();

        const resp = await api.pushOperations(atlas.id, [op1, op2]);
        const acks = resp.results ?? resp.acks;
        expect(acks).toHaveLength(2);
        const [ack1, ack2] = acks;

        // A primeira aplica e leva a fronteira da entidade para a revisão seguinte.
        expect(ack1.rejected).not.toBe(true);
        expect(ack1.entityVersion).toBe(base + 1);

        // A SEGUNDA É RECUSADA, e o motivo nomeia a unidade que a PRIMEIRA moveu.
        expect(ack2.rejected).toBe(true);
        expect(ack2.conflict?.fields ?? []).toContain('opacidade');

        // E o efeito na tela do par: a PRIMEIRA opacidade viaja, a segunda não.
        const depois = await camadaDoServidor(mapId, layerId);
        expect(depois.opacity).toBeCloseTo(0.3, 5);
    }, 30000);

    it('COM `baseOperationId`, as duas edições do mesmo autor convergem', async () => {
        const mapId = await createMap(api, atlas.id, { name: 'Mapa Com Encadeamento' });
        const layerId = await confirmedDefaultLayerId(api, atlas.id, mapId);
        const camada = await camadaDoServidor(mapId, layerId);
        const base = Number(camada.version);

        const renomear = documentoLocal(camada, { name: 'Configuração preservada' },
            { version: 2, confirmedVersion: base });
        const opacidade = documentoLocal(renomear, { opacity: 0.55 },
            { version: 3, confirmedVersion: base });

        const op1 = createOperation('layer', 'update', layerId, mapId, renomear,
            { ...camada, confirmedVersion: base });
        const op2 = createOperation('layer', 'update', layerId, mapId, opacidade, renomear);
        // O QUE O DESPACHANTE PASSOU A CARIMBAR. O envelope é o mesmo do caso acima, mais esta
        // linha; se ela sozinha muda o desfecho, o defeito estava exatamente na sua ausência.
        op2.baseOperationId = op1.id;

        expect(op1.baseVersion).toBe(base);
        expect(op2.baseVersion).toBe(base);
        expect(op2.baseOperationId).toBe(op1.id);

        const resp = await api.pushOperations(atlas.id, [op1, op2]);
        const acks = resp.results ?? resp.acks;
        expect(acks).toHaveLength(2);
        const [ack1, ack2] = acks;

        expect(ack1.rejected).not.toBe(true);
        expect(ack1.entityVersion).toBe(base + 1);
        expect(ack2.rejected).not.toBe(true);
        expect(ack2.entityVersion).toBe(base + 2);

        const depois = await camadaDoServidor(mapId, layerId);
        expect(depois.name).toBe('Configuração preservada');
        expect(depois.opacity).toBeCloseTo(0.55, 5);
    }, 30000);

    it('o encadeamento não engole o conflito de OUTRO autor sobre a mesma unidade', async () => {
        // CONTROLE NEGATIVO DO PRÓPRIO REMÉDIO: se `baseOperationId` passasse a valer como
        // "aplique sempre", ele teria trocado uma perda silenciosa por outra. A dependente adota a
        // revisão que o ANTECESSOR commitou, e nada além disso, então uma edição de terceiro que
        // chegue no meio continua brigando.
        const mapId = await createMap(api, atlas.id, { name: 'Mapa Com Terceiro' });
        const layerId = await confirmedDefaultLayerId(api, atlas.id, mapId);
        const camada = await camadaDoServidor(mapId, layerId);
        const base = Number(camada.version);

        const renomear = documentoLocal(camada, { name: 'Do autor' },
            { version: 2, confirmedVersion: base });
        const op1 = createOperation('layer', 'update', layerId, mapId, renomear,
            { ...camada, confirmedVersion: base });
        await api.pushOperations(atlas.id, [op1]);

        // O terceiro escreve sobre a MESMA unidade, a partir da revisão que o autor commitou.
        const doTerceiro = documentoLocal(camada, { opacity: 0.2 },
            { version: 2, confirmedVersion: base + 1 });
        const opTerceiro = createOperation('layer', 'update', layerId, mapId, doTerceiro,
            { ...camada, confirmedVersion: base + 1 });
        const respTerceiro = await api.pushOperations(atlas.id, [opTerceiro]);
        expect((respTerceiro.results ?? respTerceiro.acks)[0].rejected).not.toBe(true);

        // A dependente do autor, encadeada na PRIMEIRA, adota `base + 1` e continua atrás do
        // terceiro, que já levou a fronteira para `base + 2`.
        const opacidade = documentoLocal(renomear, { opacity: 0.55 },
            { version: 3, confirmedVersion: base });
        const op2 = createOperation('layer', 'update', layerId, mapId, opacidade, renomear);
        op2.baseOperationId = op1.id;
        const resp = await api.pushOperations(atlas.id, [op2]);
        const [ack] = resp.results ?? resp.acks;
        expect(ack.rejected).toBe(true);
        expect(ack.conflict?.fields ?? []).toContain('opacidade');
    }, 30000);
});
