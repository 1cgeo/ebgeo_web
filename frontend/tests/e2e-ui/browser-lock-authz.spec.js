// Path: e2e-ui/browser-lock-authz.spec.js

/**
 * @fileoverview Two-client browser map-lock authorization test. Drives the REAL
 * frontend transport (api-client / operation-factory) imported live from the Vite
 * dev server inside TWO separate Chromium contexts, against the REAL backend, and
 * asserts the multiuser lock/authz contract end to end with in-browser `ApiError`
 * statuses:
 *
 *   1. The OWNER registers, creates an atlas + map, and shares WRITE access to a
 *      second real user (`user2`) via an authenticated `POST /atlas/:id/sharing/users`
 *      fetch (the ApiClient has no sharing helper, so we hit the route directly with
 *      `api.getAccessToken()`).
 *   2. The OWNER locks the map by pushing a `map` `update` op `{ locked: true }`.
 *   3. `user2` (with WRITE) tries to create a feature on the locked map → the backend
 *      rejects it with HTTP 409 (`ConflictError 'Map is locked'`), surfaced in-browser
 *      as `ApiError { status: 409 }`.
 *   4. `user2` tries to DELETE the map → rejected with HTTP 403 (`ForbiddenError`,
 *      map-delete is owner-only) — even though the map is locked, this is an authz
 *      failure, not a lock conflict.
 *   5. The OWNER unlocks the map (`{ locked: false }`); `user2`'s feature write now
 *      succeeds and the persisted snapshot reports the feature.
 *
 * Every assertion is a REAL HTTP round-trip made by browser `fetch` against the
 * spawned backend; the 409/403 statuses come from the live backend, not a stub.
 * Each test self-provisions its own users/atlas/map for isolation.
 *
 * AS DUAS CONTAS nascem no lado NODE (`helpers/accounts.js`), porque confirmar o e-mail
 * exige ler `email_verification_tokens` no Postgres, que o contexto do browser não
 * alcança; cada `page.evaluate` faz só o `login()`. O `id` de `user2`, que a rota de
 * compartilhamento exige, vem pronto do helper (o `register()` responde sem dado de conta,
 * de propósito, para não servir de enumerador).
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Map lock authorization (two real browser clients + real backend)', () => {
    test('owner shares write; lock refuses user2 write per-op; user2 map-delete denied; unlock re-enables write', async ({
        browser,
    }) => {
        // ---- Provision user2 (real register + e-mail confirmation → real user id). ----
        // register() answers no account data (identical response whether it created the
        // account or found one), so the id comes from the proof login createVerifiedUser makes.
        const user2 = await createVerifiedUser({ prefix: 'lz_user2', nome: 'Lock User2' });
        expect(typeof user2.id).toBe('string');
        expect(user2.id.length).toBeGreaterThan(0);

        const ctxB = await browser.newContext();
        const pageB = await ctxB.newPage();
        await pageB.addInitScript((url) => {
            window.__EBGEO_BACKEND_URL__ = url;
        }, `${state.baseUrl}/api/v1`);
        await pageB.goto('/');

        // ---- OWNER context: login, create atlas + map, share WRITE to user2. ----
        const ownerUser = await createVerifiedUser({ prefix: 'lz_owner', nome: 'Lock Owner' });
        const ctxA = await browser.newContext();
        const pageA = await ctxA.newPage();
        await pageA.addInitScript((url) => {
            window.__EBGEO_BACKEND_URL__ = url;
        }, `${state.baseUrl}/api/v1`);
        await pageA.goto('/');

        const owner = await pageA.evaluate(
            async ({ baseUrl, u, user2Id }) => {
                const { ApiClient } = await import('/src/js/store/sync/api-client.js');
                const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

                const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
                await api.login(u.username, u.password);

                const atlas = await api.createAtlas({ name: 'Lock Authz Atlas' });
                const mapId = crypto.randomUUID();
                await api.pushOperations(atlas.id, [
                    createOperation('map', 'create', mapId, null, { name: 'M1' }),
                ]);

                // Share WRITE access to user2 via the owner-only sharing route. The
                // ApiClient has no sharing helper, so call the REST route directly with
                // the owner's access token.
                const shareRes = await fetch(`${baseUrl}/api/v1/atlas/${atlas.id}/sharing/users`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${api.getAccessToken()}`,
                    },
                    body: JSON.stringify({ userId: user2Id, permission: 'write' }),
                });

                window.__owner = { api, atlasId: atlas.id, mapId };
                return { atlasId: atlas.id, mapId, shareStatus: shareRes.status };
            },
            { baseUrl: state.baseUrl, u: ownerUser, user2Id: user2.id },
        );
        // Sharing a user returns 201 Created.
        expect(owner.shareStatus).toBe(201);

        // ---- user2 logs in and confirms WRITE works BEFORE the lock (edge baseline). ----
        const preLock = await pageB.evaluate(
            async ({ baseUrl, username, password, atlasId, mapId }) => {
                const { ApiClient } = await import('/src/js/store/sync/api-client.js');
                const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
                const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
                await api.login(username, password);
                window.__user2 = { api, atlasId, mapId };

                const fid = crypto.randomUUID();
                const feature = {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [-43.1, -22.8] },
                    properties: { id: fid, source: 'point', nome: 'Pre-lock point' },
                };
                try {
                    await api.pushOperations(atlasId, [createOperation('feature', 'create', fid, mapId, feature)]);
                    return { ok: true };
                } catch (err) {
                    return { ok: false, status: err.status, code: err.code };
                }
            },
            {
                baseUrl: state.baseUrl,
                username: user2.username,
                password: user2.password,
                atlasId: owner.atlasId,
                mapId: owner.mapId,
            },
        );
        // Baseline: WRITE share is genuinely effective before the map is locked.
        expect(preLock.ok).toBe(true);

        // ---- OWNER locks the map (owner-only lock op). ----
        const locked = await pageA.evaluate(async () => {
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const { api, atlasId, mapId } = window.__owner;
            const op = createOperation('map', 'update', mapId, null, { locked: true });
            const res = await api.pushOperations(atlasId, [op]);
            return { serverVersion: res.serverVersion };
        });
        expect(typeof locked.serverVersion).toBe('number');

        // ---- user2 feature write on the LOCKED map -> refused PER OPERATION. ----
        //
        // THIS BLOCK ASSERTED A THROWN 409 UNTIL 2026-08-16, and that was the contract when it
        // was written. The backend reversed it deliberately (`lockedMapDenialReason`,
        // `backend/src/modules/sync/sync.service.js`): a `ConflictError` raised inside the tx
        // that wraps the batch rolled back every sibling op and answered 409, and the client
        // does not dequeue a batch the server refused — so it replayed the poisoned batch
        // every 1.5 s forever and that user stopped syncing entirely, for EVERY map, with
        // nothing but a console.warn. A lock is a policy refusal, not an integrity failure.
        //
        // The half that did NOT change is asserted right after: nothing is written.
        const writeWhileLocked = await pageB.evaluate(async () => {
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const { api, atlasId, mapId } = window.__user2;
            const fid = crypto.randomUUID();
            const feature = {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                properties: { id: fid, source: 'point', nome: 'Blocked point' },
            };
            const res = await api.pushOperations(atlasId, [
                createOperation('feature', 'create', fid, mapId, feature),
            ]);
            const pull = await api.pullSync(atlasId, 0);
            const map = pull?.snapshot?.maps?.find((m) => m.id === mapId);
            const landed = (map?.features?.points || []).some((p) => p.properties?.id === fid);
            return { fid, outcome: res.results?.[0] ?? null, landed };
        });
        expect(writeWhileLocked.outcome, 'o push nao devolveu resultado por operacao').toBeTruthy();
        expect(writeWhileLocked.outcome.success).toBe(false);
        expect(writeWhileLocked.outcome.reason).toMatch(/bloqueado/i);
        expect(writeWhileLocked.landed, 'nada pode ser gravado num mapa bloqueado').toBe(false);

        // ---- user2 map-delete -> denied (owner-only authz, NOT a lock conflict). ----
        // `canDeleteMap` is a SEPARATE flag from `canDelete`, and the separation is contract
        // with the server: joining them made the client offer a button the server refused.
        const deleteByUser2 = await pageB.evaluate(async () => {
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const { api, atlasId, mapId } = window.__user2;
            const res = await api.pushOperations(atlasId, [
                createOperation('map', 'delete', mapId, null, {}),
            ]);
            const pull = await api.pullSync(atlasId, 0);
            const stillThere = Boolean(pull?.snapshot?.maps?.find((m) => m.id === mapId));
            return { outcome: res.results?.[0] ?? null, stillThere };
        });
        expect(deleteByUser2.outcome, 'o push nao devolveu resultado por operacao').toBeTruthy();
        expect(deleteByUser2.outcome.success).toBe(false);
        expect(deleteByUser2.stillThere, 'quem nao e dono nao apaga o mapa').toBe(true);

        // ---- OWNER unlocks the map. ----
        const unlocked = await pageA.evaluate(async () => {
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const { api, atlasId, mapId } = window.__owner;
            const res = await api.pushOperations(atlasId, [
                createOperation('map', 'update', mapId, null, { locked: false }),
            ]);
            return { serverVersion: res.serverVersion };
        });
        expect(typeof unlocked.serverVersion).toBe('number');

        // ---- user2 feature write now SUCCEEDS; snapshot must report the feature. ----
        const afterUnlock = await pageB.evaluate(async () => {
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');
            const { api, atlasId, mapId } = window.__user2;
            const fid = crypto.randomUUID();
            const feature = {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.3, -23.0] },
                properties: { id: fid, source: 'point', nome: 'After-unlock point' },
            };
            try {
                await api.pushOperations(atlasId, [createOperation('feature', 'create', fid, mapId, feature)]);
            } catch (err) {
                return { ok: false, status: err.status, code: err.code };
            }

            // Read back the persisted snapshot and confirm the feature landed.
            const deadline = Date.now() + 5000;
            let found = false;
            while (Date.now() < deadline && !found) {
                const pull = await api.pullSync(atlasId, 0);
                const map = pull?.snapshot?.maps?.find((m) => m.id === mapId);
                const points = map?.features?.points || [];
                found = points.some((p) => p.properties && p.properties.id === fid);
                if (!found) await new Promise((r) => setTimeout(r, 50));
            }
            return { ok: true, fid, found };
        });
        expect(afterUnlock.ok).toBe(true);
        expect(afterUnlock.found).toBe(true);

        await ctxA.close();
        await ctxB.close();
    });
});
