import { describe, it, expect, vi } from 'vitest';
import { ApiClient } from '../../src/js/store/sync/api-client.js';

// Regression: the admin catalog tab already passed { orgId } to setSv360ProjectStatus and
// deleteSv360Project, but the methods declared no such parameter — and JavaScript drops an
// extra argument in silence. The request went out unscoped, so a GLOBAL admin acting on a slug
// that exists in two organizations got the backend's "ambiguous slug" error and could never
// finish the action. The backend accepts the scope as `?orgId=<uuid>` on both routes
// (`orgScopeQuerySchema`, backend/src/modules/streetview360/sv360.routes.js).

function resp(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => (body === undefined ? '' : JSON.stringify(body)),
    };
}

function makeClient() {
    const fetchImpl = vi.fn(async () => resp(200, { data: { ok: true } }));
    const api = new ApiClient({ baseUrl: 'http://api.test/api/v1', fetch: fetchImpl });
    api.setTokens({ accessToken: 'tok' });
    return { api, fetchImpl };
}

/** Strips the base URL so the assertions read as paths. */
function pathOf(fetchImpl, call = 0) {
    return fetchImpl.mock.calls[call][0].replace('http://api.test/api/v1', '');
}

describe('ApiClient — 360 admin writes carry the organization scope', () => {
    it('appends ?orgId to the status PATCH', async () => {
        const { api, fetchImpl } = makeClient();

        await api.setSv360ProjectStatus('rota-01', 'disabled', { orgId: '00000000-0000-0000-0000-000000000001' });

        expect(pathOf(fetchImpl)).toBe(
            '/sv360/admin/projects/rota-01/status?orgId=00000000-0000-0000-0000-000000000001'
        );
        const [, opts] = fetchImpl.mock.calls[0];
        expect(opts.method).toBe('PATCH');
        expect(JSON.parse(opts.body)).toEqual({ status: 'disabled' });
    });

    it('appends ?orgId to the DELETE', async () => {
        const { api, fetchImpl } = makeClient();

        await api.deleteSv360Project('rota-01', { orgId: '00000000-0000-0000-0000-000000000001' });

        expect(pathOf(fetchImpl)).toBe(
            '/sv360/admin/projects/rota-01?orgId=00000000-0000-0000-0000-000000000001'
        );
        expect(fetchImpl.mock.calls[0][1].method).toBe('DELETE');
    });

    // Edge case: an org-scoped admin has a single organization and sends nothing. The options
    // object may be absent entirely — destructuring must not throw and no query may be added.
    it('omits the query string when no options object is given at all', async () => {
        const { api, fetchImpl } = makeClient();

        await api.setSv360ProjectStatus('rota-01', 'enabled');
        await api.deleteSv360Project('rota-01');

        expect(pathOf(fetchImpl, 0)).toBe('/sv360/admin/projects/rota-01/status');
        expect(pathOf(fetchImpl, 1)).toBe('/sv360/admin/projects/rota-01');
    });

    // Edge case: a row with no organization_id yields undefined/empty — treated as "unscoped",
    // never as the literal string "undefined" in the URL.
    it('omits the query string for undefined and empty orgId', async () => {
        const { api, fetchImpl } = makeClient();

        await api.setSv360ProjectStatus('rota-01', 'enabled', { orgId: undefined });
        await api.deleteSv360Project('rota-01', { orgId: '' });

        expect(pathOf(fetchImpl, 0)).toBe('/sv360/admin/projects/rota-01/status');
        expect(pathOf(fetchImpl, 1)).toBe('/sv360/admin/projects/rota-01');
    });

    // Edge case: both the slug and the scope are encoded, so a value with reserved characters
    // cannot smuggle extra query parameters into the URL.
    it('percent-encodes the slug and the orgId', async () => {
        const { api, fetchImpl } = makeClient();

        await api.deleteSv360Project('rota 01&x', { orgId: 'a b&status=enabled' });

        expect(pathOf(fetchImpl)).toBe(
            '/sv360/admin/projects/rota%2001%26x?orgId=a%20b%26status%3Denabled'
        );
    });
});
