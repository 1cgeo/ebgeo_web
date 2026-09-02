// Path: e2e-ui/browser-layer-transfer-permissions.spec.js

/**
 * O MENU "mais ações" DA CAMADA, NA TELA: a assimetria POSTO/ESTADO com browser real.
 *
 * `tests/unit/menu-de-camada-por-estado.test.js` prende a DECISÃO (o modelo puro
 * `features_tab/layer-menu-actions.js`). Ele não sabe nada sobre DOM, e por isso não sabe se
 * a decisão chegou à tela. Este arquivo mede a metade que falta, e só ela:
 *
 *   - O LEITOR (permission: 'read') não alcança nem criar nem apagar feição, então os DOIS
 *     comandos são escondidos por POSTO e o menu não abre. O que ele recebe é um aviso,
 *     porque um botão que não faz nada se lê como quebrado.
 *   - O DONO com o mapa TRAVADO recebe os dois comandos DESENHADOS. "Mover" chega com
 *     `aria-disabled` e SEM a propriedade `disabled`, e o clique nele NOMEIA o estado. Essa
 *     é a regra da casa em uma frase: botão desabilitado não dispara clique, e o clique é
 *     como o motivo chega à pessoa.
 *   - "Copiar" atravessa a trava, porque copiar lê a origem e escreve em outro lugar.
 *
 * A trava é posta pela op crua (`toggleMapLock`), como em `browser-collab-lock.spec.js`.
 * Isso trava APENAS este cliente, o que é exatamente o suficiente aqui: o sujeito é a
 * afordância na tela de quem segura a trava, não a propagação dela.
 *
 * Rodar de cabeça:  npx playwright test browser-layer-transfer-permissions --headed
 */

import { collabTest, expect, drawLineUI, openLayersTab } from './helpers/collab.fixtures.js';

/** Drives a store op on `page` through the app's REAL store facade. */
function applyStoreOp(page, opName, args) {
    return page.evaluate(async ({ name, a }) => {
        const store = await import('/src/js/store/index.js');
        return store[name](...a);
    }, { name: opName, a: args });
}

const lineCoords = () => [[-43.2, -22.9], [-43.15, -22.85], [-43.1, -22.8]];

collabTest.describe('Menu da camada — o POSTO esconde', () => {
    collabTest.use({ collabOptions: { peers: 1, permission: 'read', mapName: 'Mapa Tático' } });

    collabTest('o Leitor não recebe comando nenhum, e o menu não abre', async ({ collab }) => {
        const A = collab.author;   // dono
        const B = collab.peers[0]; // leitor

        // O dono desenha, para que o leitor tenha uma camada com conteúdo na tela.
        const id = await drawLineUI(A, lineCoords());
        await collab.expectFullSync({ entityId: id, type: 'lines', operationType: 'create' });

        await openLayersTab(B);

        // O botão CONTINUA desenhado: ele não é o comando, é a porta para eles, e ela é a
        // mesma para todo mundo. O que muda é o que há atrás.
        const botao = B.locator('.layer-container .layer-menu-btn').first();
        await expect(botao).toBeVisible({ timeout: 10000 });
        await botao.click();

        // Nenhum comando sobreviveu ao posto, então não há menu para desenhar.
        await expect(B.locator('.layer-context-menu')).toHaveCount(0);
        await expect(B.locator('.toast--warning')).toBeVisible({ timeout: 5000 });

        // CONTROLE POSITIVO, sem o qual o caso acima passaria com um seletor errado: o DONO,
        // no mesmo atlas e na mesma tela, recebe os dois comandos.
        await openLayersTab(A);
        await A.locator('.layer-container .layer-menu-btn').first().click();
        await expect(A.locator('.layer-context-menu')).toBeVisible({ timeout: 5000 });
        await expect(A.locator('.layer-context-menu .layer-context-menu-item')).toHaveCount(2);
    });
});

collabTest.describe('Menu da camada — o ESTADO desenha e recusa o clique', () => {

    collabTest('mapa travado: mover vem aria-disabled e o clique nomeia o estado', async ({ collab }) => {
        const A = collab.author; // dono

        const id = await drawLineUI(A, lineCoords());
        await collab.expectFullSync({ entityId: id, type: 'lines', operationType: 'create' });

        // Um segundo mapa, senão o bloqueio que se mede seria o de "atlas com um mapa só".
        await applyStoreOp(A, 'addMap', ['Mapa Destino']);

        const travou = await applyStoreOp(A, 'toggleMapLock', [collab.mapName]);
        expect(travou, 'o dono travou o mapa corrente').toBe(true);

        await openLayersTab(A);
        await A.locator('.layer-container .layer-menu-btn').first().click();

        const menu = A.locator('.layer-context-menu');
        await expect(menu).toBeVisible({ timeout: 5000 });
        const itens = menu.locator('.layer-context-menu-item');
        await expect(itens).toHaveCount(2);

        const mover = itens.filter({ hasText: 'Mover para outro mapa' });
        const copiar = itens.filter({ hasText: 'Copiar para outro mapa' });

        // O comando bloqueado por ESTADO é desenhado, marcado por `aria-disabled` e NUNCA
        // pela propriedade `disabled`: um botão desabilitado não dispara clique, e é o
        // clique que carrega o motivo até a pessoa.
        await expect(mover).toHaveAttribute('aria-disabled', 'true');
        // NUNCA a propriedade `disabled` (o clique é como o motivo chega). Não use `toBeEnabled()`:
        // o Playwright lê `aria-disabled="true"` como desabilitado e a asserção mediria o contrário.
        expect(await mover.evaluate((el) => el.disabled === true)).toBe(false);
        // Copiar atravessa a trava: ele lê a origem e escreve em outro lugar.
        await expect(copiar).not.toHaveAttribute('aria-disabled', 'true');

        // `dispatchEvent`, não `click()`: o Playwright lê `aria-disabled="true"` como "não
        // habilitado" e espera para sempre por um botão que a casa desenha assim de propósito.
        await mover.dispatchEvent('click');
        const aviso = A.locator('.toast--warning');
        await expect(aviso).toBeVisible({ timeout: 5000 });
        // A frase NOMEIA o estado (a trava) e a saída (copiar), em vez de falar de papel.
        await expect(aviso).toContainText('travado');

        // E nada aconteceu: o modal de destino não abriu.
        await expect(A.locator('#layer-transfer-modal')).toHaveCount(0);

        // CONTROLE: destravado, o mesmo comando fica vivo.
        const destravou = await applyStoreOp(A, 'toggleMapLock', [collab.mapName]);
        expect(destravou).toBe(false);
        await openLayersTab(A);
        await A.locator('.layer-container .layer-menu-btn').first().click();
        const moverVivo = A.locator('.layer-context-menu .layer-context-menu-item')
            .filter({ hasText: 'Mover para outro mapa' });
        await expect(moverVivo).toBeVisible({ timeout: 5000 });
        await expect(moverVivo).not.toHaveAttribute('aria-disabled', 'true');
    });
});
