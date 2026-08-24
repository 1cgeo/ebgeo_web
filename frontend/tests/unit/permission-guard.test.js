import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock only operation-factory (sessionContext's sole external dependency)
vi.mock('../../src/js/store/sync/operation-factory.js', () => ({
    getClientId: vi.fn(() => 'mock-client-id-123')
}));

// The role-based gate applies ONLY to a connected REMOTE atlas (store-origin). Mock it so the
// online-role describes below exercise the gate (default REMOTE); the local-store describe flips it.
vi.mock('../../src/js/store/store-origin.js', () => ({ isRemoteStoreSync: vi.fn(() => true) }));

// NO mock of session-context — use the REAL singleton + ROLE_PERMISSIONS
import { checkPermission, assertPermission, GuardAction } from '../../src/js/store/sync/permission-guard.js';
import { sessionContext, UserRole } from '../../src/js/store/sync/session-context.js';
import { isRemoteStoreSync } from '../../src/js/store/store-origin.js';

beforeEach(() => {
    sessionContext._reset(); // restores OFFLINE mode with full permissions
    isRemoteStoreSync.mockReturnValue(true); // default: connected to a remote atlas (role gate active)
});

// ============================================================================
// Offline mode (default) — real sessionContext in OFFLINE mode
// ============================================================================

describe('Offline mode', () => {
    it('allows all actions when offline', () => {
        expect(checkPermission('CREATE_FEATURE')).toEqual({ allowed: true });
        expect(checkPermission('DELETE_MAP')).toEqual({ allowed: true });
        expect(checkPermission('MANAGE_USERS')).toEqual({ allowed: true });
        expect(checkPermission('LOCK_MAP')).toEqual({ allowed: true });
    });
});

// ============================================================================
// Online — Viewer role (real ROLE_PERMISSIONS lookup)
// ============================================================================

describe('Online — Viewer', () => {
    beforeEach(() => {
        sessionContext.setSession({ userId: 'user-1', role: UserRole.VIEWER });
    });

    it('blocks CREATE_FEATURE (viewer cannot edit)', () => {
        const result = checkPermission('CREATE_FEATURE');
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('viewer');
    });

    it('blocks DELETE_MAP (viewer cannot delete)', () => {
        const result = checkPermission('DELETE_MAP');
        expect(result.allowed).toBe(false);
    });

    it('blocks MANAGE_USERS', () => {
        expect(checkPermission('MANAGE_USERS').allowed).toBe(false);
    });

    it('blocks LOCK_MAP', () => {
        expect(checkPermission('LOCK_MAP').allowed).toBe(false);
    });
});

// ============================================================================
// Online — Editor role
// ============================================================================

describe('Online — Editor', () => {
    beforeEach(() => {
        sessionContext.setSession({ userId: 'user-2', role: UserRole.EDITOR });
    });

    it('allows CREATE_FEATURE (editor can edit)', () => {
        expect(checkPermission('CREATE_FEATURE')).toEqual({ allowed: true });
    });

    it('allows DELETE_FEATURE (editor can delete)', () => {
        expect(checkPermission('DELETE_FEATURE')).toEqual({ allowed: true });
    });

    it('blocks LOCK_MAP (editor cannot lock)', () => {
        const result = checkPermission('LOCK_MAP');
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('editor');
    });

    it('blocks MANAGE_USERS (editor cannot manage)', () => {
        expect(checkPermission('MANAGE_USERS').allowed).toBe(false);
    });

    // Deleting a MAP is a management action (it takes every child entity with it),
    // unlike deleting a feature. The client used to allow it and the server refused,
    // so the button was offered and the op then froze the whole outbound queue.
    // Server side of the same contract: backend sync.service.js operationDenialReason.
    it('blocks DELETE_MAP (deleting a whole map is a management action)', () => {
        expect(checkPermission('DELETE_MAP').allowed).toBe(false);
    });

    it('still allows DELETE_FEATURE (the two delete actions are distinct)', () => {
        expect(checkPermission('DELETE_FEATURE')).toEqual({ allowed: true });
    });
});

// ============================================================================
// Online — Manager role (co-Gestor)
// ============================================================================
// This block did not exist. `manager` is the tier the constitution warns about in
// two places for being silently dropped by closed-list checks, and it had zero
// coverage here: every gate could have excluded it without a single test failing.

describe('Online — Manager (co-Gestor)', () => {
    beforeEach(() => {
        sessionContext.setSession({ userId: 'user-mgr', role: UserRole.MANAGER });
    });

    it('allows DELETE_MAP (manage tier and above may delete a map)', () => {
        expect(checkPermission('DELETE_MAP')).toEqual({ allowed: true });
    });

    it('allows CREATE_FEATURE and DELETE_FEATURE', () => {
        expect(checkPermission('CREATE_FEATURE')).toEqual({ allowed: true });
        expect(checkPermission('DELETE_FEATURE')).toEqual({ allowed: true });
    });

    it('allows MANAGE_USERS (co-Gestor manages sharing)', () => {
        expect(checkPermission('MANAGE_USERS')).toEqual({ allowed: true });
    });

    it('REFUSES LOCK_MAP: travar é exclusivo do dono, e o Gestor não é o dono', () => {
        // ESTE CASO JÁ AFIRMOU O CONTRÁRIO, e afirmava uma divergência com o servidor. O bloco
        // inteiro nasceu para dar cobertura ao `manager`, que não tinha nenhuma, e o modo de
        // escrevê-lo foi fixar o comportamento observado; ninguém foi conferir o comportamento
        // contra o servidor, então o guarda passou a proteger o defeito.
        //
        // O servidor é `permission !== 'owner'` para toda escrita que mexa em `locked`
        // (`operationDenialReason`, `backend/src/modules/sync/sync.service.js`), deliberadamente
        // MAIS estreito que o de apagar, porque travar é sobreposição de coordenação e não ato
        // de gestão. O cliente dava `canLockMaps` ao Gestor, ou seja, a última linha de defesa
        // era mais frouxa que aquilo que ela defende.
        const perm = checkPermission('LOCK_MAP');
        expect(perm.allowed).toBe(false);
        expect(perm.required).toBe('canLockMaps');
    });

    it('CONTROLE: o Gestor continua alcançando o degrau de gestão que É dele', () => {
        // Sem este par, estreitar `canLockMaps` passaria idêntico se alguém tivesse estreitado o
        // Gestor inteiro por engano, que é o erro oposto e igualmente calado.
        expect(checkPermission('DELETE_MAP').allowed).toBe(true);
        expect(checkPermission('MANAGE_USERS').allowed).toBe(true);
    });

    it('e o DONO continua travando', () => {
        sessionContext.setSession({ userId: 'user-owner', role: UserRole.OWNER });
        expect(checkPermission('LOCK_MAP')).toEqual({ allowed: true });
    });

    it('e o admin GLOBAL também, porque o servidor o resolve como dono', () => {
        // `toFrontendRole` dobra o admin global para o topo da escada por atlas, então recusá-lo
        // aqui seria o erro na direção contrária: negar o que o servidor aceita.
        sessionContext.setSession({ userId: 'user-admin', role: UserRole.ADMIN });
        expect(checkPermission('LOCK_MAP')).toEqual({ allowed: true });
    });
});

// ============================================================================
// Online — Admin role
// ============================================================================

describe('Online — Admin', () => {
    beforeEach(() => {
        sessionContext.setSession({ userId: 'user-3', role: UserRole.ADMIN });
    });

    it('allows all actions', () => {
        expect(checkPermission('CREATE_FEATURE')).toEqual({ allowed: true });
        expect(checkPermission('DELETE_MAP')).toEqual({ allowed: true });
        expect(checkPermission('MANAGE_USERS')).toEqual({ allowed: true });
        expect(checkPermission('LOCK_MAP')).toEqual({ allowed: true });
    });
});

// ============================================================================
// Online — Owner role
// ============================================================================

describe('Online — Owner', () => {
    beforeEach(() => {
        sessionContext.setSession({ userId: 'user-4', role: UserRole.OWNER });
    });

    it('allows all actions', () => {
        expect(checkPermission('CREATE_FEATURE')).toEqual({ allowed: true });
        expect(checkPermission('DELETE_MAP')).toEqual({ allowed: true });
        expect(checkPermission('MANAGE_USERS')).toEqual({ allowed: true });
        expect(checkPermission('LOCK_MAP')).toEqual({ allowed: true });
    });
});

// ============================================================================
// Online — Commenter role
// ============================================================================

describe('Online — Commenter', () => {
    beforeEach(() => {
        sessionContext.setSession({ userId: 'user-c', role: UserRole.COMMENTER });
    });

    it('allows comment operations', () => {
        expect(checkPermission('CREATE_COMMENT')).toEqual({ allowed: true });
        expect(checkPermission('UPDATE_COMMENT')).toEqual({ allowed: true });
        expect(checkPermission('DELETE_COMMENT')).toEqual({ allowed: true });
    });

    it('blocks editing features/layers/maps (comments-only role)', () => {
        expect(checkPermission('CREATE_FEATURE').allowed).toBe(false);
        expect(checkPermission('UPDATE_FEATURE').allowed).toBe(false);
        expect(checkPermission('DELETE_FEATURE').allowed).toBe(false);
        expect(checkPermission('CREATE_LAYER').allowed).toBe(false);
        expect(checkPermission('CREATE_MAP').allowed).toBe(false);
    });

    it('blocks LOCK_MAP and MANAGE_USERS', () => {
        const lock = checkPermission('LOCK_MAP');
        expect(lock.allowed).toBe(false);
        expect(lock.reason).toContain('commenter');
        expect(checkPermission('MANAGE_USERS').allowed).toBe(false);
    });
});

// ============================================================================
// Public visitor link (anonymous, read-only) — setVisitorSession + remote store
// ============================================================================

describe('Public visitor link (anonymous read-only)', () => {
    beforeEach(() => {
        // A public-link visitor is always ONLINE on a connected remote atlas.
        sessionContext.setVisitorSession();
        isRemoteStoreSync.mockReturnValue(true);
    });

    it('blocks every write — and even comments', () => {
        expect(checkPermission('CREATE_FEATURE').allowed).toBe(false);
        expect(checkPermission('UPDATE_FEATURE').allowed).toBe(false);
        expect(checkPermission('DELETE_FEATURE').allowed).toBe(false);
        expect(checkPermission('DELETE_MAP').allowed).toBe(false);
        expect(checkPermission('CREATE_COMMENT').allowed).toBe(false);
        expect(checkPermission('LOCK_MAP').allowed).toBe(false);
    });
});

// ============================================================================
// Online but on the LOCAL store (logged in, NOT connected to a server atlas)
// ============================================================================

describe('Online — local store (not connected)', () => {
    beforeEach(() => {
        // A logged-in user whose global role is VIEWER, but working on the LOCAL workspace.
        sessionContext.setSession({ userId: 'u-local', role: UserRole.VIEWER });
        isRemoteStoreSync.mockReturnValue(false);
    });

    it('permits editing despite a viewer role — the local store is always editable (P1)', () => {
        expect(checkPermission('CREATE_FEATURE')).toEqual({ allowed: true });
        expect(checkPermission('DELETE_MAP')).toEqual({ allowed: true });
        expect(checkPermission('LOCK_MAP')).toEqual({ allowed: true });
    });
});

// ============================================================================
// Session transitions: offline → online → offline
// ============================================================================

describe('Session transitions', () => {
    it('offline → viewer → offline restores full permissions', () => {
        // Start offline — allowed
        expect(checkPermission('CREATE_FEATURE').allowed).toBe(true);

        // Go online as viewer — blocked
        sessionContext.setSession({ userId: 'u1', role: UserRole.VIEWER });
        expect(checkPermission('CREATE_FEATURE').allowed).toBe(false);

        // Back to offline — allowed again
        sessionContext.clearSession();
        expect(checkPermission('CREATE_FEATURE').allowed).toBe(true);
    });
});

// ============================================================================
// assertPermission
// ============================================================================

describe('assertPermission', () => {
    it('does not throw when allowed (offline)', () => {
        expect(() => assertPermission('CREATE_FEATURE')).not.toThrow();
    });

    it('throws PermissionError with correct fields when denied', () => {
        sessionContext.setSession({ userId: 'u1', role: UserRole.VIEWER });

        try {
            assertPermission('DELETE_MAP');
            expect.unreachable('should have thrown');
        } catch (error) {
            expect(error.name).toBe('PermissionError');
            expect(error.action).toBe('DELETE_MAP');
            expect(error.message).toContain('viewer');
        }
    });
});

// ============================================================================
// GuardAction mapping completeness
// ============================================================================

describe('GuardAction covers all expected actions', () => {
    it('has mappings for feature CRUD', () => {
        expect(GuardAction.CREATE_FEATURE).toBeDefined();
        expect(GuardAction.UPDATE_FEATURE).toBeDefined();
        expect(GuardAction.DELETE_FEATURE).toBeDefined();
    });

    it('has mappings for layer CRUD', () => {
        expect(GuardAction.CREATE_LAYER).toBeDefined();
        expect(GuardAction.DELETE_LAYER).toBeDefined();
    });

    it('has mappings for map operations', () => {
        expect(GuardAction.CREATE_MAP).toBeDefined();
        expect(GuardAction.DELETE_MAP).toBeDefined();
        expect(GuardAction.LOCK_MAP).toBeDefined();
    });

    it('has mappings for destructive operations', () => {
        expect(GuardAction.CLEAR_ALL_DATA).toBeDefined();
        expect(GuardAction.DELETE_BRIEFING).toBeDefined();
    });
});
