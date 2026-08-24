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
// Modulo folha, zero imports: a mesma frase serve as tres paginas sem mapa e o mapa.
import { producerOrgInactiveNotice } from './producer-org-notice.js';

const LOGOUT_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>`;
const CALIBRATION_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>`;

const ACCOUNT_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

/** The 360 calibration studio. Relative: the app may be served from a subpath. */
const CALIBRATION_URL = './calibracao.html';

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
 * @param {function(): void} [options.onLogout] - Renders "Sair" when provided.
 * @returns {{ element: HTMLElement, destroy: function(): void }}
 */
export function createAppBar({
    title, subtitle, icon, logo = null, user = null, actions = [], onLogout = null,
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

    // A porta do estúdio de calibração 360, para quem o gate da própria página aceita. Ela não era
    // linkada de lugar nenhum: só se chegava lá digitando a URL.
    if (mayCalibrate()) {
        bar.appendChild(buildAction(scope, {
            label: 'Calibração 360',
            icon: CALIBRATION_ICON,
            testid: 'app-bar-calibration',
            title: 'Abrir o estúdio de calibração 360: alinhar as fotos esféricas dos projetos que você mantém',
            onClick: () => window.location.assign(CALIBRATION_URL),
        }));
    }

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
    // `showAccountSettingsModal` tinha um único chamador em `frontend/src/js/`, o menu do avatar
    // de `AccountControl`, que é `IControl` do MapLibre e por isso só existe dentro de um mapa. Ao
    // mesmo tempo, o roteamento de boot manda todo visitante COM sessão numa URL nua direto para
    // `atlas.html`: o caminho padrão do produto levava a pessoa exatamente para a página que não
    // tinha a porta. Trocar a própria senha ou corrigir o próprio e-mail exigia abrir um atlas e
    // esperar o bundle do mapa.
    //
    // A tela ainda ganhou conteúdo desde então (perfil, senha, chave de API, leitura e troca do
    // e-mail), o que só piorou o desequilíbrio. Os CSS das três páginas já traziam o comentário
    // afirmando que ela abre de todas; agora abre.
    //
    // `import()` dinâmico de propósito: o modal é pesado e nenhuma das duas páginas o usa no
    // caminho comum. A condição é a sessão, e não `user?.name`, pela mesma razão de
    // `AccountControl._openMenu`: o nome é rótulo, a autoridade é estar logado.
    if (sessionContext.isAuthenticated()) {
        bar.appendChild(buildAction(scope, {
            label: 'Minha conta',
            icon: ACCOUNT_ICON,
            testid: 'app-bar-account',
            title: 'Ver e editar seus dados, trocar a senha e obter uma chave de API',
            onClick: async () => {
                const { showAccountSettingsModal } = await import('@modals/account-settings.modal.js');
                await showAccountSettingsModal();
            },
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
 * Whether this session may open `calibracao.html`.
 *
 * THE PREDICATE IS NOT REIMPLEMENTED HERE: it is the same pair of `sessionContext` calls the page
 * itself makes (`calibration/calibracao-page.js`), on the GLOBAL axis. A copy that drifts would
 * offer a door that redirects straight back to the map, or hide one from a producer whose whole
 * job is maintaining what their OM produced. Nothing here is a boundary: the server refuses every
 * 360 write by owning OM.
 * @returns {boolean}
 */
function mayCalibrate() {
    return sessionContext.isAdmin() || sessionContext.isProducer();
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
