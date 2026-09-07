// Path: tests/store/pisos-de-migracao.test.js

/**
 * @fileoverview Os DOIS pisos abaixo dos quais um repositorio e DESTRUIDO, e nao migrado.
 *
 * `MIN_SCHEMA_VERSION` (`store/repository.utils.js`) e o gatilho de `clearLegacyStores()` em
 * `checkAndCleanLegacyData`, e `MIN_MIGRATABLE_VERSION` (`store/migration/migration.service.js`)
 * e o de `isTooOldToMigrate`. Os dois valem '1.3'.
 *
 * POR QUE ISTO PRECISA DE TESTE, sendo duas constantes que ninguem tem motivo para mexer: subir
 * um piso PARECE arrumacao. Enquanto a linha corrente foi 2.3 e depois 3.0, um piso em 2.0 leria
 * como "so aceitamos o que ja e da era do Atlas" e nao romperia nenhum teste existente, porque
 * nenhum deles semeia um repositorio de v1. So que instalacoes REAIS estao logo acima do piso, e
 * nao por serem antigas: o "Limpar Todos os Dados" da outra linha do produto carimba a constante
 * LEGADA dela, `'1.7'`, num repositorio cujo registro de atlas continua em 2.4. Um piso em 2.0
 * apagaria esse atlas inteiro no primeiro boot depois da travessia, sem erro, com a mensagem
 * "Data will be cleared" que hoje nem apaga nada.
 *
 * Por isso as asserções aqui sao de DUAS naturezas, e as duas fazem falta: o valor literal, que
 * reprova a subida no instante em que ela e escrita, e o COMPORTAMENTO sobre a entrada real, que
 * diz o que o valor compra.
 */

import { describe, it, expect } from 'vitest';
import { MIN_SCHEMA_VERSION, MAX_SCHEMA_VERSION, SCHEMA_VERSION, compareVersions } from '@store/repository.utils.js';
import { isTooOldToMigrate } from '@store/migration/migration.service.js';

/** O carimbo que a outra linha do produto deixa no settings ao limpar todos os dados. */
const CARIMBO_DA_LIMPEZA = '1.7';

describe('os pisos de migracao ficam em 1.3', () => {
    it('MIN_SCHEMA_VERSION vale exatamente 1.3', () => {
        expect(MIN_SCHEMA_VERSION).toBe('1.3');
    });

    it('MIN_MIGRATABLE_VERSION vale exatamente 1.3, lido pelo comportamento de isTooOldToMigrate', () => {
        // A constante e privada do modulo de proposito (ninguem fora dele decide o piso), entao
        // ela e afirmada pela unica funcao que a le. O par 1.2/1.3 fixa o valor: qualquer outro
        // piso muda um dos dois lados.
        expect(isTooOldToMigrate('1.2')).toBe(true);
        expect(isTooOldToMigrate('1.3')).toBe(false);
    });

    it('a instalacao REAL que a outra linha produz fica acima dos dois pisos', () => {
        // O caso que os pisos existem para nao alcancar. Com um piso em 2.0 as duas linhas
        // abaixo invertem, e o efeito e a destruicao de um atlas de 805 feicoes.
        expect(compareVersions(CARIMBO_DA_LIMPEZA, MIN_SCHEMA_VERSION) >= 0).toBe(true);
        expect(isTooOldToMigrate(CARIMBO_DA_LIMPEZA)).toBe(false);
    });

    it('nenhum dos dois pisos alcanca a faixa legada inteira (1.3 a 1.7)', () => {
        // A faixa que `SCHEMA_VERSION`/`MAX_SCHEMA_VERSION` declaram como legado suportado tem
        // de caber acima dos pisos, senao "suportado" e so uma palavra no comentario.
        expect(compareVersions(SCHEMA_VERSION, MIN_SCHEMA_VERSION) >= 0).toBe(true);
        expect(compareVersions(MAX_SCHEMA_VERSION, MIN_SCHEMA_VERSION) >= 0).toBe(true);
        expect(isTooOldToMigrate(MAX_SCHEMA_VERSION)).toBe(false);
    });

    it('um repositorio novo (sem carimbo) NAO conta como velho demais', () => {
        // Controle negativo do piso: null e "instalacao nova", nunca "anterior a 1.3". Sem esta
        // linha um piso implementado como `compareVersions(null, ...) < 0` passaria despercebido
        // e limparia toda instalacao nova.
        expect(isTooOldToMigrate(null)).toBe(false);
        expect(isTooOldToMigrate('')).toBe(false);
    });
});
