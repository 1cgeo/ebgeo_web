// Path: e2e-ui/cobertura-aba-atributos.spec.js

/**
 * @fileoverview COBERTURA DA ABA "ATRIBUTOS" DO PAINEL DE FEIÇÃO, em atlas LOCAL, pela interface.
 *
 * A campanha de cobertura (2026-09-24) achou a aba exercitada só em atlas de servidor, e só em três
 * gestos (criar pelo ✓, editar valor e renomear com Enter). Este arquivo cobre o resto, um caso por
 * grupo de comandos (`user_data/attributes_tab_renderer.js`):
 *
 *   - criar pelo ✓ e pelo Enter; cancelar pelo Escape e pelo ✕; o estado vazio;
 *   - as recusas de chave: vazia, com caractere proibido, reservada;
 *   - editar o valor com Enter, com blur, e o Escape que NÃO grava;
 *   - renomear a chave com Enter e o Escape que não renomeia;
 *   - excluir pela lixeira;
 *   - tudo o que foi gravado sobrevive ao F5;
 *   - com o mapa travado, a seção é só de leitura (sem abas e sem comandos).
 *
 * A LEITURA DE VERDADE É A STORE (`getCurrentMapFeatures`), e não o texto da aba: a aba redesenha a
 * partir da store, então conferir só o DOM mediria o desenho e não a gravação.
 */

import { test, expect } from '@playwright/test';
import { readState } from './state.js';
import { drawPointUI, selectFeatureUI } from './helpers/collab-helpers.js';

const state = readState();
test.beforeEach(() => { test.skip(state.skip, state.reason); });
test.describe.configure({ retries: 0 });

/** Abre o mapa local e espera o boot assentar. */
async function abrirMapaLocal(page) {
    await page.goto('/');
    await expect(page.locator('#toolbar-container')).toBeAttached({ timeout: 20000 });
    await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 30000 });
    await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 30000 });
}

/** Seleciona a feição e abre a aba Atributos do painel. */
async function abrirAbaAtributos(page, id) {
    await selectFeatureUI(page, id);
    const painel = page.locator('.feature-panel[data-expanded="true"]');
    await painel.locator('.feature-tab-btn[data-tab-id="atributos"]').click();
    return painel.locator('.feature-tab-content[data-tab-id="atributos"]');
}

/** Os atributos da feição, lidos da store. */
function atributosNaStore(page, id) {
    return page.evaluate(async (fid) => {
        const s = await import('/src/js/store/index.js');
        const f = await s.getCurrentMapFeatures();
        return (f.points ?? []).find((p) => p.properties.id === fid)?.properties?.attributes ?? {};
    }, id);
}

/** Cria um atributo pelo formulário da aba, confirmando pelo ✓ ou pelo Enter. */
async function criarAtributo(aba, chave, valor, { pelo = 'botao' } = {}) {
    await aba.locator('.feature-attributes-add-btn').click();
    const [campoChave, campoValor] = await aba.locator('.feature-attributes-inline-input').all();
    await campoChave.fill(chave);
    await campoValor.fill(valor);
    if (pelo === 'enter') await campoValor.press('Enter');
    else await aba.locator('.feature-attributes-inline-confirm').click();
}

/** Desenha um ponto, abre a aba e devolve os dois. */
async function pontoComAba(page) {
    await abrirMapaLocal(page);
    const id = await drawPointUI(page, [-43.2, -22.9]);
    await page.keyboard.press('Escape');
    const aba = await abrirAbaAtributos(page, id);
    return { id, aba };
}

test('criar pelo ✓ e pelo Enter; cancelar pelo Escape e pelo ✕; estado vazio', async ({ page }) => {
    const { id, aba } = await pontoComAba(page);
    await expect(aba.locator('.feature-attributes-empty')).toBeVisible();

    await criarAtributo(aba, 'cota', '10');
    await expect.poll(() => atributosNaStore(page, id)).toEqual({ cota: '10' });
    await criarAtributo(aba, 'setor', '1', { pelo: 'enter' });
    await expect.poll(() => atributosNaStore(page, id)).toEqual({ cota: '10', setor: '1' });
    await expect(aba.locator('.feature-attribute-row')).toHaveCount(2);

    // Escape e ✕ cancelam sem gravar nada.
    await aba.locator('.feature-attributes-add-btn').click();
    const [chave1] = await aba.locator('.feature-attributes-inline-input').all();
    await chave1.fill('descartado');
    await chave1.press('Escape');
    await expect(aba.locator('.feature-attributes-inline-form')).toHaveCount(0);
    await aba.locator('.feature-attributes-add-btn').click();
    const [chave2] = await aba.locator('.feature-attributes-inline-input').all();
    await chave2.fill('descartado');
    await aba.locator('.feature-attributes-inline-cancel').click();
    await expect(aba.locator('.feature-attributes-inline-form')).toHaveCount(0);
    expect(await atributosNaStore(page, id)).toEqual({ cota: '10', setor: '1' });
});

test('as recusas de chave: vazia, caractere proibido e nome reservado', async ({ page }) => {
    const { id, aba } = await pontoComAba(page);
    await aba.locator('.feature-attributes-add-btn').click();
    const [chave, valor] = await aba.locator('.feature-attributes-inline-input').all();

    await valor.fill('x');
    await aba.locator('.feature-attributes-inline-confirm').click();
    await expect(chave).toHaveClass(/error/);

    await chave.fill('a/b');
    await aba.locator('.feature-attributes-inline-confirm').click();
    const erro = aba.locator('.feature-attributes-error');
    await expect(erro).toBeVisible();
    process.stdout.write(`[atributos] recusa de caractere: ${(await erro.innerText()).trim()}\n`);

    await chave.fill('nome');
    await aba.locator('.feature-attributes-inline-confirm').click();
    await expect(aba.locator('.feature-attributes-error')).toBeVisible();

    expect(await atributosNaStore(page, id), 'nenhuma chave recusada foi gravada').toEqual({});
});

test('editar o valor com Enter e com blur; o Escape não grava', async ({ page }) => {
    const { id, aba } = await pontoComAba(page);
    await criarAtributo(aba, 'cota', '10');
    await expect.poll(() => atributosNaStore(page, id)).toEqual({ cota: '10' });

    const valor = () => aba.locator('.feature-attribute-row', { hasText: 'cota' }).locator('.feature-attribute-value');
    const campo = aba.locator('.feature-attribute-value-input');

    await valor().click();
    await campo.fill('11');
    await campo.press('Enter');
    await expect.poll(() => atributosNaStore(page, id)).toEqual({ cota: '11' });

    await valor().click();
    await campo.fill('12');
    await aba.locator('.feature-attributes-add-btn').focus();
    await expect.poll(() => atributosNaStore(page, id), { message: 'o blur não gravou' }).toEqual({ cota: '12' });

    await valor().click();
    await campo.fill('99');
    await campo.press('Escape');
    await expect(campo).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(await atributosNaStore(page, id), 'o Escape gravou o valor que devia descartar').toEqual({ cota: '12' });
    await expect(valor()).toHaveText('12');
});

test('renomear a chave com Enter; o Escape não renomeia', async ({ page }) => {
    const { id, aba } = await pontoComAba(page);
    await criarAtributo(aba, 'cota', '10');
    await expect.poll(() => atributosNaStore(page, id)).toEqual({ cota: '10' });

    const linha = aba.locator('.feature-attribute-row', { hasText: 'cota' });
    await linha.locator('.feature-attribute-key-edit').click();
    const campo = aba.locator('.feature-attribute-key-input');
    await campo.fill('ignorado');
    await campo.press('Escape');
    await expect(campo).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(await atributosNaStore(page, id), 'o Escape renomeou a chave').toEqual({ cota: '10' });

    await aba.locator('.feature-attribute-row', { hasText: 'cota' }).locator('.feature-attribute-key').click();
    await campo.fill('altura');
    await campo.press('Enter');
    await expect.poll(() => atributosNaStore(page, id)).toEqual({ altura: '10' });
});

test('excluir pela lixeira, e o que ficou sobrevive ao F5', async ({ page }) => {
    const { id, aba } = await pontoComAba(page);
    await criarAtributo(aba, 'cota', '10');
    await criarAtributo(aba, 'setor', '1');
    await expect.poll(() => atributosNaStore(page, id)).toEqual({ cota: '10', setor: '1' });

    await aba.locator('.feature-attribute-row', { hasText: 'setor' }).locator('.feature-attribute-delete').click();
    await expect.poll(() => atributosNaStore(page, id)).toEqual({ cota: '10' });
    await expect(aba.locator('.feature-attribute-row')).toHaveCount(1);

    await page.reload();
    await expect(page.locator('#initial-loader')).toHaveCount(0, { timeout: 30000 });
    await page.waitForFunction(() => globalThis.__ebgeoMap?.loaded?.(), null, { timeout: 30000 });
    await expect.poll(() => atributosNaStore(page, id), { timeout: 15000 }).toEqual({ cota: '10' });
    const abaDepois = await abrirAbaAtributos(page, id);
    await expect(abaDepois.locator('.feature-attribute-row', { hasText: 'cota' })).toBeVisible();
});

test('com o mapa travado, a seção de atributos é só de leitura', async ({ page }) => {
    const { id, aba } = await pontoComAba(page);
    await criarAtributo(aba, 'cota', '10');
    await expect.poll(() => atributosNaStore(page, id)).toEqual({ cota: '10' });
    await page.keyboard.press('Escape');

    // Trava o mapa pelo controlador, como o cadeado da aba Mapas faz.
    await page.evaluate(async () => {
        const { mapLockController } = await import('/src/js/locking/map-lock.controller.js');
        await mapLockController.toggleMapLock();
    });
    await expect.poll(() => page.evaluate(async () => {
        const s = await import('/src/js/store/index.js');
        return s.isCurrentMapLockedSync();
    })).toBe(true);

    await selectFeatureUI(page, id);
    const painel = page.locator('.feature-panel[data-expanded="true"]');
    await expect(painel).toBeVisible();
    await expect(painel.locator('.feature-attributes-add-btn'), 'mapa travado oferece criar atributo').toHaveCount(0);
    await expect(painel.locator('.feature-attribute-delete'), 'mapa travado oferece excluir atributo').toHaveCount(0);
    await expect(painel).toContainText('cota');
    await expect(painel).toContainText('10');
});
