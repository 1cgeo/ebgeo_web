// Path: tests/unit/logout-le-a-origem-antes-do-teardown.test.js

/**
 * @fileoverview A saída da conta decide "o store era remoto" ANTES do teardown, na mesma
 * leitura que colhe o id do atlas montado, e nunca depois de um `await`.
 *
 * O DEFEITO, medido em 2026-09-05 pelo spec `browser-logout-clears-map.repro` com sonda na
 * fonte `points` e no evento `ALL_DATA_CLEARED`: numa de cada duas ou três saídas o
 * `isRemoteStoreSync()` lido DEPOIS de `logoutAndDisconnect` e dos avisos já dizia `false`
 * (a origem é marcada local no meio por outro caminho assíncrono), então `clearAllDataStore`
 * era pulado, `ALL_DATA_CLEARED` não saía, nenhuma escrita chegava às fontes vivas, e a feição
 * do SERVIDOR ficava desenhada com o store já vazio. Na saída que passava, o evento saía 150 ms
 * depois do clique e `setData(points)` escrevia zero feições.
 *
 * O QUE ESTA RÉGUA PRENDE é a ORDEM no arquivo: a leitura de `eraRemoto` vem antes do primeiro
 * `await` do teardown e junto da leitura de `mountedRemoteAtlasId()`. É régua de texto, e por
 * isso é fraca sozinha: a prova de comportamento é o spec de navegador acima, em série.
 * Controle negativo: com a leitura devolvida ao lugar antigo (depois de
 * `announceRemoteNamespaceTeardown`), os dois casos reprovam.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../../src/js/account/account.control.js'), 'utf8');

/** O trecho do logout: do id do atlas montado até o descarte dos namespaces remotos. */
function trechoDoLogout() {
    const inicio = source.indexOf('const mountedAtlasId = mountedRemoteAtlasId();');
    const fim = source.indexOf('await discardRemoteAtlasNamespaces();', inicio);
    expect(inicio, 'a leitura do atlas montado sumiu do logout').toBeGreaterThan(-1);
    expect(fim, 'o descarte dos namespaces remotos sumiu do logout').toBeGreaterThan(inicio);
    return source.slice(inicio, fim);
}

describe('a saída da conta lê a origem do store antes do teardown', () => {
    it('`eraRemoto` é lido UMA vez, antes de `logoutAndDisconnect`', () => {
        const trecho = trechoDoLogout();
        const leituras = [...trecho.matchAll(/const eraRemoto = isRemoteStoreSync\(\);/g)];
        expect(leituras, 'a leitura de eraRemoto tem de existir uma vez só').toHaveLength(1);
        const teardown = trecho.indexOf('await syncEngine.logoutAndDisconnect();');
        expect(teardown).toBeGreaterThan(-1);
        expect(leituras[0].index, 'eraRemoto lido depois do teardown volta a correr com a marcação local').toBeLessThan(teardown);
    });

    it('nenhum `await` separa a leitura do id do atlas montado da leitura da origem', () => {
        const trecho = trechoDoLogout();
        const origem = trecho.indexOf('const eraRemoto = isRemoteStoreSync();');
        // Só CÓDIGO: o comentário que explica a corrida cita a palavra `await`, e a régua lê o
        // que executa, não a prosa que o justifica.
        const antes = trecho.slice(0, origem).replace(/^[ \t]*\/\/.*$/gm, '');
        expect(antes, `um await entre as duas leituras reabre a corrida:\n${antes}`).not.toMatch(/\bawait\b/);
    });
});
