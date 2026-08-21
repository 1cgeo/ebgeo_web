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
 *   a confirmação conta quantos caem junto e os nomeia (`grant-tree.js`), em vez de
 *   dizer "isto pode afetar outras pessoas";
 * - O BENEFICIÁRIO PODE SER COLETIVO. Aqui uma concessão vai a uma pessoa OU a um
 *   grupo de acesso, nunca aos dois, e o eixo de grupo não existe no atlas. É por
 *   isso que a linha da lista tem duas formas (avatar de presença para pessoa, selo
 *   e tamanho para grupo) e que conceder tem dois caminhos: ver `_renderGroupRow`,
 *   que explica por que o grupo é seletor e a pessoa é busca.
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
import { sessionContext } from '@store/sync/session-context.js';
import { showError, showSuccess } from '@utils/toast_service.js';
import { GRANT_LEVELS, CATALOG_UI_ICONS } from './catalog.constants.js';
import {
    alreadyGranted,
    deadGrantorChip,
    fallenGrants,
    grantOriginLabel,
    granteeGroupOwnerLabel,
    granteeName,
    granteeSubject,
    groupMemberCount,
    groupOptionLabel,
    isGroupGrant,
    revocationWarning,
} from './grant-tree.js';

/** Debounce (ms) da busca de usuário, o mesmo do compartilhamento de atlas. */
const SEARCH_DEBOUNCE_MS = 300;
/** Mínimo de caracteres que o backend aceita na busca. */
const SEARCH_MIN_CHARS = 2;
/** O nível padrão ao conceder. A permissão padrão ABAIXA, nunca eleva. */
const DEFAULT_GRANT_LEVEL = 'view';

/**
 * O selo de um beneficiário COLETIVO, no lugar onde a pessoa tem avatar.
 *
 * Iniciais e cor de presença são identidade de PESSOA (a mesma cor aparece no cursor
 * e no roster de quem está online), e emprestá-las a um grupo faria a lista sugerir
 * que existe alguém ali. Ícone estático, sem cor derivada de id.
 */
const GROUP_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;

/** Rótulo de um nível de concessão, ou o valor cru quando o servidor mandar outro. */
function grantLevelLabel(value) {
    return GRANT_LEVELS.find((n) => n.value === value)?.label ?? String(value ?? '');
}

/**
 * A data de vencimento de uma concessão, em pt-BR, ou string vazia quando não há.
 *
 * TODA CONCESSÃO VENCE (no máximo um ano, e nunca depois da de quem concedeu), e a morte
 * mora no PREDICADO: no dia seguinte o recurso simplesmente não vem mais, sem evento, sem
 * aviso e sem nada para o usuário ler. Mostrar o prazo na linha é a única coisa que separa
 * isso de "o recurso sumiu do meu catálogo".
 * @param {*} valor - `expires_at` do servidor (ISO).
 * @returns {string}
 */
function expiryLabel(valor) {
    if (!valor) return '';
    const data = new Date(valor);
    if (Number.isNaN(data.getTime())) return '';
    return data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
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
        /** @type {Array<Object>} Os grupos de acesso, lidos UMA vez por abertura. */
        this._groups = [];
        /** @type {boolean} A leitura dos grupos já aconteceu (mesmo que tenha falhado). */
        this._groupsLoaded = false;
        /** @type {boolean} A leitura FALHOU. Separado de "veio vazia": a dica de lista vazia
         *  afirma que a pessoa não tem grupo, e afirmar isso depois de um erro de rede é dizer
         *  uma coisa falsa com cara de estado. */
        this._groupsFailed = false;
        /** @type {string} O grupo escolhido no seletor, zerado a cada redesenho. */
        this._groupId = '';
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
            await this._loadGroups();
            if (!this.getBody()) return;
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

    /**
     * @private Lê os grupos de acesso UMA vez, e nunca derruba o modal.
     *
     * Falha em silêncio de propósito: os grupos são o SELETOR, não o conteúdo da
     * tela. Se a chamada falhar (ou não houver grupo nenhum cadastrado), a seção de
     * conceder deixa de oferecer a linha de grupo e o resto continua funcionando.
     * Deixar o erro subir daqui levaria a listagem inteira para a tela de falha, que
     * é dizer "não deu para ver quem tem acesso" por causa de um seletor.
     */
    async _loadGroups() {
        if (this._groupsLoaded) return;
        this._groupsLoaded = true;
        try {
            const grupos = await apiClient.listAccessGroups();
            this._groups = Array.isArray(grupos) ? grupos : [];
        } catch {
            this._groups = [];
            this._groupsFailed = true;
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
        // O seletor de grupo é redesenhado com o placeholder escolhido, então a
        // escolha anterior não sobrevive ao redesenho e guardá-la concederia a um
        // grupo que já não está mais selecionado na tela.
        this._groupId = '';
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
                    Administradores, credenciados e produtores da OM dona enxergam este recurso
                    por papel, sem concessão, e não aparecem nesta lista.
                </p>
                <div class="sharing-members" data-testid="resource-share-grants">${linhas}</div>
            </section>
        `;
    }

    /**
     * @private O avatar de quem recebeu: identidade de pessoa OU selo de grupo.
     * @param {Object} grant
     * @param {string} nome
     */
    _renderGranteeAvatar(grant, nome) {
        if (isGroupGrant(grant)) {
            return `<span class="sharing-avatar resource-share__group-avatar" aria-hidden="true">${GROUP_ICON}</span>`;
        }
        const color = escapeHtml(getPresenceColor(String(grant?.grantee_id ?? '')));
        const initials = escapeHtml(getInitials(nome));
        return `<span class="sharing-avatar" aria-hidden="true" style="background-color: ${color};">${initials}</span>`;
    }

    /**
     * @private A linha do nome: `@usuário` para pessoa, tamanho e DONO do grupo para grupo.
     *
     * O tamanho fica ao LADO do nome porque é o que dá a escala do que está sendo
     * concedido: "Equipe Alfa" não diz se são dois ou duzentos. Grupo vazio diz isso
     * por extenso, senão a linha some e o vazio vira indistinguível do desconhecido.
     *
     * O DONO ENTROU EM 2026-08-21 e é a mitigação obrigatória da concessão coletiva: ele
     * pode acrescentar beneficiários a este recurso sem passar por quem concedeu, e esta
     * lista é a única tela onde isso aparece. A concessão a PESSOA não ganha rótulo
     * nenhum, e essa diferença é o que faz o rótulo significar alguma coisa.
     *
     * O `title` NO DONO NÃO É ENFEITE: o rótulo ("Dono: Fulano (@fulano)") passa por DOIS
     * clipes de reticências em série (`.sharing-member__name` e `.sharing-member__username`
     * carregam os dois o trio `nowrap`/`overflow`/`ellipsis`), então numa linha estreita
     * ele corta justamente no nome. Alargar a coluna quebraria a linha de membro
     * compartilhada com o modal de atlas; o `title` é o padrão da casa para isso.
     * @param {Object} grant
     * @param {string} nome
     */
    _renderGranteeNameLine(grant, nome) {
        if (isGroupGrant(grant)) {
            const membros = groupMemberCount(grant);
            const texto = membros ? `${membros} ${membros === 1 ? 'pessoa' : 'pessoas'}` : 'sem membros';
            const dono = granteeGroupOwnerLabel(grant);
            return `<span class="sharing-member__name">${escapeHtml(nome)}
                        <span class="resource-share__group-count" data-testid="resource-share-group-count">${escapeHtml(texto)}</span>
                        <span class="sharing-member__username" data-testid="resource-share-group-owner"
                              title="${escapeHtml(dono)}">${escapeHtml(dono)}</span>
                    </span>`;
        }
        const username = grant?.grantee_username ?? '';
        const arroba = username ? ` <span class="sharing-member__username">@${escapeHtml(username)}</span>` : '';
        return `<span class="sharing-member__name">${escapeHtml(nome)}${arroba}</span>`;
    }

    /**
     * @private Uma concessão da listagem, de pessoa ou de grupo.
     *
     * "VIVA" AQUI SÓ QUER DIZER NÃO REVOGADA E NÃO VENCIDA, e a diferença virou visível:
     * a listagem devolve também a linha cujo CONCEDENTE morreu, que o predicado do
     * servidor já não honra. Ela é marcada por `deadGrantorChip`, nunca escondida — quem
     * a esconde tira da tela o único caminho para revogá-la. As decisões (o predicado, o
     * texto do chip e a frase de origem) moram em `grant-tree.js`, que é onde elas são
     * testáveis em node; aqui fica só o HTML.
     * @param {Object} grant
     */
    _renderGrantItem(grant) {
        const id = String(grant?.id ?? '');
        const nome = granteeName(grant);
        const grupo = isGroupGrant(grant);
        // Quantos caem junto: mostrado NA LINHA, e não só na confirmação, para que o
        // alcance da poda seja visível antes de o dedo ir para o botão. `fallenGrants` e
        // não o fecho ingênuo: quem tem outro `view_share` vivo do mesmo concedente é
        // RESGATADO pelo servidor, e contá-lo aqui é prometer uma queda que não acontece.
        const caidos = fallenGrants(this._grants, id).length;
        const cascata = caidos > 0
            ? `<span class="resource-share__cascade" title="Revogar esta concessão derruba as que derivam dela">+${caidos} dependente(s)</span>`
            : '';
        // A LINHA QUE O PREDICADO DO SERVIDOR JÁ NEGA. Ela fica na lista (é revogável, e
        // some da tela seria pior), mas para de ser desenhada como acesso vigente: chip
        // âmbar, porque é a mesma família de "o que surpreende" da cascata, e a frase de
        // origem muda de verbo sem perder o nome de quem concedeu.
        const morto = deadGrantorChip(grant);
        const semEfeito = morto
            ? `<span class="resource-share__dead" data-testid="resource-share-dead"
                     title="${escapeHtml(morto.title)}">${escapeHtml(morto.label)}</span>`
            : '';
        const origem = `<span class="sharing-member__username">${escapeHtml(grantOriginLabel(grant))}</span>`;
        const vence = expiryLabel(grant?.expires_at);
        const prazo = vence
            ? `<span class="resource-share__expiry" data-testid="resource-share-expiry"
                     title="Depois desta data o acesso deixa de valer sozinho, sem aviso.">expira em ${escapeHtml(vence)}</span>`
            : '';

        return `
            <div class="sharing-member" data-testid="resource-share-grant"
                 data-grantee-kind="${grupo ? 'grupo' : 'pessoa'}"
                 data-grant-effective="${morto ? 'false' : 'true'}" data-grant-id="${escapeHtml(id)}">
                ${this._renderGranteeAvatar(grant, nome)}
                <div class="sharing-member__info">
                    ${this._renderGranteeNameLine(grant, nome)}
                    ${origem}
                </div>
                ${semEfeito}
                ${prazo}
                ${cascata}
                <span class="resource-share__level" data-testid="resource-share-level">${escapeHtml(grantLevelLabel(grant?.grant_level))}</span>
                <button type="button" class="sharing-member__remove" data-action="revoke"
                        data-testid="resource-share-revoke" aria-label="Remover o acesso ${escapeHtml(granteeSubject(grant))}">
                    ${CATALOG_UI_ICONS.REMOVE}
                </button>
            </div>
        `;
    }

    /**
     * @private A linha de conceder a um GRUPO: seletor curto, não busca.
     *
     * SELETOR SEPARADO, E NÃO UMA BUSCA ÚNICA QUE MISTURA OS DOIS TIPOS. A escolha é
     * pela natureza das duas listas, que só parecem a mesma coisa:
     *
     * - a de grupos é CURTA, FECHADA e chega numa chamada só (`listAccessGroups`).
     *   "Fechada", e não "completa": desde que a listagem passou a devolver só os grupos
     *   PRÓPRIOS, o conjunto continua conhecido inteiro numa chamada, mas já não é todo o
     *   sistema (o parágrafo do fim deste bloco trata do que isso significa),
     *   então ela pode ser MOSTRADA. Enfiá-la atrás de um campo de busca esconderia
     *   de quem não sabe que existe grupo justamente a informação de que existe, e
     *   um seletor cuja função é revelar o que há não pode depender de a pessoa já
     *   saber o nome;
     * - a de pessoas é uma busca contra o servidor, com debounce e mínimo de dois
     *   caracteres, e nunca está completa. Num campo único os grupos apareceriam e
     *   sumiriam conforme a digitação, e o estado vazio ("Nenhum usuário encontrado"
     *   / "Todos já têm acesso") passaria a falar por duas listas com frescores
     *   diferentes, dizendo o mesmo para causas distintas.
     *
     * O nível escolhido acima vale para os dois caminhos: é o mesmo ato.
     *
     * LISTA VAZIA DEIXOU DE SER SILÊNCIO em 2026-08-20. `listAccessGroups` passou a
     * devolver só os grupos PRÓPRIOS de quem pergunta (conceder a um coletivo é
     * delegar ao dono dele o poder de acrescentar beneficiários), então "nenhum
     * grupo" virou o caso NORMAL de quem chega — antes significava "ninguém no
     * sistema cadastrou grupo". Sumir com a linha inteira ali esconderia uma
     * funcionalidade que existe e faria a pessoa concluir que ela não existe.
     */
    _renderGroupRow() {
        // Leitura falhada continua sendo SILÊNCIO, e é o que separa as duas ausências: "você
        // não tem grupo" é um estado, e dizê-lo por causa de um erro de rede seria inventar um.
        if (this._groupsFailed) return '';
        if (!this._groups.length) {
            return `
                <p class="sharing-section__hint" data-testid="resource-share-groups-empty">
                    Você ainda não tem grupos de acesso. O seletor só oferece grupos seus:
                    crie um na página Grupos e conceda a ele em vez de pessoa por pessoa.
                </p>
            `;
        }
        const { groupIds } = alreadyGranted(this._grants);
        const escolhiveis = this._groups.filter((g) => !groupIds.has(String(g?.id)));
        if (!escolhiveis.length) {
            return `
                <p class="sharing-section__hint" data-testid="resource-share-groups-exhausted">
                    Todos os seus grupos de acesso já receberam este recurso.
                </p>
            `;
        }
        // O rótulo é `grant-tree.js`, que é onde ele é testável em node: ele nomeia o DONO
        // do grupo alheio, porque a unicidade de nome passou a ser por dono e o
        // administrador (o único que vê grupo de outra pessoa aqui) escolheria entre duas
        // linhas idênticas.
        const eu = sessionContext.userId;
        const opcoes = escolhiveis.map((g) => {
            const rotulo = groupOptionLabel(g, eu);
            return `<option value="${escapeHtml(String(g?.id ?? ''))}">${escapeHtml(rotulo)}</option>`;
        }).join('');
        return `
            <div class="resource-share__group-row">
                <label class="resource-share__level-label" for="resource-share-group-select">Grupo</label>
                <select class="sharing-member__permission" id="resource-share-group-select"
                        data-action="group" data-testid="resource-share-group-select">
                    <option value="">Escolher um grupo…</option>
                    ${opcoes}
                </select>
                <button type="button" class="prompt-modal-btn prompt-modal-btn-confirm"
                        data-action="grant-group" data-testid="resource-share-grant-group" disabled>
                    Conceder ao grupo
                </button>
            </div>
        `;
    }

    /** @private Busca de pessoa + escolha de grupo + escolha do nível. */
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
                <p class="sharing-section__hint">
                    Todo acesso concedido vence em até um ano, e nunca depois do acesso de quem
                    concedeu. Vencido, ele deixa de valer sozinho, sem aviso: para manter, conceda
                    de novo antes da data.
                </p>
                ${this._renderGroupRow()}
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
        // Só o eixo de PESSOA aqui: quem já tem acesso por um grupo continua
        // escolhível de propósito, porque tirá-lo do grupo é outra decisão e a
        // concessão pessoal é um caminho independente (D3, a estrutura é um DAG).
        const { userIds } = alreadyGranted(this._grants);
        const escolhiveis = results.filter((u) => !userIds.has(String(u?.id)));

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

        const group = body.querySelector('[data-action="group"]');
        const grantGroup = body.querySelector('[data-action="grant-group"]');
        if (group) {
            addScopedDomListener(this, 'body', group, 'change', () => {
                this._groupId = group.value;
                // O botão nasce desabilitado com o placeholder escolhido: sem isto,
                // clicar sem escolher seria um clique que não faz nada e não explica.
                if (grantGroup) grantGroup.disabled = !group.value;
            });
        }
        if (grantGroup) {
            addScopedDomListener(this, 'body', grantGroup, 'click', () => this._handleGrantGroup(this._groupId));
        }

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
     *
     * O AVISO SUPERESTIMA, E É DE PROPÓSITO. Depois da preservação de alcançabilidade
     * o servidor resgata quem alcança o recurso por outro caminho, e o cliente só
     * consegue prever o resgate no eixo PESSOAL (ver `fallenGrants`). O toast de
     * sucesso é quem corrige o número, com a contagem verdadeira das três listas.
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
            // AS DUAS LISTAS NOVAS SÃO O FATO MAIS INTERESSANTE PARA QUEM ACABOU DE
            // REVOGAR: elas dizem quem NÃO caiu porque alcança o recurso por outro
            // concedente. Sem a frase, o usuário conclui que a poda foi incompleta.
            // `trimmed` entra na mesma contagem de propósito: do ponto de vista de quem
            // revogou, os dois são "continua com acesso".
            const mantidas = (Array.isArray(resposta?.reparented) ? resposta.reparented.length : 0)
                + (Array.isArray(resposta?.trimmed) ? resposta.trimmed.length : 0);
            const caiu = derrubadas > 1
                ? `Acesso removido — ${derrubadas} concessões caíram junto.`
                : 'Acesso removido.';
            const manteve = mantidas > 0
                ? ` ${mantidas} ${mantidas === 1 ? 'concessão foi mantida' : 'concessões foram mantidas'}`
                  + ' por outro caminho de acesso.'
                : '';
            showSuccess(`${caiu}${manteve}`);
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
     * @private Concede acesso ao grupo escolhido, no nível do seletor.
     *
     * `granteeGroupId` e `granteeId` são ALTERNATIVOS no Joi da rota (um `xor` que
     * espelha o CHECK da tabela), então este payload nunca carrega os dois.
     * @param {string} groupId
     */
    async _handleGrantGroup(groupId) {
        if (this._busy || !groupId) return;
        this._busy = true;
        try {
            await apiClient.grantResource(this._type, this._id, {
                granteeGroupId: groupId,
                grantLevel: this._level,
            });
            showSuccess('Acesso concedido ao grupo.');
            await this._load();
        } catch (error) {
            showError(shareErrorMessage(error, 'Não foi possível conceder o acesso ao grupo.'));
        } finally {
            this._busy = false;
        }
    }

    /**
     * @private Re-soma o payload aditivo depois de uma revogação.
     *
     * Só a revogação precisa disto, e só para o PRÓPRIO ator: quem revoga pode ter
     * derrubado a si mesmo de um caminho, e o catálogo dele precisa refletir isso
     * sem um F5.
     *
     * QUEM RECEBE a revogação tem DOIS alcances, e eles não se confundem. Quem está
     * numa sala de atlas que EMPRESTA o recurso é avisado ao vivo (o servidor emite
     * `atlas_resources_updated` para essas salas) e re-soma na hora, sem F5. O
     * beneficiário pessoal ou de grupo fora de um atlas que empresta continua sem push:
     * o socket dele pode estar noutra sala ou não existir, e ele percebe no próximo
     * pedido do payload aditivo (troca de atlas ou F5).
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
