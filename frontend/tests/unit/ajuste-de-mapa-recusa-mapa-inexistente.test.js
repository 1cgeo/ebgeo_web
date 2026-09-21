// Path: tests/unit/ajuste-de-mapa-recusa-mapa-inexistente.test.js

/**
 * OS TRÊS AJUSTES DE MAPA RECUSAM O MAPA INEXISTENTE COM VOZ, E DE DENTRO DA TRANSAÇÃO.
 *
 * Defeito (dívida de FORMA declarada em 2026-09-21 pelo inventário do mapa fantasma, e fechada no
 * mesmo dia): `setBaseLayer`, `updateMapPosition` e `clearMapPosition`
 * (`src/js/store/map.operations.js`) já recusavam o documento sem identidade remota, mas por uma
 * asserção que ESTOURAVA. Uma recusa que lança não passa pelo listener global de recusa, então ela
 * não chegava à pessoa com frase nenhuma: era a única recusa por mapa inexistente do store sem voz.
 *
 * DUAS propriedades, e a segunda nasceu de um conserto errado no mesmo dia:
 *   1. a recusa EMITE `map_missing` pelo emissor único de `store/mapa-inexistente.js` e devolve uma
 *      persistência vazia, em vez de lançar;
 *   2. ela fica DENTRO da transação, sobre o documento que a transação leu. A primeira versão
 *      perguntava a porta de gesto ANTES da transação, o que tirava a primeira leitura do disco de
 *      dentro do carimbo de escopo: uma troca de atlas durante aquela leitura deixava de ser
 *      detectada, e `tests/integration/map-settings-write-ahead.test.js` ("troca de escopo durante
 *      a leitura") reprovou. Nenhuma leitura de disco pode nascer entre o gate de trava e a
 *      transação.
 *
 * O COMPORTAMENTO (recusa, nada sintetizado, nada na fila) está preso em
 * `tests/integration/map-settings-write-ahead.test.js` e
 * `tests/integration/abertura-de-atlas-sobrevive-a-recuperacao.repro.test.js`; aqui fica a FORMA.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ARQUIVO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/js/store/map.operations.js');
const CODIGO = readFileSync(ARQUIVO, 'utf8').replace(/\r\n/g, '\n');

/** Body of an exported function, from its declaration to the next exported declaration. */
function corpoDe(nome) {
    const inicio = CODIGO.indexOf(`export async function ${nome}(`);
    expect(inicio, `${nome} saiu de map.operations.js: reconfira este guarda`).toBeGreaterThan(-1);
    const resto = CODIGO.slice(inicio + 1);
    const fim = resto.search(/\nexport (async )?function /);
    return resto.slice(0, fim === -1 ? undefined : fim);
}

const AJUSTES = ['setBaseLayer', 'updateMapPosition', 'clearMapPosition'];

describe('os três ajustes de mapa recusam o mapa inexistente com voz, de dentro da transação', () => {
    it('PISO: os três existem, e o emissor vem do módulo único', () => {
        expect(AJUSTES).toHaveLength(3);
        expect(CODIGO).toMatch(/import \{ recusarMapaInexistente \} from '\.\/mapa-inexistente\.js';/);
        for (const nome of AJUSTES) expect(corpoDe(nome)).toContain('runTransaction(');
    });

    it('a guarda EMITE e não lança', () => {
        const inicio = CODIGO.indexOf('function refusesMissingRemoteMap(');
        expect(inicio).toBeGreaterThan(-1);
        const corpo = CODIGO.slice(inicio, CODIGO.indexOf('\n}\n', inicio));
        expect(corpo).toContain('recusarMapaInexistente(operation, targetMap)');
        expect(corpo).not.toContain('throw ');
        // Só em escopo REMOTO: em atlas local o mapa chaveado por nome é o caminho normal.
        expect(corpo).toMatch(/tx\.scope\?\.kind === 'remote'/);
    });

    for (const nome of AJUSTES) {
        it(`${nome}: recusa com o próprio nome, DEPOIS de runTransaction abrir e sem gravar`, () => {
            const corpo = corpoDe(nome);
            const transacao = corpo.indexOf('runTransaction(');
            const recusa = corpo.search(new RegExp(
                `if \\(refusesMissingRemoteMap\\(tx, currentMapData, \\w+, '${nome}'\\)\\) return async \\(\\) => \\{\\};`));
            const intencao = corpo.indexOf('tx.recordOperation(');
            expect(recusa, `${nome} deixou de recusar o mapa inexistente`).toBeGreaterThan(-1);
            expect(recusa).toBeGreaterThan(transacao);
            // A recusa vem antes de a intenção ser registrada: mapa inexistente não enfileira nada.
            expect(recusa).toBeLessThan(intencao);
        });

        it(`${nome}: nenhuma leitura de existência nasce ANTES da transação (a forma do conserto errado)`, () => {
            const corpo = corpoDe(nome);
            const antes = corpo.slice(0, corpo.indexOf('runTransaction('));
            expect(antes).not.toMatch(/mapExistsForGesture\(|mapDocumentForGesture\(|getExistingMapData\(/);
        });
    }
});
