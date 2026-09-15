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

collabTest.describe('Menu da camada — o clique sobrevive a um redesenho da lista', () => {

    collabTest('a lista redesenha durante a leitura de mapas, e o menu abre assim mesmo', async ({ collab }) => {
        // A INTERLEAVING PERDEDORA, POSTA DE PROPÓSITO, em vez de medida por sorteio.
        //
        // Entre o clique em "Mais ações" e o menu há uma leitura assíncrona (a lista de mapas,
        // do repositório). Qualquer redesenho da aba nessa janela matava a abertura de duas
        // maneiras, as duas MUDAS: `closeLayerActionsMenu` (que é o que `_renderOrganizedFeatures`
        // chama ao redesenhar sob um menu aberto) invalidava o token da leitura, e o botão
        // clicado saía do documento junto com o bloco da camada. Na tela: um botão que não faz
        // nada, sem menu e sem aviso. Foi assim que a rodada cheia de 2026-09-13 reprovou o caso
        // do ESTADO abaixo com "`.layer-context-menu` element(s) not found" e nenhum toast na
        // página; em isolamento aquele caso passava 4 de 4, porque a corrida precisa de máquina
        // carregada. Estatística de browser não converge; o evento no instante errado converge.
        //
        // O DRIVER REPRODUZ OS DOIS EFEITOS DO REDESENHO, na ordem em que eles acontecem: fechar
        // o menu e trocar o bloco da camada por um equivalente. Não é o redesenho real (que é
        // assíncrono e não se agenda de fora), são as duas coisas que ele FAZ a esta função, e é
        // sobre elas que o conserto responde.
        const A = collab.author;

        const id = await drawLineUI(A, lineCoords());
        await collab.expectFullSync({ entityId: id, type: 'lines', operationType: 'create' });
        await openLayersTab(A);

        // CONTROLE DO INSTRUMENTO, e ele é obrigatório aqui: o driver chama uma função do
        // MÓDULO, e um `import()` no dev server pode devolver OUTRA instância dele (o Vite serve
        // arquivo recém-editado com `?t=`), caso em que a chamada não tocaria o estado do app e
        // este caso ficaria verde sem ter reproduzido nada. Abrir um menu de verdade e vê-lo
        // FECHAR por essa chamada é a prova de que instrumento e app compartilham a instância.
        await A.locator('.layer-container .layer-menu-btn').first().click();
        await expect(A.locator('.layer-context-menu')).toBeVisible({ timeout: 5000 });
        await A.evaluate(async () => {
            const mod = await import('/src/js/features_tab/layer-list.component.js');
            mod.closeLayerActionsMenu();
        });
        await expect(
            A.locator('.layer-context-menu'),
            'o módulo que o driver importa é o MESMO que o app carregou',
        ).toHaveCount(0);

        // A CORRIDA, agora determinística.
        await A.evaluate(async () => {
            const mod = await import('/src/js/features_tab/layer-list.component.js');
            const botao = document.querySelector('.layer-container .layer-menu-btn');
            const bloco = botao.closest('.layer-container');
            botao.click();                            // a leitura de mapas fica em voo
            mod.closeLayerActionsMenu();              // 1) o redesenho fecha o menu aberto
            bloco.replaceWith(bloco.cloneNode(true)); // 2) e joga fora o botão clicado
        });

        const menu = A.locator('.layer-context-menu');
        // Dez segundos, e não cinco: a leitura de mapas que o clique espera é uma ida ao
        // IndexedDB, e numa máquina carregada ela passa dos cinco. O prazo não afrouxa a
        // asserção, porque o estado ANTIGO não produzia o menu em prazo nenhum.
        await expect(menu, 'o clique produziu o menu, ancorado no botão novo')
            .toBeVisible({ timeout: 10000 });
        await expect(menu.locator('.layer-context-menu-item')).toHaveCount(2);
    });

    collabTest('o redesenho REAL acontece sob o menu aberto, e o menu fica', async ({ collab }) => {
        // O OUTRO INSTANTE DA MESMA CORRIDA, e aqui o redesenho é o DE VERDADE.
        //
        // O caso acima mede a abertura em VOO. Este mede o menu JÁ ABERTO: a aba redesenha a
        // lista inteira a cada `LAYERS_CHANGED`, e um deles chega sozinho (o flush da feição
        // recém-desenhada, a op de um par, a troca de trava). Enquanto o redesenho FECHAVA o
        // menu, ele sumia por causa de trabalho de outra pessoa. Medido em 2026-09-14, já com a
        // abertura em voo consertada: o caso do ESTADO reprovava 1 em 4, com o menu VISÍVEL e
        // zero itens, que é o instante entre o `toBeVisible` e a contagem.
        const A = collab.author;

        const id = await drawLineUI(A, lineCoords());
        await collab.expectFullSync({ entityId: id, type: 'lines', operationType: 'create' });
        await openLayersTab(A);

        await A.locator('.layer-container .layer-menu-btn').first().click();
        const menu = A.locator('.layer-context-menu');
        await expect(menu).toBeVisible({ timeout: 5000 });

        // Marca o bloco ATUAL, para saber depois que ele foi mesmo substituído. Sem esta prova o
        // caso ficaria verde por não ter havido redesenho nenhum, que é cobertura vazia.
        await A.evaluate(() => { document.querySelector('.layer-container').dataset.marcaDoCaso = '1'; });
        await A.evaluate(async () => {
            const { getEventBus } = await import('/src/js/store/services.js');
            const { EventTypes } = await import('/src/js/events/event_types.js');
            getEventBus().emit(EventTypes.LAYERS_CHANGED, {});
        });
        await expect
            .poll(() => A.evaluate(
                () => document.querySelector('.layer-container')?.dataset.marcaDoCaso ?? null,
            ), { timeout: 20000, message: 'a aba redesenhou mesmo a lista (o bloco marcado saiu)' })
            .toBe(null);

        await expect(menu, 'o redesenho reancorou o menu em vez de fechá-lo').toBeVisible();
        await expect(menu.locator('.layer-context-menu-item')).toHaveCount(2);
        // E o botão novo é que carrega o estado de aberto, senão a reancoragem mexeu no menu e
        // esqueceu a metade que o leitor de tela vê.
        await expect(A.locator('.layer-container .layer-menu-btn').first())
            .toHaveAttribute('aria-expanded', 'true');
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
