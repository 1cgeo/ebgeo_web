// Path: js/catalog/resource-share.modal.js

/**
 * @fileoverview Compartilhar UM RECURSO PRIVADO do catálogo (modelo 3D, panorama
 * 360, camada de dados, camada de análise).
 *
 * IRMÃO DE `modals/sharing.modal.js`, E NÃO O MESMO: lá a pergunta é "quem mexe
 * NESTE ATLAS" e a resposta é uma lista plana de permissões por atlas; aqui é "quem
 * VÊ ESTE RECURSO", e a resposta é uma ÁRVORE. A diferença tem consequência visível
 * na tela e é a razão de este arquivo existir separado:
 *
 * - cada linha diz de QUEM aquela pessoa recebeu o acesso, porque duas pessoas
 *   podem ter concedido o mesmo recurso à mesma pessoa (D3: a estrutura é um DAG,
 *   não uma árvore estrita) e revogar um caminho não derruba o outro;
 * - REVOGAR DERRUBA A SUBÁRVORE. É a consequência que ninguém adivinha, e por isso
 *   a confirmação conta quantas pessoas caem junto e as nomeia
 *   (`grant-tree.js`), em vez de dizer "isto pode afetar outras pessoas".
 *
 * O GATE É DO SERVIDOR, e este modal só é oferecido a quem `canShareResource`
 * aprova. Quem chegar aqui sem poder repassar (uma concessão revogada entre o
 * desenho do cartão e o clique) recebe a listagem em 403 e a tela diz isso, em vez
 * de mostrar um formulário que não grava.
 *
 * Exporta {@link showResourceShareModal}.
 */

import { ModalBase } from '@modals/modal.base.js';
import { showConfirm } from '@modals/confirm.modal.js';
import { addScopedDomListener, clearScopedListeners, trackTimer } from '@utils/event-cleanup.js';
import { escapeHtml } from '@utils/html-escape.js';
import { getPresenceColor, getInitials } from '@js/presence/presence-colors.js';
import { apiClient } from '@store/sync/api-client.js';
import { refreshVisibleResources } from '@store/sync/resource-access.service.js';
import { syncEngine } from '@store/sync/sync-engine.js';
import { showError, showSuccess } from '@utils/toast_service.js';
import { GRANT_LEVELS, CATALOG_UI_ICONS } from './catalog.constants.js';
import { descendantGrants, granteeName, revocationWarning } from './grant-tree.js';

/** Debounce (ms) da busca de usuário, o mesmo do compartilhamento de atlas. */
const SEARCH_DEBOUNCE_MS = 300;
/** Mínimo de caracteres que o backend aceita na busca. */
const SEARCH_MIN_CHARS = 2;
/** O nível padrão ao conceder. A permissão padrão ABAIXA, nunca eleva. */
const DEFAULT_GRANT_LEVEL = 'view';

/** Rótulo de um nível de concessão, ou o valor cru quando o servidor mandar outro. */
function grantLevelLabel(value) {
    return GRANT_LEVELS.find((n) => n.value === value)?.label ?? String(value ?? '');
}

/**
 * A mensagem de uma falha: a do SERVIDOR quando ela existe, a frase genérica
 * quando não. `_request` inventa `HTTP <status>` para resposta sem mensagem, e
 * essa string é para o console, nunca para o usuário.
 * @param {*} error
 * @param {string} fallback
 * @returns {string}
 */
export function shareErrorMessage(error, fallback) {
    const message = typeof error?.message === 'string' ? error.message.trim() : '';
    if (!message) return fallback;
    if (/^HTTP \d{3}$/.test(message)) return fallback;
    return message;
}

/**
 * Modal de compartilhamento de um recurso privado.
 * @extends ModalBase
 */
export class ResourceShareModal extends ModalBase {
    /**
     * @param {Object} params
     * @param {string} params.resourceType - `tileset` | `data_layer` | `analysis_layer` | `sv360_project`
     * @param {string} params.resourceId - O id CRU do recurso (slug ou UUID).
     * @param {string} [params.resourceName] - Nome exibido no cabeçalho.
     */
    constructor({ resourceType, resourceId, resourceName }) {
        super({
            id: 'resource-share-modal',
            title: resourceName ? `Compartilhar ${resourceName}` : 'Compartilhar recurso',
            icon: CATALOG_UI_ICONS.SHARE,
            destroyOnHide: true,
        });

        this._type = resourceType;
        this._id = resourceId;
        this._name = resourceName || resourceId;
        /** @type {Array<Object>} As concessões VIVAS deste recurso. */
        this._grants = [];
        /** @type {boolean} Uma escrita por vez. */
        this._busy = false;
        /** @type {number|null} */
        this._searchTimer = null;
        /** @type {number} Token monotônico: resposta de busca atrasada é descartada. */
        this._searchSeq = 0;
        /** @type {string} O nível escolhido no seletor (aplicado ao próximo convite). */
        this._level = DEFAULT_GRANT_LEVEL;
        /** @type {boolean} O servidor recusou a listagem (403): sem permissão de repassar. */
        this._denied = false;
    }

    /** @returns {HTMLElement} */
    render() {
        const overlay = super.render();
        this._overlay.dataset.testid = 'resource-share-modal';
        this.getBody().innerHTML =
            '<div class="sharing__state" data-testid="resource-share-loading"><span class="sharing__spinner" aria-hidden="true"></span><span>Carregando…</span></div>';
        document.body.appendChild(overlay);
        this._load();
        return overlay;
    }

    /**
     * @private Lê as concessões vivas e desenha.
     *
     * `destroyOnHide` faz o Escape durante a requisição derrubar o DOM e `getBody()`
     * passa a devolver undefined — daí a checagem nos dois ramos. NÃO troque por
     * `this._isOpen`: `_load()` é disparado por `render()`, ANTES de `show()`.
     */
    async _load() {
        try {
            const grants = await apiClient.listResourceGrants(this._type, this._id);
            if (!this.getBody()) return;
            this._grants = Array.isArray(grants) ? grants : [];
            this._denied = false;
            this._renderBody();
        } catch (error) {
            if (!this.getBody()) return;
            // 403 aqui não é falha de rede: é o gate de compartilhar dizendo que
            // este usuário só recebeu `view`. Merece uma tela própria, porque
            // "tentar novamente" nunca vai resolver.
            this._denied = error?.status === 403;
            if (this._denied) this._renderDenied();
            else this._renderError();
        }
    }

    /** @private */
    _renderDenied() {
        const body = this.getBody();
        if (!body) return;
        clearScopedListeners(this, 'body');
        body.innerHTML = `
            <div class="sharing__state" data-testid="resource-share-denied">
                <p>Você recebeu este recurso apenas para <strong>ver</strong>.</p>
                <p>Só quem tem acesso com permissão de compartilhar pode conceder este recurso a outras pessoas.</p>
            </div>
        `;
    }

    /** @private */
    _renderError() {
        const body = this.getBody();
        if (!body) return;
        clearScopedListeners(this, 'body');
        body.innerHTML = `
            <div class="sharing__state sharing__state--error" data-testid="resource-share-error">
                <p>Não foi possível carregar quem tem acesso a este recurso.</p>
                <button type="button" class="prompt-modal-btn prompt-modal-btn-confirm" data-action="retry">
                    Tentar novamente
                </button>
            </div>
        `;
        const retry = body.querySelector('[data-action="retry"]');
        if (retry) addScopedDomListener(this, 'body', retry, 'click', () => this._load());
    }

    /** @private */
    _renderBody() {
        const body = this.getBody();
        if (!body) return;
        clearScopedListeners(this, 'body');
        body.innerHTML = `
            <div class="sharing resource-share">
                ${this._renderGrantsSection()}
                ${this._renderAddSection()}
            </div>
        `;
        this._setupBodyListeners();
    }

    /** @private A lista de quem tem acesso, com o concedente de cada um. */
    _renderGrantsSection() {
        const linhas = this._grants.length
            ? this._grants.map((g) => this._renderGrantItem(g)).join('')
            : '<div class="sharing__empty" data-testid="resource-share-empty">Ninguém recebeu acesso a este recurso ainda.</div>';
        return `
            <section class="sharing-section">
                <h3 class="sharing-section__title">Quem tem acesso</h3>
                <p class="sharing-section__hint">
                    Administradores e curadores enxergam todo recurso privado e não aparecem nesta lista.
                </p>
                <div class="sharing-members" data-testid="resource-share-grants">${linhas}</div>
            </section>
        `;
    }

    /**
     * @private Uma concessão viva.
     * @param {Object} grant
     */
    _renderGrantItem(grant) {
        const id = String(grant?.id ?? '');
        const granteeId = String(grant?.grantee_id ?? '');
        const nome = granteeName(grant);
        const username = grant?.grantee_username ?? '';
        const concedente = grant?.granted_by_nome || grant?.granted_by_username || null;
        const color = escapeHtml(getPresenceColor(granteeId));
        const initials = escapeHtml(getInitials(nome));
        // Quantos caem junto: mostrado NA LINHA, e não só na confirmação, para que o
        // alcance da poda seja visível antes de o dedo ir para o botão.
        const caidos = descendantGrants(this._grants, id).length;
        const cascata = caidos > 0
            ? `<span class="resource-share__cascade" title="Revogar esta concessão derruba as que derivam dela">+${caidos} dependente(s)</span>`
            : '';
        const origem = concedente
            ? `<span class="sharing-member__username">recebido de ${escapeHtml(concedente)}</span>`
            : '<span class="sharing-member__username">concedido pela administração</span>';

        return `
            <div class="sharing-member" data-testid="resource-share-grant" data-grant-id="${escapeHtml(id)}">
                <span class="sharing-avatar" aria-hidden="true" style="background-color: ${color};">${initials}</span>
                <div class="sharing-member__info">
                    <span class="sharing-member__name">${escapeHtml(nome)}${username ? ` <span class="sharing-member__username">@${escapeHtml(username)}</span>` : ''}</span>
                    ${origem}
                </div>
                ${cascata}
                <span class="resource-share__level" data-testid="resource-share-level">${escapeHtml(grantLevelLabel(grant?.grant_level))}</span>
                <button type="button" class="sharing-member__remove" data-action="revoke"
                        data-testid="resource-share-revoke" aria-label="Remover o acesso de ${escapeHtml(nome)}">
                    ${CATALOG_UI_ICONS.REMOVE}
                </button>
            </div>
        `;
    }

    /** @private Busca de pessoa + escolha do nível. */
    _renderAddSection() {
        const opcoes = GRANT_LEVELS.map((n) =>
            `<option value="${n.value}"${n.value === this._level ? ' selected' : ''}>${n.label}</option>`
        ).join('');
        return `
            <section class="sharing-section">
                <h3 class="sharing-section__title">Conceder acesso</h3>
                <div class="resource-share__level-row">
                    <label class="resource-share__level-label" for="resource-share-level-select">Nível</label>
                    <select class="sharing-member__permission" id="resource-share-level-select"
                            data-action="level" data-testid="resource-share-level-select">${opcoes}</select>
                    <span class="settings-field__description">
                        "Ver e compartilhar" deixa a pessoa conceder este recurso a outras.
                    </span>
                </div>
                <div class="sharing-search">
                    <span class="sharing-search__icon" aria-hidden="true">${CATALOG_UI_ICONS.SEARCH}</span>
                    <input type="text" class="sharing-search__input" data-action="search"
                           data-testid="resource-share-search" placeholder="Buscar por nome, usuário ou posto…"
                           autocomplete="off" aria-label="Buscar pessoas">
                </div>
                <div class="sharing-results" data-results hidden></div>
            </section>
        `;
    }

    /**
     * @private
     * @param {Array<Object>} results
     */
    _renderResults(results) {
        const jaTem = new Set(this._grants.map((g) => String(g.grantee_id)));
        const escolhiveis = results.filter((u) => !jaTem.has(String(u?.id)));

        if (!results.length) return '<div class="sharing-results__empty">Nenhum usuário encontrado</div>';
        if (!escolhiveis.length) return '<div class="sharing-results__empty">Todos já têm acesso</div>';

        return escolhiveis.map((u) => {
            const id = String(u?.id ?? '');
            const nome = u?.nome ?? u?.username ?? '';
            const username = u?.username ?? '';
            const color = escapeHtml(getPresenceColor(id));
            const initials = escapeHtml(getInitials(nome));
            const meta = [u?.posto_graduacao, u?.organizacao_militar].filter(Boolean).join(' · ');
            const metaRow = meta ? `<span class="sharing-result__meta">${escapeHtml(meta)}</span>` : '';
            return `
                <button type="button" class="sharing-result" data-action="grant"
                        data-testid="resource-share-result" data-user-id="${escapeHtml(id)}">
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

    /** @private */
    _setupBodyListeners() {
        const body = this.getBody();
        if (!body) return;

        body.querySelectorAll('[data-grant-id]').forEach((row) => {
            const grantId = row.dataset.grantId;
            const revoke = row.querySelector('[data-action="revoke"]');
            if (revoke) addScopedDomListener(this, 'body', revoke, 'click', () => this._handleRevoke(grantId));
        });

        const level = body.querySelector('[data-action="level"]');
        if (level) addScopedDomListener(this, 'body', level, 'change', () => { this._level = level.value; });

        const search = body.querySelector('[data-action="search"]');
        if (search) addScopedDomListener(this, 'body', search, 'input', () => this._handleSearchInput(search.value));
    }

    // ===== HANDLERS =====

    /**
     * @private Revoga uma concessão E a subárvore dela, depois de avisar o alcance.
     *
     * A CONFIRMAÇÃO É O PONTO DESTE MODAL. O servidor poda em cascata (D2), e a
     * poda é invisível a quem clica: sem o aviso, tirar o acesso de uma pessoa tira
     * o de cinco sem que ninguém tenha dito isso. O texto vem de
     * `revocationWarning`, que conta e nomeia.
     * @param {string} grantId
     */
    async _handleRevoke(grantId) {
        if (this._busy || !grantId) return;
        const aviso = revocationWarning(this._grants, grantId);
        const ok = await showConfirm(aviso, { destructive: true, confirmText: 'Remover acesso' });
        if (!ok) return;

        this._busy = true;
        try {
            const resposta = await apiClient.revokeResourceGrant(grantId);
            // A contagem vem do SERVIDOR, e não do que a tela calculou: a árvore pode
            // ter crescido entre o desenho e o clique, e quem tem a verdade é a poda.
            const derrubadas = Array.isArray(resposta?.revoked) ? resposta.revoked.length : 0;
            showSuccess(derrubadas > 1
                ? `Acesso removido — ${derrubadas} concessões caíram junto.`
                : 'Acesso removido.');
            await this._refreshVisible();
            await this._load();
        } catch (error) {
            showError(shareErrorMessage(error, 'Não foi possível remover o acesso.'));
        } finally {
            this._busy = false;
        }
    }

    /**
     * @private Concede acesso à pessoa escolhida, no nível do seletor.
     * @param {string} userId
     */
    async _handleGrant(userId) {
        if (this._busy || !userId) return;
        this._busy = true;
        try {
            await apiClient.grantResource(this._type, this._id, {
                granteeId: userId,
                grantLevel: this._level,
            });
            showSuccess('Acesso concedido.');
            this._searchSeq++; // invalida qualquer busca em voo
            await this._load();
            const input = this.getBody()?.querySelector('[data-action="search"]');
            if (input) input.value = '';
            this._renderResultsInto([]);
            this._setResultsHidden(true);
        } catch (error) {
            showError(shareErrorMessage(error, 'Não foi possível conceder o acesso.'));
        } finally {
            this._busy = false;
        }
    }

    /**
     * @private Re-soma o payload aditivo depois de uma revogação.
     *
     * Só a revogação precisa disto, e só para o PRÓPRIO ator: quem revoga pode ter
     * derrubado a si mesmo de um caminho, e o catálogo dele precisa refletir isso
     * sem um F5. Quem RECEBE a revogação a percebe no próximo pedido do payload
     * (troca de atlas ou F5) — janela conhecida e aceita, sem push em socket vivo.
     */
    async _refreshVisible() {
        try {
            await refreshVisibleResources(syncEngine.atlasId ?? null);
        } catch {
            // Best-effort: o pior caso é o catálogo mostrar o recurso até o próximo pedido.
        }
    }

    /**
     * @private Debounce da busca; consulta curta limpa os resultados.
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
     * @private Busca e desenha, descartando resposta superada.
     * @param {string} q
     */
    async _runSearch(q) {
        const seq = ++this._searchSeq;
        try {
            const results = await apiClient.searchUsers(q);
            if (seq !== this._searchSeq) return;
            this._renderResultsInto(Array.isArray(results) ? results : []);
            this._setResultsHidden(false);
        } catch {
            if (seq !== this._searchSeq) return;
            this._renderResultsInto([]);
            this._setResultsHidden(false);
        }
    }

    /**
     * @private
     * @param {Array} results
     */
    _renderResultsInto(results) {
        const container = this.getBody()?.querySelector('[data-results]');
        if (!container) return;
        clearScopedListeners(this, 'results');
        container.innerHTML = results.length ? this._renderResults(results) : '';
        container.querySelectorAll('[data-action="grant"]').forEach((btn) => {
            addScopedDomListener(this, 'results', btn, 'click', () => this._handleGrant(btn.dataset.userId));
        });
    }

    /** @private */
    _setResultsHidden(hidden) {
        const container = this.getBody()?.querySelector('[data-results]');
        if (container) container.hidden = hidden;
    }

    /** Fecha o modal, liberando os listeners com escopo antes. */
    hide() {
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
 * Abre o modal de compartilhamento de um recurso privado.
 *
 * O chamador decide se OFERECE a ação (o cartão do catálogo consulta
 * `canShareResource`); o servidor reimpõe o gate em toda escrita.
 *
 * @param {{resourceType: string, resourceId: string, resourceName?: string}} params
 * @returns {ResourceShareModal}
 */
export function showResourceShareModal(params) {
    const modal = new ResourceShareModal(params);
    modal.render();
    modal.show();
    return modal;
}
