// Path: e2e-ui/abrir-servidor-preserva-local.spec.js

/**
 * @fileoverview Abrir um projeto do SERVIDOR não toca no atlas local.
 *
 * Isto foi FALSO até o namespace por atlas (2026-08-15), quando os dez bancos tinham endereço único
 * e o wipe de entrada caía exatamente onde o trabalho local morava. Hoje `activateRemoteAtlas` monta
 * `remote-<atlasId>` ANTES do `clearAllDataStore`, e o wipe esvazia o namespace que está sendo
 * aberto. O diálogo "Você tem trabalho local não salvo", com um botão vermelho escrito "Descartar e
 * abrir", sobreviveu à mudança e passou a ameaçar uma destruição que já não acontecia; foi removido
 * em 2026-08-16 e este caso é o que impede a volta dele — por ausência de diálogo E por presença do
 * dado, que são coisas diferentes: um `openRemoteAtlas` que voltasse a apagar o slot local passaria
 * na primeira metade.
 *
 * PRECISA DE NAVEGADOR. As duas metades da afirmação são endereços de IndexedDB diferentes montados
 * em momentos diferentes pelo mesmo documento, e um duplo em processo não tem nem os bancos nem a
 * navegação que separa os dois estados.
 *
 * O que ele NÃO cobre, de propósito: o slot RESGATADO (`adoptRemoteAtlasAsLocal`), que ocupa
 * literalmente o mesmo namespace do atlas de servidor e por isso mantém a sua pergunta
 * (`confirmDiscardingRescuedWork`). Lá a destruição é real.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { drawPointUI, readFeatures, loginUI } from './helpers/collab-helpers.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

describeOrSkip('abrir projeto do servidor', () => {
    test('preserva o atlas local, e não pergunta nada sobre ele', async ({ browser }) => {
        test.setTimeout(180000);
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);

        // Conta + um projeto no servidor, montados pela API para o caso medir só o que promete.
        await page.goto('/');
        const creds = await page.evaluate(async (base) => {
            const { ApiClient } = await import('/src/js/store/sync/api-client.js');
            const api = new ApiClient({ baseUrl: `${base}/api/v1` });
            const user = {
                username: `preserva_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`,
                password: 'Sup3r-Secret-Pw!',
                nome: 'Preserva',
            };
            await api.register({ ...user });
            await api.login(user.username, user.password);
            await api.createAtlas({ name: 'Projeto do servidor' });
            return user;
        }, state.baseUrl);

        // Trabalho local, pela ferramenta de verdade: é ele que o diálogo dizia que seria substituído.
        await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 30000 });
        const pontoId = await drawPointUI(page, [-43.2, -22.9]);
        expect(await readFeatures(page, 'points')).toHaveLength(1);

        await loginUI(page, creds.username, creds.password);
        await page.locator('[data-testid="project-picker-item"]').first().click();

        // METADE 1: nenhuma pergunta sobre trabalho local. Asserida contra o TEXTO, não contra a
        // ausência de modal: a pergunta do resgate usa o mesmo componente e continua legítima.
        await expect(page.locator('.modal-container', { hasText: 'trabalho local não salvo' }))
            .toHaveCount(0);
        await expect(page.locator('[data-testid="sync-status-badge"]'))
            .toHaveAttribute('data-state', 'online', { timeout: 30000 });
        // Premissa: o projeto do servidor abriu VAZIO. Sem isto, o ponto encontrado no fim poderia
        // ser o do atlas remoto, e o caso passaria medindo a coisa errada.
        expect(await readFeatures(page, 'points')).toHaveLength(0);

        // METADE 2: o ponto continua no atlas local, alcançável pelo caminho do usuário.
        await page.goto('/projetos.html');
        await expect(page.locator('[data-testid="local-atlas-item"]').first())
            .toBeVisible({ timeout: 20000 });
        await page.locator('[data-testid="local-atlas-item"]').first().click();
        await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 30000 });

        const local = await readFeatures(page, 'points');
        expect(local).toHaveLength(1);
        expect(local[0].id).toBe(pontoId);

        await ctx.close();
    });
});
