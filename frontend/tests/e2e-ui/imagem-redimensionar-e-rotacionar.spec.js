// Path: e2e-ui/imagem-redimensionar-e-rotacionar.spec.js

/**
 * @fileoverview REDIMENSIONAR E ROTACIONAR UMA FIGURA PELO PAINEL: o colega recebe o tamanho e a
 * rotação, e os BYTES da figura não mudam.
 *
 * O painel da feição de imagem (`draw_tools/image_tool/image_attributes_panel.js`) muda `size` e
 * `rotation`, que são propriedades de desenho: a figura guardada é a mesma. Só a matemática disso
 * tinha teste (`image-geometry`, `image-zoom-correction-dirty`); nenhum caso mexia nos controles e
 * perguntava ao colega. O que se mede: os dois valores no autor, no Postgres e no colega (e depois
 * de um F5 do colega), e o SHA-256 do blob no colega igual ao de antes, que é o que prova que
 * redimensionar não re-encodou nem trocou a figura.
 *
 * Rodar isolado:
 *   cd frontend && npx playwright test imagem-redimensionar-e-rotacionar --retries=0 --workers=1
 */

import { collabTest, expect, readFeatures } from './helpers/collab.fixtures.js';
import { selectFeatureUI, savePanelUI } from './helpers/collab-helpers.js';
import { figuraSolida, porImagemPelaFerramenta, impressaoDoBlob, esperarDesenho, linhaDeImagem } from './helpers/imagem-bytes.js';

collabTest.describe.configure({ retries: 0 });

const COR = [60, 160, 60];

/** Escreve um valor num controle deslizante do painel aberto, pelo campo numérico dele. */
async function ajustar(page, rotulo, valor) {
    const campo = page.locator('.feature-panel[data-expanded="true"] .attr-modern-slider')
        .filter({ hasText: rotulo }).locator('.attr-modern-slider-input');
    await expect(campo, `o controle "${rotulo}" não está no painel`).toBeVisible({ timeout: 10000 });
    await campo.fill(String(valor));
    await campo.press('Tab');
}

const desenhoDe = (page, id) => readFeatures(page, 'images').then((l) => {
    const p = l.find((f) => f.id === id)?.props;
    return p ? { size: p.size, rotation: p.rotation } : null;
});

collabTest.describe('Redimensionar e rotacionar uma figura pelo painel', () => {
    collabTest('o colega recebe tamanho e rotação, e os bytes da figura não mudam', async ({ collab }) => {
        collabTest.setTimeout(180000);
        const A = collab.author;
        const B = collab.peers[0];
        const id = await porImagemPelaFerramenta(A, { name: 'verde.png', mimeType: 'image/png', buffer: await figuraSolida(A, COR) });
        await A.keyboard.press('Escape');
        await expect.poll(() => linhaDeImagem(collab.db, id), { timeout: 30000 }).toMatchObject({ id });
        const antes = await impressaoDoBlob(A, id);
        await esperarDesenho(B, id, COR, { rotulo: 'colega, antes:' });

        await selectFeatureUI(A, id);
        await ajustar(A, 'Tamanho', 2.5);
        await ajustar(A, 'Rotação', 45);
        await savePanelUI(A);

        const esperado = { size: 2.5, rotation: 45 };
        await expect.poll(() => desenhoDe(A, id), { timeout: 15000, message: 'o autor não gravou' }).toEqual(esperado);
        await expect.poll(async () => {
            const p = (await collab.db.queryFeatureRow(id))?.properties;
            return p ? { size: p.size, rotation: p.rotation } : null;
        }, { timeout: 30000, message: 'o servidor não recebeu' }).toEqual(esperado);
        await expect.poll(() => desenhoDe(B, id), { timeout: 30000, message: 'o colega não recebeu' }).toEqual(esperado);

        // Os bytes não mudaram: redimensionar e rotacionar são desenho, não figura nova.
        expect((await impressaoDoBlob(B, id))?.sha).toBe(antes.sha);
        expect(await linhaDeImagem(collab.db, id)).toMatchObject({ size_bytes: antes.size });

        await B.reload();
        await expect(B.locator('[data-testid="sync-status-badge"]')).toHaveAttribute('data-state', 'online', { timeout: 30000 });
        await expect.poll(() => desenhoDe(B, id), { timeout: 30000, message: 'o F5 do colega perdeu o ajuste' }).toEqual(esperado);
        await esperarDesenho(B, id, COR, { rotulo: 'colega, depois do F5:' });
        expect((await impressaoDoBlob(B, id))?.sha).toBe(antes.sha);
    });
});
