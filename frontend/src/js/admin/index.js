// Path: js/admin/index.js

/**
 * @fileoverview Public barrel for the admin page. `mountAdminPage()` assembles the shell with the
 * tabs the signed-in user may actually use and renders it into the host element.
 *
 * QUEM RECEBE O QUÊ NÃO SE DECIDE AQUI: a tabela das quatro audiências mora em
 * `admin-audience.js`, uma definição só, consumida também pelo gate da página, pela barra do
 * mapa e pelo seletor de atlas. Este arquivo só traduz os ids que ela devolve nas fábricas de
 * aba, na ordem em que ela os devolve.
 *
 * O recorte não é decoração: `users`, `config` e `personnel` batem numa rota `requireAdmin` já
 * na PRIMEIRA requisição, então oferecê-las a um produtor ou a um usuário comum negaria por 403
 * na montagem, que é a pior forma de dizer não.
 *
 * O gate de entrada vive em `admin-page.js`, que manda para o mapa quem não tem aba nenhuma. O
 * backend gateia toda rota de administração por conta própria, então nenhum dos dois é a
 * fronteira de segurança.
 */

import { sessionContext } from '@store/sync/session-context.js';
import { AdminPanel } from './admin-panel.js';
import { adminAudience } from './admin-audience.js';
import { createUsersTab } from './users-tab.js';
import { createConfigTab } from './config-tab.js';
import { createCatalogTab } from './catalog-tab.js';
import { createPersonnelTab } from './personnel-tab.js';
import { createGroupsTab } from './groups-tab.js';
import { createAuditTab } from './audit-tab.js';

/**
 * As fábricas por id de aba. A ORDEM de montagem é a de `tabIds`, não a deste objeto: um mapa
 * que também mandasse na ordem seria a segunda definição da mesma tabela.
 */
const TAB_FACTORIES = Object.freeze({
    users: createUsersTab,
    groups: createGroupsTab,
    config: createConfigTab,
    catalog: createCatalogTab,
    personnel: createPersonnelTab,
    audit: createAuditTab,
});

/**
 * Builds and mounts the admin page shell.
 * @param {Object} [options]
 * @param {{ id?: string, name?: string }} [options.user] - Identity shown in the top bar.
 * @param {function(): void} [options.onBack] - "Voltar" (the page above this one).
 * @param {function(): void} [options.onLogout] - "Sair".
 * @param {HTMLElement} [host] - Where to render (defaults to `document.body`).
 * @returns {AdminPanel}
 */
export function mountAdminPage({ user, onBack, onLogout } = {}, host = document.body) {
    const { label, tabIds } = adminAudience({
        isAuthenticated: sessionContext.isAuthenticated(),
        isAdmin: sessionContext.isAdmin(),
        isProducer: sessionContext.isProducer(),
    });
    const tabs = tabIds.map((id) => TAB_FACTORIES[id]).filter(Boolean).map((factory) => factory());
    const panel = new AdminPanel(tabs, {
        user,
        onBack,
        onLogout,
        title: label ?? 'Administração',
    });
    panel.mount(host);
    return panel;
}

export { AdminPanel } from './admin-panel.js';
