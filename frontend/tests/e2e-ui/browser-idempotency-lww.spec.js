// Path: e2e-ui/browser-idempotency-lww.spec.js

/**
 * Browser-level idempotency + conflito por base observada. Drives the REAL frontend
 * transport (api-client / operation-factory) imported live from the Vite dev server
 * inside real Chromium, against the REAL spawned backend. Single client; each test
 * mints its own user + atlas + map for full isolation.
 *
 * Proves two frozen sync contracts end to end, with REAL HTTP round-trips in the browser:
 *   1. Idempotency by op id — pushing the SAME operation object (same `op.id`) twice
 *      produces a SINGLE effect: the feature exists exactly once in the snapshot, and
 *      the second push is ack'd without re-applying (the recorded server version does
 *      not advance for the duplicate). A `create` for an existing entity is NOT a
 *      second feature.
 *   2. A BASE OBSERVADA, e não mais a ordem de chegada, decide o segundo update do mesmo
 *      campo. Este caso media LWW cego ("quem chega por último escreve") e o contrato mudou em
 *      `5f91f2e9` (2026-09-13): uma op de feição declara `baseVersion` (a
 *      `properties.confirmedVersion` da linha que ela observou) mais o patch das unidades que
 *      mudou, e o servidor recusa quem escreve sobre uma unidade que passou daquela base,
 *      NOMEANDO a unidade disputada. O que o caso mede agora são as duas metades disso: duas
 *      edições do MESMO campo a partir da MESMA base — a segunda é recusada, com o campo
 *      nomeado, e a linha fica com a primeira; e a REAPLICAÇÃO deliberada, contra a base atual,
 *      é aceita e vence, ainda carregando um `timestamp` de relógio de parede MENOR que o da
 *      op vencida. O relógio de parede segue não decidindo nada, que é a metade do caso
 *      original que sobrevive intacta. Gêmeos sem browser: tests/e2e/lww-arrival.e2e.test.js e
 *      tests/e2e/concurrent-update-converge.e2e.test.js.
 *
 * No UI clicks: the transport is exercised purely via `page.evaluate`, so there are no
 * data-testid selectors. Backend feature shape is GeoJSON with the type in
 * `properties.source`.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createVerifiedUser } from './helpers/accounts.js';
import { instalarBaseConfirmada } from './helpers/base-confirmada.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('Idempotency + base observada (real Chromium + real backend)', () => {
    test('pushing the same op id twice yields a single feature (no duplicate effect)', async ({ page }) => {
        const user = await createVerifiedUser({ prefix: 'idem', nome: 'Idempotency User' });
        await page.goto('/');

        const result = await page.evaluate(async ({ baseUrl, u }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            await api.login(u.username, u.password);

            const atlas = await api.createAtlas({ name: 'Idempotency Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: 'M1' })]);

            const featureId = crypto.randomUUID();
            const feature = {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [-43.2, -22.9] },
                properties: { id: featureId, source: 'point', nome: 'Dup Point' },
            };
            // Build the op ONCE so both pushes share the SAME op.id (the idempotency key).
            const op = createOperation('feature', 'create', featureId, mapId, feature);

            const res1 = await api.pushOperations(atlas.id, [op]);
            // Re-push the IDENTICAL op object (same op.id) — must be a no-op effect-wise.
            const res2 = await api.pushOperations(atlas.id, [op]);

            const pulled = await api.pullSync(atlas.id, 0);
            const map = pulled.snapshot?.maps?.find((m) => m.id === mapId);
            const points = (map?.features?.points || []).filter((p) => p.properties.id === featureId);

            return {
                opId: op.id,
                isSnapshot: pulled.isSnapshot,
                matchCount: points.length,
                version1: res1.serverVersion,
                version2: res2.serverVersion,
            };
        }, { baseUrl: state.baseUrl, u: user });

        // The duplicate push must NOT create a second feature row.
        expect(result.isSnapshot).toBe(true);
        expect(result.matchCount).toBe(1);
        // Negative/edge: the second push (same op id) is ack'd against the recorded
        // version — it does NOT advance the server version, proving DO-NOTHING semantics.
        expect(result.version2).toBe(result.version1);
    });

    test('duas edições do mesmo campo a partir da MESMA base: a segunda é recusada nomeando o campo, e a reaplicação contra a base atual vence com timestamp menor', async ({ page }) => {
        const user = await createVerifiedUser({ prefix: 'lww', nome: 'LWW User' });
        await page.goto('/');
        await instalarBaseConfirmada(page);

        const result = await page.evaluate(async ({ baseUrl, u }) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const { createOperation } = await import('/src/js/store/sync/operation-factory.js');

            const api = new ApiClient({ baseUrl: `${baseUrl}/api/v1` });
            await api.login(u.username, u.password);

            const atlas = await api.createAtlas({ name: 'LWW Atlas' });
            const mapId = crypto.randomUUID();
            await api.pushOperations(atlas.id, [createOperation('map', 'create', mapId, null, { name: 'M1' })]);

            const featureId = crypto.randomUUID();
            const feature = {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [0, 0] },
                properties: { id: featureId, source: 'point', label: 'origin' },
            };
            await api.pushOperations(atlas.id, [createOperation('feature', 'create', featureId, mapId, feature)]);

            const rotular = (previous, label) => window.__ebgeoBase.opContraBase(previous, mapId, featureId, {
                properties: { id: featureId, source: 'point', label },
            });

            // A MESMA base para as duas edições: é isto que faz delas uma DISPUTA, e não uma
            // sequência. As duas mudam a mesma unidade (`properties.label`).
            const base = await window.__ebgeoBase.feicaoConfirmada(api, atlas.id, mapId, featureId);
            const opFirst = rotular(base, 'first-arrival');
            opFirst.timestamp = Date.now() + 1_000_000; // futuro: venceria se o relógio decidisse
            const opStale = rotular(base, 'second-arrival');
            opStale.timestamp = Date.now() - 1_000_000; // passado: perderia se o relógio decidisse

            // Pushes SEPARADOS para a ordem de chegada ser determinística.
            const ackFirst = await api.pushOperations(atlas.id, [opFirst]);
            const ackStale = await api.pushOperations(atlas.id, [opStale]);

            const pulledAposRecusa = await api.pullSync(atlas.id, 0);
            const mapaAposRecusa = pulledAposRecusa.snapshot?.maps?.find((m) => m.id === mapId);
            const aposRecusa = (mapaAposRecusa?.features?.points || [])
                .find((p) => p.properties.id === featureId);

            // A REAPLICAÇÃO é uma intenção NOVA contra a base atual: op nova, base relida, e o
            // mesmo timestamp velho, para que o relógio continue sem poder explicar o resultado.
            const opReaplicada = await window.__ebgeoBase
                .opDeEdicao(api, atlas.id, mapId, featureId, {
                    properties: { id: featureId, source: 'point', label: 'second-arrival' },
                });
            opReaplicada.timestamp = opStale.timestamp;
            const ackReaplicada = await api.pushOperations(atlas.id, [opReaplicada]);

            const pulled = await api.pullSync(atlas.id, 0);
            const map = pulled.snapshot?.maps?.find((m) => m.id === mapId);
            const point = (map?.features?.points || []).find((p) => p.properties.id === featureId);

            return {
                isSnapshot: pulled.isSnapshot,
                firstOk: ackFirst.results?.[0]?.success ?? null,
                staleOk: ackStale.results?.[0]?.success ?? null,
                staleReason: ackStale.results?.[0]?.reason ?? null,
                staleFields: ackStale.results?.[0]?.conflict?.fields ?? null,
                labelAposRecusa: aposRecusa?.properties?.label ?? null,
                reaplicadaOk: ackReaplicada.results?.[0]?.success ?? null,
                reaplicadaReason: ackReaplicada.results?.[0]?.reason ?? null,
                opsDistintas: opStale.id !== opReaplicada.id,
                label: point?.properties?.label ?? null,
                matchCount: (map?.features?.points || []).filter((p) => p.properties.id === featureId).length,
                firstTimestamp: opFirst.timestamp,
                secondTimestamp: opReaplicada.timestamp,
            };
        }, { baseUrl: state.baseUrl, u: user });

        // A primeira edição, contra a base que observou, é aceita.
        expect(result.firstOk).toBe(true);

        // A segunda, contra a MESMA base, é recusada NOMEANDO a unidade disputada. Nomear é o
        // ponto: uma recusa sem campo não distingue "perdi este campo" de "perdi a feição".
        expect(result.staleOk).toBe(false);
        expect(result.staleReason).toMatch(/mesmos campos foram alterados no servidor/i);
        expect(result.staleFields).toContainEqual(['properties', 'label']);
        // E a recusa não escreveu nada: a linha continua com o valor da primeira.
        expect(result.labelAposRecusa).toBe('first-arrival');

        // A reaplicação é outra operação (id novo) e é aceita contra a base atual.
        expect(result.opsDistintas).toBe(true);
        expect(result.reaplicadaOk, `reaplicação recusada: ${result.reaplicadaReason}`).toBe(true);

        // Sanity: still exactly one feature (updates merge, they don't duplicate).
        expect(result.isSnapshot).toBe(true);
        expect(result.matchCount).toBe(1);
        // O relógio de parede continua não decidindo nada: a vencedora carrega o timestamp MENOR.
        expect(result.secondTimestamp).toBeLessThan(result.firstTimestamp);
        expect(result.label).toBe('second-arrival');
    });
});
