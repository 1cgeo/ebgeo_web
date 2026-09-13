// Path: tests/e2e/unidades-de-disputa.e2e.test.js

/**
 * @fileoverview O contrato de base e unidade de disputa PARA ENTIDADE QUE NÃO É FEIÇÃO, medido
 * contra o servidor real.
 *
 * O QUE ELE PROVA, e é a metade que nenhum teste hermético alcança: que a unidade que o CLIENTE
 * declara (`store/sync/dispute-units.js`) é a mesma que o SERVIDOR deriva do payload
 * (`declaredUpdateColumns` → `unitsForColumns`, `backend/src/modules/sync/`). O espelho unitário
 * compara os nomes das unidades; só o servidor de verdade diz se um `name` e um `visible`
 * concorrentes convergem ou brigam.
 *
 * POR QUE OS PAYLOADS AQUI SÃO ESTREITOS. O servidor deriva a unidade das COLUNAS que o payload
 * declara, e não do `patch`: uma camada enviada como documento INTEIRO reivindica todas as
 * unidades que carrega, e duas edições quaisquer dela brigam. Isso é o veredito honesto para uma
 * escrita larga (ela realmente sobrescreveria tudo), mas não é o que este arquivo mede. Ele mede
 * a separação por unidade, então manda o que o gerente de camadas ainda não manda: só o campo
 * mudado. Quando o cliente estreitar o payload de camada, ou quando o servidor passar a ler o
 * `patch`, estes casos passam a descrever o caminho do produto e não só o do protocolo.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    makeApi,
    registerAndLogin,
    createAtlas,
    createMap,
    confirmedDefaultLayerId,
    newClientId,
    E2E_SKIP,
} from './helpers/harness.js';
import { createOperation } from '../../src/js/store/sync/operation-factory.js';

describe.skipIf(E2E_SKIP)('e2e: base observada e unidade de disputa por entidade', () => {
    /** @type {import('../../src/js/store/sync/api-client.js').ApiClient} */
    let api;
    let atlas;
    let mapId;
    const clientA = newClientId();
    const clientB = newClientId();

    /** A revisão que o servidor guarda AGORA para uma camada, lida do snapshot. */
    async function revisaoDaCamada(layerId) {
        const { snapshot } = await api.pullSync(atlas.id, 0);
        const camada = snapshot.maps.find((m) => m.id === mapId)?.layers?.find((l) => l.id === layerId);
        if (!Number.isSafeInteger(Number(camada?.version))) {
            throw new Error('O servidor não devolveu a revisão da camada.');
        }
        return { camada, version: Number(camada.version) };
    }

    /** Uma op de camada com payload ESTREITO e base declarada. */
    function edicaoDeCamada(layerId, campos, base, clientId) {
        return {
            ...createOperation('layer', 'update', layerId, mapId,
                { id: layerId, ...campos }, { id: layerId, confirmedVersion: base }),
            clientId,
        };
    }

    beforeAll(async () => {
        api = makeApi();
        await registerAndLogin(api, { nome: 'Unidades Owner' });
        atlas = await createAtlas(api, { name: 'Atlas de Unidades' });
        mapId = await createMap(api, atlas.id, { name: 'Mapa de Unidades' });
    }, 20000);

    afterAll(async () => {
        try {
            await api.logout();
        } catch {
            /* best-effort cleanup */
        }
    });

    it('declara a base: o envelope leva `baseVersion` e o patch nomeia o campo mudado', async () => {
        const layerId = await confirmedDefaultLayerId(api, atlas.id, mapId);
        const { version } = await revisaoDaCamada(layerId);
        const op = edicaoDeCamada(layerId, { name: 'Alfa' }, version, clientA);
        // PISO contra cobertura vazia: sem estas duas, os casos abaixo mediriam o regime ANTIGO
        // (op sem base, LWW por chegada) e passariam verdes chamando isso de convergência.
        expect(op.baseVersion).toBe(version);
        expect(op.patch).toEqual([{ op: 'set', path: ['name'], value: 'Alfa' }]);

        const resp = await api.pushOperations(atlas.id, [op]);
        const [ack] = resp.results ?? resp.acks;
        expect(ack.rejected).not.toBe(true);
        // O recibo devolve a revisão que a entidade COMMITOU, que é a base da próxima edição.
        expect(ack.entityVersion).toBe(version + 1);
    });

    it('duas unidades DISTINTAS a partir da mesma base convergem', async () => {
        const layerId = await confirmedDefaultLayerId(api, atlas.id, mapId);
        const { version } = await revisaoDaCamada(layerId);

        const nomeA = edicaoDeCamada(layerId, { name: 'Bravo' }, version, clientA);
        const visivelB = edicaoDeCamada(layerId, { visible: false }, version, clientB);

        const primeira = await api.pushOperations(atlas.id, [nomeA]);
        const segunda = await api.pushOperations(atlas.id, [visivelB]);
        expect((primeira.results ?? primeira.acks)[0].rejected).not.toBe(true);
        // A SEGUNDA é a asserção: ela parte de uma base que a primeira já ultrapassou, e mesmo
        // assim entra, porque `visivel` e `nome` são unidades diferentes.
        expect((segunda.results ?? segunda.acks)[0].rejected).not.toBe(true);

        const { camada } = await revisaoDaCamada(layerId);
        expect(camada.name).toBe('Bravo');
        expect(camada.visible).toBe(false);
    });

    it('a MESMA unidade a partir da mesma base é conflito, e a recusa nomeia a unidade', async () => {
        const layerId = await confirmedDefaultLayerId(api, atlas.id, mapId);
        const { version } = await revisaoDaCamada(layerId);

        const nomeA = edicaoDeCamada(layerId, { name: 'Charlie' }, version, clientA);
        const nomeB = edicaoDeCamada(layerId, { name: 'Delta' }, version, clientB);

        const primeira = await api.pushOperations(atlas.id, [nomeA]);
        expect((primeira.results ?? primeira.acks)[0].rejected).not.toBe(true);

        const segunda = await api.pushOperations(atlas.id, [nomeB]);
        const [ack] = segunda.results ?? segunda.acks;
        expect(ack.rejected).toBe(true);
        expect(ack.status).toBe('conflict');
        expect(ack.conflict.fields).toContain('nome');
        expect(ack.conflict.entityVersion).toBe(version + 1);

        // E a escrita recusada NÃO aconteceu: é a metade que separa "recusou" de "recusou e
        // gravou assim mesmo", que é o defeito que a revisão por entidade existe para fechar.
        const { camada } = await revisaoDaCamada(layerId);
        expect(camada.name).toBe('Charlie');
    });

    it('sem base declarada, o servidor continua aplicando por ordem de chegada', async () => {
        // O CONTRASTE. Sem ele, os casos acima não distinguem "a verificação ligou" de "o
        // servidor sempre recusou a segunda escrita", e o regime antigo é o que TODA entidade
        // sem revisão confirmada ainda usa: atlas local, documento que nunca voltou do servidor.
        const layerId = await confirmedDefaultLayerId(api, atlas.id, mapId);
        const { version } = await revisaoDaCamada(layerId);

        const semBase = {
            ...createOperation('layer', 'update', layerId, mapId, { id: layerId, name: 'Echo' }, null),
            clientId: clientB,
        };
        expect(semBase.baseVersion).toBeNull();
        // Uma primeira escrita move a revisão, para que a de baixo esteja de fato desatualizada.
        await api.pushOperations(atlas.id, [edicaoDeCamada(layerId, { name: 'Foxtrot' }, version, clientA)]);

        const resp = await api.pushOperations(atlas.id, [semBase]);
        expect((resp.results ?? resp.acks)[0].rejected).not.toBe(true);
        expect((await revisaoDaCamada(layerId)).camada.name).toBe('Echo');
    });
});
