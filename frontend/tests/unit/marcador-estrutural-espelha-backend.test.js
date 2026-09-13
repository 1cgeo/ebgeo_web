// Path: tests/unit/marcador-estrutural-espelha-backend.test.js

/**
 * @fileoverview O VOCABULÁRIO DOS MARCADORES ESTRUTURAIS É COMPARTILHADO ENTRE OS DOIS PACOTES, e
 * desde a decisão D6 ele é o contrato de FIO: o servidor publica cada uma das quatro exceções REST
 * pelo nome dela, e é por esse nome que o cliente decide tirar um snapshot em vez de tentar
 * aplicar uma op que não descreve entidade nenhuma.
 *
 * O MODO DE FALHA QUE ESTE ARQUIVO EXISTE PARA PEGAR É MUDO NOS DOIS SENTIDOS. Um marcador novo só
 * no BACKEND chega ao par como tipo desconhecido, e o roteador de entrada
 * (`remote-operation-handler.js`) ignora tipo desconhecido de propósito (avisa uma vez, avança o
 * cursor e segue): a versão do atlas anda, o snapshot não é tomado e o par fica velho sem uma
 * linha vermelha em lugar nenhum. Um nome só no FRONTEND é inerte, que é o estado menos grave e
 * ainda assim uma mentira na lista. Nenhum dos dois produz erro.
 *
 * A FORMA É A DE `sync-trace-espelha-backend.test.js`: importar os DOIS lados no mesmo processo e
 * comparar, com asserção ABSOLUTA em cada bloco além da comparação, porque comparar as duas cópias
 * só uma com a outra deixa passar duas cópias erradas do mesmo jeito. Isso só é possível porque a
 * lista do cliente mora num módulo FOLHA (`store/sync/structural-markers.js`): dentro do
 * `sync-engine.js`, que arrasta a store, ela não carregaria em node puro.
 *
 * ALCANCE, para não ser lido como cobertura completa: aqui está o VOCABULÁRIO. Que o cliente
 * resincronize ao ver um deles é `frontend/tests/integration/sync-engine.test.js`; que o servidor
 * publique o nome honesto pela porta pública é `frontend/tests/e2e/marcador-estrutural.e2e.test.js`.
 */

import { describe, it, expect } from 'vitest';
import { STRUCTURAL_RESYNC_OPS, isStructuralMarker } from '../../src/js/store/sync/structural-markers.js';
import {
    STRUCTURAL_MARKER,
    MARCADORES_PUBLICADOS,
} from '../../../backend/src/modules/sync/structural-marker.js';

describe('o vocabulário de marcador estrutural espelha o do backend', () => {
    // PISO. Sem ele, um import que resolvesse para objeto vazio (arquivo movido, export renomeado)
    // reportaria verde comparando dois conjuntos vazios.
    it('os dois lados foram de fato carregados (piso contra comparação vazia)', () => {
        expect(STRUCTURAL_RESYNC_OPS.size).toBeGreaterThan(0);
        expect(Object.keys(STRUCTURAL_MARKER).length).toBeGreaterThan(0);
        expect(MARCADORES_PUBLICADOS.length).toBe(Object.keys(STRUCTURAL_MARKER).length);
    });

    // ABSOLUTO, e não só comparativo: renomear os dois lados juntos mantém o par consistente e
    // derruba este caso, que é o ponto, porque o nome também é contrato com o log e com quem o lê.
    it('os quatro nomes são os esperados, dos DOIS lados', () => {
        const esperado = ['atlas_clone', 'atlas_import', 'map_duplicate', 'map_merge'];
        expect([...STRUCTURAL_RESYNC_OPS].sort()).toEqual(esperado);
        expect([...MARCADORES_PUBLICADOS].sort()).toEqual(esperado);
    });

    // A comparação com dentes: pega as DUAS direções de deriva.
    it('o que o servidor publica é exatamente o que o cliente resincroniza', () => {
        expect([...MARCADORES_PUBLICADOS].sort()).toEqual([...STRUCTURAL_RESYNC_OPS].sort());
        for (const nome of MARCADORES_PUBLICADOS) {
            expect(isStructuralMarker({ entityType: nome }), `${nome} precisa disparar resync`).toBe(true);
        }
    });

    // CONTROLE NEGATIVO. Sem ele, um predicado que respondesse `true` para tudo passaria nos três
    // casos acima, e o par resincronizaria a cada op de feição.
    it('um tipo comum NÃO é marcador', () => {
        for (const tipo of ['feature', 'map', 'layer', 'group_feature', 'map_meta', undefined, null]) {
            expect(isStructuralMarker({ entityType: tipo })).toBe(false);
        }
        expect(isStructuralMarker(null)).toBe(false);
        expect(isStructuralMarker(undefined)).toBe(false);
    });
});
