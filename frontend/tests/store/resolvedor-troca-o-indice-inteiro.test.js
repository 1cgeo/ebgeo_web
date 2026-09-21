// Path: tests/store/resolvedor-troca-o-indice-inteiro.test.js

/**
 * @fileoverview Regressao D1: a marca do resolvedor que nunca voltava depois de um retrato.
 *
 * A CAUSA. `mapResolver.clear()` faz DUAS coisas: zera os dois indices e derruba a marca
 * (`_initialized = false`). So' `initialize()` a repunha. A ativaçao de um retrato do servidor
 * (`applyRemoteSnapshot`, `store/sync/remote-operation-handler.js`) limpava e re-registrava par a
 * par, sem repor a marca: o indice ficava CHEIO e a marca FALSA. Como TODA abertura de atlas de
 * servidor aplica um retrato, a marca ficava falsa pelo resto da sessao remota.
 *
 * O QUE A MARCA FALSA CUSTA, e e' por isso que ela nao e' um detalhe de contabilidade: tres
 * leitores mudam de comportamento com ela. `LocalRepository.getMap` e `_resolveMapKey` desligam a
 * via rapida nome->id e caem na varredura que casa `mapData.name` (uma leitura de documento
 * INTEIRO por mapa, e, pior, uma resposta VAZIA quando o nome procurado nao e' mais o nome de
 * documento nenhum); e `_resolveSettingsKey` (`store/repositories/index.js`) passa a gravar a
 * contagem de cores sob o NOME do mapa em vez do id.
 *
 * O CONSERTO e' tornar a troca do indice UMA operaçao: `replaceAll` limpa, registra e marca. O
 * par `clear()` + laço de `registerMap` deixa de existir como forma no codigo, que e' o que
 * impede a proxima copia do mesmo defeito.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createMapResolver } from '../../src/js/store/services/map-resolver.service.js';

const ID_A = '11111111-2222-4333-8444-555555555555';
const ID_B = '66666666-7777-4888-8999-aaaaaaaaaaaa';

let resolver;

beforeEach(() => {
    resolver = createMapResolver();
});

describe('D1 — replaceAll troca o indice inteiro E marca inicializado', () => {
    it('marca inicializado, o que `clear()` + registerMap nao fazia', () => {
        resolver.replaceAll([['Mapa Alfa', ID_A], ['Mapa Bravo', ID_B]]);

        expect(resolver.isInitialized).toBe(true);
        expect(resolver.size).toBe(2);
        expect(resolver.resolveToId('Mapa Alfa')).toBe(ID_A);
        expect(resolver.resolveToName(ID_B)).toBe('Mapa Bravo');
    });

    it('o CONTROLE: a forma antiga deixa o indice cheio e a marca falsa', () => {
        // Este caso nao mede o conserto, mede o DEFEITO, e e' ele que explica por que a troca
        // precisa ser uma chamada so'. Se alguem reescrever a ativaçao do retrato com as duas
        // linhas, e' exatamente este estado que volta.
        resolver.clear();
        resolver.registerMap('Mapa Alfa', ID_A);

        expect(resolver.size).toBe(1);
        expect(resolver.isInitialized).toBe(false);
    });

    it('SUBSTITUI, nao soma: o que estava no indice antes some', () => {
        resolver.replaceAll([['Mapa Antigo', ID_A]]);
        resolver.replaceAll([['Mapa Novo', ID_B]]);

        expect(resolver.size).toBe(1);
        expect(resolver.resolveToId('Mapa Antigo')).toBe('Mapa Antigo');
        expect(resolver.resolveToName(ID_A)).toBe(ID_A);
        expect(resolver.resolveToId('Mapa Novo')).toBe(ID_B);
    });

    it('uma lista VAZIA zera o indice e ainda assim marca inicializado', () => {
        // O atlas de servidor sem mapa nenhum. "Nao ha' mapa" e' uma resposta COMPLETA sobre o
        // conteudo do retrato, e derrubar a marca aqui reabriria o defeito pelo caso de borda.
        resolver.registerMap('Mapa Alfa', ID_A);

        resolver.replaceAll([]);

        expect(resolver.size).toBe(0);
        expect(resolver.isInitialized).toBe(true);
    });

    it('descarta o par sem nome e o par sem id, e nao estoura com entrada torta', () => {
        // O documento de mapa pode chegar sem `name` (registro vindo de um par antigo), e
        // `registerMap(undefined, id)` cravaria a chave `undefined` nos dois indices.
        resolver.replaceAll([
            ['Mapa Alfa', ID_A],
            [null, ID_B],
            ['', ID_B],
            ['Mapa Sem Id', null],
            undefined,
        ]);

        expect(resolver.getAllNames()).toEqual(['Mapa Alfa']);
        expect(resolver.getAllIds()).toEqual([ID_A]);
        expect(resolver.isInitialized).toBe(true);
    });

    it('id REPETIDO segue a mesma semantica de dois registerMap em sequencia', () => {
        // Nao ha' politica nova aqui de proposito: os DOIS nomes continuam resolvendo para o id
        // (e' o que `initialize` ja' produz quando `mapOrder` traz um alias), e o id resolve para
        // o ULTIMO nome registrado. Inventar uma regra diferente mudaria a resoluçao de nome sem
        // que nenhum chamador tivesse pedido.
        resolver.replaceAll([['Primeiro', ID_A], ['Segundo', ID_A]]);

        expect(resolver.resolveToId('Primeiro')).toBe(ID_A);
        expect(resolver.resolveToId('Segundo')).toBe(ID_A);
        expect(resolver.resolveToName(ID_A)).toBe('Segundo');
    });

    it('aceita qualquer iteravel de pares, inclusive um Map de id->documento mapeado', () => {
        // A forma que o chamador real usa: `[...maps].map(([id, doc]) => [doc.name, id])`.
        const doServidor = new Map([[ID_A, { name: 'Mapa Alfa' }], [ID_B, { name: 'Mapa Bravo' }]]);

        resolver.replaceAll([...doServidor].map(([id, doc]) => [doc.name, id]));

        expect(resolver.isInitialized).toBe(true);
        expect(resolver.resolveToId('Mapa Bravo')).toBe(ID_B);
    });

    it('`clear()` continua derrubando a marca: ele e o oposto, e nao o irmao', () => {
        resolver.replaceAll([['Mapa Alfa', ID_A]]);

        resolver.clear();

        expect(resolver.isInitialized).toBe(false);
        expect(resolver.size).toBe(0);
    });
});
