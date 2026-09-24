// Path: js/catalog/resource-share-launcher.js

/**
 * @fileoverview The ON-DEMAND DOOR of the resource share dialog: the only static entry into it
 * from the catalog.
 *
 * WHY IT TRAVELS BY `import()`. `catalog/catalog.modal.js` rides the map's boot (the sidebar chips
 * import it statically), so its static import of `resource-share.modal.js` put the whole share
 * dialog there too: the core (`resource-share.modal.core.js`), the grant tree and the group
 * phrases, for a command only a producer, a credenciado or an administrator ever sees, and only
 * after two clicks (the catalog, then the card's share action). It is the same class the three
 * account-menu dialogs left on 2026-09-21 (`modals/account-modals-launcher.js`); this one was not
 * in that lot. The measurement is in the commit that introduced this file.
 *
 * The shape is the light loader's (`utilities/luminosidade/carregador.js`), minus the warm-up: a
 * memoized `import()` through `carregarSobDemanda`, which retries once and then shows the notice
 * with "Recarregar". The census of doors (`tests/unit/carga-sob-demanda-portas.test.js`) lists
 * this file. The specifier is a string literal because the bundler and the weight guard only see
 * literals.
 */

import { carregarSobDemanda } from '@utils/carga-sob-demanda.js';

/** @type {Promise<Object>|null} */
let carregando = null;

/**
 * Loads the MAP's entry of the share dialog (the one that re-sums the private catalog after a
 * revocation). A failed load forgets its promise, so the next click tries again.
 * @returns {Promise<typeof import('./resource-share.modal.js')>}
 */
export function carregarCompartilharRecurso() {
    if (!carregando) {
        carregando = carregarSobDemanda(() => import('./resource-share.modal.js'))
            .catch((erro) => {
                carregando = null;
                throw erro;
            });
    }
    return carregando;
}

/**
 * Loads the dialog and opens it. Rejects when the module does not arrive; `carregarSobDemanda`
 * has already told the person, so the caller only swallows a load failure (`ehFalhaDeCarga`).
 * @param {{resourceType: string, resourceId: string, resourceName?: string}} params
 * @returns {Promise<Object>} The modal.
 */
export async function abrirCompartilharRecurso(params) {
    const { showResourceShareModal } = await carregarCompartilharRecurso();
    return showResourceShareModal(params);
}
