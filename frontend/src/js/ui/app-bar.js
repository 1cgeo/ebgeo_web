// Path: js/ui/app-bar.js

/**
 * @fileoverview The top bar shared by the app's map-less PAGES (`admin.html`, `atlas.html`):
 * brand on the left, then page actions, the signed-in identity, and "Sair".
 *
 * It exists because those pages cannot reuse `AccountControl` — that one is a MapLibre `IControl`
 * and only exists inside a map. Rather than each page growing its own header (and drifting), the
 * chrome lives here once. Deliberately dependency-light: every import below is a FILE, never a
 * barrel, because the pages that use it boot without the store and `@utils`/`@modals`/`@store`
 * reach it transitively.
 *
 * IT SHOWS WHO YOU ARE, NOT ONLY WHAT YOU ARE CALLED. The bar used to draw the username and stop
 * there, so nobody could find out their own GLOBAL role on any page of the app (the four pt-BR
 * names lived in the admin tab that names OTHER people's roles). The badge is drawn from
 * `ui/role-labels.js`, with the one-sentence explanation as its `title`; a producer also gets the
 * organization they maintain, which is the boundary they act inside.
 *
 * WHERE THE ROLE COMES FROM, and why it is not a parameter: the bar reads `sessionContext`
 * itself. `admin.html` builds this bar through `admin/admin-panel.js`, which forwards only id and
 * name, so a badge fed by the caller would appear on one page and not the other, which is exactly
 * the divergence a shared chrome exists to prevent. (There is a second, sharper reason not to
 * hand `globalRole` around as a property: `tests/unit/session-context.test.js` forbids the five
 * session-hydration sites from assembling that shape by hand, and the page reading its own
 * session to re-emit the field is one keystroke away from being that.)
 */

import { setupCleanup, addDomListener, cleanup } from '@utils/event-cleanup.js';
import { getPresenceColor, getInitials } from '@js/presence/presence-colors.js';
// From the FILE: the module is a leaf with zero imports (see its fileoverview).
import { globalRoleBadge } from '@ui/role-labels.js';
// From the FILE: `session-context.js` reaches only `operation-factory.js`, which both map-less
// pages already load. The `@store` BARREL is what would drag the map foundation in.
import { sessionContext } from '@store/sync/session-context.js';
// The single id → OM name resolution of the app, reading the `GET /api/config` payload the page
// already hydrated. It imports `@js/config.js` and nothing else.
import { orgLabel } from '@js/admin/org-options.js';
// A definição única das audiências de `admin.html`, folha e sem imports. Ela entra aqui desde
// 2026-08-25, quando "Minha conta" virou aba: este botão passou a ser uma PORTA para aquela
// página, e porta se decide por ela, nunca por um predicado escrito de novo aqui.
import { adminAudience } from '@js/admin/admin-audience.js';
// Modulo folha, zero imports: a mesma frase serve as tres paginas sem mapa e o mapa.
import { producerOrgInactiveNotice } from './producer-org-notice.js';

const LOGOUT_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>`;
const ACCOUNT_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

/**
 * O id da aba de "Minha conta". A lista de quem a recebe é de `adminAudience`, e este literal só
 * nomeia qual aba perguntar; escrevê-lo aqui não duplica decisão nenhuma.
 */
const ACCOUNT_TAB_ID = 'account';

/** "Minha conta", que é a aba `account` do painel. Relativa: o app pode ser servido num subcaminho. */
const ACCOUNT_URL = `./admin.html?aba=${ACCOUNT_TAB_ID}`;

/**
 * @typedef {Object} AppBarAction
 * @property {string} label - pt-BR button label.
 * @property {string} [icon] - Static SVG markup (no user data).
 * @property {string} [testid] - data-testid for the button.
 * @property {string} [title] - Tooltip / accessible hint.
 * @property {function(): void} onClick
 */

/**
 * Builds the shared page top bar.
 *
 * @param {Object} options
 * @param {string} options.title - Page title (pt-BR).
 * @param {string} [options.subtitle] - Small caption under the title.
 * @param {string} [options.icon] - Static SVG for the brand mark.
 * @param {string} [options.logo] - URL of a brand IMAGE, used instead of `icon` when both are
 *   given. Root-relative (`/images/…`), never a data URI: the same asset the boot splash already
 *   fetched, so it comes from the HTTP cache.
 * @param {{ id?: string, name?: string }} [options.user] - Signed-in identity; omitted when
 *   unknown. The global-role badge is NOT a property of it: the bar reads the session itself.
 * @param {AppBarAction[]} [options.actions] - Page actions, rendered left to right before the identity.
 * @param {boolean} [options.showAccount] - Se a porta de "Minha conta" entra nesta montagem.
 *   Padrão `true`, que é o que as três páginas com painel querem. Uma página em que a conta não é
 *   o destino útil desliga a porta e põe a sua em `actions` (ver a seção abaixo).
 * @param {function(): void} [options.onLogout] - Renders "Sair" when provided.
 * @returns {{ element: HTMLElement, destroy: function(): void }}
 */
export function createAppBar({
    title, subtitle, icon, logo = null, user = null, actions = [], showAccount = true,
    onLogout = null,
}) {
    /** Cleanup host — `addDomListener` tracks against any object. */
    const scope = {};
    setupCleanup(scope);

    const header = document.createElement('header');
    header.className = 'app-bar';

    // ----- Brand -----
    const brand = document.createElement('div');
    brand.className = 'app-bar__brand';
    if (logo) {
        // An <img>, not the SVG mark: the logo is a raster asset, and the page's own boot splash
        // already loaded it, so this costs no request.
        const mark = document.createElement('img');
        mark.className = 'app-bar__brand-logo';
        mark.src = logo;
        mark.alt = title;
        brand.appendChild(mark);
    } else if (icon) {
        const mark = document.createElement('span');
        mark.className = 'app-bar__brand-mark';
        mark.innerHTML = icon; // static icon, no user data
        brand.appendChild(mark);
    }
    const titles = document.createElement('div');
    const h = document.createElement('h1');
    h.className = 'app-bar__title';
    h.textContent = title;
    titles.appendChild(h);
    if (subtitle) {
        const sub = document.createElement('p');
        sub.className = 'app-bar__subtitle';
        sub.textContent = subtitle;
        titles.appendChild(sub);
    }
    brand.appendChild(titles);
    header.appendChild(brand);

    // ----- Actions + identity + logout -----
    const bar = document.createElement('div');
    bar.className = 'app-bar__actions';

    for (const action of actions) {
        bar.appendChild(buildAction(scope, action));
    }

    // A PORTA DO ESTÚDIO DE CALIBRAÇÃO 360 NÃO MORA MAIS AQUI. Ela foi um botão global desta
    // barra até 2026-08-25, quando o chefe a mandou para o CATÁLOGO, na linha de cada projeto
    // 360 (`admin/catalog-tab.js`). O motivo é de endereço, não de permissão: calibrar é sempre
    // calibrar UM projeto, e o botão global levava ao seletor, obrigando a escolher de novo o
    // projeto que a pessoa já tinha na tela. O gate real nunca esteve aqui: `calibracao-page.js`
    // recusa quem não é admin nem produtor, e o servidor recusa toda escrita 360 pela OM dona.

    const name = (user?.name || '').trim();
    if (name) {
        const identity = document.createElement('div');
        identity.className = 'app-bar__identity';
        identity.dataset.testid = 'app-bar-user';

        const avatar = document.createElement('span');
        avatar.className = 'app-bar__avatar';
        avatar.setAttribute('aria-hidden', 'true');
        avatar.textContent = getInitials(name);
        // Same deterministic hue as this user's cursor/roster entry elsewhere in the app.
        avatar.style.backgroundColor = getPresenceColor(String(user?.id || name));

        const text = document.createElement('div');
        text.className = 'app-bar__identity-text';

        const label = document.createElement('span');
        label.className = 'app-bar__username';
        label.textContent = name;
        label.title = name;
        text.appendChild(label);

        const badge = buildRoleBadge();
        if (badge) text.appendChild(badge);

        identity.append(avatar, text);
        bar.appendChild(identity);
    }

    // "MINHA CONTA" TINHA UMA PORTA SÓ, E ELA FICAVA DENTRO DO MAPA.
    // A tela era um modal com um único chamador em `frontend/src/js/`, o menu do avatar
    // de `AccountControl`, que é `IControl` do MapLibre e por isso só existe dentro de um mapa. Ao
    // mesmo tempo, o roteamento de boot manda todo visitante COM sessão numa URL nua direto para
    // `atlas.html`: o caminho padrão do produto levava a pessoa exatamente para a página que não
    // tinha a porta. Trocar a própria senha ou corrigir o próprio e-mail exigia abrir um atlas e
    // esperar o bundle do mapa.
    //
    // ELA DEIXOU DE SER MODAL EM 2026-08-25 e virou ABA do painel (`admin/account-tab.js`), por
    // decisão do chefe. O botão passou de "abre um modal aqui" para "navega até a aba", e o
    // `import()` dinâmico do modal saiu junto: o destino é uma URL.
    //
    // O CASO QUE PRECISA DE DECISÃO É A PRÓPRIA `admin.html`, onde este botão navega para a página
    // em que já se está. A escolha é NAVEGAR MESMO, e não alcançar o painel daqui: esta barra é
    // compartilhada por três páginas e não conhece painel nenhum, então dar-lhe um atalho para o
    // `AdminPanel` acoplaria a barra a uma das três. O custo é um recarregamento, e o desfecho é o
    // certo nos dois casos, porque `?aba=account` é lido na montagem.
    //
    // A CONDIÇÃO PASSOU A SER A AUDIÊNCIA, e não `sessionContext.isAuthenticated()` sozinho. As
    // duas dão o mesmo resultado hoje (as três audiências da porta recebem `account`), e não é
    // por isso que a linha mudou: o botão virou porta para `admin.html`, e a regra da casa é que
    // quem decide porta consome `adminAudience`. Um recorte futuro desta aba passa a valer aqui
    // sem ninguém lembrar deste arquivo. Nunca é `user?.name`, pela razão de
    // `AccountControl._openMenu`: o nome é rótulo, a autoridade é estar logado.
    // E ELA É DESLIGÁVEL POR OPÇÃO desde 2026-08-25, por decisão do chefe sobre a CALIBRAÇÃO.
    // Naquela tela "Minha conta" não leva a lugar nenhum de útil, e o caminho que falta é o de
    // volta: desde a mesma data a calibração se alcança pela LINHA do projeto na aba Catálogo,
    // então o botão que serve ali é "Catálogo".
    //
    // A ESCOLHA É UMA OPÇÃO, E NUNCA UM `if` SOBRE O NOME DO ARQUIVO DA PÁGINA. Esta barra é
    // compartilhada por quatro páginas e não conhece nenhuma delas; conhecer uma seria o começo
    // de conhecer as quatro, e o arquivo passaria a mudar toda vez que uma delas mudasse. Quem
    // desliga a porta põe a sua em `actions`, que é o mecanismo que já existe para isso.
    if (showAccount && adminAudience({
        isAuthenticated: sessionContext.isAuthenticated(),
        isAdmin: sessionContext.isAdmin(),
        isProducer: sessionContext.isProducer(),
    }).tabIds.includes(ACCOUNT_TAB_ID)) {
        bar.appendChild(buildAction(scope, {
            label: 'Minha conta',
            icon: ACCOUNT_ICON,
            testid: 'app-bar-account',
            title: 'Ver e editar seus dados, trocar a senha e trocar o e-mail da conta',
            onClick: () => window.location.assign(ACCOUNT_URL),
        }));
    }

    if (onLogout) {
        bar.appendChild(buildAction(scope, {
            label: 'Sair',
            icon: LOGOUT_ICON,
            testid: 'app-bar-logout',
            onClick: onLogout,
        }));
    }

    header.appendChild(bar);

    // A TARJA DA OM PRODUTORA SUSPENSA, quando for o caso.
    //
    // Ela e persistente e nao um toast de proposito: o estado dura enquanto a OM estiver
    // desativada, e um aviso que some deixa a pessoa diante de um painel funcional cujas
    // gravacoes voltam 404, sem nada na tela ligando uma coisa a outra. Aparece DEPOIS da barra,
    // e nao dentro dela, para nao competir com identidade e acoes.
    const aviso = producerOrgInactiveNotice({
        inativa: sessionContext.isProducerOrgInactive(),
        nome: sessionContext.producerOrgName,
    });
    if (aviso) {
        const tarja = document.createElement('div');
        tarja.className = 'app-bar__notice';
        tarja.dataset.testid = 'app-bar-producer-suspended';
        tarja.setAttribute('role', 'status');
        const forte = document.createElement('strong');
        forte.textContent = aviso.title;
        const texto = document.createElement('span');
        texto.textContent = aviso.message;
        tarja.append(forte, texto);
        header.appendChild(tarja);
    }

    return {
        element: header,
        destroy: () => cleanup(scope),
    };
}

/**
 * The GLOBAL-role badge shown under the username: one word, plus the sentence that explains it as
 * the `title`. Absent for a visitor with no role, on purpose (see the fileoverview).
 * @returns {HTMLElement|null}
 */
function buildRoleBadge() {
    const role = sessionContext.globalRole;
    const orgId = sessionContext.producerOrgId;
    // `orgLabel` falls back to the raw id for an OM missing from the active list, and to '' here
    // for no OM at all: the badge must never read "—" as if it were an organization.
    // O NOME VEM DO SERVIDOR PRIMEIRO, e `orgLabel` e so o recuo. `config.organizacoesMilitares`
    // so traz OM ATIVA, entao para uma OM produtora DESATIVADA a lista nao tem a linha e
    // `orgLabel` cai no id bruto: a tela imprimia um UUID ao lado da palavra "Produtor". O
    // payload de sessao passou a trazer `producer_org_nome` justamente para este caso.
    const orgName = sessionContext.producerOrgName || (orgId ? orgLabel(orgId, '') : '');
    const badge = globalRoleBadge(role, { orgName });
    if (!badge) return null;

    const el = document.createElement('span');
    el.className = 'app-bar__role';
    el.dataset.testid = 'app-bar-role';
    el.title = badge.title;

    const word = document.createElement('span');
    word.className = 'app-bar__role-name';
    word.textContent = badge.label;
    el.appendChild(word);

    // The OM is shown, not only hinted: it is the boundary a producer acts inside, and until now
    // the only screen that ever named it was the catalogue's create form.
    if (orgName && role === 'producer') {
        const om = document.createElement('span');
        om.className = 'app-bar__role-org';
        om.textContent = orgName;
        el.appendChild(om);
    }
    return el;
}

/**
 * @param {Object} scope - Cleanup host.
 * @param {AppBarAction} action
 * @returns {HTMLButtonElement}
 */
function buildAction(scope, action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'app-bar__action';
    if (action.testid) btn.dataset.testid = action.testid;
    if (action.title) btn.title = action.title;

    if (action.icon) {
        const ic = document.createElement('span');
        ic.className = 'app-bar__action-icon';
        ic.setAttribute('aria-hidden', 'true');
        ic.innerHTML = action.icon; // static icon, no user data
        btn.appendChild(ic);
    }
    const text = document.createElement('span');
    text.className = 'app-bar__action-label';
    text.textContent = action.label;
    btn.appendChild(text);

    addDomListener(scope, btn, 'click', () => action.onClick?.());
    return btn;
}
