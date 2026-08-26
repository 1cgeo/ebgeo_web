// Path: tests/e2e-ui/helpers/ferramenta-pronta.js

/**
 * @fileoverview A ESPERA QUE A CARGA TARDIA PASSOU A EXIGIR.
 *
 * Até 2026-08-25 toda ferramenta do mapa era instanciada no boot, então clicar no botão da
 * ferramenta e clicar no mapa na linha seguinte funcionava: o `setActiveTool` era síncrono.
 * Depois de `tool_manager/tool-registry.js`, o clique no botão dispara um `await import()` e
 * RETORNA ANTES de a ferramenta existir. O clique seguinte no mapa cai no vazio e nenhuma feição
 * nasce — e a falha não aparece no clique, aparece no `expect.poll` que espera a feição, dez
 * segundos depois, dizendo apenas "nunca chegou".
 *
 * O QUE ESTE HELPER ESPERA, e por que são duas coisas:
 *
 *   1. `data-loading` sumiu de TODO botão de ferramenta da barra. É o sinal que
 *      `ToolButton.setLoading` escreve enquanto o módulo vem, e ele some tanto no sucesso quanto
 *      no erro (é um `finally`). Sozinho, ele diria só que a espera acabou, não que deu certo.
 *
 *   2. O ToolManager PUBLICOU a ferramenta como ativa. Este é o sinal que vale, e ele é
 *      publicado por `_syncToStateManager` DEPOIS de `activate()` retornar, que é quando o
 *      handler de clique do mapa já está pendurado. É a mesma espera que `collab-helpers.js` já
 *      fazia; aqui ela fica reaproveitável.
 *
 * `esperarCargaDeFerramenta` existe separada porque há casos em que a ferramenta NÃO deve
 * ativar: um papel sem edição (visão segura, mapa bloqueado) clica no botão de propósito para
 * provar que nada acontece. Nesses, esperar por ativação seria esperar pelo que o teste nega.
 */

import { expect } from '@playwright/test';

/** Botão de ferramenta (de grupo ou solto) ainda esperando o módulo chegar. */
const SELETOR_EM_CARGA =
    '.toolbar-tool-btn[data-loading="true"], .toolbar-standalone-btn[data-loading="true"]';

/**
 * Espera o fim do estado de CARGA de qualquer botão de ferramenta da barra.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} [timeout=15000]
 * @returns {Promise<void>}
 */
export async function esperarCargaDeFerramenta(page, timeout = 15000) {
    await expect(page.locator(SELETOR_EM_CARGA)).toHaveCount(0, { timeout });
}

/**
 * Espera a ferramenta chegar E ficar ativa de verdade, pronta para receber cliques no mapa.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} toolId - O `data-tool-id` do botão (`point`, `militarySymbol`, …)
 * @param {number} [timeout=15000]
 * @returns {Promise<void>}
 */
export async function esperarFerramentaPronta(page, toolId, timeout = 15000) {
    await esperarCargaDeFerramenta(page, timeout);

    await page.waitForFunction(async (id) => {
        const s = await import('/src/js/store/index.js');
        const active = s.getStateManager?.()?.getActiveTool?.();
        if (!active) return false;
        // `AddMilitarySymbolControl` vira `militarysymbol` enquanto o id da barra é
        // `militarySymbol`: compara sem caixa e sem separador.
        const norm = (v) => String(v).toLowerCase().replace(/[^a-z0-9]/g, '');
        return norm(active) === norm(id);
    }, toolId, { timeout });
}
