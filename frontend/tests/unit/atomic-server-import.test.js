import { beforeEach, describe, expect, it, vi } from 'vitest';
const disk = vi.hoisted(() => new Map());
const persistence = vi.hoisted(() => ({ fail: false }));
vi.mock('@store/atlas-namespace.js', () => ({ getGlobalStore: () => ({
    getItem: async key => disk.get(key),
    setItem: async (key, value) => { if (persistence.fail) throw new Error('quota'); disk.set(key, value); },
    removeItem: async key => disk.delete(key),
}) }));
import { atomicServerImport } from '@js/import_export/atomic-server-import.js';
import { ApiClient } from '@store/sync/api-client.js';

const token = owner => `header.${btoa(JSON.stringify({ sub: owner }))}.signature`;
const images = id => [{ localId: id, mimeType: 'image/png', data: 'same bytes', filename: 'same.png' }];
const source = { maps: { A: {} } };
function server() {
    const attempts = new Map();
    const state = { owner: 'owner', failUpload: false, lostCommit: false, offline: false, publications: 0, uploads: [] };
    const client = { baseUrl: '/api/v1', getAccessToken: () => token(state.owner), _request: vi.fn(async (method, path, { body }) => {
        if (state.offline) throw new Error('offline');
        if (path === '/atlas/imports') {
            attempts.set(body.id, { id: body.id, owner: state.owner, imageIds: body.imageIds, result: null });
            return attempts.get(body.id);
        }
        const id = path.split('/')[3];
        const attempt = attempts.get(id);
        if (!attempt || attempt.owner !== state.owner) throw Object.assign(new Error('absent'), { status: 404 });
        if (method === 'GET') return structuredClone(attempt);
        if (path.endsWith('/images')) {
            if (state.failUpload) throw new Error('upload lost');
            state.uploads.push(body.images[0].localId);
            return {};
        }
        if (!attempt.result) attempt.result = { id: `atlas-${++state.publications}` };
        if (state.lostCommit) { state.offline = true; throw new Error('lost response'); }
        return attempt.result;
    }) };
    return { client, state, attempts };
}
beforeEach(() => { disk.clear(); persistence.fail = false; });
describe('resumable atomic transport', () => {
    it('recovers a committed result after lost response and reload without publishing twice', async () => {
        const { client, state } = server();
        state.lostCommit = true;
        await expect(atomicServerImport(client, {}, images('first'), source)).rejects.toMatchObject({ stage: 'preparation' });
        expect(state.publications).toBe(1);
        expect(disk.size).toBe(1);
        state.offline = false;
        state.lostCommit = false;
        vi.resetModules();
        const reloaded = (await import('@js/import_export/atomic-server-import.js')).atomicServerImport;
        expect(await reloaded(client, {}, images('regenerated'), source)).toEqual({ id: 'atlas-1' });
        expect(state.publications).toBe(1);
        expect(state.uploads).toEqual(['first']);
        expect(disk.size).toBe(0);
    });
    it('resumes incomplete preparation using its original image identities', async () => {
        const { client, state, attempts } = server();
        state.failUpload = true;
        await expect(atomicServerImport(client, {}, images('first'), source)).rejects.toThrow();
        expect(state.publications).toBe(0);
        state.failUpload = false;
        await atomicServerImport(client, {}, images('fresh-id'), source);
        expect(attempts.size).toBe(1);
        expect(state.uploads).toEqual(['first']);
        expect(state.publications).toBe(1);
    });
    it('keeps attempts separate across accounts and server addresses', async () => {
        const { client, state } = server();
        state.failUpload = true;
        for (const [owner, base] of [['alice', '/api/v1'], ['bob', '/api/v1'], ['bob', '/other']]) {
            state.owner = owner; client.baseUrl = base;
            await expect(atomicServerImport(client, {}, images('image'), source)).rejects.toThrow();
        }
        expect(disk.size).toBe(3);
    });
    it('coalesces double clicks while preparation is running', async () => {
        const { client, state } = server();
        const original = client._request;
        client._request = async (...args) => { await new Promise(resolve => setTimeout(resolve, 10)); return original(...args); };
        const results = await Promise.all([0, 1].map(() => atomicServerImport(client, {}, images('image'), source)));
        expect(results[0]).toEqual(results[1]);
        expect(state.publications).toBe(1);
    });
    it('ignores synthesized metadata but distinguishes edits to author attributes', async () => {
        const { client, state, attempts } = server();
        state.failUpload = true;
        const document = time => ({ layer: { id: 'default', createdAt: time, updatedAt: time },
            sync: { updatedAt: time }, properties: { attributes: { sync: 'author text' } } });
        await expect(atomicServerImport(client, {}, images('first'), document(1))).rejects.toThrow();
        await expect(atomicServerImport(client, {}, images('second'), document(2))).rejects.toThrow();
        expect(attempts.size).toBe(1);
        const changed = document(3);
        changed.properties.attributes.sync = 'edited text';
        await expect(atomicServerImport(client, {}, images('third'), changed)).rejects.toThrow();
        expect(attempts.size).toBe(2);
    });
    it('cannot send the original account data after the account changes mid-upload', async () => {
        const { client, state } = server();
        const original = client._request;
        client._request = async (...args) => {
            const result = await original(...args);
            if (args[1] === '/atlas/imports') state.owner = 'another';
            return result;
        };
        await expect(atomicServerImport(client, {}, images('image'), source)).rejects.toThrow();
        expect(state.uploads).toEqual([]);
        expect(state.publications).toBe(0);
    });
    it('refuses before network if the recovery key cannot be persisted', async () => {
        const { client } = server();
        persistence.fail = true;
        await expect(atomicServerImport(client, {}, [], source)).rejects.toThrow('quota');
        expect(client._request).not.toHaveBeenCalled();
    });
    it('the real HTTP transport fences a change of account during token refresh', async () => {
        const fetch = vi.fn();
        const client = new ApiClient({ fetch });
        client.setTokens({ accessToken: token('original') });
        vi.spyOn(client, '_ensureFreshAccessToken').mockImplementation(async () => {
            client.setTokens({ accessToken: token('another') });
        });
        await expect(atomicServerImport(client, {}, images('image'), source)).rejects.toMatchObject({ stage: 'preparation' });
        expect(fetch).not.toHaveBeenCalled();
        expect(disk.size).toBe(1);
    });
});
