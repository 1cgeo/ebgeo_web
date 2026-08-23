// Path: js/modals/sharing.modal.js

/**
 * @fileoverview Atlas sharing modal.
 *
 * Lets the atlas OWNER manage who can see/edit a project:
 *   - Public link: a toggle that enables/disables an anonymous read link, with a
 *     copy-to-clipboard affordance.
 *   - Members: the list of users the atlas is shared with, each with a permission
 *     select (Leitura/Edição → read/write) and a destructive remove button.
 *   - Add people: a debounced user search; picking a result grants 'read' (Leitura) by default
 *     (DEFAULT_GRANT_PERMISSION — "default lowers, never raises"; elevate via the member dropdown).
 *
 * The modal is standalone — it receives an `atlasId` and talks to the backend via
 * `apiClient` (sharing/searchUsers REST routes). The caller decides whether to show
 * it (the backend independently enforces `manage` on every mutation, NOT owner-only — this
 * JSDoc said owner-only until 2026-07-25 and a caller trusting it would hide the button from
 * the co-Gestor, who is exactly who sharing is for). All mutations re-read the canonical
 * sharing config so the UI never drifts from the server.
 *
 * Exports {@link showSharingModal}.
 */

import { ModalBase } from './modal.base.js';
import {
    addScopedDomListener,
    clearScopedListeners,
    subscribe,
    trackTimer,
} from '@utils/event-cleanup.js';
import { escapeHtml } from '@utils/html-escape.js';
import { getPresenceColor, getInitials } from '@js/presence/presence-colors.js';
import { presenceStore } from '@js/presence/presence-store.js';
import { syncEngine } from '@store/sync/sync-engine.js';
import { getEventBus } from '@store/services.js';
import { EventTypes } from '@events/event_types.js';
import { apiClient } from '@store/sync/api-client.js';
import { showError, showSuccess } from '@utils/toast_service.js';
import { sessionContext } from '@store/sync/session-context.js';
import { showConfirm } from '@modals/index.js';
// Import DIRETO, e não pelo barrel `@catalog`: `grant-tree.js` tem ZERO imports (é uma
// folha de funções puras) e é essa propriedade que permite reusá-lo daqui sem arrastar o
// catálogo inteiro para dentro do modal de compartilhar atlas. O rótulo da `<option>` é o
// MESMO nos dois eixos porque o problema é o mesmo: desde que a unicidade de nome de grupo
// passou a ser por dono, dois grupos homônimos de gente diferente são estado legal, e uma
// lista que mostre só o nome faz escolher o coletivo errado sem erro nenhum.
// `accessLossClause` vem do mesmo lugar e pela mesma razão: conjugar "perde"/"perdem" com
// uma contagem, e dizer o CONTRÁRIO quando a contagem é zero, é regra que já foi paga uma
// vez do lado do catálogo. Reescrevê-la aqui daria a terceira cópia de uma frase que os
// dois eixos precisam ter igual.
import { accessLossClause, groupOptionLabel } from '@js/catalog/grant-tree.js';
// A DICA DO SELETOR MANDA A PESSOA PARA UMA PORTA, então ela precisa dizer o nome que ESTA
// pessoa vê escrito naquela porta — "Grupos" para uma sessão comum, "Catálogo" para o
// produtor, "Administração" para o administrador. Escrever "Administração" fixo mandaria o
// usuário comum procurar um botão que não existe para ele. `adminAudience` é a definição
// única desse rótulo (módulo folha, zero imports) e é a MESMA que a barra do mapa e o seletor
// de atlas consultam; `frontend/tests/unit/admin-audiencia.test.js` varre o versionamento e
// reprova quem escreve o rótulo sem consultá-la.
import { adminAudience } from '@js/admin/admin-audience.js';

/**
 * The message to show for a failed sharing mutation: the SERVER's explanation when it sent one,
 * the generic sentence otherwise.
 *
 * These handlers used to `catch { showError('...') }` without binding the error, throwing away
 * exactly the part that says WHY — and the backend distinguishes real cases on these routes
 * (removing the owner answers 404; a co-Gestor demoted mid-operation gets 403 from
 * `requireAtlasPermission('manage')`). Same shape the admin panel and the project drive already
 * use (`error?.message || 'fallback'`), plus one guard they lack: `_request` invents
 * `HTTP <status>` when the response carries no message, and that string is a placeholder for the
 * console, never user copy.
 *
 * Pure — no I/O, no DOM.
 * @param {*} error - The caught error (an ApiError carries the server `message`).
 * @param {string} fallback - Generic pt-BR sentence for when there is nothing better.
 * @returns {string}
 */
export function sharingErrorMessage(error, fallback) {
    const message = typeof error?.message === 'string' ? error.message.trim() : '';
    if (!message) return fallback;
    if (/^HTTP \d{3}$/.test(message)) return fallback;
    return message;
}

/**
 * Reparte o payload de `GET /sharing` na forma que a tela desenha.
 *
 * POR QUE ELE É PURO E EXPORTADO: `_load()` fazia parse e render juntos, então nada da
 * FORMA do payload tinha cobertura em node — e o payload acabou de ganhar um segundo array.
 * Extraí-lo é o que torna a parte verificável desta tela verificável.
 *
 * `groups: []` QUANDO A CHAVE FALTA, e isso é compatibilidade real, não paranoia: o cliente
 * novo pode falar com um servidor que ainda não conhece o eixo de grupo (implantação em duas
 * etapas), e o custo de tratar ausência como lista vazia é uma linha.
 *
 * `shares` é repassado VERBATIM — sem filtrar, sem reordenar. Quem decide quem aparece é o
 * servidor, e reordenar aqui criaria uma segunda ordem que a próxima tela teria de repetir.
 *
 * @param {Object|null} cfg - O corpo de `apiClient.getSharing`.
 * @returns {{isPublic: boolean, publicLink: string|null, owner: Object|null, shares: Array, groups: Array}}
 */
export function partitionSharingConfig(cfg) {
    return {
        isPublic: Boolean(cfg?.isPublic),
        publicLink: cfg?.publicLink ?? null,
        owner: cfg?.owner ?? null,
        shares: Array.isArray(cfg?.shares) ? cfg.shares : [],
        groups: Array.isArray(cfg?.groups) ? cfg.groups : [],
    };
}

/**
 * DE QUEM É ESTE GRUPO, na linha de quem tem acesso ao atlas.
 *
 * É A MITIGAÇÃO (ii) DA DECISÃO DO DONO, e sem ela o eixo de grupo não deveria ter chegado a
 * `manage`: um share coletivo entrega ao DONO daquele grupo o poder de pôr mais gente dentro
 * do atlas — inclusive como co-Gestor — sem passar por quem compartilhou, sem linha nova em
 * `atlas_shares` e sem tocar em gate nenhum. Esta lista é a ÚNICA superfície onde a
 * delegação é visível; enquanto ela mostrasse só o nome do grupo, a parte delegada do
 * mecanismo não apareceria em tela alguma.
 *
 * Espelha `granteeGroupOwnerLabel` (`js/catalog/grant-tree.js`) na frase e no ramo do órfão,
 * e NÃO o importa: aquele arquivo é do eixo de RECURSO e este é do eixo de ATLAS. Mesmo
 * vocabulário, dois eixos — a constituição é explícita em que eles não compartilham palavra.
 *
 * Grupo SEM dono é estado real (o backfill da migração adota `created_by`, que pode ser nulo
 * em linha antiga) e dizê-lo por extenso importa: um grupo órfão não entrega acesso a
 * ninguém, porque a resolução exige dono vivo.
 *
 * @param {{ownerNome?: string, ownerUsername?: string}} group
 * @returns {string} A frase pronta. Nunca vazia: a ausência de dono também é um fato.
 */
export function sharingGroupOwnerLabel(group) {
    const nome = (group?.ownerNome || '').trim();
    const username = (group?.ownerUsername || '').trim();
    if (nome && username) return `Dono: ${nome} (@${username})`;
    if (nome) return `Dono: ${nome}`;
    if (username) return `Dono: @${username}`;
    return 'Sem dono definido';
}

/**
 * Quantas pessoas o grupo carrega, por extenso.
 *
 * O NÚMERO É O TAMANHO DO QUE SE ESTÁ ACEITANDO. "Equipe Alfa" não diz se são três pessoas
 * ou quarenta, e a diferença é a única coisa que separa um convite de uma abertura.
 * @param {{memberCount?: number}} group
 * @returns {string}
 */
export function sharingGroupSizeLabel(group) {
    const n = sharingGroupMemberCount(group);
    if (n === 0) return 'sem membros';
    return `${n} ${n === 1 ? 'pessoa' : 'pessoas'}`;
}

/**
 * O tamanho do grupo como inteiro não negativo.
 *
 * `memberCount` atravessa a rede vindo de um `COUNT` do SQL, e ausente, string, `NaN` e
 * negativo colapsam todos em 0 de propósito: nenhum deles descreve gente perdendo acesso,
 * e todos conjugariam no plural por acidente se fossem adiante como número. É o mesmo
 * colapso de `groupMemberCount` (`js/catalog/grant-tree.js`), no eixo de recurso.
 *
 * Módulo-privado porque a tela nunca mostra o número cru: quem mostra é
 * {@link sharingGroupSizeLabel}, e quem decide o verbo é `accessLossClause`.
 * @param {{memberCount?: *}} group
 * @returns {number}
 */
function sharingGroupMemberCount(group) {
    const n = Number(group?.memberCount);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/**
 * O QUE O DIÁLOGO DESTRUTIVO DIZ ANTES DE TIRAR UM GRUPO DO ATLAS.
 *
 * A frase anterior era `${sharingGroupSizeLabel(grupo)} perdem o acesso`, e o verbo fixo
 * no plural fazia dois dos três ramos mentirem: "1 pessoa perdem o acesso" e, o caso caro,
 * "sem membros perdem o acesso" — um `destructive: true` afirmando uma perda que não vai
 * acontecer. Quem conjuga agora é `accessLossClause`, do eixo de recurso, onde essa mesma
 * classe já tinha sido paga.
 *
 * O RAMO ZERO DIZ O CONTRÁRIO, não a mesma coisa mais curta: um grupo sem membros não
 * entrega acesso a ninguém, então tirá-lo não tira nada de ninguém, e prometer uma queda
 * impossível gasta a credibilidade da frase alta no caso em que ela É alta (é a mesma
 * escolha de `groupDeletionWarning`, em `js/admin/group-phrases.js`).
 *
 * Pura, e exportada por isso: é a parte desta tela que se verifica em node.
 * @param {{name?: string, memberCount?: *}} group
 * @returns {string}
 */
export function sharingGroupRemovalWarning(group) {
    // `?? 'este grupo'`: a linha some da lista entre o clique e a busca por `groupId` se o
    // servidor for relido no meio, e um diálogo destrutivo sem sujeito é pior que genérico.
    const nome = group?.name ?? 'este grupo';
    const membros = sharingGroupMemberCount(group);
    if (membros === 0) {
        return `Tirar ${nome} deste atlas? Ele não tem membros hoje: ${accessLossClause(0)}.`;
    }
    return `Tirar ${nome} deste atlas? `
        + `${accessLossClause(membros, sharingGroupSizeLabel(group))} que vinha por ele.`;
}

/**
 * Os grupos que ainda PODEM ser oferecidos no seletor: os que o chamador administra menos os
 * que já estão no atlas.
 *
 * O SERVIDOR JÁ RECORTA `listAccessGroups()` POR POSSE (só administrados), então este filtro
 * não é o gate — o gate é `assertCanAdministerGroup`, e ele responde 404. O que este filtro
 * evita é oferecer o que já está lá, que responderia 201 e não mudaria nada.
 * @param {Array<{id?: string}>} administrados
 * @param {Array<{groupId?: string}>} jaNoAtlas
 * @returns {Array}
 */
export function selectableGroups(administrados, jaNoAtlas) {
    const dentro = new Set((jaNoAtlas ?? []).map((g) => String(g?.groupId)));
    return (administrados ?? []).filter((g) => !dentro.has(String(g?.id)));
}

/**
 * As `<option>` do seletor de nível de UMA linha de grupo, já com o que está SELECIONADO e o
 * que está DESABILITADO.
 *
 * O SERVIDOR APLICA DUAS REGRAS DIFERENTES NA MESMA ROTA, e é por isso que esta função
 * existe em vez de um `disabled` no `<select>` inteiro: SUBIR o nível de um grupo exige
 * administrá-lo (responde 404 quando não), REBAIXAR e REMOVER não exigem nada além de
 * `manage` no atlas. Um seletor totalmente aberto oferecia a subida e devolvia um erro
 * cru do servidor sobre um grupo desenhado na tela; um seletor totalmente fechado tiraria
 * do gestor do atlas a única ferramenta NÃO destrutiva que ele tem sobre uma composição
 * alheia. As duas metades erram, e cada uma erra para um lado.
 *
 * NÍVEL DESCONHECIDO NORMALIZA PARA O MENOR (`read`), que é falha fechada: uma linha vinda
 * com `permission` ausente ou fora dos quatro não pode desenhar um `<select>` sem seleção
 * nenhuma (o navegador escolheria a primeira opção e o próximo `change` a enviaria como se
 * fosse intenção do usuário).
 *
 * Pura — sem DOM, sem I/O, sem `sessionContext`: quem responde "eu administro este grupo?"
 * é o chamador, porque a resposta envolve o papel GLOBAL de administrador, que é outro eixo.
 *
 * @param {{permission?: string, ownerId?: string}} group - a linha de grupo do payload.
 * @param {{userId?: string|null, isAdmin?: boolean}} sessao
 * @returns {Array<{value: string, label: string, selected: boolean, disabled: boolean}>}
 */
export function groupLevelOptions(group, sessao = {}) {
    const indice = PERMISSION_LEVELS.findIndex((p) => p.value === group?.permission);
    const atual = indice >= 0 ? indice : 0;
    const dono = group?.ownerId ? String(group.ownerId) : null;
    const administra = Boolean(sessao?.isAdmin)
        || (dono !== null && sessao?.userId != null && dono === String(sessao.userId));
    return PERMISSION_LEVELS.map((p, i) => ({
        value: p.value,
        label: p.label,
        selected: i === atual,
        disabled: !administra && i > atual,
    }));
}

/** Debounce (ms) for the user-search input. */
const SEARCH_DEBOUNCE_MS = 300;
/** Minimum query length the backend accepts for user search. */
const SEARCH_MIN_CHARS = 2;
/** How long the "Copiado" feedback stays on the copy button. */
const COPY_FEEDBACK_MS = 1800;
/**
 * Default permission granted when a searched user is picked. Deliberately the LOWEST level
 * ('read') — "a permissão padrão abaixa, nunca eleva" (Felt): granting more than view is an
 * explicit, deliberate raise via the member dropdown, never an accident of inviting someone.
 */
const DEFAULT_GRANT_PERMISSION = 'read';
/** Permission levels offered in the member dropdown (pt-BR labels, ascending access). */
const PERMISSION_LEVELS = [
    { value: 'read', label: 'Leitura' },
    { value: 'comment', label: 'Comentário' },
    { value: 'write', label: 'Edição' },
    { value: 'manage', label: 'Gestão' },
];

/**
 * O QUE O SERVIDOR DE FATO APLICA, quando isso é MAIOR que a linha desta pessoa.
 *
 * O acesso ao atlas resolve pelo MAIOR nível entre o compartilhamento nominal e o de grupo
 * (`fn_user_atlas_shares`, no servidor), que é o princípio de caminhos independentes. A
 * consequência mordia aqui: o gestor rebaixava alguém para leitura, o `<select>` passava a
 * exibir "Leitura", e a pessoa continuava editando por um grupo. A tela afirmava um
 * rebaixamento que não aconteceu, que é a forma mais cara de erro de permissão -- o
 * operador tem prova de que fez o certo.
 *
 * O `<select>` continua sendo a LINHA (é ela que ele edita); o selo mostra o EFEITO.
 *
 * NÃO NOMEIA O GRUPO, de propósito: o gestor do atlas vê o dono de cada grupo, nunca a
 * composição (cláusula 5.3 da constituição), e dizer "por causa do grupo X" revelaria que
 * aquela pessoa é membro de X. Para não se enganar, basta ele saber que o rebaixamento não
 * teve efeito.
 *
 * @param {{permission?: string, effectivePermission?: string}} share
 * @returns {{label: string}|null} o rótulo do nível efetivo, ou null quando não há excedente
 */
export function excedenteDeGrupo(share) {
    const linha = PERMISSION_LEVELS.findIndex((p) => p.value === share?.permission);
    const efetiva = PERMISSION_LEVELS.findIndex((p) => p.value === share?.effectivePermission);
    if (efetiva < 0 || linha < 0 || efetiva <= linha) return null;
    return { label: PERMISSION_LEVELS[efetiva].label };
}

/**
 * Icons used by the modal (inline SVG, currentColor).
 */
const ICONS = {
    share: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>`,
    link: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg>`,
    copy: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>`,
    check: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"/>
    </svg>`,
    remove: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>`,
    search: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/>
        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>`,
    // O ícone do COLETIVO. Ele existe para que a linha de grupo NÃO use o avatar de
    // iniciais coloridas: aquele deriva cor e letras de uma identidade de pessoa, e um
    // coletivo com cara de pessoa é a confusão que a seção separada existe para impedir.
    group: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>`,
};

/**
 * Sharing modal class.
 * @extends ModalBase
 */
export class SharingModal extends ModalBase {
    /**
     * @param {string} atlasId - Atlas to manage sharing for.
     * @param {Object} [options]
     * @param {string} [options.atlasName] - Display name for the header title.
     */
    constructor(atlasId, { atlasName } = {}) {
        const name = atlasName ? String(atlasName) : '';
        super({
            id: 'sharing-modal',
            title: name ? `Compartilhar ${name}` : 'Compartilhar',
            icon: ICONS.share,
            destroyOnHide: true,
        });

        this._atlasId = atlasId;
        /** @type {boolean} */
        this._isPublic = false;
        /** @type {string|null} */
        this._publicLink = null;
        /** @type {Array<{userId:string, username:string, nome:string, permission:string}>} */
        this._shares = [];
        /** @type {Array<{groupId:string, name:string, permission:string, memberCount:number, ownerNome:string|null}>} */
        this._groups = [];
        /** @type {Array<{id:string, name:string, member_count:number}>|null} Grupos que EU administro (lazy). */
        this._myGroups = null;
        /** @type {{userId:string, username:string, nome:string}|null} The atlas owner (badge + transfer). */
        this._owner = null;
        /** @type {boolean} Network-in-flight guard (one mutation at a time). */
        this._busy = false;
        /** @type {number|null} Pending debounced-search timer id. */
        this._searchTimer = null;
        /** @type {number} Monotonic token so out-of-order search responses are dropped. */
        this._searchSeq = 0;
        /** @type {boolean} Whether the sharing config finished loading (gates presence re-renders). */
        this._loaded = false;
        /** @type {Set<string>} userIds online in this atlas (recomputed on each body render). */
        this._onlineIds = new Set();
    }

    /**
     * Renders the modal shell and kicks off the initial load.
     * @returns {HTMLElement}
     */
    render() {
        const overlay = super.render();
        this._overlay.dataset.testid = 'sharing-modal';
        this.getContainer().classList.add('sharing-modal-container');

        const body = this.getBody();
        body.innerHTML = this._renderLoading();

        document.body.appendChild(overlay);

        // Fire-and-forget initial fetch (loading state already shown).
        this._load();

        // Live "Vendo agora": refresh on presence membership changes (join/leave/away). PRESENCE_CHANGED
        // is infrequent (not per cursor move), so re-rendering the body is cheap. subscribe() is tracked
        // by ModalBase's setupCleanup → auto-unsubscribed in super.hide() (no manual teardown needed).
        subscribe(this, getEventBus(), EventTypes.PRESENCE_CHANGED, () => this._onPresenceChanged());

        return overlay;
    }

    /**
     * @private Re-renders the body when presence membership changes, so "Vendo agora" and the online
     * dots stay live — unless the user is mid-search (don't yank the field out from under them).
     */
    _onPresenceChanged() {
        if (!this._loaded) return;
        const body = this.getBody();
        if (!body) return;
        // Don't re-render out from under an in-progress interaction: a focused search/permission field,
        // or an open results dropdown (the user is mid-pick).
        const active = document.activeElement;
        if (active && body.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'SELECT')) return;
        const results = body.querySelector('[data-results]');
        if (results && !results.hidden) return;
        this._renderBody();
    }

    // ===== DATA =====

    /**
     * @private Fetches the sharing config and (re)renders the body.
     *
     * `destroyOnHide` means Escape (or an overlay click) during the in-flight fetch tears the DOM
     * down and `getBody()` starts returning undefined — so both the success and the failure path
     * bail out when the body is gone. Do NOT guard on `this._isOpen` instead: `_load()` is fired by
     * `render()`, BEFORE `show()`, so `_isOpen` is legitimately false at that moment.
     */
    async _load() {
        try {
            const cfg = await apiClient.getSharing(this._atlasId);
            if (!this.getBody()) return; // modal closed while the request was in flight
            const { isPublic, publicLink, owner, shares, groups } = partitionSharingConfig(cfg);
            this._isPublic = isPublic;
            this._publicLink = publicLink;
            this._owner = owner;
            this._shares = shares;
            this._groups = groups;
            this._loaded = true;
            this._renderBody();
            // Os grupos que EU administro chegam por OUTRA rota, e por isso não bloqueiam o
            // corpo: a lista de quem já tem acesso é o que a pessoa veio ver, e o seletor é o
            // que ela usa depois. Falhar aqui deixa a seção sem seletor, com a dica dizendo
            // por quê, em vez de derrubar a tela inteira.
            this._loadMyGroups();
        } catch {
            if (!this.getBody()) return;
            this._renderError();
        }
    }

    /**
     * @private Lê os grupos que o chamador ADMINISTRA, para o seletor.
     *
     * UMA VEZ POR ABERTURA, e não a cada `_load()`. `_load()` roda depois de toda mutação, e
     * esta função re-renderiza o corpo quando termina: refazê-la a cada vez traria um
     * `_renderBody()` fora de ordem, capaz de aterrissar enquanto a pessoa digita na busca de
     * pessoas e arrancar o campo debaixo dela. O que muda entre duas mutações é QUAIS grupos
     * já estão no atlas, e isso vem de `this._groups`, que `selectableGroups` subtrai — não da
     * lista de grupos administrados, que só muda em outra página.
     *
     * `listAccessGroups()` já vem recortada por posse pelo servidor, então não há filtro de
     * autoridade a aplicar aqui. Erro vira lista vazia de propósito: o seletor some e a dica
     * explica, o que é melhor que oferecer opções que o servidor recusaria com 404.
     */
    async _loadMyGroups() {
        if (this._myGroups !== null) return;
        try {
            const grupos = await apiClient.listAccessGroups();
            if (!this.getBody()) return;
            this._myGroups = Array.isArray(grupos) ? grupos : [];
        } catch {
            if (!this.getBody()) return;
            this._myGroups = [];
        }
        if (this._loaded) this._renderBody();
    }

    // ===== RENDER =====

    /** @private */
    _renderLoading() {
        return `
            <div class="sharing__state" data-testid="sharing-loading">
                <span class="sharing__spinner" aria-hidden="true"></span>
                <span>Carregando…</span>
            </div>
        `;
    }

    /** @private Renders the error state (with a retry button) into the body. */
    _renderError() {
        const body = this.getBody();
        if (!body) return; // modal already destroyed — nothing to render into, no state to clear
        clearScopedListeners(this, 'body');
        body.innerHTML = `
            <div class="sharing__state sharing__state--error" data-testid="sharing-error">
                <p>Não foi possível carregar o compartilhamento.</p>
                <button type="button" class="prompt-modal-btn prompt-modal-btn-confirm" data-action="retry">
                    Tentar novamente
                </button>
            </div>
        `;
        const retry = body.querySelector('[data-action="retry"]');
        if (retry) {
            addScopedDomListener(this, 'body', retry, 'click', () => {
                if (!this.getBody()) return;
                body.innerHTML = this._renderLoading();
                this._load();
            });
        }
    }

    /** @private Renders the full body (public + presence + members + add) and wires listeners. */
    _renderBody() {
        const body = this.getBody();
        if (!body) return; // modal already destroyed — nothing to render into, no state to clear
        clearScopedListeners(this, 'body');
        this._onlineIds = this._computeOnlineIds();
        body.innerHTML = `
            <div class="sharing">
                ${this._renderPublicSection()}
                ${this._renderPresenceSection()}
                ${this._renderMembersSection()}
                ${this._renderGroupsSection()}
                ${this._renderAddSection()}
            </div>
        `;
        this._setupBodyListeners();
    }

    /**
     * @private Users currently connected to THIS atlas, EXCLUDING self — empty unless the modal targets
     * the atlas we are live-connected to (presence is per-connected-atlas; sharing can be opened for
     * others). Single source of truth for both "Vendo agora" and the per-member online dots; self is
     * dropped for parity with every other presence surface (online-users.control.js).
     * @returns {Array<Object>}
     */
    _onlineUsers() {
        if (syncEngine.atlasId !== this._atlasId) return [];
        const myId = String(sessionContext.userId ?? '');
        return presenceStore.getUsers()
            .filter((u) => !u.away && u.userId && String(u.userId) !== myId);
    }

    /** @private Set of online userIds (drives the per-member online dot). @returns {Set<string>} */
    _computeOnlineIds() {
        return new Set(this._onlineUsers().map((u) => String(u.userId)));
    }

    /**
     * @private "Vendo agora" — avatars of the OTHER users currently connected to this atlas. Live via
     * the PRESENCE_CHANGED subscription; hidden when nobody else is connected.
     */
    _renderPresenceSection() {
        const users = this._onlineUsers();
        if (!users.length) return '';
        const avatars = users
            .map((u) => this._avatar(u.userId ?? u.clientId, u.userName ?? 'Usuário', {
                online: true,
                title: u.userName ?? 'Usuário',
            }))
            .join('');
        return `
            <section class="sharing-section sharing-presence" data-testid="sharing-presence">
                <h3 class="sharing-section__title">Vendo agora</h3>
                <div class="sharing-presence__avatars">${avatars}</div>
            </section>
        `;
    }

    /**
     * @private The one place that builds a presence-colored initials avatar (was copy-pasted across the
     * owner/member/presence rows). The inline background-color is a runtime-computed value (allowed).
     * @param {string} userId - identity for the deterministic color.
     * @param {string} name - display name for the initials.
     * @param {{online?: boolean, title?: string|null}} [opts]
     */
    _avatar(userId, name, { online = false, title = null } = {}) {
        const color = escapeHtml(getPresenceColor(userId));
        const initials = escapeHtml(getInitials(name));
        const onlineCls = online ? ' sharing-avatar--online' : '';
        const attr = title ? `title="${escapeHtml(title)}"` : 'aria-hidden="true"';
        return `<span class="sharing-avatar${onlineCls}" ${attr} style="background-color: ${color};">${initials}</span>`;
    }

    /** @private */
    _renderPublicSection() {
        const linkRow = this._isPublic
            ? `
                <div class="sharing-link" data-testid="sharing-public-link-row">
                    <span class="sharing-link__icon" aria-hidden="true">${ICONS.link}</span>
                    <input type="text" class="sharing-link__input" data-testid="sharing-public-link"
                           value="${escapeHtml(this._publicLink ?? '')}" readonly aria-label="Link público">
                    <button type="button" class="prompt-modal-btn prompt-modal-btn-confirm sharing-link__copy"
                            data-action="copy" data-testid="sharing-copy-link">
                        ${ICONS.copy}<span>Copiar</span>
                    </button>
                </div>
            `
            : '';

        return `
            <section class="sharing-section">
                <div class="settings-field">
                    <div class="sharing-toggle-row">
                        <div class="sharing-toggle-row__text">
                            <span class="settings-field__label">Link público</span>
                            <span class="settings-field__description">
                                Qualquer pessoa com o link pode visualizar este atlas, sem precisar entrar.
                            </span>
                        </div>
                        <button type="button" role="switch"
                                class="sharing-switch${this._isPublic ? ' sharing-switch--on' : ''}"
                                aria-checked="${this._isPublic ? 'true' : 'false'}"
                                aria-label="Ativar link público"
                                data-action="toggle-public" data-testid="sharing-public-toggle">
                            <span class="sharing-switch__thumb" aria-hidden="true"></span>
                        </button>
                    </div>
                    ${linkRow}
                </div>
            </section>
        `;
    }

    /** @private */
    _renderMembersSection() {
        const ownerRow = this._owner ? this._renderOwnerItem(this._owner) : '';
        const shareRows = this._shares.length
            ? this._shares.map((s) => this._renderMemberItem(s)).join('')
            : (this._owner ? '' : this._renderEmptyMembers());
        return `
            <section class="sharing-section">
                <h3 class="sharing-section__title">Membros</h3>
                <div class="sharing-members">
                    ${ownerRow}
                    ${shareRows}
                </div>
            </section>
        `;
    }

    /**
     * @private Renders the atlas owner row (read-only — a "(dono)" badge, no controls).
     * @param {{userId:string, username:string, nome:string}} owner
     */
    _renderOwnerItem(owner) {
        const userId = String(owner?.userId ?? '');
        const nome = owner?.nome ?? owner?.username ?? '';
        const username = owner?.username ?? '';
        return `
            <div class="sharing-member" data-testid="sharing-owner-item">
                ${this._avatar(userId, nome, { online: this._onlineIds?.has(userId) })}
                <div class="sharing-member__info">
                    <span class="sharing-member__name">${escapeHtml(nome)}</span>
                    <span class="sharing-member__username">@${escapeHtml(username)}</span>
                </div>
                <span class="sharing-member__owner-badge">Gestor (dono)</span>
            </div>
        `;
    }

    /** @private */
    _renderEmptyMembers() {
        return `
            <div class="sharing__empty" data-testid="sharing-empty">
                Ninguém ainda
            </div>
        `;
    }

    /**
     * @private
     * @param {{userId:string, username:string, nome:string, permission:string}} share
     */
    _renderMemberItem(share) {
        const userId = String(share?.userId ?? '');
        const nome = share?.nome ?? share?.username ?? '';
        const username = share?.username ?? '';
        const current = PERMISSION_LEVELS.some((p) => p.value === share?.permission) ? share.permission : 'read';
        const excedente = excedenteDeGrupo(share);
        const options = PERMISSION_LEVELS.map((p) =>
            `<option value="${p.value}"${current === p.value ? ' selected' : ''}>${p.label}</option>`
        ).join('');
        // Only the current owner may hand ownership to a member.
        const transferBtn = sessionContext.role === 'owner'
            ? `<button type="button" class="sharing-member__transfer" data-action="transfer"
                        data-testid="sharing-member-transfer" aria-label="Tornar ${escapeHtml(nome)} o dono">Tornar dono</button>`
            : '';

        return `
            <div class="sharing-member" data-testid="sharing-member-item" data-user-id="${escapeHtml(userId)}">
                ${this._avatar(userId, nome, { online: this._onlineIds?.has(userId) })}
                <div class="sharing-member__info">
                    <span class="sharing-member__name">${escapeHtml(nome)}</span>
                    <span class="sharing-member__username">@${escapeHtml(username)}</span>
                    ${excedente
        ? `<span class="sharing-member__efetiva" data-testid="sharing-member-efetiva"
                             title="Um grupo deste atlas dá a esta pessoa ${escapeHtml(excedente.label)}. Mudar a permissão ao lado não retira o que vem pelo grupo.">
                            ${escapeHtml(excedente.label)} por grupo
                       </span>`
        : ''}
                </div>
                ${transferBtn}
                <select class="sharing-member__permission" data-action="permission"
                        data-testid="sharing-member-permission" aria-label="Permissão de ${escapeHtml(nome)}">
                    ${options}
                </select>
                <button type="button" class="sharing-member__remove" data-action="remove"
                        data-testid="sharing-member-remove" aria-label="Remover ${escapeHtml(nome)}">
                    ${ICONS.remove}
                </button>
            </div>
        `;
    }

    /**
     * @private A seção "Grupos": quem alcança este atlas por COLETIVO, e o seletor para
     * acrescentar um.
     *
     * Ela fica ENTRE "Membros" e "Adicionar pessoas" porque é a mesma pergunta que "Membros"
     * responde (quem alcança o atlas) por outro caminho — separá-la do bloco de adicionar
     * pessoas é o que impede a leitura de que grupo é um tipo de pessoa.
     */
    _renderGroupsSection() {
        const linhas = this._groups.length
            ? this._groups.map((g) => this._renderGroupItem(g)).join('')
            : `<div class="sharing__empty" data-testid="sharing-groups-empty">Nenhum grupo</div>`;
        return `
            <section class="sharing-section" data-testid="sharing-groups">
                <h3 class="sharing-section__title">Grupos</h3>
                <div class="sharing-members">${linhas}</div>
                ${this._renderGroupPicker()}
            </section>
        `;
    }

    /**
     * @private Uma linha de grupo.
     *
     * O AVATAR É UM ÍCONE, NUNCA `getPresenceColor`/`getInitials`: aqueles derivam cor e
     * iniciais de uma IDENTIDADE DE PESSOA, e um coletivo com cara de pessoa é exatamente a
     * confusão que a seção separada existe para impedir.
     *
     * NÃO HÁ "Tornar dono" aqui, e a ausência é regra: posse é nominal por construção
     * (`atlas.owner_id` é uma coluna), e o servidor recusa transferir para quem só alcança o
     * atlas por grupo.
     *
     * O `<select>` NÃO OFERECE O QUE O SERVIDOR RECUSA: as opções ACIMA do nível vigente
     * ficam desabilitadas quando o chamador não administra o grupo, porque subir exige posse
     * e as outras três ações não (ver `groupLevelOptions`).
     *
     * A META LEVA `title` COM O TEXTO INTEIRO porque `.sharing-group__meta` a corta com
     * reticências (`css/sharing.css`), e o que fica de fora é justamente o nome do dono, que
     * é a mitigação da delegação. Alargar o modal para caber o nome mais longo possível
     * resolveria um caso e quebraria o layout; o `title` é o padrão da casa para isto (mesmo
     * par de `.catalog-layer-name` em `js/features_tab/catalog-layers.component.js`).
     * @param {{groupId:string, name:string, permission:string, memberCount:number}} group
     */
    _renderGroupItem(group) {
        const groupId = String(group?.groupId ?? '');
        const nome = group?.name ?? 'Grupo';
        const options = groupLevelOptions(group, {
            userId: sessionContext.userId,
            isAdmin: sessionContext.isAdmin(),
        }).map((p) =>
            `<option value="${p.value}"${p.selected ? ' selected' : ''}${p.disabled ? ' disabled' : ''}>${p.label}</option>`
        ).join('');
        const meta = `${sharingGroupSizeLabel(group)} · ${sharingGroupOwnerLabel(group)}`;

        return `
            <div class="sharing-member sharing-group" data-testid="sharing-group-item" data-group-id="${escapeHtml(groupId)}">
                <span class="sharing-group__icon" aria-hidden="true">${ICONS.group}</span>
                <div class="sharing-member__info">
                    <span class="sharing-member__name">${escapeHtml(nome)}</span>
                    <span class="sharing-group__meta" data-testid="sharing-group-owner"
                          title="${escapeHtml(meta)}">${escapeHtml(meta)}</span>
                </div>
                <select class="sharing-member__permission" data-action="group-permission"
                        data-testid="sharing-group-permission" aria-label="Permissão do grupo ${escapeHtml(nome)}">
                    ${options}
                </select>
                <button type="button" class="sharing-member__remove" data-action="group-remove"
                        data-testid="sharing-group-remove" aria-label="Remover o grupo ${escapeHtml(nome)}">
                    ${ICONS.remove}
                </button>
            </div>
        `;
    }

    /**
     * @private O seletor de grupo, e a dica que ele carrega quando não há o que oferecer.
     *
     * A DICA NÃO PODE SER SILÊNCIO. Só se compartilha com grupo PRÓPRIO, e quem não tem
     * nenhum veria uma seção sem controle nenhum e concluiria que a função não existe. A
     * frase diz a regra E onde criar um, que é a única ação que destrava a tela.
     */
    _renderGroupPicker() {
        if (this._myGroups === null) {
            return `<p class="sharing-group__hint" data-testid="sharing-group-hint">Carregando seus grupos…</p>`;
        }
        const disponiveis = selectableGroups(this._myGroups, this._groups);
        if (!disponiveis.length) {
            const { label: porta } = adminAudience({
                isAuthenticated: sessionContext.isAuthenticated(),
                isAdmin: sessionContext.isAdmin(),
                isProducer: sessionContext.isProducer(),
            });
            const onde = porta ? ` Crie um em ${porta}.` : '';
            const frase = this._myGroups.length
                ? 'Todos os seus grupos já estão neste atlas.'
                : `Só é possível compartilhar com grupos que você administra.${onde}`;
            return `<p class="sharing-group__hint" data-testid="sharing-group-hint">${escapeHtml(frase)}</p>`;
        }
        const options = disponiveis.map((g) =>
            `<option value="${escapeHtml(String(g?.id ?? ''))}">${escapeHtml(groupOptionLabel(g, sessionContext.userId))}</option>`
        ).join('');
        return `
            <div class="sharing-group__add">
                <select class="sharing-group__select" data-action="group-pick"
                        data-testid="sharing-group-select" aria-label="Escolher um grupo">
                    <option value="">Adicionar um grupo…</option>
                    ${options}
                </select>
            </div>
            <p class="sharing-group__hint" data-testid="sharing-group-hint">
                Só aparecem aqui os grupos que você administra.
            </p>
        `;
    }

    /** @private */
    _renderAddSection() {
        return `
            <section class="sharing-section">
                <h3 class="sharing-section__title">Adicionar pessoas</h3>
                <div class="sharing-search">
                    <span class="sharing-search__icon" aria-hidden="true">${ICONS.search}</span>
                    <input type="text" class="sharing-search__input" data-action="search"
                           data-testid="sharing-user-search" placeholder="Buscar por nome, usuário ou posto…"
                           autocomplete="off" aria-label="Buscar pessoas">
                </div>
                <div class="sharing-results" data-results hidden></div>
            </section>
        `;
    }

    /**
     * @private
     * @param {Array<{id:string, username:string, nome:string, posto_graduacao?:string, organizacao_militar?:string}>} results
     */
    _renderResults(results) {
        const memberIds = new Set(this._shares.map((s) => String(s.userId)));
        const pickable = results.filter((u) => !memberIds.has(String(u?.id)));

        if (!results.length) {
            return '<div class="sharing-results__empty">Nenhum usuário encontrado</div>';
        }
        if (!pickable.length) {
            return '<div class="sharing-results__empty">Todos já são membros</div>';
        }

        return pickable.map((u) => {
            const id = String(u?.id ?? '');
            const nome = u?.nome ?? u?.username ?? '';
            const username = u?.username ?? '';
            const color = escapeHtml(getPresenceColor(id));
            const initials = escapeHtml(getInitials(nome));
            // Posto/Graduação · Organização Militar — helps disambiguate homonyms.
            const meta = [u?.posto_graduacao, u?.organizacao_militar].filter(Boolean).join(' · ');
            const metaRow = meta
                ? `<span class="sharing-result__meta">${escapeHtml(meta)}</span>`
                : '';
            return `
                <button type="button" class="sharing-result" data-action="add"
                        data-testid="sharing-search-result" data-user-id="${escapeHtml(id)}">
                    <span class="sharing-avatar" aria-hidden="true" style="background-color: ${color};">${initials}</span>
                    <span class="sharing-result__info">
                        <span class="sharing-member__name">${escapeHtml(nome)}</span>
                        <span class="sharing-member__username">@${escapeHtml(username)}</span>
                        ${metaRow}
                    </span>
                </button>
            `;
        }).join('');
    }

    // ===== LISTENERS =====

    /** @private Wires the (re-rendered) body's controls via the clearable 'body' scope. */
    _setupBodyListeners() {
        const body = this.getBody();

        const toggle = body.querySelector('[data-action="toggle-public"]');
        if (toggle) {
            addScopedDomListener(this, 'body', toggle, 'click', () => this._handleTogglePublic());
        }

        const copy = body.querySelector('[data-action="copy"]');
        if (copy) {
            addScopedDomListener(this, 'body', copy, 'click', () => this._handleCopyLink(copy));
        }

        body.querySelectorAll('.sharing-member').forEach((row) => {
            const userId = row.dataset.userId;
            const select = row.querySelector('[data-action="permission"]');
            if (select) {
                addScopedDomListener(this, 'body', select, 'change', () =>
                    this._handleChangePermission(userId, select.value));
            }
            const remove = row.querySelector('[data-action="remove"]');
            if (remove) {
                addScopedDomListener(this, 'body', remove, 'click', () =>
                    this._handleRemove(userId));
            }
            const transfer = row.querySelector('[data-action="transfer"]');
            if (transfer) {
                const nome = row.querySelector('.sharing-member__name')?.textContent ?? '';
                addScopedDomListener(this, 'body', transfer, 'click', () =>
                    this._handleTransfer(userId, nome));
            }
        });

        body.querySelectorAll('.sharing-group[data-group-id]').forEach((row) => {
            const groupId = row.dataset.groupId;
            const select = row.querySelector('[data-action="group-permission"]');
            if (select) {
                addScopedDomListener(this, 'body', select, 'change', () =>
                    this._handleChangeGroupPermission(groupId, select.value));
            }
            const remove = row.querySelector('[data-action="group-remove"]');
            if (remove) {
                addScopedDomListener(this, 'body', remove, 'click', () => this._handleRemoveGroup(groupId));
            }
        });

        const groupPick = body.querySelector('[data-action="group-pick"]');
        if (groupPick) {
            addScopedDomListener(this, 'body', groupPick, 'change', () =>
                this._handleAddGroup(groupPick.value));
        }

        const searchInput = body.querySelector('[data-action="search"]');
        if (searchInput) {
            addScopedDomListener(this, 'body', searchInput, 'input', () =>
                this._handleSearchInput(searchInput.value));
        }
    }

    // ===== HANDLERS =====

    /** @private Enables/disables public sharing, then re-reads the config. */
    async _handleTogglePublic() {
        if (this._busy) return;
        this._busy = true;
        const next = !this._isPublic;
        try {
            if (next) {
                await apiClient.enablePublicSharing(this._atlasId);
            } else {
                await apiClient.disablePublicSharing(this._atlasId);
            }
            await this._load();
        } catch (error) {
            showError(sharingErrorMessage(error, 'Não foi possível atualizar o link público.'));
        } finally {
            this._busy = false;
        }
    }

    /**
     * @private Copies the public link to the clipboard with inline feedback.
     * @param {HTMLElement} btn - The copy button (for the transient label swap).
     */
    async _handleCopyLink(btn) {
        const link = this._publicLink;
        if (!link) return;
        try {
            await navigator.clipboard.writeText(link);
            this._flashCopied(btn);
        } catch {
            showError('Não foi possível copiar o link.');
        }
    }

    /**
     * @private Briefly shows a "Copiado" confirmation on the copy button.
     * @param {HTMLElement} btn
     */
    _flashCopied(btn) {
        btn.classList.add('copied');
        btn.innerHTML = `${ICONS.check}<span>Copiado</span>`;
        const timer = setTimeout(() => {
            if (!btn.isConnected) return;
            btn.classList.remove('copied');
            btn.innerHTML = `${ICONS.copy}<span>Copiar</span>`;
        }, COPY_FEEDBACK_MS);
        trackTimer(this, timer, 'timeout');
    }

    /**
     * @private Updates a member's permission, then re-reads the config.
     * @param {string} userId
     * @param {'read'|'write'} permission
     */
    async _handleChangePermission(userId, permission) {
        if (this._busy || !userId) return;
        this._busy = true;
        try {
            await apiClient.updateShare(this._atlasId, userId, permission);
            await this._load();
        } catch (error) {
            showError(sharingErrorMessage(error, 'Não foi possível alterar a permissão.'));
            await this._load(); // resync the select to the server's truth
        } finally {
            this._busy = false;
        }
    }

    /**
     * @private Revokes a member's access, then re-reads the config.
     * @param {string} userId
     */
    async _handleRemove(userId) {
        if (this._busy || !userId) return;
        this._busy = true;
        try {
            await apiClient.removeShare(this._atlasId, userId);
            await this._load();
        } catch (error) {
            showError(sharingErrorMessage(error, 'Não foi possível remover o membro.'));
        } finally {
            this._busy = false;
        }
    }

    /**
     * @private Compartilha o atlas com um grupo PRÓPRIO, escolhido no seletor.
     *
     * O nível inicial é o mesmo `DEFAULT_GRANT_PERMISSION` das pessoas ("a permissão padrão
     * abaixa, nunca eleva"), e vale mais aqui do que lá: um grupo entra com N pessoas de uma
     * vez, então errar para cima erra N vezes.
     * @param {string} groupId
     */
    async _handleAddGroup(groupId) {
        if (this._busy || !groupId) return;
        this._busy = true;
        try {
            await apiClient.addAtlasGroupShare(this._atlasId, groupId, DEFAULT_GRANT_PERMISSION);
            await this._load();
        } catch (error) {
            // O 404 do servidor ("Access group not found") é a recusa por POSSE, e ele chega
            // aqui como frase do servidor por `sharingErrorMessage`. Não a traduza para
            // "grupo inexistente": a mensagem do servidor é deliberadamente indistinguível
            // entre "não existe" e "não é seu".
            showError(sharingErrorMessage(error, 'Não foi possível adicionar o grupo.'));
            await this._load();
        } finally {
            this._busy = false;
        }
    }

    /**
     * @private Troca o nível de um grupo já compartilhado.
     * @param {string} groupId
     * @param {'read'|'comment'|'write'|'manage'} permission
     */
    async _handleChangeGroupPermission(groupId, permission) {
        if (this._busy || !groupId) return;
        this._busy = true;
        try {
            await apiClient.updateAtlasGroupShare(this._atlasId, groupId, permission);
            await this._load();
        } catch (error) {
            showError(sharingErrorMessage(error, 'Não foi possível alterar a permissão do grupo.'));
            await this._load(); // resync do select com a verdade do servidor
        } finally {
            this._busy = false;
        }
    }

    /**
     * @private Tira um grupo do atlas.
     *
     * PEDE CONFIRMAÇÃO, ao contrário da remoção de uma pessoa, e a assimetria é de ALCANCE:
     * tirar um grupo tira N acessos de uma vez, e o botão fica a um clique de distância numa
     * lista onde as linhas se parecem.
     * @param {string} groupId
     */
    async _handleRemoveGroup(groupId) {
        if (this._busy || !groupId) return;
        const grupo = this._groups.find((g) => String(g.groupId) === String(groupId));
        const ok = await showConfirm(
            sharingGroupRemovalWarning(grupo),
            { destructive: true, confirmText: 'Remover' }
        );
        if (!ok) return;
        this._busy = true;
        try {
            await apiClient.removeAtlasGroupShare(this._atlasId, groupId);
            await this._load();
        } catch (error) {
            showError(sharingErrorMessage(error, 'Não foi possível remover o grupo.'));
        } finally {
            this._busy = false;
        }
    }

    /**
     * @private Transfers ownership to a member (owner-only). After a confirmation, calls the API
     * and re-reads the config. The current user stops being the owner (becomes a Gestor); the WS
     * `atlas_owner_changed` broadcast re-gates the rest of the UI.
     * @param {string} userId
     * @param {string} nome - Display name for the confirmation copy.
     */
    async _handleTransfer(userId, nome) {
        if (this._busy || !userId) return;
        const ok = await showConfirm(
            `Tornar ${nome || 'este membro'} o novo dono do atlas? Você deixará de ser o dono e passará a Gestor.`,
            { destructive: true, confirmText: 'Transferir' }
        );
        if (!ok) return;
        this._busy = true;
        try {
            await apiClient.transferOwnership(this._atlasId, userId);
            showSuccess('Propriedade transferida.');
            await this._load();
        } catch (error) {
            showError(sharingErrorMessage(error, 'Não foi possível transferir a propriedade.'));
        } finally {
            this._busy = false;
        }
    }

    /**
     * @private Debounces the user-search query; short queries clear the results.
     * @param {string} value
     */
    _handleSearchInput(value) {
        if (this._searchTimer) {
            clearTimeout(this._searchTimer);
            this._searchTimer = null;
        }
        const q = value.trim();
        if (q.length < SEARCH_MIN_CHARS) {
            this._renderResultsInto([]);
            this._setResultsHidden(true);
            return;
        }
        const timer = setTimeout(() => this._runSearch(q), SEARCH_DEBOUNCE_MS);
        this._searchTimer = timer;
        trackTimer(this, timer, 'timeout');
    }

    /**
     * @private Performs the search and renders results, dropping stale responses.
     * @param {string} q
     */
    async _runSearch(q) {
        const seq = ++this._searchSeq;
        try {
            const results = await apiClient.searchUsers(q);
            if (seq !== this._searchSeq) return; // a newer query superseded this one
            const list = Array.isArray(results) ? results : [];
            this._renderResultsInto(list);
            this._setResultsHidden(false);
        } catch {
            if (seq !== this._searchSeq) return;
            this._renderResultsInto([]);
            this._setResultsHidden(false);
        }
    }

    /**
     * @private Renders results HTML into the container and wires the add buttons.
     * @param {Array} results
     */
    _renderResultsInto(results) {
        const container = this.getBody()?.querySelector('[data-results]');
        if (!container) return;
        clearScopedListeners(this, 'results');
        container.innerHTML = results.length ? this._renderResults(results) : '';
        container.querySelectorAll('[data-action="add"]').forEach((btn) => {
            addScopedDomListener(this, 'results', btn, 'click', () =>
                this._handleAdd(btn.dataset.userId));
        });
    }

    /** @private */
    _setResultsHidden(hidden) {
        const container = this.getBody()?.querySelector('[data-results]');
        if (!container) return;
        container.hidden = hidden;
    }

    /**
     * @private Grants a searched user the default permission (Leitura — DEFAULT_GRANT_PERMISSION),
     * clears the search, re-reads config.
     * @param {string} userId
     */
    async _handleAdd(userId) {
        if (this._busy || !userId) return;
        // Guard against double-adding someone already a member.
        if (this._shares.some((s) => String(s.userId) === String(userId))) return;
        this._busy = true;
        try {
            await apiClient.addShare(this._atlasId, userId, DEFAULT_GRANT_PERMISSION);
            this._searchSeq++; // invalidate any in-flight search
            await this._load();
            // Reset the search UI after a successful add.
            const input = this.getBody()?.querySelector('[data-action="search"]');
            if (input) input.value = '';
            this._renderResultsInto([]);
            this._setResultsHidden(true);
        } catch (error) {
            showError(sharingErrorMessage(error, 'Não foi possível adicionar a pessoa.'));
        } finally {
            this._busy = false;
        }
    }

    /**
     * Hides the modal, clearing scoped listeners first.
     */
    hide() {
        // The PRESENCE_CHANGED subscription is tracked via subscribe() → cleaned up by super.hide().
        clearScopedListeners(this, 'body');
        clearScopedListeners(this, 'results');
        if (this._searchTimer) {
            clearTimeout(this._searchTimer);
            this._searchTimer = null;
        }
        super.hide();
    }
}

/**
 * Shows the atlas sharing modal.
 *
 * The caller is responsible for deciding whether to offer sharing; the backend independently
 * enforces `manage` (co-Gestor) on every mutation, never owner-only. Gate por hierarquia,
 * nunca por igualdade a `owner`.
 *
 * @param {string} atlasId - Atlas to manage sharing for.
 * @param {Object} [options]
 * @param {string} [options.atlasName] - Display name shown in the header title.
 * @returns {SharingModal} The modal instance.
 */
export function showSharingModal(atlasId, options = {}) {
    const modal = new SharingModal(atlasId, options);
    modal.render();
    modal.show();
    return modal;
}
