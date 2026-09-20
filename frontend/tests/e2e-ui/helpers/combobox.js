// Path: e2e-ui/helpers/combobox.js

/**
 * @fileoverview Drives a `ui/searchable-select.js` combobox from a spec.
 *
 * IT IS NOT `selectOption`. The control is an `<input role="combobox">` with a listbox parked on
 * `document.body`, so Playwright's `<select>` API does not reach it, and the specs that used to
 * say `selectOption({ label: '…' })` on the unit field now come through here.
 *
 * WHAT IT ASSERTS AS IT GOES, because the alternative is a spec that fails five lines later with
 * a message about something else: the list opens, at least one option matches, and the list closes
 * after the pick. A silent `click()` on an option that never rendered would time out naming the
 * option, which reads like a missing unit rather than a combobox that did not open.
 */

import { expect } from '@playwright/test';

/**
 * Types a term into a combobox and picks an option from the filtered list.
 * @param {import('@playwright/test').Page} page
 * @param {string} testid - `data-testid` of the combobox input (the list is `${testid}-list`).
 * @param {Object} [options]
 * @param {string} [options.termo] - What to type; '' just opens the whole list.
 * @param {string} [options.rotulo] - Text of the option to pick; defaults to the first one.
 * @returns {Promise<string>} The label of the option actually chosen.
 */
export async function escolherNoCombobox(page, testid, { termo = '', rotulo = null } = {}) {
    const input = page.locator(`[data-testid="${testid}"]`);
    const list = page.locator(`[data-testid="${testid}-list"]`);

    await input.click();
    if (termo) await input.fill(termo);
    await expect(list).toBeVisible();

    const opcoes = list.locator('[role="option"]');
    const alvo = rotulo ? opcoes.filter({ hasText: rotulo }).first() : opcoes.first();
    await expect(alvo).toBeVisible();
    const escolhido = (await alvo.innerText()).trim();

    await alvo.click();
    await expect(list).toBeHidden();
    return escolhido;
}
