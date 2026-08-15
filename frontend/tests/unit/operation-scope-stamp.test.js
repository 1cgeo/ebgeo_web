// Path: tests/unit/operation-scope-stamp.test.js

/**
 * The operation envelope carries the atlas it was BORN IN.
 *
 * Two fields, because two questions: `scopeSuffix` is the address on disk (who may read
 * the op back) and `atlasId` is the server atlas (what the backend can check). They are
 * equal-ish for a connected atlas and DIVERGE on the rescued slot, which is the case the
 * rule exists for: `adoptRemoteAtlasAsLocal` keeps a `remote-<id>` suffix on a LOCAL slot,
 * so those ten databases are simultaneously a local atlas and the mirror of a server one.
 *
 * The stamp is read in the FACTORY and not in the dispatcher: the dispatcher's retry paths
 * rebuild the op ~2 s after the gesture, and a switch of atlas in between would stamp the
 * op with the atlas the user moved to.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    activateScope,
    clearActiveScope,
    localScope,
    remoteScope,
    LEGACY_DB_SUFFIX,
} from '../../src/js/store/atlas-namespace.js';
import { createOperation, createBatchOperations } from '../../src/js/store/sync/operation-factory.js';

const OP = ['feature', 'create', 'feat-1', '4a22f7df-df6d-47df-80bb-f26df86d31ec'];

describe('operation-factory — carimbo do escopo de origem', () => {
    beforeEach(() => clearActiveScope());

    it('atlas de SERVIDOR: endereço remote-<id> e o id do atlas', () => {
        activateScope(remoteScope('AAA111'));
        const op = createOperation(...OP, { nome: 'Ponto' });

        expect(op.scopeSuffix).toBe('remote-AAA111');
        expect(op.atlasId).toBe('AAA111');
    });

    it('slot LOCAL comum: tem endereço e NÃO tem atlas de servidor', () => {
        activateScope(localScope('slot-2', 'abc123'));
        const op = createOperation(...OP);

        expect(op.scopeSuffix).toBe('abc123');
        expect(op.atlasId).toBeNull();
    });

    it('slot LOCAL adotado pelo resgate: o atlas de origem é derivado do endereço', () => {
        // O caso que faz os dois campos existirem: o slot é local (o usuário deslogou com
        // trabalho na fila) e mora nos MESMOS bancos do atlas de servidor de origem.
        activateScope(localScope('slot-resgatado', 'remote-BBB222'));
        const op = createOperation(...OP);

        expect(op.scopeSuffix).toBe('remote-BBB222');
        expect(op.atlasId).toBe('BBB222');
    });

    it('slot LEGADO: o endereço é a string VAZIA, que é um endereço, não a ausência de um', () => {
        activateScope(localScope('slot-1', LEGACY_DB_SUFFIX));
        const op = createOperation(...OP);

        // Colapsar '' em null faria a op do slot legado ser lida como "sem dono", isto é,
        // legível de qualquer atlas — exatamente o vazamento que o carimbo existe para fechar.
        expect(op.scopeSuffix).toBe('');
        expect(op.scopeSuffix).not.toBeNull();
        expect(op.atlasId).toBeNull();
    });

    it('sem escopo montado: os dois campos são null (e a op continua válida)', () => {
        const op = createOperation(...OP);

        expect(op.scopeSuffix).toBeNull();
        expect(op.atlasId).toBeNull();
        expect(typeof op.id).toBe('string');
        expect(op.id.length).toBeGreaterThan(0);
    });

    it('lote: todas as ops nascem no MESMO escopo', () => {
        activateScope(remoteScope('CCC333'));
        const ops = createBatchOperations([
            { entityType: 'feature', operationType: 'create', entityId: 'a', mapId: 'm' },
            { entityType: 'feature', operationType: 'create', entityId: 'b', mapId: 'm' },
            { entityType: 'feature', operationType: 'create', entityId: 'c', mapId: 'm' },
        ]);

        expect(ops).toHaveLength(3);
        expect(ops.every(o => o.scopeSuffix === 'remote-CCC333')).toBe(true);
        expect(ops.every(o => o.atlasId === 'CCC333')).toBe(true);
    });

    it('a troca de atlas muda o carimbo das ops SEGUINTES, e só delas', () => {
        activateScope(remoteScope('DDD444'));
        const antes = createOperation(...OP);
        const loteAntes = createBatchOperations([
            { entityType: 'feature', operationType: 'create', entityId: 'a', mapId: 'm' },
        ]);

        activateScope(remoteScope('EEE555'));
        const depois = createOperation(...OP);

        expect(antes.atlasId).toBe('DDD444');
        expect(loteAntes[0].atlasId).toBe('DDD444');
        expect(depois.atlasId).toBe('EEE555');
    });
});
