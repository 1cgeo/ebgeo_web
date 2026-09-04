// Path: tests/unit/coordination-line-leitura-local.test.js

import { describe, it, expect, beforeEach } from 'vitest';

/**
 * CAMINHO 3, e o que mais importa: a leitura do mapa gravado no IndexedDB.
 *
 * Um mapa gravado antes desta ferramenta nao tem o balde `coordination_lines`, e nenhuma
 * migracao vai rodar para ele: a versao de esquema NAO subiu (decisao de 2026-09-03). Se a
 * leitura nao normalizar a forma, o setup de camadas nao monta a fonte e a ferramenta ativa,
 * aceita clique e nao desenha nada.
 *
 * O repositorio de verdade, sobre `fake-indexeddb`: o duble aqui seria o duble do sujeito.
 *
 * NADA E REESCRITO NO DISCO, e isso tambem e cobrado: uma leitura que gravasse de volta seria
 * uma migracao disfarcada, e marcaria todo mapa como sujo para o sync.
 */

import { localRepository, getScopedStore } from '../../src/js/store/repositories/local.repository.js';
import { StoreName } from '../../src/js/store/atlas-namespace.js';

/** Um documento de mapa como o IndexedDB o guardava antes da ferramenta existir. */
const mapaAntigo = (id) => ({
    id,
    name: id,
    features: {
        points: [{ properties: { id: 'p1' } }],
        lines: [],
        boundarys: [],
    },
});

describe('leitura do mapa local: o balde de linhas de coordenacao', () => {
    beforeEach(async () => {
        for (const chave of await localRepository.getAllMapIds()) {
            await localRepository.deleteMap(chave);
        }
    });

    it('PIOR CASO: `getMap` devolve COM o balde um mapa gravado sem ele', async () => {
        await localRepository.saveMap('Antigo', mapaAntigo('Antigo'));

        const lido = await localRepository.getMap('Antigo');

        expect(lido).not.toBeNull();
        expect(lido.features.coordination_lines).toEqual([]);
        // E sem perder nada do que ja estava la.
        expect(lido.features.points).toHaveLength(1);
    });

    it('`getMapById` normaliza igual, porque e a outra porta de leitura de um documento', async () => {
        await localRepository.saveMap('Antigo2', mapaAntigo('Antigo2'));
        const chave = (await localRepository.getAllMapIds()).find(k => k === 'Antigo2');

        const lido = await localRepository.getMapById(chave);

        expect(lido.features.coordination_lines).toEqual([]);
    });

    it('NAO reescreve o documento gravado: o disco continua sem o balde', async () => {
        await localRepository.saveMap('Antigo3', mapaAntigo('Antigo3'));
        await localRepository.getMap('Antigo3');

        // Lido CRU, pela mesma loja que o repositorio usa: se a leitura tivesse gravado de
        // volta, ela seria uma migracao disfarcada e marcaria o documento como sujo para o
        // sync. A asserção e sobre o disco, nao sobre o que a leitura devolve.
        const cru = await getScopedStore(StoreName.MAPS).getItem('Antigo3');
        expect(cru.features.coordination_lines).toBeUndefined();

        // E a leitura seguinte normaliza de novo, sem depender da anterior.
        const relido = await localRepository.getMap('Antigo3');
        expect(relido.features.coordination_lines).toEqual([]);
    });

    it('o mapa que ja tem o balde volta inteiro, com as mesmas feicoes', async () => {
        await localRepository.saveMap('Novo', {
            id: 'Novo',
            name: 'Novo',
            features: { points: [], coordination_lines: [{ properties: { id: 'cl-1' } }] },
        });

        const lido = await localRepository.getMap('Novo');

        expect(lido.features.coordination_lines).toHaveLength(1);
        // Nao ha copia quando nao ha o que mudar: `ensureMapDataShape` devolve null e a
        // leitura entrega o documento que veio do disco.
        expect(lido.features.coordination_lines[0].properties.id).toBe('cl-1');
    });

    it('um mapa inexistente continua devolvendo null, nunca um documento inventado', async () => {
        expect(await localRepository.getMap('nao-existe')).toBeNull();
        expect(await localRepository.getMapById('nao-existe')).toBeNull();
    });
});
