// Path: tests/unit/sync-trace-espelha-backend.test.js

/**
 * @fileoverview O vocabulário de estágios do SyncLedger é COMPARTILHADO entre os dois pacotes, e
 * até 2026-08-17 nada verificava isso.
 *
 * POR QUE ISTO EXISTE. `frontend/src/js/store/sync/diag/trace-stages.js` é a fonte e
 * `backend/src/utils/sync-trace.js` é um ESPELHO; os dois `@fileoverview` dizem "MUST stay in
 * lockstep" e a constituição repete ("estágio novo entra nos dois no mesmo commit"). Isso era
 * prosa: nenhum teste importava os dois arquivos, e a promessa valia o quanto alguém lembrasse
 * dela. O modo de falha não é barulhento, é o pior tipo: o merger do ledger valida o `stage` de
 * cada span contra o enum do frontend e SINALIZA o desconhecido, então um estágio novo só no
 * backend vira ruído de diagnóstico exatamente quando alguém está diagnosticando.
 *
 * O precedente da casa é `calibracao-espelha-marcador-andar.test.js`, que importa as duas cópias
 * do projetor 360 e exige o mesmo número. A forma é copiada de lá, inclusive a parte que mais
 * importa: cada bloco leva asserção ABSOLUTA além da comparação, porque comparar as duas cópias
 * só uma com a outra deixa passar duas cópias erradas do mesmo jeito.
 *
 * ALCANCE, para não ser lido como cobertura completa: ele cobre o VOCABULÁRIO (nomes de estágio e
 * de outcome), nunca a semântica. Um `server.applied` emitido no lugar errado passa aqui.
 */

import { describe, it, expect } from 'vitest';
import { TraceStage, TraceOutcome } from '../../src/js/store/sync/diag/trace-stages.js';
import {
    TraceStage as BackendTraceStage,
    TraceOutcome as BackendTraceOutcome,
} from '../../../backend/src/utils/sync-trace.js';

/** Estágios do frontend que descrevem o SERVIDOR — é esse recorte que o backend espelha. */
const estagiosDeServidorNoFrontend = Object.values(TraceStage).filter((v) => v.startsWith('server.'));

describe('o vocabulário de trace do backend espelha o do frontend', () => {
    // PISO. Sem ele, um import que resolvesse para um objeto vazio (arquivo movido, export
    // renomeado) reportaria verde comparando dois conjuntos vazios, que é a cobertura vazia que a
    // constituição manda caçar.
    it('os dois enums foram de fato carregados (piso contra comparação vazia)', () => {
        expect(Object.keys(TraceStage).length).toBeGreaterThan(10);
        expect(Object.keys(BackendTraceStage).length).toBeGreaterThan(0);
        expect(Object.keys(BackendTraceOutcome).length).toBeGreaterThan(0);
        expect(estagiosDeServidorNoFrontend.length).toBeGreaterThan(0);
    });

    // ABSOLUTO, não só comparativo: se os dois lados forem renomeados juntos para outra coisa, o
    // par continua consistente e este caso cai — que é o ponto, porque o nome do estágio também é
    // contrato com quem lê o ledger.
    it('os três estágios de servidor têm os nomes esperados, dos DOIS lados', () => {
        expect([...estagiosDeServidorNoFrontend].sort())
            .toEqual(['server.applied', 'server.broadcast', 'server.inserted']);
        expect(Object.values(BackendTraceStage).sort())
            .toEqual(['server.applied', 'server.broadcast', 'server.inserted']);
    });

    // A comparação com dentes: pega as DUAS direções de deriva (estágio de servidor acrescentado
    // só no frontend, e estágio acrescentado só no backend).
    it('o conjunto de estágios do backend é exatamente o recorte `server.*` do frontend', () => {
        expect(Object.values(BackendTraceStage).sort())
            .toEqual([...estagiosDeServidorNoFrontend].sort());
    });

    it('todo outcome do backend existe no enum do frontend', () => {
        const doFrontend = new Set(Object.values(TraceOutcome));
        const orfaos = Object.entries(BackendTraceOutcome)
            .filter(([, valor]) => !doFrontend.has(valor))
            .map(([chave, valor]) => `${chave} = '${valor}'`);

        expect(orfaos, 'outcome(s) do backend ausentes de trace-stages.js — o merger os trataria'
            + ` como desconhecidos:\n  ${orfaos.join('\n  ')}\n`).toEqual([]);
    });

    it('os outcomes do backend são os quatro que um estágio de servidor pode carregar', () => {
        expect(Object.values(BackendTraceOutcome).sort())
            .toEqual(['failed', 'idempotent', 'no-effect', 'ok']);
    });
});
