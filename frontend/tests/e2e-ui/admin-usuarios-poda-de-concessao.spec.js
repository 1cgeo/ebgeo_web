// Path: e2e-ui/admin-usuarios-poda-de-concessao.spec.js

/**
 * A EDIÇÃO MAIS DESTRUTIVA DO PAINEL, em Chromium real contra o backend real: salvar a aba
 * Usuários com o PAPEL GLOBAL ou a OM PRODUTORA trocados revoga TODA concessão viva que a
 * pessoa deu, com a subárvore pendurada nela (`fundamentoDeRaizPerdido` + `podarPorRaizes`,
 * origem `USER_DEMOTION`).
 *
 * O gesto que surpreende é o segundo, e é ele que este arquivo mede em primeiro lugar: a poda
 * dispara na simples desigualdade `omAntes !== omDepois`, então corrigir um ERRO DE DIGITAÇÃO
 * na OM de um produtor derrubava tudo o que ele havia concedido — com um toast dizendo
 * "Usuário atualizado.".
 *
 * POR QUE ISTO PRECISA DE NAVEGADOR. As frases são puras e já têm teste de unidade
 * (`producer-scope-phrases.js`); o que NENHUM teste de node alcança é a costura entre elas e o
 * mundo: que a listagem de fato carrega `live_grant_count` até a linha, que o número que a
 * frase recebe é o número REAL de concessões vivas daquele produtor, que o CANCELAMENTO não
 * grava, e que o toast depois do salvamento traz a contagem que o SERVIDOR mediu. Cada um
 * desses elos passa por um processo diferente.
 *
 * O CASO DE ZERO TEM ASSERÇÃO PRÓPRIA de propósito. A frase muda quando não há concessão
 * ("nada é revogado agora") e o botão deixa de ameaçar ("Salvar", não "Salvar e revogar"),
 * porque uma ameaça falsa no caso comum é o que faz a pessoa parar de ler o botão. Sem os dois
 * casos, um diálogo com texto FIXO passaria verde no primeiro.
 *
 * O QUE ESTE ARQUIVO NÃO COBRE: o motivo `papel_global` (rebaixar um administrador ou um
 * credenciado). Os três motivos compartilham a mesma confirmação e o mesmo caminho de código, e
 * a discriminação que interessa aqui é entre TER e NÃO TER concessão viva.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { createDb, closeDb } from './helpers/db.js';
import { createVerifiedUser, resolveOrganization } from './helpers/accounts.js';
import { seedTileset } from './helpers/catalog-seed.js';

const state = readState();
const describeOrSkip = state.skip ? test.describe.skip : test.describe;

/**
 * Concede um recurso a alguém pela ROTA, com o token de quem concede.
 *
 * Setup por HTTP e não por INSERT: a concessão é o sujeito indireto deste spec (o número que a
 * tela promete é a contagem dela), então ela precisa nascer pelo mesmo caminho de produção que
 * o gate `requireResourceShare` guarda. Um INSERT direto poderia criar uma linha que o servidor
 * jamais aceitaria e o teste ficaria verde sobre um estado impossível.
 */
async function concederRecurso({ token, type, resourceId, granteeId, grantLevel = 'view' }) {
    const res = await fetch(
        `${state.baseUrl}/api/v1/resource-access/${type}/${resourceId}/grants`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ granteeId, grantLevel }),
        },
    );
    const texto = await res.text();
    if (!res.ok) throw new Error(`conceder ${type}/${resourceId} → ${res.status}: ${texto.slice(0, 300)}`);
    return JSON.parse(texto)?.data;
}

/** A linha do usuário no banco: o par (papel, escopo) como o servidor o guarda. */
function lerUsuario(id) {
    return createDb(state.dbName).raw.one(
        'SELECT role, producer_org_id FROM users WHERE id = $1', [id]);
}

/** Quantas concessões VIVAS aquele usuário deu (a mesma pergunta de `live_grant_count`). */
async function contarConcessoesVivas(granterId) {
    const row = await createDb(state.dbName).raw.one(
        `SELECT COUNT(*)::int AS n FROM resource_grants
          WHERE granted_by = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
        [granterId],
    );
    return row.n;
}

/** Boota anônimo, entra pela interface e para na página de Administração, aba Usuários. */
async function abrirAbaUsuarios(page, creds) {
    await page.addInitScript((url) => { window.__EBGEO_BACKEND_URL__ = url; }, `${state.baseUrl}/api/v1`);
    await page.goto('/');
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
    await page.goto('/');
    await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });
    await page.locator('[data-testid="account-login-btn"]').click();
    await page.locator('[data-testid="login-username"]').fill(creds.username);
    await page.locator('[data-testid="login-password"]').fill(creds.password);
    await page.locator('[data-testid="login-submit"]').click();
    await page.waitForURL('**/atlas.html', { timeout: 20000 });
    await page.locator('[data-testid="projects-local-map"]').click();
    await expect(page.locator('[data-testid="account-control"]')).toBeAttached({ timeout: 20000 });
    await page.locator('[data-testid="account-control"] .account-control__identity').click();
    await page.locator('[data-testid="account-admin-btn"]').click();
    await page.waitForURL('**/admin.html', { timeout: 20000 });
    await expect(page.locator('[data-testid="admin-panel"]')).toBeVisible({ timeout: 20000 });
    await page.locator('[data-testid="admin-tab-users"]').click();
    await expect(page.locator('[data-testid="admin-users-table"]')).toBeVisible({ timeout: 15000 });
}

describeOrSkip('Aba Usuários — a confirmação de poda ao trocar papel ou OM produtora', () => {
    test.afterAll(async () => { await closeDb(); });

    test('trocar a OM de um produtor QUE CONCEDEU avisa com o número real, e cancelar não grava', async ({ page }) => {
        const admin = await createVerifiedUser({ prefix: 'podaadm', nome: 'Poda Admin', role: 'admin' });
        const omA = await resolveOrganization({ slug: 'default' });
        const omB = await resolveOrganization({ slug: 'dsg' });
        const produtor = await createVerifiedUser({
            prefix: 'podaprod', nome: 'Produtor Com Concessao', role: 'producer', producerOrgSlug: 'default',
        });
        const beneficiario = await createVerifiedUser({ prefix: 'podabenef', nome: 'Beneficiario' });

        // O recurso é PRIVADO e da OM do produtor: é essa igualdade que `fn_can_produce_resource`
        // exige para que ele possa conceder sem ter recebido nada de ninguém.
        const tileset = await seedTileset(state.dbName, {
            name: 'Acervo da OM', accessLevel: 'private', ownerOrgId: omA.id,
        });
        await concederRecurso({
            token: produtor.accessToken, type: 'tileset', resourceId: tileset, granteeId: beneficiario.id,
        });
        expect(await contarConcessoesVivas(produtor.id)).toBe(1);

        await abrirAbaUsuarios(page, admin);
        await page.locator('[data-testid="admin-users-search"]').fill(produtor.username);
        const linha = page.locator('[data-testid="admin-users-row"]', { hasText: produtor.username });
        await expect(linha).toBeVisible({ timeout: 10000 });
        await linha.locator('[data-testid="admin-user-edit"]').click();

        await expect(page.locator('[data-testid="admin-user-form"]')).toBeVisible({ timeout: 10000 });
        const seletorOm = page.locator('[data-testid="admin-userform-producer-org"]');
        await expect(seletorOm).toBeVisible();
        await seletorOm.selectOption(omB.id);
        await page.locator('[data-testid="admin-userform-save"]').click();

        // PRIMEIRA METADE: o diálogo nomeia o gesto e CITA A QUANTIDADE.
        const dialogo = page.locator('.confirm-modal-overlay');
        await expect(dialogo).toBeVisible({ timeout: 10000 });
        await expect(dialogo).toContainText('Trocar a OM produtora');
        await expect(dialogo).toContainText(produtor.username);
        await expect(dialogo).toContainText('1 concessão');
        // Discriminação contra o texto do caso vazio: as duas frases moram na mesma função.
        await expect(dialogo).not.toContainText('nenhuma concessão viva');
        await expect(dialogo.locator('.confirm-modal-btn-confirm')).toHaveText('Salvar e revogar');

        // SEGUNDA METADE: cancelar NÃO grava, nem o par (papel, escopo) nem a poda.
        await dialogo.locator('.confirm-modal-btn-cancel').click();
        await expect(dialogo).toHaveCount(0, { timeout: 10000 });
        const depoisDoCancelamento = await lerUsuario(produtor.id);
        expect(depoisDoCancelamento.producer_org_id).toBe(omA.id);
        expect(await contarConcessoesVivas(produtor.id)).toBe(1);

        // E o formulário continua aberto com a escolha feita: cancelar a CONFIRMAÇÃO não é
        // cancelar a EDIÇÃO, e o botão volta a aceitar clique (ele é desabilitado no submit).
        await expect(page.locator('[data-testid="admin-user-form"]')).toBeVisible();
        await expect(page.locator('[data-testid="admin-userform-save"]')).toBeEnabled();

        // CONFIRMAR, agora, faz o que foi prometido — e o toast traz o número do SERVIDOR,
        // que é outro número que o da listagem (um é retrato, o outro é medição).
        await page.locator('[data-testid="admin-userform-save"]').click();
        await expect(dialogo).toBeVisible({ timeout: 10000 });
        await dialogo.locator('.confirm-modal-btn-confirm').click();
        await expect(page.locator('.toast--success', { hasText: 'Concessões revogadas: 1' }))
            .toBeVisible({ timeout: 15000 });
        const depoisDeSalvar = await lerUsuario(produtor.id);
        expect(depoisDeSalvar.producer_org_id).toBe(omB.id);
        expect(depoisDeSalvar.role).toBe('producer');
        expect(await contarConcessoesVivas(produtor.id)).toBe(0);
    });

    test('trocar a OM de um produtor SEM concessão nenhuma não assusta, e salva', async ({ page }) => {
        const admin = await createVerifiedUser({ prefix: 'podaadm', nome: 'Poda Admin', role: 'admin' });
        const omB = await resolveOrganization({ slug: '1-cgeo' });
        const produtor = await createVerifiedUser({
            prefix: 'podazero', nome: 'Produtor Sem Concessao', role: 'producer', producerOrgSlug: 'default',
        });
        expect(await contarConcessoesVivas(produtor.id)).toBe(0);

        await abrirAbaUsuarios(page, admin);
        await page.locator('[data-testid="admin-users-search"]').fill(produtor.username);
        const linha = page.locator('[data-testid="admin-users-row"]', { hasText: produtor.username });
        await expect(linha).toBeVisible({ timeout: 10000 });
        await linha.locator('[data-testid="admin-user-edit"]').click();
        await expect(page.locator('[data-testid="admin-user-form"]')).toBeVisible({ timeout: 10000 });
        await page.locator('[data-testid="admin-userform-producer-org"]').selectOption(omB.id);
        await page.locator('[data-testid="admin-userform-save"]').click();

        // A CONFIRMAÇÃO CONTINUA APARECENDO (a autoridade muda de fato, e a contagem da
        // listagem é um retrato que pode ter envelhecido), mas ela não promete destruição.
        const dialogo = page.locator('.confirm-modal-overlay');
        await expect(dialogo).toBeVisible({ timeout: 10000 });
        await expect(dialogo).toContainText('nenhuma concessão viva');
        await expect(dialogo).not.toContainText('são revogadas');
        await expect(dialogo.locator('.confirm-modal-btn-confirm')).toHaveText('Salvar');

        await dialogo.locator('.confirm-modal-btn-confirm').click();
        // O toast volta a ser o de sempre: sem eixo zerado escrito na tela.
        const toast = page.locator('.toast--success', { hasText: 'Usuário atualizado.' });
        await expect(toast).toBeVisible({ timeout: 15000 });
        await expect(toast).not.toContainText('revogadas');
        expect((await lerUsuario(produtor.id)).producer_org_id).toBe(omB.id);
    });

    test('uma edição que NÃO mexe no par (papel, OM) salva sem confirmação nenhuma', async ({ page }) => {
        // O CONTROLE NEGATIVO DE DENTRO DO ARQUIVO. Sem ele, um `showConfirm` incondicional no
        // salvamento passaria os dois casos acima: os dois esperam o diálogo. Aqui o gesto é o
        // do dia a dia (corrigir o nome), e a ausência do diálogo é o que se assere.
        const admin = await createVerifiedUser({ prefix: 'podaadm', nome: 'Poda Admin', role: 'admin' });
        const produtor = await createVerifiedUser({
            prefix: 'podanome', nome: 'Nome Errado', role: 'producer', producerOrgSlug: 'default',
        });

        await abrirAbaUsuarios(page, admin);
        await page.locator('[data-testid="admin-users-search"]').fill(produtor.username);
        const linha = page.locator('[data-testid="admin-users-row"]', { hasText: produtor.username });
        await expect(linha).toBeVisible({ timeout: 10000 });
        await linha.locator('[data-testid="admin-user-edit"]').click();
        await expect(page.locator('[data-testid="admin-user-form"]')).toBeVisible({ timeout: 10000 });
        await page.locator('[data-testid="admin-userform-nome"]').fill('Nome Certo');
        await page.locator('[data-testid="admin-userform-save"]').click();

        await expect(page.locator('.toast--success', { hasText: 'Usuário atualizado.' }))
            .toBeVisible({ timeout: 15000 });
        await expect(page.locator('.confirm-modal-overlay')).toHaveCount(0);
    });
});
