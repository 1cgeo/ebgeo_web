// Path: tests/unit/subentidade-de-mapa-declara-base.test.js
//
// A PRIMEIRA gravação de uma sub-entidade de mapa (grade, notas, posição) tem de sair como
// `update` e DECLARANDO a base observada, que é a revisão do MAPA.
//
// POR QUE ISTO É UMA RÉGUA E NÃO ESTILO. As três decidiam o tipo por "havia valor local
// antes?" (`settings.operations.js`, `map.operations.js`), então a primeira gravação de cada
// uma num mapa nascia `create`. Duas consequências, medidas em 2026-09-16:
//
// 1. No SERVIDOR, `create` de sub-entidade caía no ramo de criação de mapa, que insere a linha
//    inteira com `data.name` — que uma op de grade não carrega — e o Postgres reprovava por
//    NOT NULL antes de olhar o `ON CONFLICT`. Isso já está consertado do lado do servidor
//    (`sync-subentidade-de-mapa-como-create.test.js`), e o conserto fica: ele protege os
//    clientes já instalados.
//
// 2. No CONTRATO, `entityMutationContract` só monta o PATCH para `update`: um `create` viaja
//    sem a lista de unidades alteradas, mesmo declarando base. Sem patch, o servidor não sabe
//    QUAIS unidades a op tocou, e a disputa é julgada sobre o bloco em vez da unidade — a
//    grade passa a colidir com quem mexeu noutra unidade do mesmo mapa.
//
// O QUE ESTA RÉGUA NÃO AFIRMA, e a distinção importa porque a primeira leitura deste caso foi
// errada: o `create` NÃO desligava a detecção de conflito. A base sai de `previousData`, e o
// `previous` que estas três montam sempre carrega a revisão do mapa (`readMapRevision`), então
// a base ia declarada mesmo no `create`. O que faltava era o patch.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { entityMutationContract } from '@js/store/sync/mutation-contract.js';

const h = vi.hoisted(() => ({
    ops: [],
    gridAnterior: null,
    notasAnteriores: null,
    // O documento do mapa como o repositório o devolve, com a revisão que o servidor confirmou.
    mapa: { id: '11111111-1111-4111-8111-111111111111', name: 'Mapa principal', confirmedVersion: 7 },
}));

vi.mock('@js/store/store-transaction.js', () => ({
    runTransaction: vi.fn(async (corpo) => {
        const tx = {
            recordOperation: (entityType, opType, entityId, mapId, data, previous) => {
                h.ops.push({ entityType, opType, entityId, mapId, data, previous });
            },
            deferSync: (fn) => fn?.(),
        };
        const efeito = await corpo(tx);
        if (typeof efeito === 'function') await efeito();
    }),
}));

// O módulo de repositório e a raiz de um grafo grande (o `store.js` inteiro pende dele), então
// o dublê PARTE DO ORIGINAL e troca só as quatro leituras que este arquivo dirige. Um dublê
// que enumerasse os exports derrubaria no import quem depende dos outros.
vi.mock('@js/store/repositories/index.js', async (importOriginal) => ({
    ...(await importOriginal()),
    getGridStyleCompat: vi.fn(async () => h.gridAnterior),
    setGridStyleCompat: vi.fn(),
    getMapNotesCompat: vi.fn(async () => h.notasAnteriores),
    setMapNotesCompat: vi.fn(),
    getMapDataCompat: vi.fn(async () => h.mapa),
    updateMapDataCompat: vi.fn(),
}));

vi.mock('@js/store/sync/permission-guard.js', () => ({
    checkPermission: () => ({ allowed: true }),
    GuardAction: { UPDATE_MAP: 'UPDATE_MAP' },
}));

// `isTargetMapLocked` entrou em 2026-09-21 (ponto N3): as duas operacoes deste arquivo passaram a
// perguntar pela trava do mapa ALVO, lida do disco. Aqui ela fica aberta, porque o assunto e a
// base observada e nao o gate.
vi.mock('@js/store/map.operations.js', () => ({ isTargetMapLocked: async () => false }));
vi.mock('@js/store/services/map-resolver.service.js', () => ({
    mapResolver: { resolveToId: (x) => x },
}));
vi.mock('@js/store/store-state-manager.js', () => ({ default: { getCurrentMapName: () => 'Mapa principal' } }));
vi.mock('@js/store/store-errors.js', () => ({
    StoreErrorEvents: { STORE_OPERATION_BLOCKED: 'blocked' },
    emitStoreError: vi.fn(),
}));
vi.mock('@js/store/sync/image-sync.js', () => ({ fetchImageBlob: vi.fn() }));
vi.mock('@js/catalog/catalog.constants.js', () => ({ CATALOG_ITEM_TYPES: {} }));
vi.mock('@js/store/catalog.operations.js', () => ({ getCatalogLayers: vi.fn() }));

const MAPA = 'Mapa principal';

beforeEach(() => {
    h.ops = [];
    h.gridAnterior = null;
    h.notasAnteriores = null;
});

describe('a primeira gravação de uma sub-entidade de mapa', () => {
    it('a grade sai como update, e não como create', async () => {
        const { setGridStyle } = await import('@js/store/settings.operations.js');
        await setGridStyle(MAPA, { format: 'utm', visible: true });

        expect(h.ops).toHaveLength(1);
        expect(h.ops[0].entityType).toBe('gridStyle');
        expect(h.ops[0].opType).toBe('update');
    });

    it('a grade declara a revisão do MAPA como base observada', async () => {
        const { setGridStyle } = await import('@js/store/settings.operations.js');
        await setGridStyle(MAPA, { format: 'utm', visible: true });

        // A base é o que torna a escrita disputável: sem ela o servidor não tem contra o que
        // comparar, e a op vira "o último que chega manda".
        const { previous, data, opType } = h.ops[0];
        const contrato = entityMutationContract('gridStyle', opType, data, previous);
        expect(contrato.baseVersion).toBe(7);
    });

    it('a grade viaja com o PATCH das unidades que mudaram', async () => {
        // O que o `create` custava: `entityMutationContract` só monta patch para `update`, e sem
        // patch a disputa é julgada sobre o bloco, não sobre a unidade.
        h.gridAnterior = null;
        const { setGridStyle } = await import('@js/store/settings.operations.js');
        await setGridStyle(MAPA, { format: 'utm', visible: true });

        const { previous, data, opType } = h.ops[0];
        const contrato = entityMutationContract('gridStyle', opType, data, previous);
        expect(contrato.patch, 'o patch nao pode ser nulo na primeira gravacao').not.toBeNull();
        const caminhos = contrato.patch.map((p) => p.path.join('.')).sort();
        expect(caminhos).toContain('format');
        expect(caminhos).toContain('visible');
    });

    it('as notas saem como update na primeira gravação', async () => {
        const { setMapNotes } = await import('@js/store/settings.operations.js');
        await setMapNotes(MAPA, { title: 'Cota 300', description: 'Do reconhecimento' });

        expect(h.ops).toHaveLength(1);
        expect(h.ops[0].entityType).toBe('mapNotes');
        expect(h.ops[0].opType).toBe('update');
    });

    it('a segunda gravação continua update, e o tipo não depende do que havia antes', async () => {
        // O CONTROLE: o tipo tem de ser o mesmo nos dois estados. Uma régua que só medisse o
        // caso sem valor anterior passaria com a condicional invertida.
        h.gridAnterior = { format: 'latlong', visible: false, confirmedVersion: 7 };
        const { setGridStyle } = await import('@js/store/settings.operations.js');
        await setGridStyle(MAPA, { format: 'utm', visible: true });

        expect(h.ops[0].opType).toBe('update');
    });
});
