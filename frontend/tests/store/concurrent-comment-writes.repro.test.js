// Path: tests/store/concurrent-comment-writes.repro.test.js
//
// Regression: concurrent comment writes lost all but one.
//
// Same root cause as the map document (see concurrent-document-writes.repro.test.js):
// every comment operation is a read-modify-write of the WHOLE comments document
// (`getMapComments` -> mutate -> `saveMapComments`), and nothing serialized it. Measured
// before the fix: 20 concurrent `addComment` calls persisted 1.
//
// WHY THIS ONE IS WORSE THAN THE FEATURE CASE. For features the losing interleaving needs
// a programmatic burst (`Promise.all`), and no call site in `frontend/src/` does that. For
// comments the second writer is the PEER: a thread arriving over the WebSocket while the
// local user types is the ordinary case of the feature, not a corner. That is why the
// inbound path (`applyRemoteCommentOp`) takes the SAME key, and why the key test below
// matters as much as the concurrency one: two locks on different keys exclude nothing.
//
// The repository fake CLONES on read and on write, the way IndexedDB does. A fake handing
// out the same object reference makes every writer mutate one shared document and the bug
// disappears — a green that proves nothing.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ docs: new Map(), reads: 0, writes: 0 }));

/** One microtask hop per store round trip, so an unserialized interleaving is forced. */
const tick = async (n = 1) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

vi.mock('../../src/js/store/repositories/index.js', () => ({
    getRepository: () => ({
        getMapComments: vi.fn(async (map) => {
            h.reads += 1;
            await tick(1);
            const raw = h.docs.get(map);
            return raw ? JSON.parse(raw) : {};
        }),
        saveMapComments: vi.fn(async (map, collection) => {
            await tick(2);
            h.writes += 1;
            h.docs.set(map, JSON.stringify(collection));
        })
    })
}));

vi.mock('../../src/js/store/store-state-manager.js', () => ({
    default: { getCurrentMapName: () => 'TestMap', getMapId: () => 'map-uuid-123' }
}));

vi.mock('../../src/js/store/sync/session-context.js', () => ({
    sessionContext: { isAuthenticated: () => true }
}));

vi.mock('../../src/js/store/sync/index.js', () => ({
    logCommentOperation: vi.fn().mockResolvedValue(undefined),
    OperationType: { CREATE: 'CREATE', UPDATE: 'UPDATE', DELETE: 'DELETE' }
}));

vi.mock('../../src/js/store/sync/permission-guard.js', () => ({
    checkPermission: () => ({ allowed: true }),
    GuardAction: {
        CREATE_COMMENT: 'CREATE_COMMENT',
        UPDATE_COMMENT: 'UPDATE_COMMENT',
        DELETE_COMMENT: 'DELETE_COMMENT'
    }
}));

vi.mock('../../src/js/store/store-errors.js', () => ({
    StoreErrorEvents: {
        STORE_PERSIST_ERROR: 'store:persistError',
        STORE_SYNC_ERROR: 'store:syncError',
        STORE_OPERATION_BLOCKED: 'store:operationBlocked'
    },
    emitStoreError: vi.fn()
}));

vi.mock('../../src/js/store/services.js', () => ({
    getEventBus: () => ({ emit: vi.fn() })
}));

// The resolver decides whether the local name and the inbound UUID fold onto one key.
vi.mock('../../src/js/store/services/map-resolver.service.js', () => ({
    mapResolver: { getIdForName: vi.fn((name) => (name === 'TestMap' ? 'map-uuid-123' : undefined)) }
}));

import { addComment, resolveComment, updateComment } from '../../src/js/store/comment.operations.js';
import { sideDocumentKey, resetDocumentLocks } from '../../src/js/store/document-lock.js';

const MAP = 'TestMap';

/** @returns {number} comments currently persisted for MAP */
function persistedCount() {
    const raw = h.docs.get(MAP);
    return raw ? Object.keys(JSON.parse(raw)).length : 0;
}

beforeEach(() => {
    h.docs.clear();
    h.reads = 0;
    h.writes = 0;
    h.docs.set(MAP, JSON.stringify({}));
    resetDocumentLocks();
});

describe('escrita concorrente de comentario', () => {
    it('20 addComment concorrentes persistem os 20', async () => {
        await Promise.all(
            Array.from({ length: 20 }, (_, i) =>
                addComment({ lng: -43, lat: -22, text: `c${i}`, authorId: 'u1' }, MAP))
        );

        // Determinístico neste harness: sem a trava persiste 1, medido. Uma execução basta,
        // e chamar de "taxa" uma série de 20 execuções idênticas apresentaria determinismo
        // com cara de estatística.
        expect(persistedCount()).toBe(20);
        expect(h.writes).toBe(20);
    });

    it('a criação e a edição do mesmo documento não se atropelam', async () => {
        const primeiro = await addComment({ lng: -43, lat: -22, text: 'raiz', authorId: 'u1' }, MAP);

        await Promise.all([
            addComment({ lng: -44, lat: -23, text: 'outro', authorId: 'u2' }, MAP),
            updateComment({ id: primeiro.id, text: 'editado' }, MAP),
        ]);

        const doc = JSON.parse(h.docs.get(MAP));
        expect(Object.keys(doc)).toHaveLength(2);
        expect(doc[primeiro.id].text).toBe('editado');
    });

    // GUARDA DE DEADLOCK, e é o motivo de este caso existir mesmo parecendo trivial.
    // `resolveComment` é COMPOSTA: ela lê e depois chama `updateComment`, que É travado. A
    // fila não tem reentrância, então travar as duas faria a seção esperar por si mesma,
    // para sempre. Quem "uniformizar" o arquivo travando toda função exportada trava o app
    // ao resolver um comentário, e este teste é o que segura a mão.
    it('resolveComment (composta) completa, em vez de esperar por si mesma', async () => {
        const criado = await addComment({ lng: -43, lat: -22, text: 'a resolver', authorId: 'u1' }, MAP);

        await resolveComment(criado.id, true, MAP);

        const doc = JSON.parse(h.docs.get(MAP));
        expect(doc[criado.id].status).toBe('resolved');
    });
});

describe('a chave do documento de comentário', () => {
    // Duas travas em chaves diferentes não excluem nada. O lado local nomeia o mapa pelo
    // NOME e o inbound pelo UUID, então a única coisa que faz os dois se excluírem é caírem
    // na mesma chave. Se este caso quebrar, a serialização continua "funcionando" em cada
    // lado e para de valer entre eles, que é justamente o caso multiusuário.
    it('o nome local e o UUID do inbound caem na MESMA chave', () => {
        expect(sideDocumentKey('comments', 'TestMap')).toBe('comments:map-uuid-123');
        expect(sideDocumentKey('comments', 'map-uuid-123')).toBe('comments:map-uuid-123');
    });

    it('documentos diferentes do mesmo mapa não compartilham chave', () => {
        // Senão desenhar uma feição esperaria por um marcador 360 sem nenhuma razão.
        expect(sideDocumentKey('cesium3d', 'TestMap')).not.toBe(sideDocumentKey('comments', 'TestMap'));
    });
});
