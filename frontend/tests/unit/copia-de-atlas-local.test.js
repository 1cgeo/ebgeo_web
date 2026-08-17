// Path: tests/unit/copia-de-atlas-local.test.js

/**
 * @fileoverview `copyAtlasDatabases`, a máquina de "Fazer uma cópia" de um atlas local, medida
 * sobre IndexedDB DE VERDADE.
 *
 * A JUSTIFICATIVA PARA NÃO TESTAR ISTO ERA "precisa de dois endereços reais de IndexedDB", e ela
 * já não valia quando foi escrita: `fake-indexeddb` é instalado para TODO arquivo desta suíte
 * (`tests/setup/indexeddb.setup.js`), então dois endereços reais existem aqui e o localforage roda
 * no driver de IndexedDB. Por isso nada neste arquivo mocka `localforage`, ao contrário de
 * `tests/unit/atlas-namespace.test.js`: um `Map` chaveado por nome não distingue banco AUSENTE de
 * banco VAZIO, e essa diferença é justamente o que prova que a fila de saída não foi copiada.
 *
 * TRÊS AFIRMAÇÕES, e nenhuma se sustenta sozinha:
 *
 *   1. DIREÇÃO. Origem → destino, nunca o contrário. Uma inversão produz dois atlas idênticos, que
 *      é o resultado que passa em qualquer verificação que só olhe o destino; por isso o destino é
 *      semeado ANTES com valores conflitantes e a origem é relida no fim.
 *   2. ALCANCE. Só os bancos `atlasData: true`. A fila de saída é por atlas SEM ser dado do atlas, e
 *      copiá-la faria a cópia tentar sincronizar as operações pendentes do original.
 *   3. RECUSA. O que a função recusa é ENDEREÇO igual (kind + sufixo), não id igual. Dois slots do
 *      registro podem apontar para os mesmos bancos — é literalmente o que o resgate produz — e uma
 *      recusa por id deixaria a cópia se escrever por cima da própria origem.
 *
 * O QUE ESTE ARQUIVO NÃO ALCANÇA, dito para que ninguém o leia como cobertura completa:
 * `fake-indexeddb` roda num processo só e não guarda `Blob` (sem `FileReader` o localforage cai em
 * `_encodeBlob` e a escrita lança), então o banco de imagens é semeado com bytes crus. Blob de
 * verdade, a UI e a cópia vista pelo usuário são `frontend/tests/e2e-ui/copiar-atlas-local.spec.js`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetIndexedDB, databaseState } from '../helpers/idb-helpers.js';

/**
 * Os DEZ bancos de dado de um atlas, escritos à mão e nunca derivados do módulo sob teste.
 * Derivá-los do mesmo filtro (`perAtlas && atlasData`) que a função usa faria instrumento e sujeito
 * concordarem por construção, e a lista voltaria a ser o que a função decidir que ela é.
 */
const BANCOS_DE_DADO = [
    'ATLAS', 'MAPS', 'IMAGES', 'SETTINGS', 'GROUPS',
    'LAYERS', 'CESIUM3D', 'STREETVIEW360', 'BRIEFINGS', 'COMMENTS'
];

/** O object store da fila, que não é o default do localforage e precisa ser dito para lê-la. */
const OBJECT_STORE_DA_FILA = 'operation_queue';

let ns;

beforeEach(async () => {
    await resetIndexedDB();
    // A fábrica guarda um handle por (store, escopo) no nível do módulo: sem instância nova, um
    // teste leria os handles do anterior, que apontam para bancos que o reset acabou de apagar.
    vi.resetModules();
    ns = await import('../../src/js/store/atlas-namespace.js');
});

/**
 * Escreve uma chave conhecida em cada um dos dez bancos de dado do escopo.
 * @param {{kind: string, dbSuffix: string}} scope - Escopo a semear.
 * @param {string} marca - Texto que identifica de quem é o valor.
 * @returns {Promise<void>}
 */
async function semearOsDez(scope, marca) {
    for (const nome of BANCOS_DE_DADO) {
        await ns.getStoreFor(ns.StoreName[nome], scope).setItem('k', `${marca}: ${nome}`);
    }
}

describe('copyAtlasDatabases :: direção', () => {
    it('copia origem -> destino, e a origem sai intacta', async () => {
        const origem = ns.localScope('origem', 'aaa');
        const destino = ns.localScope('destino', 'bbb');

        await semearOsDez(origem, 'da origem');
        await ns.getStoreFor(ns.StoreName.IMAGES, origem).setItem('img-1', new Uint8Array([7, 8, 9]));
        // O destino já tem um valor CONFLITANTE sob a mesma chave, mais uma chave só dele. Sem o
        // conflito, uma cópia invertida deixaria o destino igual ao esperado e passaria verde.
        await ns.getStoreFor(ns.StoreName.MAPS, destino).setItem('k', 'do destino');
        await ns.getStoreFor(ns.StoreName.MAPS, destino).setItem('so-do-destino', 1);

        const { stores, keys } = await ns.copyAtlasDatabases(origem, destino);

        // Absoluto: dez bancos e onze chaves (uma por banco, mais a imagem).
        expect(stores).toBe(10);
        expect(keys).toBe(11);

        for (const nome of BANCOS_DE_DADO) {
            expect(await ns.getStoreFor(ns.StoreName[nome], destino).getItem('k'))
                .toBe(`da origem: ${nome}`);
            // A METADE QUE PEGA A INVERSÃO: a origem continua dizendo o que dizia. Com a direção
            // trocada, `ebgeo_maps__aaa` passaria a valer 'do destino'.
            expect(await ns.getStoreFor(ns.StoreName[nome], origem).getItem('k'))
                .toBe(`da origem: ${nome}`);
        }
        expect(await ns.getStoreFor(ns.StoreName.IMAGES, destino).getItem('img-1'))
            .toEqual(new Uint8Array([7, 8, 9]));
        // Copiar não é apagar: o que já estava no destino sob OUTRA chave permanece.
        expect(await ns.getStoreFor(ns.StoreName.MAPS, destino).getItem('so-do-destino')).toBe(1);
    });

    it('copiar um atlas VAZIO devolve zero chaves e não materializa o destino', async () => {
        const origem = ns.localScope('origem', 'aaa');
        const destino = ns.localScope('destino', 'bbb');

        const { stores, keys } = await ns.copyAtlasDatabases(origem, destino);

        // Zero é resultado legítimo, e é por isso que `duplicateLocalAtlas` não trata contagem
        // nenhuma como falha: um atlas recém-criado tem os dez bancos vazios.
        expect(stores).toBe(10);
        expect(keys).toBe(0);
        for (const nome of BANCOS_DE_DADO) {
            expect(await databaseState(ns.resolveDbName(ns.StoreName[nome], destino))).toBe('absent');
        }
    });
});

describe('copyAtlasDatabases :: alcance', () => {
    it('alcança os dez bancos de DADO e deixa a fila de saída de fora', async () => {
        const origem = ns.localScope('origem', 'aaa');
        const destino = ns.localScope('destino', 'bbb');
        const filaDaOrigem = ns.resolveDbName(ns.StoreName.OPERATION_QUEUE, origem);
        const filaDoDestino = ns.resolveDbName(ns.StoreName.OPERATION_QUEUE, destino);

        await semearOsDez(origem, 'da origem');
        await ns.getStoreFor(ns.StoreName.OPERATION_QUEUE, origem)
            .setItem('op_1', { type: 'feature/create' });

        // PREMISSA ASSERIDA: nada do destino existe ainda. Sem ela, "populado depois" não separa a
        // cópia de um banco que já estava no disco, e "ausente depois" não separa "não copiou a
        // fila" de "esta suíte nunca cria fila nenhuma".
        for (const nome of BANCOS_DE_DADO) {
            expect(await databaseState(ns.resolveDbName(ns.StoreName[nome], destino))).toBe('absent');
        }
        expect(await databaseState(filaDoDestino, { storeName: OBJECT_STORE_DA_FILA }))
            .toBe('absent');
        expect(await databaseState(filaDaOrigem, { storeName: OBJECT_STORE_DA_FILA }))
            .toBe('populated');

        await ns.copyAtlasDatabases(origem, destino);

        for (const nome of BANCOS_DE_DADO) {
            expect(await databaseState(ns.resolveDbName(ns.StoreName[nome], destino)))
                .toBe('populated');
        }
        // A fila do destino continua AUSENTE, não vazia: a cópia sequer abriu aquele banco. Um
        // dublê em memória responderia a mesma coisa para os dois estados.
        expect(await databaseState(filaDoDestino, { storeName: OBJECT_STORE_DA_FILA }))
            .toBe('absent');
        // E a op continua na fila da ORIGEM, que é o trabalho pendente do atlas original.
        expect(await ns.getStoreFor(ns.StoreName.OPERATION_QUEUE, origem).getItem('op_1'))
            .toEqual({ type: 'feature/create' });
    });

    it('não toca no banco GLOBAL, que é onde mora o registro dos dois slots', async () => {
        const origem = ns.localScope('origem', 'aaa');
        await ns.getGlobalStore().setItem('local_atlas:origem', { name: 'Meu Atlas', dbSuffix: 'aaa' });
        await semearOsDez(origem, 'da origem');

        await ns.copyAtlasDatabases(origem, ns.localScope('destino', 'bbb'));

        expect(await ns.getGlobalStore().getItem('local_atlas:origem'))
            .toEqual({ name: 'Meu Atlas', dbSuffix: 'aaa' });
        expect(await ns.getGlobalStore().getItem('local_atlas:destino')).toBeNull();
    });
});

describe('copyAtlasDatabases :: recusa', () => {
    it('recusa dois escopos de mesmo ENDEREÇO, ainda que os ids diferentes', async () => {
        const origem = ns.localScope('origem', 'aaa');
        await ns.getStoreFor(ns.StoreName.MAPS, origem).setItem('k', 'valor');

        await expect(ns.copyAtlasDatabases(origem, origem)).rejects.toThrow(/same namespace/);
        // Ids diferentes, mesmos bancos: é o que o resgate produz (`localScope` aceita o sufixo
        // `remote-<id>`), e uma recusa que olhasse o id deixaria a cópia passar por cima da origem.
        await expect(ns.copyAtlasDatabases(origem, ns.localScope('outro-id', 'aaa')))
            .rejects.toThrow(/same namespace/);

        // CONTROLE POSITIVO: mudando só o sufixo, a MESMA chamada copia. Sem ele, as recusas acima
        // ficariam verdes contra uma função que recusa tudo.
        const { keys } = await ns.copyAtlasDatabases(origem, ns.localScope('outro-id', 'bbb'));
        expect(keys).toBe(1);
        expect(await ns.getStoreFor(ns.StoreName.MAPS, origem).getItem('k')).toBe('valor');
    });

    it('escopo ausente quebra alto, em vez de copiar para lugar nenhum', async () => {
        await expect(ns.copyAtlasDatabases(null, ns.localScope('b', 'bbb')))
            .rejects.toThrow(/required/);
        await expect(ns.copyAtlasDatabases(ns.localScope('a', 'aaa'), undefined))
            .rejects.toThrow(/required/);
    });
});
