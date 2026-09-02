// Path: e2e-ui/colar-aqui-por-papel-e-por-estado.spec.js

/**
 * "Colar Aqui" — DUAS browsers reais e o backend real, para medir a única coisa que o node
 * puro não alcança: a assimetria entre bloqueio por POSTO e bloqueio por ESTADO, na tela.
 *
 * A REGRA (decisão do dono, 2026-08-24, `.claude/rules/architecture.md` §UI Architecture):
 *
 *   - POSTO some. Um Leitor não vira Editor a partir deste menu, e uma linha morta dizendo
 *     "exige Editor" transforma o menu num catálogo do que a pessoa não é.
 *   - ESTADO desenha e recusa o CLIQUE, nomeando o estado. A trava é reversível, quem clicou
 *     com o botão direito pode ser justamente o dono que a reverte, e o clique é o único
 *     lugar por onde o motivo chega. A trava é ligada pela op de store `toggleMapLock`, que é
 *     estado LOCAL de quem a chamou (o controlador da UI, `mapLockController`, chama a mesma
 *     op e depois loga uma op de mapa com `locked`): o ESTADO medido aqui é o do cliente que
 *     travou, e o par entra como testemunha do que não chegou. Duas versões anteriores deste
 *     arquivo falharam por outros motivos: a primeira travava pela op crua e esperava a trava
 *     no Editor (nunca chega); a segunda travava pelo controlador, e o par PERDIA a contagem
 *     de feições do mapa (2 virou 0, em 3 de 3 rodadas), o que é defeito do caminho vivo da
 *     trava e assunto de `browser-collab-lock.spec.js`, não deste arquivo.
 *
 * O DEFEITO QUE ISTO PRENDE, medido antes de existir: `_addDefaultOptions` consultava
 * `hasSelected` e `locked` e permissão NENHUMA. O Leitor recebia "Duplicar Seleção", que é
 * `copy()` + `paste()`, que chegava em `addFeatures`, cujo `guardWrite` recusa devolvendo
 * `undefined` em silêncio — e a colagem seguia até um toast de SUCESSO ao lado do toast de
 * recusa da store. No F5 as feições sumiam.
 *
 * O QUE SÓ AQUI SE MEDE, e é a razão de o teste de unidade não bastar: que o item bloqueado
 * saia com `aria-disabled` e SEM a propriedade `disabled` (um controle desabilitado não
 * dispara clique, e o clique é o portador do motivo), e que o clique de fato mostre a frase e
 * NÃO escreva feição nenhuma dos dois lados.
 *
 * Rodar headed:  npx playwright test colar-aqui-por-papel-e-por-estado --headed
 */

import { collabTest, expect, readFeatures, drawPointUI } from './helpers/collab.fixtures.js';

/** Drives a store op (toggleMapLock has no single-gesture collab UI; its return IS the contract). */
function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}


/** Right-clicks the centre of the live canvas and waits for the context menu. */
async function openContextMenu(page) {
    const box = await page.locator('#map-sig .maplibregl-canvas').boundingBox();
    expect(box).not.toBeNull();
    const at = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.6 };
    await page.mouse.move(at.x, at.y);
    await page.mouse.click(at.x, at.y, { button: 'right' });
    const menu = page.locator('.context-menu');
    await expect(menu).toBeVisible({ timeout: 8000 });
    return menu;
}

/** The "Colar Aqui (N)" row, however many features the clipboard holds. */
const pasteRow = (menu) => menu.locator('.context-menu-item', { hasText: /^Colar Aqui \(\d+\)$/ });

// ============================================================================
// POSTO: o Leitor não recebe o comando
// ============================================================================

collabTest.describe('Colar Aqui — POSTO (Leitor)', () => {
    collabTest.use({ collabOptions: { peers: 1, permission: 'read' } });

    collabTest('um Leitor não recebe "Colar Aqui" nem "Duplicar Seleção", e CONTINUA podendo copiar', async ({ collab }) => {
        const A = collab.author;  // dono
        const B = collab.peers[0]; // Leitor

        // O dono desenha, para haver o que copiar dos dois lados.
        const id = await drawPointUI(A, [-43.2, -22.9]);
        await collab.expectFullSync({ entityId: id, type: 'points', operationType: 'create' });

        // O Leitor copia — copiar não escreve nada, e gatear isso recusaria uma capacidade que
        // ele comprovadamente tem (colar no atlas local dele).
        const menuLeitor = await openContextMenu(B);
        const copyRow = menuLeitor.locator('.context-menu-item', { hasText: /^Copiar Feiç/ });

        if (await copyRow.count() > 0) {
            await copyRow.first().click();
            await expect(B.locator('.toast--success', { hasText: /copiada/i })).toBeVisible({ timeout: 6000 });
        } else {
            // Sem feição sob o cursor no ponto exato do clique direito, a linha de copiar não
            // existe — e isso é contexto, não posto. O caso central é o de baixo.
            await B.keyboard.press('Escape');
        }

        // O QUE IMPORTA: com ou sem clipboard, "Colar Aqui" e "Duplicar Seleção" NÃO são
        // desenhados para quem não tem o posto. Ausência, nunca linha bloqueada.
        const menu = await openContextMenu(B);
        await expect(pasteRow(menu)).toHaveCount(0);
        await expect(menu.locator('.context-menu-item', { hasText: 'Duplicar Seleção' })).toHaveCount(0);

        // CONTROLE: o menu ESTÁ montado (não é uma tela vazia que passaria em toda ausência).
        await expect(menu.locator('.context-menu-item', { hasText: 'Copiar Coordenadas' })).toBeVisible();
    });
});

// ============================================================================
// ESTADO: o dono que travou recebe o comando, e o clique recusa
// ============================================================================

collabTest.describe('Colar Aqui — ESTADO (mapa travado)', () => {
    collabTest.use({ collabOptions: { peers: 1, permission: 'write' } });

    collabTest('mapa travado pelo dono: "Colar Aqui" continua desenhado, o clique recusa, e nada é escrito', async ({ collab }) => {
        const A = collab.author;   // dono, e é ele quem trava
        const B = collab.peers[0]; // Editor: testemunha do que NÃO chegou
        const mapName = collab.mapName;

        // O dono desenha e copia a própria feição, com o mapa ainda destravado.
        const id = await drawPointUI(A, [-43.2, -22.9]);
        await collab.expectFullSync({ entityId: id, type: 'points', operationType: 'create' });

        await A.keyboard.press('Control+c');

        // CONTROLE POSITIVO, ANTES da trava: destravado, colar FUNCIONA. Sem este passo, todas
        // as asserções de recusa abaixo passariam para um "Colar Aqui" simplesmente quebrado.
        const menuLivre = await openContextMenu(A);
        const linhaLivre = pasteRow(menuLivre);
        await expect(linhaLivre).toBeVisible();
        await expect(linhaLivre).not.toHaveAttribute('aria-disabled', 'true');
        await linhaLivre.click();
        await expect(A.locator('.toast--success', { hasText: /colada/i })).toBeVisible({ timeout: 8000 });

        const antes = (await readFeatures(A, 'points')).length;
        expect(antes, 'a colagem destravada escreveu de verdade').toBeGreaterThan(1);
        // E a colagem atravessou até o par: é esta contagem que a trava não pode mudar.
        await expect.poll(async () => (await readFeatures(B, 'points')).length, { timeout: 15000 })
            .toBe(antes);

        // O DONO TRAVA O PRÓPRIO MAPA pela op de store, que é estado LOCAL deste cliente, e é
        // este estado que o menu consulta. (Pelo controlador da UI a op de mapa viaja, e hoje
        // faz o par perder a contagem de feições: ver o cabeçalho.)
        const locked = await applyStoreOp(A, 'toggleMapLock', [mapName]);
        expect(locked, 'o dono travou o mapa').toBe(true);

        // O comando CONTINUA desenhado...
        const menu = await openContextMenu(A);
        const linha = pasteRow(menu);
        await expect(linha).toBeVisible();

        // ...e diz que está recusado por `aria-disabled`, NUNCA pela propriedade `disabled`,
        // que mataria o clique que carrega o motivo.
        await expect(linha).toHaveAttribute('aria-disabled', 'true');
        expect(await linha.evaluate((el) => el.disabled)).toBeUndefined();

        // O CLIQUE é o portador: ele dispara e nomeia o estado.
        await linha.click();
        await expect(A.locator('.toast--warning', { hasText: /bloqueado/i })).toBeVisible({ timeout: 6000 });
        await expect(A.locator('.toast--success', { hasText: /colada/i })).toHaveCount(0);

        // E NADA foi escrito, nem aqui nem no par. O toast sozinho não provaria isto: era
        // exatamente a combinação "toast de sucesso + escrita recusada" que motivou a mudança.
        await A.waitForTimeout(2000);
        expect((await readFeatures(A, 'points')).length, 'o dono não escreveu sob a trava').toBe(antes);
        expect((await readFeatures(B, 'points')).length, 'e nada chegou ao par').toBe(antes);

        // CONTROLE: destravado de novo, a MESMA linha volta a colar, e a cópia chega ao par.
        const unlocked = await applyStoreOp(A, 'toggleMapLock', [mapName]);
        expect(unlocked, 'o segundo toggle destrava').toBe(false);

        const idsAntes = (await readFeatures(A, 'points')).map((f) => f.id);
        const menuFinal = await openContextMenu(A);
        const linhaFinal = pasteRow(menuFinal);
        await expect(linhaFinal).not.toHaveAttribute('aria-disabled', 'true');
        await linhaFinal.click();
        await expect.poll(async () => (await readFeatures(A, 'points')).length, { timeout: 10000 })
            .toBeGreaterThan(antes);
        const colado = (await readFeatures(A, 'points')).map((f) => f.id).find((x) => !idsAntes.includes(x));
        expect(colado, 'a colagem destravada cunhou uma feição nova').toBeTruthy();
        // Pela cadeia inteira, e não por contagem: no timeout, o helper nomeia o último estágio.
        await collab.expectFullSync({ entityId: colado, type: 'points', operationType: 'create' });
    });
});
