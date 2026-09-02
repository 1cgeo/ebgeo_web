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
import { createGrantsTab } from './grants-tab.js';
import { createAuditTab } from './audit-tab.js';
import { createAccountTab } from './account-tab.js';
// As DUAS abas tardias entram por metadado + `import()`, nunca por import estático: ver
// `lazy-tab.js` para a medida e para as três propriedades que o embrulho garante. Os ícones já
// moravam em `admin-dom.js` (compartilhado com o trilho), então nada foi duplicado para cá.
import { lazyTab } from './lazy-tab.js';
import { ICON_DIAG, ICON_USO } from './admin-dom.js';

/**
 * O metadado ANSIOSO das duas abas tardias: o que o trilho de navegação precisa saber antes de
 * qualquer clique (`_buildRail`, `admin-panel.js`).
 *
 * ELE É A CÓPIA DO QUE A FÁBRICA REAL DEVOLVE, e essa duplicação é o preço declarado da carga
 * tardia: adiar o rótulo faria o painel abrir com um trilho de botões sem nome. Quem impede as
 * duas cópias de divergirem é `frontend/tests/unit/admin-abas-tardias.test.js`, que lê os dois
 * literais da FONTE (não importa nenhum dos dois módulos, justamente para não arrastar aqui a
 * superfície que esta mudança tirou dali) e exige igualdade campo a campo. O ícone NÃO é cópia:
 * ele vem do mesmo `admin-dom.js` que a aba real usa.
 * @type {import('./lazy-tab.js').AbaTardiaMeta}
 */
const META_DIAGNOSTICO = Object.freeze({
    id: 'diagnostico',
    label: 'Diagnóstico',
    testid: 'admin-tab-diagnostico',
    icon: ICON_DIAG,
});

/** @type {import('./lazy-tab.js').AbaTardiaMeta} Irmã de {@link META_DIAGNOSTICO}. */
const META_USO = Object.freeze({
    id: 'uso',
    label: 'Uso',
    testid: 'admin-tab-uso',
    icon: ICON_USO,
});

/**
 * As fábricas das duas abas TARDIAS, e a razão de elas serem tardias é de PAYLOAD, não de
 * audiência: `diagnostico` e `uso` são as duas telas mais caras do painel e só o administrador
 * global as recebe, mas o bundler não lê `adminAudience` — ele empacota o que o grafo de imports
 * alcança, e o import estático que morava no topo deste arquivo mandava as duas para o chunk de
 * entrada de TODA audiência, inclusive a do credenciado, que recebe duas abas e nenhuma é destas.
 *
 * ELAS SÃO CONSTANTES NOMEADAS, e não literais dentro do registro abaixo, por um motivo que se
 * descobriu quebrando: o registro é lido por VARREDURA DE FONTE em duas suítes
 * (`admin-audiencia.test.js` e `admin-abas-tardias.test.js`), e o parser mais antigo recorta o
 * literal até a primeira chave de fechamento. Um corpo de função dentro do literal o encerrava no
 * meio, e o guarda passava a medir metade do registro. Uma linha por id é a forma que as duas
 * varreduras leem, e ela também é a que se lê de relance.
 * @param {Object} principal - O perfil, repassado à fábrica real como num import estático.
 * @returns {import('./admin-panel.js').AdminTab}
 */
const carregarDiagnostico = (principal) => lazyTab(META_DIAGNOSTICO, async () => {
    const { createDiagTab } = await import('./diag-tab.js');
    return createDiagTab(principal);
});

/** @param {Object} principal @returns {import('./admin-panel.js').AdminTab} Irmã da de cima. */
const carregarUso = (principal) => lazyTab(META_USO, async () => {
    const { createUsoTab } = await import('./uso-tab.js');
    return createUsoTab(principal);
});

/**
 * As fábricas por id de aba. A ORDEM de montagem é a de `tabIds`, não a deste objeto: um mapa
 * que também mandasse na ordem seria a segunda definição da mesma tabela.
 */
const TAB_FACTORIES = Object.freeze({
    users: createUsersTab,
    groups: createGroupsTab,
    grants: createGrantsTab,
    config: createConfigTab,
    catalog: createCatalogTab,
    personnel: createPersonnelTab,
    audit: createAuditTab,
    diagnostico: carregarDiagnostico,
    uso: carregarUso,
    account: createAccountTab,
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
    const principal = {
        isAuthenticated: sessionContext.isAuthenticated(),
        isAdmin: sessionContext.isAdmin(),
        isProducer: sessionContext.isProducer(),
    };
    const { label, tabIds } = adminAudience(principal);
    // O PERFIL VAI PARA TODA FÁBRICA, e não só para a que hoje o usa: quem lê a sessão já é este
    // arquivo, e uma aba que a lesse por conta própria seria a segunda leitura do mesmo fato,
    // com a chance de discordar da audiência que acabou de decidir quais abas existem. As
    // fábricas que não precisam dele simplesmente ignoram o argumento.
    const tabs = tabIds.map((id) => TAB_FACTORIES[id]).filter(Boolean)
        .map((factory) => factory(principal));
    // O FALLBACK NÃO PODE SER "Administração", e essa era a moldura desfazendo o cuidado da
    // audiência: `adminAudience` nomeia o que a pessoa RECEBE justamente para não prometer um poder
    // que o primeiro clique nega, e um `?? 'Administração'` devolve a promessa pela porta dos
    // fundos. O ramo é defensivo (quem chega aqui sem rótulo já foi mandado para o mapa pelo gate
    // de `admin-page.js`), e é por isso mesmo que ele tem de ser o mais MODESTO possível: "Painel"
    // é verdadeiro para toda audiência que esta página admite, e é a mesma palavra que
    // `admin-page.js` usa no título provisório da aba, pela mesma razão.
    const panel = new AdminPanel(tabs, {
        user,
        onBack,
        onLogout,
        title: label ?? 'Painel',
    });
    panel.mount(host);
    return panel;
}

export { AdminPanel } from './admin-panel.js';
