// Path: js/projects/atlas-drive.js

/**
 * @fileoverview Atlas Drive — the project chooser ("Google Drive of maps"). Lists the user's server
 * atlases as a card grid with tabs (Recentes / Meus / Compartilhados / Públicos / Lixeira) and a name
 * search, plus per-card actions. WHICH actions is {@link cardMenuActions}, a pure function, and the
 * list here would be a second copy of it that ages: read that one.
 *
 * SHARING CANNOT BE ADMINISTERED FROM THIS PAGE, and that is a MEASUREMENT, not an oversight.
 * `modals/sharing.modal.js` is the screen that grants and revokes, and it cannot be loaded here:
 * walking its import graph on 2026-08-23 reached 188 modules against this page's 50, including
 * `@store/services.js` (and through it `store/store.js`, `store/index.js`, `layers/index.js`,
 * `state/index.js`, `tool_manager/index.js`, `@utils/index.js`), plus `@modals/index.js` and
 * `@store/sync/sync-engine.js`. And the weight is the smaller half: its `render()` calls
 * `getEventBus()`, which throws when `initServices()` never ran, which is the definition of this
 * page. A dynamic `import()` would move the download and keep the crash. What this page offers
 * instead is {@link AtlasAccessModal}, the READING half, gated at `manage` like the server route it
 * calls. Making the full modal reachable means first cutting its three store-bound imports (all
 * three serve the "Vendo agora" presence block, which is meaningless outside a live atlas), and
 * that is a change to THAT file, not to this one.
 *
 * It is the BODY of `atlas.html`, not a modal: it used to be a full-screen overlay stacked on the
 * booted map (`modals/project-picker.modal.js`), which meant choosing a project happened on top of a
 * map you had not chosen yet, and closing it dropped you on a blank local workspace nobody asked for.
 * As a page it has its own URL, its own back/forward, and no map behind it. The `project-picker-*`
 * testids are kept verbatim so the existing e2e specs stay valid.
 *
 * Opening is a NAVIGATION (`./?atlas=<uuid>`), so this component never touches the store or the sync
 * engine — the map page owns those, and its `openRemoteAtlas` already handles wipe/connect plus the
 * unsaved-local-work question. Dynamic text goes through textContent; icons are static SVG.
 *
 * The file also exports {@link LocalAtlasSection}, the "Neste computador" half of the page. It is a
 * SEPARATE component, not a sixth tab of this one: the five tabs (Recentes / Meus / Compartilhados /
 * Públicos / Lixeira) are all server concepts, and a local atlas has no owner, no permission and no
 * trash. It is equally store-free — every local operation arrives as a callback from
 * `projects-page.js`, which is the single file on this page allowed to call the local-atlas API.
 */

import { showCreateAtlasModal } from '@modals/create-atlas.modal.js';
import { showConfirm } from '@modals/confirm.modal.js';
import { showPrompt } from '@modals/prompt.modal.js';
// Import DIRETO do arquivo, NUNCA `@modals` (o barrel): `modal.base.js` alcança dois módulos ao
// todo (ele mesmo e `@utils/event-cleanup.js`), enquanto o barrel arrasta a store para uma página
// que boota sem ela. Medido em 2026-08-23; o mesmo critério que já rege `confirm`/`prompt` acima.
import { ModalBase } from '@modals/modal.base.js';
import { apiClient } from '@store/sync/api-client.js';
import { fileToCoverPayload } from './cover-image.js';
import {
    setupCleanup, addDomListener, addScopedDomListener, clearScopedListeners, cleanup, removeElement,
} from '@utils/event-cleanup.js';
import { getPresenceColor, getInitials } from '@js/presence/presence-colors.js';
import {
    getPermissionLabel, isKnownPermission, hasAtLeast, permissionRank,
} from '@js/projects/permission-levels.js';
import { showSuccess, showError } from '@utils/toast_service.js';

const ICONS = {
    plus: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    dots: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>`,
    globe: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    search: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    upload: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/></svg>`,
    lock: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`,
    // Serve ao cabeçalho do painel de acesso E ao avatar de uma linha de GRUPO. O coletivo nunca
    // usa o avatar de iniciais coloridas: aquele deriva cor e letras de uma identidade de PESSOA,
    // e um grupo com cara de pessoa é a confusão que a linha separada existe para impedir (mesma
    // escolha de `modals/sharing.modal.js`). O tamanho vem do CSS, por isso não há segunda cópia.
    people: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
};

/** Avatars drawn on a card before the rest collapses into "+N". */
const MAX_CARD_AVATARS = 4;

const FILTERS = [
    { key: 'recentes', label: 'Recentes' },
    { key: 'meus', label: 'Meus' },
    { key: 'compartilhados', label: 'Compartilhados comigo' },
    { key: 'publicos', label: 'Públicos' },
    { key: 'lixeira', label: 'Lixeira' },
];

const RELATIVE_TIME_FORMAT = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

/** Formats a timestamp as a pt-BR relative phrase, falling back to an absolute date past a week. */
function formatRelativeTime(value) {
    if (value == null || value === '') return '';
    const then = new Date(value).getTime();
    if (!Number.isFinite(then)) return '';
    const diffSec = Math.round((then - Date.now()) / 1000);
    const abs = Math.abs(diffSec);
    if (abs < 60) return RELATIVE_TIME_FORMAT.format(diffSec, 'second');
    if (abs < 3600) return RELATIVE_TIME_FORMAT.format(Math.round(diffSec / 60), 'minute');
    if (abs < 86400) return RELATIVE_TIME_FORMAT.format(Math.round(diffSec / 3600), 'hour');
    if (abs < 86400 * 7) return RELATIVE_TIME_FORMAT.format(Math.round(diffSec / 86400), 'day');
    return new Date(then).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * COMO UMA PESSOA É NOMEADA nesta página, com o posto na frente quando o servidor mandou um.
 *
 * O posto vem no payload de `GET /atlas/overview` (`posto_graduacao`, por membro) e era jogado
 * fora: o rodapé montava a lista só com `nome`. Num app do Exército "Cap Silva" e "Sd Silva" são
 * duas pessoas, e a lista que mostra só o sobrenome não distingue as duas.
 *
 * O ÚLTIMO RECURSO NÃO É STRING VAZIA. Uma entrada sem nome nenhum ainda é uma pessoa com acesso,
 * e apagá-la da frase encurtaria a lista sem baixar a contagem ao lado, que é a forma de erro em
 * que a tela se contradiz sozinha.
 *
 * Pura, e exportada por isso: é a parte desta tela que se verifica em node.
 * @param {{nome?: string, posto_graduacao?: string, username?: string}} person
 * @returns {string} Nunca vazia.
 */
export function accessPersonLabel(person) {
    const nome = String(person?.nome ?? '').trim();
    const posto = String(person?.posto_graduacao ?? '').trim();
    if (nome && posto) return `${posto} ${nome}`;
    if (nome) return nome;
    const username = String(person?.username ?? '').trim();
    if (username) return `@${username}`;
    return 'Alguém';
}

/**
 * Quantas pessoas um GRUPO carrega, por extenso.
 *
 * Ausente, string, `NaN` e negativo colapsam todos em zero de propósito: nenhum deles descreve
 * gente com acesso, e todos conjugariam no plural por acidente se fossem adiante como número.
 * @param {{memberCount?: *}} group
 * @returns {string}
 */
function accessGroupSizeLabel(group) {
    const n = Number(group?.memberCount);
    const total = Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
    if (total === 0) return 'sem membros';
    return `${total} ${total === 1 ? 'pessoa' : 'pessoas'}`;
}

/**
 * O QUE O RODAPÉ DO CARTÃO DIZ sobre quem tem acesso, em texto VISÍVEL.
 *
 * Até 2026-08-23 os nomes moravam só no atributo `title`: invisíveis no toque, invisíveis para
 * quem não para o mouse em cima, e ausentes de qualquer captura. O cartão mostrava quatro
 * bolinhas e um número, e a única pergunta que o rodapé existe para responder ("quem?") ficava
 * atrás de um hover. Agora `detail` é desenhado como texto e o `title` é REFORÇO, nunca o único
 * portador.
 *
 * O QUE ESTE PAYLOAD NÃO TEM É O NÍVEL. `GET /atlas/overview` devolve por membro apenas
 * `{id, nome, posto_graduacao}` mais o `member_count` (medido no `LIST_USER_ATLAS_MEMBERS` de
 * `backend/src/modules/atlas/atlas.queries.js`), e o único endpoint que carrega o nível de cada
 * participante, `GET /atlas/:atlasId/sharing`, é gateado em `manage`. Ou seja, "quem tem acesso e
 * com que nível" NÃO é respondível abaixo de `manage` com o servidor de hoje; quem chega lá vê a
 * resposta em {@link AtlasAccessModal}. Não invente nível a partir daqui.
 *
 * A AUSÊNCIA DE LINHA CONTINUA DESENHANDO NADA (devolve `null`): quando o pedido de overview
 * falhou não há linha para este atlas, e um rodapé que dissesse "Só você" leria como "este
 * projeto é privado", que é um fato errado dito em silêncio. Já a solidão CONHECIDA é dita em voz
 * alta.
 *
 * Pura — sem DOM, sem rede.
 * @param {{member_count?: *, members?: Array}|null|undefined} row - a linha de `getAtlasOverview`.
 * @param {{is_public?: boolean}} [project]
 * @returns {{count: number, summary: string, detail: string, title: string}|null}
 */
export function describeCardAccess(row, project = {}) {
    if (!row) return null;
    const members = Array.isArray(row.members) ? row.members : [];
    const declared = Number(row.member_count);
    const count = Number.isFinite(declared) && declared > 0 ? Math.trunc(declared) : members.length;

    if (count <= 1) {
        // `is_public` muda o FATO, não o tom: um atlas solitário com link público não é privado.
        const summary = project?.is_public ? 'Só você e o link público' : 'Só você';
        return { count, summary, detail: '', title: summary };
    }

    const summary = `${count} pessoas`;
    const names = members.map(accessPersonLabel);
    if (names.length === 0) {
        // Contagem sem lista é estado real (o `json_agg` do servidor corta em 10, e um payload
        // truncado por outro motivo cairia aqui): dizer o número sozinho é honesto, inventar
        // nomes não seria.
        return { count, summary, detail: '', title: summary };
    }
    const overflow = Math.max(0, count - names.length);
    const detail = overflow > 0 ? `${names.join(', ')} e mais ${overflow}` : names.join(', ');
    return { count, summary, detail, title: `Com acesso: ${detail}` };
}

/**
 * AS AÇÕES QUE O MENU DO CARTÃO OFERECE, para um nível de permissão.
 *
 * EXTRAÍDA PARA SER TESTÁVEL. O gate morava dentro de `_openCardMenu`, entre `document.createElement`
 * e `getBoundingClientRect`, então a única propriedade que importa aqui (quem vê o quê) não tinha
 * como ser verificada num ambiente sem DOM, que é o desta casa.
 *
 * GATE POR POSTO NA ESCADA, NUNCA POR LISTA FECHADA. `read < comment < write < manage < owner`:
 * um `perm === 'write' || perm === 'owner'` exclui o co-Gestor (`manage`), que está ACIMA de
 * write, e essa exata armadilha já embarcou duas vezes nos dois pacotes. Quem responde é
 * `hasAtLeast`, a única implementação sancionada da hierarquia.
 *
 * OS PISOS ESPELHAM O SERVIDOR, rota a rota (`backend/src/modules/atlas/atlas.routes.js` e
 * `backend/src/modules/sharing/sharing.routes.js`):
 *   - renomear → `PUT /atlas/:atlasId`, `write`;
 *   - capa → `PUT|DELETE /atlas/:atlasId/cover`, `write` (o mesmo de renomear: capa e nome são a
 *     identidade visível do projeto; `manage` é a régua do compartilhamento, que é outra coisa);
 *   - quem tem acesso → `GET /atlas/:atlasId/sharing`, `manage`;
 *   - fazer uma cópia → `POST /atlas/:atlasId/clone`, que só exige alcançar o atlas;
 *   - lixeira → `DELETE /atlas/:atlasId`, `owner`.
 *
 * O `testid` VAI ESCRITO POR EXTENSO, e a repetição aparente é obrigatória: montá-lo como
 * `project-picker-${id}` deixava `frontend/tests/unit/e2e-testids-existem.test.js` reprovar três
 * locators de `browser-atlas-drive.spec.js`, porque aquele guarda procura o literal ENTRE ASPAS em
 * `src/`, e um testid montado em runtime não é literal nenhum. O guarda está certo: um alvo que
 * some do texto some do alcance de quem o procura.
 *
 * Pura, e devolve array NOVO a cada chamada, para que quem ordene ou filtre não envenene o próximo.
 * @param {{permission?: *, hasCover?: boolean}} [options]
 * @returns {Array<{id: string, testid: string, label: string, danger: boolean}>} na ordem em que
 *   aparecem.
 */
export function cardMenuActions({ permission, hasCover = false } = {}) {
    const canWrite = hasAtLeast(permission, 'write');
    const canManage = hasAtLeast(permission, 'manage');
    const canOwn = hasAtLeast(permission, 'owner');
    const actions = [];
    if (canWrite) {
        actions.push({ id: 'rename', testid: 'project-picker-rename', label: 'Renomear', danger: false });
        actions.push({
            id: 'cover',
            testid: 'project-picker-cover',
            label: hasCover ? 'Trocar imagem' : 'Escolher imagem',
            danger: false,
        });
        if (hasCover) {
            actions.push({
                id: 'cover-remove',
                testid: 'project-picker-cover-remove',
                label: 'Remover imagem',
                danger: false,
            });
        }
    }
    if (canManage) {
        actions.push({ id: 'access', testid: 'project-picker-access', label: 'Quem tem acesso', danger: false });
    }
    actions.push({ id: 'duplicate', testid: 'project-picker-duplicate', label: 'Fazer uma cópia', danger: false });
    if (canOwn) {
        actions.push({ id: 'trash', testid: 'project-picker-trash', label: 'Mover para lixeira', danger: true });
    }
    return actions;
}

/**
 * O PAYLOAD DE `GET /atlas/:atlasId/sharing` NA FORMA QUE O PAINEL DESENHA: uma linha por
 * participante, pessoa ou grupo, cada uma com o NÍVEL por extenso.
 *
 * O DONO VEM PRIMEIRO E FORA DE `shares`, porque ele não é um share: posse é a coluna
 * `atlas.owner_id`, e o servidor a devolve num campo próprio. Sem esta linha o painel diria que
 * um atlas recém-criado não tem ninguém.
 *
 * O EXCEDENTE DE GRUPO É DITO SEM NOMEAR O GRUPO. O acesso resolve pelo MAIOR nível entre o
 * compartilhamento nominal e o de grupo (`fn_user_atlas_shares`), então uma linha pode exibir
 * "Leitura" enquanto a pessoa edita por um coletivo. Dizer QUAL coletivo revelaria que aquela
 * pessoa é membro dele, que o gestor do atlas não tem direito de saber (cláusula 5.3); dizer que
 * há excedente basta para ninguém se enganar. A comparação usa `permissionRank`, a hierarquia
 * sancionada, e não um `findIndex` sobre lista própria.
 *
 * Pura — sem DOM, sem rede.
 * @param {Object|null} cfg - o corpo de `apiClient.getSharing`.
 * @returns {Array<{kind: string, id: string, name: string, meta: string, levelLabel: string,
 *   note: string}>}
 */
export function accessRowsFromSharing(cfg) {
    const rows = [];
    const owner = cfg?.owner;
    if (owner?.userId != null) {
        const username = String(owner?.username ?? '').trim();
        rows.push({
            kind: 'user',
            id: String(owner.userId),
            name: accessPersonLabel(owner),
            meta: username ? `@${username}` : '',
            levelLabel: getPermissionLabel('owner'),
            note: '',
        });
    }
    for (const share of Array.isArray(cfg?.shares) ? cfg.shares : []) {
        const username = String(share?.username ?? '').trim();
        const level = share?.permission;
        const efetiva = share?.effectivePermission;
        rows.push({
            kind: 'user',
            id: String(share?.userId ?? ''),
            name: accessPersonLabel(share),
            meta: username ? `@${username}` : '',
            levelLabel: getPermissionLabel(level),
            note: permissionRank(efetiva) > permissionRank(level)
                ? `Na prática, ${getPermissionLabel(efetiva)}, por um grupo deste atlas.`
                : '',
        });
    }
    for (const group of Array.isArray(cfg?.groups) ? cfg.groups : []) {
        const dono = String(group?.ownerNome ?? '').trim();
        rows.push({
            kind: 'group',
            id: String(group?.groupId ?? ''),
            name: String(group?.name ?? 'Grupo'),
            meta: accessGroupSizeLabel(group),
            levelLabel: getPermissionLabel(group?.permission),
            // De quem é o grupo: um share coletivo entrega ao dono dele o poder de pôr mais gente
            // dentro do atlas sem passar por quem compartilhou, e esta é a única superfície desta
            // página onde essa delegação aparece.
            note: dono ? `Grupo de ${dono}.` : 'Grupo sem dono definido.',
        });
    }
    return rows;
}

/**
 * The project chooser, as a mountable page section.
 */
export class AtlasDrive {
    /**
     * @param {Object} options
     * @param {Array<Object>} [options.projects] - Atlas records from `apiClient.listAtlas()`.
     * @param {Function} options.onPick - Called with the picked atlas id.
     * @param {Function} [options.onCreate] - Called with (name, sharing) for "Novo atlas".
     * @param {Function} [options.onImport] - Called with the chosen `.ebgeo` File.
     * @param {{atlases: Object[], covers: Object, presence: Object}} [options.overview] - The card
     *   extras from `apiClient.getAtlasOverview()`. Omitted, cards draw name and permission alone,
     *   which is what they did before this existed — the page must stay usable when the extra
     *   request fails.
     */
    constructor(options = {}) {
        this._projects = Array.isArray(options.projects) ? options.projects : [];
        this._onPick = options.onPick || (() => Promise.resolve());
        this._onCreate = typeof options.onCreate === 'function' ? options.onCreate : null;
        this._onImport = typeof options.onImport === 'function' ? options.onImport : null;
        this._importBtn = null;
        this._busy = false;
        this._filter = 'recentes';
        this._query = '';
        this._trashed = [];
        this._trashedLoaded = false;
        this._root = null;
        this._gridEl = null;
        this._tabButtons = new Map();
        /** atlasId → `{member_count, members, has_cover}`; atlasId → data URI; atlasId → users. */
        this._members = new Map();
        this._covers = new Map();
        this._presence = new Map();
        /** atlasId → the node that shows who is connected, so a refresh can redraw ONLY it. */
        this._presenceNodes = new Map();
        this._coverInput = null;
        this._coverTarget = null;
        this.setOverview(options.overview);
        setupCleanup(this);
    }

    /**
     * Replaces the card extras (members, covers, presence) and redraws if already mounted.
     * @param {{atlases: Object[], covers: Object, presence: Object}} [overview]
     */
    setOverview(overview) {
        this._members = new Map(
            (Array.isArray(overview?.atlases) ? overview.atlases : []).map((row) => [String(row.id), row])
        );
        this._covers = new Map(Object.entries(overview?.covers || {}));
        this._presence = new Map(Object.entries(overview?.presence || {}));
        if (this._gridEl) this._renderGrid();
    }

    /**
     * Refreshes ONLY who is connected — the one fact that changes without the user doing anything.
     *
     * It patches the existing nodes instead of redrawing the grid, and that is not an optimisation:
     * this runs on a timer, and a rebuild would close an open ⋯ menu, drop hover, and reset the
     * scroll position of somebody who was reading the list.
     *
     * @param {Object<string, Array<Object>>} presence - Atlas id → connected users.
     */
    setPresence(presence) {
        this._presence = new Map(Object.entries(presence || {}));
        for (const [atlasId, node] of this._presenceNodes) {
            this._fillPresence(node, this._presence.get(atlasId) || []);
        }
    }

    /**
     * Builds the Drive into `host` and focuses the search box.
     * @param {HTMLElement} [host]
     */
    mount(host = document.body) {
        if (this._root) return;
        this._build();
        host.appendChild(this._root);
        const search = this._root.querySelector('.atlas-drive__search-input');
        if (search) requestAnimationFrame(() => search.focus());
    }

    /** Removes the Drive + its listeners. */
    destroy() {
        if (!this._root) return;
        this._closeCardMenu();
        clearScopedListeners(this, 'grid');
        cleanup(this);
        removeElement(this._root);
        this._root = null;
        this._gridEl = null;
        this._coverInput = null;
        this._coverTarget = null;
        this._presenceNodes.clear();
        this._tabButtons.clear();
    }

    /** @private */
    _build() {
        const root = document.createElement('div');
        root.className = 'atlas-drive';
        // Kept from the modal era so every existing e2e locator still resolves.
        root.dataset.testid = 'project-picker-modal';

        root.appendChild(this._buildTopbar());
        root.appendChild(this._buildTabs());

        const grid = document.createElement('div');
        grid.className = 'atlas-drive__grid';
        grid.dataset.testid = 'project-picker-list';
        grid.setAttribute('role', 'listbox');
        grid.setAttribute('aria-label', 'Atlas do servidor');
        root.appendChild(grid);

        this._root = root;
        this._gridEl = grid;
        this._renderGrid();
    }

    /** @private Content toolbar: title + search + "Novo atlas" (no close — this is a page). */
    _buildTopbar() {
        const bar = document.createElement('header');
        bar.className = 'atlas-drive__topbar';

        const title = document.createElement('div');
        const h = document.createElement('h2');
        h.className = 'atlas-drive__title';
        // Section heading, not the page heading: the page is "Seus atlas" and this is its server
        // half, sitting under the local one.
        h.textContent = 'No servidor';
        const sub = document.createElement('p');
        sub.className = 'atlas-drive__subtitle';
        sub.textContent = 'Atlas sincronizados, abertos por você e por quem você convidar';
        title.append(h, sub);
        bar.appendChild(title);

        const tools = document.createElement('div');
        tools.className = 'atlas-drive__tools';

        const searchWrap = document.createElement('div');
        searchWrap.className = 'atlas-drive__search';
        const sIcon = document.createElement('span');
        sIcon.className = 'atlas-drive__search-icon';
        sIcon.innerHTML = ICONS.search; // static icon
        const search = document.createElement('input');
        search.type = 'search';
        search.className = 'atlas-drive__search-input';
        search.placeholder = 'Buscar atlas…';
        search.dataset.testid = 'project-picker-search';
        addDomListener(this, search, 'input', () => { this._query = search.value; this._renderGrid(); });
        searchWrap.append(sIcon, search);
        tools.appendChild(searchWrap);

        if (this._onImport) {
            // A hidden file input, driven by a real button — the native control cannot be styled
            // and would be the only unstyled thing on the page.
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.ebgeo';
            fileInput.hidden = true;
            fileInput.dataset.testid = 'project-picker-import-input';
            addDomListener(this, fileInput, 'change', () => {
                const file = fileInput.files?.[0];
                // Reset first: picking the SAME file twice must fire `change` again (it would not
                // if the value stayed), which is exactly what a retry after a failure needs.
                fileInput.value = '';
                if (file) this._handleImport(file);
            });

            const importBtn = document.createElement('button');
            importBtn.type = 'button';
            importBtn.className = 'atlas-drive__btn atlas-drive__btn--ghost';
            importBtn.dataset.testid = 'project-picker-import';
            importBtn.title = 'Criar um atlas a partir de um arquivo .ebgeo';
            importBtn.innerHTML = ICONS.upload; // static icon
            const importLabel = document.createElement('span');
            importLabel.textContent = 'Importar .ebgeo';
            importBtn.appendChild(importLabel);
            addDomListener(this, importBtn, 'click', () => fileInput.click());

            this._importBtn = importBtn;
            tools.append(importBtn, fileInput);
        }

        if (this._onCreate) {
            const newBtn = document.createElement('button');
            newBtn.type = 'button';
            newBtn.className = 'atlas-drive__btn atlas-drive__btn--primary';
            newBtn.dataset.testid = 'project-picker-create';
            newBtn.innerHTML = ICONS.plus; // static icon
            const t = document.createElement('span');
            t.textContent = 'Novo atlas';
            newBtn.appendChild(t);
            addDomListener(this, newBtn, 'click', () => this._handleCreate());
            tools.appendChild(newBtn);
        }

        bar.appendChild(tools);
        return bar;
    }

    /**
     * @private Runs the caller's import with the chosen file, showing progress on the button —
     * unzipping + uploading a real project takes seconds, and a dead-looking button invites a
     * second click that would import twice.
     * @param {File} file
     */
    async _handleImport(file) {
        if (this._busy) return;
        this._busy = true;
        const label = this._importBtn?.querySelector('span');
        const original = label?.textContent;
        if (label) label.textContent = 'Importando…';
        if (this._importBtn) this._importBtn.disabled = true;
        try {
            await this._onImport(file);
        } finally {
            // On success the page navigates away and this never matters; on failure the button
            // must come back, or the only way to retry is a reload.
            this._busy = false;
            if (label && original) label.textContent = original;
            if (this._importBtn) this._importBtn.disabled = false;
        }
    }

    /** @private Filter tabs. */
    _buildTabs() {
        const tabs = document.createElement('nav');
        tabs.className = 'atlas-drive__tabs';
        tabs.setAttribute('role', 'tablist');
        for (const f of FILTERS) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'atlas-drive__tab';
            btn.dataset.testid = `project-picker-tab-${f.key}`;
            btn.setAttribute('role', 'tab');
            btn.textContent = f.label;
            if (f.key === this._filter) btn.classList.add('atlas-drive__tab--active');
            addDomListener(this, btn, 'click', () => this._switchFilter(f.key));
            this._tabButtons.set(f.key, btn);
            tabs.appendChild(btn);
        }
        return tabs;
    }

    /** @private The atlases matching the active tab + search. */
    _visible() {
        const q = this._query.trim().toLowerCase();
        const list = q ? this._projects.filter((p) => (p?.name ?? '').toLowerCase().includes(q)) : this._projects;
        switch (this._filter) {
            case 'meus':
                return list.filter((p) => p?.user_permission === 'owner');
            case 'compartilhados':
                return list.filter((p) => p?.user_permission && p.user_permission !== 'owner');
            case 'publicos':
                return list.filter((p) => p?.is_public);
            case 'recentes':
            default:
                return [...list].sort((a, b) => new Date(b?.updated_at ?? 0) - new Date(a?.updated_at ?? 0));
        }
    }

    /**
     * @private Switches the active tab. The Trash tab lazy-loads the caller's soft-deleted atlases
     * (a separate endpoint from listAtlas) on first open.
     * @param {string} key
     */
    async _switchFilter(key) {
        this._filter = key;
        for (const [k, b] of this._tabButtons) b.classList.toggle('atlas-drive__tab--active', k === key);
        if (key === 'lixeira' && !this._trashedLoaded) {
            try {
                const list = await apiClient.listTrashedAtlas();
                this._trashed = Array.isArray(list) ? list : [];
                this._trashedLoaded = true;
            } catch (error) {
                showError(error?.message || 'Não foi possível carregar a lixeira.');
            }
        }
        this._renderGrid();
    }

    /** @private Rebuilds the card grid from the current filter/search. */
    _renderGrid() {
        if (!this._gridEl) return;
        // Release the previous cards' listeners before detaching them — _renderGrid runs on every
        // keystroke/tab-switch/refresh, so without this the tracked-listener bucket grows unbounded.
        clearScopedListeners(this, 'grid');
        // The presence nodes belong to cards that are about to be dropped; keeping them would make
        // the next poll write into detached DOM and leak a node per atlas per redraw.
        this._presenceNodes.clear();
        this._gridEl.replaceChildren();
        const isTrash = this._filter === 'lixeira';
        const q = this._query.trim().toLowerCase();
        const matches = (p) => !q || (p?.name ?? '').toLowerCase().includes(q);
        // The search box applies on every tab, including Lixeira.
        const list = (isTrash ? this._trashed.filter(matches) : this._visible());
        if (list.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'atlas-drive__empty';
            empty.dataset.testid = 'project-picker-empty';
            empty.textContent = isTrash
                ? (this._query ? 'Nenhum atlas na lixeira corresponde à busca.' : 'A lixeira está vazia.')
                : (this._query ? 'Nenhum atlas corresponde à busca.' : 'Nenhum atlas nesta categoria.');
            this._gridEl.appendChild(empty);
            return;
        }
        for (const project of list) {
            this._gridEl.appendChild(isTrash ? this._trashCard(project) : this._card(project));
        }
    }

    /**
     * @private The cover of an atlas: the picture somebody chose, or the coloured initials.
     *
     * The initials are NOT a placeholder waiting to be replaced — they are the deterministic
     * identity this app gives every atlas and every person (`presence-colors.js`), so the same
     * project is the same colour on every machine. The cover only takes their place.
     */
    _thumb(project, id) {
        const cover = this._covers.get(id);
        const thumb = document.createElement('div');
        thumb.className = 'atlas-drive__thumb';
        if (cover) {
            thumb.classList.add('atlas-drive__thumb--cover');
            const img = document.createElement('img');
            img.className = 'atlas-drive__thumb-img';
            img.src = cover;
            img.alt = '';
            img.setAttribute('aria-hidden', 'true');
            thumb.appendChild(img);
        } else {
            // Runtime-computed colour, so it belongs in JS; everything else is a class.
            thumb.style.backgroundColor = getPresenceColor(id);
            thumb.textContent = getInitials(project?.name ?? '');
        }
        return thumb;
    }

    /**
     * @private Writes "who is on this map right now" into `node`, avatars and all.
     *
     * Called on every draw AND on every presence poll, which is why it is a fill rather than a
     * build: {@link setPresence} reuses the same node.
     * @param {HTMLElement} node
     * @param {Array<{id: string, nome: string}>} users
     */
    _fillPresence(node, users) {
        node.replaceChildren();
        const list = Array.isArray(users) ? users : [];
        node.hidden = list.length === 0;
        if (list.length === 0) return;

        const dot = document.createElement('span');
        dot.className = 'atlas-drive__live-dot';
        dot.setAttribute('aria-hidden', 'true');
        node.appendChild(dot);

        node.appendChild(this._avatars(list, 'atlas-drive__live-avatar'));

        const label = document.createElement('span');
        label.className = 'atlas-drive__live-label';
        // "no mapa" and not "online": these are people INSIDE this project right now, which is a
        // different fact from being signed in, and the card sits next to projects nobody is in.
        label.textContent = list.length === 1 ? '1 no mapa' : `${list.length} no mapa`;
        node.appendChild(label);
        node.title = `Agora no atlas: ${list.map((u) => u?.nome || 'Alguém').join(', ')}`;
    }

    /**
     * @private A stack of initial-avatars, capped, with a "+N" for the rest.
     * @param {Array<{id: string, nome: string}>} people
     * @param {string} className - BEM element class of each avatar.
     * @returns {HTMLElement}
     */
    _avatars(people, className) {
        const stack = document.createElement('span');
        stack.className = 'atlas-drive__avatars';
        stack.setAttribute('aria-hidden', 'true'); // the sentence next to it carries the meaning
        for (const person of people.slice(0, MAX_CARD_AVATARS)) {
            const avatar = document.createElement('span');
            avatar.className = className;
            avatar.textContent = getInitials(person?.nome || '?');
            avatar.style.backgroundColor = getPresenceColor(String(person?.id || person?.nome || ''));
            stack.appendChild(avatar);
        }
        if (people.length > MAX_CARD_AVATARS) {
            const more = document.createElement('span');
            more.className = `${className} ${className}--more`;
            more.textContent = `+${people.length - MAX_CARD_AVATARS}`;
            stack.appendChild(more);
        }
        return stack;
    }

    /**
     * @private The sharing footer: who takes part, in words and in avatars.
     *
     * IT SAYS SOMETHING EVEN WITH NO DATA. When the overview request failed there is no row for
     * this atlas, and a footer that simply vanished would read as "this project is private" —
     * a wrong fact, silently. So the absent case draws nothing at all and the caller keeps the
     * old card, while the KNOWN solitary case says so out loud.
     *
     * THE NAMES ARE DRAWN, NOT HOVERED. They used to live only in `foot.title`, which is invisible
     * on touch, invisible to anyone who does not park the pointer, and absent from every capture:
     * the card showed four circles and a number, and the one question the footer exists to answer
     * stayed behind a hover. The `title` is still set, as REINFORCEMENT of the same sentence.
     *
     * The wording (and every edge of it) is {@link describeCardAccess}, which is where it is
     * verified; this method is the DOM around it.
     */
    _sharingFooter(project, id) {
        const row = this._members.get(id);
        const access = describeCardAccess(row, project);
        if (!access) return null;

        const foot = document.createElement('div');
        foot.className = 'atlas-drive__share';
        foot.dataset.testid = 'project-card-sharing';

        const head = document.createElement('div');
        head.className = 'atlas-drive__share-head';

        if (access.count <= 1) {
            const solo = document.createElement('span');
            solo.className = 'atlas-drive__share-label';
            solo.innerHTML = ICONS.lock; // static icon
            const text = document.createElement('span');
            text.textContent = access.summary;
            solo.appendChild(text);
            head.appendChild(solo);
            foot.appendChild(head);
            foot.title = access.title;
            return foot;
        }

        head.appendChild(this._avatars(Array.isArray(row.members) ? row.members : [], 'atlas-drive__member-avatar'));
        const label = document.createElement('span');
        label.className = 'atlas-drive__share-label';
        label.textContent = access.summary;
        head.appendChild(label);
        foot.appendChild(head);

        if (access.detail) {
            const names = document.createElement('p');
            names.className = 'atlas-drive__share-names';
            names.dataset.testid = 'project-card-sharing-names';
            names.textContent = access.detail;
            foot.appendChild(names);
        }
        foot.title = access.title;
        return foot;
    }

    /** @private A single atlas card (the `project-picker-item`) wrapped with its actions menu button. */
    _card(project) {
        const id = String(project?.id ?? '');
        const wrap = document.createElement('div');
        wrap.className = 'atlas-drive__card-wrap';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'atlas-drive__card';
        btn.dataset.testid = 'project-picker-item';
        btn.dataset.atlasId = id;
        btn.setAttribute('role', 'option');
        const sub = this._subtitle(project);
        btn.setAttribute('aria-label', sub ? `${project?.name ?? ''} — ${sub}` : (project?.name ?? ''));

        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'atlas-drive__thumb-wrap';
        thumbWrap.appendChild(this._thumb(project, id));

        // Presence rides ON the thumbnail: it is the most perishable fact on the card, and the
        // corner of the picture is where the eye lands before it reads anything.
        const live = document.createElement('span');
        live.className = 'atlas-drive__live';
        live.dataset.testid = 'project-card-live';
        this._fillPresence(live, this._presence.get(id) || []);
        thumbWrap.appendChild(live);
        this._presenceNodes.set(id, live);
        btn.appendChild(thumbWrap);

        const body = document.createElement('div');
        body.className = 'atlas-drive__card-body';

        const name = document.createElement('div');
        name.className = 'atlas-drive__card-name';
        name.textContent = project?.name ?? '';
        body.appendChild(name);

        const meta = document.createElement('div');
        meta.className = 'atlas-drive__card-meta';
        meta.textContent = this._subtitle(project);
        body.appendChild(meta);

        const tags = document.createElement('div');
        tags.className = 'atlas-drive__card-tags';
        // The chip is drawn for ANY level the server reports, not only the ones this file
        // knows a label for: the local table used to list owner/write/read alone, so an atlas
        // shared as Gestor (`manage`) or Comentarista (`comment`) rendered NO badge at all —
        // indistinguishable from an atlas with no permission. An unknown level now degrades to
        // its raw value on the base chip (no `--<level>` modifier, since no rule would match).
        const permission = project?.user_permission;
        const permissionLabel = getPermissionLabel(permission);
        if (permissionLabel) {
            const chip = document.createElement('span');
            chip.className = isKnownPermission(permission)
                ? `atlas-drive__chip atlas-drive__chip--${permission}`
                : 'atlas-drive__chip';
            chip.textContent = permissionLabel;
            chip.dataset.permission = String(permission);
            tags.appendChild(chip);
        }
        if (project?.is_public) {
            const pub = document.createElement('span');
            pub.className = 'atlas-drive__public';
            pub.innerHTML = ICONS.globe; // static icon
            const t = document.createElement('span');
            t.textContent = 'Público';
            pub.appendChild(t);
            tags.appendChild(pub);
        }
        body.appendChild(tags);

        const sharing = this._sharingFooter(project, id);
        if (sharing) body.appendChild(sharing);

        btn.appendChild(body);
        addScopedDomListener(this, 'grid', btn, 'click', () => this._handlePick(id));
        wrap.appendChild(btn);

        // Actions menu (⋯) — a sibling button (a card is a <button>, so it cannot be nested).
        const menuBtn = document.createElement('button');
        menuBtn.type = 'button';
        menuBtn.className = 'atlas-drive__menu-btn';
        menuBtn.dataset.testid = 'project-picker-menu';
        menuBtn.setAttribute('aria-label', 'Mais ações');
        menuBtn.innerHTML = ICONS.dots; // static icon
        addScopedDomListener(this, 'grid', menuBtn, 'click', (e) => {
            e.stopPropagation();
            this._openCardMenu(project, menuBtn);
        });
        wrap.appendChild(menuBtn);

        return wrap;
    }

    /**
     * @private Opens the card actions menu near the ⋯ button.
     *
     * WHICH actions appear is {@link cardMenuActions}, a pure function verified in node; this
     * method only turns its answer into buttons and wires each one. The split exists because the
     * gate is the part that has been wrong before (a closed list that silently excluded `manage`),
     * and while it lived between `createElement` and `getBoundingClientRect` there was no way to
     * assert it in an environment without a DOM, which is the one this repo tests in.
     *
     * Each item's `data-testid` comes from the action itself, spelled out there, which reproduces
     * every existing locator verbatim.
     */
    _openCardMenu(project, anchorBtn) {
        // Re-clicking the same ⋯ button toggles its menu shut.
        if (this._cardMenu && this._cardMenuAnchor === anchorBtn) {
            this._closeCardMenu();
            return;
        }
        this._closeCardMenu();

        const menu = document.createElement('div');
        menu.className = 'atlas-drive__menu';
        menu.dataset.testid = 'project-picker-menu-popup';
        const rect = anchorBtn.getBoundingClientRect();
        menu.style.top = `${Math.round(rect.bottom + 4)}px`;
        menu.style.left = `${Math.round(rect.right - 200)}px`;

        const handlers = {
            rename: () => this._rename(project),
            cover: () => this._pickCover(project),
            'cover-remove': () => this._removeCover(project),
            access: () => this._showAccess(project),
            duplicate: () => this._duplicate(project),
            trash: () => this._trash(project),
        };

        const actions = cardMenuActions({
            permission: project?.user_permission,
            hasCover: this._covers.has(String(project?.id ?? '')),
        });
        for (const action of actions) {
            const run = handlers[action.id];
            if (!run) continue;
            const item = document.createElement('button');
            item.type = 'button';
            item.className = `atlas-drive__menu-item${action.danger ? ' atlas-drive__menu-item--danger' : ''}`;
            item.dataset.testid = action.testid;
            item.textContent = action.label;
            item.addEventListener('click', () => { this._closeCardMenu(); run(); });
            menu.appendChild(item);
        }

        this._root.appendChild(menu);
        this._cardMenu = menu;
        this._cardMenuAnchor = anchorBtn;
        this._menuOutside = (e) => {
            // anchorBtn.contains(target) — the click may land on the button's inner <svg>, which is
            // NOT === anchorBtn; without contains() the button's own click reads as "outside".
            if (!menu.contains(e.target) && !anchorBtn.contains(e.target)) this._closeCardMenu();
        };
        // Defer so the opening click doesn't immediately close the menu. Handle stored for teardown.
        this._menuTimer = setTimeout(() => {
            this._menuTimer = null;
            document.addEventListener('mousedown', this._menuOutside);
        }, 0);
    }

    /** @private */
    _closeCardMenu() {
        if (this._menuTimer != null) { clearTimeout(this._menuTimer); this._menuTimer = null; }
        if (this._cardMenu) { this._cardMenu.remove(); this._cardMenu = null; }
        this._cardMenuAnchor = null;
        if (this._menuOutside) { document.removeEventListener('mousedown', this._menuOutside); this._menuOutside = null; }
    }

    /**
     * @private "Quem tem acesso" — the read-only access panel for one atlas.
     *
     * Only reached from a menu item that {@link cardMenuActions} draws at `manage` or above, which
     * is EXACTLY the gate the server puts on `GET /atlas/:atlasId/sharing`. The panel re-checks
     * nothing: the server decides on every request, and a 403 arriving here is drawn as the
     * server's own sentence.
     * @param {Object} project
     */
    _showAccess(project) {
        const modal = new AtlasAccessModal(project);
        modal.render();
        modal.show();
    }

    /**
     * @private Re-fetches the atlas list AND the card extras, then redraws.
     *
     * Both, because the actions that call this create and destroy atlases: a copy made from a card
     * arrives with no cover and one member, and a list refreshed without the overview would draw it
     * with the previous atlas's footer for as long as the page stayed open.
     */
    async _refresh() {
        const [list, overview] = await Promise.all([
            apiClient.listAtlas().catch((error) => {
                showError(error?.message || 'Não foi possível atualizar a lista.');
                return null;
            }),
            // Silent on failure, deliberately: the extras are an enrichment, and a second red
            // toast about a detail nobody asked for would bury the first one, which is the real news.
            apiClient.getAtlasOverview().catch(() => null),
        ]);
        if (Array.isArray(list)) this._projects = list;
        if (overview) this.setOverview(overview);
        else this._renderGrid();
    }

    /**
     * @private The hidden file input the cover actions drive.
     *
     * ONE input for the whole grid, living in the Drive's root rather than in a card: the ⋯ menu is
     * destroyed the moment an item is clicked, so an input owned by the menu would be gone before
     * the file picker returned, and its `change` would fire into nothing.
     */
    _ensureCoverInput() {
        if (this._coverInput) return this._coverInput;
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png,image/jpeg,image/webp';
        input.hidden = true;
        input.dataset.testid = 'project-picker-cover-input';
        addDomListener(this, input, 'change', () => {
            const file = input.files?.[0];
            const target = this._coverTarget;
            // Reset BEFORE the await: picking the same file twice must fire `change` again, which
            // is exactly what a retry after a failed upload needs.
            input.value = '';
            this._coverTarget = null;
            if (file && target) this._applyCover(target, file);
        });
        this._root.appendChild(input);
        this._coverInput = input;
        return input;
    }

    /** @private Opens the file picker for this project's cover. */
    _pickCover(project) {
        const input = this._ensureCoverInput();
        this._coverTarget = project;
        input.value = '';
        input.click();
    }

    /**
     * @private Shrinks the picture in the browser and stores it.
     *
     * The resize is NOT an optimisation to skip when in doubt: a phone photo is megabytes, the card
     * draws it 320 px wide, and every visit to this page would download all of them.
     */
    async _applyCover(project, file) {
        const id = String(project?.id ?? '');
        try {
            const payload = await fileToCoverPayload(file);
            await apiClient.setAtlasCover(id, payload);
            this._covers.set(id, payload.image);
            const row = this._members.get(id);
            if (row) row.has_cover = true;
            this._renderGrid();
            showSuccess('Imagem do atlas atualizada.');
        } catch (error) {
            console.error('[projects] cover upload failed:', error);
            showError(error?.message || 'Não foi possível usar esta imagem.');
        }
    }

    /** @private Drops the cover, putting the coloured initials back. */
    async _removeCover(project) {
        const id = String(project?.id ?? '');
        try {
            await apiClient.deleteAtlasCover(id);
            this._covers.delete(id);
            const row = this._members.get(id);
            if (row) row.has_cover = false;
            this._renderGrid();
            showSuccess('Imagem removida.');
        } catch (error) {
            showError(error?.message || 'Não foi possível remover a imagem.');
        }
    }

    /** @private Rename via a prompt → PUT /atlas/:id. */
    async _rename(project) {
        const name = await showPrompt('Renomear atlas', project?.name ?? '');
        if (name == null) return;
        const trimmed = name.trim();
        if (!trimmed || trimmed === project?.name) return;
        try {
            await apiClient.updateAtlas(project.id, { name: trimmed });
            showSuccess('Atlas renomeado.');
            await this._refresh();
        } catch (error) {
            showError(error?.message || 'Falha ao renomear o atlas.');
        }
    }

    /** @private Make a copy → POST /atlas/:id/clone. */
    async _duplicate(project) {
        try {
            await apiClient.cloneAtlas(project.id, { name: `${project?.name ?? 'Atlas'} (cópia)` });
            showSuccess('Cópia criada.');
            await this._refresh();
        } catch (error) {
            showError(error?.message || 'Falha ao duplicar o atlas.');
        }
    }

    /**
     * @private Move to trash (soft-delete) → DELETE /atlas/:id.
     * No "is this the connected atlas?" special case: this page holds no connection. A peer with the
     * atlas open receives the server's `atlas_deleted` broadcast and tears itself down.
     */
    async _trash(project) {
        const ok = await showConfirm(
            `Mover "${project?.name ?? ''}" para a lixeira? Você poderá restaurá-lo depois.`,
            { destructive: true, confirmText: 'Mover para lixeira' },
        );
        if (!ok) return;
        try {
            await apiClient.deleteAtlas(project.id);
            showSuccess('Atlas movido para a lixeira.');
            this._trashedLoaded = false; // re-fetch the trash next time it is opened
            await this._refresh();
        } catch (error) {
            showError(error?.message || 'Falha ao mover o atlas para a lixeira.');
        }
    }

    /** @private A trashed-atlas card: not openable; offers a Restaurar action. */
    _trashCard(project) {
        const id = String(project?.id ?? '');
        const card = document.createElement('div');
        card.className = 'atlas-drive__card atlas-drive__card--trash';
        card.dataset.testid = 'project-picker-trash-item';
        card.dataset.atlasId = id;
        // The same face it had before being trashed — recognising it is the whole job of this card.
        card.appendChild(this._thumb(project, id));

        const body = document.createElement('div');
        body.className = 'atlas-drive__card-body';
        const name = document.createElement('div');
        name.className = 'atlas-drive__card-name';
        name.textContent = project?.name ?? '';
        const meta = document.createElement('div');
        meta.className = 'atlas-drive__card-meta';
        const when = formatRelativeTime(project?.deleted_at);
        meta.textContent = when ? `excluído ${when}` : 'na lixeira';
        const restoreBtn = document.createElement('button');
        restoreBtn.type = 'button';
        restoreBtn.className = 'atlas-drive__btn atlas-drive__btn--ghost atlas-drive__restore';
        restoreBtn.dataset.testid = 'project-picker-restore';
        restoreBtn.textContent = 'Restaurar';
        addScopedDomListener(this, 'grid', restoreBtn, 'click', () => this._restore(project));
        body.append(name, meta, restoreBtn);

        card.appendChild(body);
        return card;
    }

    /** @private Restore a trashed atlas → POST /atlas/:id/restore. */
    async _restore(project) {
        try {
            await apiClient.restoreAtlas(project.id);
            showSuccess('Atlas restaurado.');
            this._trashed = (this._trashed || []).filter((p) => p.id !== project.id);
            try {
                const list = await apiClient.listAtlas();
                if (Array.isArray(list)) this._projects = list;
            } catch { /* keep the cached list */ }
            this._renderGrid();
        } catch (error) {
            showError(error?.message || 'Falha ao restaurar o atlas.');
        }
    }

    /** @private "por Você · modificado há 2 dias". */
    _subtitle(project) {
        const author = project?.user_permission === 'owner' ? 'Você' : (project?.owner_nome ?? '').trim();
        const parts = [];
        if (author) parts.push(`por ${author}`);
        const relative = formatRelativeTime(project?.updated_at);
        if (relative) parts.push(`modificado ${relative}`);
        return parts.join(' · ');
    }

    /** @private */
    async _handlePick(atlasId) {
        if (this._busy || !atlasId) return;
        this._busy = true;
        try {
            await this._onPick(atlasId);
        } catch {
            this._busy = false;
        }
    }

    /** @private Opens the create-atlas dialog; forwards name + sharing to onCreate. */
    _handleCreate() {
        if (!this._onCreate) return;
        const onCreate = this._onCreate;
        showCreateAtlasModal({ onCreate: (name, sharing) => onCreate(name, sharing) });
    }
}

/**
 * "Quem tem acesso" — a READ-ONLY roll of everybody who reaches one atlas, with their level.
 *
 * WHY IT EXISTS SEPARATELY FROM THE SHARING MODAL, which would be the obvious reuse:
 * `modals/sharing.modal.js` cannot be loaded on this page. Measured on 2026-08-23 by walking its
 * import graph: it reaches 188 modules against this page's 48, and among them `@store/services.js`
 * (and through it `store/store.js`, `store/index.js`, `layers/index.js`, `state/index.js`,
 * `tool_manager/index.js` and `@utils/index.js`), plus `@modals/index.js` and
 * `@store/sync/sync-engine.js`. Worse than the payload, it would not even run: its `render()`
 * calls `getEventBus()`, and `getServices()` throws when `initServices()` never ran, which is the
 * definition of this page. A dynamic `import()` moves the download, not the crash.
 *
 * SO THIS IS THE READING HALF ONLY, and it says so on screen. It deliberately does NOT
 * re-implement the mutations: a second copy of grant/revoke would be two screens that drift, and
 * the working one is a click away (open the atlas, then Compartilhar). What it does deliver is the
 * one fact the card cannot show, because `GET /atlas/overview` does not carry it: the LEVEL of
 * each participant.
 *
 * Everything dynamic goes through `textContent`; the only `innerHTML` is a static icon.
 *
 * @extends ModalBase
 */
class AtlasAccessModal extends ModalBase {
    /**
     * @param {{id?: string, name?: string}} project - the atlas card this was opened from.
     */
    constructor(project) {
        const nome = String(project?.name ?? '').trim();
        super({
            id: 'atlas-access-modal',
            title: nome ? `Quem tem acesso a ${nome}` : 'Quem tem acesso',
            icon: ICONS.people,
            destroyOnHide: true,
        });
        this._atlasId = String(project?.id ?? '');
    }

    /**
     * Builds the shell and fires the fetch (the loading state is already on screen).
     * @returns {HTMLElement}
     */
    render() {
        const overlay = super.render();
        this._overlay.dataset.testid = 'atlas-access-modal';
        this.getContainer().classList.add('atlas-access-container');
        this._setState('Carregando…', 'atlas-access-loading');
        document.body.appendChild(overlay);
        this._load();
        return overlay;
    }

    /**
     * @private A one-sentence body (loading / error / empty).
     *
     * `destroyOnHide` means Escape during the in-flight fetch tears the DOM down and `getBody()`
     * starts answering undefined, so every path that writes checks first.
     * @param {string} text
     * @param {string} testid
     */
    _setState(text, testid) {
        const body = this.getBody();
        if (!body) return;
        body.replaceChildren();
        const p = document.createElement('p');
        p.className = 'atlas-access__state';
        p.dataset.testid = testid;
        p.textContent = text;
        body.appendChild(p);
    }

    /** @private Reads the sharing config and draws it. */
    async _load() {
        try {
            const cfg = await apiClient.getSharing(this._atlasId);
            if (!this.getBody()) return; // closed while the request was in flight
            this._renderRows(accessRowsFromSharing(cfg), Boolean(cfg?.isPublic));
        } catch (error) {
            if (!this.getBody()) return;
            // The server's own sentence when it sent one: it distinguishes the real cases here
            // (a co-Gestor demoted mid-session gets 403 from `requireAtlasPermission('manage')`),
            // and `HTTP <status>` is a placeholder `_request` invents, never user copy.
            const message = typeof error?.message === 'string' ? error.message.trim() : '';
            this._setState(
                message && !/^HTTP \d{3}$/.test(message)
                    ? message
                    : 'Não foi possível carregar quem tem acesso.',
                'atlas-access-error',
            );
        }
    }

    /**
     * @private Draws the roll.
     * @param {Array<Object>} rows - from {@link accessRowsFromSharing}.
     * @param {boolean} isPublic
     */
    _renderRows(rows, isPublic) {
        const body = this.getBody();
        if (!body) return;
        body.replaceChildren();

        if (isPublic) {
            const pub = document.createElement('p');
            pub.className = 'atlas-access__public';
            pub.dataset.testid = 'atlas-access-public';
            // Said FIRST because it is the widest fact on the screen: the named list below is
            // beside the point while anybody with the link can read the atlas.
            pub.textContent = 'Link público ativo: qualquer pessoa com o link visualiza este atlas, '
                + 'sem entrar e sem aparecer na lista abaixo.';
            body.appendChild(pub);
        }

        if (rows.length === 0) {
            this._setState('Ninguém ainda.', 'atlas-access-empty');
            return;
        }

        const list = document.createElement('ul');
        list.className = 'atlas-access__list';
        list.dataset.testid = 'atlas-access-list';
        for (const row of rows) list.appendChild(this._row(row));
        body.appendChild(list);

        const hint = document.createElement('p');
        hint.className = 'atlas-access__hint';
        hint.dataset.testid = 'atlas-access-hint';
        // The panel reads; it does not write. Saying where writing happens is the difference
        // between a limitation and a dead end.
        hint.textContent = 'Para convidar, mudar nível ou remover alguém, abra o atlas e use Compartilhar.';
        body.appendChild(hint);
    }

    /**
     * @private One participant.
     * @param {{kind: string, id: string, name: string, meta: string, levelLabel: string,
     *   note: string}} row
     * @returns {HTMLElement}
     */
    _row(row) {
        const item = document.createElement('li');
        item.className = 'atlas-access__row';
        item.dataset.testid = row.kind === 'group' ? 'atlas-access-group' : 'atlas-access-person';

        const avatar = document.createElement('span');
        if (row.kind === 'group') {
            avatar.className = 'atlas-access__icon';
            avatar.innerHTML = ICONS.people; // static icon
        } else {
            avatar.className = 'atlas-access__avatar';
            avatar.textContent = getInitials(row.name);
            // Runtime-computed colour, so it belongs in JS; everything else is a class.
            avatar.style.backgroundColor = getPresenceColor(row.id || row.name);
        }
        avatar.setAttribute('aria-hidden', 'true');
        item.appendChild(avatar);

        const info = document.createElement('div');
        info.className = 'atlas-access__info';
        const name = document.createElement('span');
        name.className = 'atlas-access__name';
        name.textContent = row.name;
        info.appendChild(name);
        const meta = [row.meta, row.note].filter(Boolean).join(' · ');
        if (meta) {
            const metaEl = document.createElement('span');
            metaEl.className = 'atlas-access__meta';
            metaEl.textContent = meta;
            info.appendChild(metaEl);
        }
        item.appendChild(info);

        const level = document.createElement('span');
        level.className = 'atlas-access__level';
        level.dataset.testid = 'atlas-access-level';
        level.textContent = row.levelLabel || '—';
        item.appendChild(level);

        return item;
    }
}

/**
 * "Neste computador" — the named LOCAL atlases, as a card grid with a create tile.
 *
 * It renders what it is GIVEN and calls back for everything else: the local-atlas API lives one
 * import away, but keeping it out of here means the page has exactly one file that talks to the
 * store's local registry (`projects-page.js`), which is the file the mount gate names.
 *
 * The local/remote distinction is NEVER carried by colour alone: each card states in words that
 * the atlas stays in this browser, the way a server card states owner and permission.
 */
export class LocalAtlasSection {
    /**
     * @param {Object} options
     * @param {Array<{id: string, name: string, updatedAt: number, createdAt: number}>} [options.atlases]
     * @param {string|null} [options.currentId] - The slot the map will open by default.
     * @param {number} [options.max] - Ceiling of local atlases (`MAX_LOCAL_ATLASES`).
     * @param {Function} options.onOpen - Called with the id to open.
     * @param {Function} options.onCreate - Called with no arguments; owns the name dialog.
     * @param {Function} options.onRename - Called with the entry to rename.
     * @param {Function} [options.onDuplicate] - Called with the entry to copy.
     * @param {Function} options.onDelete - Called with the entry to delete.
     * @param {Function} [options.onOpenFile] - Called with the chosen `.ebgeo` `File`. Omitted
     *   leaves the button out entirely, rather than showing one that does nothing.
     */
    constructor(options = {}) {
        this._atlases = Array.isArray(options.atlases) ? options.atlases : [];
        this._currentId = options.currentId ?? null;
        this._max = Number.isFinite(options.max) ? options.max : null;
        this._onOpen = options.onOpen || (() => {});
        this._onCreate = options.onCreate || (() => {});
        this._onRename = options.onRename || (() => {});
        this._onDuplicate = options.onDuplicate || (() => {});
        this._onDelete = options.onDelete || (() => {});
        this._onOpenFile = options.onOpenFile || null;
        this._root = null;
        this._gridEl = null;
        this._countEl = null;
        this._fileInput = null;
        this._busy = false;
        this._menu = null;
        this._menuAnchor = null;
        this._menuOutside = null;
        this._menuTimer = null;
        setupCleanup(this);
    }

    /**
     * Builds the section into `host`.
     * @param {HTMLElement} [host]
     */
    mount(host = document.body) {
        if (this._root) return;
        this._build();
        host.appendChild(this._root);
    }

    /** Removes the section + its listeners. */
    destroy() {
        if (!this._root) return;
        this._closeMenu();
        clearScopedListeners(this, 'local-cards');
        cleanup(this);
        removeElement(this._root);
        this._root = null;
        this._gridEl = null;
        this._countEl = null;
        this._fileInput = null;
    }

    /**
     * Replaces the list after a create/rename/delete and redraws.
     * @param {Array<Object>} atlases
     * @param {string|null} currentId
     */
    setAtlases(atlases, currentId) {
        this._atlases = Array.isArray(atlases) ? atlases : [];
        this._currentId = currentId ?? null;
        this._busy = false;
        this._render();
    }

    /** @private */
    _build() {
        const root = document.createElement('section');
        root.className = 'local-atlas';
        root.dataset.testid = 'local-atlas-section';

        const header = document.createElement('header');
        header.className = 'local-atlas__header';

        const heading = document.createElement('div');
        const h = document.createElement('h2');
        h.className = 'local-atlas__title';
        h.textContent = 'Neste computador';
        const sub = document.createElement('p');
        sub.className = 'local-atlas__subtitle';
        sub.textContent = 'Atlas guardados neste navegador. Nada aqui vai para o servidor nem é visto por outras pessoas.';
        heading.append(h, sub);
        header.appendChild(heading);

        const actions = document.createElement('div');
        actions.className = 'local-atlas__actions';

        if (this._onOpenFile) actions.appendChild(this._fileButton());

        const count = document.createElement('span');
        count.className = 'local-atlas__count';
        count.dataset.testid = 'local-atlas-count';
        actions.appendChild(count);
        this._countEl = count;

        header.appendChild(actions);
        root.appendChild(header);

        const grid = document.createElement('div');
        grid.className = 'local-atlas__grid';
        grid.dataset.testid = 'local-atlas-list';
        grid.setAttribute('role', 'list');
        grid.setAttribute('aria-label', 'Atlas neste computador');
        root.appendChild(grid);

        this._root = root;
        this._gridEl = grid;
        this._render();
    }

    /**
     * @private "Abrir arquivo .ebgeo", plus the hidden input it drives.
     *
     * Both live in the HEADER and not in the grid, so `_render` (which runs on every create,
     * rename and delete) never rebuilds them: an `<input type="file">` replaced while its picker
     * is open loses the `change` that was about to arrive. The input is reset before every open,
     * or picking the same file twice in a row fires no event at all.
     */
    _fileButton() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.ebgeo';
        input.hidden = true;
        input.dataset.testid = 'local-atlas-file-input';
        addDomListener(this, input, 'change', () => {
            const file = input.files?.[0];
            input.value = '';
            if (file) this._onOpenFile(file);
        });
        this._fileInput = input;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'local-atlas__btn';
        btn.dataset.testid = 'local-atlas-open-file';
        btn.title = 'Abrir um arquivo .ebgeo como um atlas novo neste computador';
        btn.textContent = 'Abrir arquivo .ebgeo';
        addDomListener(this, btn, 'click', () => {
            this._fileInput.value = '';
            this._fileInput.click();
        });

        const wrap = document.createElement('span');
        wrap.className = 'local-atlas__action';
        wrap.append(btn, input);
        return wrap;
    }

    /** @private Rebuilds the cards + the create tile. */
    _render() {
        if (!this._gridEl) return;
        // Same reason as the server grid: this runs again on every create/rename/delete, so the
        // previous cards' listeners are released before their nodes are dropped.
        clearScopedListeners(this, 'local-cards');
        this._closeMenu();
        this._gridEl.replaceChildren();

        for (const atlas of this._atlases) {
            this._gridEl.appendChild(this._card(atlas));
        }
        this._gridEl.appendChild(this._createTile());

        if (this._countEl) {
            this._countEl.textContent = this._max
                ? `${this._atlases.length} de ${this._max}`
                : String(this._atlases.length);
        }
    }

    /** @private One local atlas. */
    _card(atlas) {
        const id = String(atlas?.id ?? '');
        const isCurrent = id !== '' && id === this._currentId;

        const wrap = document.createElement('div');
        wrap.className = 'local-atlas__card-wrap';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `local-atlas__card${isCurrent ? ' local-atlas__card--current' : ''}`;
        btn.dataset.testid = 'local-atlas-item';
        btn.dataset.localAtlasId = id;
        btn.setAttribute('role', 'listitem');
        if (isCurrent) btn.setAttribute('aria-current', 'true');

        const name = document.createElement('div');
        name.className = 'local-atlas__name';
        name.textContent = atlas?.name ?? '';
        btn.appendChild(name);

        const meta = document.createElement('div');
        meta.className = 'local-atlas__meta';
        const when = formatRelativeTime(atlas?.updatedAt);
        meta.textContent = when ? `aberto ${when}` : '';
        btn.appendChild(meta);

        const tags = document.createElement('div');
        tags.className = 'local-atlas__tags';
        const chip = document.createElement('span');
        chip.className = 'local-atlas__chip';
        chip.textContent = 'Local';
        tags.appendChild(chip);
        if (isCurrent) {
            const currentChip = document.createElement('span');
            currentChip.className = 'local-atlas__chip local-atlas__chip--current';
            currentChip.dataset.testid = 'local-atlas-current';
            currentChip.textContent = 'Atual';
            tags.appendChild(currentChip);
        }
        btn.appendChild(tags);

        // The written half of the distinction: the chip's colour says nothing to a colour-blind
        // reader, and nothing at all to a screen reader used to server cards.
        const note = document.createElement('p');
        note.className = 'local-atlas__note';
        note.textContent = 'Fica só neste navegador';
        btn.appendChild(note);

        addScopedDomListener(this, 'local-cards', btn, 'click', () => this._open(atlas));
        wrap.appendChild(btn);

        const menuBtn = document.createElement('button');
        menuBtn.type = 'button';
        menuBtn.className = 'local-atlas__menu-btn';
        menuBtn.dataset.testid = 'local-atlas-menu';
        menuBtn.setAttribute('aria-label', `Mais ações de ${atlas?.name ?? 'atlas local'}`);
        menuBtn.innerHTML = ICONS.dots; // static icon
        addScopedDomListener(this, 'local-cards', menuBtn, 'click', (e) => {
            e.stopPropagation();
            this._openMenu(atlas, menuBtn);
        });
        wrap.appendChild(menuBtn);

        return wrap;
    }

    /** @private The dashed "+ Novo atlas local" tile, always last. */
    _createTile() {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'local-atlas__add';
        tile.dataset.testid = 'local-atlas-create';
        tile.innerHTML = ICONS.plus; // static icon
        const label = document.createElement('span');
        label.textContent = 'Novo atlas local';
        tile.appendChild(label);
        // NOT disabled at the ceiling: the refusal carries a pt-BR message that explains what to
        // do, and a dead button explains nothing.
        addScopedDomListener(this, 'local-cards', tile, 'click', () => this._onCreate());
        return tile;
    }

    /** @private */
    _open(atlas) {
        if (this._busy) return;
        this._busy = true;
        // Opening navigates away, so nothing resets `_busy` on success; a caller that stays on
        // the page (a refusal) calls `setAtlases`, which clears it.
        this._onOpen(atlas);
    }

    /** @private Card actions, anchored to the ⋯ button. */
    _openMenu(atlas, anchorBtn) {
        if (this._menu && this._menuAnchor === anchorBtn) {
            this._closeMenu();
            return;
        }
        this._closeMenu();

        const menu = document.createElement('div');
        menu.className = 'local-atlas__menu';
        menu.dataset.testid = 'local-atlas-menu-popup';
        const rect = anchorBtn.getBoundingClientRect();
        menu.style.top = `${Math.round(rect.bottom + 4)}px`;
        menu.style.left = `${Math.round(rect.right - 200)}px`;

        const addItem = (label, testid, danger, fn) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = `local-atlas__menu-item${danger ? ' local-atlas__menu-item--danger' : ''}`;
            item.dataset.testid = testid;
            item.textContent = label;
            item.addEventListener('click', () => { this._closeMenu(); fn(); });
            menu.appendChild(item);
        };

        addItem('Abrir', 'local-atlas-open', false, () => this._open(atlas));
        addItem('Renomear', 'local-atlas-rename', false, () => this._onRename(atlas));
        // Mesmo rótulo do cartão de servidor: é a mesma ação para o usuário, ainda que por baixo
        // uma seja uma rota do backend e a outra uma cópia banco a banco entre dois namespaces de
        // IndexedDB (`copyAtlasDatabases`).
        addItem('Fazer uma cópia', 'local-atlas-duplicate', false, () => this._onDuplicate(atlas));
        addItem('Excluir', 'local-atlas-delete', true, () => this._onDelete(atlas));

        this._root.appendChild(menu);
        this._menu = menu;
        this._menuAnchor = anchorBtn;
        this._menuOutside = (e) => {
            // contains(): the click may land on the button's inner <svg>, which is not the button.
            if (!menu.contains(e.target) && !anchorBtn.contains(e.target)) this._closeMenu();
        };
        this._menuTimer = setTimeout(() => {
            this._menuTimer = null;
            document.addEventListener('mousedown', this._menuOutside);
        }, 0);
    }

    /** @private */
    _closeMenu() {
        if (this._menuTimer != null) { clearTimeout(this._menuTimer); this._menuTimer = null; }
        if (this._menu) { this._menu.remove(); this._menu = null; }
        this._menuAnchor = null;
        if (this._menuOutside) {
            document.removeEventListener('mousedown', this._menuOutside);
            this._menuOutside = null;
        }
    }
}

/**
 * The signed-out invitation that stands where the server section goes.
 *
 * Its own component so the page never has to render a half-alive Drive: with no session there is
 * no list to filter, no trash to open and no create to offer, and a disabled copy of all of that
 * would be a promise the page cannot keep.
 *
 * @param {Object} options
 * @param {Function} options.onLogin - Called when the visitor asks to sign in.
 * @returns {HTMLElement}
 */
export function createServerInvite({ onLogin }) {
    const section = document.createElement('section');
    section.className = 'server-invite';
    section.dataset.testid = 'server-invite';

    const h = document.createElement('h2');
    h.className = 'server-invite__title';
    h.textContent = 'No servidor';
    section.appendChild(h);

    const text = document.createElement('p');
    text.className = 'server-invite__text';
    text.textContent = 'Entre para abrir os atlas do servidor, colaborar em tempo real e compartilhar '
        + 'com sua equipe. Os atlas deste computador continuam funcionando sem conta.';
    section.appendChild(text);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'atlas-drive__btn atlas-drive__btn--primary';
    btn.dataset.testid = 'projects-login';
    btn.textContent = 'Entrar';
    btn.addEventListener('click', () => onLogin());
    section.appendChild(btn);

    return section;
}
